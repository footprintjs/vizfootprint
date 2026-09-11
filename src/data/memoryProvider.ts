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

import { cellString } from './cellText.js';
import { parseCSVTyped } from './csv.js';
import { deltaByKey } from './delta.js';
import { matchesClause, resolvePredicateSQL } from './predicate.js';
import { TypeTally, columnTypes, columnar, foldOnce } from './fold.js';
import {
  badFindReason,
  clauseFields,
  clauseList,
  reject,
  type ColumnInfo,
  type ColumnType,
  type DataProvider,
  type DataProviderCapabilities,
  type DataProviderRejection,
  type EvaluateOptions,
  type EvaluateResult,
  type FindOptions,
  type FindResult,
  type PredicateClause,
  type RelandOptions,
  type RelandResult,
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

/** The schema as `columns()` answers it — one reader, so a reland reports the same names and types the next `columns()` call will. */
function columnsOf(store: TableStore): readonly ColumnInfo[] {
  return storeColumnNames(store).map((name): ColumnInfo => {
    /* v8 ignore next -- the `?? 'unknown'` fallback is structurally unreachable: `storeColumnNames`
     * and `columnTypes` are always populated in lockstep (construction derives both from the same
     * rows/order snapshot; materializeColumn extends both together — see its two call sites below),
     * so every name this map() sees already has a columnTypes entry. */
    const type = store.columnTypes[name] ?? 'unknown';
    return { name, type };
  });
}

/** Every row of the store as a row object, in source order — the OLD side of a reland's compare. The row layout's own objects are borrowed (they are about to be let go of), the column layout's are materialised. */
function allRowsOf(store: TableStore): readonly Row[] {
  if (store.layout === 'row') return store.rows;
  return Array.from({ length: store.rowCount }, (_, i) => rowAt(store, i));
}

/** A row restricted to `keep` — what an old row looks like once the columns the new rows do not carry are stripped from it. */
function onlyColumns(row: Row, keep: ReadonlySet<string>): Row {
  return Object.fromEntries(Object.entries(row).filter(([column]) => keep.has(column)));
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

/**
 * One WALK of the view, answering both halves of a find at once: how many rows
 * hold the text in all, and which one the reader is being sent to.
 *
 * ONE PASS, and that is the point — the position of the next match is what only
 * an engine can answer cheaply, so answering it must not cost two scans. The
 * running match count IS the ordinal: when the hit is taken, the count so far
 * is its 1-based place among the matches.
 *
 * FORWARD keeps the FIRST hit at or after `from` (and never looks again);
 * BACKWARD keeps the LAST hit at or before `from` (so it overwrites), which is
 * why both directions are one loop and not two.
 */
function findInOrder(
  store: TableStore,
  clauses: readonly PredicateClause[],
  order: Int32Array | undefined,
  options: FindOptions,
): { readonly matches: number; readonly hit: { readonly position: number; readonly ordinal: number; readonly index: number } | null } {
  const n = storeRowCount(store);
  const fields = [...new Set(clauses.flatMap((c) => clauseFields(c)))];
  // the needle is NOT trimmed: a space is a character a person may be looking for.
  // Only a search that is ENTIRELY whitespace is not a search, and `badFindReason`
  // has already refused that one.
  const needle = options.text.toLowerCase();
  let matches = 0;
  let position = -1;
  let hit: { readonly position: number; readonly ordinal: number; readonly index: number } | null = null;
  for (let k = 0; k < n; k++) {
    const i = order === undefined ? k : order[k]!;
    const probe: Row = {};
    for (const f of fields) probe[f] = fieldAt(store, f, i);
    if (!clauses.every((c) => matchesClause(probe, c))) continue;
    position += 1; // the view position: counted over the rows the filter KEPT, never over the table
    if (!options.columns.some((c) => cellString(fieldAt(store, c, i)).toLowerCase().includes(needle))) continue;
    matches += 1;
    if (options.direction === 'forward') {
      if (hit === null && position >= options.from) hit = { position, ordinal: matches, index: i };
      continue;
    }
    if (position <= options.from) hit = { position, ordinal: matches, index: i };
  }
  return { matches, hit };
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
    // It answers over the SAME sort permutation a window walks, so a position a
    // find hands back is a position the next window can be opened at.
    canFind: true,
    // It holds its rows as arrays, so a reland is a diff of two arrays and a swap
    // of the store — in this process, in place, behind the same provider object.
    canReland: true,
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
      return columnsOf(store);
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

      // …and so must every column the PROJECTION names, in both modes and before
      // any window is walked: ONE law, both engines (src/data/README.md). Left
      // unjudged this engine answered `{ nope: undefined }` — a column that does
      // not exist, reported as a column with no value in it.
      //
      // WHY it is skipped for a table with NO columns: this engine reads a
      // row-major table's column names off its rows, so a table with zero rows
      // knows none at all and `columns()` honestly answers `[]` — an aggregate
      // whose group set came out empty lands exactly there. Judging a projection
      // against a schema the engine cannot see would report every column of it
      // as missing. A SQL engine has a schema without rows, which is why the
      // wasm door needs no such exception.
      const unprojectable = names.length === 0 ? undefined : (evalOptions.columns ?? []).find((c) => !names.includes(c));
      if (unprojectable !== undefined) {
        return reject('memory', 'evaluate', 'unknown-column', `table "${table}" has no column "${unprojectable}" to return`);
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

    async find(
      table: string,
      clause: PredicateClause | readonly PredicateClause[] | null,
      findOptions: FindOptions,
    ): Promise<FindResult | DataProviderRejection> {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'find', 'unknown-table', `no such table "${table}"`);
      const clauses = clauseList(clause);
      const names = storeColumnNames(store);
      // The judgements in the order `evaluate` meets them, and in its words: the
      // clause's columns, then the columns the ask names, then the ask's own
      // numbers, then the sort's columns. A find over a view is the same view.
      const missing = clauses.flatMap((c) => clauseFields(c)).find((f) => !names.includes(f));
      if (missing !== undefined) return reject('memory', 'find', 'unknown-column', `table "${table}" has no column "${missing}"`);
      // the zero-column exception is `evaluate`'s, for its reason (see there): a
      // row-major table with no rows knows no column names, so judging an ask
      // against a schema this engine cannot see would refuse every column of it
      const unsearchable = names.length === 0 ? undefined : findOptions.columns.find((c) => !names.includes(c));
      if (unsearchable !== undefined) return reject('memory', 'find', 'unknown-column', `table "${table}" has no column "${unsearchable}" to look in`);
      const bad = badFindReason(findOptions);
      if (bad !== undefined) return reject('memory', 'find', 'bad-find', bad);
      const sort = findOptions.sort ?? [];
      const missingSort = sort.map((k) => k.field).find((f) => !names.includes(f));
      if (missingSort !== undefined) return reject('memory', 'find', 'unknown-column', `table "${table}" has no column "${missingSort}" to sort by`);

      const sql = resolvePredicateSQL(clauses);
      const order = sort.length > 0 ? permutationFor(table, store, sort) : undefined;
      const { matches, hit } = findInOrder(store, clauses, order, findOptions);
      // WHY the row rides WHOLE and not projected on `columns`: `columns` says
      // where to LOOK, not what to answer with, and the caller reads its own
      // identity off the row (the session mints a row id from the key column,
      // which a person searching a text column need never have named).
      if (hit === null) return { sql, matches, position: null };
      return { sql, matches, position: hit.position, ordinal: hit.ordinal, index: hit.index, row: rowAt(store, hit.index) };
    },

    async replaceRows(table: string, rows: readonly Row[], relandOptions: RelandOptions = {}): Promise<RelandResult | DataProviderRejection> {
      const store = tableMap.get(table);
      if (!store) return reject('memory', 'replaceRows', 'unknown-table', `no such table "${table}"`);
      // The new store is built the way the old one was — the SAME layout, so a
      // def that asked for columns keeps columns across a refresh (`Layout` is
      // this provider's, not the table's) — and BEFORE the delta, so a build that
      // throws leaves the old rows exactly where they were.
      const fresh = build(rows);
      const arrived = new Set(storeColumnNames(fresh));
      const before = allRowsOf(store);
      // Compared like with like, over the columns the new rows carry: a column the
      // old rows had and the new do not (one an analysis materialised, or one the
      // source dropped) is stripped before the compare — the caller reports it by
      // name — never read as "every row updated". Stripped only when something IS
      // gone: the common case borrows the old rows as they are. And never when the
      // new version is EMPTY: this engine reads a schema off its rows, so zero rows
      // know no columns at all — stripping to that would strip the KEY and report
      // a table that was emptied as "nothing removed, every row unkeyed".
      const gone = arrived.size > 0 && storeColumnNames(store).some((column) => !arrived.has(column));
      const base = gone ? before.map((row) => onlyColumns(row, arrived)) : before;
      const delta = deltaByKey(base, rows, relandOptions.key);
      tableMap.set(table, fresh);
      // A permutation was over the OLD rows. The cache checks a row COUNT, so a
      // refresh that keeps the count and changes the values would otherwise
      // serve a sorted window in the old order over the new rows.
      sortCache.delete(table);
      return { ok: true, delta, columns: columnsOf(fresh) };
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
