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

function inferType(values: readonly unknown[]): ColumnType {
  let sawAny = false;
  let allNumber = true;
  let allBoolean = true;
  let allDate = true;
  for (const v of values) {
    if (v == null) continue;
    sawAny = true;
    if (typeof v !== 'number') allNumber = false;
    if (typeof v !== 'boolean') allBoolean = false;
    if (!(v instanceof Date)) allDate = false;
    if (!allNumber && !allBoolean && !allDate) break;
  }
  if (!sawAny) return 'unknown';
  if (allNumber) return 'number';
  if (allBoolean) return 'boolean';
  if (allDate) return 'date';
  return 'string';
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
  const columnTypes: Record<string, ColumnType> = {};
  for (const name of names) columnTypes[name] = inferType(rows.map((r) => r[name]));
  return { layout: 'row', rows, columnTypes };
}

function toColumnStore(input: RowsInput, csvDelimiter?: string): ColumnStore {
  const rows: Row[] = typeof input === 'string' ? [...parseCSVTyped(input, { delimiter: csvDelimiter }).rows] : [...input];
  const order = columnNamesOf(rows);
  const columns: Record<string, unknown[]> = {};
  for (const name of order) columns[name] = rows.map((r) => r[name]);
  const columnTypes: Record<string, ColumnType> = {};
  for (const name of order) columnTypes[name] = inferType(columns[name]!);
  return { layout: 'column', columns, order, rowCount: rows.length, columnTypes };
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

function matchingIndices(store: TableStore, clause: PredicateClause | null): number[] {
  const n = storeRowCount(store);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // matchesClause reads via a Row-shaped accessor either way — build a
    // minimal proxy row limited to the clause's own field(s) (both for a
    // D29 cell) so both layouts share EXACTLY the same evaluation code path
    // (no row/column fork here).
    const probe: Row = {};
    if (clause !== null) for (const f of clauseFields(clause)) probe[f] = fieldAt(store, f, i);
    if (matchesClause(probe, clause)) out.push(i);
  }
  return out;
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
  };

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
      clause: PredicateClause | null,
      evalOptions: EvaluateOptions = {},
    ): Promise<EvaluateResult | DataProviderRejection> {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'evaluate', 'unknown-table', `no such table "${table}"`);
      if (clause !== null) {
        // EVERY column the clause reads must exist (both sides of a D29 cell).
        const names = storeColumnNames(store);
        const missing = clauseFields(clause).find((f) => !names.includes(f));
        if (missing !== undefined) {
          return reject('memory', 'evaluate', 'unknown-column', `table "${table}" has no column "${missing}"`);
        }
      }

      const sql = resolvePredicateSQL(clause);
      const indices = matchingIndices(store, clause);
      const count = indices.length;

      if (evalOptions.mode === 'count') {
        return { sql, count };
      }

      const capped = evalOptions.limit !== undefined ? indices.slice(0, evalOptions.limit) : indices;
      const rows = capped.map((i) => rowAt(store, i, evalOptions.columns));
      return { sql, count, rows };
    },

    async materializeColumn(table: string, name: string, values: readonly unknown[]) {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'materializeColumn', 'unknown-table', `no such table "${table}"`);
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
