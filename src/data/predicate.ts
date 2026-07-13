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

import type { IntervalClause, MatchClause, PointClause, PredicateClause, Row } from './types.js';

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
 * ONE documented divergence from the byte-parity contract in the file header:
 * STRING interval bounds (ISO-8601 dates) render as SQL string LITERALS here,
 * while real Mosaic's `isBetween` (operators.js:219-221) maps extents through
 * `asNode` (ast.js:16-17: `isString(value) ? column(value) : asLiteral(value)`)
 * and so renders a string extent as a quoted COLUMN IDENTIFIER — a reference
 * to a nonexistent column (Mosaic's interval extents are meant to be
 * numbers/Dates; strings fall outside its input domain). Replicating that
 * would fabricate non-executable SQL, so this seam stays honest instead
 * (pinned in predicate.test.ts against the real factory's output).
 */
function resolveIntervalSQL(clause: IntervalClause): string {
  if (clause.value === null) return CLEARED_SQL; // clauseInterval: value==null -> no predicate
  const [lo, hi] = clause.value;
  return `(${quoteIdent(clause.field)} BETWEEN ${literalToSQL(lo)} AND ${literalToSQL(hi)})`;
}

/**
 * `'match'` is this layer's own trivial addition (see types.ts header) — an
 * empty `values` list is a real, always-false predicate (`FALSE`), not the
 * "cleared" state (that is `clause === null` at the `evaluate()` level).
 */
function resolveMatchSQL(clause: MatchClause): string {
  if (clause.values.length === 0) return '(FALSE)';
  return `(${quoteIdent(clause.field)} IN (${clause.values.map(literalToSQL).join(', ')}))`;
}

/**
 * Resolve a clause to its predicate SQL text. `clause === null` means "no
 * filter" at the `evaluate()` level (distinct from a point/interval clause
 * whose OWN value clears it) and resolves to the same `"null"` descriptor
 * Mosaic's own cleared clauses produce, for one consistent "no predicate"
 * spelling across both routes.
 */
export function resolvePredicateSQL(clause: PredicateClause | null): string {
  if (clause === null) return CLEARED_SQL;
  switch (clause.kind) {
    case 'point':
      return resolvePointSQL(clause);
    case 'interval':
      return resolveIntervalSQL(clause);
    case 'match':
      return resolveMatchSQL(clause);
  }
}

/** True when a resolved SQL string denotes "no filter" (either route to CLEARED_SQL, or a literal FALSE guard is NOT this). */
export function isClearedSQL(sql: string): boolean {
  return sql === CLEARED_SQL;
}

/**
 * An interval's bounds are either both numbers or both strings (see
 * `IntervalClause` in types.ts — the two never mix), so the first element
 * decides the pair. String bounds are ISO-8601 dates: SQL `BETWEEN` over
 * strings is lexicographic, and for uniform ISO-8601 lexicographic IS
 * chronological — the resolved SQL and this in-process filter agree.
 */
function isStringBounds(
  value: readonly [number, number] | readonly [string, string],
): value is readonly [string, string] {
  return typeof value[0] === 'string';
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
        const [lo, hi] = clause.value;
        return typeof v === 'string' && v >= lo && v <= hi;
      }
      const [lo, hi] = clause.value;
      if (typeof v !== 'number' || Number.isNaN(v)) return false;
      return v >= lo && v <= hi;
    }
    case 'match': {
      if (clause.values.length === 0) return false; // real FALSE, not "cleared"
      const v = row[clause.field];
      return clause.values.some((candidate) => candidate === v);
    }
  }
}
