/**
 * GROWING — holding a source that declared `arrival: 'growing'` to what it
 * declared.
 *
 * The declaration says one thing: **a partial reading of this source is an
 * answer over a PREFIX**, so a number over it states the extent it was computed
 * over and a commit records the extent it was true of (`../log/log.ts` ·
 * `CommitRecord.extents`). That claim is only true while every re-reading
 * EXTENDS the one already landed — same rows, same order, more of them. The
 * moment a row is removed, changed, or arrives ahead of one that landed before
 * it, "the first N rows" stops naming what the commit meant, and every number
 * read behind the cursor becomes a quiet lie.
 *
 * So the declaration is FALSIFIED rather than trusted — the same answer
 * `../source/fold/conformance.ts` gives a monotone fold's claim: the library
 * cannot check that a source will only ever add, so it checks that this reading
 * did, and refuses `not-growing` by name when it did not
 * (`./buildDashboard.ts`, the refresh door). Nothing moves: the rows in place
 * stay exactly where they are, which is the same shape guard 2 already gives
 * bytes that are not the declared table.
 *
 * WHAT IS HELD BETWEEN READINGS, and why it is not the rows. One
 * {@link LandedPrefix} per landed row — a key and a digest, a string and a
 * string — so the check costs no second copy of the table and asks no engine to
 * hand its rows back. The key is only there so a refusal can NAME the row; the
 * digest is what decides.
 */
import { fnv1a } from '../source/hash.js';
import type { Row } from '../data/types.js';

/** One landed row, as the next reading will be judged against it: what it is called, and what it was. */
export interface LandedPrefix {
  /** The declared key column's value in `String()` form — the same identity `../data/delta.ts` · `keyedIndex` gives a row. */
  readonly key: string;
  /** A digest of the whole row, column-order independent (see {@link digestOf}). */
  readonly digest: string;
}

/**
 * A row's digest — every column and every value, in a fixed column order.
 *
 * COLUMN ORDER IS NOT A DATA FACT (`../data/delta.ts` says so, and both engines
 * agree), so the columns are sorted before they are folded: a reading that
 * hands back the same rows with their keys in another order has not changed
 * anything and must not read as a change.
 *
 * ONE DIVERGENCE FROM `deltaByKey`'s `same`, and it is deliberate: that
 * comparison asks only whether the NEW row's own columns read back off the old
 * one, so a column the new reading DROPPED is not a difference there. Here it
 * is. A prefix has to be the rows that were already landed — not a narrower
 * projection of them — or a number read over the prefix is read over columns
 * the commit never saw.
 */
export function digestOf(row: Row): string {
  return fnv1a(
    Object.keys(row)
      .sort()
      // String(): `JSON.stringify(undefined)` is not a string, and a column whose value is
      // undefined is still a column — spelled, never dropped into a shorter digest
      .map((column) => `${column}${String(JSON.stringify(row[column]))}`)
      .join(''),
  );
}

/** What a reading leaves behind for the next one to be judged against. */
export function prefixOf(rows: readonly Row[], key: string): readonly LandedPrefix[] {
  return rows.map((row) => ({ key: String(row[key]), digest: digestOf(row) }));
}

/**
 * Did this reading EXTEND the one already landed? `undefined` when it did — and
 * one sentence naming exactly what it did instead when it did not.
 *
 * THREE SENTENCES, because there are three ways a reading can fail the claim and
 * a reader deserves to know which: rows went away, a row that stayed is not the
 * row that landed, or the rows that landed are no longer where they were. The
 * first row that disagrees is the one named — a list of every disagreement would
 * be a diff, and this is a refusal.
 */
export function notGrowing(table: string, held: readonly LandedPrefix[], arrived: readonly LandedPrefix[]): string | undefined {
  const where = `data["${table}"] declares arrival "growing"`;
  if (arrived.length < held.length) {
    return `${where}, so a re-reading only ever adds rows — this one holds ${arrived.length} where ${held.length} had landed, so ${held.length - arrived.length} were removed`;
  }
  const present = new Set(arrived.map((row) => row.key));
  for (let i = 0; i < held.length; i++) {
    const was = held[i]!;
    const now = arrived[i]!;
    if (now.digest === was.digest) continue;
    if (now.key === was.key) {
      return `${where}, so a row already landed never changes — row "${was.key}" (position ${i}) came back different`;
    }
    if (!present.has(was.key)) {
      return `${where}, so a re-reading only ever adds rows — row "${was.key}" (position ${i}) was removed`;
    }
    return `${where}, so a re-reading only ever APPENDS — row "${was.key}" landed at position ${i} and this reading puts "${now.key}" there, so the rows already landed are no longer the first ${held.length}`;
  }
  return undefined;
}
