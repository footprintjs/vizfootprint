/**
 * sqlConnection.ts — THE ONE PORT A SQL BACKEND IS REACHED THROUGH, AND THE
 * LAW THAT A TABLE CARRIES ITS OWN SOURCE ORDER.
 *
 * Two sentences, and everything else in the in-browser engine is written
 * against them:
 *
 *   1. A backend is a thing you can ASK ONE STATEMENT and CLOSE. Nothing else.
 *      No cursor, no transaction, no prepared statement, no Arrow — a provider
 *      that needed any of those would be writing to DuckDB, not to a port.
 *   2. A table this engine LOADS carries the column that says what order its
 *      rows arrived in (`__row`, `sqlWindow.ts`). DuckDB does not promise
 *      insertion order back, so the order is written down ONCE, at load, in the
 *      same statement that reads the bytes — never inferred from a later scan.
 *
 * First customers: `wasmProvider` (asks `query`, and never learns which
 * database answered) and `duckdbConnection` (the one implementation that opens
 * a real DuckDB-WASM database behind this port — dynamically imported, so a
 * caller who never chose the wasm engine never pays for it).
 *
 * WHY the port is here and not in `wasmProvider.ts`: the provider and the
 * DuckDB adapter must both see it, and the provider must NEVER see the
 * adapter. A shared leaf module is what keeps that arrow pointing one way.
 */
import { quoteIdent } from './predicate.js';
import { ROW_ORDER_COLUMN } from './sqlWindow.js';

// ── The data: what a connection is, and what a table is brought in from. ─

/**
 * A backend that answers one SQL statement at a time.
 *
 * WHY rows and not Arrow: the port is the shape the PROVIDER needs, not the
 * shape DuckDB happens to hand back. An adapter that owes plain row objects
 * can be faked in a test in three lines — which is how every law in
 * `wasmProvider` is pinned without a WASM bundle in the room.
 */
export interface SqlConnection {
  query(sql: string): Promise<readonly Record<string, unknown>[]>;
  /** Optional: not every backend owns something to release (a shared connection is closed by whoever opened it). */
  close?(): Promise<void>;
}

/** The bytes a table is brought in FROM: row objects already in memory, or CSV text. */
export type TableData =
  | { readonly kind: 'rows'; readonly rows: readonly Record<string, unknown>[] }
  | { readonly kind: 'csv'; readonly text: string };

/**
 * A connection that can also LAND a table. Separate from {@link SqlConnection}
 * because reading and loading are different privileges: a host handing this
 * engine a connection to a warehouse it does not own gives the first and not
 * the second, and the port has to be able to say so.
 */
export interface SqlLoader {
  load(table: string, data: TableData): Promise<void>;
}

/** Both halves — what {@link duckdbConnection} returns, and what a def that brings its own rows needs. */
export type LoadingConnection = SqlConnection & SqlLoader;

// ── The judgement. ───────────────────────────────────────────────────────

/** Can this connection be asked to land a table, or only to read one? */
export function canLoad(connection: SqlConnection): connection is LoadingConnection {
  return typeof (connection as Partial<SqlLoader>).load === 'function';
}

// ── The one statement the law lives in. ──────────────────────────────────

/**
 * The statement that lands a table WITH its source order.
 *
 * @param from the reader the rows come out of, already rendered — the typed
 *   `read_csv('cases.csv', …, columns={…})` a rows landing writes, or the
 *   `read_csv('cases.csv', header=true, types={…})` a def's CSV text is read by
 *   (`landing.ts` · `rowsReaderSQL`, `csvReaderSQL`).
 *
 * WHY `row_number() OVER ()` and not a later `ALTER TABLE`: the number has to
 * be assigned by the SAME statement that reads the source, while the reader is
 * still handing rows over in the order it read them. A second statement would
 * be numbering whatever order the first scan happened to leave behind — which
 * is the very thing DuckDB does not promise.
 *
 * WHY `- 1`: `row_number()` is 1-based and every index this library speaks in
 * (`EvaluateResult.indices`, the positional row identity `<version>#<index>`)
 * is 0-based, like the memory engine's array positions. One convention, so a
 * row identity means the same thing whichever engine minted it.
 */
export function loadTableSQL(table: string, from: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT *, (row_number() OVER ()) - 1 AS ${quoteIdent(ROW_ORDER_COLUMN)} FROM ${from}`;
}
