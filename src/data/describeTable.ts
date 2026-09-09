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
 * scale, label }`, which is the def's own `ColumnDecl`. A description is what
 * the data says, a declaration is what the person says, and this library never
 * lets the first stand in for the second — with ONE exception, said out loud:
 * when `absence` is given and `values` is not, the contradiction check below
 * assumes every number column is a value. A description door holds no
 * declaration to read, and a loud guess a person corrects by naming `values`
 * beats a silent miss.
 *
 * One thing it will REFUSE, given the one declaration a person may already
 * hold — the absence vocabulary: a table whose absence column says a row
 * reported nothing while a value column of that row holds a number is a table
 * that contradicts itself (`./absenceContradiction.ts`). The description still
 * says what is there; `refused` carries the sentence.
 */
import { absenceContradictionOf } from './absenceContradiction.js';
import { parseCSVTyped } from './csv.js';
import { columnTypes, extent, foldOnce, type RowRecorder } from './fold.js';
import type { ColumnType, Row } from './types.js';
import type { AbsenceDecl } from '../def/types.js';

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
  /**
   * The table's declared absence vocabulary, when the person already holds
   * one. With it the description judges the table against its own word: a
   * silent row whose value column holds a number is refused (`refused`).
   */
  readonly absence?: AbsenceDecl;
  /**
   * Which columns are VALUES the source reports — the ones the absence check
   * judges. Default: every column the data calls a `number`; name them when a
   * number column is an ADDRESS rather than a value (a week index, a FIPS
   * code), or the check will tell a person to carry null in their own key.
   *
   * WHY `values` and not `measures`: a measure in this library is an aggregate
   * spec (`{ as, expr }` — `../derive/types.ts`, and the record a derived table
   * carries), and one word may not mean two shapes. These are column names, and
   * `values` is what the check they feed calls its own argument.
   */
  readonly values?: readonly string[];
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
  /** The sentence the data door refuses this table with. Present only when an `absence` was given and the table contradicts it. */
  readonly refused?: string;
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
 * The distinct values of one column, first-seen order, RETAINED only to a
 * ceiling — the fold's `distinct` recorder's twin for the two things a
 * DESCRIPTION needs and the data plane does not.
 *
 * WHY local, like {@link dateExtent}: `distinct` keys by SameValueZero, so two
 * equal Dates are two values — a date column of three rows of one day would
 * report `distinct: 3` under a `sample` showing that day three times, which is
 * the opposite of what both fields promise. And its map grows by one entry per
 * distinct value however few are asked for, so a near-unique id column of a
 * 500k-row file would retain 500k of them to report a capped 1000. It stops one
 * PAST the cap, which is all `distinctCapped` needs to be true.
 */
function distinctValues(field: string, cap: number): RowRecorder<{ readonly values: readonly unknown[]; readonly count: number }> {
  const seen = new Set<unknown>();
  // A separate set for dates, keyed by the instant: a string that looked like one could not collide.
  const dated = new Set<number>();
  const values: unknown[] = [];
  return {
    step: (row) => {
      if (values.length > cap) return;
      const value = row[field];
      if (value instanceof Date) {
        const at = value.getTime();
        if (dated.has(at)) return;
        dated.add(at);
      } else {
        // null and undefined are ONE absence, listed once — the fold's own rule, kept.
        const key = value ?? null;
        if (seen.has(key)) return;
        seen.add(key);
      }
      values.push(value);
    },
    result: () => ({ values, count: values.length }),
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
  // WHY deduped: the parser collapses a repeated header cell into ONE row key (last wins), so a name
  // kept twice would be described twice — two columns for one key, one of them holding another's
  // values. A trailing comma is the everyday way a spreadsheet export names `''` twice.
  return { rows: parsed.rows, names: [...new Set(parsed.header)] };
}

/** The value columns the absence check judges: the ones named, or every `number` column. */
function valuesOf(options: DescribeTableOptions, columns: readonly ColumnDescription[]): readonly string[] {
  // The absence column itself is not among them whatever is named here — `./absenceContradiction.ts`
  // owns that rule and keeps it for both its doors, so this is not a second place that knows.
  return options.values ?? columns.filter((column) => column.type === 'number').map((column) => column.name);
}

/** What the table HAS, as a refusal here ends. */
const columnsHere = (columns: readonly ColumnDescription[]): string =>
  columns.length === 0 ? 'that table has no columns' : `it has ${columns.map((column) => column.name).join(', ')}`;

/**
 * The refusal for a declaration naming a column this table does not have.
 *
 * WHY refused and not passed over: a name that misses judges NOTHING. A
 * case-typo'd absence field, or a UI label handed as a value name, would answer
 * a contradicting table with no `refused` at all — a clean bill of health, which
 * is the one wrong answer a refusal door must never give.
 */
function namingProblemOf(options: DescribeTableOptions, columns: readonly ColumnDescription[], absence: AbsenceDecl): string | undefined {
  const have = new Set(columns.map((column) => column.name));
  if (!have.has(absence.field)) return `this table: the absence law names "${absence.field}", which is not a column of it — ${columnsHere(columns)}`;
  const stray = (options.values ?? []).find((name) => !have.has(name));
  return stray === undefined ? undefined : `this table: values names "${stray}", which is not a column of it — ${columnsHere(columns)}`;
}

/**
 * Describe a table's columns: the sniffed type, a few example values, how many
 * distinct ones, and the extent where the type has one. ONE walk over the rows
 * for the description; a given `absence` costs a second, because which columns
 * are values is only known once the fold has settled the types.
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
    recorders[`d:${name}`] = distinctValues(name, cap);
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

  // WHY judged after the fold: which columns are values is read off the types the fold just settled.
  // The NAMES are judged first — a declaration that names a column this table lacks judges nothing.
  const absence = options.absence;
  const refused =
    absence === undefined ? undefined : (namingProblemOf(options, columns, absence) ?? absenceContradictionOf(rows, absence, valuesOf(options, columns), 'this table'));
  return { rows: rows.length, columns, ...(refused === undefined ? {} : { refused }) };
}
