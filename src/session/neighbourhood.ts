/**
 * THE EGO WALK — ONE HOP OUT FROM A SEED, OVER THE ROWS THAT ARE THERE NOW.
 *
 * The law it follows: a read at a cursor answers about THAT cursor. The walk
 * runs ONCE, when the act lands, over the edge rows the session hands it (read
 * at the cursor, under the live clauses, with derived columns resolved) — and
 * the answer is recorded with its question, because the rows may change and a
 * set nobody can re-walk is a number without a question (`../data/types.ts`,
 * `NeighbourhoodValueBody`).
 *
 * Pure and total: rows in, ids out, nothing asked and nothing thrown. First
 * customers: the session's `doNeighbourhoodProbe` (live), and the same door on
 * a saved picture's re-ask (`wire.ts`'s `selectionAction`).
 */
import type { Row } from '../data/index.js';

/**
 * The seed plus every node an edge joins it to, one hop out — the seed FIRST,
 * then the others in row order, each once.
 *
 * ```ts
 * egoIds([{ source: 'Zika', target: 'Lyme' }], ['source', 'target'], 'Zika'); // → ['Zika', 'Lyme']
 * ```
 */
export function egoIds(rows: readonly Row[], fields: readonly [string, string], seed: unknown): unknown[] {
  const ids: unknown[] = [seed]; // a node is in its own neighbourhood, whether or not any edge names it
  const seen = new Set<unknown>([seed]);
  for (const row of rows) {
    const ends = [row[fields[0]], row[fields[1]]];
    if (ends[0] !== seed && ends[1] !== seed) continue; // the edge does not touch the seed
    for (const end of ends) {
      // WHY: an endpoint with no value names no node — an edge missing an end is not a tie to null,
      // and an id set carrying one would select every row whose endpoint is also missing
      if (end === null || end === undefined) continue;
      if (seen.has(end)) continue;
      seen.add(end);
      ids.push(end);
    }
  }
  return ids;
}
