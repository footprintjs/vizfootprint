// @vitest-environment jsdom
/**
 * A LOGARITHM, BOUNDS OR `zero` ON AN AXIS THAT IS NOT A NUMBER AXIS is refused
 * in words.
 *
 * All three are statements about numbers. The definition door refuses them
 * where a column's type is declared. Where it is not (inline rows with no
 * declared columns), or where a view is bound to another column after the
 * build, the door cannot know, and the fold decides what the axis is from the
 * cells. The renderers then read the setting as nothing: the axis was drawn
 * as if it had not been declared, with no word.
 *
 * | the frame holds, on a channel the mark binds              | before             | now                                         |
 * |-----------------------------------------------------------|--------------------|---------------------------------------------|
 * | a bar's category or a box plot's x, with any of the three | drawn, key ignored | refused: that axis is a band. "Drop it."    |
 * | a line's x folded as categories or dates, with any        | drawn, key ignored | refused: needs a number; drop it or bind a number |
 * | a scatter's y folded as categories, with bounds           | drawn, key ignored | refused: needs a number                     |
 * | a number axis with a logarithm or bounds                  | drawn as declared  | unchanged                                   |
 * | a band with none of the three (`transform: 'linear'`)     | drawn              | unchanged, byte for byte                    |
 * | any of them on a channel the mark does not bind           | ignored            | ignored                                     |
 * | a logarithm on a bar's y folded as categories             | refused: a length  | the same sentence first: a length refuses a logarithm whatever the column |
 * | the same in a stack                                       | drawn, key ignored | refused, naming the layer; the words are about the AXIS, since another layer's column may have decided it |
 *
 * `zero` reaches the renderer because the fold echoes it exactly where it
 * could not apply it: on a channel it folded as a category or a date.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barRenderer, boxPlotRenderer, layeredRenderer, lineRenderer, scatterRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type Renderer, type RenderLayer, type RenderRow, type ResolvedChannel } from './types.js';
import { needsANumberRefusal } from 'vizfootprint/def';

afterEach(() => {
  document.body.innerHTML = '';
});

const callbacks = () => ({ emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() });
const folded = (scale: string, domain: unknown, more: object = {}): ResolvedChannel => ({ mode: 'shared', basis: 'table', guide: 'merged', scale, domain, ...more }) as unknown as ResolvedChannel;
function drawn(renderer: Renderer, rows: readonly RenderRow[], encodings: Readonly<Record<string, string>>, frame?: Readonly<Record<string, ResolvedChannel>>): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  renderer.mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() }).update({ rows, encodings, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, ...(frame === undefined ? {} : { frame }) });
  return el;
}
const refusal = (el: HTMLElement): string => el.querySelector('.vzf-chart-refusal')?.textContent ?? '';
/** The sentence where the FOLD made the axis a category or a date: the definition door's, said of the axis, with both ways out. */
const said = (setting: string, who: string, channel: string, field: string, folded: string): string => `${needsANumberRefusal(setting, who, channel, field, `on an axis the frame folded as ${folded}`)}. Drop it, or bind ${channel} to a number.`;
/** The sentence where the MARK makes the axis a band: there is nothing to bind instead. */
const band = (setting: string, who: string, kind: string, channel: string, field: string): string => `${setting} needs a number axis — ${who} binds ${channel} to "${field}", and a ${kind}'s ${channel} is a band. Drop it.`;

const BARS: readonly RenderRow[] = [{ shelf: 'A', count: 3 }, { shelf: 'B', count: 8 }];
const DAYS: readonly RenderRow[] = [{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }];
const BANDS = folded('categorical', ['A', 'B']);
const RUN = folded('temporal', ['2026-01-01', '2026-01-02']);

describe('a view drawn alone', () => {
  it('a bar’s category is a band whatever its column: any of the three is refused, and the only way out is to drop it', () => {
    expect(refusal(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, transform: 'log' } as ResolvedChannel }))).toBe(band('transform "log"', 'view "v"', 'bar', 'category', 'shelf'));
    expect(refusal(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, bounds: [0, 10] } as ResolvedChannel }))).toBe(band('bounds', 'view "v"', 'bar', 'category', 'shelf'));
    expect(refusal(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, zero: true } as ResolvedChannel }))).toBe(band('zero', 'view "v"', 'bar', 'category', 'shelf'));
    expect(band('zero', 'view "v"', 'bar', 'category', 'shelf')).toBe('zero needs a number axis — view "v" binds category to "shelf", and a bar\'s category is a band. Drop it.');
    // …also where its column is a number: binding a number does not make a bar's category an axis of numbers
    const numbered = [{ n: 1, count: 3 }, { n: 2, count: 8 }];
    expect(refusal(drawn(barRenderer(), numbered, { category: 'n' }, { category: folded('quantitative', [1, 2], { transform: 'log' }) }))).toBe(band('transform "log"', 'view "v"', 'bar', 'category', 'n'));
  });

  it('a box plot’s x is a band too', () => {
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: 1, whiskerHi: 5, outliers: [], count: 4 }];
    expect(refusal(drawn(boxPlotRenderer(), box, { x: 'shelf', y: 'price' }, { x: { ...BANDS, bounds: [0, 10] } as ResolvedChannel }))).toBe(band('bounds', 'view "v"', 'boxplot', 'x', 'shelf'));
  });

  it('a line’s x the fold made a run of dates or a band of categories: needs a number, with both ways out', () => {
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: { ...RUN, transform: 'log' } as ResolvedChannel }))).toBe(said('transform "log"', 'view "v"', 'x', 'd', 'a date'));
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: { ...RUN, bounds: [0, 10] } as ResolvedChannel }))).toBe(said('bounds', 'view "v"', 'x', 'd', 'a date'));
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: { ...RUN, zero: false } as ResolvedChannel }))).toBe(said('zero', 'view "v"', 'x', 'd', 'a date'));
    const bands = [{ k: 'A', v: 1 }, { k: 'B', v: 2 }];
    expect(refusal(drawn(lineRenderer(), bands, { x: 'k', y: 'v' }, { x: { ...BANDS, zero: true } as ResolvedChannel }))).toBe(said('zero', 'view "v"', 'x', 'k', 'a category'));
    expect(said('zero', 'view "v"', 'x', 'k', 'a category')).toBe('zero needs a number — view "v" binds x to "k", on an axis the frame folded as a category. Drop it, or bind x to a number.');
  });

  it('says the logarithm before bounds before zero, and y after x', () => {
    const all = { ...RUN, transform: 'log', bounds: [1, 10], zero: true } as ResolvedChannel;
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: all }))).toBe(said('transform "log"', 'view "v"', 'x', 'd', 'a date'));
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: { ...RUN, bounds: [1, 10], zero: true } as ResolvedChannel }))).toBe(said('bounds', 'view "v"', 'x', 'd', 'a date'));
    // a y folded as categories under a scatter: its y is judged after its x, which here is a number
    const rows = [{ id: 'a', x: 1, y: 'low' }];
    expect(refusal(drawn(scatterRenderer(), rows, { x: 'x', y: 'y' }, { x: folded('quantitative', [0, 2]), y: folded('categorical', ['low'], { bounds: [0, 1] }) }))).toBe(said('bounds', 'view "v"', 'y', 'y', 'a category'));
  });

  it('a length refuses a logarithm whatever its column, and says so first', () => {
    const el = drawn(barRenderer(), BARS, { category: 'shelf', y: 'count' }, { y: folded('categorical', ['a'], { transform: 'log' }) });
    expect(refusal(el)).toBe('view "v" is a bar — its y extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic');
  });

  it('leaves a number axis, a band with none of the three, and a channel the mark does not bind as they were', () => {
    const rows = [1, 10, 100].map((x, i) => ({ id: `p${String(i)}`, x, y: i }));
    expect(refusal(drawn(scatterRenderer(), rows, { x: 'x', y: 'y' }, { x: folded('quantitative', [1, 100], { transform: 'log', bounds: [1, 1000] }) }))).toBe('');
    const own = drawn(barRenderer(), BARS, { category: 'shelf' }, { category: BANDS }).innerHTML;
    document.body.innerHTML = '';
    expect(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, transform: 'linear' } as ResolvedChannel }).innerHTML).toBe(own);
    document.body.innerHTML = '';
    // the bar binds no y: a category y with bounds on the frame is not its axis, and it is judged (its category has an entry)
    expect(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: BANDS, y: folded('categorical', ['a'], { bounds: [0, 1] }) }).innerHTML).toBe(own);
  });
});

describe('a stack', () => {
  it('refuses the same, naming the layer, in words about the axis', () => {
    const layers: RenderLayer[] = [
      { layerId: 'a', table: 't', rows: BARS, encodings: { category: 'shelf', y: 'count' } },
      { layerId: 'b', table: 'u', rows: [{ shelf: 'A', v: 4 }], encodings: { x: 'shelf', y: 'v' } },
    ];
    const el = document.createElement('div');
    layeredRenderer({ layers: { a: { kind: 'bar' }, b: { kind: 'line' } } })
      .mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks(), layers: { a: callbacks(), b: callbacks() } })
      .update({ rows: [], encodings: {}, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, layers, frame: { category: BANDS, x: { ...BANDS, bounds: [0, 10] } as ResolvedChannel, y: folded('quantitative', [0, 10]) } });
    expect(refusal(el)).toBe(said('bounds', 'layer "b"', 'x', 'shelf', 'a category'));
  });
});
