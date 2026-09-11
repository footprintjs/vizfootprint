/**
 * DELTA — what changed between two versions of one table: THE ANSWER A RELAND
 * OWES, whichever engine computed it.
 *
 * With a declared row key the delta is exact: rows added, updated (same key,
 * different bytes), removed. Without a key nothing can be told apart, so the
 * honest answer is "replaced", never a guessed upsert (the research's ruling:
 * no key ⇒ append-only; an upsert or a delete refuses `no-row-key`). Identity is
 * the key's String() form, so 1 and "1" collide: the loser counts as unkeyed.
 *
 * WHY it lives in `data/` and not beside the carriers in `source/`: it is the
 * shape `DataProvider.replaceRows` answers (`types.ts` · `RelandResult`), and
 * the memory engine's strategy IS this function — the folder that owns the port
 * owns the port's answer. `source/` re-exports it, so `vizfootprint/source`
 * still names it. The wasm engine answers the same shape from SQL
 * (`sqlReland.ts`), and `engineInvariant.test.ts` holds the two to one answer.
 */
import type { Row } from './types.js';
import { foldOnce, keyedIndex } from './fold.js';

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

/**
 * Two rows differ when the NEW row's own columns don't all read back the same
 * off the old row — compared PER COLUMN, never by JSON round-tripping the
 * WHOLE row: an object's key ORDER is not a data fact, and `sqlReland.ts`'s
 * `IS DISTINCT FROM` never sees it either (a key-order-shuffled row used to
 * read as "updated" here and "unchanged" in SQL — one answer now,
 * `engineInvariant.test.ts`). A column the new row carries that the old one
 * does not is always a difference — the same "TRUE" rule `sqlReland.ts`'s
 * `differPredicate` gives an added column, judged per ROW here because a
 * plain array has no one fixed column set to judge once. Each shared column
 * still compares by `JSON.stringify` of the CELL (not the row), so a value
 * that changed TYPE (`1` becoming `'1'`) reads as changed — the honest
 * answer, and the one `sqlReland.ts` now gives too (a column whose type moved
 * is never text-cast into looking the same).
 */
const same = (a: Row, b: Row): boolean =>
  Object.keys(b).every((column) => column in a && JSON.stringify(a[column]) === JSON.stringify(b[column]));

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
