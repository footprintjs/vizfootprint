/**
 * THE FILTER — and the one thing a gallery must never do, which is send a reader
 * to a page that cannot do the thing they asked for.
 *
 * The narrowing is over SURFACES. The CDC demo's shape is here in miniature: one
 * demo, two surfaces, and a feature only one of them has.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { choicesOf, demosFor, holdsFeature, narrowRefusal, narrowTo } from './filter.js';
import { chipsOf } from './chips.js';
import { librarySurfaces } from './cards.fixture.js';
import type { DemoSurface } from './types.js';

let desk: DemoSurface;
let story: DemoSurface;
let both: readonly DemoSurface[];

beforeAll(async () => {
  ({ desk, story } = await librarySurfaces());
  both = [desk, story];
});

describe('narrowing', () => {
  it('narrows to the SURFACE that carries the feature, not to the demo that owns it', () => {
    expect(narrowTo(both, 'declares:chart:heatmap')).toEqual([desk]);
    expect(demosFor(narrowTo(both, 'declares:chart:heatmap'))).toEqual(['the library']);
    // the same demo, twice, is one demo — a count line that said two would be double-counting
    expect(demosFor(both)).toEqual(['the library']);
  });

  it('keeps everything when nothing is chosen', () => {
    expect(narrowTo(both, null)).toEqual(both);
    expect(narrowRefusal(both, null)).toBeNull();
  });

  it('answers a feature question off the surface’s own chips, and nothing else', () => {
    expect(holdsFeature(desk, 'walked:verb:reencode')).toBe(true);
    expect(holdsFeature(story, 'walked:verb:reencode')).toBe(false);
    expect(holdsFeature(story, 'declares:chart:bar')).toBe(true);
  });
});

describe('the choices on offer', () => {
  it('is the union of the cards’ own chips, counted by surface', () => {
    const choices = choicesOf(both);
    const ids = choices.map((choice) => choice.id);
    expect(new Set(ids).size).toBe(ids.length);
    const minted = new Set([...chipsOf(desk), ...chipsOf(story)].map((chip) => chip.id));
    expect(new Set(ids)).toEqual(minted);
    // `bar` is on both surfaces; `heatmap` on one
    expect(choices.find((choice) => choice.id === 'declares:chart:bar')!.surfaces).toBe(2);
    expect(choices.find((choice) => choice.id === 'declares:chart:heatmap')!.surfaces).toBe(1);
  });

  it('offers no choice that narrows to nothing', () => {
    for (const choice of choicesOf(both)) expect(narrowTo(both, choice.id).length).toBeGreaterThan(0);
  });

  it('orders by ground, then facet, then label — one order, so a re-render never re-shuffles the picker', () => {
    const choices = choicesOf(both);
    const grounds = [...new Set(choices.map((choice) => choice.ground))];
    expect(grounds).toEqual(['declares', 'walked', 'by hand']);
    const declares = choices.filter((choice) => choice.ground === 'declares');
    const facets = declares.map((choice) => choice.facet);
    expect(facets).toEqual([...facets].sort());
    const charts = declares.filter((choice) => choice.facet === 'chart').map((choice) => choice.label);
    expect(charts).toEqual(['bar', 'heatmap', 'line']);
  });

  it('has nothing to offer over no surfaces at all', () => {
    expect(choicesOf([])).toEqual([]);
  });
});

describe('the refusal', () => {
  it('quotes what was asked for and says what is on offer, rather than drawing an empty grid', () => {
    const refusal = narrowRefusal(both, 'declares:chart:sunburst');
    expect(refusal).toBe(`no surface here carries "declares:chart:sunburst" — ${choicesOf(both).length} features are on offer across 2 surfaces`);
  });

  it('counts one surface in the singular', () => {
    expect(narrowRefusal([story], 'declares:chart:heatmap')).toContain('across 1 surface');
  });

  it('refuses nothing when the choice landed', () => {
    expect(narrowRefusal(both, 'declares:chart:heatmap')).toBeNull();
  });
});
