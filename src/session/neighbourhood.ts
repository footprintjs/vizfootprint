/**
 * THE WALKS — ONE ADJACENCY MAP, THREE ANSWERS, OVER THE ROWS THAT ARE THERE NOW.
 *
 * THE ONE WALK LAW (R1): every derivation here is UNDIRECTED — either end
 * joins, because the mark has no arrowhead, the degree folds in and out into
 * one number and the layout read an undirected graph. A DIRECTED walk (follow
 * `source → target` only) is a later dial and is deliberately not offered; it
 * would answer a different question with the same words, which is the one thing
 * a recorded question may never do. See `README.md`, "One gesture on a node".
 *
 * The law they all follow: a read at a cursor answers about THAT cursor. The
 * walk runs ONCE, when the act lands, over the edge rows the session hands it
 * (read at the cursor, under the other views' judgeable clauses, with derived
 * columns resolved) — and the answer is recorded WITH its question, because the
 * rows may change and a set nobody can re-walk is a number without a question
 * (`../data/types.ts`, `NeighbourhoodValueBody`).
 *
 * Pure and total: rows in, ids out, nothing asked and nothing thrown. Every
 * walk reads the SAME adjacency map ({@link adjacencyOf}), built in one pass in
 * row order, so "then row order" means the same thing in all three answers.
 * First customers: the session's `doNeighbourhoodProbe` (live), and the same
 * door on a saved picture's re-ask (`wire.ts`'s `selectionAction`) — which is
 * why the CEILING lives at the door and not in the session: a re-ask hits the
 * same refusal the first ask did.
 */
import type { NeighbourhoodDerivation, NeighbourhoodValueBody, Row } from '../data/index.js';
import type { WalkAsk } from './types.js';

/**
 * How many ids ONE walk may record.
 *
 * A POLICY, not a measurement: the ids land IN the commit value, and that value
 * rides every replay, every wire projection and every saved picture — so a walk
 * that swallows a whole graph makes a trace nobody can carry. Ten thousand is
 * the size at which the record stops being a record of a gesture. A walk past
 * it is REFUSED with the count and a remedy, and NOTHING lands.
 */
export const NEIGHBOURHOOD_ID_CEILING = 10_000;

/** The two hops an `'ego'` walk may be asked for — a POLICY (see {@link walkRefusal}), not a limit of the walk. */
const MAX_EGO_HOPS = 2;

/** The derivations THIS build mints, as data — the one list the refusal sentence and the door both read. */
const DERIVATIONS: readonly NeighbourhoodDerivation[] = ['ego', 'path', 'component'];

/**
 * A walk as ASKED: the seed, and (from the act's own `walk`, {@link WalkAsk} —
 * ONE owner of those three slots) which walk to run from it. Every slot but the
 * seed is optional, and absent means `{ derivation: 'ego', hops: 1 }` — the one
 * walk that existed before the other two, so every caller written against it
 * keeps its bytes (`neighbourhoodSelect.test.ts` is the proof).
 */
export interface WalkQuestion extends WalkAsk {
  /** The node the walk starts from. */
  readonly seed: unknown;
}

/** What the door answers: a recorded body, or a sentence naming what it refused and what to do instead. */
export type WalkOutcome = { readonly ok: true; readonly body: NeighbourhoodValueBody } | { readonly ok: false; readonly rejected: string };

/** A count with thousands separators, locale-independent: a refusal's words are a RECORD, and a record may not read differently on another machine. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The article a derivation's own name takes — "ego" is the one that starts with a vowel, and a refusal a person reads has to read as English. */
function article(derivation: string): string {
  return derivation === 'ego' ? 'an' : 'a';
}

/** One value as the refusal sentences quote it — a string in quotes, everything else bare. */
function quoted(v: unknown): string {
  return typeof v === 'string' ? `"${v}"` : String(v);
}

/**
 * Is this question ASKABLE? A sentence when it is not, `null` when it is.
 *
 * ONE owner of the legality laws (R3) — which walks exist, that `hops` belongs
 * to an ego walk and stops at two, that `to` belongs to a path and only to a
 * path — read TWICE by design: the session calls it at its validate step,
 * before it asks an engine for a single row (a refusal that needs no read
 * should not make one), and {@link walkNeighbourhood} calls it at the door, so
 * a caller that came another way — a saved picture's re-ask, a body another
 * build wrote — meets the same law and the same words.
 *
 * ```ts
 * walkRefusal({ seed: 'flu', derivation: 'path' });            // → 'select.walk.to is missing — a "path" walk runs from the seed TO a node …'
 * walkRefusal({ seed: 'flu', derivation: 'ego', hops: 2 });    // → null
 * ```
 */
export function walkRefusal(question: WalkQuestion): string | null {
  const derivation = question.derivation ?? 'ego';
  if (!DERIVATIONS.includes(derivation)) {
    return `select.walk.derivation must be one of ${DERIVATIONS.map((d) => `"${d}"`).join(', ')} — "${String(derivation)}" is not a walk this build knows how to run`;
  }
  if (question.hops !== undefined) {
    // WHY hops is EGO-only: for a path and a component the hop count is what the walk ANSWERS
    // (the path's length; the farthest node's distance), and a question that also asserted it
    // could disagree with its own answer.
    if (derivation !== 'ego') {
      return `select.walk.hops is only asked of an "ego" walk — ${article(derivation)} "${derivation}" walk answers its own distance, so it cannot also be told one`;
    }
    if (question.hops !== 1 && question.hops !== MAX_EGO_HOPS) {
      // a POLICY, and named as one: past two hops an ego set is most of any real graph, so the
      // gesture stops being about a node — the walk itself would run just as happily at six
      return `select.walk.hops must be 1 or ${MAX_EGO_HOPS} — past two hops an ego set is most of any real graph (a policy of this build, not a limit of the walk); for everything the seed can reach, ask for the "component"`;
    }
  }
  // WHY `null`/`undefined` count as MISSING rather than as a node: an endpoint with no value
  // names no node (the law the adjacency map keeps below), `undefined` does not survive JSON,
  // and `null` is this vocabulary's one spelling of CLEARED — so neither can be a far end.
  const named = question.to !== undefined && question.to !== null;
  if (derivation === 'path' && !named) {
    return 'select.walk.to is missing — a "path" walk runs from the seed TO a node, and the node it runs to is named, never guessed';
  }
  if (derivation !== 'path' && named) {
    return `select.walk.to is only asked of a "path" walk — ${article(derivation)} "${derivation}" walk has no far end to name`;
  }
  return null;
}

/**
 * THE ADJACENCY MAP — one pass over the rows, both directions, each tie once.
 *
 * Insertion order IS row order: a node's neighbours arrive in the order the
 * rows that name them do, and the map's own keys in the order the rows first
 * name them. Every walk below reads the map and nothing else, which is why
 * "then row order" is one rule with one implementation rather than three that
 * agree today.
 *
 * An endpoint with no value names no node — an edge missing an end is not a tie
 * to null, and an id set carrying one would select every row whose endpoint is
 * also missing. `null` and `undefined` are the ONLY two ends read that way:
 * `0`, `''` and `false` are values a key column really holds, so they are nodes
 * like any other (a node id is compared, never tested for truth).
 */
function adjacencyOf(rows: readonly Row[], fields: readonly [string, string]): Map<unknown, unknown[]> {
  const adjacency = new Map<unknown, unknown[]>();
  const join = (from: unknown, to: unknown): void => {
    const nears = adjacency.get(from);
    if (nears === undefined) adjacency.set(from, [to]);
    else if (!nears.includes(to)) nears.push(to); // a second row naming the same tie is the same tie
  };
  for (const row of rows) {
    const a = row[fields[0]];
    const b = row[fields[1]];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    join(a, b);
    join(b, a); // UNDIRECTED (R1): either end joins
  }
  return adjacency;
}

/**
 * ARE THESE THE SAME NODE? The adjacency map's OWN law, said once and read by
 * every walk: SameValueZero — `===`, plus `NaN` being the same node as `NaN`,
 * which is exactly how a `Map` key and a `Set` member already behave. A walk
 * that compared ends any other way would disagree with the map it walks: it
 * would hold a node it could never path to, and `walkBack` below would never
 * reach a seed it can see.
 *
 * It is not LOOSE equality: a number `1` and a string `"1"` are two nodes here,
 * and stay two nodes in the predicate the walk lands (`../data/predicate.ts`
 * compares the recorded ids the same way), so a key column that mixes types
 * answers about the values it really holds.
 */
function sameNode(a: unknown, b: unknown): boolean {
  return a === b || Object.is(a, b); // `===` settles 0/-0 (one node), `Object.is` settles NaN
}

/** The neighbours of one node, in row order — a node the rows never name has none. */
function nearsOf(adjacency: Map<unknown, unknown[]>, id: unknown): readonly unknown[] {
  return adjacency.get(id) ?? [];
}

/**
 * THE EGO WALK: the seed, then every node within `hops` edges of it — the seed
 * FIRST, then by distance, then row order, each once.
 *
 * `hops` is the distance ASKED (1 or 2), and it is what the record carries: a
 * one-hop walk on a graph two hops wide still asked one hop, and the answer is
 * the ids beside it.
 *
 * ```ts
 * egoIds([{ source: 'Zika', target: 'Lyme' }], ['source', 'target'], 'Zika'); // → ['Zika', 'Lyme']
 * ```
 */
export function egoIds(rows: readonly Row[], fields: readonly [string, string], seed: unknown, hops = 1): unknown[] {
  return reachedFrom(adjacencyOf(rows, fields), seed, hops).ids;
}

/**
 * THE COMPONENT WALK: everything the seed can reach, however far — the seed
 * first, then by distance, then row order — with `hops` = the FARTHEST node's
 * distance from the seed (0 for a node no edge names: itself, and nothing else).
 *
 * ```ts
 * componentIds([{ a: 1, b: 2 }, { a: 2, b: 3 }], ['a', 'b'], 1); // → { ids: [1, 2, 3], hops: 2 }
 * ```
 */
export function componentIds(rows: readonly Row[], fields: readonly [string, string], seed: unknown): { readonly ids: unknown[]; readonly hops: number } {
  return reachedFrom(adjacencyOf(rows, fields), seed, Number.POSITIVE_INFINITY);
}

/**
 * The BFS both the ego and the component walk are: `limit` hops out (`Infinity`
 * for a component), seed first, then by distance, then row order.
 *
 * `hops` is the distance of the FARTHEST node it reached — which the component
 * walk records as its answer, and the ego walk throws away in favour of the
 * distance it was ASKED for.
 */
function reachedFrom(adjacency: Map<unknown, unknown[]>, seed: unknown, limit: number): { ids: unknown[]; hops: number } {
  const ids: unknown[] = [seed]; // a node is in its own neighbourhood, whether or not any edge names it
  const seen = new Set<unknown>([seed]);
  let frontier: unknown[] = [seed];
  let distance = 0;
  while (frontier.length > 0 && distance < limit) {
    const next: unknown[] = [];
    for (const id of frontier) {
      for (const near of nearsOf(adjacency, id)) {
        if (seen.has(near)) continue;
        seen.add(near);
        ids.push(near);
        next.push(near);
      }
    }
    if (next.length === 0) break; // nothing new at this distance: the walk is finished, whatever the limit said
    frontier = next;
    distance += 1;
  }
  return { ids, hops: distance };
}

/**
 * THE PATH WALK: the nodes IN ORDER from the seed to `to`, and `hops` = the
 * path's length in EDGES.
 *
 * A shortest path (BFS), and TIES ARE BROKEN BY ROW ORDER: the first row that
 * reached a node is the one that keeps it, so two paths of equal length always
 * resolve to the same one and the answer is deterministic — a recorded question
 * that re-walks to a different set of the same size would be worse than no
 * record at all.
 *
 * NO PATH is an answer, not a failure: `{ ids: [seed, to], hops: null }`. The
 * predicate then selects those two nodes and no tie between them, which is the
 * honest picture of "these two, and nothing joining them".
 *
 * ```ts
 * pathIds([{ a: 1, b: 2 }, { a: 2, b: 3 }], ['a', 'b'], 1, 3); // → { ids: [1, 2, 3], hops: 2 }
 * ```
 */
export function pathIds(
  rows: readonly Row[],
  fields: readonly [string, string],
  seed: unknown,
  to: unknown,
): { readonly ids: unknown[]; readonly hops: number | null } {
  if (sameNode(seed, to)) return { ids: [seed], hops: 0 }; // the trivial path: one node, no edge
  const adjacency = adjacencyOf(rows, fields);
  const cameFrom = new Map<unknown, unknown>();
  const seen = new Set<unknown>([seed]);
  let frontier: unknown[] = [seed];
  while (frontier.length > 0) {
    const next: unknown[] = [];
    for (const id of frontier) {
      for (const near of nearsOf(adjacency, id)) {
        if (seen.has(near)) continue; // FIRST reach wins — the tie-break is row order, by construction
        seen.add(near);
        cameFrom.set(near, id);
        if (sameNode(near, to)) {
          const ids = walkBack(cameFrom, seed, to);
          return { ids, hops: ids.length - 1 }; // the length in EDGES = one less than its nodes
        }
        next.push(near);
      }
    }
    frontier = next;
  }
  // NO PATH: the two nodes the question named, and the honest `null` where a length would go
  return { ids: [seed, to], hops: null };
}

/**
 * The path itself, read back off the parents — seed first, `to` last.
 *
 * It terminates by construction: every node in `cameFrom` was reached from a
 * strictly earlier ring and only the seed has no parent, so the chain is
 * finite — as long as "is this the seed?" is asked with the map's own law
 * ({@link sameNode}), which is why it is asked with that and not with `===`.
 */
function walkBack(cameFrom: Map<unknown, unknown>, seed: unknown, to: unknown): unknown[] {
  const back: unknown[] = [to];
  let at = to;
  while (!sameNode(at, seed)) {
    at = cameFrom.get(at);
    back.push(at);
  }
  return back.reverse();
}

/** The words a refusal uses for the walk it refused — the derivation, and the node it started from. */
function walkPhrase(question: WalkQuestion, hops: number): string {
  const derivation = question.derivation ?? 'ego';
  if (derivation === 'component') return `the component of ${quoted(question.seed)}`;
  if (derivation === 'path') return `the path from ${quoted(question.seed)} to ${quoted(question.to)}`;
  return `the ${hops}-hop neighbourhood of ${quoted(question.seed)}`;
}

/**
 * THE ONE DOOR every walk goes through — the session's live act and a saved
 * picture's re-ask alike.
 *
 * It answers a recorded {@link NeighbourhoodValueBody} (the question and its
 * answer, in the key order the ego walk has always written: an `'ego'` body is
 * byte-identical to the one this file minted before the other two walks
 * existed), or a REFUSAL: an unaskable question ({@link walkRefusal}), or an
 * answer past the {@link NEIGHBOURHOOD_ID_CEILING}. Nothing lands on a refusal
 * — the caller files the sentence and the trace stays a record of what happened.
 *
 * ```ts
 * walkNeighbourhood(rows, ['source', 'target'], { seed: 'flu' });
 * // → { ok: true, body: { seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] } }
 * walkNeighbourhood(rows, ['source', 'target'], { seed: 'flu', derivation: 'path', to: 'strep' });
 * // → { ok: true, body: { seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] } }
 * ```
 */
export function walkNeighbourhood(rows: readonly Row[], fields: readonly [string, string], question: WalkQuestion): WalkOutcome {
  const refusal = walkRefusal(question);
  if (refusal !== null) return { ok: false, rejected: refusal };
  const derivation = question.derivation ?? 'ego';
  const asked = question.hops ?? 1;
  const walked =
    derivation === 'path'
      ? pathIds(rows, fields, question.seed, question.to)
      : derivation === 'component'
        ? componentIds(rows, fields, question.seed)
        : { ids: egoIds(rows, fields, question.seed, asked), hops: asked }; // ego records the distance ASKED, not the one it found
  // WHY the ceiling judges the ANSWER and not the graph: the refusal has to name the COUNT
  // ("the component of X holds 24,113 nodes"), and a reader can only act on a number that is true.
  // WHY walking a huge one first is affordable: the rows are already read and the adjacency map is
  // already built over ALL of them, so the walk costs no more than the read that had to precede it.
  if (walked.ids.length > NEIGHBOURHOOD_ID_CEILING) {
    return {
      ok: false,
      rejected: `${walkPhrase(question, asked)} holds ${grouped(walked.ids.length)} nodes, past the ${grouped(NEIGHBOURHOOD_ID_CEILING)} one commit records — filter the edges first, or select by a column instead`,
    };
  }
  return {
    ok: true,
    // the key order the ego body has always had, with `to` beside the question it belongs to
    body: {
      seed: question.seed,
      derivation,
      hops: walked.hops,
      ...(derivation === 'path' ? { to: question.to } : {}),
      ids: walked.ids,
    },
  };
}
