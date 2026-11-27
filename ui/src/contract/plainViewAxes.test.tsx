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
 * | a scatter's x folded as categories           | every point at x = 0    | refused in words: a point draws no band            |
 * | `transform: 'log'` on a bar's, histogram's or box's y | linear, in silence | refused in words (in a stack too)              |
 * | bounds on a bar's y that do not start at zero | drawn from zero, in silence | refused in words (in a stack too)            |
 * | a category list on a line's or a bar's x     | slots in row order      | slots in the fold's order, an empty slot for a category with no row |
 * | an entry on one axis only                    |                         | the other axis keeps its own extent and its margin |
 * | an entry on a channel the view does not bind | ignored                 | ignored                                            |
 * | an independent channel with no keys          | its own extent          | byte-identical                                     |
 * | nothing                                      | its own extent          | byte-identical                                     |
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boxPlotRenderer, barRenderer, histogramRenderer, layeredRenderer, lineRenderer, scatterRenderer } from './renderers.js';
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

  it('a mark outside a FOLDED span is said without the word "declared": nothing was declared, and nobody is blamed', () => {
    // a fold that does not hold a row the chart draws (it happens: a fold reads one column, or reads a cell differently)
    const el = draw(scatterRenderer(), POINTS, XY, { x: channel([1, 500]) });
    expect([...el.querySelectorAll('text.vzf-outside-note')].map((t) => t.textContent)).toEqual(['x has 1 value outside the span this axis was given [1, 500]']);
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
    expect([...el.querySelectorAll('text.vzf-outside-note')].map((t) => t.textContent)).toEqual(['y has 1 box outside its declared bounds [0, 10] — bounds say what the quantity CAN be, so either they are wrong or this data is']);
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

describe('what one layer cannot be is refused the same way alone and in a stack', () => {
  const cats = (domain: readonly string[]): ResolvedChannel => ({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain }) as unknown as ResolvedChannel;
  const said = (el: HTMLElement): string => el.querySelector('p.vzf-chart-refusal')?.textContent ?? '';
  /** The same rows drawn as the one layer of a stack. */
  function stacked(kind: 'bar' | 'histogram' | 'boxplot' | 'point', rows: readonly RenderRow[], encodings: Readonly<Record<string, string>>, frame: Frame): HTMLElement {
    const el = document.createElement('div');
    const cb = () => ({ emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() });
    const m = layeredRenderer({ layers: { a: { kind } } }).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: cb(), layers: { a: cb() } });
    m.update({ rows: [], encodings: {}, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, layers: [{ layerId: 'a', table: 't', rows, encodings }], frame });
    return el;
  }
  const BARS: readonly RenderRow[] = [{ category: 'A', count: 3 }, { category: 'B', count: 8 }];
  const BAR_ENC = { category: 'category', y: 'count' };

  it('a scatter whose x was folded as categories: a point draws no band, and the way out is one a view has', () => {
    const rows: readonly RenderRow[] = [{ id: 'p', x: 'a', y: 1 }];
    expect(said(draw(scatterRenderer(), rows, XY, { x: cats(['a', 'b']) }))).toBe('view "v" is a point on a band — column "x" is a category — and a point chart draws no band in this version. Draw it as a line.');
    expect(said(stacked('point', rows, XY, { x: cats(['a', 'b']) }))).toBe('layer "a" is a point on a band — column "x" is a category — and a point chart draws no band in this version. Draw it as a line, or give it a frame of its own.');
  });

  it('a logarithmic y under a bar or a box is refused in the definition door’s sentence, and under a histogram in the renderer’s own', () => {
    const log = { y: channel([1, 100], { transform: 'log' }) };
    const tail = ' — its y extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic';
    expect(said(draw(barRenderer(), BARS, BAR_ENC, log))).toBe(`view "v" is a bar${tail}`);
    expect(said(stacked('bar', BARS, BAR_ENC, log))).toBe(`layer "a" is a bar${tail}`);
    const bins: readonly RenderRow[] = [{ x0: 1, x1: 10, count: 2 }];
    // a histogram's sentence is the renderer's own: the definition door reads a histogram's channel as its bin axis
    const binsOnly = (who: string): string => `${who} is a histogram, and its y is its count: this version draws a histogram's count as a length on a linear axis only. Its bin axis, x, may be logarithmic; drop "transform" on y.`;
    expect(said(draw(histogramRenderer(), bins, { x: 'mass', y: 'count' }, log))).toBe(binsOnly('view "v"'));
    expect(said(stacked('histogram', bins, { x: 'mass', y: 'count' }, log))).toBe(binsOnly('layer "a"'));
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: 1, whiskerHi: 5, outliers: [], count: 4 }];
    expect(said(draw(boxPlotRenderer(), box, { x: 'category', y: 'price' }, log))).toBe(`view "v" is a boxplot${tail}`);
    expect(said(stacked('boxplot', box, { x: 'category', y: 'price' }, log))).toBe(`layer "a" is a boxplot${tail}`);
    // a bar that binds no y declared nothing about its count, and a histogram's BIN axis may be logarithmic
    expect(said(draw(barRenderer(), BARS, { category: 'category' }, log))).toBe('');
    expect(said(draw(histogramRenderer(), bins, { x: 'mass' }, { x: channel([1, 10], { transform: 'log' }) }))).toBe('');
  });

  it('bounds a count cannot stand on are refused: a declared low end is drawn or refused, never dropped', () => {
    const bounded = (bounds: readonly [number, number]): Frame => ({ y: channel([3, 8], { bounds }) });
    const sentence = (who: string, pair: string): string => `${who} is a bar, read from zero, and its y declares bounds ${pair}: a length from zero cannot be drawn on them as declared. Declare bounds that start at zero and reach one or more, or declare none.`;
    expect(said(draw(barRenderer(), BARS, BAR_ENC, bounded([2, 20])))).toBe(sentence('view "v"', '[2, 20]'));
    expect(said(stacked('bar', BARS, BAR_ENC, bounded([2, 20])))).toBe(sentence('layer "a"', '[2, 20]'));
    expect(said(draw(barRenderer(), BARS, BAR_ENC, bounded([0, 0.5])))).toBe(sentence('view "v"', '[0, 0.5]'));
    // bounds that are a count's span draw, backwards or not, and a bar that binds no y declared none
    expect(said(draw(barRenderer(), BARS, BAR_ENC, bounded([0, 20])))).toBe('');
    expect(said(draw(barRenderer(), BARS, BAR_ENC, bounded([20, 0])))).toBe('');
    expect(said(draw(barRenderer(), BARS, { category: 'category' }, bounded([2, 20])))).toBe('');
    // …also when the view IS judged (its category has an entry): the bounds are on a y it does not bind
    expect(said(draw(barRenderer(), BARS, { category: 'category' }, { ...bounded([2, 20]), category: cats(['A', 'B']) }))).toBe('');
    expect(said(draw(barRenderer(), BARS, { category: 'category' }, { y: channel([1, 100], { transform: 'log' }), category: cats(['A', 'B']) }))).toBe('');
    // a box is a position on its value axis: its bounds are drawn as declared
    const box: readonly RenderRow[] = [{ category: 'A', q1: 2, median: 3, q3: 4, whiskerLo: 2, whiskerHi: 5, outliers: [], count: 4 }];
    expect(said(draw(boxPlotRenderer(), box, { x: 'category', y: 'price' }, bounded([2, 20])))).toBe('');
  });

  it('a category list on x is the fold’s: its order, and an empty slot for a category with no row', () => {
    const slots = (el: HTMLElement): string[] => [...el.querySelectorAll('[data-axis-orient="bottom"] text.vzf-tick, text.vzf-bar-catlabel, text.vzf-tick')].map((t) => t.textContent ?? '').filter((t) => /^[ABZ]$/.test(t));
    const own = draw(barRenderer(), [{ category: 'B', count: 3 }, { category: 'A', count: 8 }], { category: 'category' });
    expect(slots(own)).toEqual(['B', 'A']);
    const ownWidth = num(own.querySelector('rect.vzf-barrect')!, 'width');
    document.body.innerHTML = '';
    const folded = draw(barRenderer(), [{ category: 'B', count: 3 }, { category: 'A', count: 8 }], { category: 'category' }, { category: cats(['Z', 'A', 'B']) });
    expect(slots(folded)).toEqual(['Z', 'A', 'B']);
    // three slots where there were two, so each bar is narrower, and Z has a slot and no bar
    expect(folded.querySelectorAll('rect.vzf-barrect')).toHaveLength(2);
    expect(num(folded.querySelector('rect.vzf-barrect')!, 'width')).toBeLessThan(ownWidth);
  });
});

