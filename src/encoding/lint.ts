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
}

export function lintEncodings(input: LintInput): EncodingProblem[] {
  const initialOf = (v: EncodingSurface): Bindings => v.initial ?? {};
  const problems: EncodingProblem[] = [];
  for (const view of input.views) {
    const others: Record<string, Bindings> = {};
    for (const other of input.views) if (other.viewId !== view.viewId) others[other.viewId] = initialOf(other);
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
