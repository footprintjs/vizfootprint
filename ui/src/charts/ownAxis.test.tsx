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

describe('labels are shown whole and do not touch', () => {
  const tickTexts = (root: HTMLElement): SVGTextElement[] => [...root.querySelectorAll<SVGTextElement>('text.vzf-tick')];

  it('a y label wider than the margin is squeezed into it, every digit kept: it used to be cut off at the edge', () => {
    const { container } = render(<VizScatter data={points([[1, 12_345], [2, 12_345.001]])} width={420} height={300} />);
    const long = tickTexts(container).filter((t) => (t.textContent ?? '').startsWith('12345.'));
    expect(long.length).toBeGreaterThanOrEqual(2);
    for (const t of long) {
      expect(t.textContent).toMatch(/^12345\.\d{4}$/);
      expect(t.getAttribute('textLength')).toBe('44'); // the margin's 52 px, less the 8 px the label stands off the axis
      expect(t.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    }
  });

  it('a label that fits is drawn as written', () => {
    const { container } = render(<VizScatter data={points([[0, 0], [1000, 1000]])} width={420} height={300} />);
    for (const t of tickTexts(container)) expect(t.hasAttribute('textLength')).toBe(false);
  });

  it('long x labels on a narrow axis are thinned: first and last kept, none touching', () => {
    const { container } = render(<VizScatter data={points([[1_700_000_000_000, 1], [1_700_000_060_000, 2]])} width={420} height={300} />);
    const x = tickTexts(container).filter((t) => (t.textContent ?? '').startsWith('17'));
    const at = x.map((t) => Number(t.getAttribute('x')));
    expect(x.length).toBeGreaterThanOrEqual(2);
    expect(x.length).toBeLessThan(7);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(13 * 6 + 4);
    expect(x[0]!.textContent).toBe('1700000000000');
    expect(x.at(-1)!.textContent).toBe('1700000060000');
  });

  it('a line squeezes a long value label too, and a short chart thins its value ticks', () => {
    const data = [10_000_000, 10_000_010].map((value, i) => ({ date: `2026-04-0${i + 1}`, value }));
    const { container } = render(<VizLine data={data} width={520} />);
    const long = tickTexts(container).filter((t) => /^100000\d\d$/.test(t.textContent ?? ''));
    expect(long.length).toBeGreaterThan(0);
    for (const t of long) expect(t.getAttribute('textLength')).toBe('44');
    const short = render(<VizLine data={[2.4, 2.5].map((value, i) => ({ date: `2026-04-0${i + 1}`, value }))} width={520} height={110} />);
    const y = tickTexts(short.container).filter((t) => /^2\.\d\d$/.test(t.textContent ?? ''));
    const ys = y.map((t) => Number(t.getAttribute('y')));
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeGreaterThanOrEqual(14);
    expect(y[0]!.textContent).toBe('2.40');
    expect(y.at(-1)!.textContent).toBe('2.50');
  });
});

describe('labels on a narrow chart, the way the known libraries do it', () => {
  const xLabels = (root: HTMLElement): SVGTextElement[] => [...root.querySelectorAll<SVGTextElement>('text.vzf-tick[text-anchor="middle"]')];

  it('a narrow scatter takes a coarser round step, and zero keeps its label beside the zero line', () => {
    const { container } = render(<VizScatter data={points([[-0.5, -0.5], [0, 0], [0.5, 0.5]])} width={150} height={300} domain={{ zeroGuide: { x: true } }} />);
    const x = xLabels(container).map((t) => t.textContent);
    expect(x).toEqual(['-0.5', '0', '0.5']);
    expect(container.querySelector('line.vzf-zero')).not.toBeNull();
  });

  it('the last x label ends inside the drawing; its tick mark stays at the value', () => {
    const start = 1_700_000_000_000;
    const { container } = render(<VizScatter data={points([[start, 1], [start + 60_000, 2]])} width={420} height={300} domain={{ x: [start, start + 60_000], y: [0, 3] }} />);
    const labels = xLabels(container);
    expect(labels.length).toBeGreaterThan(1);
    for (const label of labels) {
      const centre = Number(label.getAttribute('x'));
      const half = ((label.textContent ?? '').length * 6) / 2;
      expect(centre - half).toBeGreaterThanOrEqual(0);
      expect(centre + half).toBeLessThanOrEqual(420);
    }
    // the last label was moved in: it is no longer centred on its tick mark
    const last = labels.at(-1)!;
    const mark = last.previousElementSibling!;
    expect(Number(mark.getAttribute('x1'))).toBeGreaterThan(Number(last.getAttribute('x')));
    expect(Number(mark.getAttribute('x1'))).toBe(420 - 18);
  });

  it('a logarithmic x axis keeps every decade that has room', () => {
    const { container } = render(<VizScatter data={points([[1, 1], [1e6, 2]])} width={420} height={300} domain={{ x: [1, 1e6], transform: { x: 'log' } }} />);
    const x = xLabels(container).map((t) => t.textContent);
    expect(x.length).toBeGreaterThan(2);
    expect(x[0]).toBe('1');
  });

  it('a short line chart takes a coarser step on its value axis', () => {
    const data = [0, 50, 100].map((value, i) => ({ date: `2026-04-0${i + 1}`, value }));
    const tall = ticksOf(render(<VizLine data={data} width={520} height={300} />).container).filter((t) => /^\d+$/.test(t));
    cleanup();
    const short = ticksOf(render(<VizLine data={data} width={520} height={110} />).container).filter((t) => /^\d+$/.test(t));
    expect(short.length).toBeLessThan(tall.length);
    expect(short).toContain('0');
  });
});

