/**
 * wasmProvider — D24's "wasm" engine: A REAL SQL ENGINE BEHIND A PORT THAT
 * OPENS ONLY WHEN SOMEONE ACTUALLY ASKS A QUESTION.
 *
 * The law this file keeps, and the three consequences that follow from it:
 *
 *   Constructing a provider is INERT. `wasmProvider()` imports no DuckDB,
 *   spawns no worker, fetches no bundle and opens no connection — choosing an
 *   engine is not the same act as asking it something.
 *
 *   1. The backend arrives through {@link SqlConnection}, never as DuckDB
 *      itself: either a `connection` already open (a host's own, and every
 *      test's fake), or an `open` function called ONCE, on the first read.
 *      The real one lives in `duckdbConnection.ts` behind a DYNAMIC import —
 *      a static one anywhere in this tree would drag a WASM bundle into every
 *      build that merely mentions the data seam (`bench/x4/runner.mjs` had to
 *      stub `@uwdata/mosaic-core` for exactly that reason).
 *   2. The rows come back in the order the WINDOW asked for, and each row's
 *      identity is READ from `__row` (`sqlWindow.ts`), never inferred from the
 *      order the scan happened to deliver. `__row` is this engine's own
 *      bookkeeping: it is stripped from every row and answered as `indices`,
 *      and `columns()` never lists it.
 *   3. `evaluate().sql` is `resolvePredicateSQL`'s string — the SAME descriptor
 *      the memory engine returns for the same clause, which is the D24
 *      invariant the commit log rests on. The statement this engine actually
 *      RUNS is that descriptor wrapped by `windowSQL`; the two are different
 *      strings on purpose, and only the descriptor is ever reported.
 *   4. The VALUES come back as this library's own, not as DuckDB's wire types.
 *      Two halves, and both of them are load-bearing rather than cosmetic: the
 *      database is opened with `castBigIntToDouble`/`castDecimalToDouble`
 *      (`duckdbConnection.ts`), because `read_json_auto` infers BIGINT for
 *      every integer column and a `15n` where `columns()` promised a `number`
 *      is a value `JSON.stringify` throws on and every fold in `bins.ts` /
 *      `boxSummary.ts` reads as ABSENT; and a date column's epoch number is
 *      read back as the ISO string the memory engine holds
 *      ({@link withoutRowOrder}), so one `EvaluateResult` means one value
 *      whichever engine answered.
 *
 *   5. A REFRESH IS COMPUTED WHERE THE ROWS LIVE. `replaceRows` lands the new
 *      rows as a staging table through the connection's own `load`, asks SQL
 *      for the delta (`sqlReland.ts` — the same `RefreshDelta` the memory
 *      engine's `deltaByKey` answers, proven one answer in
 *      `engineInvariant.test.ts`), replaces the table atomically, drops the
 *      staging table and re-DESCRIBEs. No row comes out of the database to be
 *      diffed in JavaScript, and the provider stays the same object.
 *
 * What is NOT here yet, and says so at the door rather than pretending:
 * `materializeColumn` (`canMaterialize: false` — landing a column is an
 * `ALTER TABLE` a later step wires). LOADING a declared `sources` entry's FIRST
 * bytes is not this file's job either, and never will be: `loadTableSQL` in
 * `sqlConnection.ts` is the statement, and the caller that runs it is the
 * BUILD (`../def/wasmBackend.ts`, which lands a def's bytes in the connection
 * this provider shares); a reland lands the NEW rows of a table this provider
 * already serves, which is a different act. A table this provider was declared
 * with but whose bytes never reached the connection is refused by the backend,
 * in the backend's own words.
 */

import { quoteIdent, resolvePredicateSQL } from './predicate.js';
import { FIND_ORDINAL_COLUMN, FIND_POSITION_COLUMN, ROW_ORDER_COLUMN, WindowRefusal, findSQL, windowSQL } from './sqlWindow.js';
import { RELAND_KEY_COLUMN, dropStagingSQL, emptyStagingSQL, relandSQL, stagingTableOf, type RelandStatements } from './sqlReland.js';
import { canLoad, type LoadingConnection, type SqlConnection } from './sqlConnection.js';
import type { RefreshDelta } from './delta.js';
import {
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
} from './types.js';

// ── The data: what a caller declares, what this engine can do, and the ───
// ── words for everything it cannot. ──────────────────────────────────────

export interface WasmProviderOptions {
  /**
   * The tables this provider serves — `tables()` is exactly this list.
   *
   * WHY names and not a `{ kind, fileName }` declaration per table: this
   * provider never lands a byte and never will (the BUILD does —
   * `../def/wasmBackend.ts`), so a shape describing WHERE bytes come from was
   * read for its keys and nothing else. A `kind: 'parquet'` nobody landed read
   * as a promise this engine had never made.
   */
  readonly sources?: readonly string[];
  /**
   * A connection already open — a host's own, or a test's fake. Used as-is;
   * never closed by this provider, which did not open it.
   *
   * Each table's `DESCRIBE` is asked ONCE through it and remembered for the
   * life of the provider: a schema is read by every window and changes only
   * when a table is re-landed. The one re-landing this provider knows about is
   * its own `replaceRows`, which forgets and re-reads the schema itself. A host
   * that re-lands a table under this same connection BEHIND this provider must
   * build a new one — this one would keep judging clauses against the columns
   * the old bytes had.
   */
  readonly connection?: SqlConnection;
  /**
   * …or the way to open one, called at most ONCE, on the first read that needs
   * it (`duckdbConnection()` is the shipped one).
   *
   * WHOEVER OPENED IT CLOSES IT: a connection this option opened is closed by
   * the party that passed the opener, never by this provider — which cannot
   * know whether the reader after it is another provider sharing the same
   * database. A def's build is that party, and it owns a `close()` for exactly
   * this (`../def/wasmBackend.ts`).
   */
  readonly open?: () => Promise<SqlConnection>;
}

const capabilities: DataProviderCapabilities = {
  // Measured by what this engine DOES, not by what it plans: it runs the
  // resolved predicate against DuckDB, and it renders the window's ORDER BY —
  // so the session's pre-flight sort gate may hand it a sorted window.
  canEvaluateSQL: true,
  canSort: true,
  // It answers a find in SQL — `ROW_NUMBER()` over the same order a window
  // renders, so a position it hands back is the offset that window opens at.
  canFind: true,
  // Landing a computed column is an ALTER TABLE this engine does not issue
  // yet. Declared false so a caller branches BEFORE the call, and refused in
  // those words at the door if it calls anyway.
  canMaterialize: false,
  // A refresh is computed where the rows live: the new rows are landed as a
  // staging table and the delta is asked of SQL (`sqlReland.ts`) — no row
  // comes out of the database to be diffed in JavaScript.
  canReland: true,
};

/**
 * No connection was ever supplied — the one refusal a caller can fix from the
 * constructor, and the one a DIRECT caller of this factory meets. A def never
 * does: the build door always hands over an opener (`../def/wasmBackend.ts`),
 * so a def-declared table's refusals are about opening or landing, never about
 * a provider constructed with neither.
 */
export const wasmConnectionRefusal = (table: string): string =>
  `the "wasm" engine has no connection to answer "${table}" with — pass { connection } (an open SqlConnection) or { open } (a function that opens one, e.g. duckdbConnection()) to wasmProvider`;

/** …and the one they cannot: the open they DID supply threw. The cause is quoted; the open is not asked again. */
const openFailedSentence = (table: string, cause: string): string =>
  `opening a connection for "${table}" failed: ${cause} — the open function is asked ONCE per provider; fix the cause and construct a new provider`;

/** The backend was there and said no. The statement and the engine's own words, both quoted — neither is ever parsed. */
const backendRefusedSentence = (table: string, statement: string, cause: string): string =>
  `the backend refused this engine's query for "${table}": ${cause} — the statement was: ${statement}`;

/** The connection reads fine but cannot be asked to LAND a table — the one reland refusal the party that opened the connection can fix. Word for word the build's own sentence for the same fact (`../def/wasmBackend.ts`). */
const cannotRelandSentence = (table: string): string =>
  `the SQL connection this engine reads through cannot re-land "${table}": it answers queries only (no load) — pass an opener that can (openSqlConnection: duckdbConnection())`;

/** A reland's staging table could not be landed. The cause is quoted; the old rows are untouched. */
const stagingFailedSentence = (table: string, cause: string): string =>
  `re-landing "${table}" failed before any row moved: ${cause} — the table still holds its previous rows`;

/** A table nobody declared. The remedy is the list, so a typo is visible without a second call. */
const unknownTableSentence = (table: string, declared: readonly string[]): string =>
  declared.length === 0
    ? `no such table "${table}" — this provider was declared with no tables at all`
    : `no such table "${table}" — this provider was declared with ${declared.map((t) => `"${t}"`).join(', ')}`;

/** Word for word the memory engine's sentence: one wording for the same fact, whichever engine found it. */
const unknownColumnSentence = (table: string, column: string): string => `table "${table}" has no column "${column}"`;

/** DuckDB's type words, mapped onto the five this library speaks. Prefixes, because DuckDB decorates: `DECIMAL(18,3)`, `TIMESTAMP WITH TIME ZONE`. */
const TYPE_WORDS: readonly (readonly [ColumnType, readonly string[]])[] = [
  ['number', ['TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT', 'UTINYINT', 'USMALLINT', 'UINTEGER', 'UBIGINT', 'UHUGEINT', 'FLOAT', 'REAL', 'DOUBLE', 'DECIMAL', 'NUMERIC']],
  ['boolean', ['BOOLEAN', 'BOOL', 'LOGICAL']],
  ['date', ['DATE', 'TIMESTAMP', 'TIME', 'INTERVAL']],
  ['string', ['VARCHAR', 'CHAR', 'TEXT', 'STRING', 'UUID', 'ENUM', 'BPCHAR']],
];

/**
 * Which DuckDB date types this engine converts, and to WHICH string.
 *
 * WHY two shapes and not one: DuckDB answers a DATE and a TIMESTAMP with the
 * same JS number (epoch milliseconds — measured, not assumed), while the memory
 * engine holds what the def handed it: `'2026-04-05'` for a day, a full instant
 * for a timestamp. Reading both back as one shape would make one of the two
 * engines answer a value the other never held.
 *
 * WHY TIME and INTERVAL are absent: DuckDB sends a TIME as microseconds and an
 * INTERVAL as its own object, and this library has no value for either — no def
 * declares one, no fold reads one. An honest gap: the value is answered exactly
 * as DuckDB sent it, and this comment is the notice.
 */
const DATE_SHAPES: readonly (readonly [DateShape, readonly string[]])[] = [
  ['day', ['DATE']],
  ['instant', ['TIMESTAMP']],
];

/** A day (`'2026-04-05'`) or an instant (`'2026-04-05T10:20:30.000Z'`) — the two ISO strings a date column's value is read back as. */
type DateShape = 'day' | 'instant';

// ── The small answers: an asked question either has a value or a sentence. ─

/** One backend question's outcome. WHY not a rejection outright: the same failure is filed under a different `operation` by each door. */
type Asked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** What a thrown thing SAYS. Quoted into a refusal, never parsed — the R12 firewall, one step down. */
function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** DuckDB's `DESCRIBE` answers one row per column: `column_name`, `column_type`, and more this engine does not read. */
function describeSQL(table: string): string {
  return `DESCRIBE ${quoteIdent(table)}`;
}

function columnTypeOf(sqlType: string): ColumnType {
  const word = sqlType.toUpperCase();
  const found = TYPE_WORDS.find(([, prefixes]) => prefixes.some((prefix) => word.startsWith(prefix)));
  return found?.[0] ?? 'unknown';
}

/** Which of the two date shapes this DuckDB type word is, or `undefined` for a type whose value is answered as it came. */
function dateShapeOf(sqlType: string): DateShape | undefined {
  const word = sqlType.toUpperCase();
  return DATE_SHAPES.find(([, prefixes]) => prefixes.some((prefix) => word.startsWith(prefix)))?.[0];
}

/**
 * Everything one `DESCRIBE` says, kept per table: the columns a caller sees,
 * how each date column's value is read back, and whether THIS engine loaded the
 * table.
 *
 * WHY `__row` is dropped from `columns` and yet remembered in `hasRowOrder`:
 * `columns()` is what a chart's encoding plane reads, and a bookkeeping column
 * offered as an encodable one would let a sheet draw the load order as if it
 * were data — while the window builder needs to know it is THERE, because it is
 * the last key of every order it renders (`sqlWindow.ts`).
 */
interface TableFacts {
  readonly columns: readonly ColumnInfo[];
  readonly dates: ReadonlyMap<string, DateShape>;
  readonly hasRowOrder: boolean;
}

function tableFactsOf(described: readonly Record<string, unknown>[]): TableFacts {
  const named = described.map((row) => ({ name: String(row['column_name']), sqlType: String(row['column_type']) }));
  const own = named.filter((column) => column.name !== ROW_ORDER_COLUMN);
  return {
    columns: own.map(({ name, sqlType }): ColumnInfo => ({ name, type: columnTypeOf(sqlType) })),
    dates: new Map(own.flatMap(({ name, sqlType }) => {
      const shape = dateShapeOf(sqlType);
      return shape === undefined ? [] : [[name, shape] as const];
    })),
    hasRowOrder: named.some((column) => column.name === ROW_ORDER_COLUMN),
  };
}

/** One number DuckDB sent, as a JS number whether it arrived as a bigint or a double — `undefined` for anything that is not a number at all. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : undefined;
}

/** `SELECT COUNT(*) AS n` answers one row with one number. */
function countOf(rows: readonly Record<string, unknown>[]): number | undefined {
  return numberOf(rows[0]?.['n']);
}

/**
 * A count statement's number, or the sentence for the two ways it can fail to
 * be one — the backend refused, or it answered a row with no number in it.
 *
 * WHY one function: THREE doors ask for a count (the `count` mode, and the
 * second statement each `rows` answer needs), and three copies of a refusal are
 * three sentences a reader can meet for one fact.
 */
function countFrom(asked: Asked<readonly Record<string, unknown>[]>, table: string): Asked<number> {
  if (!asked.ok) return asked;
  const count = countOf(asked.value);
  if (count !== undefined) return { ok: true, value: count };
  return { ok: false, detail: `counting "${table}" came back without a number — the backend answered ${describeAnswer(asked.value)}` };
}

/** The backend's own answer, quoted into a refusal. WHY not bare `JSON.stringify`: a bigint throws on it, and a refusal that throws hides the thing it was refusing. */
function describeAnswer(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(rows, (_key, value: unknown) => (typeof value === 'bigint' ? `${value.toString()}n` : value));
}

/**
 * A returned row as the caller's own: this engine's bookkeeping column removed,
 * each date column read as the ISO string the memory engine holds, every other
 * value borrowed as it came.
 *
 * WHY the dates are converted HERE and not left to the reader: `columns()`
 * calls the column a `date`, and the only value this library has for a date is
 * the string a def declares one with — a raw epoch number would be a `number`
 * where the schema promised a date, in the one place (`EvaluateResult.rows`)
 * that is supposed to mean the same thing in both engines.
 */
function withoutRowOrder(row: Record<string, unknown>, dates: ReadonlyMap<string, DateShape>): Row {
  const { [ROW_ORDER_COLUMN]: _rowOrder, ...rest } = row;
  for (const [name, shape] of dates) {
    if (name in rest) rest[name] = asISOText(rest[name], shape);
  }
  return rest;
}

/** One date value as its ISO text. A value DuckDB sent in a shape this engine did not measure (a string, a null, an object) is answered untouched. */
function asISOText(value: unknown, shape: DateShape): unknown {
  const millis = epochMillisOf(value);
  if (millis === undefined || !Number.isFinite(millis)) return value;
  const iso = new Date(millis).toISOString();
  return shape === 'day' ? iso.slice(0, 10) : iso;
}

/** The three wire shapes a date can arrive in: the number DuckDB sends, a bigint from a lossless conversion, and a `Date` a fake or another driver may hand over. */
function epochMillisOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return value instanceof Date ? value.getTime() : undefined;
}

/**
 * A find's hit row as the caller's own: the three bookkeeping numbers the
 * statement added removed, and the rest read exactly as a window's row is.
 *
 * WHY it reuses `withoutRowOrder` rather than stripping three names itself: a
 * found row is a row, and a date in it must read the way the same date reads in
 * a window — one conversion, one place.
 */
function foundRowOf(raw: Record<string, unknown>, dates: ReadonlyMap<string, DateShape>): Row {
  const { [FIND_POSITION_COLUMN]: _position, [FIND_ORDINAL_COLUMN]: _ordinal, ...rest } = raw;
  return withoutRowOrder(rest, dates);
}

/** Each row's source-order index, or `undefined` if any row failed to carry one — an answer that cannot be trusted is not answered. */
function indicesOf(rows: readonly Record<string, unknown>[]): readonly number[] | undefined {
  const indices: number[] = [];
  for (const row of rows) {
    const index = numberOf(row[ROW_ORDER_COLUMN]);
    if (index === undefined) return undefined;
    indices.push(index);
  }
  return indices;
}

/**
 * A sample key as `deltaByKey` spells it: String() of the value, a date first
 * read back as the ISO text the memory engine holds — so the two engines'
 * sample lists are the same strings for the same rows.
 */
function keyTextOf(value: unknown, shape: DateShape | undefined): string {
  return String(shape === undefined ? value : asISOText(value, shape));
}

/** The five numbers the counts statement answers (`sqlReland.ts`), in the order it names them. */
const RELAND_COUNT_NAMES = ['added', 'updated', 'removed', 'unkeyed', 'keyed'] as const;
type RelandCounts = Readonly<Record<(typeof RELAND_COUNT_NAMES)[number], number>>;

/** The counts statement's one row, each column read as a number — or the NAME of the first one that was not. */
function relandCountsOf(rows: readonly Record<string, unknown>[]): RelandCounts | string {
  const row = rows[0] ?? {};
  const counts: Partial<Record<(typeof RELAND_COUNT_NAMES)[number], number>> = {};
  for (const name of RELAND_COUNT_NAMES) {
    const value = numberOf(row[name]);
    if (value === undefined) return name;
    counts[name] = value;
  }
  return counts as RelandCounts;
}

// ── The provider. ────────────────────────────────────────────────────────

/**
 * Open a wasm-engine provider over a SQL connection. Synchronous, inert: the
 * connection (if it must be opened at all) is opened by the first read that
 * needs one, and reused by every read after it.
 */
export function wasmProvider(options: WasmProviderOptions = {}): DataProvider {
  const declaredTables = [...(options.sources ?? [])];
  const schemas = new Map<string, TableFacts>();
  let opening: Promise<SqlConnection> | undefined;
  let openCause: string | undefined;

  /** The connection, opening it at most once. WHY the cause is remembered rather than the sentence: the sentence names the table that asked, and the next asker is a different table. */
  const connectionFor = async (table: string): Promise<Asked<SqlConnection>> => {
    if (options.connection !== undefined) return { ok: true, value: options.connection };
    if (openCause !== undefined) return { ok: false, detail: openFailedSentence(table, openCause) };
    if (options.open === undefined) return { ok: false, detail: wasmConnectionRefusal(table) };
    try {
      // WHY the promise and not the function is what gets reused: two reads
      // that start before the first one lands must join the SAME open, not
      // race two DuckDB instances into existence.
      opening ??= options.open();
      return { ok: true, value: await opening };
    } catch (error) {
      openCause = causeOf(error);
      return { ok: false, detail: openFailedSentence(table, openCause) };
    }
  };

  const ask = async (connection: SqlConnection, statement: string, table: string): Promise<Asked<readonly Record<string, unknown>[]>> => {
    try {
      return { ok: true, value: await connection.query(statement) };
    } catch (error) {
      return { ok: false, detail: backendRefusedSentence(table, statement, causeOf(error)) };
    }
  };

  /** The table's columns, asked once per table and remembered — a schema is read far more often than it changes, and every read judges its clause against it (see `WasmProviderOptions.connection` for how long "once" lasts). */
  const schemaFor = async (connection: SqlConnection, table: string): Promise<Asked<TableFacts>> => {
    const remembered = schemas.get(table);
    if (remembered !== undefined) return { ok: true, value: remembered };
    const described = await ask(connection, describeSQL(table), table);
    if (!described.ok) return described;
    const facts = tableFactsOf(described.value);
    schemas.set(table, facts);
    return { ok: true, value: facts };
  };

  /** Table judged, connection opened, schema read — the three steps every read shares, in the order a reader meets their refusals. */
  const readyFor = async (table: string): Promise<Asked<{ readonly connection: SqlConnection; readonly schema: TableFacts }> | 'unknown-table'> => {
    if (!declaredTables.includes(table)) return 'unknown-table';
    const opened = await connectionFor(table);
    if (!opened.ok) return opened;
    const schema = await schemaFor(opened.value, table);
    if (!schema.ok) return schema;
    return { ok: true, value: { connection: opened.value, schema: schema.value } };
  };

  /**
   * The new rows into the staging table. Zero rows keep the old schema
   * (`emptyStagingSQL`); any other count lands through the connection's own
   * `load`, which is what assigns the staging table its source order.
   */
  const landStaging = async (connection: LoadingConnection, table: string, staging: string, rows: readonly Row[]): Promise<Asked<void>> => {
    if (rows.length === 0) {
      const emptied = await ask(connection, emptyStagingSQL(table, staging), table);
      return emptied.ok ? { ok: true, value: undefined } : emptied;
    }
    try {
      await connection.load(staging, { kind: 'rows', rows });
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, detail: causeOf(error) };
    }
  };

  /** A refusal met before the replace: the staging table is dropped (best effort — the refusal already names the cause) and the old rows stay. */
  const refusedBeforeReplace = async (connection: SqlConnection, staging: string, detail: string): Promise<DataProviderRejection> => {
    await ask(connection, dropStagingSQL(staging), staging);
    return reject('wasm', 'replaceRows', 'no-backend-connection', detail);
  };

  /**
   * The delta, asked of the backend. WHY `rowCount` is a parameter and not a
   * statement: `replaced` and the `keyAbsent` test are about how many rows the
   * CALLER handed over, which `deltaByKey` reads as `after.length` — the number
   * was known before the staging table existed.
   */
  const deltaOf = async (
    connection: SqlConnection,
    table: string,
    statements: RelandStatements,
    rowCount: number,
    oldDates: ReadonlyMap<string, DateShape>,
    newDates: ReadonlyMap<string, DateShape>,
  ): Promise<Asked<RefreshDelta>> => {
    if (statements.delta === undefined) return { ok: true, value: { keyed: false, replaced: rowCount } };
    const { key, samples } = statements.delta;
    const counted = await ask(connection, statements.delta.counts, table);
    if (!counted.ok) return counted;
    const counts = relandCountsOf(counted.value);
    if (typeof counts === 'string') return { ok: false, detail: `the reland delta for "${table}" came back without a number for ${counts} — the backend answered ${describeAnswer(counted.value)}` };
    // every new row was unkeyed: the delta cannot be exact, and says so — `deltaByKey`'s own test, in its own order
    if (counts.keyed === 0 && rowCount > 0) return { ok: true, value: { keyed: false, replaced: rowCount, keyAbsent: key } };
    const sampleOf = async (statement: string, dates: ReadonlyMap<string, DateShape>): Promise<Asked<readonly string[]>> => {
      const asked = await ask(connection, statement, table);
      return asked.ok ? { ok: true, value: asked.value.map((row) => keyTextOf(row[RELAND_KEY_COLUMN], dates.get(key))) } : asked;
    };
    // one statement at a time: the port is one connection, not a pool (`../def/wasmBackend.ts`)
    const added = await sampleOf(samples.added, newDates);
    if (!added.ok) return added;
    const updated = await sampleOf(samples.updated, newDates);
    if (!updated.ok) return updated;
    const removed = await sampleOf(samples.removed, oldDates);
    if (!removed.ok) return removed;
    return { ok: true, value: { keyed: true, key, added: counts.added, updated: counts.updated, removed: counts.removed, sample: { added: added.value, updated: updated.value, removed: removed.value }, unkeyed: counts.unkeyed } };
  };

  return {
    engine: 'wasm',
    capabilities,

    async tables(): Promise<readonly string[] | DataProviderRejection> {
      // The declared list, and no connection asked for: which tables this
      // provider serves is a fact about the DECLARATION, and answering it must
      // not be the thing that spawns a WASM worker.
      return declaredTables;
    },

    async columns(table: string): Promise<readonly ColumnInfo[] | DataProviderRejection> {
      const ready = await readyFor(table);
      if (ready === 'unknown-table') return reject('wasm', 'columns', 'unknown-table', unknownTableSentence(table, declaredTables));
      if (!ready.ok) return reject('wasm', 'columns', 'no-backend-connection', ready.detail);
      return ready.value.schema.columns;
    },

    async evaluate(
      table: string,
      clause: PredicateClause | readonly PredicateClause[] | null,
      evalOptions: EvaluateOptions = {},
    ): Promise<EvaluateResult | DataProviderRejection> {
      const ready = await readyFor(table);
      if (ready === 'unknown-table') return reject('wasm', 'evaluate', 'unknown-table', unknownTableSentence(table, declaredTables));
      if (!ready.ok) return reject('wasm', 'evaluate', 'no-backend-connection', ready.detail);
      const { connection, schema } = ready.value;
      const names = schema.columns.map((column) => column.name);

      const clauses = clauseList(clause);
      // EVERY column any clause reads must exist — judged here, in this
      // library's words, rather than left to the backend's syntax error.
      const missing = clauses.flatMap((one) => clauseFields(one)).find((field) => !names.includes(field));
      if (missing !== undefined) return reject('wasm', 'evaluate', 'unknown-column', unknownColumnSentence(table, missing));

      // …and so must every column the PROJECTION names, in both modes and
      // BEFORE any statement runs: the same law the memory engine keeps
      // (src/data/README.md). Left to DuckDB it arrived as a Binder Error
      // filed under `no-backend-connection` — a typo reported as a missing
      // database.
      //
      // WHY the row-order column counts as readable while `columns()` never
      // offers it: the table really carries it, and a window already names it
      // itself (`sqlWindow.ts` projects it for `indices` and orders by it for
      // the tie-break). Offering it as an ENCODABLE column would let a sheet
      // draw the load order as data; refusing to read a column the statement
      // itself reads would be a rule this engine breaks on every sorted window.
      const readable = schema.hasRowOrder ? [...names, ROW_ORDER_COLUMN] : names;
      const unreadable = (evalOptions.columns ?? []).find((column) => !readable.includes(column));
      if (unreadable !== undefined) return reject('wasm', 'evaluate', 'unknown-column', `${unknownColumnSentence(table, unreadable)} to return`);

      // The DESCRIPTOR — what the result reports, byte-identical to the memory engine's for the same clause.
      const sql = resolvePredicateSQL(clauses);
      let statement: string;
      try {
        statement = windowSQL(table, sql, evalOptions, { hasRowOrder: schema.hasRowOrder });
      } catch (error) {
        /* v8 ignore next -- windowSQL throws WindowRefusal and nothing else (sqlWindow.ts); rethrowing anything else is how a bug there stays visible instead of arriving as a data refusal */
        if (!(error instanceof WindowRefusal)) throw error;
        return reject('wasm', 'evaluate', error.reason, error.message);
      }
      const missingSort = (evalOptions.sort ?? []).map((key) => key.field).find((field) => !readable.includes(field));
      if (missingSort !== undefined) return reject('wasm', 'evaluate', 'unknown-column', `${unknownColumnSentence(table, missingSort)} to sort by`);

      if (evalOptions.mode === 'count') {
        const counted = countFrom(await ask(connection, statement, table), table);
        if (!counted.ok) return reject('wasm', 'evaluate', 'no-backend-connection', counted.detail);
        return { sql, count: counted.value };
      }

      const answered = await ask(connection, statement, table);
      if (!answered.ok) return reject('wasm', 'evaluate', 'no-backend-connection', answered.detail);
      // WHY a second statement: `count` is how many rows MATCH, and the first
      // statement deliberately returned only the window's own rows. Counting
      // the rows it handed back would report the window's size as the size of
      // the selection — the number a gap check reads.
      const counted = countFrom(await ask(connection, windowSQL(table, sql, { mode: 'count' }), table), table);
      if (!counted.ok) return reject('wasm', 'evaluate', 'no-backend-connection', counted.detail);
      const count = counted.value;

      const indices = evalOptions.indices === true ? indicesOf(answered.value) : undefined;
      if (evalOptions.indices === true && indices === undefined) {
        return reject('wasm', 'evaluate', 'unknown-column', `${unknownColumnSentence(table, ROW_ORDER_COLUMN)} — this engine's tables carry a source-order column assigned at load, so this table was not loaded by it`);
      }
      return {
        sql,
        count,
        rows: answered.value.map((row) => withoutRowOrder(row, schema.dates)),
        ...(evalOptions.offset !== undefined ? { start: Math.min(evalOptions.offset, count) } : {}),
        ...(indices !== undefined ? { indices } : {}),
      };
    },

    async find(
      table: string,
      clause: PredicateClause | readonly PredicateClause[] | null,
      findOptions: FindOptions,
    ): Promise<FindResult | DataProviderRejection> {
      const ready = await readyFor(table);
      if (ready === 'unknown-table') return reject('wasm', 'find', 'unknown-table', unknownTableSentence(table, declaredTables));
      if (!ready.ok) return reject('wasm', 'find', 'no-backend-connection', ready.detail);
      const { connection, schema } = ready.value;
      const names = schema.columns.map((column) => column.name);
      const clauses = clauseList(clause);
      // The judgements in `evaluate`'s order and `evaluate`'s words — a find over
      // a view is the same view, so it cannot refuse it differently.
      const missing = clauses.flatMap((one) => clauseFields(one)).find((field) => !names.includes(field));
      if (missing !== undefined) return reject('wasm', 'find', 'unknown-column', unknownColumnSentence(table, missing));
      const readable = schema.hasRowOrder ? [...names, ROW_ORDER_COLUMN] : names;
      const unsearchable = findOptions.columns.find((column) => !readable.includes(column));
      if (unsearchable !== undefined) return reject('wasm', 'find', 'unknown-column', `${unknownColumnSentence(table, unsearchable)} to look in`);
      // A POSITION needs a total order, and this engine's total order is the
      // source-order column (`sqlWindow.ts`). A table it did not load has none,
      // so the position would be whatever the scan chose — refused in the same
      // words `indices: true` is refused in on the same table.
      if (!schema.hasRowOrder) {
        return reject('wasm', 'find', 'unknown-column', `${unknownColumnSentence(table, ROW_ORDER_COLUMN)} — a find answers a POSITION, and this engine's tables carry a source-order column assigned at load, so this table was not loaded by it`);
      }

      // The DESCRIPTOR is the VIEW's, byte-identical to what `evaluate` reports
      // for the same clause: the text searched for is not part of what the view IS.
      const sql = resolvePredicateSQL(clauses);
      let statements: { readonly hit: string; readonly matches: string };
      try {
        statements = findSQL(table, sql, findOptions);
      } catch (error) {
        /* v8 ignore next -- findSQL throws WindowRefusal and nothing else (sqlWindow.ts); rethrowing anything else is how a bug there stays visible instead of arriving as a data refusal */
        if (!(error instanceof WindowRefusal)) throw error;
        return reject('wasm', 'find', error.reason, error.message);
      }
      const missingSort = (findOptions.sort ?? []).map((key) => key.field).find((field) => !readable.includes(field));
      if (missingSort !== undefined) return reject('wasm', 'find', 'unknown-column', `${unknownColumnSentence(table, missingSort)} to sort by`);

      // WHY the count runs whatever the hit says: a direction with no match ahead
      // still owes the reader how many there are (they are behind), and a count
      // read from the hit row would vanish with it.
      const counted = countFrom(await ask(connection, statements.matches, table), table);
      if (!counted.ok) return reject('wasm', 'find', 'no-backend-connection', counted.detail);
      const answered = await ask(connection, statements.hit, table);
      if (!answered.ok) return reject('wasm', 'find', 'no-backend-connection', answered.detail);
      const raw = answered.value[0];
      if (raw === undefined) return { sql, matches: counted.value, position: null };
      const position = numberOf(raw[FIND_POSITION_COLUMN]);
      const ordinal = numberOf(raw[FIND_ORDINAL_COLUMN]);
      const index = numberOf(raw[ROW_ORDER_COLUMN]);
      // The hit statement NAMES all three numbers and the table was just checked
      // to carry `__row`, so a hit row without them is a backend that broke its
      // own answer — refused, never reported as a position of NaN.
      if (position === undefined || ordinal === undefined || index === undefined) {
        return reject('wasm', 'find', 'no-backend-connection', `finding in "${table}" came back without a position — the backend answered ${describeAnswer(answered.value)}`);
      }
      return { sql, matches: counted.value, position, ordinal, index, row: foundRowOf(raw, schema.dates) };
    },

    async replaceRows(table: string, rows: readonly Row[], relandOptions: RelandOptions = {}): Promise<RelandResult | DataProviderRejection> {
      const ready = await readyFor(table);
      if (ready === 'unknown-table') return reject('wasm', 'replaceRows', 'unknown-table', unknownTableSentence(table, declaredTables));
      if (!ready.ok) return reject('wasm', 'replaceRows', 'no-backend-connection', ready.detail);
      const { connection, schema } = ready.value;
      if (!canLoad(connection)) return reject('wasm', 'replaceRows', 'no-backend-connection', cannotRelandSentence(table));
      // The delta compares each key's FIRST row in source order — the rule
      // `deltaByKey` keeps — and this engine's source order IS the column its
      // loader assigned. A table it did not load has none, refused in the words
      // `find` and `indices: true` already refuse it in.
      if (!schema.hasRowOrder) {
        return reject('wasm', 'replaceRows', 'unknown-column', `${unknownColumnSentence(table, ROW_ORDER_COLUMN)} — a reland compares each key's first row in source order, and this engine's tables carry a source-order column assigned at load, so this table was not loaded by it`);
      }
      const staging = stagingTableOf(table);
      const landed = await landStaging(connection, table, staging, rows);
      if (!landed.ok) return reject('wasm', 'replaceRows', 'no-backend-connection', stagingFailedSentence(table, landed.detail));
      // Everything from here to the replace can still leave the old rows exactly
      // where they are — so on any refusal the staging table is dropped first.
      const described = await ask(connection, describeSQL(staging), table);
      if (!described.ok) return refusedBeforeReplace(connection, staging, described.detail);
      const staged = tableFactsOf(described.value);
      const statements = relandSQL(table, staging, relandOptions.key, { old: schema.columns, new: staged.columns });
      const delta = await deltaOf(connection, table, statements, rows.length, schema.dates, staged.dates);
      if (!delta.ok) return refusedBeforeReplace(connection, staging, delta.detail);
      const replaced = await ask(connection, statements.replace, table);
      if (!replaced.ok) return refusedBeforeReplace(connection, staging, replaced.detail);
      // THE ROWS MOVED — a refusal from here on would break RefreshOutcome's law
      // (`../def/buildDashboard.ts`: "why nothing moved" — a refusal promises
      // nothing did). The remembered schema is the OLD bytes' from here, and it
      // is forgotten unconditionally so the next read re-DESCRIBEs the real
      // table rather than serve stale columns either way.
      schemas.delete(table);
      // The drop and the re-DESCRIBE below are CLEANUP, not the commit: `staged`
      // already named the replaced table's exact schema a moment ago (`replace`
      // is literally `SELECT * FROM staging`), so a failure here answers `ok`
      // from that reading rather than refuse an act that already happened. A
      // drop that fails leaks `__reland_<table>` harmlessly — the next reland's
      // own `CREATE OR REPLACE` on that same name (`landStaging`/
      // `emptyStagingSQL`) overwrites it without anyone needing to know it was
      // there.
      const dropped = await ask(connection, statements.drop, table);
      if (!dropped.ok) return { ok: true, delta: delta.value, columns: staged.columns };
      const fresh = await schemaFor(connection, table);
      if (!fresh.ok) return { ok: true, delta: delta.value, columns: staged.columns };
      return { ok: true, delta: delta.value, columns: fresh.value.columns };
    },

    async materializeColumn(
      table: string,
      _name: string,
      _values: readonly unknown[],
    ): Promise<{ readonly ok: true } | DataProviderRejection> {
      // Its own words, and its own reason: this door is closed by a DECLARED
      // capability a caller can read before calling — not by a missing
      // connection, which may well be open.
      return reject(
        'wasm',
        'materializeColumn',
        'not-implemented',
        `the wasm engine does not support write-back materialization on "${table}" (canMaterialize: false) — materialize on a memory table, or land the column in the table you loaded`,
      );
    },
  };
}
