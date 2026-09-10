/**
 * WHAT FITS, BEFORE A BUILD.
 *
 * `fitsFor` answers "which column may sit on which channel" for a view that
 * already exists — it takes FACETS, which a dashboard resolves from a
 * provider's columns and a def's declarations. An authoring wizard has
 * neither: it has a described table (src/data/describeTable), whatever the
 * person has declared on top of it so far, and a chart kind they are
 * considering. Asking it to build a dashboard to find out whether `cases` can
 * go on `y` is asking it to commit before it may look.
 *
 * So this door is the same answer, one step earlier. It resolves the facets
 * with `resolveFacets` and judges with `fitsFor` — the same two calls, in the
 * same order, that the BUILD door's own lint makes (`validateDashboardDef`'s
 * encodings pass). It adds no rule of its own, which is the whole point: the
 * answer here and the answer the build gives cannot differ, because there is
 * only one of them. `whatFits.def.test.ts` pins that over an NNDSS-shaped def.
 */
import type { AbsenceDecl } from '../def/types.js';
import { resolveFacets, type FacetSource } from './facets.js';
import { fitsFor } from './fits.js';
import type { Bindings, ColumnDecl, EncodingPorts, EncodingRules, EncodingSurface, Fit } from './types.js';

/**
 * One column as a wizard holds it: its NAME, plus everything a def could say
 * about it (`ColumnDecl` — `type`, `role`, `scale`, `label`). The `type` slot
 * is one slot on purpose: `describeTable` puts the sniffed type there and a
 * person editing the column overwrites it, which is exactly what a def's
 * declared type does to a provider's (`resolveFacet`: a declared type wins).
 */
export interface FitColumn extends ColumnDecl {
  readonly name: string;
}

export interface WhatFitsInput {
  /** The described table plus the person's declarations, one entry per column. */
  readonly columns: readonly FitColumn[];
  /**
   * The table's absence declaration, when it has one — bare or a LIST, the
   * def's own shape. The built-in law needs it to refuse a magnitude, and it
   * needs EVERY entry: a table with three state columns has three columns that
   * may not carry one (`../data/silence.ts`). Handed straight to
   * {@link resolveFacets}, which adapts it to the port once.
   */
  readonly absence?: AbsenceDecl | readonly AbsenceDecl[];
  /** The chart kind under consideration (`line`, `bar`, `point`, …). */
  readonly chartKind: string;
  /** The channels of that chart kind. */
  readonly channels: readonly string[];
  /** What the view already binds — every column is judged as the binding WOULD be. Default: nothing bound yet. */
  readonly bindings?: Bindings;
  /** The rule set the def carries (or would carry). */
  readonly rules?: EncodingRules;
  /** The other views' bindings, for a rule whose scope is the whole dashboard. */
  readonly others?: Readonly<Record<string, Bindings>>;
  /** The ports a build would pass (an explainer, coercers, a recommender). */
  readonly ports?: EncodingPorts;
  /** The view's id, for sentences that name it. Default `view`. */
  readonly viewId?: string;
}

/** The id a channel's fits are reported under when the caller named no view. */
export const WHAT_FITS_VIEW_ID = 'view';

/**
 * Per channel: the columns that fit, first (ranked when a recommender is
 * passed), then every refused column with the sentence that refuses it.
 *
 * ```ts
 * const described = describeTable(csv);
 * whatFits({
 *   columns: described.columns.map((c) => ({ name: c.name, type: c.type })),
 *   absence: { field: 'report_state', states: ['present', 'unavailable', 'unknown'] },
 *   chartKind: 'line',
 *   channels: ['x', 'y'],
 * })['y'];
 * // [{ field: 'cases', ok: true }, …,
 * //  { field: 'report_state', ok: false,
 * //    because: '"report_state" is the declared absence column — it cannot bind to the magnitude channel "y"; absence is a category, never a magnitude' }]
 * ```
 */
export function whatFits(input: WhatFitsInput): Readonly<Record<string, readonly Fit[]>> {
  const source: FacetSource = {
    columns: Object.fromEntries(input.columns.map((c) => [c.name, c] as const)),
    ...(input.absence !== undefined ? { absence: input.absence } : {}),
  };
  const facets = resolveFacets(
    input.columns.map((c) => ({ name: c.name, type: c.type ?? 'unknown' })),
    source,
  );
  const view: EncodingSurface = {
    viewId: input.viewId ?? WHAT_FITS_VIEW_ID,
    chartKind: input.chartKind,
    channels: input.channels,
  };
  return fitsFor({
    view,
    bindings: input.bindings ?? {},
    facets,
    ...(input.others !== undefined ? { others: input.others } : {}),
    ...(input.rules !== undefined ? { rules: input.rules } : {}),
    ...(input.ports !== undefined ? { ports: input.ports } : {}),
  });
}
