/**
 * landing — HOW A TABLE'S BYTES REACH DUCKDB: ONE TYPE LAW FOR BOTH KINDS, EVERY
 * TYPE WRITTEN INTO THE STATEMENT, AND NOTHING FETCHED TO READ THEM.
 *
 * The port lands ROWS or CSV TEXT (`sqlConnection.ts` · `SqlLoader.load`); the
 * bytes the adapter registers and the reader it names are the adapter's
 * business, and this module is that business. Rows used to go as JSON
 * (`JSON.stringify(rows)` + `read_json_auto`), and the browser proof found the
 * cost: this DuckDB bundle autoloads its `json` extension from the vendor's
 * extension repository the first time it reads JSON — one request off the
 * origin, in BOTH hosts — so an offline or CSP-restricted page could not land
 * rows at all, and a node landing with that repository unreachable hung. The
 * CSV reader is statically linked: a CSV landing needs nothing.
 *
 * THE ONE LAW: a column's DuckDB type is the memory engine's own word for its
 * values, in DuckDB's spelling — never the engine's sniff of their bytes.
 *
 *   - `rows` are WRITTEN as CSV ({@link rowsLandingOf}) and each column's type
 *     is tallied from the values by the memory engine's rule (`fold.ts` ·
 *     `TypeTally`): an ISO string is a VARCHAR and reads back byte for byte, a
 *     Date object a TIMESTAMP read back as ISO text, safe integers a BIGINT
 *     (so a find's `CAST(… AS VARCHAR)` renders `15` as the memory engine's
 *     `String(15)` does — a DOUBLE would render `15.0`), any other number a
 *     DOUBLE. Read by {@link rowsReaderSQL}: every option spelled out, none
 *     detected.
 *   - a def's `csv` TEXT is registered AS IT CAME — DuckDB reads the def's own
 *     bytes and detects its dialect — but its types are declared too
 *     ({@link csvLandingOf}), from the SAME sniffer the memory engine runs over
 *     the same text (`csv.ts` · `parseCSVTyped`, which never types a date out
 *     of text) and the same tally. Read by {@link csvReaderSQL}.
 *
 * WHY one law and not the engine's sniffer for the `csv` kind: the sniffer
 * drifts with the spelling of a value (an ISO instant without milliseconds
 * used to come back re-spelled with them, a negative zero as zero), and it
 * would type a `csv` table's day column a DATE while a refresh — which lands
 * ROWS — typed the same strings a VARCHAR: a reland then reported every shared
 * key "updated" for a type that moved on one engine only. `engineInvariant.test.ts`
 * pins that reland at zero updates, and the FIDELITY table there proves every
 * kind of value cell by cell against the real engine.
 *
 * WHAT CSV DOES NOT HAVE, and how the rows writer writes it down:
 *
 *   - no null. A null cell is the bare token {@link NULL_TOKEN}; every string
 *     is QUOTED, always, and the reader is told `allow_quoted_nulls=false`, so
 *     a string that IS the token reads back as the string and an empty string
 *     reads back as `''`, never NULL. (Measured on v1.5.1: a bare `\N` is NULL
 *     in every type; a quoted `"\N"`, a quoted `""` and a bare empty field in
 *     a VARCHAR column are all the strings they look like.) A def's own CSV
 *     keeps DuckDB's default instead — an empty field is NULL — which is what
 *     the memory engine's `sniffCell` says of the same field.
 *   - no NaN. A number that is not finite lands as NULL, as it did through
 *     JSON and as `literalToSQL` renders it. Not because DuckDB has nowhere to
 *     put one — a DOUBLE holds the literal `nan` as a real, distinct value
 *     (measured) — but because a stored one SORTS as DuckDB's LARGEST number,
 *     while the memory engine's own sort law reads NaN as absent and places it
 *     wherever `absentFirst` says: a landing that kept it as a real NaN would
 *     agree on this cell and disagree on every SORTED window over the column.
 *     NULL is the value both engines can agree stays out of that ordering.
 *
 * WHAT IT REFUSES: rows with none in them, and a CSV text with no header —
 * neither names a column, and DuckDB cannot land a relation with none (the
 * JSON reader used to land a phantom `json` column instead — a lie that
 * `columns()` then repeated). The refusal names the remedy
 * ({@link NO_ROWS_TO_LAND}, {@link NO_CSV_HEADER}); `wasmProvider.replaceRows`
 * never meets it (an empty reland keeps the old schema through
 * `emptyStagingSQL`), and a CSV text whose header names columns but holds no
 * rows lands those columns and zero rows.
 *
 * WHY the column set is the FIRST row's keys: that is the memory engine's law
 * (`memoryProvider` · `columnNamesOf`) — a later row's extra key is not a
 * column, and a missing one is null — so the two engines describe one table.
 *
 * Pinned byte for byte in `landing.test.ts`.
 */
import { TypeTally } from './fold.js';
import { cellString } from './cellText.js';
import { parseCSVTyped } from './csv.js';
import { literalToSQL } from './predicate.js';
import type { Row } from './types.js';

// ── The data. ────────────────────────────────────────────────────────────

/** The DuckDB types a column is landed as — the memory engine's five words, in DuckDB's. */
export type LandedType = 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP' | 'VARCHAR';

export interface LandedColumn {
  readonly name: string;
  readonly type: LandedType;
}

/** A text and the columns declared over it — what either kind of landing registers, and what its reader is told. */
export interface TypedText {
  readonly text: string;
  readonly columns: readonly LandedColumn[];
}

/** The bare field that means NULL in a ROWS landing. Any string cell, this one included, is quoted — so the token is never mistaken for it. */
export const NULL_TOKEN = '\\N';

/** The refusal zero rows meet: no column can be named from them, and a table with no columns cannot be landed. */
export const NO_ROWS_TO_LAND =
  'landing zero rows names no columns, and the wasm engine lands a table by its columns — a table that starts empty is CSV text whose header names them ({ csv: … }), or a memory table';

/** The refusal a CSV text with no header line meets, for the same reason. */
export const NO_CSV_HEADER = 'landing a CSV text with no header names no columns, and the wasm engine lands a table by its columns — the first line of a CSV is its header';

// ── The tally: one DuckDB type per column, from every value in it. ───────

/**
 * A column's landed type, as a running tally over its values.
 *
 * `TypeTally` is the memory engine's rule (`number`/`boolean`/`date` when every
 * non-null value is one, else `string`; `unknown` when none was seen). The one
 * refinement is BIGINT vs DOUBLE: an integer column renders its digits in a
 * find the way the memory engine does (`15`, not `15.0`), so it is a BIGINT
 * when every number that will land as a number is a safe integer. A value that
 * lands as NULL (NaN, ±Infinity) says nothing about the column's type.
 *
 * WHY a running tally and not a function over an array: a million rows of
 * thirty columns are seen once, row by row, without an array per column.
 */
export class LandedTally {
  private readonly tally = new TypeTally();
  private integers = true;
  see(value: unknown): void {
    this.tally.see(value);
    if (typeof value === 'number' && Number.isFinite(value) && !Number.isSafeInteger(value)) this.integers = false;
  }
  type(): LandedType {
    switch (this.tally.type()) {
      case 'number':
        return this.integers ? 'BIGINT' : 'DOUBLE';
      case 'boolean':
        return 'BOOLEAN';
      case 'date':
        return 'TIMESTAMP';
      default:
        // `string`, and `unknown` (every value null): a VARCHAR holds either, and reads a null back as null
        return 'VARCHAR';
    }
  }
}

/** A column's landed type from its values — the tally, run over an array. */
export function landedTypeOf(values: readonly unknown[]): LandedType {
  const tally = new LandedTally();
  for (const value of values) tally.see(value);
  return tally.type();
}

/** Every named column's landed type, in ONE pass over the rows — the law both kinds of landing share. */
export function landedColumnsOf(names: readonly string[], rows: readonly Row[]): readonly LandedColumn[] {
  const tallies = names.map(() => new LandedTally());
  for (const row of rows) for (let j = 0; j < names.length; j++) tallies[j]!.see(row[names[j]!]);
  return names.map((name, j) => ({ name, type: tallies[j]!.type() }));
}

/** The `{'name': 'TYPE', …}` struct a reader is handed — each name a SQL literal, so a quote in it is doubled. */
function declaredTypes(columns: readonly LandedColumn[]): string {
  return columns.map((column) => `${literalToSQL(column.name)}: ${literalToSQL(column.type)}`).join(', ');
}

// ── Rows: the cells, one writer per landed type. ─────────────────────────

/** A number as its digits; `-0` keeps its sign (a DOUBLE holds one, a BIGINT has none); anything non-finite or not a number is NULL. */
function numberField(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NULL_TOKEN;
  return Object.is(value, -0) ? '-0' : String(value);
}

function booleanField(value: unknown): string {
  if (typeof value !== 'boolean') return NULL_TOKEN;
  return value ? 'true' : 'false';
}

/** A Date as its ISO instant; an invalid Date is absent (the memory engine's `isAbsent` says the same), so NULL. */
function instantField(value: unknown): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return NULL_TOKEN;
  return value.toISOString();
}

/**
 * A text cell: QUOTED, always, a quote doubled — so a comma, a newline, a
 * quote, a leading space, the null token and the empty string all survive.
 * A non-string in a text column (a number beside strings, a Date, an object)
 * is written as the one text the memory engine shows for it (`cellString`).
 */
function quotedField(value: unknown): string {
  if (value === null || value === undefined) return NULL_TOKEN;
  return `"${cellString(value).replaceAll('"', '""')}"`;
}

const FIELD_WRITERS: Readonly<Record<LandedType, (value: unknown) => string>> = {
  BIGINT: numberField,
  DOUBLE: numberField,
  BOOLEAN: booleanField,
  TIMESTAMP: instantField,
  VARCHAR: quotedField,
};

// ── Rows: the text and its reader. ───────────────────────────────────────

/**
 * The CSV text for these rows, and the columns it was written under.
 *
 * Two passes: one to tally each column's type (a cell is written by its
 * column's type, which is not known until every value has been seen), one to
 * write. The header names the columns in the first row's key order; every row
 * ends in a newline.
 */
export function rowsLandingOf(rows: readonly Row[]): TypedText {
  const first = rows[0];
  if (first === undefined) throw new Error(NO_ROWS_TO_LAND);
  const names = Object.keys(first);
  const columns = landedColumnsOf(names, rows);
  const writers = columns.map((column) => FIELD_WRITERS[column.type]);
  const lines = new Array<string>(rows.length + 1);
  lines[0] = names.map((name) => `"${name.replaceAll('"', '""')}"`).join(',');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const fields = new Array<string>(names.length);
    for (let j = 0; j < names.length; j++) fields[j] = writers[j]!(row[names[j]!]);
    lines[i + 1] = fields.join(',');
  }
  return { text: `${lines.join('\n')}\n`, columns };
}

/**
 * The reader that lands the text {@link rowsLandingOf} wrote: every option
 * spelled out, none detected. `columns={…}` names and types the columns (and
 * turns detection off); `header=true` skips the line that repeats the names;
 * the delimiter, quote and escape are what the writer wrote; `nullstr` is the
 * token and `allow_quoted_nulls=false` keeps a quoted one a string.
 */
export function rowsReaderSQL(file: string, columns: readonly LandedColumn[]): string {
  return `read_csv(${literalToSQL(file)}, header=true, delim=',', quote='"', escape='"', new_line='\\n', nullstr=${literalToSQL(NULL_TOKEN)}, allow_quoted_nulls=false, columns={${declaredTypes(columns)}})`;
}

// ── CSV text: the def's bytes, the library's types. ──────────────────────

/**
 * A def's CSV text as a landing: the text untouched, and the columns the
 * memory engine's own sniffer says it holds (`parseCSVTyped` — the first line
 * is the header, an empty field is null, a column is a number or a boolean
 * only when every non-empty cell is one, and text is never a date), tallied
 * into DuckDB's words by the same rule as rows. Two engines, one reading.
 */
export function csvLandingOf(text: string): TypedText {
  const { header, rows } = parseCSVTyped(text);
  if (header.length === 0) throw new Error(NO_CSV_HEADER);
  return { text, columns: landedColumnsOf(header, rows) };
}

/**
 * The reader for a def's own CSV: DuckDB detects the dialect (delimiter, quote,
 * line ending — the def's bytes are the def's), `header=true` says what the
 * memory engine's parser assumes, and `types={…}` declares each column by
 * name over the detection. (A name the header lacks is DuckDB's own error,
 * naming it.)
 */
export function csvReaderSQL(file: string, columns: readonly LandedColumn[]): string {
  return `read_csv(${literalToSQL(file)}, header=true, types={${declaredTypes(columns)}})`;
}
