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
 * | a flat span (a constant column)          | one value four times, at the edge    | the span the layers draw on: value ± 1       |
 * | a span given backwards                   | mirrored against the marks           | in order, as the layers draw it              |
 * | a stack with bars, a column of zeroes    | "0" four times on the floor          | 0 0.2 … 1.0, zero on the floor under the bars|
 * | a flat date span                         | one day four times at the edge       | four places reading as two days              |
 * | bands                                    | one tick per band                    | the same                                     |
 * | a tick                                   | placed by the frame's scale          | placed by the frame's scale                  |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VizFrame, framePad, framePlotBox, type FrameChartKind, type VizFrameProps } from './VizFrame.js';
import { fitTick } from './tickFit.js';
import { bandWidth, bandCentre } from '../primitives/scales.js';

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

  it('a flat span is ticked on the span the layers draw on: one each side of the value, the value in the middle of the plot', () => {
    // a constant column folds to [5, 5]; every chart widens that to 4 … 6 (`domainOr`), and so does the guide
    const root = draw(both([5, 5]));
    expect(labels(root, 'bottom')).toEqual(['4.0', '4.5', '5.0', '5.5', '6.0']);
    const plot = framePlotBox(framePad(['line']), 400, 300);
    expect(marks(root, 'bottom')[2]).toBeCloseTo((plot.left + plot.right) / 2, 6);
    expect(marks(root, 'left')[2]).toBeCloseTo((plot.top + plot.bottom) / 2, 6);
  });

  it('a span given backwards is ticked in order, as the layers draw it', () => {
    const root = draw(both([20, 0]));
    expect(labels(root, 'bottom')).toEqual(['0', '5', '10', '15', '20']);
    const at = marks(root, 'bottom');
    expect(at[0]).toBeLessThan(at[4]!);
    const up = marks(root, 'left');
    expect(up[0]).toBeGreaterThan(up[4]!);
  });

  it('a span that is not numbers is the axis line and no tick', () => {
    const root = draw({ x: q, y: q, domain: { x: [0, Number.NaN], y: [0, Infinity] } });
    expect(labels(root, 'bottom')).toEqual([]);
    expect(labels(root, 'left')).toEqual([]);
    expect(axis(root, 'bottom').querySelector(':scope > line.vzf-axis')).not.toBeNull();
  });

  it('the axis lines run along the plot box’s floor and left edge, end to end', () => {
    const root = draw(both([0, 20]));
    const plot = framePlotBox(framePad(['line']), 400, 300);
    const num = (el: Element, name: string): number => Number(el.getAttribute(name));
    const x = axis(root, 'bottom').querySelector(':scope > line.vzf-axis')!;
    expect([num(x, 'x1'), num(x, 'y1'), num(x, 'x2'), num(x, 'y2')]).toEqual([plot.left, plot.bottom, plot.right, plot.bottom]);
    const y = axis(root, 'left').querySelector(':scope > line.vzf-axis')!;
    expect([num(y, 'x1'), num(y, 'y1'), num(y, 'x2'), num(y, 'y2')]).toEqual([plot.left, plot.top, plot.left, plot.bottom]);
  });

  it('y labels are thinned by a line of text, not by their width', () => {
    // 0 … 9 on a 120 px high frame: single digits are narrow, so by width 0 2 4 6 8 would fit
    expect(labels(draw({ ...both([0, 9]), height: 120 }), 'left')).toEqual(['0', '5']);
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

  it('days are judged where they are DRAWN: a last day moved in from the edge stands closer to its neighbour', () => {
    // at 262 px the four days fit when centred on their ticks, but the last is moved inside the drawing
    // and would then overlap the third. Judged where drawn, the walk from the first keeps three
    const root = draw({ x: t, y: q, domain: { x: month, y: [0, 10] }, width: 262 });
    expect(labels(root, 'bottom')).toEqual(['2026-04-01', '2026-04-11', '2026-04-21']);
    const xs = [...axis(root, 'bottom').querySelectorAll('text.vzf-tick')].map((el) => Number(el.getAttribute('x')));
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(60 + 4);
    cleanup();
    expect(labels(draw({ x: t, y: q, domain: { x: month, y: [0, 10] }, width: 300 }), 'bottom')).toHaveLength(4);
  });

  it('a flat date span is ticked on the span the layers draw on; its ticks are distinct places that read as the same days', () => {
    // one instant widened by a millisecond each side: four even steps, which a day label cannot tell
    // apart. Ticks at round hours and days are a date axis's job, which this is not yet.
    const day = Date.parse('2026-01-04');
    const root = draw({ x: t, y: q, domain: { x: [day, day], y: [0, 10] } });
    expect(labels(root, 'bottom')).toEqual(['2026-01-03', '2026-01-03', '2026-01-04', '2026-01-04']);
    const at = marks(root, 'bottom');
    const plot = framePlotBox(framePad(['line']), 400, 300);
    expect(new Set(at).size).toBe(4);
    // the instant itself is the middle of the plot, where the layers draw it
    expect((at[1]! + at[2]!) / 2).toBeCloseTo((plot.left + plot.right) / 2, 6);
  });

  it('a logarithmic axis shows the decades that have room', () => {
    const wide = draw({ x: q, y: q, domain: { x: [1, 1000], y: [1, 1000], transform: { x: 'log', y: 'log' } } });
    expect(labels(wide, 'bottom')).toEqual(['1', '10', '100', '1000']);
    expect(labels(wide, 'left')).toEqual(['1', '10', '100', '1000']);
    cleanup();
    const narrow = draw({ x: q, y: q, domain: { x: [1, 1e9], y: [1, 1000], transform: { x: 'log' } }, width: 110 });
    // four decades do not fit 40 px of plot: the first and the last are kept
    expect(labels(narrow, 'bottom')).toEqual(['1', '1e+9']);
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
    // the room a slanted label has runs from 12 px below the axis to the frame's floor: exactly what the
    // shared fitting rule gives for that room, and less with an x title under it
    const plot = framePlotBox(framePad(['line']), 400, 300);
    const band = bandWidth(plot.left, plot.right, names.length);
    const first = bandCentre(plot.left, band, 0);
    const shown = (root: HTMLElement): string => [...axis(root, 'bottom').querySelector('text.vzf-tick')!.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    expect(shown(long)).toBe(fitTick(names[0]!, band, 300 - plot.bottom - 12, first).text);
    cleanup();
    const titled = draw({ x: { scale: 'categorical', label: 'category' }, domain: { categories: names } });
    expect(shown(titled)).toBe(fitTick(names[0]!, band, 300 - plot.bottom - 12 - 24, first).text);
    expect(shown(titled).length).toBeLessThan(fitTick(names[0]!, band, 300 - plot.bottom - 12, first).text.length);
  });
});

describe('the frame’s guide — the span its layers draw on', () => {
  const stack = (kinds: readonly FrameChartKind[], props: Partial<VizFrameProps>): HTMLElement =>
    render(<VizFrame layers={kinds.map((kind, i) => ({ layerId: `l${String(i)}`, kind, render: (): JSX.Element => <svg /> }))} width={400} height={300} {...props} />).container;

  it('a stack that holds bars is read from zero: a column of zeroes reads 0 … 1 with zero on the floor, where the bars stand', () => {
    for (const kinds of [['bar'], ['histogram'], ['bar', 'line']] as const) {
      const root = stack(kinds, { y: q, domain: { y: [0, 0] } });
      expect(labels(root, 'left')).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1.0']);
      expect(marks(root, 'left')[0]).toBe(framePlotBox(framePad(kinds), 400, 300).bottom);
      cleanup();
    }
  });

  it('…and a ceiling below one is drawn to one, a floor above zero from zero, as the bars are', () => {
    expect(labels(stack(['bar'], { y: q, domain: { y: [0, 0.4] } }), 'left')).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1.0']);
    cleanup();
    expect(labels(stack(['bar'], { y: q, domain: { y: [5, 20] } }), 'left')).toEqual(['0', '5', '10', '15', '20']);
  });

  it('a stack with no count mark keeps the span it was given, a flat one widened each side', () => {
    expect(labels(stack(['line', 'point', 'boxplot'], { y: q, domain: { y: [0, 0] } }), 'left')).toEqual(['-1.0', '-0.5', '0', '0.5', '1.0']);
    cleanup();
    expect(labels(stack(['line'], { y: q, domain: { y: [5, 20] } }), 'left')).toEqual(['5', '10', '15', '20']);
  });

  it('the count rule is the y axis’s: a histogram’s x keeps the span it was given', () => {
    expect(labels(stack(['histogram'], { x: q, domain: { x: [5, 20] } }), 'bottom')).toEqual(['5', '10', '15', '20']);
  });

  it('the zero line stands on the zero tick, on a flat span too', () => {
    // a flat 0 … 0 span under a line: widened to −1 … 1, zero in the middle of the plot
    const root = stack(['line'], { x: q, y: q, domain: { x: [0, 10], y: [0, 0], zeroGuide: { y: true } } });
    const zeroLine = Number(root.querySelector('.vzf-frame-guide line.vzf-zero')!.getAttribute('y1'));
    const zeroTick = marks(root, 'left')[labels(root, 'left').indexOf('0')]!;
    const plot = framePlotBox(framePad(['line']), 400, 300);
    expect(zeroLine).toBeCloseTo(zeroTick, 6);
    expect(zeroLine).toBeCloseTo((plot.top + plot.bottom) / 2, 6);
    cleanup();
    // …and a backwards span: the line is still on the tick
    const back = stack(['line'], { x: q, y: q, domain: { x: [0, 10], y: [10, -10], zeroGuide: { y: true } } });
    expect(Number(back.querySelector('.vzf-frame-guide line.vzf-zero')!.getAttribute('y1'))).toBeCloseTo(marks(back, 'left')[labels(back, 'left').indexOf('0')]!, 6);
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
