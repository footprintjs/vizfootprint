/**
 * DELTA — what changed between two snapshots of one table. With a declared
 * row key the delta is exact: rows added, updated (same key, different
 * bytes), removed. Without a key nothing can be told apart, so the honest
 * answer is "replaced", never a guessed upsert (the research's ruling: no key
 * ⇒ append-only; an upsert or a delete refuses `no-row-key`). Identity is the
 * key's String() form, so 1 and "1" collide: the loser counts as unkeyed.
 */
import type { Row } from '../data/types.js';
import { foldOnce, keyedIndex } from '../data/fold.js';

/** At most this many keys ride in each sample list; the counts are exact. */
export const DELTA_SAMPLE = 20;

export type RefreshDelta =
  | {
      readonly keyed: true;
      readonly key: string;
      readonly added: number;
      readonly updated: number;
      readonly removed: number;
      /** Up to DELTA_SAMPLE keys per list — enough to name, never the whole table. */
      readonly sample: { readonly added: readonly string[]; readonly updated: readonly string[]; readonly removed: readonly string[] };
      /** Rows whose key was missing or repeated, counted, never guessed at. */
      readonly unkeyed: number;
    }
  | {
      readonly keyed: false;
      readonly replaced: number;
      /** The declared key named no column in the new rows (every row was unkeyed): the delta cannot be exact, and says so. */
      readonly keyAbsent?: string;
    };

const same = (a: Row, b: Row): boolean => JSON.stringify(a) === JSON.stringify(b);

export function deltaByKey(before: readonly Row[], after: readonly Row[], key: string | undefined): RefreshDelta {
  if (key === undefined) return { keyed: false, replaced: after.length };
  // one walk per side, the index being the fold's own recorder
  const was = foldOnce(before, { k: keyedIndex(key) }).k;
  const now = foldOnce(after, { k: keyedIndex(key) }).k;
  if (now.map.size === 0 && after.length > 0) return { keyed: false, replaced: after.length, keyAbsent: key };
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  for (const [k, row] of now.map) {
    const prior = was.map.get(k);
    if (prior === undefined) added.push(k);
    else if (!same(prior, row)) updated.push(k);
  }
  for (const k of was.map.keys()) if (!now.map.has(k)) removed.push(k);
  return {
    keyed: true,
    key,
    added: added.length,
    updated: updated.length,
    removed: removed.length,
    sample: { added: added.slice(0, DELTA_SAMPLE), updated: updated.slice(0, DELTA_SAMPLE), removed: removed.slice(0, DELTA_SAMPLE) },
    unkeyed: was.unkeyed + now.unkeyed,
  };
}
