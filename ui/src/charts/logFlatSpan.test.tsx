// @vitest-environment jsdom
/**
 * ONE VALUE ON A LOGARITHMIC AXIS stands in the middle of a decade either side.
 *
 * Found in review: a single distinct value was widened by plus and minus one
 * (a linear idea) before the logarithmic clamp saw it, so a value below about
 * 0.11 was drawn far outside the plot, and nothing said so.
 *
 * | the chart, one value on a log axis          | before                               | now                                    |
 * |---------------------------------------------|--------------------------------------|----------------------------------------|
 * | a line, x = 0.001                           | the point at cx = −848, off the chart| mid-plot; the axis runs 0.0001 … 0.01  |
 * | a scatter, x = y = 0.001                    | off the chart on both axes           | mid-plot on both                       |
 * | a line, one mean of 0.001 on a log y        | below the chart                      | mid-plot                               |
 * | one value of 5 (above 1/9)                  | inside the plot, off-centre          | mid-plot; the axis runs 0.5 … 50       |
 * | a frame whose folded x is 0.05 … 0.05       | the guide ticks 0.2 0.5 1; 0.05 off  | 0.01 and 0.1; 0.05 is mid-plot         |
 * | a declared flat domain on a log axis        | widened by one each side             | a decade each side                     |
 * | two or more distinct values                 | their own extent                     | the same                               |
 * | a flat span on a LINEAR axis                | one each side                        | the same                               |
 * | one value at or below zero on a log axis    | the placeholder decade, counted      | the same                               |
 * | a drag over that one value on a scatter     | (the point was off the chart)        | the span covered, as it is             |
 * | a drag on a narrow log axis (1000 … 1001)   | the span covered, to three decimals  | the span covered, as it is             |
 * | a value near the smallest or largest number | drawn                                | drawn: the decade is kept representable|
 * | a value outside a declared flat log domain  | counted against value ± 1            | counted against the decade drawn       |
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { VizLine } from './VizLine.js';
import { VizScatter } from './VizScatter.js';
import { VizHistogram } from './VizHistogram.js';
import { VizHeatmap } from './VizHeatmap.js';
import { VizFrame, framePad, framePlotBox } from './VizFrame.js';
import { domainOr, extentFor, logDomain, logTicks, outsideNotes, roundToAxis } from '../primitives/scales.js';

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

const num = (el: Element, name: string): number => Number(el.getAttribute(name));
const LOG = (channels: 'x' | 'y' | 'xy') => ({ transform: { ...(channels.includes('x') ? { x: 'log' as const } : {}), ...(channels.includes('y') ? { y: 'log' as const } : {}) } });

describe('the rules', () => {
  it('a flat pair on a logarithmic kind is handed on flat, for the logarithm’s own rule to widen by a decade', () => {
    expect(domainOr([0.001, 0.001], [0, 1], 'log')).toEqual([0.001, 0.001]);
    expect(logDomain(...domainOr([0.001, 0.001], [0, 1], 'log'))).toEqual([0.0001, 0.01]);
    expect(extentFor([{ v: 0.001 }], (r) => r.v, 0, 'log')).toEqual([0.001, 0.001]);
    expect(extentFor([{ v: 5 }, { v: 5 }], (r) => r.v, 0, 'log')).toEqual([5, 5]);
  });

  it('on a linear kind, or none, a flat pair is still widened by one each side', () => {
    expect(domainOr([5, 5], [0, 1])).toEqual([4, 6]);
    expect(domainOr([5, 5], [0, 1], 'linear')).toEqual([4, 6]);
    expect(extentFor([{ v: 5 }], (r) => r.v, 0, undefined)).toEqual([4, 6]);
    expect(extentFor([{ v: 5 }], (r) => r.v, 0, 'linear')).toEqual([4, 6]);
  });

  it('a pair that is not flat, backwards, or not numbers is treated as before, whatever the kind', () => {
    expect(domainOr([1000, 1], [0, 1], 'log')).toEqual([1, 1000]);
    expect(domainOr([1, Number.NaN], [2, 3], 'log')).toEqual([2, 3]);
    expect(domainOr(undefined, [2, 3], 'log')).toEqual([2, 3]);
    expect(extentFor([{ v: 3 }, { v: 30 }], (r) => r.v, 0, 'log')).toEqual([3, 30]);
    expect(extentFor([{ v: Number.NaN }], (r) => r.v, 0, 'log')).toEqual([0, 0]);
  });
});

describe('the rules at the ends of what a number can hold, and for a pointer', () => {
  it('a decade either side stays inside the numbers: never zero below, never infinity above', () => {
    expect(logDomain(5e-324, 5e-324)).toEqual([5e-324, 5e-323]);
    expect(logDomain(0, 2e-323)[0]).toBeGreaterThan(0);
    const [lo, hi] = logDomain(Number.MAX_VALUE, Number.MAX_VALUE);
    expect(lo).toBe(Number.MAX_VALUE / 10);
    expect(hi).toBe(Number.MAX_VALUE);
    expect(logDomain(1, Infinity)).toEqual([1, Number.MAX_VALUE]);
    // an end that is not finite is the largest number, on the way in: never a pair that runs backwards
    for (const pair of [[-1, Infinity], [0, Infinity], [Infinity, Infinity]] as const) {
      expect(logDomain(pair[0], pair[1])).toEqual([Number.MAX_VALUE / 10, Number.MAX_VALUE]);
    }
    expect(logDomain(Number.NaN, 5)).toEqual([1, 10]);
  });

  it('a span with no finite end has no decade ticks, and asking for them ends', () => {
    expect(logTicks(1, Infinity)).toEqual([]);
    expect(logTicks(Number.MAX_VALUE / 10, Number.MAX_VALUE).length).toBeGreaterThan(0);
  });

  it('a pointer’s value on a logarithmic axis is rounded to significant digits: four, or as many as tell one pixel from the next', () => {
    // with nothing said about the pixel: four, whatever the value's size
    expect(roundToAxis(0.000735642, 0, 'log')).toBe(0.0007356);
    expect(roundToAxis(3.67821, 0, 'log')).toBe(3.678);
    expect(roundToAxis(123456789, 0, 'log')).toBe(123500000);
    expect(roundToAxis(Number.NaN, 0, 'log')).toBeNaN();
    expect(roundToAxis(0, 0, 'log', 0.001)).toBe(0);
    // a pixel worth 0.0022 at 1000.455: six digits tell it from the next, and two more are kept
    expect(roundToAxis(1000.4554321, 0, 'log', 0.0022)).toBe(1000.4554);
    // a coarse pixel never takes it below four, a pixel that is no size at all is ignored, and a number's own fifteen digits are the ceiling
    expect(roundToAxis(123456.789, 0, 'log', 5000)).toBe(123500);
    expect(roundToAxis(123456.789, 0, 'log', 1e9)).toBe(123500);
    expect(roundToAxis(123456.789, 0, 'log', Number.NaN)).toBe(123500);
    expect(roundToAxis(123456.789, 0, 'log', -1)).toBe(123500);
    // a pixel worth nothing a number can hold (an axis narrower than a number resolves) keeps every digit
    expect(roundToAxis(1000.0000000001234, 0, 'log', 0)).toBe(1000.00000000012);
    expect(roundToAxis(1.2345678901234567, 0, 'log', 1e-30)).toBe(1.23456789012346);
    // …and a linear axis keeps its rule: a flat span is a hundredth
    expect(roundToAxis(0.000735642, 0)).toBe(0);
    expect(roundToAxis(0.000735642, 0, 'linear')).toBe(0);
  });

  it('a value is outside a declared flat logarithmic pair when it is outside the decade drawn', () => {
    const ask = { channel: 'x', given: [0.05, 0.05] as const, values: [0.05, 0.4, 0.8] };
    // the words "declared bounds" are followed by what was DECLARED, then by how it is drawn
    expect(outsideNotes([{ ...ask, kind: 'log' }])).toEqual([
      'x has 1 value outside its declared bounds [0.05, 0.05], drawn as [0.005, 0.5] on a logarithmic axis — bounds say what the quantity CAN be, so either they are wrong or this data is',
    ]);
    // a pair a logarithm can take as it is: no second pair to name
    expect(outsideNotes([{ channel: 'x', given: [1, 100], values: [5, 500], kind: 'log' }])).toEqual(['x has 1 value outside its declared bounds [1, 100] — bounds say what the quantity CAN be, so either they are wrong or this data is']);
    // a low bound a logarithm cannot take is lifted to a decade below the high one, and said so
    expect(outsideNotes([{ channel: 'x', given: [-1, 100], values: [5, 50], kind: 'log' }])).toEqual([
      'x has 1 value outside its declared bounds [-1, 100], drawn as [10, 100] on a logarithmic axis — bounds say what the quantity CAN be, so either they are wrong or this data is',
    ]);
    // on a linear axis the same pair is one either side, so nothing is outside
    expect(outsideNotes([ask])).toEqual([]);
    expect(outsideNotes([{ ...ask, kind: 'linear' }])).toEqual([]);
  });
});

describe('one value on a logarithmic axis, in the charts', () => {
  it('a line over numbers: the point stands mid-plot, where it used to be off the chart', () => {
    const { container } = render(<VizLine data={[{ at: 0.001, value: 1 }]} domain={LOG('x')} width={520} height={340} />);
    const dot = container.querySelector('circle.vzf-line-dot')!;
    expect(num(dot, 'cx')).toBeCloseTo((52 + 520 - 18) / 2, 6);
  });

  it('a line with one mean on a logarithmic y: mid-plot', () => {
    const { container } = render(<VizLine data={[{ date: '2026-04-01', value: 0.001 }]} domain={LOG('y')} width={520} height={340} />);
    const dot = container.querySelector('circle.vzf-line-dot')!;
    const line = container.querySelector('[data-axis-orient="left"] > line.vzf-axis')!;
    expect(num(dot, 'cy')).toBeCloseTo((num(line, 'y1') + num(line, 'y2')) / 2, 6);
  });

  it('a scatter: mid-plot on both axes, and its ticks are the decades either side', () => {
    const { container } = render(<VizScatter data={[{ id: 'a', x: 0.001, y: 0.001 }]} domain={LOG('xy')} width={520} height={340} />);
    const dot = container.querySelector('circle.vzf-dot')!;
    expect(num(dot, 'cx')).toBeCloseTo((52 + 520 - 18) / 2, 6);
    expect(num(dot, 'cy')).toBeCloseTo((18 + 340 - 44) / 2, 6);
    const x = [...container.querySelectorAll('[data-axis-orient="bottom"] text.vzf-tick')].map((t) => t.textContent);
    expect(x[0]).toBe('1e-4');
    expect(x.at(-1)).toBe('0.01');
    expect(x).toContain('0.001');
  });

  it('a value above one is centred too: the axis is a decade either side of it', () => {
    const { container } = render(<VizScatter data={[{ id: 'a', x: 5, y: 5 }]} domain={LOG('xy')} width={520} height={340} />);
    expect(num(container.querySelector('circle.vzf-dot')!, 'cx')).toBeCloseTo((52 + 520 - 18) / 2, 6);
  });

  it('a declared flat domain is a decade either side as well, and line and scatter agree', () => {
    const domain = { x: [0.05, 0.05] as const, ...LOG('x') };
    const line = num(render(<VizLine data={[{ at: 0.05, value: 1 }]} domain={domain} width={520} />).container.querySelector('circle.vzf-line-dot')!, 'cx');
    cleanup();
    const scatter = num(render(<VizScatter data={[{ id: 'a', x: 0.05, y: 1 }]} domain={domain} width={520} />).container.querySelector('circle.vzf-dot')!, 'cx');
    expect(line).toBeCloseTo(scatter, 6);
    expect(line).toBeCloseTo((52 + 520 - 18) / 2, 6);
  });

  it('a declared flat domain on y, on the scatter and on the line', () => {
    const domain = { y: [0.05, 0.05] as const, ...LOG('y') };
    const scatter = render(<VizScatter data={[{ id: 'a', x: 1, y: 0.05 }]} domain={domain} width={520} height={340} />).container;
    expect(num(scatter.querySelector('circle.vzf-dot')!, 'cy')).toBeCloseTo((18 + 340 - 44) / 2, 6);
    cleanup();
    const line = render(<VizLine data={[{ date: '2026-04-01', value: 0.05 }]} domain={domain} width={520} height={340} />).container;
    const axis = line.querySelector('[data-axis-orient="left"] > line.vzf-axis')!;
    expect(num(line.querySelector('circle.vzf-line-dot')!, 'cy')).toBeCloseTo((num(axis, 'y1') + num(axis, 'y2')) / 2, 6);
  });

  it('a histogram and a heat map under a declared flat logarithmic x: a bucket around the value is centred on the plot', () => {
    const domain = { x: [0.05, 0.05] as const, ...LOG('x') };
    // a bucket from half the value to twice it is centred on it, on a logarithmic axis
    const hist = render(<VizHistogram data={[{ x0: 0.025, x1: 0.1, count: 3 }]} field="mass" domain={domain} width={420} />).container;
    const bar = hist.querySelector('rect.vzf-histbar')!;
    expect(num(bar, 'x') + num(bar, 'width') / 2).toBeCloseTo((30 + 420 - 30) / 2, 0);
    cleanup();
    const heat = render(<VizHeatmap data={[{ x0: 0.025, x1: 0.1, y: 'Casual', count: 3 }]} xField="mass" yField="category" domain={domain} width={420} />).container;
    const cell = heat.querySelector('rect.vzf-heatcell')!;
    expect(num(cell, 'x') + num(cell, 'width') / 2).toBeCloseTo((74 + 420 - 16) / 2, 0);
  });

  it('a drag over the one value on a scatter reads back the span it covered, not [0, 0]', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={[{ id: 'a', x: 0.001, y: 0.001 }]} domain={LOG('xy')} width={520} height={340} xField="mass" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    // the plot is 450 px for two decades, 0.0001 … 0.01: 30 px either side of the dot at 277
    fireEvent.pointerDown(svg, { clientX: 247, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 307, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 307, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledTimes(1);
    const [lo, hi] = onEmit.mock.calls[0]![0].rawValue as [number, number];
    // the value under each end of the drag, as it is (a scatter records it unrounded, as the line does)
    expect(lo).toBeCloseTo(0.001 * 10 ** (-30 / 225), 12);
    expect(hi).toBeCloseTo(0.001 * 10 ** (30 / 225), 12);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0.001);
    expect(hi).toBeGreaterThan(0.001);
  });

  it('a drag on a NARROW logarithmic axis records what the pointer covered, not the whole axis', () => {
    // 1000, 1000.5 and 1001 across 450 px: rounded to four digits it read 1000 and 1001, the whole axis
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={[1000, 1000.5, 1001].map((x, i) => ({ id: `p${String(i)}`, x, y: i }))} domain={LOG('x')} width={520} xField="mass" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    const dots = [...container.querySelectorAll('circle.vzf-dot')].map((c) => num(c, 'cx'));
    // 20 px either side of the middle point only
    fireEvent.pointerDown(svg, { clientX: dots[1]! - 20, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: dots[1]! + 20, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: dots[1]! + 20, pointerId: 1 });
    const [lo, hi] = onEmit.mock.calls[0]![0].rawValue as [number, number];
    expect(lo).toBeGreaterThan(1000);
    expect(lo).toBeLessThan(1000.5);
    expect(hi).toBeGreaterThan(1000.5);
    expect(hi).toBeLessThan(1001);
    // within a twentieth of a pixel of where the pointer was: one pixel here is worth about 0.0022
    const at = (px: number): number => 1000 * (1001 / 1000) ** ((px - 52) / 450);
    expect(Math.abs(lo - at(dots[1]! - 20))).toBeLessThan(0.0022 / 20);
    expect(Math.abs(hi - at(dots[1]! + 20))).toBeLessThan(0.0022 / 20);
  });

  it('a value outside a declared flat logarithmic pair is said in the chart: scatter x, scatter y, line y', () => {
    const said = (root: HTMLElement, selector: string): string => root.querySelector(selector)!.getAttribute('aria-label') ?? '';
    const x = render(<VizScatter data={[{ id: 'a', x: 0.05, y: 1 }, { id: 'b', x: 0.8, y: 2 }]} domain={{ declared: { x: true, y: true }, x: [0.05, 0.05], ...LOG('x') }} />).container;
    expect(said(x, 'svg.vzf-scatter')).toContain('x has 1 value outside its declared bounds [0.05, 0.05], drawn as [0.005, 0.5] on a logarithmic axis');
    cleanup();
    const y = render(<VizScatter data={[{ id: 'a', x: 1, y: 0.05 }, { id: 'b', x: 2, y: 0.8 }]} domain={{ declared: { x: true, y: true }, y: [0.05, 0.05], ...LOG('y') }} />).container;
    expect(said(y, 'svg.vzf-scatter')).toContain('y has 1 value outside its declared bounds [0.05, 0.05], drawn as [0.005, 0.5] on a logarithmic axis');
    cleanup();
    const line = render(<VizLine data={[{ date: '2026-04-01', value: 0.05 }, { date: '2026-04-02', value: 0.8 }]} domain={{ declared: { x: true, y: true }, y: [0.05, 0.05], ...LOG('y') }} />).container;
    expect(said(line, 'svg.vzf-line')).toContain('y has 1 value outside its declared bounds [0.05, 0.05], drawn as [0.005, 0.5] on a logarithmic axis');
    cleanup();
    // on a linear axis the same pair is one either side, and 0.8 is inside it: nothing is said
    const linear = render(<VizScatter data={[{ id: 'a', x: 0.05, y: 1 }, { id: 'b', x: 0.8, y: 2 }]} domain={{ declared: { x: true, y: true }, x: [0.05, 0.05] }} />).container;
    expect(said(linear, 'svg.vzf-scatter')).not.toContain('outside');
  });

  it('a value near the smallest or the largest number a chart can hold is still drawn', () => {
    for (const v of [5e-324, 2.5e-323, 1e-300, 1e300, Number.MAX_VALUE]) {
      const scatter = render(<VizScatter data={[{ id: 'a', x: v, y: 1 }]} domain={LOG('x')} width={520} />).container;
      const cx = num(scatter.querySelector('circle.vzf-dot')!, 'cx');
      expect(cx, String(v)).toBeGreaterThanOrEqual(52);
      expect(cx, String(v)).toBeLessThanOrEqual(502);
      cleanup();
      expect(() => render(<VizLine data={[{ at: v, value: 1 }]} domain={LOG('x')} />), String(v)).not.toThrow();
      cleanup();
    }
  });

  it('a frame’s guide is drawn over the same decade either side, so the value is mid-plot there too', () => {
    const layer = { layerId: 'a', kind: 'line' as const, render: (): JSX.Element => <svg /> };
    const { container } = render(<VizFrame layers={[layer]} x={{ scale: 'quantitative' }} domain={{ x: [0.05, 0.05], ...LOG('x') }} width={400} height={300} />);
    const plot = framePlotBox(framePad(['line']), 400, 300);
    const ticks = [...container.querySelectorAll('.vzf-frame-guide [data-axis-orient="bottom"] > g')].map((g) => ({ label: g.querySelector('text')!.textContent, at: num(g.querySelector('line')!, 'x1') }));
    // the axis runs 0.005 … 0.5, a decade either side of 0.05, which is therefore the middle of the plot.
    // Its decades are 0.01 and 0.1, each where that axis puts it (it used to tick 0.2 0.5 1, with 0.05
    // off the plot)
    expect(ticks.map((t) => t.label)).toEqual(['0.01', '0.1']);
    const on = (v: number): number => plot.left + ((plot.right - plot.left) * Math.log10(v / 0.005)) / 2;
    expect(ticks[0]!.at).toBeCloseTo(on(0.01), 6);
    expect(ticks[1]!.at).toBeCloseTo(on(0.1), 6);
  });
});

describe('what did not move', () => {
  it('two distinct values keep their own extent, edge to edge', () => {
    const { container } = render(<VizLine data={[{ at: 1, value: 1 }, { at: 1000, value: 2 }]} domain={LOG('x')} width={520} />);
    const xs = [...container.querySelectorAll('circle.vzf-line-dot')].map((c) => num(c, 'cx'));
    expect(xs).toEqual([52, 502]);
  });

  it('one value on a LINEAR axis is still one each side', () => {
    const { container } = render(<VizScatter data={[{ id: 'a', x: 5, y: 5 }]} domain={{ x: [5, 5] }} width={520} />);
    const x = [...container.querySelectorAll('[data-axis-orient="bottom"] text.vzf-tick')].map((t) => t.textContent);
    expect(x).toEqual(['4.0', '4.5', '5.0', '5.5', '6.0']);
  });

  it('one value at zero on a logarithmic axis is not drawn, is counted, and the axis is the placeholder decade', () => {
    const { container } = render(<VizScatter data={[{ id: 'a', x: 0, y: 1 }]} domain={LOG('x')} width={520} />);
    expect(container.querySelectorAll('circle.vzf-dot')).toHaveLength(0);
    expect(container.querySelector('text.vzf-excluded-note')!.textContent).toMatch(/^1 value is not drawn/);
    const x = [...container.querySelectorAll('[data-axis-orient="bottom"] text.vzf-tick')].map((t) => t.textContent);
    expect(x[0]).toBe('1');
    expect(x.at(-1)).toBe('10');
  });
});
