/**
 * memoryProvider — the D24 "memory" engine: in-JS predicates over arrays /
 * parsed CSV. D24's cited proof this pattern works: `bench/x4/runner.mjs:46-50`
 * ran real `@uwdata/mosaic-core` Selection/clause code with the DuckDB-WASM
 * connector STUBBED OUT and measured zero main-thread cost — i.e. the
 * commit/clause machinery this engine sits behind was already proven not to
 * need a real query engine underneath for correctness.
 *
 * Zero new runtime dependencies (D24 build step 2: "no new heavy dep") — CSV
 * parsing is `./csv.ts` (hand-rolled) and predicate SQL text is
 * `./predicate.ts` (hand-derived from the real Mosaic AST, not imported).
 *
 * Internal storage LAYOUT is a constructor option (`'row' | 'column'`) and
 * is intentionally exercised as a real fork in the code below — not a
 * cosmetic flag — because the D24 invariant test pins that the PUBLIC
 * surface (`evaluate().sql`, `.rows`, `.count`) is byte-identical regardless
 * of which internal representation backs it. That is the structural proof
 * that "engine" (or, here, even just internal engine-INTERNALS) never
 * leaks into commit semantics.
 */

import { parseCSVTyped } from './csv.js';
import { matchesClause, resolvePredicateSQL } from './predicate.js';
import { TypeTally, columnTypes, columnar, foldOnce } from './fold.js';
import {
  clauseFields,
  reject,
  type ColumnInfo,
  type ColumnType,
  type DataProvider,
  type DataProviderCapabilities,
  type DataProviderRejection,
  type EvaluateOptions,
  type EvaluateResult,
  type PredicateClause,
  type Row,
  type SortSpec,
} from './types.js';

export type Layout = 'row' | 'column';

/** One table's worth of raw input: pre-parsed row objects, or CSV text. */
export type RowsInput = readonly Row[] | string;

export interface MemoryProviderOptions {
  /** Default `'row'`. See file header — this is the axis the invariant test varies. */
  readonly layout?: Layout;
  /** Used only when a bare `RowsInput` (not a `{ [table]: RowsInput }` map) is passed. Default `'data'`. */
  readonly tableName?: string;
  readonly csvDelimiter?: string;
  /** How many sort permutations to keep per table (default `SORT_CACHE_PER_TABLE`). A dial: 4 bytes per row per kept sort. */
  readonly sortCache?: number;
}

// ── Internal per-layout table stores. ───────────────────────────────────────

interface RowStore {
  readonly layout: 'row';
  rows: Row[];
  columnTypes: Record<string, ColumnType>;
}

interface ColumnStore {
  readonly layout: 'column';
  columns: Record<string, unknown[]>;
  order: string[]; // column insertion order, for stable columns() output
  rowCount: number;
  columnTypes: Record<string, ColumnType>;
}

type TableStore = RowStore | ColumnStore;

/** One column's type from its values — the same TypeTally rule the fold's recorder runs. */
function inferType(values: readonly unknown[]): ColumnType {
  const t = new TypeTally();
  for (const v of values) t.see(v);
  return t.type();
}

function columnNamesOf(rows: readonly Row[]): string[] {
  // Homogeneous-rows assumption (documented): column set comes from the
  // first row. Typical tabular/CSV data satisfies this; a caller loading
  // ragged objects should materialize missing keys as `null` up front.
  return rows.length > 0 ? Object.keys(rows[0]!) : [];
}

function toRowStore(input: RowsInput, csvDelimiter?: string): RowStore {
  // Clone each row (`{...r}`), not just the array — `materializeColumn`
  // mutates row objects in place for this layout, and the caller's own
  // input array must never be a hidden alias for our internal storage.
  const rows: Row[] =
    typeof input === 'string'
      ? [...parseCSVTyped(input, { delimiter: csvDelimiter }).rows]
      : input.map((r) => ({ ...r }));
  const names = columnNamesOf(rows);
  // one walk answers every column's type (one pass, not one per column)
  const { types } = foldOnce(rows, { types: columnTypes(names) });
  return { layout: 'row', rows, columnTypes: { ...types } };
}

function toColumnStore(input: RowsInput, csvDelimiter?: string): ColumnStore {
  const rows: Row[] = typeof input === 'string' ? [...parseCSVTyped(input, { delimiter: csvDelimiter }).rows] : [...input];
  const order = columnNamesOf(rows);
  // one walk builds every column AND answers every column's type
  const folded = foldOnce(rows, { columns: columnar(order), types: columnTypes(order) });
  // the recorder promises its callers read-only columns; the store owns these arrays and grows them on materializeColumn
  return { layout: 'column', columns: { ...(folded.columns as Record<string, unknown[]>) }, order, rowCount: rows.length, columnTypes: { ...folded.types } };
}

function storeColumnNames(store: TableStore): string[] {
  return store.layout === 'row' ? columnNamesOf(store.rows) : [...store.order];
}

function storeRowCount(store: TableStore): number {
  return store.layout === 'row' ? store.rows.length : store.rowCount;
}

/** Materialize a row object for index `i`, honoring an optional column projection. */
function rowAt(store: TableStore, i: number, projection?: readonly string[]): Row {
  if (store.layout === 'row') {
    const r = store.rows[i]!;
    if (!projection) return r;
    const out: Row = {};
    for (const c of projection) out[c] = r[c];
    return out;
  }
  const cols = projection ?? store.order;
  const out: Row = {};
  for (const c of cols) out[c] = store.columns[c]?.[i];
  return out;
}

/** The one field-value reader both layouts funnel through for predicate evaluation. */
function fieldAt(store: TableStore, field: string, i: number): unknown {
  return store.layout === 'row' ? store.rows[i]?.[field] : store.columns[field]?.[i];
}

/** Absent for a sort: null, undefined, or a number that is not a number — the absence law's cell states are the session's, not the engine's. */
function isAbsent(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || (v instanceof Date && Number.isNaN(v.getTime())); // an invalid date is a date that is not one
}

/** The text of a value for the sort's last resort, or null when the value cannot say itself (a null-prototype object, a throwing toString) — it then sorts after everything. */
function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v; // the common case pays no try
  try {
    return String(v);
  } catch {
    return null;
  }
}

/** The rank a present value sorts in: numbers, then dates, then booleans, then everything by its text, then what has no text. Ranks never mix, so the order is total. */
function rankOf(v: unknown): 0 | 1 | 2 | 3 | 4 {
  if (typeof v === 'string') return 3;
  if (typeof v === 'number') return 0;
  if (v instanceof Date) return 1;
  if (typeof v === 'boolean') return 2;
  return textOf(v) === null ? 4 : 3;
}

/** A difference that is a number: two infinities are equal (their difference is NaN), never a scramble — only the sign of a comparator is read, so an infinite difference is fine as it is. */
function finiteDiff(d: number): number {
  return Number.isNaN(d) ? 0 : d;
}

/** Two present values in ONE total order: by rank first, then within the rank — so `2`, `10` and `"100"` sort as 2, 10, "100", never in a loop. */
function comparePresent(a: unknown, b: unknown): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return finiteDiff((a as number) - (b as number));
  if (ra === 1) return finiteDiff((a as Date).getTime() - (b as Date).getTime());
  if (ra === 2) return a === b ? 0 : a ? 1 : -1;
  if (ra === 4) return 0; // neither can say itself: equal, and source order decides
  const sa = textOf(a)!; // rank 3: the text exists
  const sb = textOf(b)!;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * ONE permutation of the table's rows for a sort spec: stable (ties keep
 * source order), absent values first or last per key, built once and cached
 * by the provider per (table, spec). A window walks it; a brush never rebuilds it.
 * Sorted in place in its typed array — one allocation, no boxed copy.
 */
function sortPermutation(store: TableStore, sort: readonly SortSpec[]): Int32Array {
  const n = storeRowCount(store);
  const keys = sort.map((k) => ({ field: k.field, sign: k.dir === 'desc' ? -1 : 1, absentFirst: k.absent === 'first' }));
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => {
    for (const k of keys) {
      const a = fieldAt(store, k.field, x);
      const b = fieldAt(store, k.field, y);
      const aa = isAbsent(a);
      const ba = isAbsent(b);
      if (aa || ba) {
        if (aa && ba) continue;
        // absent values sit at the same end regardless of direction — a person reading a descending column still finds the blanks together
        return (aa ? -1 : 1) * (k.absentFirst ? 1 : -1);
      }
      const c = comparePresent(a, b);
      if (c !== 0) return c * k.sign;
    }
    return x - y; // stable: source order breaks every tie
  });
  return order;
}

/** The cache key of a sort spec — the spec alone, never the filter. */
function sortKey(sort: readonly SortSpec[]): string {
  return JSON.stringify(sort.map((k) => [k.field, k.dir, k.absent ?? 'last']));
}

/** How many sort permutations one table keeps unless the options say otherwise: the few sorts a person flips between, least recently used evicted. Each holds 4 bytes per row. */
export const SORT_CACHE_PER_TABLE = 8;

/** The matches in `order` (or source order): every one counted, only the first `need` collected — a window never allocates the whole match list. */
function collectMatches(store: TableStore, clauses: readonly PredicateClause[], order: Int32Array | undefined, need: number | undefined): { readonly indices: number[]; readonly count: number } {
  const n = storeRowCount(store);
  const indices: number[] = [];
  let count = 0;
  const fields = [...new Set(clauses.flatMap((c) => clauseFields(c)))];
  for (let k = 0; k < n; k++) {
    const i = order === undefined ? k : order[k]!;
    const probe: Row = {};
    for (const f of fields) probe[f] = fieldAt(store, f, i);
    if (!clauses.every((c) => matchesClause(probe, c))) continue;
    count++;
    if (need === undefined || indices.length < need) indices.push(i);
  }
  return { indices, count };
}

/** One clause, a list, or null — as the list the matcher walks. */
function clauseList(clause: PredicateClause | readonly PredicateClause[] | null): readonly PredicateClause[] {
  return clause === null ? [] : Array.isArray(clause) ? (clause as readonly PredicateClause[]) : [clause as PredicateClause];
}

/**
 * The D24 "memory" engine. `input` is either a single table's data (array of
 * row objects or CSV text — table name defaults to `options.tableName ??
 * 'data'`) or a map of `{ [table]: RowsInput }` for a multi-table provider
 * (matching a Mosaic-spec-style `data` record — SPEC.md §7's
 * `DashboardDef.data`, `node_modules/@uwdata/mosaic-spec/dist/src/parse-spec.js:60`).
 */
export function memoryProvider(
  input: RowsInput | Record<string, RowsInput>,
  options: MemoryProviderOptions = {},
): DataProvider {
  const layout: Layout = options.layout ?? 'row';
  const tableMap = new Map<string, TableStore>();

  const build = (raw: RowsInput): TableStore =>
    layout === 'row' ? toRowStore(raw, options.csvDelimiter) : toColumnStore(raw, options.csvDelimiter);

  if (typeof input === 'string' || Array.isArray(input)) {
    tableMap.set(options.tableName ?? 'data', build(input));
  } else {
    for (const [name, raw] of Object.entries(input)) tableMap.set(name, build(raw));
  }

  const capabilities: DataProviderCapabilities = {
    // Honest: this engine evaluates predicates in JS, never runs the
    // resolved SQL text against a real query engine.
    canEvaluateSQL: false,
    canMaterialize: true,
    canSort: true,
  };
  // one sort-permutation cache per table, keyed by the sort spec alone (see sortPermutation); least recently used evicted
  const keep = options.sortCache ?? SORT_CACHE_PER_TABLE;
  const sortCache = new Map<string, Map<string, { readonly order: Int32Array; readonly rows: number }>>();
  const permutationFor = (table: string, store: TableStore, sort: readonly SortSpec[]): Int32Array => {
    let perTable = sortCache.get(table);
    if (perTable === undefined) {
      perTable = new Map();
      sortCache.set(table, perTable);
    }
    const key = sortKey(sort);
    const hit = perTable.get(key);
    if (hit !== undefined && hit.rows === storeRowCount(store)) {
      perTable.delete(key); // a hit moves to the back: a Map keeps insertion order, so the front is the least recently used
      perTable.set(key, hit);
      return hit.order;
    }
    const entry = { order: sortPermutation(store, sort), rows: storeRowCount(store) };
    perTable.delete(key);
    if (perTable.size >= keep) perTable.delete(perTable.keys().next().value!);
    perTable.set(key, entry);
    return entry.order;
  };
  const badWindowValue = (name: string, v: number | undefined): string | undefined => (v === undefined || (Number.isInteger(v) && v >= 0) ? undefined : `${name} must be a whole number at or above zero (got ${String(v)})`);

  const provider: DataProvider = {
    engine: 'memory',
    capabilities,

    async tables() {
      return [...tableMap.keys()];
    },

    async columns(table) {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'columns', 'unknown-table', `no such table "${table}"`);
      return storeColumnNames(store).map((name): ColumnInfo => {
        /* v8 ignore next -- the `?? 'unknown'` fallback is structurally unreachable: `storeColumnNames`
         * and `columnTypes` are always populated in lockstep (construction derives both from the same
         * rows/order snapshot; materializeColumn extends both together — see its two call sites below),
         * so every name this map() sees already has a columnTypes entry. */
        const type = store.columnTypes[name] ?? 'unknown';
        return { name, type };
      });
    },

    async evaluate(
      table: string,
      clause: PredicateClause | readonly PredicateClause[] | null,
      evalOptions: EvaluateOptions = {},
    ): Promise<EvaluateResult | DataProviderRejection> {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'evaluate', 'unknown-table', `no such table "${table}"`);
      const clauses = clauseList(clause);
      // EVERY column any clause reads must exist (both sides of a D30 cell).
      const names = storeColumnNames(store);
      const missing = clauses.flatMap((c) => clauseFields(c)).find((f) => !names.includes(f));
      if (missing !== undefined) {
        return reject('memory', 'evaluate', 'unknown-column', `table "${table}" has no column "${missing}"`);
      }

      const sql = resolvePredicateSQL(clauses);
      // the window and the sort are judged the same way in both modes — a malformed one is refused, never clamped into something the caller did not ask
      const badWindow = badWindowValue('offset', evalOptions.offset) ?? badWindowValue('limit', evalOptions.limit);
      if (badWindow !== undefined) return reject('memory', 'evaluate', 'bad-window', badWindow);
      const sort = evalOptions.sort ?? [];
      const missingSort = sort.map((k) => k.field).find((f) => !names.includes(f));
      if (missingSort !== undefined) {
        return reject('memory', 'evaluate', 'unknown-column', `table "${table}" has no column "${missingSort}" to sort by`);
      }
      if (evalOptions.mode === 'count') {
        return { sql, count: collectMatches(store, clauses, undefined, 0).count };
      }
      const order = sort.length > 0 ? permutationFor(table, store, sort) : undefined;
      const offset = evalOptions.offset ?? 0;
      const need = evalOptions.limit !== undefined ? offset + evalOptions.limit : undefined; // collect only what the window can show; count everything
      const { indices, count } = collectMatches(store, clauses, order, need);
      const start = Math.min(offset, count);
      const windowed = indices.slice(start, evalOptions.limit !== undefined ? start + evalOptions.limit : undefined);
      const rows = windowed.map((i) => rowAt(store, i, evalOptions.columns));
      return {
        sql,
        count,
        rows,
        ...(evalOptions.offset !== undefined ? { start } : {}),
        ...(evalOptions.indices === true ? { indices: windowed } : {}),
      };
    },

    async materializeColumn(table: string, name: string, values: readonly unknown[]) {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'materializeColumn', 'unknown-table', `no such table "${table}"`);
      sortCache.delete(table); // a column's values may have changed under a cached order
      const rowCount = storeRowCount(store);
      if (values.length !== rowCount) {
        return reject(
          'memory',
          'materializeColumn',
          'row-count-mismatch',
          `table "${table}" has ${rowCount} rows; got ${values.length} values`,
        );
      }
      if (store.layout === 'row') {
        store.rows.forEach((r, i) => {
          r[name] = values[i];
        });
      } else {
        store.columns[name] = [...values];
        if (!store.order.includes(name)) store.order.push(name);
      }
      store.columnTypes[name] = inferType(values);
      return { ok: true };
    },
  };

  return provider;
}
