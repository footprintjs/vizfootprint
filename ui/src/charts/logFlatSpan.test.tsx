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
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VizLine } from './VizLine.js';
import { VizScatter } from './VizScatter.js';
import { VizFrame, framePad, framePlotBox } from './VizFrame.js';
import { domainOr, extentFor, logDomain } from '../primitives/scales.js';

afterEach(cleanup);

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
    expect(on(0.05)).toBeCloseTo((plot.left + plot.right) / 2, 6);
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
