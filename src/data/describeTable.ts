/**
 * DESCRIBE A TABLE WITHOUT BUILDING ONE.
 *
 * Until this door existed, the only way to learn what a column IS — its type,
 * what it holds, how many different things it holds — was to build a dashboard
 * and ask the provider. That is a strange price for a question that comes
 * BEFORE a dashboard exists: an authoring wizard's first step is "here is a
 * file, tell me what is in it", and it has nothing to declare yet.
 *
 * So this is the raw material for that step, and nothing more. It is pure —
 * no dashboard, no session, no provider — and it composes what is already
 * here rather than adding a second opinion:
 *
 *   - the CSV parser with typing (`parseCSVTyped`) turns text into typed rows;
 *   - the fold's recorders (`columnTypes`, `distinct`, `extent`) answer every
 *     column's question in ONE walk (`foldOnce`), the way the memory engine
 *     builds its store;
 *   - the type is the `TypeTally` rule — the SAME rule the provider runs
 *     (`memoryProvider`'s `inferType`) and the same one the fold's recorder
 *     runs. There is no second sniffer here, so a column described as a number
 *     is a column the built dashboard will also call a number.
 *
 * What a person does with the answer is DECLARE on top of it — `{ type, role,
 * scale, label }`, which is the def's own `ColumnDecl`. Nothing here guesses a
 * role: a description is what the data says, a declaration is what the person
 * says, and this library never lets the first stand in for the second.
 */
import { parseCSVTyped } from './csv.js';
import { columnTypes, distinct, extent, foldOnce, type RowRecorder } from './fold.js';
import type { ColumnType, Row } from './types.js';

/** How many distinct values are reported before the count is capped. */
export const DESCRIBE_DISTINCT_CAP = 1000;
/** How many example values a column's description carries. */
export const DESCRIBE_SAMPLE = 5;

export interface DescribeTableOptions {
  /** How many example values per column. Default {@link DESCRIBE_SAMPLE}. */
  readonly sample?: number;
  /** The highest distinct count reported before `distinctCapped` says so. Default {@link DESCRIBE_DISTINCT_CAP}. */
  readonly distinctCap?: number;
  /** The CSV delimiter, when the input is text. Default `,`. */
  readonly delimiter?: string;
}

/** One column, as the data alone can describe it. */
export interface ColumnDescription {
  readonly name: string;
  /** The `TypeTally` type — `unknown` when the column held nothing but nulls. */
  readonly type: ColumnType;
  /** The first few DISTINCT values, in first-seen order — what the column looks like, not the same value five times. */
  readonly sample: readonly unknown[];
  /** How many distinct values, counting null and undefined together as one absence (the fold's rule). */
  readonly distinct: number;
  /** True when the column held MORE distinct values than `distinct` reports — the count is the cap, not the truth. */
  readonly distinctCapped: boolean;
  /** The least and greatest value — numbers for a `number` column, dates for a `date` one. Absent otherwise, and absent when the column carried none. */
  readonly extent?: readonly [number, number] | readonly [Date, Date];
}

export interface TableDescription {
  readonly rows: number;
  readonly columns: readonly ColumnDescription[];
}

/**
 * The least and greatest DATE in a column, or null when it carried none — the
 * `extent` recorder's twin for the one type it does not read. Local to this
 * door: it answers a description's question, not the data plane's.
 */
function dateExtent(field: string): RowRecorder<readonly [Date, Date] | null> {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let seen = false;
  return {
    step: (row) => {
      const v = row[field];
      if (!(v instanceof Date) || Number.isNaN(v.getTime())) return; // an invalid date is a date that is not one
      const t = v.getTime();
      seen = true;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    },
    result: () => (seen ? [new Date(lo), new Date(hi)] : null),
  };
}

/**
 * The rows and the column names, from either input. CSV gives its HEADER order
 * (including a column every row left empty); rows give the first row's keys —
 * the memory engine's own homogeneous-rows rule, so the description names the
 * columns the built table would have.
 */
function readInput(input: string | readonly Row[], options: DescribeTableOptions): { rows: readonly Row[]; names: readonly string[] } {
  if (typeof input !== 'string') {
    return { rows: input, names: input.length > 0 ? Object.keys(input[0]!) : [] };
  }
  const parsed = parseCSVTyped(input, { delimiter: options.delimiter });
  return { rows: parsed.rows, names: parsed.header };
}

/**
 * Describe a table's columns: the sniffed type, a few example values, how many
 * distinct ones, and the extent where the type has one. One walk over the rows,
 * whatever is asked.
 *
 * ```ts
 * describeTable('disease,cases\nLyme,12\nZika,3\n');
 * // { rows: 2, columns: [
 * //   { name: 'disease', type: 'string', sample: ['Lyme', 'Zika'], distinct: 2, distinctCapped: false },
 * //   { name: 'cases',   type: 'number', sample: [12, 3], distinct: 2, distinctCapped: false, extent: [3, 12] } ] }
 * ```
 */
export function describeTable(input: string | readonly Row[], options: DescribeTableOptions = {}): TableDescription {
  const sampleSize = options.sample ?? DESCRIBE_SAMPLE;
  const cap = options.distinctCap ?? DESCRIBE_DISTINCT_CAP;
  const { rows, names } = readInput(input, options);

  // One walk, every question. The `#` keys cannot collide with a column's own
  // (`d:`/`n:`/`t:` prefix every column key), and every recorder is a fresh
  // instance — `foldOnce` refuses a shared one.
  const recorders: Record<string, RowRecorder<unknown>> = { '#types': columnTypes(names) };
  for (const name of names) {
    recorders[`d:${name}`] = distinct(name);
    recorders[`n:${name}`] = extent(name);
    recorders[`t:${name}`] = dateExtent(name);
  }
  const folded = foldOnce(rows, recorders) as Record<string, unknown>;
  const types = folded['#types'] as Readonly<Record<string, ColumnType>>;

  const columns = names.map((name): ColumnDescription => {
    const seen = folded[`d:${name}`] as { readonly values: readonly unknown[]; readonly count: number };
    // `columnTypes(names)` pre-creates a tally per NAME, so every column asked
    // for is answered — even one every row left empty (`unknown`).
    const type = types[name]!;
    const span = type === 'date' ? (folded[`t:${name}`] as readonly [Date, Date] | null) : type === 'number' ? (folded[`n:${name}`] as readonly [number, number] | null) : null;
    return {
      name,
      type,
      sample: seen.values.slice(0, sampleSize),
      distinct: Math.min(seen.count, cap),
      distinctCapped: seen.count > cap,
      ...(span !== null ? { extent: span } : {}),
    };
  });

  return { rows: rows.length, columns };
}
