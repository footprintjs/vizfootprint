// @vitest-environment jsdom
/**
 * A LOGARITHM OR BOUNDS ON AN AXIS THAT IS NOT A NUMBER AXIS is refused in
 * words.
 *
 * Both are statements about numbers. The definition door refuses them where a
 * column's type is declared. Where it is not (inline rows with no declared
 * columns), the door cannot know, and the fold decides what the column is
 * from its cells. The renderers then read the setting as nothing: the axis was
 * drawn as if it had not been declared, with no word.
 *
 * | the frame holds, on a channel the mark binds          | before             | now                         |
 * |-------------------------------------------------------|--------------------|-----------------------------|
 * | a band of categories with `transform: 'log'`          | drawn, key ignored | refused: needs a number     |
 * | a band of categories with `bounds`                    | drawn, key ignored | refused: needs a number     |
 * | a run of dates with `transform: 'log'` or `bounds`    | drawn, key ignored | refused: needs a number     |
 * | a number axis with either                             | drawn as declared  | unchanged                   |
 * | a band or a date run with neither (`zeroGuide`, none) | drawn or its own refusal | unchanged             |
 * | either key on a channel the mark does not bind        | ignored            | ignored                     |
 * | the same in a stack                                   | drawn, key ignored | refused, naming the layer   |
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
const said = (setting: string, who: string, channel: string, field: string, columnIs: string): string => `${needsANumberRefusal(setting, who, channel, field, columnIs)}. Drop it, or bind ${channel} to a number.`;

const BARS: readonly RenderRow[] = [{ shelf: 'A', count: 3 }, { shelf: 'B', count: 8 }];
const DAYS: readonly RenderRow[] = [{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }];
const BANDS = folded('categorical', ['A', 'B']);
const RUN = folded('temporal', ['2026-01-01', '2026-01-02']);

describe('a view drawn alone', () => {
  it('a bar’s band of categories: a logarithm or bounds on it is refused, in the definition door’s sentence', () => {
    expect(refusal(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, transform: 'log' } as ResolvedChannel }))).toBe(said('transform "log"', 'view "v"', 'category', 'shelf', 'a category'));
    expect(refusal(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, bounds: [0, 10] } as ResolvedChannel }))).toBe(said('bounds', 'view "v"', 'category', 'shelf', 'a category'));
    expect(said('bounds', 'view "v"', 'category', 'shelf', 'a category')).toBe('bounds needs a number — view "v" binds category to "shelf", a category. Drop it, or bind category to a number.');
  });

  it('a line’s run of dates, and a box plot’s band: the same', () => {
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: { ...RUN, transform: 'log' } as ResolvedChannel }))).toBe(said('transform "log"', 'view "v"', 'x', 'd', 'a date'));
    expect(refusal(drawn(lineRenderer(), DAYS, { x: 'd', y: 'v' }, { x: { ...RUN, bounds: [0, 10] } as ResolvedChannel }))).toBe(said('bounds', 'view "v"', 'x', 'd', 'a date'));
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: 1, whiskerHi: 5, outliers: [], count: 4 }];
    expect(refusal(drawn(boxPlotRenderer(), box, { x: 'shelf', y: 'price' }, { x: { ...BANDS, bounds: [0, 10] } as ResolvedChannel }))).toBe(said('bounds', 'view "v"', 'x', 'shelf', 'a category'));
  });

  it('says the logarithm first where both were declared, and y after x', () => {
    const both = { ...BANDS, transform: 'log', bounds: [1, 10] } as ResolvedChannel;
    expect(refusal(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: both }))).toBe(said('transform "log"', 'view "v"', 'category', 'shelf', 'a category'));
    // a y folded as categories under a scatter: its y is judged after its x, which here is a number
    const rows = [{ id: 'a', x: 1, y: 'low' }];
    expect(refusal(drawn(scatterRenderer(), rows, { x: 'x', y: 'y' }, { x: folded('quantitative', [0, 2]), y: folded('categorical', ['low'], { bounds: [0, 1] }) }))).toBe(said('bounds', 'view "v"', 'y', 'y', 'a category'));
  });

  it('leaves a number axis, a band with neither key, and a channel the mark does not bind as they were', () => {
    const rows = [1, 10, 100].map((x, i) => ({ id: `p${String(i)}`, x, y: i }));
    expect(refusal(drawn(scatterRenderer(), rows, { x: 'x', y: 'y' }, { x: folded('quantitative', [1, 100], { transform: 'log', bounds: [1, 1000] }) }))).toBe('');
    const own = drawn(barRenderer(), BARS, { category: 'shelf' }, { category: BANDS }).innerHTML;
    document.body.innerHTML = '';
    expect(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: { ...BANDS, transform: 'linear' } as ResolvedChannel }).innerHTML).toBe(own);
    document.body.innerHTML = '';
    // the bar binds no x channel named `x`: an entry there is not its axis
    expect(drawn(barRenderer(), BARS, { category: 'shelf' }, { category: BANDS, x: { ...BANDS, transform: 'log' } as ResolvedChannel }).innerHTML).toBe(own);
  });
});

describe('a stack', () => {
  it('refuses the same, naming the layer', () => {
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
