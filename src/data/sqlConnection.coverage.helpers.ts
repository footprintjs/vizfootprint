/**
 * sqlConnection.coverage.helpers.ts — THE TWO FAKE BACKENDS EVERY SQL-ENGINE
 * TEST IS JUDGED AGAINST, IN ONE PLACE.
 *
 * The `SqlConnection` port exists so the whole wasm engine can be judged with
 * no WASM bundle, no worker and no network in the room. Two fakes are enough
 * for every law in it, and they are here rather than in one test file because
 * two suites need them and a second hand-written fake would drift:
 *
 *   - {@link fakeSqlConnection} — CANNED. It records the statements it was
 *     asked and answers fixed rows. What `wasmProvider.test.ts` judges the
 *     engine's SQL by: the statement is the assertion, so the answer only has
 *     to be shaped right.
 *   - {@link fakeSqlBackend} — a tiny BACKEND. It can be LANDED (it answers
 *     `SqlLoader`), remembers what landed, and answers out of that — schema,
 *     count, rows, order. What `wasmEngine.def.test.ts` judges the BUILD by:
 *     there the question is whether a def's bytes reached a connection at all,
 *     which canned rows would answer whether they had or not.
 *
 * Not a test file, and never imported by `src/`: the `.coverage.helpers.` in
 * its name is what excludes it from the coverage gate (vitest.config.ts).
 */

import { parseCSVTyped } from './csv.js';
import { ROW_ORDER_COLUMN } from './sqlWindow.js';
import type { LoadingConnection, SqlConnection, TableData } from './sqlConnection.js';

// ── The canned one. ──────────────────────────────────────────────────────

/** A schema wide enough for every column the engine's own tests filter, sort and project on. */
export const SCHEMA_ROWS: readonly Record<string, unknown>[] = [
  { column_name: 'week', column_type: 'BIGINT' },
  { column_name: 'disease', column_type: 'VARCHAR' },
  { column_name: 'cases', column_type: 'DECIMAL(18,3)' },
  { column_name: 'flag', column_type: 'BOOLEAN' },
  { column_name: 'at', column_type: 'TIMESTAMP WITH TIME ZONE' },
  { column_name: 'shape', column_type: 'BLOB' },
  { column_name: 'source', column_type: 'VARCHAR' },
  { column_name: 'target', column_type: 'VARCHAR' },
  { column_name: '__row', column_type: 'BIGINT' },
];

/** Two rows as DuckDB hands them over: bigints, and the engine's own `__row` riding along. */
export const CANNED_ROWS: readonly Record<string, unknown>[] = [
  { week: 1n, disease: 'Lyme', cases: 12, __row: 0n },
  { week: 2n, disease: 'Lyme', cases: 8, __row: 3n },
];

export interface FakeConnection extends SqlConnection {
  readonly asked: readonly string[];
}

export interface FakeOptions {
  readonly rows?: readonly Record<string, unknown>[];
  readonly schema?: readonly Record<string, unknown>[];
  readonly count?: readonly Record<string, unknown>[];
  /** Say a sentence to make that statement throw — how a backend refusal is staged. */
  readonly fail?: (sql: string) => string | undefined;
}

export function fakeSqlConnection(options: FakeOptions = {}): FakeConnection {
  const asked: string[] = [];
  return {
    asked,
    async query(sql: string): Promise<readonly Record<string, unknown>[]> {
      asked.push(sql);
      const failure = options.fail?.(sql);
      if (failure !== undefined) throw new Error(failure);
      if (sql.startsWith('DESCRIBE')) return options.schema ?? SCHEMA_ROWS;
      if (sql.startsWith('SELECT COUNT(*)')) return options.count ?? [{ n: 2n }];
      return options.rows ?? CANNED_ROWS;
    },
  };
}

// ── The one that has to have been LANDED to answer. ──────────────────────

/** The sentence a real backend says about a table nobody loaded — the fake says the same, so a build's failure path is the real one. */
export const catalogRefusal = (table: string): string => `Catalog Error: Table with name ${table} does not exist!`;

export interface FakeBackendOptions {
  /** Refuse to LAND this table, with this sentence. */
  readonly refuseLoad?: (table: string) => string | undefined;
  /** Refuse this statement, with this sentence. */
  readonly fail?: (sql: string) => string | undefined;
}

export interface FakeSqlBackend extends LoadingConnection {
  /** Every statement asked, in order. */
  readonly asked: readonly string[];
  /** Every table landed, in the order it landed, with the bytes it was given. */
  readonly landed: readonly { readonly table: string; readonly data: TableData }[];
  readonly closed: () => boolean;
}

/** The `ORDER BY "col" ASC|DESC` a window asked for, if it asked for one. `NULLS …` is rendered after it and is not read here. */
function orderOf(sql: string): { readonly field: string; readonly descending: boolean } | undefined {
  const found = /ORDER BY "([^"]+)" (ASC|DESC)/.exec(sql);
  return found === null ? undefined : { field: found[1]!, descending: found[2] === 'DESC' };
}

/** Which table a statement reads: `DESCRIBE "t"` names it first, every window names it after `FROM`. */
function tableOf(sql: string): string | undefined {
  const found = /^DESCRIBE "([^"]+)"|FROM "([^"]+)"/.exec(sql);
  return found === null ? undefined : (found[1] ?? found[2]);
}

/**
 * The two DDL shapes a RELAND runs (`sqlReland.ts`): a table becoming a copy of
 * another (with `WHERE FALSE`, an empty copy), and a table going. Bookkeeping
 * over the map, so the wasm engine's no-key reland — land, replace, drop,
 * re-DESCRIBE — can be judged end to end here; the keyed delta is real SQL and
 * is judged against a real DuckDB (`engineInvariant.test.ts`).
 */
function ddlOf(sql: string): { readonly kind: 'replace'; readonly table: string; readonly from: string; readonly empty: boolean } | { readonly kind: 'drop'; readonly table: string } | undefined {
  const replaced = /^CREATE OR REPLACE TABLE "([^"]+)" AS SELECT \* FROM "([^"]+)"( WHERE FALSE)?$/.exec(sql);
  if (replaced !== null) return { kind: 'replace', table: replaced[1]!, from: replaced[2]!, empty: replaced[3] !== undefined };
  const dropped = /^DROP TABLE IF EXISTS "([^"]+)"$/.exec(sql);
  return dropped === null ? undefined : { kind: 'drop', table: dropped[1]! };
}

/** The bytes as rows: what was landed, or what the CSV text says — parsed by this library's own reader, never a second one. */
function rowsOfData(data: TableData): readonly Record<string, unknown>[] {
  return data.kind === 'rows' ? data.rows : parseCSVTyped(data.text).rows;
}

/** …and with this engine's bookkeeping column, which a real load writes in the same statement that reads the bytes. */
function withRowOrder(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map((row, index) => ({ ...row, [ROW_ORDER_COLUMN]: BigInt(index) }));
}

/** `DESCRIBE`'s answer for landed rows: every key the first row carries, typed the two ways this fake can tell apart. */
function describe(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return Object.keys(rows[0] ?? {}).map((name) => ({
    column_name: name,
    column_type: typeof rows[0]?.[name] === 'number' || typeof rows[0]?.[name] === 'bigint' ? 'BIGINT' : 'VARCHAR',
  }));
}

/**
 * A backend that answers only what was landed in it.
 *
 * It is deliberately not a SQL engine: it reads the table name, the mode and
 * the `ORDER BY` out of the statement and answers from its own map. A `WHERE`
 * is not evaluated — which clause narrows which rows is `memoryProvider`'s and
 * `predicate.ts`'s law, pinned there against real rows.
 */
export function fakeSqlBackend(options: FakeBackendOptions = {}): FakeSqlBackend {
  const asked: string[] = [];
  const landed: { table: string; data: TableData }[] = [];
  const held = new Map<string, readonly Record<string, unknown>[]>();
  let shut = false;

  return {
    asked,
    landed,
    closed: () => shut,

    async load(table: string, data: TableData): Promise<void> {
      const refusal = options.refuseLoad?.(table);
      if (refusal !== undefined) throw new Error(refusal);
      landed.push({ table, data });
      held.set(table, withRowOrder(rowsOfData(data)));
    },

    async query(sql: string): Promise<readonly Record<string, unknown>[]> {
      asked.push(sql);
      const failure = options.fail?.(sql);
      if (failure !== undefined) throw new Error(failure);
      const ddl = ddlOf(sql);
      if (ddl?.kind === 'drop') {
        held.delete(ddl.table);
        return [];
      }
      if (ddl?.kind === 'replace') {
        const source = held.get(ddl.from);
        if (source === undefined) throw new Error(catalogRefusal(ddl.from));
        held.set(ddl.table, ddl.empty ? [] : source);
        return [];
      }
      const table = tableOf(sql);
      const rows = table === undefined ? undefined : held.get(table);
      if (rows === undefined) throw new Error(catalogRefusal(String(table)));
      if (sql.startsWith('DESCRIBE')) return describe(rows);
      if (sql.startsWith('SELECT COUNT(*)')) return [{ n: BigInt(rows.length) }];
      const order = orderOf(sql);
      if (order === undefined) return rows;
      const sorted = [...rows].sort((a, b) => String(a[order.field]).localeCompare(String(b[order.field])));
      return order.descending ? sorted.reverse() : sorted;
    },

    async close(): Promise<void> {
      shut = true;
    },
  };
}
