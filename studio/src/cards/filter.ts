/**
 * THE FILTER — narrow a list of cards to the surfaces carrying one feature.
 *
 * THE LAW IT FOLLOWS: **the filter's vocabulary is the cards' own.** There is no
 * list of filterable features anywhere; {@link choicesOf} is the union of the
 * chips the cards minted, counted. A demo that gains a network view gains the
 * `network` choice the same day, and a gallery that loses its last network demo
 * loses the choice — because a filter offering a narrowing that lands on nothing
 * is furniture.
 *
 * THE SECOND LAW: **the unit of narrowing is a SURFACE, not a demo.** The CDC
 * demo's desk carries `declares:chart:network` and its story page does not, so
 * narrowing on it must yield one card and not two — a filter that answered "the
 * CDC demo" would send a reader to a page that cannot do the thing they asked
 * for. {@link demosFor} exists for the one sentence a gallery does want in demo
 * terms ("2 of 3 demos"), and it counts demos by NAME off the surfaces that
 * matched.
 */
import { chipsOf } from './chips.js';
import type { ChipGround, DemoSurface, FeatureChoice } from './types.js';

/** The order the grounds are offered in — checked first, somebody's word last. */
const GROUND_ORDER: readonly ChipGround[] = ['declares', 'walked', 'by hand'];

/** Whether this surface carries the feature — its own chips are the only authority. */
export function holdsFeature(surface: DemoSurface, id: string): boolean {
  return chipsOf(surface).some((chip) => chip.id === id);
}

/**
 * The surfaces carrying one feature — all of them when nothing is chosen.
 *
 * ```ts
 * narrowTo([desk, story], 'declares:chart:network');   // [desk]
 * narrowTo([desk, story], null);                       // [desk, story]
 * ```
 */
export function narrowTo(surfaces: readonly DemoSurface[], id: string | null): readonly DemoSurface[] {
  if (id === null) return surfaces;
  return surfaces.filter((surface) => holdsFeature(surface, id));
}

/** The distinct demos among some surfaces, in the order they were handed in — two surfaces of one demo count once. */
export function demosFor(surfaces: readonly DemoSurface[]): readonly string[] {
  return [...new Set(surfaces.map((surface) => surface.demo))];
}

/**
 * Every feature offered by a list of cards, with how many SURFACES carry it.
 *
 * Ordered by ground, then facet, then label — one order, so a gallery that
 * re-renders does not re-shuffle its own filter under a reader's cursor.
 */
export function choicesOf(surfaces: readonly DemoSurface[]): readonly FeatureChoice[] {
  const counts = new Map<string, FeatureChoice>();
  for (const chip of surfaces.flatMap(chipsOf)) {
    const seen = counts.get(chip.id);
    const surfacesSoFar = seen === undefined ? 0 : seen.surfaces;
    counts.set(chip.id, { id: chip.id, ground: chip.ground, facet: chip.facet, label: chip.label, surfaces: surfacesSoFar + 1 });
  }
  return [...counts.values()].sort(byGroundThenFacetThenLabel);
}

function byGroundThenFacetThenLabel(a: FeatureChoice, b: FeatureChoice): number {
  const ground = GROUND_ORDER.indexOf(a.ground) - GROUND_ORDER.indexOf(b.ground);
  if (ground !== 0) return ground;
  const facet = a.facet.localeCompare(b.facet);
  if (facet !== 0) return facet;
  return a.label.localeCompare(b.label);
}

/**
 * The sentence for a chosen feature no surface carries, or `null` when the
 * choice landed.
 *
 * A gallery that narrowed to nothing and drew an empty grid would read as a
 * broken gallery rather than as an honest answer, so the refusal quotes the
 * value asked for and says what IS on offer.
 */
export function narrowRefusal(surfaces: readonly DemoSurface[], id: string | null): string | null {
  if (id === null) return null;
  if (narrowTo(surfaces, id).length > 0) return null;
  return `no surface here carries "${id}" — ${choicesOf(surfaces).length} features are on offer across ${surfaces.length} ${surfaces.length === 1 ? 'surface' : 'surfaces'}`;
}
