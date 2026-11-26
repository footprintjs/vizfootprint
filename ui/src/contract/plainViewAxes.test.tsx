// @vitest-environment jsdom
/**
 * A VIEW DRAWN ALONE IS A STACK OF ONE, wherever its definition said anything
 * about an axis.
 *
 * A definition may declare things about the axis of a plain view. The host
 * folds them onto `RenderState.frame`. The renderers of a plain view handed
 * their chart an empty domain, so every one was dropped and nothing said so. (A
 * stack of layers always honoured them.) Now the view is asked the stack's own
 * questions as the one layer it is.
 *
 * | the frame holds, on a channel the view binds | before                  | now                                                |
 * |----------------------------------------------|-------------------------|----------------------------------------------------|
 * | `transform: 'log'` on a scatter's x or y     | a linear axis           | decades; equal factors at equal steps              |
 * | `transform: 'log'` on a line's y, or its x   | a linear axis           | a logarithmic one                                  |
 * | `transform: 'log'` on a histogram's x        | linear bins             | bins of equal factors are equally wide             |
 * | `zeroGuide: true` on a scatter's or line's y | no line                 | one zero line across the plot                      |
 * | `bounds`                                     | the data's own extent   | the declared extent                                |
 * | a span folded to reach zero                  | the data's own extent   | the folded span: the axis starts at zero           |
 * | only the span this data reaches              | its own extent, roomy   | the folded span, with no margin at its ends        |
 * | bounds the data runs past                    | drawn roomy, in silence | drawn on the bounds, and said in words             |
 * | `zeroGuide: true` where the mark draws none  | dropped                 | refused in words, naming the view                  |
 * | a histogram's x folded as categories         | drawn, its drag mute    | refused in words, naming the view                  |
 * | an entry on one axis only                    |                         | the other axis keeps its own extent and its margin |
 * | an entry on a channel the view does not bind | ignored                 | ignored                                            |
 * | an independent channel with no keys          | its own extent          | byte-identical                                     |
 * | nothing                                      | its own extent          | byte-identical                                     |
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

  it('is drawn on the span the fold gives it, with no margin at the ends, as a layer is', () => {
    const el = draw(scatterRenderer(), POINTS, XY, { x: channel([1, 1000]), y: channel([-1, 2]) });
    const xs = [...el.querySelectorAll('circle.vzf-dot')].map((c) => num(c, 'cx'));
    const plot = [...el.querySelectorAll('[data-axis-orient="bottom"] line')].map((l) => [num(l, 'x1'), num(l, 'x2')]).flat();
    // the lowest and highest points stand on the two ends of the axis line
    expect(Math.min(...xs)).toBe(Math.min(...plot));
    expect(Math.max(...xs)).toBe(Math.max(...plot));
    // …where a chart on its own extent leaves room
    document.body.innerHTML = '';
    const own = [...draw(scatterRenderer(), POINTS, XY).querySelectorAll('circle.vzf-dot')].map((c) => num(c, 'cx'));
    expect(Math.min(...own)).toBeGreaterThan(Math.min(...xs));
  });

  it('starts at zero where the fold reached zero', () => {
    const rows = [501, 510, 600, 1500].map((x, i) => ({ id: `p${String(i)}`, x, y: i }));
    expect(ticks(draw(scatterRenderer(), rows, XY, { x: channel([0, 1500]) }), 'bottom')[0]).toBe('0');
    document.body.innerHTML = '';
    // on its own extent the same data starts near its lowest value
    expect(Number(ticks(draw(scatterRenderer(), rows, XY), 'bottom')[0])).toBeGreaterThan(0);
  });

  it('says in words what stands outside declared bounds', () => {
    const el = draw(scatterRenderer(), POINTS, XY, { x: channel([1, 1000], { bounds: [0, 500] }) });
    expect([...el.querySelectorAll('text.vzf-outside-note')].map((t) => t.textContent)).toEqual(['x has 1 value outside its declared bounds [0, 500] — bounds say what the quantity CAN be, so either they are wrong or this data is']);
  });

  it('ignores a key on a channel it does not bind', () => {
    const plain = draw(scatterRenderer(), POINTS, { x: 'x' }).innerHTML;
    document.body.innerHTML = '';
    expect(draw(scatterRenderer(), POINTS, { x: 'x' }, { y: channel([-1, 2], { zeroGuide: true, transform: 'log', bounds: [0, 9] }) }).innerHTML).toBe(plain);
  });

  it('an independent channel with no keys holds nothing to honour: the chart it always was', () => {
    const plain = draw(scatterRenderer(), POINTS, XY).innerHTML;
    document.body.innerHTML = '';
    expect(draw(scatterRenderer(), POINTS, XY, { x: { mode: 'independent', guide: 'per-layer' } }).innerHTML).toBe(plain);
  });

  it('…and one that declares a curve is drawn on it, on its own extent', () => {
    const el = draw(scatterRenderer(), POINTS, XY, { x: { mode: 'independent', guide: 'per-layer', transform: 'log' } as ResolvedChannel });
    expect(ticks(el, 'bottom')).toEqual(['1', '10', '100', '1000']);
  });

  it('with no frame, or an empty one, is byte for byte the chart it was', () => {
    const plain = draw(scatterRenderer(), POINTS, XY).innerHTML;
    document.body.innerHTML = '';
    expect(draw(scatterRenderer(), POINTS, XY, {}).innerHTML).toBe(plain);
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

  it('a box plot says in words which boxes reach past declared bounds', () => {
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: 1, whiskerHi: 5, outliers: [12], count: 4 }];
    const el = draw(boxPlotRenderer(), box, { x: 'category', y: 'price' }, { y: channel([1, 12], { bounds: [0, 10] }) });
    expect([...el.querySelectorAll('text.vzf-outside-note')].map((t) => t.textContent)).toEqual(['y has 1 box that reaches outside the span this axis was given [0, 10]']);
  });

  it('a bar that binds y is drawn on the folded count, from zero, and says which bars are taller than declared bounds', () => {
    const bars: readonly RenderRow[] = [{ category: 'A', count: 3 }, { category: 'B', count: 8 }];
    const heights = (el: HTMLElement): number[] => [...el.querySelectorAll('rect.vzf-barrect')].map((b) => num(b, 'height'));
    const own = heights(draw(barRenderer(), bars, { category: 'category', y: 'count' }));
    document.body.innerHTML = '';
    // a ceiling of 16 is twice the tallest bar: every bar is half as tall as on its own extent
    const folded = heights(draw(barRenderer(), bars, { category: 'category', y: 'count' }, { y: channel([0, 16]) }));
    expect(folded[1]!).toBeCloseTo(own[1]! / 2, 6);
    document.body.innerHTML = '';
    const el = draw(barRenderer(), bars, { category: 'category', y: 'count' }, { y: channel([0, 8], { bounds: [0, 5] }) });
    expect([...el.querySelectorAll('text.vzf-outside-note')].map((t) => t.textContent)).toEqual(['y has 1 bar outside the span this axis was given [0, 5]']);
  });

  it('a histogram whose x was folded as categories is refused in words: a band has no between for its drag', () => {
    const cats = { mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: ['a', 'b'] } as unknown as ResolvedChannel;
    const el = draw(histogramRenderer(), BINS, { x: 'mass' }, { x: cats });
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
