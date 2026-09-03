/**
 * L1 — the append-only, branch-capable commit log that carries cause-tagged
 * Mosaic clauses AND can rebuild them into a fresh Selection with fresh
 * source identity.
 *
 * Promoted verbatim from spikes/x1-replay/log.ts (D17: the proven wire
 * shape). This is the "L0 wire shape" every later layer consumes. It is a
 * thin bespoke JSONL+branch record (see the Q1 evaluation, SPEC.md §10): a
 * clause is NOT serialized as an object graph (impossible — `source` is an
 * identity, `predicate` is an AST). Instead each commit stores the
 * DETERMINISTIC RECIPE (kind, field, value) plus the registry id of its
 * source, so replay reconstructs an identical clause.
 *
 * R# satisfied (SPEC.md §3):
 *  - R2  replay is a MODE — replayLog only ADDS `cause.replayed = true`.
 *  - R5  commits carry DATA-space values (not pixels); replay rebuilds
 *        identical predicate SQL in a fresh selection.
 *  - R8  append-only branching via parent pointers. There is deliberately NO
 *        delete/remove/edit API on the log — enforced by construction, in
 *        three layers (see src/log/README.md, "the trace is tamper-evident"):
 *        (a) the records array is PRIVATE (`#records`); the only way to add
 *        one is `commit()`, which always appends. (b) `records` is a getter
 *        that hands back a FROZEN snapshot, so a reader cannot push, splice
 *        or assign into the log's own array. (c) every appended record is
 *        DEEPLY frozen, so a caller holding a reference cannot rewrite the
 *        record — or its `cause`, its `value`, its `fields`, its
 *        `clientViewIds`, its `actorMeta` or its `data` — after the fact.
 *        A log coming back off the wire is re-judged by `parseCommitLog`.
 *  - R10 first-class `CommitRecord.correlationId` cross-tier join key.
 *  - R13 commit-on-intent — `commit()` is a single synchronous write; the
 *        log has no batching/debounce path a caller could accidentally rely
 *        on (proven out-of-hot-path at bench/x4).
 */

import { Selection } from '@uwdata/mosaic-core';
import type { SelectionClause } from '@uwdata/mosaic-core';
import { ACTORS, isActor, markReplayed, parseCause, validateCause, type Cause } from '../cause/index.js';
import { copyValue, deepFreeze } from '../detach/index.js';
import {
  SourceRegistry,
  causeClause,
  type ActorMeta,
  type CauseClauseSpec,
} from '../mosaic/index.js';

/** The serializable commit — one interaction's worth of clause + provenance. */
export interface CommitRecord {
  /**
   * Stable commit id.
   *
   * THE IDENTITY LAW: an id is unique **per dashboard**, not per session. The
   * counter that mints it lives on the dashboard runtime beside the other
   * shared stores (saved pictures, bookmarks), so two sessions opened on one
   * `buildDashboard` can never mint the same id. A session's own log therefore
   * has GAPS in its numbering (session A holds `s1, s3`, session B holds
   * `s2, s4`) — that is correct and expected: nothing reads an id as a
   * position, and `ts` already carries order. See src/log/README.md.
   */
  readonly id: string;
  /** Parent commit id, or null for a root. Enables branching timelines (R8). */
  readonly parent: string | null;
  /**
   * Optional cross-tier join key (x3 / R10): ties this commit to a
   * correlated event in another tier (agent tool call, kernel run, …).
   * First-class field — NOT the commit `id`. Before this field existed the
   * x3 spike overloaded `id` as the join key (id === correlationId), which
   * conflated "this commit's own identity" with "the cross-tier address to
   * find it by". Independent concerns: `id` must stay unique per log entry
   * (parent-pointer chaining relies on it); `correlationId` may be shared,
   * absent, or reused by a caller's own scheme.
   */
  readonly correlationId?: string;
  /** Registry key that resolves to the clause `source` identity on replay. */
  readonly viewId: string;
  /** Serializable actor metadata so a fresh registry can rebuild the source. */
  readonly actorMeta: ActorMeta;
  /** Which clause factory to reconstruct with (`'cell'` = the D30 compound; `'match'` = the SET-1 IN-list, its value a `MatchValue`). */
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
  /**
   * Column / expression the clause filters on. For `kind: 'cell'` this slot
   * carries the DISPLAY-ONLY joint label ("price × category" —
   * `src/data`'s `cellFieldLabel`); the authoritative pair rides `fields`.
   */
  readonly field: string;
  /**
   * The selected value (must be JSON-serializable). For `kind: 'cell'` this
   * is the two-sided pair `[x side, y side]` (each side an interval
   * `[lo, hi]` or a point value), or `null` for a cleared cell.
   */
  readonly value: unknown;
  /** kind:'cell' only — the TWO selected fields, x side then y side (D30). */
  readonly fields?: readonly [string, string];
  /** Registry ids whose sources form the cross-filter self-exclusion set. */
  readonly clientViewIds: readonly string[];
  /** Predicate SQL string — a descriptor for verification / replay determinism. */
  readonly predicateSQL: string;
  /** The two-slot cause (+ `replayed:true` once re-emitted by a replay). */
  readonly cause: Cause;
  /** Authoring timestamp (logical ok; not load-bearing). */
  readonly ts: number;
  /**
   * The DATA this commit was true of: table → the source version the engine
   * held when it landed (absent for tables declared inline, which never move).
   * A replay against another version is labelled by comparing this, never
   * silently re-answered.
   */
  readonly data?: Readonly<Record<string, string>>;
}

/** Input to author one commit. `cause` is validated before anything is built. */
export interface CommitInput {
  id: string;
  parent: string | null;
  /** Optional cross-tier join key — see {@link CommitRecord.correlationId}. */
  correlationId?: string;
  viewId: string;
  actorMeta: ActorMeta;
  kind: 'point' | 'interval' | 'cell' | 'match';
  field: string;
  value: unknown;
  /** REQUIRED for kind:'cell' (commit() refuses a cell without its pair); ignored otherwise. */
  fields?: readonly [string, string];
  cause: Cause;
  /** The data versions this commit is true of; absent = ask the log's `stampData` hook, if any. */
  data?: Readonly<Record<string, string>>;
  /** Defaults to [viewId] — a view excludes only its own clause. The log COPIES it: the record never aliases a caller's array. */
  clientViewIds?: readonly string[];
  ts?: number;
}

/**
 * A live authoring/replay session: a Mosaic Selection, the registry that owns
 * its source identities, and the growing commit log. Live authoring and replay
 * both drive `commit()`, so their behavior is identical by construction.
 */
export class CauseSelectionSession {
  readonly selection: Selection;
  readonly registry: SourceRegistry;
  /**
   * THE TRACE. Private, and truly private (`#`, not `private`): a caller
   * cannot reach it through a cast either. `commit()` is the only writer and
   * it only ever pushes.
   */
  readonly #records: CommitRecord[] = [];
  /**
   * The frozen snapshot `records` hands out, rebuilt on the first read after
   * each commit. Undefined = the log moved since the last read.
   */
  #view: readonly CommitRecord[] | undefined;
  /** Set by the session: the data versions to stamp on every commit that names none (table → version). */
  stampData?: () => Readonly<Record<string, string>> | undefined;
  /**
   * Set by the session: what to do when pushing the clause onto the live
   * `Selection` throws — see {@link commit}'s APPLY phase.
   *
   * The selection update is the one OUTBOUND step of a commit: it relays to
   * downstream selections and emits to every listener a host attached (the
   * demo's charts are exactly that). Third-party code, in other words, and it
   * runs AFTER the record is already on the trace — so a throw from it must
   * never un-land the commit, and must never be swallowed either.
   *
   * This log has no ledger of its own, so it does not invent one: a session
   * installs this hook and files the failure as a typed gap. With no hook
   * installed the error is RETHROWN (the record stays landed) — which is what a
   * bare `CauseSelectionSession` did before this hook existed.
   */
  onSelectionUpdateFailed?: (error: unknown, record: CommitRecord) => void;

  constructor(selection = Selection.crossfilter(), registry = new SourceRegistry()) {
    this.selection = selection;
    this.registry = registry;
  }

  /**
   * The trace, as a reader may hold it: a FROZEN array of the records so far.
   *
   * Why an array and not an iterator: every reader in this repo — the fold,
   * `causalChain`, `why`, the FDR stream, the UI adapter — asks the log
   * questions an array answers directly (`.length`, `.find`, `.map`, index
   * access, and being passed to a function typed `readonly CommitRecord[]`).
   * An iterator would buy no extra safety (a frozen array cannot be pushed,
   * spliced or assigned into) and would cost every one of those call sites a
   * spread back into an array.
   *
   * The snapshot is DETACHED, and deliberately so: a reader that holds it
   * across a later `commit()` keeps seeing the log exactly as it was when it
   * asked. That is what a fold wants — a fold is a claim about a moment. Read
   * again to see the moment after.
   *
   * Cost: one array copy on the first read after each commit, then free for
   * every read until the next one. The records inside are shared, which is
   * safe because each is deeply frozen.
   */
  get records(): readonly CommitRecord[] {
    return (this.#view ??= Object.freeze(this.#records.slice()));
  }

  /**
   * Author one commit: reconstruct source identity from the registry, build the
   * cause-tagged clause, append the record, and push the clause onto the live
   * selection. Returns both the record and the live clause.
   *
   * ALL-OR-NOTHING, in two phases (the session law — src/session/README.md,
   * "a dispatch either fully happens or does not happen at all"):
   *
   *  - **JUDGE** — everything that can throw happens here, and NOTHING
   *    observable has moved yet: the cause gate, the registry lookups, the
   *    value copy, the cell's field-pair refusal, building the clause, asking
   *    the session for the data stamp, rendering `predicateSQL` and the deep
   *    freeze. Any of these throwing leaves the log and the selection exactly
   *    as they were, so the act simply did not happen.
   *  - **APPLY** — pure assignment: push the record, drop the cached snapshot.
   *
   * This ORDER is the fix for a real window. The selection used to be updated
   * the moment the clause existed, several fallible steps BEFORE the record was
   * built and frozen — so a throwing `stampData`, a predicate whose `toString`
   * threw, or a freeze that failed left the live selection standing on a clause
   * with no commit behind it. That is precisely what
   * [`src/detach/README.md`](../detach/README.md) says must be impossible: what
   * is on screen would no longer be derived from the trace.
   */
  commit(input: CommitInput): { record: CommitRecord; clause: SelectionClause } {
    // ── JUDGE ────────────────────────────────────────────────────────────────
    // D30: a cell commit carries its authoritative field PAIR; refusing an
    // absent pair here (not downstream) keeps every replica of the wire
    // (fold, replay, adapter) free to trust `fields` on a cell record. It is
    // the FIRST thing judged so the refusal cannot even register a source.
    if (input.kind === 'cell' && input.fields === undefined) {
      throw new Error('vizfootprint log: a cell commit needs `fields` — the two columns selected together');
    }
    const cause = validateCause(input.cause); // R12 gate at the log boundary too
    const source = this.registry.register(input.viewId, input.actorMeta);
    const clientViewIds = input.clientViewIds ?? [input.viewId];
    const clients = clientViewIds.map((id) =>
      // client sources must be registered too; default self-client is `source`.
      id === input.viewId ? source : this.registry.require(id),
    );

    // ONE copy, used by BOTH doors. The clause the live selection keeps and
    // the record history keeps must not alias the caller's array either: a
    // caller that goes on filling its own array would otherwise be editing
    // the selection that is already standing.
    const value = copyValue(input.value);

    const spec: CauseClauseSpec =
      input.kind === 'cell'
        // `fields!` — the refusal at the top of this method already proved it
        // present; `CommitInput` is one interface rather than a discriminated
        // union, so the compiler cannot carry that proof down here.
        ? { kind: 'cell', source, fields: input.fields!, value: value as never, cause, clients }
        : { kind: input.kind, source, field: input.field, value: value as never, cause, clients };
    const clause = causeClause(spec);

    const data = input.data ?? this.stampData?.();
    const record: CommitRecord = {
      id: input.id,
      parent: input.parent,
      ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
      viewId: input.viewId,
      actorMeta: source.meta,
      kind: input.kind,
      field: input.field,
      // EVERY container on the record is BUILT here, never aliased to the
      // caller's arrays/objects — so freezing the record cannot reach back and
      // freeze something the caller is still filling in. `value` matters most
      // and is easiest to miss: a multi-select hands in the array the UI is
      // holding, and without this copy the caller's own array would be frozen
      // under it the moment the commit landed.
      value,
      ...(input.fields !== undefined && { fields: [input.fields[0], input.fields[1]] as [string, string] }),
      clientViewIds: [...clientViewIds],
      predicateSQL: String(clause.predicate),
      cause,
      ts: input.ts ?? this.#records.length,
      ...(data !== undefined && Object.keys(data).length > 0 && { data: { ...data } }),
    };
    // R8, enforced by construction: once a commit lands, it cannot be edited
    // in place. Only `commit()` ever grows `#records` (always via push, never
    // splice/assign), the array itself is private, and `records` hands out a
    // frozen snapshot of it.
    //
    // The freeze is DEEP, not one level. A one-level `Object.freeze(record)`
    // leaves `record.cause` writable — and the cause is the whole point: the
    // record of WHY. Deep means the cause, the value, the field pair, the
    // client ids, the actor meta and the data versions are all sealed.
    // `deepFreeze` walks plain objects and arrays only, so a `value` that is a
    // class instance is left as it stands (src/detach/README.md says so
    // plainly); every value this library itself commits is plain JSON.
    deepFreeze(record);

    // ── APPLY ────────────────────────────────────────────────────────────────
    // Pure assignment. Nothing between these two lines can fail, so there is no
    // moment at which the record exists and the snapshot still says otherwise.
    this.#records.push(record);
    this.#view = undefined; // the log moved: the next `records` read rebuilds the snapshot

    // ── OUTBOUND (not part of the act) ───────────────────────────────────────
    // Pushing the clause onto the live Selection relays to downstream
    // selections and emits to every listener a host attached — third-party code
    // running after the commit is already history. It must not be able to
    // un-land the commit, and it must not be swallowed either: see
    // {@link onSelectionUpdateFailed}.
    try {
      this.selection.update(clause);
    } catch (error) {
      if (this.onSelectionUpdateFailed === undefined) throw error;
      this.onSelectionUpdateFailed(error, record);
    }
    return { record, clause };
  }
}

/** Serialize a commit log to a portable JSON string. */
export function serializeLog(records: readonly CommitRecord[]): string {
  return JSON.stringify(records);
}

/**
 * The keys a CommitRecord may carry. Anything else is smuggled, and refused.
 *
 * ADDING A FIELD TO {@link CommitRecord} MEANS ADDING IT HERE, and to
 * `recordProblems` (what makes it valid) and `rebuildRecord` (the data-only
 * rebuild). Miss this list and a log written by the new code is refused by the
 * same code reading it back; miss the rebuild and the field is silently
 * dropped on the way in.
 */
const RECORD_KEYS = new Set([
  'id', 'parent', 'correlationId', 'viewId', 'actorMeta', 'kind', 'field',
  'value', 'fields', 'clientViewIds', 'predicateSQL', 'cause', 'ts', 'data',
]);

const RECORD_KINDS = new Set(['point', 'interval', 'cell', 'match']);

/** The result of a non-throwing log parse (mirrors L0 `parseCause`). */
export type CommitLogParseResult =
  | { ok: true; records: CommitRecord[] }
  | { ok: false; problems: string[] };

/**
 * Thrown by `deserializeLog` when a payload is not a well-formed commit log.
 * Carries every problem found with the FIRST bad record, so the message is a
 * sentence a person can act on — never a bare `throw new Error('bad log')`.
 */
export class CommitLogParseError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid commit log: ${problems.join('; ')}`);
    this.name = 'CommitLogParseError';
    this.problems = problems;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Everything wrong with ONE record's shape, in reading order. Empty = well-formed. */
function recordProblems(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainObject(raw)) return ['a commit must be a plain object'];

  for (const key of Object.keys(raw)) {
    if (!RECORD_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) problems.push('id must be a non-empty string');
  if (!('parent' in raw)) problems.push('missing parent (use null for a root commit)');
  else if (raw.parent !== null && (typeof raw.parent !== 'string' || raw.parent.length === 0)) {
    problems.push('parent must be a commit id or null');
  }
  if ('correlationId' in raw && typeof raw.correlationId !== 'string') {
    problems.push('correlationId, if present, must be a string');
  }
  if (typeof raw.viewId !== 'string' || raw.viewId.length === 0) problems.push('viewId must be a non-empty string');

  if (!isPlainObject(raw.actorMeta)) problems.push('actorMeta must be an object');
  else {
    const meta = raw.actorMeta;
    if (!isActor(meta.actor)) problems.push(`actorMeta.actor must be one of ${ACTORS.join('|')}`);
    if ('label' in meta && typeof meta.label !== 'string') problems.push('actorMeta.label, if present, must be a string');
    if ('does' in meta && typeof meta.does !== 'string') problems.push('actorMeta.does, if present, must be a string');
  }

  if (typeof raw.kind !== 'string' || !RECORD_KINDS.has(raw.kind)) {
    problems.push(`kind must be one of ${[...RECORD_KINDS].join('|')}`);
  }
  if (typeof raw.field !== 'string') problems.push('field must be a string');

  // `value` is the ONE field whose absence is not a refusal: JSON has no
  // `undefined`, so a commit whose value was undefined comes back with the key
  // gone. Any type is legal here — the value is inert data, like `intent`.
  const hasFields = 'fields' in raw;
  if (hasFields && !(Array.isArray(raw.fields) && raw.fields.length === 2 && isStringArray(raw.fields))) {
    problems.push('fields, if present, must be exactly two column names');
  }
  if (raw.kind === 'cell' && !hasFields) problems.push('a cell commit needs `fields` — the two columns selected together');

  if (!isStringArray(raw.clientViewIds)) problems.push('clientViewIds must be an array of view ids');
  if (typeof raw.predicateSQL !== 'string') problems.push('predicateSQL must be a string');

  const cause = parseCause(raw.cause);
  if (!cause.ok) problems.push(...cause.problems.map((c) => `cause: ${c}`));

  if (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts)) problems.push('ts must be a finite number');

  if ('data' in raw) {
    const data = raw.data;
    if (!isPlainObject(data) || !Object.values(data).every((v) => typeof v === 'string')) {
      problems.push('data, if present, must map table name to version string');
    }
  }
  return problems;
}

/** Rebuild ONE record data-only, from named fields. Nothing smuggled survives. */
function rebuildRecord(raw: Record<string, unknown>): CommitRecord {
  const record: CommitRecord = {
    id: raw.id as string,
    parent: raw.parent as string | null,
    ...(raw.correlationId !== undefined && { correlationId: raw.correlationId as string }),
    viewId: raw.viewId as string,
    actorMeta: rebuildActorMeta(raw.actorMeta as Record<string, unknown>),
    kind: raw.kind as CommitRecord['kind'],
    field: raw.field as string,
    // copied for the same reason `commit()` copies it: `parseCommitLog` is
    // exported and may be handed live objects, not only `JSON.parse` output
    value: copyValue(raw.value),
    ...('fields' in raw && { fields: [...(raw.fields as string[])] as [string, string] }),
    clientViewIds: [...(raw.clientViewIds as string[])],
    predicateSQL: raw.predicateSQL as string,
    cause: validateCause(raw.cause), // already judged above; this returns the normalized copy
    ts: raw.ts as number,
    ...('data' in raw && { data: { ...(raw.data as Record<string, string>) } }),
  };
  return deepFreeze(record);
}

function rebuildActorMeta(raw: Record<string, unknown>): ActorMeta {
  return {
    actor: raw.actor as ActorMeta['actor'],
    ...(typeof raw.label === 'string' && { label: raw.label }),
    ...(typeof raw.does === 'string' && { does: raw.does }),
  };
}

/**
 * THE DOOR BACK IN. A commit log arriving from outside this process is judged
 * before anything trusts it — the same R12 firewall discipline `parseCause`
 * applies to a cause, applied to a whole log.
 *
 * Five things are checked, in this order, and the first record that fails
 * stops the parse so the sentence names ONE record rather than a wall of text:
 *
 *  1. every record's SHAPE — required fields present and correctly typed,
 *     no key we do not know, and the `cause` validating through the existing
 *     cause validator;
 *  2. no DUPLICATE ids — the parent-pointer chain is only navigable while an
 *     id names one commit;
 *  3. every PARENT present in the log — a dangling parent is a history with a
 *     hole in it, and the fold would silently stop there;
 *  4. no CYCLES — a parent chain must terminate at a root, or every walk of it
 *     loops forever;
 *  5. records are rebuilt DATA-ONLY from named fields and deeply frozen, so
 *     nothing smuggled through JSON (a `__proto__` own key, an extra property,
 *     a getter) survives the door.
 *
 * Never throws; returns the problems. `deserializeLog` is the throwing twin.
 */
export function parseCommitLog(value: unknown): CommitLogParseResult {
  if (!Array.isArray(value)) return { ok: false, problems: ['log must be a JSON array'] };

  const at = (index: number, raw: unknown): string => {
    const id = isPlainObject(raw) && typeof raw.id === 'string' ? `"${raw.id}"` : '(no id)';
    return `commit #${index} ${id}`;
  };

  const records: CommitRecord[] = [];
  const byId = new Map<string, number>();
  for (const [index, raw] of value.entries()) {
    const problems = recordProblems(raw);
    // ONE sentence, naming the record once and then everything wrong with it
    if (problems.length > 0) return { ok: false, problems: [`${at(index, raw)}: ${problems.join('; ')}`] };
    const record = rebuildRecord(raw as Record<string, unknown>);
    const first = byId.get(record.id);
    if (first !== undefined) {
      return { ok: false, problems: [`${at(index, raw)}: duplicate id — commit #${first} already has it`] };
    }
    byId.set(record.id, index);
    records.push(record);
  }

  for (const [index, record] of records.entries()) {
    if (record.parent !== null && !byId.has(record.parent)) {
      return { ok: false, problems: [`${at(index, record)}: parent "${record.parent}" is not in the log`] };
    }
  }

  // Cycle check: walk each record's parent chain to a root. `settled` holds the
  // ids already proven to reach one, so the whole sweep stays linear.
  const settled = new Set<string>();
  for (const [index, record] of records.entries()) {
    const walked = new Set<string>();
    let cursor: CommitRecord | undefined = record;
    while (cursor !== undefined && !settled.has(cursor.id)) {
      if (walked.has(cursor.id)) {
        return { ok: false, problems: [`${at(index, record)}: its parent chain loops back to "${cursor.id}" — a commit cannot be its own ancestor`] };
      }
      walked.add(cursor.id);
      cursor = cursor.parent === null ? undefined : records[byId.get(cursor.parent)!];
    }
    for (const id of walked) settled.add(id);
  }

  return { ok: true, records };
}

/**
 * Parse a serialized log back into records, or throw a `CommitLogParseError`
 * whose message names the first bad record. See {@link parseCommitLog} for
 * what is judged and why.
 */
export function deserializeLog(json: string): CommitRecord[] {
  const result = parseCommitLog(JSON.parse(json));
  if (!result.ok) throw new CommitLogParseError(result.problems);
  return result.records;
}

/**
 * Replay a serialized (or in-memory) log into a FRESH selection + FRESH
 * registry. Every re-emitted commit gets `replayed:true` added to its cause
 * (R2: the two slots are untouched). Returns the rebuilt session; its
 * `records` are the post-replay log.
 *
 * @param log  serialized JSON string OR an array of records
 * @param order optional commit-id path to walk (branch selection). Defaults to
 *              the log's own order (the linear main line).
 */
export function replayLog(
  log: string | readonly CommitRecord[],
  order?: readonly string[],
): CauseSelectionSession {
  const source = typeof log === 'string' ? deserializeLog(log) : log;
  const byId = new Map(source.map((r) => [r.id, r]));
  const path = order ?? source.map((r) => r.id);

  const session = new CauseSelectionSession();
  for (const id of path) {
    const rec = byId.get(id);
    if (!rec) throw new Error(`replay path references unknown commit "${id}"`);
    session.commit({
      id: rec.id,
      parent: rec.parent,
      // Preserve the cross-tier join key verbatim — a replayed commit still
      // answers to the same correlationId (no markReplayed analog: the key
      // is an ADDRESS, not provenance).
      ...(rec.correlationId !== undefined && { correlationId: rec.correlationId }),
      viewId: rec.viewId,
      actorMeta: rec.actorMeta,
      kind: rec.kind,
      field: rec.field,
      value: rec.value,
      // D30: a cell record's authoritative field pair replays verbatim.
      ...(rec.fields !== undefined && { fields: rec.fields }),
      // the data a commit was true of is provenance: it replays verbatim (commit() prefers an explicit `data` over the hook)
      ...(rec.data !== undefined && { data: rec.data }),
      clientViewIds: rec.clientViewIds,
      cause: markReplayed(rec.cause), // R2: additive replay marker
      ts: rec.ts,
    });
  }
  return session;
}

/**
 * A cause histogram over a log: counts of (requestedBy -> computedBy) pairs.
 * Deliberately EXCLUDES the `replayed` flag and `intent`, so it is invariant
 * across a replay (the R2 check). Keys are `"requestedBy>computedBy"`.
 */
export function causeHistogram(records: readonly CommitRecord[]): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const r of records) {
    const key = `${r.cause.requestedBy}>${r.cause.computedBy}`;
    hist[key] = (hist[key] ?? 0) + 1;
  }
  return hist;
}
