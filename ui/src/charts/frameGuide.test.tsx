// @vitest-environment jsdom
/**
 * THE FRAME'S OWN GUIDE — the one axis of a stack of layers — follows the rules
 * the charts' own axes follow, and is drawn by the one axis part.
 *
 * | the frame's span                         | before                               | now                                          |
 * |------------------------------------------|--------------------------------------|----------------------------------------------|
 * | 0 … 20                                   | 0 6.7 13.3 20                        | 0 5 10 15 20                                 |
 * | −0.55 … 0.55                             | -0.5 -0.2 0.2 0.6 (zero not labelled)| -0.4 -0.2 0 0.2 0.4                          |
 * | 51.3M … 59.4M                            | eight-digit numbers, cut off         | 52M 54M 56M 58M                              |
 * | 12345.001 … 12345.004 on y               | "12345" four times                   | each distinct, squeezed into the margin      |
 * | a long label on the last x tick          | ran past the right edge              | moved inside the drawing; its mark unmoved   |
 * | a 120 px high frame                      | four labels                          | a coarser round step                         |
 * | a 150 px wide frame                      | four labels                          | a coarser round step                         |
 * | dates across a month                     | four days                            | the same four days, the last moved inside    |
 * | dates on a 220 px frame                  | four days, overlapping               | the first and the last                       |
 * | a logarithmic axis on a narrow frame     | decades, overlapping                 | the decades that have room                   |
 * | a flat span                              | one value four times                 | that value once                              |
 * | bands                                    | one tick per band                    | the same                                     |
 * | a tick                                   | placed by the frame's scale          | placed by the frame's scale                  |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VizFrame, framePad, framePlotBox, type VizFrameProps } from './VizFrame.js';

afterEach(cleanup);

const layer = { layerId: 'a', kind: 'line' as const, render: (): JSX.Element => <svg /> };
const draw = (props: Partial<VizFrameProps>): HTMLElement => render(<VizFrame layers={[layer]} width={400} height={300} {...props} />).container;
const axis = (root: HTMLElement, orient: 'bottom' | 'left'): Element => root.querySelector(`.vzf-frame-guide [data-axis-orient="${orient}"]`)!;
const labels = (root: HTMLElement, orient: 'bottom' | 'left'): string[] => [...axis(root, orient).querySelectorAll('text.vzf-tick')].map((t) => t.textContent ?? '');
const marks = (root: HTMLElement, orient: 'bottom' | 'left'): number[] => [...axis(root, orient).querySelectorAll(':scope > g > line')].map((l) => Number(l.getAttribute(orient === 'bottom' ? 'x1' : 'y1')));
const q = { scale: 'quantitative' as const };
const t = { scale: 'temporal' as const };
const both = (x: readonly [number, number], y: readonly [number, number] = x): Partial<VizFrameProps> => ({ x: q, y: q, domain: { x, y } });

describe('the frame’s guide — numbers', () => {
  it('is ticked at round values on both axes', () => {
    const root = draw(both([0, 20]));
    expect(labels(root, 'bottom')).toEqual(['0', '5', '10', '15', '20']);
    expect(labels(root, 'left')).toEqual(['0', '5', '10', '15', '20']);
  });

  it('a signed span labels zero', () => {
    const root = draw(both([-0.55, 0.55]));
    expect(labels(root, 'bottom')).toEqual(['-0.4', '-0.2', '0', '0.2', '0.4']);
    expect(labels(root, 'left')).toEqual(['-0.4', '-0.2', '0', '0.2', '0.4']);
  });

  it('large values are written against one unit', () => {
    const root = draw(both([0, 1_234_567], [51.3e6, 59.4e6]));
    expect(labels(root, 'bottom')).toEqual(['0', '0.2M', '0.4M', '0.6M', '0.8M', '1.0M', '1.2M']);
    expect(labels(root, 'left')).toEqual(['52M', '54M', '56M', '58M']);
  });

  it('every tick is placed by the frame’s own scale: the same pixels the layers’ marks use', () => {
    const root = draw(both([0, 20]));
    const plot = framePlotBox(framePad(['line']), 400, 300);
    const xAt = (v: number): number => plot.left + ((plot.right - plot.left) * v) / 20;
    const yAt = (v: number): number => plot.bottom - ((plot.bottom - plot.top) * v) / 20;
    expect(marks(root, 'bottom')).toEqual([0, 5, 10, 15, 20].map(xAt));
    marks(root, 'left').forEach((at, i) => expect(at).toBeCloseTo(yAt(i * 5), 6));
  });

  it('a y label wider than the margin is squeezed into it, each tick distinct', () => {
    const root = draw(both([0, 1], [12345.001, 12345.004]));
    const texts = [...axis(root, 'left').querySelectorAll('text.vzf-tick')];
    expect(texts.map((x) => x.textContent)).toEqual(['12345.001', '12345.002', '12345.003', '12345.004']);
    // the line chart's margin is 52 px and a label is anchored 8 px from the axis
    for (const x of texts) expect(x.getAttribute('textLength')).toBe('44');
  });

  it('a long label on the last x tick is moved inside the drawing; its mark stays at the value', () => {
    const root = draw(both([1.7e12, 1.7e12 + 60_000], [0, 1]));
    const groups = [...axis(root, 'bottom').querySelectorAll(':scope > g')];
    const last = groups.at(-1)!;
    expect(last.querySelector('text')!.textContent).toBe('1700000060000');
    // 13 characters are 78 px: the label ends at the 400 px edge, and its mark is at the plot's right edge
    expect(Number(last.querySelector('text')!.getAttribute('x'))).toBe(400 - 39);
    expect(Number(last.querySelector('line')!.getAttribute('x1'))).toBe(framePlotBox(framePad(['line']), 400, 300).right);
    // …and no two labels touch
    const xs = groups.map((g) => Number(g.querySelector('text')!.getAttribute('x')));
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(78 + 4);
  });

  it('a short frame takes a coarser round step on y, by a line of text', () => {
    const root = draw({ ...both([0, 100]), height: 120 });
    expect(labels(root, 'left')).toEqual(['0', '50', '100']);
    expect(labels(root, 'bottom')).toEqual(['0', '20', '40', '60', '80', '100']);
  });

  it('a narrow frame takes a coarser round step on x, by label width', () => {
    const root = draw({ ...both([0, 100]), width: 150 });
    expect(labels(root, 'bottom')).toEqual(['0', '50', '100']);
    expect(labels(root, 'left')).toEqual(['0', '20', '40', '60', '80', '100']);
  });

  it('a flat span is one tick; a span that is not numbers is the axis line and no tick', () => {
    expect(labels(draw(both([5, 5])), 'bottom')).toEqual(['5']);
    cleanup();
    const root = draw({ x: q, y: q, domain: { x: [0, Number.NaN], y: [0, Infinity] } });
    expect(labels(root, 'bottom')).toEqual([]);
    expect(labels(root, 'left')).toEqual([]);
    expect(axis(root, 'bottom').querySelector(':scope > line.vzf-axis')).not.toBeNull();
  });
});

describe('the frame’s guide — dates, decades and bands', () => {
  const month: readonly [number, number] = [Date.parse('2026-04-01'), Date.parse('2026-05-01')];

  it('dates keep three even steps, each read back as its day; the last label is moved inside', () => {
    const root = draw({ x: t, y: q, domain: { x: month, y: [0, 10] } });
    expect(labels(root, 'bottom')).toEqual(['2026-04-01', '2026-04-11', '2026-04-21', '2026-05-01']);
    const at = marks(root, 'bottom');
    expect(at[1]! - at[0]!).toBeCloseTo(at[2]! - at[1]!, 6);
    const last = [...axis(root, 'bottom').querySelectorAll('text.vzf-tick')].at(-1)!;
    expect(Number(last.getAttribute('x'))).toBe(400 - 30);
  });

  it('on a narrow frame the days that would touch are dropped: the first and the last remain', () => {
    const root = draw({ x: t, y: q, domain: { x: month, y: [0, 10] }, width: 220 });
    expect(labels(root, 'bottom')).toEqual(['2026-04-01', '2026-05-01']);
  });

  it('a logarithmic axis shows the decades that have room', () => {
    const wide = draw({ x: q, y: q, domain: { x: [1, 1000], y: [1, 1000], transform: { x: 'log', y: 'log' } } });
    expect(labels(wide, 'bottom')).toEqual(['1', '10', '100', '1000']);
    expect(labels(wide, 'left')).toEqual(['1', '10', '100', '1000']);
    cleanup();
    const narrow = draw({ x: q, y: q, domain: { x: [1, 1e9], y: [1, 1000], transform: { x: 'log' } }, width: 110 });
    const got = labels(narrow, 'bottom');
    expect(got[0]).toBe('1');
    expect(got.length).toBeLessThan(4);
  });

  it('bands are one tick per band at its centre, level when the name fits and slanted with its whole name kept when it does not', () => {
    const short = draw({ x: { scale: 'categorical' }, domain: { categories: ['Casual', 'Formal', 'Sporty'] } });
    expect(labels(short, 'bottom')).toEqual(['Casual', 'Formal', 'Sporty']);
    expect(axis(short, 'bottom').querySelector('text[transform]')).toBeNull();
    cleanup();
    const names = Array.from({ length: 12 }, (_, i) => `A rather long category name number ${String(i)}`);
    const long = draw({ x: { scale: 'categorical' }, domain: { categories: names } });
    const texts = [...axis(long, 'bottom').querySelectorAll('text.vzf-tick')];
    expect(texts).toHaveLength(12);
    for (const [i, text] of texts.entries()) {
      expect(text.getAttribute('transform')).toMatch(/^rotate\(-40 /);
      expect(text.querySelector('title')!.textContent).toBe(names[i]);
    }
  });
});

describe('the frame’s guide — what did not move', () => {
  it('the zero guide is painted after both axes, and the axis titles after the ticks', () => {
    const root = draw({ x: { ...q, label: 'price' }, y: { ...q, label: 'rating' }, domain: { x: [-5, 5], y: [-5, 5], zeroGuide: { x: true, y: true } } });
    const guide = root.querySelector('.vzf-frame-guide')!;
    const order = [...guide.children].map((c) => c.getAttribute('data-axis-orient') ?? c.getAttribute('class'));
    expect(order).toEqual(['bottom', 'left', 'vzf-zero', 'vzf-zero', 'vzf-tick vzf-frame-axislabel', 'vzf-tick vzf-frame-axislabel']);
  });

  it('an axis the frame was not given is not drawn', () => {
    const root = draw({ x: q, domain: { x: [0, 20] } });
    expect(root.querySelector('.vzf-frame-guide [data-axis-orient="left"]')).toBeNull();
    expect(labels(root, 'bottom')).toEqual(['0', '5', '10', '15', '20']);
  });
});
