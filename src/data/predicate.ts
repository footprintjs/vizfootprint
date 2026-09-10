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
 * Replicates `literalToSQL` (`ast/literal.js`, cited in the file header)
 * exactly for the value types this package's clauses actually carry
 * (number/string/boolean/null/Date). Anything else throws — an HONEST
 * failure (never a silently wrong SQL fragment) rather than a fabricated
 * literal for a type this replica does not cover (RegExp / plain-object
 * literals are Mosaic-supported but never appear in a `PredicateClause`
 * here, since L1/L2 only ever carry JSON-serializable commit values).
 */
export function literalToSQL(value: unknown): string {
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? `${value}` : 'NULL';
    case 'string':
      return `'${value.replaceAll(`'`, `''`)}'`;
    case 'boolean':
      return value ? 'TRUE' : 'FALSE';
    default:
      if (value == null) return 'NULL';
      if (value instanceof Date) {
        const ts = +value;
        if (Number.isNaN(ts)) return 'NULL';
        const y = value.getUTCFullYear();
        const m = value.getUTCMonth();
        const d = value.getUTCDate();
        return ts === Date.UTC(y, m, d) ? `DATE '${y}-${m + 1}-${d}'` : `epoch_ms(${ts})`;
      }
      throw new TypeError(
        `literalToSQL: unsupported literal type "${Object.prototype.toString.call(value)}" — ` +
          'only number/string/boolean/null/Date are honestly replicated (see predicate.ts header)',
      );
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

function resolvePointSQL(clause: PointClause): string {
  if (clause.value === undefined) return CLEARED_SQL; // clausePoint: value===undefined -> no predicate
  if (clause.value === null) return `(${quoteIdent(clause.field)} IS NULL)`; // isInDistinct null-safety fallback
  return `(${quoteIdent(clause.field)} IN (${literalToSQL(clause.value)}))`;
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
function resolveIntervalSQL(clause: IntervalClause): string {
  if (clause.value === null) return CLEARED_SQL; // clauseInterval: value==null -> no predicate
  const [lo, hi] = clause.value;
  const field = quoteIdent(clause.field);
  if (lo === null) return `(${field} <= ${literalToSQL(hi)})`;
  if (hi === null) return `(${field} >= ${literalToSQL(lo)})`;
  return `(${field} BETWEEN ${literalToSQL(lo)} AND ${literalToSQL(hi)})`;
}

/**
 * `'match'` is this layer's own trivial addition (see types.ts header) — an
 * empty `values` list is a real, always-false predicate (`FALSE`), not the
 * "cleared" state (that is `clause === null` at the `evaluate()` level).
 */
function resolveMatchSQL(clause: MatchClause): string {
  if (clause.values.length === 0) return clause.exclude === true ? '(TRUE)' : '(FALSE)';
  const op = clause.exclude === true ? 'NOT IN' : 'IN';
  return `(${quoteIdent(clause.field)} ${op} (${clause.values.map(literalToSQL).join(', ')}))`;
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
function resolveCellSideSQL(field: string, side: CellSide): string {
  const clause = cellSideClause(field, side);
  return clause.kind === 'interval' ? resolveIntervalSQL(clause) : resolvePointSQL(clause);
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
function resolveCellSQL(clause: CellClause): string {
  if (clause.value === null) return CLEARED_SQL; // whole cell cleared -> no predicate
  const [vx, vy] = clause.value;
  return `(${resolveCellSideSQL(clause.fields[0], vx)} AND ${resolveCellSideSQL(clause.fields[1], vy)})`;
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
function resolveNeighbourhoodSQL(clause: NeighbourhoodClause): string {
  if (clause.ids.length === 0) return '(FALSE)';
  const ids = clause.ids.map(literalToSQL).join(', ');
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
  if (clause === null) return CLEARED_SQL;
  if (Array.isArray(clause)) {
    // a list is its AND, each side parenthesised; an empty list is no filter — the same descriptor every engine renders
    // a cleared clause in a list is no conjunct (it keeps every row), never `AND (null)`
    const parts = (clause as readonly PredicateClause[]).map((c) => resolvePredicateSQL(c)).filter((p) => p !== CLEARED_SQL);
    return parts.length === 0 ? CLEARED_SQL : parts.length === 1 ? parts[0]! : parts.map((p) => `(${p})`).join(' AND ');
  }
  const one = clause as PredicateClause;
  switch (one.kind) {
    case 'point':
      return resolvePointSQL(one);
    case 'interval':
      return resolveIntervalSQL(one);
    case 'match':
      return resolveMatchSQL(one);
    case 'cell':
      return resolveCellSQL(one);
    case 'neighbourhood':
      return resolveNeighbourhoodSQL(one);
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
 * Mosaic's `literalToSQL` (ast/literal.js) VERBATIM — including the two arms
 * the data seam's `literalToSQL` above honestly refuses: a RegExp renders its
 * source, and anything else falls through to string coercion (`${value}`), so
 * a plain object is `[object Object]`, an array is its joined elements, a
 * bigint its digits, and a Symbol throws the TypeError coercion throws. WHY
 * the fallback is kept rather than refused: the log has always carried
 * object-valued point commits (an analysis declaration, a chart's act on the
 * `pValue` lane), and the byte Mosaic persisted for them is the coercion's.
 */
function mosaicLiteralSQL(value: unknown): string {
  if (value instanceof RegExp) return `'${value.source}'`;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) return `${value as object}`;
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') return `${value as bigint}`;
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
 * The id set of ONE neighbourhood clause, built once and kept for as long as
 * the clause's own `ids` array is alive. `matchesClause` is asked per ROW, and
 * a neighbourhood asks the same membership question twice per row (once per
 * endpoint), so building the set inside the call would rebuild it 2n times for
 * an n-row table — the clause is the question, and the question does not
 * change between rows.
 *
 * Keyed by the `ids` ARRAY and not the clause object: the two doors that build
 * a clause from one commit (`clauseFromWire`, and a session's own live clause)
 * hand back different clause objects over the SAME borrowed ids array, and
 * both should meet the set the first of them built.
 *
 * THE BORROW LAW this rests on: an `ids` array is the recorded ANSWER of a
 * walk, minted once and never mutated — the log deep-freezes its records, and
 * a hand-built clause must build a NEW array rather than push into a live one.
 * The set is read ONCE per array; a later push would be seen by
 * `resolvePredicateSQL` (which re-reads the array) and not by this filter, and
 * one clause would have two readings.
 */
const idSets = new WeakMap<readonly unknown[], ReadonlySet<unknown>>();

function idSetOf(ids: readonly unknown[]): ReadonlySet<unknown> {
  const known = idSets.get(ids);
  if (known !== undefined) return known;
  // WHY nullish ids are dropped: SQL's `IN (NULL)` is never TRUE, so the renderers keep no row
  // for one — a Set carrying `null` would instead keep every row whose endpoint is missing,
  // which is the very hazard `../session/neighbourhood.ts`'s walk refuses at the producer.
  const built: ReadonlySet<unknown> = new Set<unknown>(ids.filter((id) => id !== null && id !== undefined));
  idSets.set(ids, built);
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
 *   - point `IN (v)` / interval `BETWEEN` / match `IN (...)` use strict
 *     JS equality / numeric comparison — documented simplification: no
 *     SQL-style implicit type coercion between e.g. `"5"` and `5`. A string
 *     interval (ISO-8601 date bounds) therefore only ever matches STRING row
 *     values, and a numeric interval only numeric ones — never across.
 *   - a NEIGHBOURHOOD keeps a row when BOTH endpoint columns hold one of the
 *     walked ids (the AND its SQL renders — the induced ego subgraph); an
 *     empty id set keeps nothing, and "no filter" is the absent clause, never
 *     an empty set. A nullish endpoint is kept by NO neighbourhood, even one
 *     whose recorded set carries a null: `IN (NULL)` is not `IS NULL`. Its
 *     `ids` array is read ONCE per array (see the borrow law at `idSets`);
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
      const v = row[clause.field];
      const hit = clause.values.some((candidate) => candidate === v);
      // keep: an empty list matches nothing (real FALSE, not "cleared");
      // exclude: an empty list excludes nothing — everything is kept
      return clause.exclude === true ? !hit : hit;
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
      // carries no nullish id, so a missing endpoint is kept by no walk, exactly as
      // `IN (NULL)` keeps no row). Membership is the Set's SameValueZero, which parts from
      // the match arm's `===` on exactly one value, NaN, and no node table keys its rows by one.
      const ids = idSetOf(clause.ids);
      return ids.has(row[clause.fields[0]]) && ids.has(row[clause.fields[1]]);
    }
  }
}
