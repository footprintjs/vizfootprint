// @vitest-environment jsdom
/**
 * A VIEW WITH NO LAYERS honours what its definition declared about an axis.
 *
 * A definition may declare three things about the axis of a plain view: the
 * curve it is drawn on, a line where it crosses zero, and what the quantity can
 * be. The fold echoes them on `RenderState.frame`. The renderers of a plain view
 * handed their chart an empty domain, so all three were dropped and nothing
 * said so. (A stack of layers always honoured them.)
 *
 * | the view declares, on a channel it binds     | before                         | now                                              |
 * |----------------------------------------------|--------------------------------|--------------------------------------------------|
 * | `transform: 'log'` on a scatter's x or y     | a linear axis                  | decades; equal factors at equal steps            |
 * | `transform: 'log'` on a line's y, or its x   | a linear axis                  | a logarithmic one                                |
 * | `transform: 'log'` on a histogram's x        | linear bins                    | bins of equal factors are equally wide           |
 * | `zeroGuide: true` on a scatter's or line's y | no line                        | one zero line across the plot                    |
 * | `bounds` on a scatter, a line or a box plot  | the data's own extent          | the declared extent                              |
 * | `zeroGuide: true` where the mark draws none  | dropped                        | refused in words, in the definition door's words |
 * | only the span this data reaches              | the chart's own extent         | the same: the chart keeps its own room           |
 * | a key on a channel the view does not bind    | ignored                        | ignored                                          |
 * | nothing                                      | the chart's own extent         | byte-identical                                   |
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boxPlotRenderer, barRenderer, histogramRenderer, lineRenderer, scatterRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type Renderer, type RenderRow, type RenderState, type ResolvedChannel } from './types.js';

afterEach(() => {
  document.body.innerHTML = '';
});

type Frame = Readonly<Record<string, ResolvedChannel>>;
/** A channel as the fold hands it for a plain view: shared, the span its data reaches, and the declared keys. */
const channel = (domain: readonly [number, number], declared: object = {}): ResolvedChannel => ({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain, ...declared }) as ResolvedChannel;

function draw(renderer: Renderer, rows: readonly RenderRow[], encodings: Readonly<Record<string, string>>, frame?: Frame): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const m = renderer.mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() } });
  const state: RenderState = { rows, encodings, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, ...(frame === undefined ? {} : { frame }) };
  m.update(state);
  return el;
}
const ticks = (el: HTMLElement, orient: 'bottom' | 'left'): string[] => [...el.querySelectorAll(`[data-axis-orient="${orient}"] text.vzf-tick`)].map((t) => t.textContent ?? '');
const num = (node: Element, name: string): number => Number(node.getAttribute(name));

const POINTS: readonly RenderRow[] = [1, 10, 100, 1000].map((x, i) => ({ id: `p${String(i)}`, x, y: i - 1 }));
const XY = { x: 'x', y: 'y' };

describe('a plain scatter', () => {
  it('draws a declared logarithmic x: decades, and equal factors at equal steps', () => {
    const el = draw(scatterRenderer(), POINTS, XY, { x: channel([1, 1000], { transform: 'log' }) });
    expect(ticks(el, 'bottom')).toEqual(['1', '10', '100', '1000']);
    const xs = [...el.querySelectorAll('circle.vzf-dot')].map((c) => num(c, 'cx'));
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 6);
    expect(xs[2]! - xs[1]!).toBeCloseTo(xs[3]! - xs[2]!, 6);
  });

  it('draws a declared logarithmic y', () => {
    const rows = POINTS.map((r) => ({ ...r, y: r.x }));
    const el = draw(scatterRenderer(), rows, XY, { y: channel([1, 1000], { transform: 'log' }) });
    expect(ticks(el, 'left')).toEqual(['1', '10', '100', '1000']);
    expect(ticks(el, 'bottom')).toEqual(['0', '200', '400', '600', '800', '1000']);
  });

  it('draws a declared zero line on y, on the zero tick', () => {
    const el = draw(scatterRenderer(), POINTS, XY, { y: channel([-1, 2], { zeroGuide: true }) });
    const zero = el.querySelectorAll('line.vzf-zero');
    expect(zero).toHaveLength(1);
    const zeroTick = [...el.querySelectorAll('[data-axis-orient="left"] > g')].find((g) => g.querySelector('text')!.textContent === '0')!;
    expect(num(zero[0]!, 'y1')).toBeCloseTo(num(zeroTick.querySelector('line')!, 'y1'), 6);
  });

  it('draws its axis on declared bounds', () => {
    const el = draw(scatterRenderer(), POINTS, XY, { x: channel([1, 1000], { bounds: [0, 5000] }) });
    expect(ticks(el, 'bottom')).toEqual(['0', '1000', '2000', '3000', '4000', '5000']);
  });

  it('keeps its own extent, with its own room, when only the span its data reaches was folded', () => {
    const plain = draw(scatterRenderer(), POINTS, XY).innerHTML;
    document.body.innerHTML = '';
    expect(draw(scatterRenderer(), POINTS, XY, { x: channel([1, 1000]), y: channel([-1, 2]) }).innerHTML).toBe(plain);
  });

  it('ignores a key on a channel it does not bind', () => {
    const plain = draw(scatterRenderer(), POINTS, { x: 'x' }).innerHTML;
    document.body.innerHTML = '';
    expect(draw(scatterRenderer(), POINTS, { x: 'x' }, { y: channel([-1, 2], { zeroGuide: true, transform: 'log', bounds: [0, 9] }) }).innerHTML).toBe(plain);
  });

  it('ignores bounds on a channel that is not a number, and an independent channel has none', () => {
    const plain = draw(scatterRenderer(), POINTS, XY).innerHTML;
    document.body.innerHTML = '';
    const dated = { mode: 'shared', basis: 'table', guide: 'merged', scale: 'temporal', domain: ['2026-01-01', '2026-02-01'], bounds: [0, 5000] } as unknown as ResolvedChannel;
    expect(draw(scatterRenderer(), POINTS, XY, { x: dated }).innerHTML).toBe(plain);
    document.body.innerHTML = '';
    expect(draw(scatterRenderer(), POINTS, XY, { x: { mode: 'independent', guide: 'per-layer' } }).innerHTML).toBe(plain);
  });
});

describe('a plain line', () => {
  const rows: readonly RenderRow[] = POINTS.map((r) => ({ ...r, y: r.x }));

  it('draws a declared logarithmic y, and a logarithmic x when its x is a run of numbers', () => {
    const el = draw(lineRenderer(), rows, XY, { y: channel([1, 1000], { transform: 'log' }) });
    expect(ticks(el, 'left')).toEqual(['1', '10', '100', '1000']);
    document.body.innerHTML = '';
    const onX = draw(lineRenderer(), rows, XY, { x: channel([1, 1000], { transform: 'log' }) });
    const xs = [...onX.querySelectorAll('circle.vzf-line-dot')].map((c) => num(c, 'cx'));
    expect(xs).toHaveLength(4);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 6);
  });

  it('draws a declared zero line on y and declared bounds on y', () => {
    const el = draw(lineRenderer(), POINTS, XY, { y: channel([-1, 2], { zeroGuide: true }) });
    expect(el.querySelectorAll('line.vzf-zero')).toHaveLength(1);
    document.body.innerHTML = '';
    const bounded = draw(lineRenderer(), POINTS, XY, { y: channel([-1, 2], { bounds: [-10, 10] }) });
    expect(ticks(bounded, 'left')).toEqual(['-10', '-5', '0', '5', '10']);
  });

  it('refuses a zero line on x in words: a line draws one on y only', () => {
    const el = draw(lineRenderer(), POINTS, XY, { x: channel([1, 1000], { zeroGuide: true }) });
    const said = el.querySelector('p.vzf-chart-refusal');
    expect(said).not.toBeNull();
    expect(said!.textContent).toContain('view "v"');
    expect(said!.textContent).toContain('zero');
    expect(el.querySelector('svg')).toBeNull();
  });
});

describe('a plain histogram, box plot and bar', () => {
  const BINS: readonly RenderRow[] = [
    { x0: 1, x1: 10, count: 2 },
    { x0: 10, x1: 100, count: 5 },
  ];

  it('a histogram draws a declared logarithmic x: bins of equal factors are equally wide', () => {
    const widths = (el: HTMLElement): number[] => [...el.querySelectorAll('rect.vzf-histbar')].map((r) => num(r, 'width'));
    const linear = widths(draw(histogramRenderer(), BINS, { x: 'mass' }));
    expect(linear[1]!).toBeGreaterThan(linear[0]! * 5);
    document.body.innerHTML = '';
    const log = widths(draw(histogramRenderer(), BINS, { x: 'mass' }, { x: channel([1, 100], { transform: 'log' }) }));
    expect(log[1]!).toBeCloseTo(log[0]!, 6);
  });

  it('a box plot draws its value axis on declared bounds', () => {
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: 1, whiskerHi: 5, outliers: [], count: 4 }];
    const el = draw(boxPlotRenderer(), box, { x: 'category', y: 'price' }, { y: channel([1, 5], { bounds: [0, 10] }) });
    expect(ticks(el, 'left')).toEqual(['0', '2', '4', '6', '8', '10']);
  });

  it('a box plot asked for a zero line is refused in words, where it used to draw none and say nothing', () => {
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: -1, whiskerHi: 5, outliers: [], count: 4 }];
    const el = draw(boxPlotRenderer(), box, { x: 'category', y: 'price' }, { y: channel([-1, 5], { zeroGuide: true }) });
    expect(el.querySelector('p.vzf-chart-refusal')!.textContent).toContain('view "v"');
    expect(el.querySelector('svg')).toBeNull();
  });

  it('a bar that binds no y is not judged for a zero line folded on y, and is drawn as it was', () => {
    const bars: readonly RenderRow[] = [{ category: 'A', count: 3 }];
    const plain = draw(barRenderer(), bars, { category: 'category' }).innerHTML;
    document.body.innerHTML = '';
    expect(draw(barRenderer(), bars, { category: 'category' }, { y: channel([0, 3], { zeroGuide: true }) }).innerHTML).toBe(plain);
  });
});
