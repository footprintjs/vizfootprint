/**
 * "What fits here, and why not" — per channel, every column judged as if it
 * were bound there now, with the sentence for each refusal. The picker greys
 * options with it; `whats_here` tells the agent what it may ask for before
 * it asks. A recommender port, when passed at build, ranks the columns that
 * fit; it never sees the refused ones.
 */
import type { ColumnFacet } from '../data/types.js';
import { refuses, validateBindings } from './validate.js';
import type { Bindings, EncodingPorts, EncodingRules, EncodingSurface, Fit } from './types.js';

export interface FitsInput {
  readonly view: EncodingSurface;
  /** The view's current bindings. */
  readonly bindings: Bindings;
  readonly facets: readonly ColumnFacet[];
  readonly others?: Readonly<Record<string, Bindings>>;
  readonly rules?: EncodingRules;
  readonly ports?: EncodingPorts;
}

/** channel → the fit of every column, fitting ones first (ranked when a recommender is present), refused ones after with their sentence. */
export function fitsFor(input: FitsInput): Readonly<Record<string, readonly Fit[]>> {
  const out: Record<string, readonly Fit[]> = {};
  for (const channel of input.view.channels) {
    const judged: Fit[] = input.facets.map((facet) => {
      const problems = validateBindings({
        view: input.view,
        bindings: { ...input.bindings, [channel]: facet.field },
        facets: input.facets,
        ...(input.others !== undefined ? { others: input.others } : {}),
        ...(input.rules !== undefined ? { rules: input.rules } : {}),
        ...(input.ports !== undefined ? { ports: input.ports } : {}),
        changed: [channel],
      });
      const first = problems.find((p) => p.severity === 'refused');
      return refuses(problems) ? { field: facet.field, ok: false, because: first!.explained ?? first!.sentence } : { field: facet.field, ok: true };
    });
    const ok = judged.filter((f) => f.ok);
    const ranked = input.ports?.recommender !== undefined ? input.ports.recommender.rank(channel, ok, input.facets) : ok;
    out[channel] = [...ranked, ...judged.filter((f) => !f.ok)];
  }
  return out;
}

/** The names that fit, per channel — the token-lean projection `whats_here` serves. */
export function acceptsOf(fits: Readonly<Record<string, readonly Fit[]>>): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const [channel, list] of Object.entries(fits)) out[channel] = list.filter((f) => f.ok).map((f) => f.field);
  return out;
}
