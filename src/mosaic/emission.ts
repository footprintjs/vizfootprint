/**
 * emission — the layer's OUTBOUND contract with charts (R3, the half SPEC.md
 * §4/§10 Q3 flagged unresolved: "the mandatory outbound typed emit carrying
 * origin"; docs/RESEARCH_STATE.md's canonical Q-index does not renumber this
 * — it stays SPEC.md's Q3/R3, not to be confused with canonical Q9).
 *
 * A chart/component NEVER builds a Mosaic clause. It emits a plain, inert
 * `ChartEmission`: a `rawValue` already resolved to DATA space by the chart's
 * OWN scale (R5 — never pixels, never a viewport/zoom/scale object) plus an
 * `encoding` naming which field and clause kind it maps to. Only this layer
 * turns an emission + a cause + a registered source into a real clause.
 *
 * "Chart never builds clauses" is enforced by construction, not convention:
 * `clausePoint`/`clauseInterval` (and `causeClause` itself) are never
 * re-exported from `vizfootprint/mosaic` (see index.ts) — a caller holding
 * only a `ChartEmission` has no path to a `SelectionClause` other than
 * `causeClauseFromEmission`, and a `ChartEmission` cannot itself carry a
 * `source`/`predicate`/`meta` (excess-property checks on the literal reject
 * it at the type level — see `emission.test.ts`).
 */

import { causeClause, type CauseClause } from './causeClause.js';
import type { RegisteredSource } from './SourceRegistry.js';
import type { Cause } from '../cause/index.js';
import type { CellSide, MatchValue } from '../data/index.js';

/** A point selection: one field, one DATA-space value. */
export interface PointEncoding {
  readonly kind: 'point';
  readonly field: string;
}

/** An interval selection: one field, a DATA-space [lo, hi] (or null to clear). */
export interface IntervalEncoding {
  readonly kind: 'interval';
  readonly field: string;
}

/**
 * A CELL selection (D30): one gesture selects on TWO fields at once — a
 * heatmap cell is "price 100–150 AND category Formal". `fields` is
 * `[x side, y side]`; the emission's `rawValue` carries the matching side
 * pair (each side an interval `[lo, hi]` or a point value — the `CellSide`
 * shape, single-sourced from `src/data`, the seam that actually EVALUATES
 * it), or `null` to clear the whole cell. One gesture = ONE commit — never
 * two correlationId-linked ones.
 */
export interface CellEncoding {
  readonly kind: 'cell';
  readonly fields: readonly [string, string];
}

/**
 * A MATCH selection (SET-1): one field, MANY data-space values — the plural
 * of a point (shift-click adds a bar; a drag crosses a run of them). The
 * emission carries the list and its polarity (`exclude` = everything BUT
 * these) as one `MatchValue`, or `null` to clear.
 */
export interface MatchEncoding {
  readonly kind: 'match';
  readonly field: string;
}

export type ChartEncoding = PointEncoding | IntervalEncoding | CellEncoding | MatchEncoding;

/**
 * What a chart emits on interaction. Deliberately only two keys — `rawValue`
 * and `encoding` — nothing else may ride along (no `source`, no `cause`, no
 * `meta`, no clause). `rawValue`'s type is tied to `encoding.kind`: a point
 * emission carries an arbitrary DATA value; an interval emission carries a
 * DATA-space `[lo, hi]` (or `null`); a cell emission carries the two-sided
 * pair (or `null`) — never a pixel range.
 */
export type ChartEmission =
  | { readonly rawValue: unknown; readonly encoding: PointEncoding }
  | { readonly rawValue: [number, number] | null; readonly encoding: IntervalEncoding }
  | { readonly rawValue: readonly [CellSide, CellSide] | null; readonly encoding: CellEncoding }
  | { readonly rawValue: MatchValue; readonly encoding: MatchEncoding };

/**
 * Type guard narrowing `ChartEmission` by its nested `encoding.kind`
 * discriminant. TypeScript's control-flow narrowing only tracks a
 * discriminant that sits directly on the type being narrowed; `kind` sits one
 * property down (on `encoding`), so a plain `if (emission.encoding.kind ===
 * 'interval')` does not narrow `emission.rawValue`. This guard is the honest
 * fix — no `as`/`as unknown` cast anywhere in this module.
 */
function isIntervalEmission(
  e: ChartEmission,
): e is Extract<ChartEmission, { readonly encoding: IntervalEncoding }> {
  return e.encoding.kind === 'interval';
}

/** The match sibling of {@link isIntervalEmission} — same nested-discriminant honesty. */
function isMatchEmission(
  e: ChartEmission,
): e is Extract<ChartEmission, { readonly encoding: MatchEncoding }> {
  return e.encoding.kind === 'match';
}

/** The cell sibling of {@link isIntervalEmission} — same nested-discriminant honesty. */
function isCellEmission(
  e: ChartEmission,
): e is Extract<ChartEmission, { readonly encoding: CellEncoding }> {
  return e.encoding.kind === 'cell';
}

/**
 * The session-owned half of a commit — everything an emission does NOT (and
 * must not) carry. A chart never has a `Cause` or a `RegisteredSource` to
 * fabricate one from; those come from whoever is driving the session
 * (live user input, an agent's `dispatch`, or a replay).
 */
export interface EmissionContext {
  readonly source: RegisteredSource;
  readonly cause: Cause;
  /** Cross-filter self-exclusion set. Defaults to [source]. */
  readonly clients?: RegisteredSource[];
}

/**
 * Build a cause-tagged clause from a chart's emission. This is the ONLY
 * function that turns a `ChartEmission` into a `SelectionClause` — a chart
 * component calls only this (or a thin per-widget wrapper around it), never
 * `clausePoint`/`clauseInterval` directly (R3: the layer builds the clause,
 * the chart never does).
 */
export function causeClauseFromEmission(
  emission: ChartEmission,
  ctx: EmissionContext,
): CauseClause {
  if (isCellEmission(emission)) {
    return causeClause({
      kind: 'cell',
      source: ctx.source,
      fields: emission.encoding.fields,
      value: emission.rawValue,
      cause: ctx.cause,
      clients: ctx.clients,
    });
  }
  if (isMatchEmission(emission)) {
    return causeClause({
      kind: 'match',
      source: ctx.source,
      field: emission.encoding.field,
      value: emission.rawValue,
      cause: ctx.cause,
      clients: ctx.clients,
    });
  }
  if (isIntervalEmission(emission)) {
    return causeClause({
      kind: 'interval',
      source: ctx.source,
      field: emission.encoding.field,
      value: emission.rawValue,
      cause: ctx.cause,
      clients: ctx.clients,
    });
  }
  return causeClause({
    kind: 'point',
    source: ctx.source,
    field: emission.encoding.field,
    value: emission.rawValue,
    cause: ctx.cause,
    clients: ctx.clients,
  });
}
