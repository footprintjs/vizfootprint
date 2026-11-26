// @vitest-environment jsdom
/**
 * A COUNT AND A LINE ON ONE SHARED y ARE DRAWN ON ONE SPAN.
 *
 * Found in review: a bar is read from zero and scales by zero up to the
 * ceiling whatever span it is handed. A line handed the same folded pair
 * scaled by the pair. On a y folded as 40…100 the bar stood on 0…100 and the
 * line on 40…100, in one plot, under one axis.
 *
 * | the stack                         | the shared y is folded as | before                               | now                          |
 * |-----------------------------------|---------------------------|--------------------------------------|------------------------------|
 * | a bar and a line, both bind y     | 40…100                    | bar on 0…100, line on 40…100         | both on 0…100, as the guide  |
 * | a bar and a line, both bind y     | 0…0.5                     | bar on 0…1, line on 0…0.5            | both on 0…1                  |
 * | a bar and a line, both bind y     | 0…100                     | one span                             | unchanged                    |
 * | a bar and a line, both bind y     | −20…100                   | the floor is the line's −20; the guide calls it 0 | refused in words |
 * | a bar and a line, both bind y     | declared bounds 40…100    | bar on 0…100, line on 40…100         | refused in words             |
 * | a bar and a line, both bind y     | declared bounds 0…100     | one span                             | unchanged                    |
 * | a bar that binds no y, and a line | 40…100                    | bar on its own ceiling, guide from 0 | unchanged (a task of its own) |
 * | a line and a point (no count)     | 40…100                    | both on 40…100                       | unchanged                    |
 * | two bars                          | 40…100                    | both on 0…100                        | unchanged                    |
 * | a bar and a line, y logarithmic   | any                       | not this rule's                      | unchanged                    |
 */
import { describe, expect, it, vi } from 'vitest';
import { layeredRenderer, RENDERER_PROTOCOL_VERSION, type RenderLayer, type RendererCallbacks, type ResolvedChannel } from './index.js';
import { emptySelection } from './selection.js';

const callbacks = (): RendererCallbacks => ({ emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() });
const shared = (scale: 'quantitative' | 'categorical', domain: unknown, more: Partial<ResolvedChannel> = {}): ResolvedChannel =>
  ({ mode: 'shared', basis: 'table', guide: 'merged', scale, domain, ...more }) as ResolvedChannel;

const BARS: RenderLayer = { layerId: 'a', table: 't', rows: [{ k: 'A', count: 50 }, { k: 'B', count: 100 }], encodings: { category: 'k', y: 'count' } };
const BARS_NO_Y: RenderLayer = { ...BARS, encodings: { category: 'k' } };
const LINE: RenderLayer = { layerId: 'b', table: 'u', rows: [{ k: 'A', v: 40 }, { k: 'B', v: 100 }], encodings: { x: 'k', y: 'v' } };
const POINTS: RenderLayer = { layerId: 'a', table: 't', rows: [{ p: 1, v: 50 }, { p: 2, v: 90 }], encodings: { x: 'p', y: 'v' } };
const RUN: RenderLayer = { layerId: 'b', table: 'u', rows: [{ p: 1, v: 40 }, { p: 2, v: 100 }], encodings: { x: 'p', y: 'v' } };
const BANDS = { category: shared('categorical', ['A', 'B']), x: shared('categorical', ['A', 'B']) };

/** Draw a two-layer stack and hand back its element. */
function drawn(kinds: readonly ['bar' | 'point' | 'line', 'bar' | 'line'], layers: readonly RenderLayer[], frame: Readonly<Record<string, ResolvedChannel>>): HTMLElement {
  const el = document.createElement('div');
  const mounted = layeredRenderer({ layers: { a: { kind: kinds[0] }, b: { kind: kinds[1] } } }).mount(el, {
    protocolVersion: RENDERER_PROTOCOL_VERSION,
    viewId: 'v',
    callbacks: callbacks(),
    layers: { a: callbacks(), b: callbacks() },
  });
  mounted.update({ rows: [], encodings: {}, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, layers, frame });
  return el;
}

const refusalOf = (el: Element): string => el.querySelector('.vzf-chart-refusal')?.textContent ?? '';
const yTicks = (el: Element): string[] => [...el.querySelectorAll('.vzf-frame-guide [data-axis-orient="left"] text')].map((t) => t.textContent ?? '');
const lineOf = (el: Element): string => el.querySelector('[data-layer="b"] path')?.getAttribute('d') ?? '';
const barLine = (y: unknown): HTMLElement => drawn(['bar', 'line'], [BARS, LINE], { ...BANDS, y: shared('quantitative', y) });

describe('a count and a line on one shared y', () => {
  it('folded as 40…100 is the picture of 0…100: bars, line and guide on one span', () => {
    const [narrow, whole] = [barLine([40, 100]), barLine([0, 100])];
    expect(refusalOf(narrow)).toBe('');
    expect(yTicks(narrow)).toEqual(['0', '20', '40', '60', '80', '100']);
    expect(lineOf(narrow)).not.toBe('');
    expect(narrow.innerHTML).toBe(whole.innerHTML);
    // the line's 40 stands at the guide's 40, not on the floor where the guide says 0
    const tick40 = [...narrow.querySelectorAll('.vzf-frame-guide [data-axis-orient="left"] text')].find((t) => t.textContent === '40')!;
    const lineStartY = Number(/^M[\d.]+,([\d.]+)/.exec(lineOf(narrow))![1]);
    const top = Number.parseFloat((narrow.querySelector('[data-layer="b"]') as HTMLElement).style.top);
    // (a tick's label sits a few pixels under its own line, so: within six pixels, where the floor is 90 away)
    expect(Math.abs(lineStartY + top - Number(tick40.getAttribute('y')))).toBeLessThan(6);
  });

  it('with a ceiling below one, both stand on the count’s 0…1', () => {
    expect(barLine([0, 0.5]).innerHTML).toBe(barLine([0, 1]).innerHTML);
  });

  it('reaching below zero is refused in words, naming both layers and the low end', () => {
    expect(refusalOf(barLine([-20, 100]))).toBe(
      'layer "a" is a bar, read from zero, and the y it shares with layer "b" reaches below zero (-20): one scale cannot hold a length from zero and a line under it. Declare the bar first and resolve y as independent, so each layer has a y of its own.',
    );
    expect(refusalOf(barLine([0, 100]))).toBe('');
  });

  it('with declared bounds that are not the count’s span is refused: a declaration is drawn as declared or not at all', () => {
    const bounded = (bounds: readonly [number, number]): HTMLElement => drawn(['bar', 'line'], [BARS, LINE], { ...BANDS, y: shared('quantitative', [40, 100], { bounds }) });
    expect(refusalOf(bounded([40, 100]))).toBe(
      'layer "a" is a bar, read from zero, and the y it shares with layer "b" declares bounds [40, 100]: a length from zero cannot be drawn on them as declared. Declare bounds that start at zero and reach one or more, or declare none. Declare the bar first and resolve y as independent, so each layer has a y of its own.',
    );
    expect(refusalOf(bounded([-5, 100]))).toContain('declares bounds [-5, 100]');
    expect(refusalOf(bounded([0, 0.5]))).toContain('declares bounds [0, 0.5]');
    // a pair given backwards is the same declaration: both layers stand on 0…100, as they always did
    expect(refusalOf(bounded([100, 0]))).toBe('');
    // bounds that ARE the count's span draw, on those bounds, whatever the rows reach
    expect(refusalOf(bounded([0, 100]))).toBe('');
    expect(bounded([0, 100]).innerHTML).toBe(barLine([0, 100]).innerHTML);
    expect(yTicks(bounded([0, 200]))).toContain('200');
  });

  it('a histogram is told the way out that exists for it: a frame of its own', () => {
    // a histogram takes neither side of a two-scale frame, so "resolve y as independent" would be refused in turn
    const bins: RenderLayer = { layerId: 'a', table: 't', rows: [{ x0: 0, x1: 1, count: 50 }, { x0: 1, x1: 2, count: 100 }], encodings: { x: 'x0', y: 'count' } };
    const run: RenderLayer = { layerId: 'b', table: 'u', rows: [{ p: 0.5, v: -20 }, { p: 1.5, v: 100 }], encodings: { x: 'p', y: 'v' } };
    const stack = (y: ResolvedChannel): HTMLElement => {
      const el = document.createElement('div');
      const mounted = layeredRenderer({ layers: { a: { kind: 'histogram' }, b: { kind: 'line' } } }).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks(), layers: { a: callbacks(), b: callbacks() } });
      mounted.update({ rows: [], encodings: {}, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, layers: [bins, run], frame: { x: shared('quantitative', [0, 2]), y } });
      return el;
    };
    expect(refusalOf(stack(shared('quantitative', [-20, 100])))).toBe(
      'layer "a" is a histogram, read from zero, and the y it shares with layer "b" reaches below zero (-20): one scale cannot hold a length from zero and a line under it. Draw the histogram on a frame of its own.',
    );
    expect(refusalOf(stack(shared('quantitative', [0, 100], { bounds: [40, 100] })))).toMatch(/declares bounds \[40, 100\].*Draw the histogram on a frame of its own\.$/);
    // the way out it is NOT told is refused, which is why
    expect(refusalOf(stack({ mode: 'independent', guide: 'per-layer', scale: 'quantitative' } as unknown as ResolvedChannel))).toContain('histogram with a y of its own');
    // and at or above zero the histogram and the line stand on one span
    expect(refusalOf(stack(shared('quantitative', [40, 100])))).toBe('');
    expect(stack(shared('quantitative', [40, 100])).innerHTML).toBe(stack(shared('quantitative', [0, 100])).innerHTML);
  });

  it('three layers have no third side, so a bar among them is told to stand on a frame of its own', () => {
    const third: RenderLayer = { ...LINE, layerId: 'c' };
    const three = (y: ResolvedChannel): string => {
      const el = document.createElement('div');
      const mounted = layeredRenderer({ layers: { a: { kind: 'bar' }, b: { kind: 'line' }, c: { kind: 'line' } } }).mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks(), layers: { a: callbacks(), b: callbacks(), c: callbacks() } });
      mounted.update({ rows: [], encodings: {}, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, layers: [BARS, LINE, third], frame: { ...BANDS, y } });
      return refusalOf(el);
    };
    expect(three(shared('quantitative', [-20, 100]))).toBe(
      'layer "a" is a bar, read from zero, and the y it shares with layer "b" reaches below zero (-20): one scale cannot hold a length from zero and a line under it. Draw the bar on a frame of its own.',
    );
    // the way out it is NOT told is refused, which is why
    expect(three({ mode: 'independent', guide: 'per-layer', scale: 'quantitative' } as unknown as ResolvedChannel)).toContain('no third');
  });

  it('the way out the sentence names draws: the bar first, y independent', () => {
    const own = { mode: 'independent', guide: 'per-layer', scale: 'quantitative' } as unknown as ResolvedChannel;
    const below: RenderLayer = { ...LINE, rows: [{ k: 'A', v: -20 }, { k: 'B', v: 100 }] };
    const el = drawn(['bar', 'line'], [BARS, below], { ...BANDS, y: own });
    expect(refusalOf(el)).toBe('');
    expect(lineOf(el)).not.toBe('');
  });
});

describe('what this rule leaves alone', () => {
  it('a bar that binds no y keeps its own ceiling and the line its folded span, as before (not this rule’s)', () => {
    const el = drawn(['bar', 'line'], [BARS_NO_Y, LINE], { ...BANDS, y: shared('quantitative', [40, 100]) });
    expect(refusalOf(el)).toBe('');
    expect(yTicks(el)).toEqual(['0', '20', '40', '60', '80', '100']);
    expect(lineOf(el)).not.toBe(lineOf(barLine([40, 100])));
    expect(refusalOf(drawn(['bar', 'line'], [BARS_NO_Y, LINE], { ...BANDS, y: shared('quantitative', [-20, 100]) }))).toBe('');
  });

  it('a stack with no count keeps the folded span', () => {
    const frame = (y: unknown) => ({ x: shared('quantitative', [0, 3]), y: shared('quantitative', y) });
    const el = drawn(['point', 'line'], [POINTS, RUN], frame([40, 100]));
    expect(refusalOf(el)).toBe('');
    expect(yTicks(el)).toEqual(['40', '60', '80', '100']);
    expect(el.innerHTML).not.toBe(drawn(['point', 'line'], [POINTS, RUN], frame([0, 100])).innerHTML);
    // …and below zero is an ordinary span for two positions
    expect(refusalOf(drawn(['point', 'line'], [POINTS, RUN], frame([-20, 100])))).toBe('');
  });

  it('two bars are both read from zero already', () => {
    const second: RenderLayer = { ...BARS, layerId: 'b' };
    const two = (y: unknown): HTMLElement => drawn(['bar', 'bar'], [BARS, second], { category: BANDS.category, y: shared('quantitative', y) });
    expect(refusalOf(two([40, 100]))).toBe('');
    expect(two([40, 100]).innerHTML).toBe(two([0, 100]).innerHTML);
  });

  it('a logarithmic y is not this rule’s: nothing is widened to zero and nothing is refused by it', () => {
    const log = (y: unknown): HTMLElement => drawn(['bar', 'line'], [BARS, LINE], { ...BANDS, y: shared('quantitative', y, { transform: 'log' }) });
    expect(refusalOf(log([-20, 100]))).not.toContain('reaches below zero');
    // the line's low end, 40, stands on its layer's floor: the bottom of the folded 40…100. Widened
    // toward zero it would stand above the floor, as it does on the linear axis.
    const startY = (el: Element): number => Number(/^M[\d.]+,([\d.]+)/.exec(lineOf(el))![1]);
    // (the layer's plot floor is at 250 in this 400 by 300 frame; the widened linear line starts near 157)
    expect(startY(log([40, 100]))).toBe(250);
    expect(startY(barLine([40, 100]))).toBeLessThan(200);
  });
});
