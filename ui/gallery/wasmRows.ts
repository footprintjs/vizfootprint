/**
 * The inline table the `/wasm` page lands in DuckDB-WASM — and the SAME rows
 * its smoke recounts. Deterministic by construction (no PRNG, no fetch), so a
 * value the page answers and a value the test computes come from one source.
 *
 * WHY the shape it has: a number, a date and a string column, one null, and an
 * `id` whose order is NOT the source order — an unsorted window that came back
 * in id order would then be caught, which is the `__row` law the page proves.
 */

/** One row of the proof table. `name` is the one column that holds a null. */
export interface WasmRow {
  readonly id: number;
  readonly amount: number;
  readonly day: string;
  readonly name: string | null;
  readonly [k: string]: number | string | null;
}

export const WASM_TABLE = 'ledger';
export const WASM_ROW_COUNT = 300;
/** The source index whose `name` is null — inside the unsorted window the page reads (offset 20, ten rows), so the null is a visible answer. */
export const WASM_NULL_AT = 24;
const WORDS = ['apple', 'pear', 'fig', 'plum', 'kiwi', 'lime'] as const;
const DAY_MS = 86_400_000;
const FIRST_DAY = Date.UTC(2026, 0, 1);

/** The ISO day `i` days after 2026-01-01 — the string DuckDB reads as a DATE and the provider reads back as this same text. */
const isoDay = (i: number): string => new Date(FIRST_DAY + (i % 90) * DAY_MS).toISOString().slice(0, 10);

/**
 * The 300 rows, in source order. `id` is a permutation of 1..300 (173 is prime
 * and coprime to 300) that wraps every couple of rows, so no ten consecutive
 * source rows carry ascending ids — the smoke checks this of the fixture
 * itself; `amount` is distinct for every row (multiples of ten, offset by less
 * than seven), so a sort by it has no tie.
 */
export function wasmRows(): readonly WasmRow[] {
  return Array.from({ length: WASM_ROW_COUNT }, (_, i) => ({
    id: ((i * 173) % WASM_ROW_COUNT) + 1,
    amount: ((i * 37) % WASM_ROW_COUNT) * 10 + (i % 7),
    day: isoDay(i),
    name: i === WASM_NULL_AT ? null : `${WORDS[i % WORDS.length]!} ${String(i)}`,
  }));
}

/** The refresh's new version of the table: one row gone, one row's amount moved, one row added at the FRONT of source order. */
export const WASM_REFRESH = {
  /** The source index of the row the refresh removes. */
  removedAt: 1,
  /** The source index of the row whose amount the refresh moves. */
  updatedAt: 2,
  /** The id the refresh adds, with the largest amount in the table, so a sort by amount puts it first. */
  addedId: 301,
  addedAmount: 5000,
  updatedAmount: 4000,
} as const;

/** The rows after the refresh, in THEIR source order — the added row first, the removed row gone, the updated row moved. */
export function wasmRowsAfter(): readonly WasmRow[] {
  // mapped BEFORE filtered: both constants name indices of the ORIGINAL source order
  const kept = wasmRows()
    .map((row, i) => (i === WASM_REFRESH.updatedAt ? { ...row, amount: WASM_REFRESH.updatedAmount } : row))
    .filter((_row, i) => i !== WASM_REFRESH.removedAt);
  return [{ id: WASM_REFRESH.addedId, amount: WASM_REFRESH.addedAmount, day: '2026-04-01', name: 'added 301' }, ...kept];
}

/**
 * A second, tiny table landed through the opener's OTHER reader. `rows` land as
 * JSON text read by `read_json_auto`; `csv` lands as CSV text read by
 * `read_csv_auto`. The smoke watches what each landing fetched — the two
 * readers are not alike in what they need from the network, and that is a
 * fact this page measures rather than assumes.
 */
export const WASM_CSV_TABLE = 'csvbit';
export const WASM_CSV = 'code,qty\nA,1\nB,2\nC,3\n';
/** What that CSV reads back as: DuckDB infers `qty` as an integer, `code` as text. */
export const WASM_CSV_ROWS: readonly { readonly code: string; readonly qty: number }[] = [
  { code: 'A', qty: 1 },
  { code: 'B', qty: 2 },
  { code: 'C', qty: 3 },
];
