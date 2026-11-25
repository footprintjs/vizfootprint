// @vitest-environment jsdom
/**
 * A CHART'S OWN AXIS, as a person sees it: the two cases the request named,
 * through the real charts (the rule itself is in `../primitives/roundAxis.test.ts`).
 *
 * | the chart and its data                    | its tick labels                         | where the marks sit           |
 * |-------------------------------------------|-----------------------------------------|-------------------------------|
 * | scatter, points in −0.5 … 0.5             | −0.4 −0.2 0 0.2 0.4 on both axes        | across the plot, not a blob   |
 * | scatter, points in 0 … 1000               | 0 200 400 600 800 1000                  | across the plot               |
 * | scatter, large negative values            | −3.710M … −3.704M, each distinct        |                               |
 * | scatter under a declared domain           | round values inside the declared span   | the declared span, no room    |
 * | line, values 2.40 … 2.50                  | distinct labels to two decimals         |                               |
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VizScatter } from './VizScatter.js';
import { VizLine } from './VizLine.js';

afterEach(cleanup);

const ticksOf = (root: HTMLElement): string[] => [...root.querySelectorAll('text.vzf-tick')].map((t) => t.textContent ?? '');
const cxOf = (root: HTMLElement): number[] => [...root.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cx'))).filter((v) => Number.isFinite(v));
const points = (pairs: readonly (readonly [number, number])[]) => pairs.map(([x, y], i) => ({ id: `p${i}`, x, y }));

describe('a scatter sizes its own axis to its data', () => {
  it('points in −0.5 … 0.5 fill the plot, and the ticks read −0.4 −0.2 0 0.2 0.4', () => {
    const { container } = render(<VizScatter data={points([[-0.5, -0.5], [0, 0], [0.5, 0.5], [0.25, -0.25]])} width={500} height={300} />);
    expect(ticksOf(container)).toEqual(['-0.4', '-0.2', '0', '0.2', '0.4', '-0.4', '-0.2', '0', '0.2', '0.4']);
    // the outermost points stand near the two ends of the plot: they used to stand 45 px apart in its middle
    const xs = cxOf(container);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
  });

  it('points in 0 … 1000 still fill the plot, at round ticks', () => {
    const { container } = render(<VizScatter data={points([[0, 0], [500, 500], [1000, 1000]])} width={500} height={300} />);
    expect(ticksOf(container).slice(0, 6)).toEqual(['0', '200', '400', '600', '800', '1000']);
    const xs = cxOf(container);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
  });

  it('large values are written against one unit, each tick distinct', () => {
    const { container } = render(<VizScatter data={points([[-3_710_000, 1], [-3_704_000, 2]])} width={500} height={300} />);
    const x = ticksOf(container).filter((t) => t.endsWith('M'));
    expect(x).toEqual(['-3.710M', '-3.709M', '-3.708M', '-3.707M', '-3.706M', '-3.705M', '-3.704M']);
    expect(new Set(x).size).toBe(x.length);
  });

  it('a declared domain takes no room of the chart’s, and is ticked at round values inside it', () => {
    const { container } = render(<VizScatter data={points([[1, 1], [9, 9]])} width={500} height={300} domain={{ x: [0, 10], y: [0, 10] }} />);
    expect(ticksOf(container)).toEqual(['0', '2', '4', '6', '8', '10', '0', '2', '4', '6', '8', '10']);
  });
});

describe('a line sizes its value axis the same way', () => {
  it('values in 2.40 … 2.50: every label is distinct and written to the step', () => {
    const data = [2.4, 2.45, 2.5, 2.42].map((value, i) => ({ date: `2026-04-0${i + 1}`, value }));
    const { container } = render(<VizLine data={data} width={520} />);
    const y = ticksOf(container).filter((t) => /^2\.\d\d$/.test(t));
    expect(y).toEqual(['2.40', '2.42', '2.44', '2.46', '2.48', '2.50']);
    expect(new Set(y).size).toBe(y.length);
  });
});

describe('what the tighter axis must still say truthfully', () => {
  it('a zero guide it cannot draw names the axis it drew, not "[0, 0]"', () => {
    const { container } = render(<VizScatter data={points([[0.001, 1], [0.002, 2]])} width={500} height={300} domain={{ zeroGuide: { x: true } }} />);
    expect(container.textContent).toContain('its axis runs [0.00095, 0.00205]');
    expect(container.textContent).not.toContain('[0, 0]');
  });

  it('a narrow span far from zero: every x label is different', () => {
    const { container } = render(<VizScatter data={points([[1_700_000_000, 1], [1_700_000_010, 2]])} width={500} height={300} />);
    const x = ticksOf(container).filter((t) => t.startsWith('17'));
    expect(x.length).toBeGreaterThanOrEqual(2);
    expect(new Set(x).size).toBe(x.length);
  });

  it('very small values: the ticks stand inside the plot and none is called zero', () => {
    const { container } = render(<VizScatter data={points([[1e-14, 1e-14], [9e-14, 9e-14]])} width={500} height={300} />);
    expect(ticksOf(container)).not.toContain('0');
    const xs = [...container.querySelectorAll('text.vzf-tick')].map((t) => Number(t.getAttribute('x')));
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(500);
  });
});

