/**
 * predicate — pure, engine-independent clause resolution.
 *
 * `resolvePredicateSQL` hand-replicates the EXACT text real Mosaic clause
 * factories produce, verified empirically against the installed package
 * (`@uwdata/mosaic-core@0.28.1`, which re-exports `@uwdata/mosaic-sql`'s
 * literal/operator AST toString()):
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
 *   (`"null"`) at the L1 boundary (`src/log/log.ts:143`). This module mirrors
 *   that exact string so a `DataProvider`'s `sql` field stays byte-identical
 *   to what L1 already recorded for the same commit.
 *
 * This module is deliberately dependency-free (no `@uwdata/mosaic-sql`
 * import) — the memory engine (D24: "the always-on, zero-heavy-dep engine")
 * must not need it installed. The two full engines (wasm/server) may reuse
 * the real library later; this replica exists so engine choice never changes
 * the resolved SQL text (the D24 invariant), even before those engines ship.
 */

import type { CellClause, CellSide, IntervalBounds, IntervalClause, MatchClause, PointClause, PredicateClause, Row } from './types.js';
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

/** Double-quoted identifier, escaping an embedded `"` by doubling it (standard SQL quoting). */
function quoteIdent(field: string): string {
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
  }
}

/** True when a resolved SQL string denotes "no filter" (either route to CLEARED_SQL, or a literal FALSE guard is NOT this). */
export function isClearedSQL(sql: string): boolean {
  return sql === CLEARED_SQL;
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
 * Evaluate a clause against one row IN-PROCESS (the memory engine's actual
 * filter — `resolvePredicateSQL` above is the DESCRIPTOR, this is the real
 * work). Semantics mirror the resolved SQL exactly:
 *   - cleared (`clause === null`, or a point/interval clause whose own value
 *     clears it) matches every row;
 *   - point `IS NULL` matches `row[field] == null` (null OR undefined —
 *     SQL NULL has no undefined/missing distinction);
 *   - point `IN (v)` / interval `BETWEEN` / match `IN (...)` use strict
 *     JS equality / numeric comparison — documented simplification: no
 *     SQL-style implicit type coercion between e.g. `"5"` and `5`. A string
 *     interval (ISO-8601 date bounds) therefore only ever matches STRING row
 *     values, and a numeric interval only numeric ones — never across.
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
  }
}
