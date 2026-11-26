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
 * | a bar and a line, both bind y     | −20…100                   | the line under zero outside the plot | refused in words             |
 * | a bar that binds no y, and a line | 40…100                    | line on 40…100, guide ticked 0…100   | the guide ticks 40…100       |
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
      'layer "a" is a bar, read from zero, and the y it shares with layer "b" reaches below zero (-20): one scale cannot hold a length from zero and a line under it. Give the two layers a y each (resolve y as independent), or keep the shared y at or above zero.',
    );
    // what the quantity can be wins over what the rows reach, here as everywhere
    expect(refusalOf(drawn(['bar', 'line'], [BARS, LINE], { ...BANDS, y: shared('quantitative', [40, 100], { bounds: [-5, 100] }) }))).toContain('reaches below zero (-5)');
    expect(refusalOf(barLine([0, 100]))).toBe('');
  });
});

describe('what this rule leaves alone', () => {
  it('a bar that binds no y keeps its own ceiling, and the guide is ticked on the line’s span', () => {
    const el = drawn(['bar', 'line'], [BARS_NO_Y, LINE], { ...BANDS, y: shared('quantitative', [40, 100]) });
    expect(refusalOf(el)).toBe('');
    expect(yTicks(el)).toEqual(['40', '60', '80', '100']);
    // the line's 40 is on the floor of its own span, where the guide now says 40
    expect(lineOf(el)).not.toBe(lineOf(barLine([40, 100])));
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

  it('two bars are both read from zero already, below zero or not', () => {
    const second: RenderLayer = { ...BARS, layerId: 'b' };
    const two = (y: unknown): HTMLElement => drawn(['bar', 'bar'], [BARS, second], { category: BANDS.category, y: shared('quantitative', y) });
    expect(refusalOf(two([-20, 100]))).toBe('');
    expect(two([40, 100]).innerHTML).toBe(two([0, 100]).innerHTML);
  });

  it('a logarithmic y is not this rule’s: nothing is widened to zero and nothing is refused by it', () => {
    const log = (y: unknown): HTMLElement => drawn(['bar', 'line'], [BARS, LINE], { ...BANDS, y: shared('quantitative', y, { transform: 'log' }) });
    expect(refusalOf(log([-20, 100]))).not.toContain('reaches below zero');
    expect(lineOf(log([40, 100]))).not.toBe(lineOf(barLine([40, 100])));
  });
});
