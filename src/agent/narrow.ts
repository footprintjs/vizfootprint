/**
 * NARROWING AN ANSWER — `of` (the parts I want) and `since` (only what moved),
 * and the one door that puts a delta back together.
 *
 * Two laws govern everything here, and both are the family's:
 *
 *  - **A Lens may omit, but it may not deny.** Every part left out is on
 *    `omitted` with the reason it was left out. Nothing is dropped quietly,
 *    and an absent part is never dressed as an absent FACT.
 *  - **Position narrows attention, never capability.** What is left out stays
 *    reachable: ask again without `of`, or with a `since` this port still
 *    holds. Narrowing is a courtesy to the reader, never a door closing.
 *
 * ── WHY `since` NARROWS AT SUBTREE GRANULARITY ───────────────────────────────
 *
 * `bench/surface`'s churn arm measured it: after ONE rebind, 99.5% of a
 * realistic answer is unchanged at any depth, and only 55% of it is unchanged
 * at TOP-LEVEL KEY granularity — because the handful of moved bytes live
 * inside `views`, and `views` is 42% of the answer. A key-level delta after a
 * rebind therefore saves almost nothing. So the two containers that carry the
 * answer narrow one level further: `views` per view, `links.edges` per edge.
 * Everything else is served per top-level key, because at that shape a
 * key-level delta already saves nearly all of it.
 *
 * ── THE SHAPE OF A NARROWED LIST ─────────────────────────────────────────────
 *
 * A narrowed list is a {@link ListDelta}: the ids in the order the current
 * answer has them, plus only the entries that changed, each whole. The `order`
 * is what makes the overlay exact rather than approximate — it expresses a
 * removal (an id simply not in it), an insertion anywhere (not only an append)
 * and a reorder, none of which a bare "here are the changed ones" list can
 * say. It also lets a reader who never held part of the list SEE that they did
 * not: the ids are all named, so a gap is visible rather than invisible.
 *
 * When every entry changed, the list is served WHOLE instead — a delta that
 * repeats the entire list plus its ids is bigger than the thing it replaces,
 * and there is nothing honest to be gained by it.
 */

/**
 * The three reasons a reader did not get something. `not-asked` and
 * `unchanged-since` name a PART that was left out; `not-held` names a DELTA
 * that could not be computed, and rides on {@link SinceDisclosure} instead —
 * one vocabulary, because they answer one question.
 */
export type OmissionReason = 'not-asked' | 'unchanged-since' | 'not-held';

/** One part this answer left out, and why. Never a silence. */
export interface Omission {
  readonly part: string;
  readonly reason: Exclude<OmissionReason, 'not-held'>;
}

/**
 * What became of a `since` the reader asked for. `delta` — the answer carries
 * only what moved. `full` — this port could not prove a delta from that
 * position, so the answer is complete and says why, rather than guessing one.
 */
export type SinceDisclosure =
  | { readonly requested: string; readonly served: 'delta' }
  | { readonly requested: string; readonly served: 'full'; readonly reason: Extract<OmissionReason, 'not-held'>; readonly detail: string };

/** A list served as an overlay — see "the shape of a narrowed list" in the file header. */
export interface ListDelta {
  /** The discriminant. A reader (and {@link applySurfaceDelta}) branches on this, never on a key name. */
  readonly delta: 'by-id';
  /** Which field identifies an entry — `viewId` for views, `id` for link edges. */
  readonly by: string;
  /** Every entry's id, in the order the CURRENT answer has them. An overlay emits exactly this. */
  readonly order: readonly string[];
  /** Only the entries that changed or are new, each whole. */
  readonly changed: readonly unknown[];
}

/** What {@link applySurfaceDelta} answers: the rebuilt answer, or one sentence saying why it could not be rebuilt. */
export type ApplyResult =
  | { readonly ok: true; readonly answer: Record<string, unknown> }
  | { readonly ok: false; readonly detail: string };

/**
 * The answer's ENVELOPE: never a part, never omitted, never overlaid. `ok` is
 * what a reader branches on and `basis` is what it compares against, so both
 * ride whole on every answer; `omitted` and `since` describe THIS answer's own
 * narrowing and are meaningless once it has been applied to another.
 */
export const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['ok', 'basis', 'omitted', 'since']);

/** The two containers that narrow one level further, and the field that identifies an entry in each. */
const NARROWED_LISTS: Readonly<Record<string, string>> = { views: 'viewId' };
/** Inside `links`, the one sub-key that carries the graph (95%+ of it at every measured shape). */
const LINK_EDGES = 'edges';

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const bytes = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** Is this value a {@link ListDelta}? The discriminant plus the two fields an overlay cannot work without. */
export function isListDelta(v: unknown): v is ListDelta {
  return isPlainObject(v) && v['delta'] === 'by-id' && typeof v['by'] === 'string' && Array.isArray(v['order']) && Array.isArray(v['changed']);
}

/**
 * Narrow one list, or hand it back whole when every entry moved (see the file
 * header). `previous` is the list the reader holds; `current` is what the
 * answer says now.
 */
function listDelta(previous: readonly unknown[], current: readonly unknown[], by: string): ListDelta | readonly unknown[] {
  const held = new Map<string, string>();
  for (const entry of previous) if (isPlainObject(entry) && typeof entry[by] === 'string') held.set(entry[by] as string, bytes(entry));
  const changed = current.filter((entry) => !isPlainObject(entry) || held.get(String(entry[by])) !== bytes(entry));
  if (changed.length === current.length) return current;
  return { delta: 'by-id', by, order: current.map((entry) => String((entry as Record<string, unknown>)[by])), changed };
}

/**
 * The value a delta carries for one part: narrowed where the bench said key
 * granularity is useless, whole everywhere else. `previous` is the value in
 * the FULL answer this port served at the requested position.
 */
function narrowValue(part: string, previous: unknown, current: unknown): unknown {
  const by = NARROWED_LISTS[part];
  if (by !== undefined && Array.isArray(previous) && Array.isArray(current)) return listDelta(previous, current, by);
  if (part === 'links' && isPlainObject(previous) && isPlainObject(current) && Array.isArray(previous[LINK_EDGES]) && Array.isArray(current[LINK_EDGES])) {
    // the graph's other two keys (`default`, `views`) are small and are served whole; the edges are the graph
    return { ...current, [LINK_EDGES]: listDelta(previous[LINK_EDGES] as unknown[], current[LINK_EDGES] as unknown[], 'id') };
  }
  return current;
}

/**
 * Serve `current` narrowed to `wanted` (when `of` was given) and to what moved
 * since `previous` (when a `since` was held). Returns the parts to carry and
 * every part left out with its reason, in the answer's own key order.
 *
 * The two compose, and `not-asked` wins: a part the reader did not ask for is
 * left out because they said so, whether or not it also moved.
 */
export function narrowParts(
  current: Record<string, unknown>,
  opts: { readonly wanted?: ReadonlySet<string>; readonly previous?: Record<string, unknown> },
): { readonly parts: Record<string, unknown>; readonly omitted: readonly Omission[] } {
  const parts: Record<string, unknown> = {};
  const omitted: Omission[] = [];
  for (const [key, value] of Object.entries(current)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    if (opts.wanted !== undefined && !opts.wanted.has(key)) {
      omitted.push({ part: key, reason: 'not-asked' });
      continue;
    }
    if (opts.previous !== undefined) {
      if (bytes(opts.previous[key]) === bytes(value)) {
        omitted.push({ part: key, reason: 'unchanged-since' });
        continue;
      }
      parts[key] = narrowValue(key, opts.previous[key], value);
      continue;
    }
    parts[key] = value;
  }
  return { parts, omitted };
}

/** Overlay one narrowed list onto the list a reader holds. Every problem is a sentence, never a throw. */
function overlay(previous: unknown, delta: ListDelta, problems: string[], path: string): unknown[] {
  const held = new Map<string, unknown>();
  if (Array.isArray(previous)) {
    for (const entry of previous) if (isPlainObject(entry) && typeof entry[delta.by] === 'string') held.set(entry[delta.by] as string, entry);
  }
  for (const entry of delta.changed) if (isPlainObject(entry) && typeof entry[delta.by] === 'string') held.set(entry[delta.by] as string, entry);
  const out: unknown[] = [];
  for (const id of delta.order) {
    const entry = held.get(id);
    if (entry === undefined) {
      problems.push(`${path}: the answer you are applying this to holds no ${delta.by} "${id}", and the delta does not carry it — ask again without \`since\``);
      continue;
    }
    out.push(entry);
  }
  return out;
}

/** Apply one value of a delta over the value a reader holds: overlay a {@link ListDelta}, walk into an object, replace anything else. */
function applyValue(previous: unknown, next: unknown, problems: string[], path: string): unknown {
  if (isListDelta(next)) return overlay(previous, next, problems, path);
  if (isPlainObject(next)) {
    const held = isPlainObject(previous) ? previous : {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) out[key] = applyValue(held[key], value, problems, `${path}.${key}`);
    return out;
  }
  return next;
}

/**
 * THE DOOR — the previous full answer, with a `since` answer applied over it,
 * is the current full answer.
 *
 * That sentence is the law, and it is pinned byte for byte over the twelve-act
 * walk in `sinceConformance.test.ts`. A delta that cannot be proven equal to
 * the answer it stands for is a lie, and this is the function that lets anyone
 * check rather than trust.
 *
 * It exists as a door rather than as a helper inside that test because a test
 * standing in for a door is a door that is missing (`src/session/README.md`,
 * law 6): a reader who is handed a delta needs to put it back together, and
 * the rule for doing that must be the library's, not each reader's own.
 *
 * `omitted` and `since` are never copied onto the result — they describe the
 * delta, not the answer — so what comes back is a full answer, ready to be the
 * `previous` of the next one.
 */
export function applySurfaceDelta(previous: Record<string, unknown>, delta: Record<string, unknown>): ApplyResult {
  const problems: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(previous)) {
    if (key === 'omitted' || key === 'since') continue;
    out[key] = key in delta ? applyValue(held, delta[key], problems, key) : held;
  }
  for (const [key, value] of Object.entries(delta)) {
    if (key in out || key === 'omitted' || key === 'since') continue;
    out[key] = applyValue(undefined, value, problems, key);
  }
  if (problems.length > 0) return { ok: false, detail: problems.join('; ') };
  return { ok: true, answer: out };
}
