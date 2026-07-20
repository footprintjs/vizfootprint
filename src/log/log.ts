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
 *        delete/remove/edit API on the log — enforced by construction: (a)
 *        the only way to add a record is `commit()`, which always appends;
 *        (b) every appended record is frozen, so a caller holding a
 *        reference cannot mutate history in place either.
 *  - R10 first-class `CommitRecord.correlationId` cross-tier join key.
 *  - R13 commit-on-intent — `commit()` is a single synchronous write; the
 *        log has no batching/debounce path a caller could accidentally rely
 *        on (proven out-of-hot-path at bench/x4).
 */

import { Selection } from '@uwdata/mosaic-core';
import type { SelectionClause } from '@uwdata/mosaic-core';
import { markReplayed, validateCause, type Cause } from '../cause/index.js';
import {
  SourceRegistry,
  causeClause,
  type ActorMeta,
  type CauseClauseSpec,
} from '../mosaic/index.js';

/** The serializable commit — one interaction's worth of clause + provenance. */
export interface CommitRecord {
  /** Stable commit id (unique within a log). */
  id: string;
  /** Parent commit id, or null for a root. Enables branching timelines (R8). */
  parent: string | null;
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
  correlationId?: string;
  /** Registry key that resolves to the clause `source` identity on replay. */
  viewId: string;
  /** Serializable actor metadata so a fresh registry can rebuild the source. */
  actorMeta: ActorMeta;
  /** Which clause factory to reconstruct with (`'cell'` = the D30 compound). */
  kind: 'point' | 'interval' | 'cell';
  /**
   * Column / expression the clause filters on. For `kind: 'cell'` this slot
   * carries the DISPLAY-ONLY joint label ("price × category" —
   * `src/data`'s `cellFieldLabel`); the authoritative pair rides `fields`.
   */
  field: string;
  /**
   * The selected value (must be JSON-serializable). For `kind: 'cell'` this
   * is the two-sided pair `[x side, y side]` (each side an interval
   * `[lo, hi]` or a point value), or `null` for a cleared cell.
   */
  value: unknown;
  /** kind:'cell' only — the TWO selected fields, x side then y side (D30). */
  fields?: readonly [string, string];
  /** Registry ids whose sources form the cross-filter self-exclusion set. */
  clientViewIds: string[];
  /** Predicate SQL string — a descriptor for verification / replay determinism. */
  predicateSQL: string;
  /** The two-slot cause (+ `replayed:true` once re-emitted by a replay). */
  cause: Cause;
  /** Authoring timestamp (logical ok; not load-bearing). */
  ts: number;
}

/** Input to author one commit. `cause` is validated before anything is built. */
export interface CommitInput {
  id: string;
  parent: string | null;
  /** Optional cross-tier join key — see {@link CommitRecord.correlationId}. */
  correlationId?: string;
  viewId: string;
  actorMeta: ActorMeta;
  kind: 'point' | 'interval' | 'cell';
  field: string;
  value: unknown;
  /** REQUIRED for kind:'cell' (commit() refuses a cell without its pair); ignored otherwise. */
  fields?: readonly [string, string];
  cause: Cause;
  /** Defaults to [viewId] — a view excludes only its own clause. */
  clientViewIds?: string[];
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
  readonly records: CommitRecord[] = [];

  constructor(selection = Selection.crossfilter(), registry = new SourceRegistry()) {
    this.selection = selection;
    this.registry = registry;
  }

  /**
   * Author one commit: reconstruct source identity from the registry, build the
   * cause-tagged clause, apply it to the selection, and append the record.
   * Returns both the record and the live clause.
   */
  commit(input: CommitInput): { record: CommitRecord; clause: SelectionClause } {
    const cause = validateCause(input.cause); // R12 gate at the log boundary too
    const source = this.registry.register(input.viewId, input.actorMeta);
    const clientViewIds = input.clientViewIds ?? [input.viewId];
    const clients = clientViewIds.map((id) =>
      // client sources must be registered too; default self-client is `source`.
      id === input.viewId ? source : this.registry.require(id),
    );

    let spec: CauseClauseSpec;
    if (input.kind === 'cell') {
      // D30: a cell commit carries its authoritative field PAIR; refusing an
      // absent pair here (not downstream) keeps every replica of the wire
      // (fold, replay, adapter) free to trust `fields` on a cell record.
      if (input.fields === undefined) {
        throw new Error('vizfootprint log: a cell commit needs `fields` — the two columns selected together');
      }
      spec = { kind: 'cell', source, fields: input.fields, value: input.value as never, cause, clients };
    } else {
      spec = { kind: input.kind, source, field: input.field, value: input.value as never, cause, clients };
    }
    const clause = causeClause(spec);
    this.selection.update(clause);

    const record: CommitRecord = {
      id: input.id,
      parent: input.parent,
      ...(input.correlationId !== undefined && { correlationId: input.correlationId }),
      viewId: input.viewId,
      actorMeta: source.meta,
      kind: input.kind,
      field: input.field,
      value: input.value,
      ...(input.fields !== undefined && { fields: input.fields }),
      clientViewIds,
      predicateSQL: String(clause.predicate),
      cause,
      ts: input.ts ?? this.records.length,
    };
    // R8, enforced by construction: once a commit lands, it cannot be edited
    // in place. Only `commit()` ever grows `records` (always via push, never
    // splice/assign); freezing each record additionally blocks a caller
    // holding a reference from rewriting history under the log's feet.
    Object.freeze(record);
    this.records.push(record);
    return { record, clause };
  }
}

/** Serialize a commit log to a portable JSON string. */
export function serializeLog(records: readonly CommitRecord[]): string {
  return JSON.stringify(records);
}

/** Parse a serialized log back into records (a plain structural round-trip). */
export function deserializeLog(json: string): CommitRecord[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('log must be a JSON array');
  return parsed as CommitRecord[];
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
