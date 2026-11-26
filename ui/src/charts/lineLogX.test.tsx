// @vitest-environment jsdom
/**
 * A LINE OVER A RUN OF NUMBERS follows a logarithmic x when one is declared.
 *
 * Found in review: a frame's guide and a point layer placed x logarithmically
 * while a line layer on the same frame placed it linearly, so the line's points
 * stood away from their own ticks.
 *
 * | the line's x                                  | before                                 | now                                         |
 * |-----------------------------------------------|----------------------------------------|---------------------------------------------|
 * | numbers 1 10 100 1000, logarithm declared     | linear: 1, 10 and 100 crowded at left  | equal factors at equal steps                |
 * | the same beside a scatter on the same domain  | different pixels for one value         | the same pixels                             |
 * | a zero or negative x under a logarithm        | drawn at a linear place                | not drawn, and counted in words             |
 * | a point no axis can place on x and on y       | —                                      | counted once                                |
 * | numbers, `transform.x: 'linear'` or none      | linear                                 | linear, the same markup                     |
 * | dates, logarithm declared on x                | ignored: a date has no logarithm       | ignored, the same markup                    |
 * | a band, logarithm declared on x               | ignored: a band has no scale           | ignored, the same markup                    |
 * | a drag across a logarithmic x                 | the linear span under the pointer      | the logarithmic span under the pointer      |
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VizLine } from './VizLine.js';
import { VizScatter } from './VizScatter.js';

afterEach(cleanup);

// jsdom has no PointerEvent: without one a pointer event carries no clientX and a drag reads NaN
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
  }
});

const run = (xs: readonly number[]) => xs.map((at, i) => ({ at, value: i + 1 }));
const cxOf = (root: HTMLElement, selector: string): number[] => [...root.querySelectorAll(selector)].map((c) => Number(c.getAttribute('cx')));
const LOG_X = { x: [1, 1000] as const, transform: { x: 'log' as const } };

describe('a line over numbers on a logarithmic x', () => {
  it('puts equal factors at equal steps', () => {
    const { container } = render(<VizLine data={run([1, 10, 100, 1000])} domain={LOG_X} width={520} height={340} />);
    const xs = cxOf(container, 'circle.vzf-line-dot');
    expect(xs).toHaveLength(4);
    expect(xs[0]).toBe(52);
    expect(xs[3]).toBe(520 - 18);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 6);
    expect(xs[2]! - xs[1]!).toBeCloseTo(xs[3]! - xs[2]!, 6);
  });

  it('stands on the same pixels as a scatter on the same domain: one value, one x', () => {
    const line = cxOf(render(<VizLine data={run([1, 10, 100, 1000])} domain={LOG_X} width={520} height={340} />).container, 'circle.vzf-line-dot');
    cleanup();
    const scatter = cxOf(render(<VizScatter data={[1, 10, 100, 1000].map((x, i) => ({ id: `p${String(i)}`, x, y: i + 1 }))} domain={LOG_X} width={520} height={340} />).container, 'circle.vzf-dot');
    expect(scatter).toHaveLength(4);
    line.forEach((x, i) => expect(x).toBeCloseTo(scatter[i]!, 6));
  });

  it('does not draw a zero or a negative x, and says how many it left out, in the name and in the picture', () => {
    const { container } = render(<VizLine data={run([-5, 0, 1, 10, 100])} domain={{ transform: { x: 'log' } }} width={520} height={340} />);
    expect(cxOf(container, 'circle.vzf-line-dot')).toHaveLength(3);
    const said = '2 values are not drawn: a logarithmic axis has no place for zero or a negative number';
    expect(container.querySelector('svg.vzf-line')!.getAttribute('aria-label')).toContain(said);
    expect(container.querySelector('text.vzf-excluded-note')!.textContent).toBe(said);
    // the extent is folded from what was placed: the first drawn point is at the plot's left edge
    expect(cxOf(container, 'circle.vzf-line-dot')[0]).toBe(52);
  });

  it('counts a point neither axis can place once', () => {
    const data = [{ at: 0, value: 0 }, { at: 1, value: 1 }, { at: 10, value: 10 }];
    const { container } = render(<VizLine data={data} domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(container.querySelector('text.vzf-excluded-note')!.textContent).toMatch(/^1 value is not drawn/);
  });

  it('a drag reads back the logarithmic span under the pointer', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={run([1, 10, 100, 1000])} domain={LOG_X} width={520} height={340} dateField="mass" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-line')!;
    // jsdom has no layout, and the chart then reads client pixels 1:1 against its viewBox. The plot is
    // 450 px for three decades: 150 px a decade. Drag from 5 px before the 10 to 5 px after the 100.
    fireEvent.pointerDown(svg, { clientX: 52 + 150 - 5, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 52 + 300 + 5, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 52 + 300 + 5, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledTimes(1);
    const [lo, hi] = onEmit.mock.calls[0]![0].rawValue as [number, number];
    expect(lo).toBeCloseTo(10 ** (1 - 5 / 150), 6);
    expect(hi).toBeCloseTo(10 ** (2 + 5 / 150), 6);
    // on a linear axis the same pixels would have read about 324 and 683
    expect(lo).toBeLessThan(10);
    expect(hi).toBeGreaterThan(100);
  });
});

describe('a logarithm declared on an x that has none is ignored, as before', () => {
  const same = (data: Parameters<typeof VizLine>[0]['data'], extra: object = {}): void => {
    const plain = renderToStaticMarkup(<VizLine data={data} domain={{ ...extra }} />);
    const logged = renderToStaticMarkup(<VizLine data={data} domain={{ ...extra, transform: { x: 'log' } }} />);
    expect(logged).toBe(plain);
  };

  it('dates', () => {
    same([1, 2, 3].map((value, i) => ({ date: `2026-04-0${String(i + 1)}`, value })));
  });

  it('a band', () => {
    same(['Casual', 'Formal', 'Work'].map((category, i) => ({ category, value: i + 1 })), { categories: ['Casual', 'Formal', 'Work'] });
  });

  it('…and a run of numbers under a declared LINEAR x, or none, is the linear chart it was', () => {
    const data = run([1, 10, 100, 1000]);
    const none = renderToStaticMarkup(<VizLine data={data} domain={{ x: [1, 1000] }} />);
    expect(renderToStaticMarkup(<VizLine data={data} domain={{ x: [1, 1000], transform: { x: 'linear' } }} />)).toBe(none);
    const { container } = render(<VizLine data={data} domain={{ x: [1, 1000] }} width={520} />);
    const xs = cxOf(container, 'circle.vzf-line-dot');
    // linear: 10 is 9/999 of the way along, not a third
    expect(xs[1]! - xs[0]!).toBeCloseTo(((520 - 18 - 52) * 9) / 999, 6);
  });
});
