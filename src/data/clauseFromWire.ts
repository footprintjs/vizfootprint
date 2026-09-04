/**
 * clauseFromWire — the ONE reading of a commit's wire triple as a clause.
 *
 * A `PredicateClause` is the shape this folder EVALUATES. It is not the shape
 * a commit CARRIES. A commit carries a flat triple — `{kind, field, value}`
 * (plus `fields` for a cell) — and the two disagree in three places:
 *
 *   - a `match`'s list and polarity ride INSIDE `value` as a
 *     {@link MatchValueBody}; the clause carries `values`/`exclude` as sibling
 *     fields of its own;
 *   - a `cell`'s `field` is a DISPLAY label (`"price × category"`), never a
 *     column; the authoritative pair rides `fields`;
 *   - "cleared" has four spellings on the wire (an absent point value, a null
 *     interval, a null match body, a null cell pair) and exactly one at the
 *     evaluate() level: `clause === null`, "no filter".
 *
 * Reading a triple is therefore a real translation with real rules, and until
 * now the library kept it to itself — so every consumer that held a commit and
 * wanted to know which rows it selects had to write the rules again. A second
 * evaluator over one agreed clause shape can only differ in speed; a second
 * TRANSLATION can disagree about what a triple MEANS, silently, and the answer
 * on screen would be the one nobody tested. That is the half this function
 * closes (`ui/src/adapter/README.md`, Law 3 — the fix is the door, not the
 * helper).
 *
 * ```ts
 * import { clauseFromWire, matchesClause } from 'vizfootprint/data';
 *
 * const c = session.log.records.at(-1)!;                       // a landed commit
 * const clause = clauseFromWire(c.kind, c.field, c.value, c.fields);
 * rows.filter((row) => matchesClause(row, clause));            // the rows it selects
 * ```
 *
 * TOTAL, and cleared is the only fallback. Every input answers — the function
 * never throws and never returns `undefined`. A value the wire's declared shape
 * does not cover (a match body that is not an object, a cell or interval value
 * that is not a pair, a cell whose `fields` never arrived) reads as CLEARED,
 * which keeps every row. That is this library's standing answer to a wire it
 * cannot read: keep-all is the only honest fallback, because narrowing on a
 * value nobody can interpret would drop rows for a reason no one could state.
 *
 * It does NOT compile. `matchesClause` interprets the clause it returns, once
 * per row; a consumer over a hot table (a chart re-folding 90k rows per frame)
 * compiles the same clause into a closure instead. Two evaluators over ONE
 * clause differ only in speed, which is why the compiler is deliberately not
 * here — see `ui/src/contract/selection.ts`, which builds its compiled
 * predicate from exactly this translation.
 */

import type {
  CellSide,
  IntervalBounds,
  IntervalClause,
  MatchValueBody,
  PointClause,
  PredicateClause,
} from './types.js';

/** The four selection kinds a commit's wire triple can carry. */
export type WireClauseKind = 'point' | 'interval' | 'match' | 'cell';

/**
 * The shape split {@link CellSide} documents: an array side IS the interval
 * side. (A typed wrapper over `Array.isArray` — the built-in's `any[]`
 * predicate cannot narrow a union that contains `string` cleanly.)
 */
function isIntervalSide(side: CellSide): side is IntervalBounds<number> | IntervalBounds<string> {
  return Array.isArray(side);
}

/**
 * A two-element wire pair — the shape BOTH an interval's bounds and a cell's
 * side tuple arrive in. Anything else in that slot is not a pair this library
 * can read, and the caller answers CLEARED rather than narrowing on it.
 */
function isPair(value: unknown): value is readonly [unknown, unknown] {
  return Array.isArray(value) && value.length === 2;
}

/**
 * Lift ONE side of a cell into the clause the point/interval arms already
 * handle: an array side is an interval, anything else is a point (see
 * {@link CellSide}). The cell's semantics are therefore single-sourced — the
 * same numeric/string discipline, half-open included, and the same three-way
 * point split.
 *
 * Exported because it is the other half of this translation: a consumer that
 * compiles a cell's two sides SEPARATELY (as the ui contract tier does, to keep
 * the per-row work out of the loop) would otherwise restate "an array side is
 * an interval" in its own words — one rule, two spellings, two answers.
 */
export function cellSideClause(field: string, side: CellSide): PointClause | IntervalClause {
  return isIntervalSide(side)
    ? { kind: 'interval', field, value: side }
    : { kind: 'point', field, value: side };
}

/**
 * Read a commit's wire triple as the clause it means, or `null` when it means
 * "no filter" (see the header: cleared is the one fallback, and the only shape
 * `PredicateClause` has no room for).
 *
 * `fields` rides only with `kind:'cell'` — it is the authoritative column pair,
 * and without it a cell is cleared rather than guessed at from its label.
 */
export function clauseFromWire(
  kind: WireClauseKind,
  field: string,
  value: unknown,
  fields?: readonly [string, string],
): PredicateClause | null {
  switch (kind) {
    case 'point':
      // the three-way split is the clause's own: `undefined` = cleared, `null` = IS NULL, else equality
      return { kind: 'point', field, value };
    case 'interval':
      // a pair is the bounds verbatim (half-open and ISO-string bounds included); anything else is cleared
      return { kind: 'interval', field, value: isPair(value) ? (value as IntervalBounds<number> | IntervalBounds<string>) : null };
    case 'match': {
      // the list and its polarity ride INSIDE the value; a body without a list is not a list to test against
      if (value === null || typeof value !== 'object') return null;
      const body = value as Partial<MatchValueBody>;
      if (!Array.isArray(body.values)) return null;
      return { kind: 'match', field, values: body.values as readonly unknown[], ...(body.exclude === true ? { exclude: true } : {}) };
    }
    case 'cell':
      // `field` here is the display label ("price × category") — never a column, so a cell
      // whose pair never arrived is cleared rather than split out of its own words
      if (fields === undefined) return null;
      return { kind: 'cell', fields, value: isPair(value) ? (value as readonly [CellSide, CellSide]) : null };
  }
}
