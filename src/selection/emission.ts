/**
 * EMISSION — THE LAYER'S OUTBOUND CONTRACT WITH CHARTS (R3).
 *
 * The law: a chart NEVER builds a clause. It emits a plain, inert
 * `ChartEmission`: a `rawValue` already resolved to DATA space by the chart's
 * OWN scale (R5 — never pixels, never a viewport/zoom/scale object) plus an
 * `encoding` naming which field and clause kind it maps to. Only this layer
 * turns an emission + a cause + a registered source into a spec, and only a
 * `SelectionPort` turns the spec into a clause.
 *
 * Enforced by construction, not convention: no barrel in this package exports
 * a raw clause factory — a caller holding only a `ChartEmission` has no path
 * to a clause but `causeClauseFromEmission`, and a `ChartEmission` cannot
 * itself carry a `source`/`predicate`/`meta` (excess-property checks on the
 * literal reject it at the type level — see `emission.test.ts`).
 *
 * First customers: the ui charts (they emit), the demo dashboards (they mint
 * through the session's port), the session's dispatch.
 */

import type { Cause } from '../cause/index.js';
import type { CellSide, MatchValue } from '../data/index.js';
import type { CauseClause, CauseClauseSpec, RegisteredSource, SelectionPort, SelectionRejection } from './types.js';

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

/**
 * A NEIGHBOURHOOD selection (protocol 1.3): one gesture on a node selects the
 * ties inside its ego set. `field` is the EDGES table's endpoint column the
 * gesture named, and the emission's `rawValue` is the SEED — the node id — or
 * `null` to clear.
 *
 * WHY it carries the seed and never the set: the walk reads the edge rows AT
 * THE CURSOR, and a chart owns no rows (the transform-ownership rule — it never
 * bins, and it never walks). So this emission is a QUESTION, and it is the one
 * emission kind that cannot become a clause on its own: only the session can
 * answer it, and it answers by landing the walked ids beside the question.
 */
export interface NeighbourhoodEncoding {
  readonly kind: 'neighbourhood';
  readonly field: string;
}

export type ChartEncoding = PointEncoding | IntervalEncoding | CellEncoding | MatchEncoding | NeighbourhoodEncoding;

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
  | { readonly rawValue: MatchValue; readonly encoding: MatchEncoding }
  | { readonly rawValue: unknown; readonly encoding: NeighbourhoodEncoding };

/**
 * The emissions that translate PURELY into a spec: every kind but the walk.
 *
 * A neighbourhood emission names a question — a seed on an endpoint column —
 * and the answer is a set of ids nobody can read off the emission: it takes the
 * edge ROWS at the cursor, which this module deliberately has no access to.
 * So {@link causeClauseSpecFromEmission} takes this narrower type and the
 * COMPILER refuses the walk, rather than a runtime arm inventing an empty set
 * or throwing where the four other kinds return. A caller holding a plain
 * `ChartEmission` narrows first; a walk goes to the session's own door
 * (`select` with a `seed`), which reads the rows and records both halves.
 */
export type ClauseEmission = Exclude<ChartEmission, { readonly encoding: NeighbourhoodEncoding }>;

/**
 * Type guard narrowing `ChartEmission` by its nested `encoding.kind`
 * discriminant. TypeScript's control-flow narrowing only tracks a
 * discriminant that sits directly on the type being narrowed; `kind` sits one
 * property down (on `encoding`), so a plain `if (emission.encoding.kind ===
 * 'interval')` does not narrow `emission.rawValue`. This guard is the honest
 * fix — no `as`/`as unknown` cast anywhere in this module.
 */
function isIntervalEmission(
  e: ClauseEmission,
): e is Extract<ClauseEmission, { readonly encoding: IntervalEncoding }> {
  return e.encoding.kind === 'interval';
}

/** The match sibling of {@link isIntervalEmission} — same nested-discriminant honesty. */
function isMatchEmission(
  e: ClauseEmission,
): e is Extract<ClauseEmission, { readonly encoding: MatchEncoding }> {
  return e.encoding.kind === 'match';
}

/** The cell sibling of {@link isIntervalEmission} — same nested-discriminant honesty. */
function isCellEmission(
  e: ClauseEmission,
): e is Extract<ClauseEmission, { readonly encoding: CellEncoding }> {
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
 * Read a chart's emission as the spec a port mints from — the ONE translation
 * from `{rawValue, encoding}` to `CauseClauseSpec`. Pure: no port, no engine,
 * nothing built.
 */
export function causeClauseSpecFromEmission(emission: ClauseEmission, ctx: EmissionContext): CauseClauseSpec {
  if (isCellEmission(emission)) {
    return {
      kind: 'cell',
      source: ctx.source,
      fields: emission.encoding.fields,
      value: emission.rawValue,
      cause: ctx.cause,
      clients: ctx.clients,
    };
  }
  if (isMatchEmission(emission)) {
    return {
      kind: 'match',
      source: ctx.source,
      field: emission.encoding.field,
      value: emission.rawValue,
      cause: ctx.cause,
      clients: ctx.clients,
    };
  }
  if (isIntervalEmission(emission)) {
    return {
      kind: 'interval',
      source: ctx.source,
      field: emission.encoding.field,
      value: emission.rawValue,
      cause: ctx.cause,
      clients: ctx.clients,
    };
  }
  return {
    kind: 'point',
    source: ctx.source,
    field: emission.encoding.field,
    value: emission.rawValue,
    cause: ctx.cause,
    clients: ctx.clients,
  };
}

/**
 * Build a cause-tagged clause from a chart's emission, on the port that will
 * hold it. This is the ONLY function that turns a `ChartEmission` into a
 * clause — a chart component calls only this (or a thin per-widget wrapper
 * around it), never a factory (R3: the layer builds the clause, the chart
 * never does).
 *
 * WHY the port is a parameter and never defaulted: a clause is minted BY the
 * engine that will stand it (an adapter keeps its engine's native clause
 * beside ours), so a clause minted on a fresh built-in and pushed onto the
 * session's Mosaic port would be a clause its engine never saw. Hand in
 * `session.log.port`.
 */
export function causeClauseFromEmission(
  emission: ClauseEmission,
  ctx: EmissionContext,
  port: SelectionPort,
): CauseClause | SelectionRejection {
  return port.clause(causeClauseSpecFromEmission(emission, ctx));
}
