// @vitest-environment jsdom
/**
 * THE BOX PLOT'S VALUE AXIS: round ticks that fit, drawn by the one axis part.
 *
 * | the box plot                                  | before                                        | now                                             |
 * |-----------------------------------------------|-----------------------------------------------|-------------------------------------------------|
 * | values 2 … 99                                 | even cuts of the extent: 2 26.25 50.5 74.75 99| round values: 0 20 40 60 80 100                 |
 * | values 0.001 … 0.004                          | rounded to two decimals: "0" five times       | 0.001 0.002 0.003 0.004, each distinct          |
 * | values in the tens of millions                | eight-digit numbers, cut off at the left      | 52M 54M 56M 58M 60M, against one unit           |
 * | values 12345.001 … 12345.004                  | "12345" five times                            | each distinct, squeezed into the margin         |
 * | a chart too short for its ticks               | labels stacked                                | a coarser round step                            |
 * | a frame's domain 0 … 100                      | 0 25 50 75 100                                | round values inside it, 0 and 100 among them    |
 * | dates across weeks                            | five days, cut off at the left ("6-04-01")    | the same five days, squeezed into the margin    |
 * | dates within one day                          | the same day written five times               | the same (a date axis is a later job)           |
 * | flat, empty or negative data                  | drawn                                         | drawn, at least the ticks it had room for       |
 * | a tick that cannot be written, `axes={false}` | drawn                                         | drawn: ticks are worked out only when drawn     |
 * | `axes={false}`                                | no axis                                       | no axis                                         |
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(labels(draw([box(51_300_000, 59_400_000, 55_000_000)]))).toEqual(['52M', '54M', '56M', '58M', '60M']);
  });

  it('negative values and values around zero', () => {
    expect(labels(draw([box(-40, 40, 0)]))).toEqual(['-40', '-20', '0', '20', '40']);
    cleanup();
    expect(labels(draw([box(-99, -2, -50)]))).toEqual(['-100', '-80', '-60', '-40', '-20', '0']);
  });

  it('flat data and no data still draw an axis', () => {
    expect(labels(draw([box(7, 7, 7)])).length).toBeGreaterThanOrEqual(1);
    cleanup();
    expect(axisOf(draw([]))).not.toBeNull();
  });

  it('labels are thinned by a line of text, not by their width', () => {
    // 0 … 9 on a 120 px high chart: single digits are narrow, so judged by width 0 2 4 6 8 would
    // all fit; judged by a line of text only a coarser step does
    expect(labels(draw([box(0, 9, 5)], { width: 900, height: 120 }))).toEqual(['0', '5']);
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

  it('the axis line runs from the top margin to the bottom one, and every tick stands on it', () => {
    const root = draw([box(2, 99, 50)], { height: 340 });
    const line = axisOf(root).querySelector(':scope > line.vzf-axis')!;
    // the box plot keeps 16 px above the plot and 48 px below it
    expect([Number(line.getAttribute('x1')), Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))]).toEqual([48, 16, 292]);
    for (const mark of axisOf(root).querySelectorAll(':scope > g > line')) {
      const at = Number(mark.getAttribute('y1'));
      expect(at).toBeGreaterThanOrEqual(16);
      expect(at).toBeLessThanOrEqual(292);
    }
  });

  it('every label reads back as its tick’s value (200 generated box plots)', () => {
    let seed = 5;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const unit: Record<string, number> = { k: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    let checked = 0;
    for (let run = 0; run < 200; run++) {
      const span = 10 ** (next() * 10 - 3);
      const lo = (next() - 0.5) * span * 4;
      const hi = lo + span;
      const height = 120 + next() * 400;
      const root = draw([box(lo, hi, (lo + hi) / 2)], { height });
      // the scale, read off the drawing: the whisker ends are drawn at lo and hi
      const got = [...axisOf(root).querySelectorAll(':scope > g')].map((g) => ({ label: g.querySelector('text')!.textContent ?? '', y: Number(g.querySelector('line')!.getAttribute('y1')) }));
      expect(got.length, `${lo} … ${hi}`).toBeGreaterThanOrEqual(2);
      expect(new Set(got.map((t) => t.label)).size).toBe(got.length);
      const read = (label: string): number => (/[kMBT]$/.test(label) ? Number(label.slice(0, -1)) * unit[label.slice(-1)]! : Number(label));
      // equal steps in value are equal steps in pixels: the labels' differences are proportional to the marks'
      for (let i = 2; i < got.length; i++) {
        const ratio = (read(got[i]!.label) - read(got[i - 1]!.label)) / (read(got[i - 1]!.label) - read(got[i - 2]!.label));
        const pixels = (got[i]!.y - got[i - 1]!.y) / (got[i - 1]!.y - got[i - 2]!.y);
        expect(ratio, `${lo} … ${hi}: ${got.map((t) => t.label).join(' ')}`).toBeCloseTo(pixels, 6);
        checked += 1;
      }
      cleanup();
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('a frame’s domain is ticked at round values inside it, its ends among them', () => {
    expect(labels(draw([box(10, 60, 30)], { domain: { y: [0, 100] } }))).toEqual(['0', '20', '40', '60', '80', '100']);
  });
});

describe('the box plot’s value axis — dates', () => {
  it('dates across a month: four even steps, each read back as its day, squeezed into the margin', () => {
    const root = draw([box('2026-04-01', '2026-05-01', '2026-04-05')], { yField: 'date' });
    expect(labels(root)).toEqual(['2026-04-01', '2026-04-08', '2026-04-16', '2026-04-23', '2026-05-01']);
    // ten characters are 60 px in 40 px of room: they used to start outside the drawing and read "6-04-01"
    for (const t of axisOf(root).querySelectorAll('text.vzf-tick')) expect(t.getAttribute('textLength')).toBe('40');
    // …and the steps are even
    const ys = places(root);
    for (let i = 2; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeCloseTo(ys[i - 1]! - ys[i - 2]!, 6);
  });

  it('times within one day keep every tick: the axis is not thinned to one label, and its marks stay evenly spaced', () => {
    const root = draw([box('2026-04-01T02:00:00Z', '2026-04-01T20:00:00Z', '2026-04-01T09:00:00Z')], { yField: 'date' });
    expect(labels(root)).toEqual(['2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01']);
    const ys = places(root);
    for (let i = 2; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeCloseTo(ys[i - 1]! - ys[i - 2]!, 6);
  });

  it('a short chart thins the days by a line of text, keeping the first', () => {
    const root = draw([box('2026-04-01', '2026-05-01', '2026-04-05')], { yField: 'date', width: 900, height: 100 });
    const ys = places(root);
    expect(labels(root)[0]).toBe('2026-04-01');
    expect(ys.length).toBeGreaterThanOrEqual(2);
    expect(ys.length).toBeLessThan(5);
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

  it('…and works out no tick: a date axis whose ticks could not be written as days is still drawn', () => {
    // a frame's domain far past the last date a day can be written for
    const data = [box('2026-04-01', '2026-05-01', '2026-04-05')];
    expect(() => draw(data, { yField: 'date', axes: false, domain: { y: [0, 9e15] } })).not.toThrow();
    cleanup();
    // with its axis on, the same chart fails as it always did (React reports the failure; keep the log quiet)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => draw(data, { yField: 'date', domain: { y: [0, 9e15] } })).toThrow(RangeError);
    quiet.mockRestore();
  });
});
