/**
 * predicate — pure, engine-independent clause resolution. TWO renderers with
 * two jobs, and neither may drift toward the other:
 *   - `mosaicDescriptorSQL` (the last section) is the ENGINE's byte — the
 *     exact text the real Mosaic factories produce, oddities kept (a half-open
 *     pair as `BETWEEN 150 AND NULL`, a string bound as a double-quoted column
 *     reference). It is what a selection port mints and what
 *     `CommitRecord.predicateSQL` persists.
 *   - `resolvePredicateSQL` is the HONEST, executable SQL the data engines
 *     run, and deliberately diverges on exactly those two shapes (the comment
 *     on `resolveIntervalSQL`).
 * Both replicate Mosaic's literal formatting, verified empirically against
 * the installed package (`@uwdata/mosaic-core@0.28.1`, which re-exports
 * `@uwdata/mosaic-sql`'s literal/operator AST toString()):
 *
 *   node -e "const c=require('@uwdata/mosaic-core');
 *     console.log(String(c.clausePoint('category','Data',{source:{}}).predicate))"
 *   → ("category" IN ('Data'))
 *   node -e "...clausePoint('x', null, {source:{}})..."  → ("x" IS NULL)
 *   node -e "...clauseInterval('amount',[10,20],{source:{}})..." → ("amount" BETWEEN 10 AND 20)
 *
 * Source of the exact literal-formatting rules being replicated:
 *   `node_modules/@uwdata/mosaic-sql/dist/src/ast/literal.js` `literalToSQL`
 *   (number/NaN→NULL, string-quote-doubling, boolean TRUE/FALSE, null→NULL,
 *   Date→`DATE '…'`/`epoch_ms(…)`, RegExp→its `.source`, else string coercion).
 * Source of the point null-safety split being replicated (single-value case
 * only — L1/L2 only ever carry ONE value per point clause):
 *   `node_modules/@uwdata/mosaic-sql/dist/src/functions/operators.js:245-251`
 *   `isInDistinct` — filters null literals out of the IN-list; when that
 *   leaves zero nodes but the caller supplied one value, it falls back to
 *   `isNull(field)` instead of `field IN ()`.
 * Source of the point/interval "no predicate" (clause cleared) split:
 *   `node_modules/@uwdata/mosaic-core/dist/src/SelectionClause.js:14-24,70-82`
 *   `clausePoint`/`clauseInterval` — `value === undefined` (point) /
 *   `value == null` (interval) produce a `null` predicate node, not a SQL
 *   fragment; `CommitRecord.predicateSQL` then literally reads `String(null)`
 *   (`"null"`) at the L1 boundary (`src/log/log.ts`, `commit()`'s
 *   `String(clause.predicateSQL)`). This module mirrors
 *   that exact string so a `DataProvider`'s `sql` field stays byte-identical
 *   to what L1 already recorded for the same commit.
 *
 * This module is deliberately dependency-free (no `@uwdata/mosaic-sql`
 * import) — the memory engine (D24: "the always-on, zero-heavy-dep engine")
 * must not need it installed. The two full engines (wasm/server) may reuse
 * the real library later; this replica exists so engine choice never changes
 * the resolved SQL text (the D24 invariant), even before those engines ship.
 */

import type { CellClause, CellSide, IntervalBounds, IntervalClause, MatchClause, NeighbourhoodClause, PointClause, PredicateClause, Row } from './types.js';
// the ONE display spelling of a neighbourhood's joint field — quoted in this module's refusals, never parsed
import { neighbourhoodFieldLabel } from './types.js';
// the ONE owner of "an array side is an interval" — the same lift the wire translation exports
import { cellSideClause } from './clauseFromWire.js';

/** The JS string Mosaic itself produces for a cleared/inactive clause: `String(null)`. */
const CLEARED_SQL = 'null';

/**
 * THE ONE VERDICT "this value is NULL to the SQL engine": null, undefined, a
 * number that is not finite (NaN, ±Infinity), a Date that is not a date. It
 * is `literalToSQL`'s own `NULL` arm (below, and Mosaic's `literalToSQL` rule
 * for the same four), and it is what the landing writes as `\N` for a value
 * of the column's own type (`landing.ts` · `numberField` / `instantField`) —
 * so a row holding one of these IS a NULL row once it reaches the database.
 * `membershipOf` asks it for a list's entries and `matchesClause`'s match arm
 * for the row's own value, which is how the memory engine answers an IN-list
 * as the database does (three-valued logic, said at `matchesClause`).
 * EXPORTED so the ui contract tier's compiler asks the same verdict rather
 * than keeping a twin (`ui/src/contract/selection.ts`).
 */
export function isSQLNull(value: unknown): boolean {
  return value == null || (typeof value === 'number' && !Number.isFinite(value)) || (isPlainDate(value) && Number.isNaN(timeOf(value)));
}

/** The date's time, read by the LANGUAGE's own method: it throws for anything that is not a real Date, and nothing the value carries can answer in its place. */
const timeOf = (value: unknown): number => DATE_READ.getTime.call(value);

/** The language's own date readers, taken ONCE when this module loads: a method put on `Date.prototype` later is not what a date is read with. */
const DATE_READ = {
  getTime: Date.prototype.getTime,
  getUTCFullYear: Date.prototype.getUTCFullYear,
  getUTCMonth: Date.prototype.getUTCMonth,
  getUTCDate: Date.prototype.getUTCDate,
};

/**
 * A REAL date, and nothing more: made by `Date` itself (it has the internal
 * time, so the built-in reader does not throw), straight off `Date.prototype`,
 * with nothing of its own on it.
 *
 * WHY so strict: `instanceof Date` is true of any object placed over
 * `Date.prototype`, and of a real date given its own `getUTCFullYear`. A date
 * is rendered from its parts, so an object that answers for those parts wrote
 * its own text into the SQL: `DATE '2020-01-01'::VARCHAR) OR (1=1) …`. A
 * subclass instance is refused for the same reason: its methods are its own.
 */
export function isPlainDate(value: unknown): value is Date {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Date.prototype) return false;
  if (Reflect.ownKeys(value).length > 0) return false;
  try {
    timeOf(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replicates `literalToSQL` (`ast/literal.js`, cited in the file header)
 * exactly for the value types this package's clauses actually carry
 * (number/string/boolean/null/Date). Anything else throws — an HONEST
 * failure (never a silently wrong SQL fragment) rather than a fabricated
 * literal for a type this replica does not cover (RegExp / plain-object
 * literals are Mosaic-supported but never appear in a `PredicateClause`
 * here, since L1/L2 only ever carry JSON-serializable commit values).
 * The `NULL` arm is asked FIRST and asked of {@link isSQLNull}, so the
 * membership a list builds and the literal a list renders cannot part.
 */
export function literalToSQL(value: unknown): string {
  if (isSQLNull(value)) return 'NULL';
  switch (typeof value) {
    case 'number':
      return `${value}`;
    case 'string':
      return `'${value.replaceAll(`'`, `''`)}'`;
    case 'boolean':
      return value ? 'TRUE' : 'FALSE';
    default:
      if (isPlainDate(value)) {
        // read through the language's own methods, on a value that carries none of its own
        const ts = timeOf(value);
        const y = DATE_READ.getUTCFullYear.call(value);
        const m = DATE_READ.getUTCMonth.call(value);
        const d = DATE_READ.getUTCDate.call(value);
        return ts === Date.UTC(y, m, d) ? `DATE '${y}-${m + 1}-${d}'` : `epoch_ms(${ts})`;
      }
      throw new TypeError(
        `literalToSQL: unsupported literal type "${Object.prototype.toString.call(value)}" — ` +
          'only number/string/boolean/null/Date are honestly replicated (see predicate.ts header)',
      );
  }
}

/** How one clause value is written into SQL text: {@link literalToSQL} for a descriptor, {@link exactLiteralSQL} for a statement an engine runs. */
type LiteralWriter = (value: unknown) => string;

/**
 * A LITERAL A SQL ENGINE READS AS THE NUMBER IT WAS WRITTEN FROM. The same as
 * {@link literalToSQL} for everything but a number with a fraction, which is
 * written in exponent form (`1.0733333333333333e+2`).
 *
 * WHY. DuckDB reads plain decimal text as a fixed-point DECIMAL
 * (`typeof(107.33333333333333)` is `DECIMAL(17,14)`), and its conversion of
 * that DECIMAL to the DOUBLE the column holds is not exact. Measured on 5,000
 * doubles: `"v" BETWEEN lit(v) AND lit(v)` found the row holding `v` itself for
 * 4,860 of them. So a filter whose bound IS a value in the data could leave
 * that row out, and the SQL engine disagreed with the memory engine, which
 * compares doubles exactly. Text with an exponent is read as a DOUBLE and
 * round-trips: 5,000 of 5,000, for `BETWEEN`, `>=`, `<=`, `IN` and `=`.
 *
 * AN INTEGER STAYS PLAIN. DuckDB reads it as an integer type and compares it
 * exactly, with no cast put on an integer column (a DOUBLE literal would cast
 * the column, and two BIGINTs past 2^53 would then compare equal).
 *
 * `CAST(x AS DOUBLE)` and `x::DOUBLE` do NOT help: the text is read as a
 * DECIMAL first and converted the same inexact way (measured: 4,860 and 4,896).
 *
 * THIS IS NEVER THE RECORDED TEXT. The descriptor a result reports and the
 * byte the log keeps are {@link literalToSQL}'s, which is Mosaic's own plain
 * decimal rule; only the statement handed to an engine is written this way.
 */
export function exactLiteralSQL(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value) ? value.toExponential() : literalToSQL(value);
}

/**
 * ONE PLAIN VALUE: what a selection may compare a column with. A string, a
 * number, a boolean, `null` or a real date ({@link isPlainDate}) — the values {@link literalToSQL}
 * writes as one quoted or numeric literal. An array, a record, a function, a
 * bigint or a symbol is not one.
 */
export function isPlainValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || isPlainDate(value);
}

const isPairOf = (value: unknown, each: (v: unknown) => boolean): boolean => Array.isArray(value) && value.length === 2 && value.every(each);
const article = (value: unknown): string => (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]' ? 'a date that is not a plain Date (one from another realm, a subclass, a wrapped one, or one with something of its own on it)' : Array.isArray(value) ? 'an array' : value === undefined ? 'nothing' : `a ${typeof value === 'object' ? 'record' : typeof value}`);

/**
 * THE DOOR RULE for a selection's value, by kind: a sentence naming the first
 * value that is not plain, or `null` when every value the clause compares a
 * column with is one (for a walk: the node it starts from, the node a path runs
 * to, and every id it reached). A session asks it BEFORE the act is judged, so the
 * caller gets a typed refusal that says what to send instead; the renderer's
 * own refusal ({@link mosaicDescriptorSQL}) stays behind it for every other
 * caller of a selection port.
 *
 * Only the VALUES are judged. A body of the wrong outer shape (a match with no
 * list, a cell that is not a pair) is left to the judge that already names it.
 * A cleared selection (`null`) has no value to judge.
 */
export function notOnePlainValue(kind: 'point' | 'interval' | 'match' | 'cell' | 'neighbourhood', value: unknown): string | null {
  if (value === null) return null;
  /** The first entry of a list that fails `ok`, named; `null` when none does or there is no list. */
  const firstNot = (list: unknown, ok: (v: unknown) => boolean): string | null => {
    if (!Array.isArray(list)) return null;
    const at = list.findIndex((v) => !ok(v));
    return at < 0 ? null : article(list[at]);
  };
  switch (kind) {
    case 'point':
      return isPlainValue(value)
        ? null
        : `a point selects ONE plain value (a string, number, boolean or date) — got ${article(value)}; send several values as \`values\`, and a range as a filter`;
    case 'interval': {
      const got = firstNot(value, isPlainValue);
      return got === null ? null : `each bound of a range is one plain value or null — got ${got}`;
    }
    case 'match': {
      const got = firstNot((value as { values?: unknown } | undefined)?.values, isPlainValue);
      return got === null ? null : `each of the values is one plain value — got ${got}`;
    }
    case 'cell': {
      const got = firstNot(value, (side) => isPlainValue(side) || isPairOf(side, isPlainValue));
      return got === null ? null : `each side of a cell is one plain value or a [low, high] pair of them — got ${got}`;
    }
    case 'neighbourhood': {
      // the question (the node it starts from, the node a path runs to) and the answer (the walked ids):
      // each is a node's id, and a node's id is one plain value. A key the body does not carry is not judged.
      const body = (typeof value === 'object' ? value : {}) as { seed?: unknown; to?: unknown; ids?: unknown };
      if (body.seed !== undefined && !isPlainValue(body.seed)) return `a walk starts from ONE plain value naming a node — got ${article(body.seed)}`;
      if (body.to !== undefined && !isPlainValue(body.to)) return `a path runs to ONE plain value naming a node — got ${article(body.to)}`;
      const got = firstNot(body.ids, isPlainValue);
      return got === null ? null : `a node's id is one plain value, and the walk reached one that is not — got ${got}; a column holding lists or records cannot be an endpoint`;
    }
  }
}

/**
 * Double-quoted identifier, escaping an embedded `"` by doubling it (standard
 * SQL quoting). EXPORTED because `sqlWindow` quotes the same names around the
 * same fragment — one quoting rule for the whole statement, never two.
 */
export function quoteIdent(field: string): string {
  return `"${field.replaceAll('"', '""')}"`;
}

function resolvePointSQL(clause: PointClause, write: LiteralWriter): string {
  if (clause.value === undefined) return CLEARED_SQL; // clausePoint: value===undefined -> no predicate
  if (clause.value === null) return `(${quoteIdent(clause.field)} IS NULL)`; // isInDistinct null-safety fallback
  return `(${quoteIdent(clause.field)} IN (${write(clause.value)}))`;
}

/**
 * TWO documented divergences from the byte-parity contract in the file header:
 *
 * 1. STRING interval bounds (ISO-8601 dates) render as SQL string LITERALS
 *    here, while real Mosaic's `isBetween` (operators.js:219-221) maps
 *    extents through `asNode` (ast.js:16-17: `isString(value) ?
 *    column(value) : asLiteral(value)`) and so renders a string extent as a
 *    quoted COLUMN IDENTIFIER — a reference to a nonexistent column
 *    (Mosaic's interval extents are meant to be numbers/Dates; strings fall
 *    outside its input domain). Replicating that would fabricate
 *    non-executable SQL, so this seam stays honest instead (pinned in
 *    predicate.test.ts against the real factory's output).
 *
 * 2. HALF-OPEN bounds (one side `null`) have no Mosaic analog at all — a real
 *    `clauseInterval` only ever builds `BETWEEN`. This is this layer's own
 *    extension (see `IntervalBounds` in types.ts, mirroring the `'match'`
 *    clause precedent below): a `null` bound renders as a one-sided `>=`/`<=`
 *    comparison instead of `BETWEEN`, honest SQL for a shape Mosaic cannot
 *    express.
 */
function resolveIntervalSQL(clause: IntervalClause, write: LiteralWriter): string {
  if (clause.value === null) return CLEARED_SQL; // clauseInterval: value==null -> no predicate
  const [lo, hi] = clause.value;
  const field = quoteIdent(clause.field);
  if (lo === null) return `(${field} <= ${write(hi)})`;
  if (hi === null) return `(${field} >= ${write(lo)})`;
  return `(${field} BETWEEN ${write(lo)} AND ${write(hi)})`;
}

/**
 * `'match'` is this layer's own trivial addition (see types.ts header) — an
 * empty `values` list is a real, always-false predicate (`FALSE`), not the
 * "cleared" state (that is `clause === null` at the `evaluate()` level).
 */
function resolveMatchSQL(clause: MatchClause, write: LiteralWriter): string {
  if (clause.values.length === 0) return clause.exclude === true ? '(TRUE)' : '(FALSE)';
  const op = clause.exclude === true ? 'NOT IN' : 'IN';
  return `(${quoteIdent(clause.field)} ${op} (${clause.values.map(write).join(', ')}))`;
}

/*
 * A cell side is lifted into the clause the existing arms already handle by
 * `cellSideClause` (imported above, `clauseFromWire.ts`): an array side is an
 * interval, anything else is a point — so the D30 cell reuses the exact
 * numeric/string interval discipline, half-open included, and the point
 * three-way split. A side is never `undefined` (per the type), so the point
 * arm's cleared-by-undefined branch is out of reach for a cell by
 * construction. It lives beside the wire translation because that is the same
 * rule: which of the two shapes a side IS.
 */

/** Render ONE cell side by delegating to the existing point/interval arms. */
function resolveCellSideSQL(field: string, side: CellSide, write: LiteralWriter): string {
  const clause = cellSideClause(field, side);
  return clause.kind === 'interval' ? resolveIntervalSQL(clause, write) : resolvePointSQL(clause, write);
}

/**
 * The compound cell descriptor (D30): the AND of both sides, wrapped once —
 * byte-identical to what the log's own descriptor produces for the same
 * commit (real Mosaic `and(px, py)` renders `(("price" BETWEEN 100 AND 150)
 * AND ("category" IN ('Formal')))` — verified against the installed package,
 * pinned in predicate.test.ts). Half-open/string-extent sides diverge from
 * the log's descriptor exactly as plain intervals already do (the TWO
 * documented divergences above) — this stays the one honest SQL.
 */
function resolveCellSQL(clause: CellClause, write: LiteralWriter): string {
  if (clause.value === null) return CLEARED_SQL; // whole cell cleared -> no predicate
  const [vx, vy] = clause.value;
  return `(${resolveCellSideSQL(clause.fields[0], vx, write)} AND ${resolveCellSideSQL(clause.fields[1], vy, write)})`;
}

/**
 * The NEIGHBOURHOOD (packet 5): the AND of two IN-lists over one id set — a
 * row is kept when BOTH endpoint columns name a node in the set, which is the
 * INDUCED ego subgraph the chart draws for the same gesture. "Either endpoint"
 * would also keep a neighbour's tie to a stranger outside the recorded set.
 *
 * The id list is rendered ONCE and read twice: the two arms test the same set,
 * so a second render would only be a second chance to disagree with the first.
 * An empty set is a real always-false predicate (`(FALSE)`) — the exact rule
 * an empty keep-list follows above, and never "everything".
 */
function resolveNeighbourhoodSQL(clause: NeighbourhoodClause, write: LiteralWriter): string {
  if (clause.ids.length === 0) return '(FALSE)';
  const ids = clause.ids.map(write).join(', ');
  const [source, target] = clause.fields;
  return `((${quoteIdent(source)} IN (${ids})) AND (${quoteIdent(target)} IN (${ids})))`;
}

/**
 * Resolve a clause to its predicate SQL text. `clause === null` means "no
 * filter" at the `evaluate()` level (distinct from a point/interval clause
 * whose OWN value clears it) and resolves to the same `"null"` descriptor
 * Mosaic's own cleared clauses produce, for one consistent "no predicate"
 * spelling across both routes.
 */
export function resolvePredicateSQL(clause: PredicateClause | readonly PredicateClause[] | null): string {
  return renderPredicateSQL(clause, literalToSQL);
}

/**
 * THE SAME PREDICATE AS A STATEMENT AN ENGINE RUNS: clause for clause the text
 * {@link resolvePredicateSQL} renders, with every number written so the engine
 * reads the number it was written from ({@link exactLiteralSQL}). The two differ
 * only where a bound has a fraction.
 *
 * ONE RENDERER, TWO WRITERS. Both go through `renderPredicateSQL`, so the shape
 * of the predicate (which clauses, which operators, how a list is joined, what
 * is cleared) cannot differ between what is reported and what is run. Only the
 * spelling of a number can.
 */
export function executablePredicateSQL(clause: PredicateClause | readonly PredicateClause[] | null): string {
  return renderPredicateSQL(clause, exactLiteralSQL);
}

function renderPredicateSQL(clause: PredicateClause | readonly PredicateClause[] | null, write: LiteralWriter): string {
  if (clause === null) return CLEARED_SQL;
  if (Array.isArray(clause)) {
    // a list is its AND, each side parenthesised; an empty list is no filter — the same descriptor every engine renders
    // a cleared clause in a list is no conjunct (it keeps every row), never `AND (null)`
    const parts = (clause as readonly PredicateClause[]).map((c) => renderPredicateSQL(c, write)).filter((p) => p !== CLEARED_SQL);
    return parts.length === 0 ? CLEARED_SQL : parts.length === 1 ? parts[0]! : parts.map((p) => `(${p})`).join(' AND ');
  }
  const one = clause as PredicateClause;
  switch (one.kind) {
    case 'point':
      return resolvePointSQL(one, write);
    case 'interval':
      return resolveIntervalSQL(one, write);
    case 'match':
      return resolveMatchSQL(one, write);
    case 'cell':
      return resolveCellSQL(one, write);
    case 'neighbourhood':
      return resolveNeighbourhoodSQL(one, write);
  }
}

/** True when a resolved SQL string denotes "no filter" (either route to CLEARED_SQL, or a literal FALSE guard is NOT this). */
export function isClearedSQL(sql: string): boolean {
  return sql === CLEARED_SQL;
}

// ── mosaicDescriptorSQL — the byte the ENGINE's own rules render ────────────
//
// `resolvePredicateSQL` above is the honest SQL and deliberately diverges from
// Mosaic on two shapes (the comment on `resolveIntervalSQL`). This section
// deliberately does NOT: it renders the SAME string real Mosaic renders for
// every kind × shape a `CauseClauseSpec` carries, measured on
// `@uwdata/mosaic-core@0.28.1` and pinned in predicate.test.ts against the real
// factories. WHY two renderers: `CommitRecord.predicateSQL` is the one
// persisted engine-derived byte, and a log written by the built-in selection
// port and by the Mosaic adapter must be byte-identical — so the built-in
// renders Mosaic's rules, oddities included: a half-open pair as
// `BETWEEN 150 AND NULL`, a string bound as a double-quoted COLUMN reference
// (`asNode`, ast.js:16-17: `isString(value) ? column(value) : asLiteral(value)`),
// a cleared clause as `String(null)`.

/**
 * A plain record whose string coercion is the language's own: `{}`-shaped,
 * nothing on it or above it that answers `toString`, `valueOf` or
 * `Symbol.toPrimitive` differently. Its coercion is the constant
 * `[object Object]` whatever it holds, so nothing inside it can reach the byte.
 */
function coercesAsPlainRecord(value: object): boolean {
  const v = value as { toString?: unknown; valueOf?: unknown; [Symbol.toPrimitive]?: unknown; [Symbol.toStringTag]?: unknown };
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    v.toString === Object.prototype.toString &&
    v.valueOf === Object.prototype.valueOf &&
    v[Symbol.toPrimitive] === undefined &&
    v[Symbol.toStringTag] === undefined
  );
}

/**
 * Mosaic's `literalToSQL` (ast/literal.js) for every value whose rendering is
 * INERT, and a refusal for every value whose rendering would be the value's
 * own text, unquoted.
 *
 * Mosaic's last arm is string coercion (`${value}`). For a plain record that
 * is the constant `[object Object]`, and it is kept: the log has always
 * carried record-valued point commits (an analysis declaration, a chart's act
 * on the `pValue` lane), and the byte Mosaic persisted for them is that
 * constant. A bigint coerces to its digits and is kept too.
 *
 * For anything else the coercion WRITES THE VALUE'S OWN CONTENT INTO THE SQL
 * WITH NO QUOTING: an array is its elements joined by commas (so
 * `["1) OR (1=1"]` is that text), a RegExp its source between quotes nothing
 * escaped, a function its source code, an object with its own `toString`
 * whatever that returns. This renderer used to reproduce all of them. Every
 * one is refused now, with the TypeError a selection port already answers as
 * `unsupported-shape` — and because both ports ask this judge BEFORE they mint
 * a clause, the real engine is never handed the value either.
 */
function mosaicLiteralSQL(value: unknown): string {
  if (typeof value === 'bigint') return `${value}`;
  if (value !== null && typeof value === 'object' && !isPlainDate(value)) {
    if (coercesAsPlainRecord(value)) return '[object Object]';
    throw new TypeError(
      `mosaicDescriptorSQL: a value must be one plain value (a string, number, boolean, null or date) or a plain record — got ${Object.prototype.toString.call(value)}, whose text would be written into the SQL unquoted`,
    );
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    throw new TypeError(`mosaicDescriptorSQL: a value must be one plain value — got a ${typeof value}`);
  }
  return literalToSQL(value);
}

/** Mosaic's `asNode` over one interval extent: a string is a column reference, anything else a literal. */
function mosaicBoundSQL(bound: unknown): string {
  return typeof bound === 'string' ? quoteIdent(bound) : mosaicLiteralSQL(bound);
}

/** `clausePoint`: `undefined` → no predicate; `null` → the `isInDistinct` IS NULL fallback; anything else → IN (literal). */
function mosaicPointSQL(field: string, value: unknown): string {
  if (value === undefined) return CLEARED_SQL;
  if (value === null) return `(${quoteIdent(field)} IS NULL)`;
  return `(${quoteIdent(field)} IN (${mosaicLiteralSQL(value)}))`;
}

/** `clauseInterval`: `value != null ? isBetween(field, value) : null` — always BETWEEN, both extents through `asNode`. */
function mosaicIntervalSQL(field: string, value: unknown): string {
  if (value == null) return CLEARED_SQL;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(
      `mosaicDescriptorSQL: an interval value must be a [lo, hi] pair — "${field}" got ${Object.prototype.toString.call(value)}`,
    );
  }
  return `(${quoteIdent(field)} BETWEEN ${mosaicBoundSQL(value[0])} AND ${mosaicBoundSQL(value[1])})`;
}

/**
 * A value INSIDE a compound (a cell side, a match entry) must render a
 * predicate: `undefined` there is a point's "cleared", not a value, and the
 * real builders refuse it rather than landing a half-empty AND/OR.
 */
function concrete(sql: string, field: string, where: string): string {
  if (sql === CLEARED_SQL) {
    throw new TypeError(
      `mosaicDescriptorSQL: a ${where} must be concrete — "${field}" got undefined; clear the WHOLE clause with value: null instead`,
    );
  }
  return sql;
}

/** One cell side through the real factory for its shape: an array side is `clauseInterval`, anything else `clausePoint`. */
function mosaicCellSideSQL(field: string, side: unknown): string {
  return concrete(Array.isArray(side) ? mosaicIntervalSQL(field, side) : mosaicPointSQL(field, side), field, 'cell side');
}

/** The D30 cell: the real `and` of both sides — `((x) AND (y))`; `null` clears the whole cell. */
function mosaicCellSQL(fields: readonly [string, string], value: unknown): string {
  if (value === null) return CLEARED_SQL;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(
      `mosaicDescriptorSQL: a cell value must be a [x side, y side] pair — got ${Object.prototype.toString.call(value)}`,
    );
  }
  return `(${mosaicCellSideSQL(fields[0], value[0])} AND ${mosaicCellSideSQL(fields[1], value[1])})`;
}

/**
 * The SET-1 match: every entry through `clausePoint`, the arms through the
 * real `or` (`((a) OR (b))`), the polarity through the real `not`
 * (`(NOT …)`); an empty keep-list is `literal(false)` — `FALSE`, unwrapped.
 */
function mosaicMatchSQL(field: string, value: unknown): string {
  if (value === null) return CLEARED_SQL;
  const body = value as { values?: unknown; exclude?: unknown } | undefined;
  if (typeof body !== 'object' || !Array.isArray(body.values)) {
    throw new TypeError(
      `mosaicDescriptorSQL: a match value must be { values, exclude? } — "${field}" got ${Object.prototype.toString.call(value)}`,
    );
  }
  const arms = body.values.map((v: unknown) => concrete(mosaicPointSQL(field, v), field, 'match value'));
  const inList = arms.length === 0 ? 'FALSE' : arms.length === 1 ? arms[0]! : `(${arms.join(' OR ')})`;
  return body.exclude === true ? `(NOT ${inList})` : inList;
}

/**
 * The neighbourhood as the ENGINE renders it:
 * `and(isIn(column(source), ids.map(literal)), isIn(column(target), ids.map(literal)))`
 * — the call predicate.test.ts pins against the real factories. The real `and`
 * wraps the whole and parenthesises each arm, and the real `isIn` renders
 * `("field" IN (a, b))`, both measured on `@uwdata/mosaic-sql@0.28.1`.
 *
 * WHY every id rides through `literal()`: `isIn` maps its arguments through
 * Mosaic's `asNode`, which reads a bare STRING as a COLUMN reference — an
 * interval's extents keep that oddity (see {@link mosaicBoundSQL}), but a
 * walked id is a VALUE, so it is made a literal before the factory sees it.
 *
 * WHY `isIn` and not the point factory's `isInDistinct` (which the match arm
 * above reaches through `clausePoint`): a neighbourhood's ids are node keys a
 * walk MATERIALIZED, never a value a person typed, so the `IS NULL` fallback
 * is not wanted; a `null` that does reach the list renders as the literal
 * `NULL`, which keeps no row, rather than being quietly rewritten into an
 * `IS NULL` that would keep every row missing an endpoint.
 *
 * The empty-set `FALSE` is THIS layer's rule (the empty match keep-list
 * precedent), not a byte the two-arm chain renders — over an empty list that
 * chain renders `IN ()`.
 */
function mosaicNeighbourhoodSQL(fields: readonly [string, string], value: unknown): string {
  if (value === null) return CLEARED_SQL;
  const body = value as { ids?: unknown } | undefined;
  if (typeof body !== 'object' || !Array.isArray(body.ids)) {
    throw new TypeError(
      `mosaicDescriptorSQL: a neighbourhood value must carry the walked list — "${neighbourhoodFieldLabel(fields)}" got ids: ${Object.prototype.toString.call(body?.ids)} (seed, derivation and hops ride beside it and are not read here)`,
    );
  }
  if (body.ids.length === 0) return 'FALSE';
  const ids = (body.ids as readonly unknown[]).map(mosaicLiteralSQL).join(', ');
  return `((${quoteIdent(fields[0])} IN (${ids})) AND (${quoteIdent(fields[1])} IN (${ids})))`;
}

/**
 * The exact `String(clause.predicate)` real Mosaic renders for a clause of this
 * kind over this value — the byte `CommitRecord.predicateSQL` persists.
 *
 * Values are CLAUSE-tier: a point's `undefined` clears and its `null` is a
 * real IS NULL (the caller applies `pointValueFromWire` first, as every clause
 * builder does); an interval's/cell's/match's `null` clears. A cleared clause
 * renders `String(null)`, the same `"null"` `isClearedSQL` recognises.
 *
 * A shape the real factories would refuse or never see — an undefined cell
 * side or match entry, an interval or cell that is not a pair, a match body
 * without a list, a value string coercion refuses (a Symbol) — THROWS a
 * TypeError rather than fabricating a byte; a selection port catches it once
 * at its door and answers `unsupported-shape`. A plain object is NOT refused:
 * Mosaic coerces it to `[object Object]`, and so does this (see
 * `mosaicLiteralSQL`).
 */
export function mosaicDescriptorSQL(kind: 'cell' | 'neighbourhood', fields: readonly [string, string], value: unknown): string;
export function mosaicDescriptorSQL(kind: 'point' | 'interval' | 'match', field: string, value: unknown): string;
export function mosaicDescriptorSQL(
  kind: 'point' | 'interval' | 'cell' | 'match' | 'neighbourhood',
  field: string | readonly [string, string],
  value: unknown,
): string {
  // the overloads above pair each kind with its field shape; the casts below only restate that pairing
  switch (kind) {
    case 'point':
      return mosaicPointSQL(field as string, value);
    case 'interval':
      return mosaicIntervalSQL(field as string, value);
    case 'match':
      return mosaicMatchSQL(field as string, value);
    case 'cell':
      return mosaicCellSQL(field as readonly [string, string], value);
    case 'neighbourhood':
      return mosaicNeighbourhoodSQL(field as readonly [string, string], value);
  }
}

/**
 * An interval's (non-null) bounds are either all numbers or all strings (see
 * `IntervalClause` in types.ts — the two never mix), and at least one side is
 * non-null (`IntervalBounds` forbids `[null, null]`), so checking EITHER
 * element for `'string'` decides the pair — whichever side is the null one
 * carries no type information, but the other side always does. String bounds
 * are ISO-8601 dates: SQL `BETWEEN`/`>=`/`<=` over strings is lexicographic,
 * and for uniform ISO-8601 lexicographic IS chronological — the resolved SQL
 * and this in-process filter agree.
 */
function isStringBounds(
  value: IntervalBounds<number> | IntervalBounds<string>,
): value is IntervalBounds<string> {
  return typeof value[0] === 'string' || typeof value[1] === 'string';
}

/**
 * THE MEMBERSHIP OF ONE IN-LIST — the set the memory engine asks per row, in
 * place of the list. `set` holds the list's entries that are values to the SQL
 * engine, under the Set's own SameValueZero (which is DuckDB's equality on
 * every value a list can carry: `0` and `-0` are one member, a string and a
 * number are two); `holdsNull` says whether an entry the engine reads as NULL
 * rode in the list ({@link isSQLNull}), because `NOT IN (…, NULL)` is never
 * TRUE and the exclude arm has to know.
 */
export interface Membership {
  readonly set: ReadonlySet<unknown>;
  readonly holdsNull: boolean;
}

/**
 * The membership of ONE list, built once and kept for as long as the list's
 * own array is alive. `matchesClause` is asked per ROW, and the question does
 * not change between rows — a match with 10,000 values over 20,598 rows cost
 * 185 ms when every row scanned the list (`bench/via/README.md`), and a
 * neighbourhood asks the same membership twice per row (once per endpoint) —
 * so the set is built outside the per-row call, once per array. TWO arms, ONE
 * membership: the match arm and the neighbourhood arm both ask here.
 *
 * Keyed by the ARRAY and not the clause object: the two doors that build a
 * clause from one commit (`clauseFromWire`, and a session's own live clause)
 * hand back different clause objects over the SAME borrowed array, and both
 * should meet the set the first of them built.
 *
 * THE BORROW LAW this rests on: a `values` or `ids` array is minted once and
 * never mutated after — a walk's recorded answer, a travel's folded near
 * values (`../session/session.ts` · `nearValues`, `travelByIdentity`, both a
 * fresh array), the log's deep-frozen record. The session's live clause is
 * built over the RECORD's array, never the dispatcher's (`session.ts` ·
 * `doProbe`), so a caller that keeps mutating the array it passed changes
 * nothing. A hand-built clause must build a NEW array rather than push into a
 * live one: the set is read ONCE per array; a later push would be seen by
 * `resolvePredicateSQL` (which re-reads the array) and not by this filter,
 * and one clause would have two readings.
 *
 * WHY NULL entries are dropped from the set and remembered beside it: SQL's
 * `IN (NULL)` is never TRUE, so the renderers keep no row for one — a Set
 * carrying `null` would instead keep every row whose value is missing, which
 * is the very hazard `../session/neighbourhood.ts`'s walk refuses at the
 * producer; and the same is true of NaN and ±Infinity, which `literalToSQL`
 * renders as `NULL` too. EXPORTED for the ui contract tier's compiler, which
 * closes over the same set (`ui/src/contract/selection.ts`).
 */
const memberships = new WeakMap<readonly unknown[], Membership>();

export function membershipOf(list: readonly unknown[]): Membership {
  const known = memberships.get(list);
  if (known !== undefined) return known;
  const set = new Set<unknown>();
  let holdsNull = false;
  for (const entry of list) {
    if (isSQLNull(entry)) holdsNull = true;
    else set.add(entry);
  }
  const built: Membership = { set, holdsNull };
  memberships.set(list, built);
  return built;
}

/**
 * Evaluate a clause against one row IN-PROCESS (the memory engine's actual
 * filter — `resolvePredicateSQL` above is the honest SQL text, this is the
 * real work). Semantics mirror the resolved SQL exactly:
 *   - cleared (`clause === null`, or a point/interval clause whose own value
 *     clears it) matches every row;
 *   - point `IS NULL` matches `row[field] == null` (null OR undefined —
 *     SQL NULL has no undefined/missing distinction);
 *   - point `IN (v)` / interval `BETWEEN` use strict JS equality / numeric
 *     comparison — documented simplification: no SQL-style implicit type
 *     coercion between e.g. `"5"` and `5`. A string interval (ISO-8601 date
 *     bounds) therefore only ever matches STRING row values, and a numeric
 *     interval only numeric ones — never across.
 *   - match `IN (...)` / `NOT IN (...)` is SQL's own three-valued answer over
 *     ONE set built per list ({@link membershipOf}, SameValueZero — DuckDB's
 *     equality on every value a list can carry, and no coercion either). The
 *     odd values — NaN, ±Infinity, null, undefined — are NULL to the engine in
 *     the list AND in the row ({@link isSQLNull}): `IN (…)` keeps a row only
 *     when its value is a member, so a NULL entry keeps no row and a NULL row
 *     is kept by no list; `NOT IN (…)` keeps a row only when its value is NOT
 *     NULL, is no member, and the list holds no NULL — `NULL NOT IN (1)` and
 *     `2 NOT IN (1, NULL)` are both NULL, never TRUE. Measured against a real
 *     DuckDB (engineInvariant.test.ts): the two engines answer alike on every
 *     one. An EMPTY list is the renderer's rule, untouched: `(FALSE)` keeps
 *     nothing, `(TRUE)` keeps everything, NULL rows included.
 *   - a NEIGHBOURHOOD keeps a row when BOTH endpoint columns hold one of the
 *     walked ids (the AND its SQL renders — the induced ego subgraph); an
 *     empty id set keeps nothing, and "no filter" is the absent clause, never
 *     an empty set. A nullish endpoint is kept by NO neighbourhood, even one
 *     whose recorded set carries a null: `IN (NULL)` is not `IS NULL`. Its
 *     `ids` array is read ONCE per array (the borrow law at `membershipOf`);
 *   - a HALF-OPEN interval (one bound `null`) only tests the side that is
 *     present — `[150, null]` matches every row `>= 150`, `[null, hi]` every
 *     row `<= hi` — never a fabricated opposite bound.
 */
export function matchesClause(row: Row, clause: PredicateClause | null): boolean {
  if (clause === null) return true;
  switch (clause.kind) {
    case 'point': {
      if (clause.value === undefined) return true; // cleared
      if (clause.value === null) return row[clause.field] == null;
      return row[clause.field] === clause.value;
    }
    case 'interval': {
      if (clause.value === null) return true; // cleared
      const v = row[clause.field];
      if (isStringBounds(clause.value)) {
        if (typeof v !== 'string') return false; // no cross-type coercion
        const [lo, hi] = clause.value;
        if (lo !== null && v < lo) return false;
        if (hi !== null && v > hi) return false;
        return true;
      }
      if (typeof v !== 'number' || Number.isNaN(v)) return false;
      const [lo, hi] = clause.value;
      if (lo !== null && v < lo) return false;
      if (hi !== null && v > hi) return false;
      return true;
    }
    case 'match': {
      // an EMPTY list is the renderer's own rule (`resolveMatchSQL`): keep matches nothing
      // (real FALSE, not "cleared"), exclude excludes nothing — every row kept, NULL rows too
      if (clause.values.length === 0) return clause.exclude === true;
      const { set, holdsNull } = membershipOf(clause.values);
      const v = row[clause.field];
      // IN: the set holds no NULL entry, so a NULL row is a member of no list — `NULL IN (…)` is never TRUE
      if (clause.exclude !== true) return set.has(v);
      // NOT IN: three-valued — a NULL in the list or in the row makes the whole test NULL, never TRUE
      return !holdsNull && !isSQLNull(v) && !set.has(v);
    }
    case 'cell': {
      if (clause.value === null) return true; // whole cell cleared -> matches everything
      const [vx, vy] = clause.value;
      // Both sides must hold (the AND) — each side DELEGATES via
      // `cellSideClause` to the existing arms, so the semantics stay
      // single-sourced (an array side is an interval with the full
      // half-open/no-coercion discipline; anything else is a point with
      // strict equality / IS NULL).
      return (
        matchesClause(row, cellSideClause(clause.fields[0], vx)) &&
        matchesClause(row, cellSideClause(clause.fields[1], vy))
      );
    }
    case 'neighbourhood': {
      // BOTH endpoints in the set — the AND the SQL renders, over the prebuilt set (which
      // carries no NULL id, so a missing endpoint is kept by no walk, exactly as `IN (NULL)`
      // keeps no row). The SAME membership the match arm asks: one law for the two IN-lists.
      const { set } = membershipOf(clause.ids);
      return set.has(row[clause.fields[0]]) && set.has(row[clause.fields[1]]);
    }
  }
}
