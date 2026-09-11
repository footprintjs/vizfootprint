/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STATEMENTS A RELAND RUNS — ONE RENDERER, NO ENGINE, NO ROW LEAVES.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE LAW (src/data/README.md, "A refresh is computed where the rows live"): a
 * refresh is one act with one answer — `RefreshDelta` (`delta.ts`), counts and
 * samples — and the engine that HOLDS the rows computes it. For the memory
 * engine that is `deltaByKey` over two arrays. For a SQL engine, whose whole
 * point is that a million rows stay in the database, reading them into
 * JavaScript to diff them would defeat the engine; so the delta is asked of
 * SQL, and this module is the SQL.
 *
 * THE SHAPE OF THE ACT, statement by statement:
 *
 *   1. The new rows are LANDED as a staging table — not here: the connection's
 *      own `load` does it with `loadTableSQL`, which is what gives the staging
 *      table its `__row` source order in the same statement that reads the
 *      bytes (`sqlConnection.ts`).
 *   2. `counts`: added / updated / removed / unkeyed / keyed in ONE row, over two
 *      CTEs that hold each side's FIRST row per key. `deltaByKey`'s identity
 *      is the key's String() form and its rule is "first occurrence wins,
 *      later repeats and null keys count as unkeyed"; the CTEs say the same in
 *      SQL — `CAST(key AS VARCHAR)`, `ROW_NUMBER() OVER (PARTITION BY … ORDER
 *      BY "__row")` kept where it is 1, `WHERE key IS NOT NULL`.
 *   3. `samples`: up to `DELTA_SAMPLE` keys per list, each in ITS OWN table's
 *      source order — the order `deltaByKey` walks (added and updated in the
 *      new rows' order, removed in the old rows'). The RAW key value is
 *      selected, never its cast: the provider spells it with String() the way
 *      the memory engine does, so `1.0` reads `"1"` and a date reads as ISO.
 *   4. `replace`: `CREATE OR REPLACE TABLE t AS SELECT * FROM staging` —
 *      atomic in DuckDB, and it COPIES `__row`. WHY not `loadTableSQL` again
 *      over the staging table: a `row_number()` over a scan of it would number
 *      whatever order that scan happened to come back in — the very thing
 *      DuckDB does not promise — while the number the staging table carries
 *      was assigned while the reader was still handing rows over.
 *   5. `drop`: the staging table goes.
 *
 * WHAT "DIFFERENT" MEANS, and why it matches the memory engine byte for byte:
 * `deltaByKey` compares the old row STRIPPED TO THE COLUMNS THE NEW ROWS CARRY
 * against the new row as it is. So a column the old rows had and the new do
 * not is never a difference (it is reported as lost by the caller), and a
 * column the new rows ADD is a difference on EVERY shared key — the old row
 * cannot have it. The `updated` predicate says exactly that: `TRUE` when the
 * staging table has a column the old one lacks, else `IS DISTINCT FROM` OR-ed
 * over the shared columns (null-safe, the way JSON compares two nulls equal).
 *
 * WHAT IT DOES NOT DO: judge the key. A key the staging table lacks is not an
 * error here — that side's CTE is simply EMPTY (`WHERE FALSE`, its `__key`
 * NULL), every statement still binds, `keyed` comes back 0 and the provider
 * answers `keyAbsent` exactly where `deltaByKey` does.
 *
 * FIRST CUSTOMER: `wasmProvider.replaceRows`, which runs these through its one
 * connection and re-DESCRIBEs after. Pinned byte for byte in `sqlReland.test.ts`.
 */
import { quoteIdent } from './predicate.js';
import { ROW_ORDER_COLUMN } from './sqlWindow.js';
import { DELTA_SAMPLE } from './delta.js';
import type { ColumnInfo } from './types.js';

// ── The names: every one prefixed like the engine's other bookkeeping, so a real column cannot be shadowed. ──

/** The column each sample statement answers the key in — the RAW value, read by the provider. */
export const RELAND_KEY_COLUMN = '__key';
/** The first-occurrence rank inside each side's CTE; never leaves the statement. */
const RELAND_NTH_COLUMN = '__nth';
const OLD_CTE = '__old';
const NEW_CTE = '__new';

/** The staging table a reland lands the new rows in: `__reland_<table>` — one per table, so two tables refreshing through one connection never share it. */
export function stagingTableOf(table: string): string {
  return `__reland_${table}`;
}

/** The staging table goes. `IF EXISTS`, so the same statement tidies up after a landing that never happened — which is why it is its own export: a refusal before the replace runs it alone. */
export function dropStagingSQL(staging: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(staging)}`;
}

// ── The data: what the renderer is told, what it answers. ────────────────

/**
 * The two schemas the compare is judged over — each as the provider read it off
 * DESCRIBE, the source-order column included or not (it is never compared).
 *
 * WHY the TYPES ride along and not just the names: a column whose SEMANTIC type
 * moved between versions (`'1'` became `1`, or the other way) is judged the
 * SAME way an ADDED column is — a difference on every shared key, the whole
 * predicate `TRUE` — never compared cell by cell. Two consequences: no CAST is
 * ever rendered for it, so there is no value that cannot be cast (an earlier
 * design compared such a column as TEXT instead, which could read `1` and
 * `'1'` as equal — the dishonest answer, since a value that changed type HAS
 * changed, `delta.ts`'s `same` reads it that way too); and a column whose type
 * merely widened within the SAME semantic bucket (`INTEGER` to `BIGINT`, both
 * `'number'`) compares natively, so `1` and `1.0` stay equal the way they are
 * equal in JavaScript.
 */
export interface RelandColumns {
  readonly old: readonly ColumnInfo[];
  readonly new: readonly ColumnInfo[];
}

/** The statements that answer the KEYED delta — rendered only when a key was declared, and carrying it, so the reader that answers `keyAbsent` names the same key. */
export interface RelandDeltaStatements {
  readonly key: string;
  /** ONE row: `added`, `updated`, `removed`, `unkeyed`, `keyed` (the new side's distinct non-null keys — 0 is how `keyAbsent` is told). */
  readonly counts: string;
  /** Up to `DELTA_SAMPLE` keys per list, each in its own table's source order, the raw value under {@link RELAND_KEY_COLUMN}. */
  readonly samples: { readonly added: string; readonly updated: string; readonly removed: string };
}

export interface RelandStatements {
  /** Absent when no key was declared: the table is `replaced`, and how many rows replaced it was known before any statement ran. */
  readonly delta?: RelandDeltaStatements;
  /** The table becomes the staging table, source-order column and all. */
  readonly replace: string;
  /** …and the staging table goes ({@link dropStagingSQL}). */
  readonly drop: string;
}

/**
 * The staging table for ZERO new rows: the old table's schema with none of its
 * rows. WHY not `load` with an empty array: `read_json_auto` over `[]` infers a
 * single JSON column named `json`, and a refresh that emptied a table would
 * have replaced its columns with a phantom. An empty version keeps the schema;
 * the delta then says every key was removed, exactly as `deltaByKey` does.
 */
export function emptyStagingSQL(table: string, staging: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(staging)} AS SELECT * FROM ${quoteIdent(table)} WHERE FALSE`;
}

// ── The renderer. ────────────────────────────────────────────────────────

/**
 * The statements one reland runs, given the table, the staging table its new
 * rows were landed in, the declared key, and both schemas.
 */
export function relandSQL(table: string, staging: string, key: string | undefined, columns: RelandColumns): RelandStatements {
  const replace = `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM ${quoteIdent(staging)}`;
  const drop = dropStagingSQL(staging);
  if (key === undefined) return { replace, drop };

  const oldHasKey = columns.old.some((column) => column.name === key);
  const newHasKey = columns.new.some((column) => column.name === key);
  const sides = `WITH ${keyedSide(OLD_CTE, table, key, oldHasKey)}, ${keyedSide(NEW_CTE, staging, key, newHasKey)}`;
  const differ = differPredicate(columns);
  // `n` is the new side, `o` the old — the two letters every join below reads by
  const added = `FROM ${NEW_CTE} n LEFT JOIN ${OLD_CTE} o ON o.${RELAND_KEY_COLUMN} = n.${RELAND_KEY_COLUMN} WHERE o.${RELAND_KEY_COLUMN} IS NULL`;
  const updated = `FROM ${NEW_CTE} n JOIN ${OLD_CTE} o ON o.${RELAND_KEY_COLUMN} = n.${RELAND_KEY_COLUMN} WHERE ${differ}`;
  const removed = `FROM ${OLD_CTE} o LEFT JOIN ${NEW_CTE} n ON n.${RELAND_KEY_COLUMN} = o.${RELAND_KEY_COLUMN} WHERE n.${RELAND_KEY_COLUMN} IS NULL`;
  // unkeyed = rows minus first occurrences, per side, summed — null keys and repeats alike, exactly `keyedIndex`'s count
  const unkeyed = `(SELECT COUNT(*) FROM ${quoteIdent(table)}) - (SELECT COUNT(*) FROM ${OLD_CTE}) + (SELECT COUNT(*) FROM ${quoteIdent(staging)}) - (SELECT COUNT(*) FROM ${NEW_CTE})`;
  return {
    delta: {
      key,
      counts: `${sides} SELECT (SELECT COUNT(*) ${added}) AS added, (SELECT COUNT(*) ${updated}) AS updated, (SELECT COUNT(*) ${removed}) AS removed, ${unkeyed} AS unkeyed, (SELECT COUNT(*) FROM ${NEW_CTE}) AS keyed`,
      samples: {
        added: `${sides} SELECT ${keyValueOf('n', key, newHasKey)} AS ${RELAND_KEY_COLUMN} ${added} ORDER BY n.${quoteIdent(ROW_ORDER_COLUMN)} ASC LIMIT ${String(DELTA_SAMPLE)}`,
        updated: `${sides} SELECT ${keyValueOf('n', key, newHasKey)} AS ${RELAND_KEY_COLUMN} ${updated} ORDER BY n.${quoteIdent(ROW_ORDER_COLUMN)} ASC LIMIT ${String(DELTA_SAMPLE)}`,
        removed: `${sides} SELECT ${keyValueOf('o', key, oldHasKey)} AS ${RELAND_KEY_COLUMN} ${removed} ORDER BY o.${quoteIdent(ROW_ORDER_COLUMN)} ASC LIMIT ${String(DELTA_SAMPLE)}`,
      },
    },
    replace,
    drop,
  };
}

/**
 * One side's FIRST row per key, keyed by the key's text. A side whose table
 * lacks the key column is an EMPTY set with the same two bookkeeping columns,
 * so every join and count above binds and answers zero for it.
 */
function keyedSide(cte: string, table: string, key: string, hasKey: boolean): string {
  if (!hasKey) return `${cte} AS (SELECT *, NULL AS ${RELAND_KEY_COLUMN} FROM ${quoteIdent(table)} WHERE FALSE)`;
  const text = `CAST(${quoteIdent(key)} AS VARCHAR)`;
  const ranked = `SELECT *, ${text} AS ${RELAND_KEY_COLUMN}, ROW_NUMBER() OVER (PARTITION BY ${text} ORDER BY ${quoteIdent(ROW_ORDER_COLUMN)} ASC) AS ${RELAND_NTH_COLUMN} FROM ${quoteIdent(table)} WHERE ${quoteIdent(key)} IS NOT NULL`;
  return `${cte} AS (SELECT * FROM (${ranked}) WHERE ${RELAND_NTH_COLUMN} = 1)`;
}

/** The raw key value of one side's row — or its (always NULL) `__key` when that side has no such column, so the statement still binds over the empty set. */
function keyValueOf(alias: string, key: string, hasKey: boolean): string {
  return hasKey ? `${alias}.${quoteIdent(key)}` : `${alias}.${RELAND_KEY_COLUMN}`;
}

/**
 * When two rows with one key are DIFFERENT — the file header's definition. The
 * source-order column is excluded on both sides: it is this engine's
 * bookkeeping, and it would differ for every row that moved.
 */
function differPredicate(columns: RelandColumns): string {
  const old = new Map(columns.old.filter((column) => column.name !== ROW_ORDER_COLUMN).map((column) => [column.name, column.type] as const));
  const fresh = columns.new.filter((column) => column.name !== ROW_ORDER_COLUMN);
  // A column the OLD rows lack, OR whose semantic type moved between the two
  // versions, is a change on EVERY shared key — the added-column "TRUE" rule,
  // widened (see {@link RelandColumns}). Once past this check every remaining
  // shared column's type is PROVEN stable, so the compare below never casts.
  if (fresh.some((column) => !old.has(column.name) || old.get(column.name) !== column.type)) return 'TRUE';
  if (fresh.length === 0) return 'FALSE';
  return fresh.map((column) => `(${sideOf('n', column.name)} IS DISTINCT FROM ${sideOf('o', column.name)})`).join(' OR ');
}

/** One side of a column compare — always the value itself: a type-moved column never reaches here (see {@link differPredicate}), so no CAST is ever needed. */
function sideOf(alias: string, column: string): string {
  return `${alias}.${quoteIdent(column)}`;
}
