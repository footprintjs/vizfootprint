// @vitest-environment jsdom
/**
 * A DECLARED AXIS WITH NO SPAN TO FOLD still reaches the picture.
 *
 * The fold has no span for a channel when no cell could be read (the read was
 * refused, every cell was a silence, `basis: 'rows'` read no rows, a logarithm
 * could place none). It used to answer nothing for that channel, so a curve, a
 * zero line or bounds declared on it reached no picture and nothing said so.
 * It now answers an entry with the declaration and no span (`UnfoldedDomain`,
 * `vizfootprint/def`), and the renderers draw it.
 *
 * | the entry holds, and no span          | the data                  | before (no entry)            | now                                              |
 * |---------------------------------------|---------------------------|------------------------------|--------------------------------------------------|
 * | `transform: 'log'`                    | every value ≤ 0           | a linear axis, in silence    | a logarithmic axis, and the count of values it cannot place |
 * | `transform: 'log'`                    | positive values           | a linear axis                | a logarithmic axis on the chart's own extent     |
 * | `bounds: [0, 100]`                    | no rows                   | an axis invented from nothing| the axis on the declared bounds, with no marks   |
 * | `zeroGuide: true`                     | −3 … 5                    | no line                      | the zero line, on the chart's own extent         |
 * | bounds a count cannot stand on        | a bar that binds y        | drawn from zero              | refused in words, as with a span                 |
 * | a category or a date x, a no-op key   | a line                    | the chart                    | the chart: nothing was asked that changes it     |
 * | in a stack, y of two lines            |                           | each line's own extent       | the same, on the declared curve; no span is invented for the guide |
 * | in a stack, a bar and a line, no span | a line with a row below 0 | drawn                        | drawn: a y with no span reaches nowhere, so not below zero |
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barRenderer, layeredRenderer, lineRenderer, scatterRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type Renderer, type RenderLayer, type RenderRow, type ResolvedChannel } from './types.js';

afterEach(() => {
  document.body.innerHTML = '';
});

const callbacks = () => ({ emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() });
/** The fold's answer for a declared channel with no span: the declaration, the column's kind, and no `scale` or `domain`. */
const unfolded = (kind: 'quantitative' | 'temporal' | 'categorical', declared: object): ResolvedChannel => ({ mode: 'shared', basis: 'table', guide: 'merged', ...declared, unfolded: true, kind }) as unknown as ResolvedChannel;
const folded = (scale: string, domain: unknown): ResolvedChannel => ({ mode: 'shared', basis: 'table', guide: 'merged', scale, domain }) as unknown as ResolvedChannel;

function drawn(renderer: Renderer, rows: readonly RenderRow[], encodings: Readonly<Record<string, string>>, frame?: Readonly<Record<string, ResolvedChannel>>): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  renderer.mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks() }).update({ rows, encodings, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, ...(frame === undefined ? {} : { frame }) });
  return el;
}
const yTicks = (el: HTMLElement): string[] => [...el.querySelectorAll('[data-axis-orient="left"] text.vzf-tick')].map((t) => t.textContent ?? '');
const refusal = (el: HTMLElement): string => el.querySelector('.vzf-chart-refusal')?.textContent ?? '';
const XY = { x: 'x', y: 'y' };

describe('a plain view', () => {
  it('draws a declared logarithmic axis where no value can be placed on it, and says how many it could not place', () => {
    const rows = [{ id: 'a', x: 1, y: -3 }, { id: 'b', x: 2, y: 0 }];
    const el = drawn(scatterRenderer(), rows, XY, { y: unfolded('quantitative', { transform: 'log' }) });
    expect(yTicks(el)).toEqual(['1', '10']);
    expect(el.querySelectorAll('circle.vzf-dot')).toHaveLength(0);
    expect(el.querySelector('text.vzf-excluded-note')!.textContent).toBe('2 values are not drawn: a logarithmic axis has no place for zero or a negative number');
    // with no entry, which is what the fold used to answer, the same data is a linear axis and no word
    document.body.innerHTML = '';
    const before = drawn(scatterRenderer(), rows, XY);
    expect(before.querySelector('text.vzf-excluded-note')).toBeNull();
    expect(before.querySelectorAll('circle.vzf-dot')).toHaveLength(2);
  });

  it('draws the declared curve on the chart’s own extent where the values can be placed', () => {
    const rows = [1, 10, 100, 1000].map((y, i) => ({ id: `p${String(i)}`, x: i, y }));
    expect(yTicks(drawn(scatterRenderer(), rows, XY, { y: unfolded('quantitative', { transform: 'log' }) }))).toEqual(['1', '10', '100', '1000']);
  });

  it('draws the axis on declared bounds over no rows, where an axis used to be invented', () => {
    expect(yTicks(drawn(scatterRenderer(), [], XY, { y: unfolded('quantitative', { bounds: [0, 100] }) }))).toEqual(['0', '20', '40', '60', '80', '100']);
  });

  it('draws a declared zero line on the chart’s own extent', () => {
    const rows = [{ id: 'a', x: 1, y: -3 }, { id: 'b', x: 2, y: 5 }];
    expect(drawn(scatterRenderer(), rows, XY, { y: unfolded('quantitative', { zeroGuide: true }) }).querySelectorAll('line.vzf-zero')).toHaveLength(1);
    document.body.innerHTML = '';
    expect(drawn(scatterRenderer(), rows, XY).querySelectorAll('line.vzf-zero')).toHaveLength(0);
  });

  it('is still judged: bounds a count cannot stand on are refused with no span as with one', () => {
    const el = drawn(barRenderer(), [{ category: 'A', count: 3 }], { category: 'category', y: 'count' }, { y: unfolded('quantitative', { bounds: [2, 20] }) });
    expect(refusal(el)).toBe('view "v" is a bar, read from zero, and its y declares bounds [2, 20]: a length from zero cannot be drawn on them as declared. Declare bounds that start at zero and reach one or more, or declare none.');
  });

  it('a category or a date x that declared a word with nothing to change is the chart it was', () => {
    const bands = [{ k: 'A', v: 1 }, { k: 'B', v: 2 }];
    const own = drawn(lineRenderer(), bands, { x: 'k', y: 'v' }, { x: folded('categorical', ['A', 'B']) }).innerHTML;
    document.body.innerHTML = '';
    // the column is still a category, so the line is still on bands: the kind is the column's, span or no span
    const el = drawn(lineRenderer(), bands, { x: 'k', y: 'v' }, { x: unfolded('categorical', { zeroGuide: false }) });
    expect(el.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
    expect(el.innerHTML).toBe(own);
    document.body.innerHTML = '';
    const days = [{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }];
    const plain = drawn(lineRenderer(), days, { x: 'd', y: 'v' }).innerHTML;
    document.body.innerHTML = '';
    expect(drawn(lineRenderer(), days, { x: 'd', y: 'v' }, { x: unfolded('temporal', { transform: 'linear' }) }).innerHTML).toBe(plain);
  });
});

describe('a stack', () => {
  const BANDS = { category: folded('categorical', ['A', 'B']), x: folded('categorical', ['A', 'B']) };
  function stack(kinds: readonly ['bar' | 'line', 'line'], layers: readonly RenderLayer[], y: ResolvedChannel): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    layeredRenderer({ layers: { a: { kind: kinds[0] }, b: { kind: kinds[1] } } })
      .mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: callbacks(), layers: { a: callbacks(), b: callbacks() } })
      .update({ rows: [], encodings: {}, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, layers, frame: { ...BANDS, y } });
    return el;
  }
  const line = (layerId: string, values: readonly number[]): RenderLayer => ({ layerId, table: 't', rows: values.map((v, i) => ({ k: i === 0 ? 'A' : 'B', v })), encodings: { x: 'k', y: 'v' } });

  it('two lines on a declared logarithmic y with no span are drawn, each on its own extent, and no span is invented for the guide', () => {
    const el = stack(['line', 'line'], [line('a', [1, 100]), line('b', [10, 1000])], unfolded('quantitative', { transform: 'log' }));
    expect(refusal(el)).toBe('');
    expect(el.querySelectorAll('circle.vzf-line-dot')).toHaveLength(4);
    // the frame draws x; it has no y span, so it draws no y ticks
    expect([...el.querySelectorAll('.vzf-frame-guide [data-axis-orient="left"] text.vzf-tick')]).toHaveLength(0);
  });

  it('a bar and a line on a y with no span: nothing reaches below zero, so the stack draws; with bounds it is judged by them', () => {
    const bars: RenderLayer = { layerId: 'a', table: 't', rows: [{ k: 'A', count: 5 }, { k: 'B', count: 8 }], encodings: { category: 'k', y: 'count' } };
    const el = stack(['bar', 'line'], [bars, line('b', [-4, 6])], unfolded('quantitative', { transform: 'linear' }));
    expect(refusal(el)).toBe('');
    expect(el.querySelectorAll('rect.vzf-barrect')).toHaveLength(2);
    document.body.innerHTML = '';
    expect(refusal(stack(['bar', 'line'], [bars, line('b', [4, 6])], unfolded('quantitative', { bounds: [2, 20] })))).toContain('declares bounds [2, 20]');
    document.body.innerHTML = '';
    expect(refusal(stack(['bar', 'line'], [bars, line('b', [4, 6])], unfolded('quantitative', { bounds: [0, 20] })))).toBe('');
  });
});
