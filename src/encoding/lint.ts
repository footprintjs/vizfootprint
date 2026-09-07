/**
 * The lint door — every view's declared initial bindings judged against the
 * facets and the rules, as a list of problems. Pure and synchronous: the
 * caller brings the facets (the def door brings what the def can prove; a
 * dashboard with data brings the provider's types too).
 */
import type { ColumnFacet } from '../data/types.js';
import { validateBindings } from './validate.js';
import type { Bindings, EncodingPorts, EncodingProblem, EncodingRules, EncodingSurface } from './types.js';

export interface LintInput {
  readonly views: readonly EncodingSurface[];
  readonly facets: readonly ColumnFacet[];
  readonly rules?: EncodingRules;
  readonly ports?: EncodingPorts;
  /**
   * Every binding on the PAGE, keyed by the address that holds it (a viewId,
   * or a layer's `viewId~layerId`) — what a `dashboard`-scope rule reads as
   * "anywhere on the page". Default: the surfaces in `views`, which is the
   * whole page only when one call judges every surface — a layer is judged in
   * a call of its own (its fields are its table's), so its caller passes the
   * page in. `boundElsewhere` compares field NAMES, so the facets stay per
   * call while this map spans the page.
   */
  readonly page?: Readonly<Record<string, Bindings>>;
}

/** The declared bindings of these surfaces, keyed by address — the `page` a dashboard-scope rule is judged against (`pageBindings([...views, ...layers])`). */
export function pageBindings(surfaces: readonly EncodingSurface[]): Record<string, Bindings> {
  return Object.fromEntries(surfaces.map((s) => [s.viewId, s.initial ?? {}]));
}

export function lintEncodings(input: LintInput): EncodingProblem[] {
  const initialOf = (v: EncodingSurface): Bindings => v.initial ?? {};
  const page = input.page ?? pageBindings(input.views);
  const problems: EncodingProblem[] = [];
  for (const view of input.views) {
    const others: Record<string, Bindings> = {};
    for (const [address, bindings] of Object.entries(page)) if (address !== view.viewId) others[address] = bindings;
    problems.push(
      ...validateBindings({
        view,
        bindings: initialOf(view),
        facets: input.facets,
        others,
        ...(input.rules !== undefined ? { rules: input.rules } : {}),
        ...(input.ports !== undefined ? { ports: input.ports } : {}),
      }),
    );
  }
  return problems;
}

/** One line per problem, the way a build error or a CI log reads it. */
export function formatProblem(p: EncodingProblem): string {
  const where = `${p.viewId}.${p.channel} = "${p.field}"`;
  return p.severity === 'coerced' ? `${where}: ${p.sentence} (coerced)` : `${where}: ${p.sentence}`;
}
