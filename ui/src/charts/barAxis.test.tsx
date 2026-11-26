// @vitest-environment jsdom
/**
 * THE BAR CHART'S COUNT AXIS (drawn when the bar is the first scale of a
 * two-scale frame, `axes="y"`): round ticks from zero, by the one axis part.
 *
 * | the bars                              | before                               | now                                   |
 * |---------------------------------------|--------------------------------------|---------------------------------------|
 * | tallest bar 130                       | 0 43.3 86.7 130                      | 0 50 100                              |
 * | tallest bar 7                         | 0 2.3 4.7 7                          | 0 2 4 6                               |
 * | tallest bar 1                         | 0 0.3 0.7 1                          | 0 0.5 1.0                             |
 * | tallest bar 1,234,567                 | 0 411522.3 823044.7 1234567, cut off | 0 0.5M 1.0M                           |
 * | a frame's ceiling of 20               | 0 6.7 13.3 20                        | 0 5 10 15 20                          |
 * | a 120 px high chart                   | four labels                          | as many round ones as a line of text allows |
 * | any bars with a ceiling that is a number | zero labelled, on the floor       | zero labelled, on the floor           |
 * | a ceiling that is not a number        | "NaN" four times                     | the axis line and no label            |
 * | a tick                                | placed by the bars' own scale        | placed by the bars' own scale         |
 * | `axes` true or false                  | no count axis                        | no count axis                         |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VizBar } from './VizBar.js';

afterEach(cleanup);

const draw = (counts: readonly number[], props: Partial<Parameters<typeof VizBar>[0]> = {}): HTMLElement =>
  render(<VizBar data={counts.map((count, i) => ({ category: `c${String(i)}`, count }))} field="category" axes="y" {...props} />).container;
const axisOf = (root: HTMLElement): Element | null => root.querySelector('[data-axis-orient="left"]');
const labels = (root: HTMLElement): string[] => [...axisOf(root)!.querySelectorAll('text.vzf-tick')].map((t) => t.textContent ?? '');
const places = (root: HTMLElement): number[] => [...axisOf(root)!.querySelectorAll(':scope > g > line')].map((l) => Number(l.getAttribute('y1')));

describe('the bar chart’s count axis', () => {
  it('is ticked at round values from zero', () => {
    expect(labels(draw([130, 40, 7]))).toEqual(['0', '50', '100']);
    cleanup();
    expect(labels(draw([7, 5]))).toEqual(['0', '2', '4', '6']);
    cleanup();
    expect(labels(draw([1]))).toEqual(['0', '0.5', '1.0']);
  });

  it('large counts are written against one unit, and fit the margin as written', () => {
    const root = draw([1_234_567, 400_000]);
    expect(labels(root)).toEqual(['0', '0.5M', '1.0M']);
    expect(axisOf(root)!.querySelector('text[textLength]')).toBeNull();
  });

  it('a frame’s ceiling is ticked at round values, the ceiling among them when it is one', () => {
    expect(labels(draw([9, 3], { domain: { y: [0, 20] } }))).toEqual(['0', '5', '10', '15', '20']);
  });

  it('a short chart keeps the round labels a line of text allows', () => {
    const root = draw([130, 40], { height: 120 });
    expect(labels(root)).toEqual(['0', '50', '100']);
    const ys = places(root);
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i]! - ys[i - 1]!)).toBeGreaterThanOrEqual(14);
    cleanup();
    // …and fewer when even those would touch
    const tiny = draw([130, 40], { height: 96 });
    expect(labels(tiny).length).toBeLessThan(3);
    expect(labels(tiny)[0]).toBe('0');
  });

  it('labels are thinned by a line of text, not by their width', () => {
    // a ceiling of 2.04 on a 96 px high chart: "0 1 2" are narrow and would fit by width, but stand
    // closer than a line of text
    expect(labels(draw([2.04], { height: 96 }))).toEqual(['0', '2']);
  });

  it('a label wider than the margin is squeezed into it', () => {
    // the margin is 38 px and a label is anchored 8 px from the axis: 30 px of room
    const root = draw([9], { domain: { y: [0, 3e15] } });
    const wide = [...axisOf(root)!.querySelectorAll('text.vzf-tick')].filter((t) => (t.textContent ?? '').length > 5);
    expect(wide.length).toBeGreaterThan(0);
    for (const t of wide) expect(t.getAttribute('textLength')).toBe('30');
  });

  it('a ceiling that is not a number draws the axis line and no label, where it used to write "NaN"', () => {
    const root = draw([Number.NaN]);
    expect(axisOf(root)!.querySelector(':scope > line.vzf-axis')).not.toBeNull();
    expect(labels(root)).toEqual([]);
  });

  it('zero is on the floor, and every tick is placed by the bars’ own scale', () => {
    const root = draw([130, 40, 7], { height: 340 });
    const line = axisOf(root)!.querySelector(':scope > line.vzf-axis')!;
    const [top, floor] = [Number(line.getAttribute('y1')), Number(line.getAttribute('y2'))];
    const ys = places(root);
    expect(ys[0]).toBe(floor);
    // the tallest bar (130) reaches the top of the axis, so a tick of 50 stands 50/130 of the way up, and 100 at 100/130
    expect(ys[1]).toBeCloseTo(floor - ((floor - top) * 50) / 130, 6);
    expect(ys[2]).toBeCloseTo(floor - ((floor - top) * 100) / 130, 6);
    const tallest = [...root.querySelectorAll('rect.vzf-barrect')].map((r) => Number(r.getAttribute('y'))).reduce((a, b) => Math.min(a, b));
    expect(tallest).toBeCloseTo(top, 6);
  });

  it('with no bars the axis is still drawn, from zero', () => {
    expect(labels(draw([]))[0]).toBe('0');
  });

  it('is drawn only as a frame’s first scale: `axes` true or false draws no count axis', () => {
    expect(axisOf(draw([130, 40], { axes: true }))).toBeNull();
    cleanup();
    expect(axisOf(draw([130, 40], { axes: false }))).toBeNull();
  });
});
