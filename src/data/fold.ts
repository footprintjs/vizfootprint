/**
 * ONE PASS, MANY RECORDERS.
 *
 * Every question a table is asked — how many rows, the extent of a column,
 * the distinct values, a keyed index, the column types — is answered by a
 * RECORDER that watches one walk over the rows and collects as it goes. Ask
 * several questions, walk once: `foldOnce(rows, { n: count(), price: extent('price') })`
 * returns `{ n, price }`, typed by the recorders you brought. The law is
 * footprintjs's: collect during traversal, never post-process; a recorder
 * never reads the rows again, and `result()` is pure over what it saw.
 *
 * Bring what you need, like d3's modules: each recorder is a small factory
 * and a fresh instance per fold; the engine, the delta and the analyses are
 * the first customers, so a small table is walked once where it was walked
 * once per question before.
 */
import type { ColumnType, Row } from './types.js';

/** One question over a walk: see every row once, in order, then answer. */
export interface RowRecorder<T> {
  /** Called once per row, in order; `index` is the row's position in the walk. */
  step(row: Row, index: number): void;
  /** The answer, pure over the rows seen; may be read more than once. */
  result(): T;
}

export type Recorders = Readonly<Record<string, RowRecorder<unknown>>>;

/** The answers, keyed as the recorders were (own enumerable string keys), each typed by its recorder. */
export type FoldResult<R extends Recorders> = { readonly [K in keyof R]: R[K] extends RowRecorder<infer T> ? T : never };

/** Walk the rows ONCE, every recorder stepping on every row; then collect every answer. */
export function foldOnce<R extends Recorders>(rows: readonly Row[], recorders: R): FoldResult<R> {
  const entries = Object.entries(recorders); // own enumerable string keys — a symbol or inherited key is not a recorder here
  if (new Set(entries.map(([, r]) => r)).size !== entries.length) {
    throw new TypeError('foldOnce: one recorder instance per key — a shared instance would step twice per row and answer double');
  }
  if (entries.length === 0) return {} as FoldResult<R>;
  const list = entries.map(([, r]) => r);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // a recorder that throws aborts the fold: an answer built on a walk that broke is not an answer (fail fast, unlike an observer)
    for (let j = 0; j < list.length; j++) list[j]!.step(row, i);
  }
  return Object.fromEntries(entries.map(([k, r]) => [k, r.result()])) as FoldResult<R>;
}

/** How many rows the walk saw (every row, not d3's count of defined numbers — hence the name). */
export function rowCount(): RowRecorder<number> {
  let n = 0;
  return { step: () => void n++, result: () => n };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The total of a column's finite numbers, with how many rows carried one and how many did not (not d3's bare `sum` — the skipped rows are part of the answer). */
export function total(field: string): RowRecorder<{ readonly total: number; readonly counted: number; readonly skipped: number }> {
  let acc = 0;
  let counted = 0;
  let skipped = 0;
  return {
    step: (row) => {
      const v = row[field];
      if (finite(v)) {
        acc += v;
        counted++;
      } else skipped++;
    },
    result: () => ({ total: acc, counted, skipped }),
  };
}

/** The least and greatest finite number in a column, or null when it carried none. */
export function extent(field: string): RowRecorder<readonly [number, number] | null> {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let seen = false;
  return {
    step: (row) => {
      const v = row[field];
      if (!finite(v)) return;
      seen = true;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    },
    result: () => (seen ? [lo, hi] : null),
  };
}

/** A column's distinct values in first-seen order, by VALUE identity (SameValueZero: two equal Dates are two values; null and undefined are one absence, listed once as null). */
export function distinct(field: string): RowRecorder<{ readonly values: readonly unknown[]; readonly count: number }> {
  const seen = new Map<unknown, true>();
  return {
    step: (row) => {
      const v = row[field] ?? null;
      if (!seen.has(v)) seen.set(v, true);
    },
    result: () => {
      const values = [...seen.keys()];
      return { values, count: values.length };
    },
  };
}

/** How many rows carry each value of a column, keyed by String(value) (two equal Dates are one key; 1 and "1" are one key), in first-seen order. */
export function groupCount(field: string): RowRecorder<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  return {
    step: (row) => {
      const k = String(row[field]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
    result: () => counts,
  };
}

/**
 * A column as numbers, one per row in walk order (`Number(value)`; a non-number
 * becomes NaN, never dropped — the analyses' input contract) — and
 * `notNumbers`: how many rows' cells were NOT already a finite number before
 * the coercion (null → 0, true → 1, '' → 0 count too), so a null-heavy column
 * is not mistaken for a clean one. A caller passing un-typed numeric strings
 * sees every row counted here; the engine's own rows are typed on the way in.
 */
export function numbers(field: string): RowRecorder<{ readonly values: readonly number[]; readonly notNumbers: number }> {
  const out: number[] = [];
  let notNumbers = 0;
  return {
    step: (row) => {
      const raw = row[field];
      if (!finite(raw)) notNumbers++;
      out.push(Number(raw));
    },
    result: () => ({ values: out, notNumbers }),
  };
}

/** Each named column as an array in walk order — the columnar layout, built in one walk; a name given twice is one column. */
export function columnar(names: readonly string[]): RowRecorder<Readonly<Record<string, readonly unknown[]>>> {
  const cols = [...new Set(names)];
  const columns: Record<string, unknown[]> = Object.fromEntries(cols.map((n) => [n, []]));
  return {
    step: (row) => {
      for (const n of cols) columns[n]!.push(row[n]);
    },
    result: () => columns,
  };
}

/**
 * The ONE rule for a column's type, as a running tally: `number`, `boolean` or
 * `date` when every non-null value seen is one, `unknown` when none was seen,
 * else `string`. The engine's column inference and the fold's recorder both
 * run this, so there is one law in one place.
 */
export class TypeTally {
  private sawAny = false;
  private allNumber = true;
  private allBoolean = true;
  private allDate = true;
  private settled = false; // every flag down: the answer is `string`, nothing more to look at
  see(v: unknown): void {
    if (this.settled || v == null) return;
    this.sawAny = true;
    if (typeof v !== 'number') this.allNumber = false;
    if (typeof v !== 'boolean') this.allBoolean = false;
    if (!(v instanceof Date)) this.allDate = false;
    if (!this.allNumber && !this.allBoolean && !this.allDate) this.settled = true;
  }
  type(): ColumnType {
    if (!this.sawAny) return 'unknown';
    if (this.allNumber) return 'number';
    if (this.allBoolean) return 'boolean';
    if (this.allDate) return 'date';
    return 'string';
  }
}

/**
 * Each column's type over the walk (the TypeTally rule). Names given ⇒ those
 * columns and only those, read straight off each row (no key scan, no lookup
 * per cell; a ragged row's extra key is not a column). No names ⇒ every column
 * is discovered as the walk meets it.
 */
export function columnTypes(names: readonly string[] = []): RowRecorder<Readonly<Record<string, ColumnType>>> {
  const tally = new Map<string, TypeTally>();
  const slot = (name: string): TypeTally => {
    let t = tally.get(name);
    if (t === undefined) {
      t = new TypeTally();
      tally.set(name, t);
    }
    return t;
  };
  const fixed = [...new Set(names)];
  const tallies = fixed.map(slot);
  return {
    step:
      fixed.length > 0
        ? (row) => {
            for (let j = 0; j < fixed.length; j++) tallies[j]!.see(row[fixed[j]!]);
          }
        : (row) => {
            for (const name of Object.keys(row)) slot(name).see(row[name]);
          },
    result: () => Object.fromEntries([...tally.entries()].map(([name, t]) => [name, t.type()])),
  };
}

/** Rows by the String() of a key column, first wins; rows with no key or a repeated key are counted, never guessed at. */
export function keyedIndex(field: string): RowRecorder<{ readonly map: ReadonlyMap<string, Row>; readonly unkeyed: number }> {
  const map = new Map<string, Row>();
  let unkeyed = 0;
  return {
    step: (row) => {
      const k = row[field];
      if (k === undefined || k === null || map.has(String(k))) unkeyed++;
      else map.set(String(k), row);
    },
    result: () => ({ map, unkeyed }),
  };
}
