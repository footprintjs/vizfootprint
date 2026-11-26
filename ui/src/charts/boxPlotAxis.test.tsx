// @vitest-environment jsdom
/**
 * THE BOX PLOT'S VALUE AXIS: round ticks that fit, drawn by the one axis part.
 *
 * | the box plot                                  | before                                        | now                                             |
 * |-----------------------------------------------|-----------------------------------------------|-------------------------------------------------|
 * | values 2 … 99                                 | even cuts of the extent: 2 26.25 50.5 74.75 99| round values: 0 20 40 60 80 100                 |
 * | values 0.001 … 0.004                          | rounded to two decimals: "0" five times       | 0.001 0.002 0.003 0.004, each distinct          |
 * | values in the tens of millions                | eight-digit numbers, cut off at the left      | 52M 54M …, against one unit                     |
 * | a label wider than the margin                 | cut off by the edge of the drawing            | squeezed into the margin, every character       |
 * | a chart too short for its ticks               | labels stacked                                | a coarser round step                            |
 * | a frame's domain 0 … 100                      | 0 25 50 75 100                                | round values inside it, 0 and 100 among them    |
 * | dates across weeks                            | five days                                     | the same five days                              |
 * | dates within one day                          | the same day written five times               | that day once                                   |
 * | `axes={false}`                                | no axis                                       | no axis                                         |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VizBoxPlot, type BoxPlotDatum } from './VizBoxPlot.js';

afterEach(cleanup);

const box = (lo: number | string, hi: number | string, mid: number | string, over: Partial<BoxPlotDatum> = {}): BoxPlotDatum =>
  ({ category: 'Casual', q1: mid, median: mid, q3: mid, whiskerLo: lo, whiskerHi: hi, outliers: [], count: 5, ...over }) as BoxPlotDatum;
const draw = (data: BoxPlotDatum[], props: Partial<Parameters<typeof VizBoxPlot>[0]> = {}): HTMLElement =>
  render(<VizBoxPlot data={data} xField="category" yField="price" {...props} />).container;
const axisOf = (root: HTMLElement): Element => root.querySelector('[data-axis-orient="left"]')!;
const labels = (root: HTMLElement): string[] => [...axisOf(root).querySelectorAll('text.vzf-tick')].map((t) => t.textContent ?? '');
const places = (root: HTMLElement): number[] => [...axisOf(root).querySelectorAll('text.vzf-tick')].map((t) => Number(t.getAttribute('y')));

describe('the box plot’s value axis — numbers', () => {
  it('is ticked at round values', () => {
    expect(labels(draw([box(2, 99, 50)]))).toEqual(['0', '20', '40', '60', '80', '100']);
  });

  it('small values are each written distinctly, to the step', () => {
    const got = labels(draw([box(0.001, 0.004, 0.002)]));
    expect(got).toEqual(['0.001', '0.002', '0.003', '0.004']);
    expect(new Set(got).size).toBe(got.length);
  });

  it('large values are written against one unit', () => {
    const got = labels(draw([box(51_300_000, 59_400_000, 55_000_000)]));
    expect(got.every((t) => /^\d+M$/.test(t))).toBe(true);
    expect(new Set(got).size).toBe(got.length);
    expect(got.length).toBeGreaterThan(2);
  });

  it('a label wider than the margin is squeezed into it, every character kept', () => {
    const root = draw([box(12345.001, 12345.004, 12345.002)]);
    const wide = [...axisOf(root).querySelectorAll('text.vzf-tick')];
    expect(wide.length).toBeGreaterThan(1);
    // the margin is 48 px and a label is anchored 8 px from the axis: 40 px of room for ten characters
    for (const t of wide) {
      expect(t.textContent).toMatch(/^12345\.\d{3}$/);
      expect(t.getAttribute('textLength')).toBe('40');
    }
  });

  it('a short chart takes a coarser round step, and no two labels stand closer than a line of text', () => {
    const tall = labels(draw([box(2, 99, 50)], { height: 340 }));
    cleanup();
    const root = draw([box(2, 99, 50)], { height: 110 });
    const short = labels(root);
    expect(short.length).toBeLessThan(tall.length);
    expect(short.length).toBeGreaterThanOrEqual(2);
    const ys = places(root);
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeGreaterThanOrEqual(14);
  });

  it('every tick stands inside the span the axis drew', () => {
    const root = draw([box(2, 99, 50)]);
    const line = axisOf(root).querySelector(':scope > line.vzf-axis')!;
    const [top, bottom] = [Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))];
    for (const mark of axisOf(root).querySelectorAll(':scope > g > line')) {
      const at = Number(mark.getAttribute('y1'));
      expect(at).toBeGreaterThanOrEqual(top);
      expect(at).toBeLessThanOrEqual(bottom);
    }
  });

  it('a frame’s domain is ticked at round values inside it, its ends among them', () => {
    expect(labels(draw([box(10, 60, 30)], { domain: { y: [0, 100] } }))).toEqual(['0', '20', '40', '60', '80', '100']);
  });
});

describe('the box plot’s value axis — dates', () => {
  it('dates across weeks read back as days', () => {
    const got = labels(draw([box('2026-04-01', '2026-05-01', '2026-04-05')], { yField: 'date' }));
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t))).toBe(true);
    expect(got[0]).toBe('2026-04-01');
    expect(got.at(-1)).toBe('2026-05-01');
    expect(new Set(got).size).toBe(got.length);
  });

  it('times within one day are that day, written once', () => {
    const got = labels(draw([box('2026-04-01T02:00:00Z', '2026-04-01T20:00:00Z', '2026-04-01T09:00:00Z')], { yField: 'date' }));
    expect(got).toEqual(['2026-04-01']);
  });

  it('a short chart thins the days so they do not touch', () => {
    const root = draw([box('2026-04-01', '2026-05-01', '2026-04-05')], { yField: 'date', height: 100 });
    const ys = places(root);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeGreaterThanOrEqual(14);
  });
});

describe('the box plot’s value axis — when it is not this chart’s to draw', () => {
  it('`axes={false}` draws no axis part, no tick and no axis line', () => {
    const root = draw([box(2, 99, 50)], { axes: false });
    expect(root.querySelector('.vzf-axis-part')).toBeNull();
    expect(root.querySelectorAll('line.vzf-axis')).toHaveLength(0);
    expect(root.querySelectorAll('text.vzf-tick')).toHaveLength(0);
  });
});
