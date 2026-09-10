// @vitest-environment jsdom
/**
 * THE LOGARITHMIC AXIS ON THE CHARTS (protocol 1.6) — one test per chart, plus
 * the two laws that hold across all of them, pinned once here rather than seven
 * times.
 *
 *   1. A DECADE IS A DECADE. Given a logarithmic domain the axis is ticked at
 *      powers of ten, and a mark at ten sits exactly one decade's worth of
 *      pixels from a mark at a hundred.
 *   2. WHAT CANNOT BE PLACED IS NOT DRAWN AND IS COUNTED. A zero or a negative
 *      value has no logarithm and therefore no position, so no mark is drawn
 *      for it — and the chart's own words (its accessible name, the sentence
 *      every chart already builds) carry the count.
 *
 * That every chart is byte-identical WITHOUT a transform is proved by its own
 * suite, which this change did not touch — plus the explicit checks below for
 * the three charts that read the key on NEITHER channel (`VizBar`,
 * `VizNetwork`) or on only one (`VizLine`'s date axis).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VizLine } from './VizLine.js';
import { VizBar } from './VizBar.js';
import { VizScatter } from './VizScatter.js';
import { VizHistogram, type HistogramBinDatum } from './VizHistogram.js';
import { VizBoxPlot, type BoxPlotDatum } from './VizBoxPlot.js';
import { VizHeatmap, type HeatmapCellDatum } from './VizHeatmap.js';
import { VizNetwork } from './VizNetwork.js';

afterEach(cleanup);

const ticksOf = (c: Element): (string | null)[] => Array.from(c.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
const nameOf = (c: Element): string => c.querySelector('svg')!.getAttribute('aria-label') ?? '';
/** Every mark's geometry, so a mark that was not drawn shows up as a missing entry. */
const marksOf = (c: Element, selector: string): string[] =>
  Array.from(c.querySelectorAll(selector)).map((el) => ['cx', 'cy', 'x', 'y', 'width', 'height'].map((a) => el.getAttribute(a) ?? '').join('/'));

describe('VizScatter — the canonical log-log figure', () => {
  const DECADES = [
    { id: 'a', x: 1, y: 1 },
    { id: 'b', x: 10, y: 10 },
    { id: 'c', x: 100, y: 100 },
  ];

  it('ticks the axis at decades and puts equal factors at equal pixel spans', () => {
    const { container } = render(<VizScatter data={DECADES} domain={{ x: [1, 100], y: [1, 100], transform: { x: 'log', y: 'log' } }} />);
    // the decades are labelled on both axes (4 x ticks + 4 y ticks would be the linear default;
    // here logTicks answers exactly the three powers of ten in [1, 100])
    expect(ticksOf(container)).toEqual(['1', '10', '100', '1', '10', '100']);
    const dots = Array.from(container.querySelectorAll('circle.vzf-dot')).map((d) => [Number(d.getAttribute('cx')), Number(d.getAttribute('cy'))] as const);
    // 1→10 and 10→100 are the same factor, so they are the same pixel span
    expect(dots[1]![0] - dots[0]![0]).toBeCloseTo(dots[2]![0] - dots[1]![0], 6);
    expect(dots[1]![1] - dots[0]![1]).toBeCloseTo(dots[2]![1] - dots[1]![1], 6);
  });

  it('does not draw a value the logarithm cannot place, and counts it in the chart’s own words', () => {
    const data = [...DECADES, { id: 'zero', x: 0, y: 5 }, { id: 'neg', x: 20, y: -3 }];
    const { container } = render(<VizScatter data={data} domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(container.querySelectorAll('circle.vzf-dot')).toHaveLength(3);
    expect(nameOf(container)).toContain('2 values are not drawn: a logarithmic axis has no place for zero or a negative number');
  });

  it('says the same count IN THE PICTURE, not only in the accessible name — a sighted reader meets it too', () => {
    const data = [...DECADES, { id: 'zero', x: 0, y: 5 }];
    const plain = render(<VizScatter data={DECADES} domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(plain.container.querySelector('text.vzf-excluded-note')).toBeNull();
    const { container } = render(<VizScatter data={data} domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(container.querySelector('text.vzf-excluded-note')?.textContent).toBe('1 value is not drawn: a logarithmic axis has no place for zero or a negative number');
  });

  it('with NO data placeable at all, ticks the placeholder decade [1, 10] rather than a phantom [0.1, 1]', () => {
    // a chart's own (undeclared) extent over an EMPTY `drawable` used to fall through `extent`'s plain
    // [0, 1] default, which `logDomain` then read as a real low bound to lift (clamp 2) instead of as
    // "nothing was placeable" (clamp 3) — `extentFor` is the fix; see its doc in `primitives/scales.ts`
    const data = [{ id: 'zero', x: 0, y: 0 }, { id: 'neg', x: -5, y: -9 }];
    const { container } = render(<VizScatter data={data} domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(ticksOf(container)).toEqual(['1', '10', '1', '10']);
    expect(container.querySelectorAll('circle.vzf-dot')).toHaveLength(0);
  });

  it('leaves the regression line out when the transform cannot place one of its ends', () => {
    const { container } = render(
      <VizScatter data={DECADES} regression={{ slope: 1, intercept: 0, domain: [0, 100] }} domain={{ transform: { x: 'log' } }} />,
    );
    expect(container.querySelectorAll('line.vzf-regline')).toHaveLength(0);
    // …and it IS drawn once both ends are placeable
    const ok = render(<VizScatter data={DECADES} regression={{ slope: 1, intercept: 0, domain: [1, 100] }} domain={{ transform: { x: 'log' } }} />);
    expect(ok.container.querySelectorAll('line.vzf-regline')).toHaveLength(1);
  });
});

describe('VizLine — a logarithmic VALUE axis, and a date axis that has no logarithm', () => {
  const POINTS = [
    { date: '2026-01-04', value: 10 },
    { date: '2026-01-11', value: 100 },
    { date: '2026-01-18', value: 1000 },
  ];

  it('ticks the value axis at decades and spaces equal factors equally', () => {
    const { container } = render(<VizLine data={POINTS} domain={{ y: [10, 1000], transform: { y: 'log' } }} />);
    expect(ticksOf(container)).toContain('100');
    const dots = Array.from(container.querySelectorAll('circle.vzf-line-dot')).map((d) => Number(d.getAttribute('cy')));
    expect(dots[1]! - dots[0]!).toBeCloseTo(dots[2]! - dots[1]!, 6);
  });

  it('drops a mean the logarithm cannot place and counts it', () => {
    const { container } = render(<VizLine data={[...POINTS, { date: '2026-01-25', value: 0 }]} domain={{ transform: { y: 'log' } }} />);
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(3);
    expect(nameOf(container)).toContain('1 value is not drawn');
    // …and IN THE PICTURE, not only the accessible name — a sighted reader meets it too
    expect(container.querySelector('text.vzf-excluded-note')?.textContent).toBe('1 value is not drawn: a logarithmic axis has no place for zero or a negative number');
  });

  it('with NO mean placeable at all, ticks the value axis at the placeholder decade [1, 10] (the date axis ticks as usual)', () => {
    const { container } = render(<VizLine data={[{ date: '2026-01-04', value: 0 }, { date: '2026-01-11', value: -5 }]} domain={{ transform: { y: 'log' } }} />);
    expect(ticksOf(container)).toEqual(['2026-01-04', '2026-01-11', '1', '10']);
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(0);
  });

  it('ignores `transform.x`: its x is a DATE, and a date has no logarithm', () => {
    const plain = render(<VizLine data={POINTS} />);
    const withLogX = render(<VizLine data={POINTS} domain={{ transform: { x: 'log' } }} />);
    expect(marksOf(withLogX.container, 'circle.vzf-line-dot')).toEqual(marksOf(plain.container, 'circle.vzf-line-dot'));
    expect(nameOf(withLogX.container)).toBe(nameOf(plain.container)); // nothing excluded, so no note
  });
});

describe('VizBoxPlot — no logarithmic axis at all: a box, like a bar, has its MAGNITUDE read as an extent', () => {
  const BOXES: BoxPlotDatum[] = [
    { category: 'Casual', q1: 20, median: 30, q3: 45, whiskerLo: 10, whiskerHi: 100, outliers: [], count: 12 },
    { category: 'Formal', q1: 200, median: 300, q3: 450, whiskerLo: 100, whiskerHi: 1000, outliers: [], count: 8 },
  ];

  it('ignores the key on BOTH channels — the same second fence VizBar keeps (law 11c refuses it at the door)', () => {
    const plain = render(<VizBoxPlot data={BOXES} />);
    const withLog = render(<VizBoxPlot data={BOXES} domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(marksOf(withLog.container, 'rect.vzf-box')).toEqual(marksOf(plain.container, 'rect.vzf-box'));
    expect(nameOf(withLog.container)).toBe(nameOf(plain.container));
  });

  it('draws a box whose statistics include zero or a negative number exactly as it always did — nothing is excluded', () => {
    const withZero: BoxPlotDatum[] = [...BOXES, { category: 'Odd', q1: -2, median: 0, q3: 1, whiskerLo: -5, whiskerHi: 3, outliers: [-9], count: 2 }];
    const plain = render(<VizBoxPlot data={withZero} />);
    const withLog = render(<VizBoxPlot data={withZero} domain={{ transform: { y: 'log' } }} />);
    expect(Array.from(withLog.container.querySelectorAll('text.vzf-box-catlabel')).map((t) => t.textContent)).toEqual(['Casual', 'Formal', 'Odd']);
    expect(marksOf(withLog.container, 'rect.vzf-box')).toEqual(marksOf(plain.container, 'rect.vzf-box'));
    expect(nameOf(withLog.container)).toBe(nameOf(plain.container));
  });
});

describe('VizHistogram — log-spaced bins are the legitimate case', () => {
  const BINS: HistogramBinDatum[] = [
    { x0: 1, x1: 10, count: 2 },
    { x0: 10, x1: 100, count: 5 },
    { x0: 100, x1: 1000, count: 3 },
  ];

  it('gives equal-width pixels to equal-factor bins', () => {
    const { container } = render(<VizHistogram data={BINS} domain={{ x: [1, 1000], transform: { x: 'log' } }} />);
    const widths = Array.from(container.querySelectorAll('rect.vzf-histbar')).map((r) => Number(r.getAttribute('width')));
    expect(widths).toHaveLength(3);
    expect(widths[0]!).toBeCloseTo(widths[1]!, 6);
    expect(widths[1]!).toBeCloseTo(widths[2]!, 6);
  });

  it('skips a bin whose edge the logarithm cannot place WHOLE (an edge is half a bin) and counts it', () => {
    const { container } = render(<VizHistogram data={[{ x0: 0, x1: 1, count: 7 }, ...BINS]} domain={{ transform: { x: 'log' } }} />);
    expect(container.querySelectorAll('rect.vzf-histbar')).toHaveLength(3);
    expect(nameOf(container)).toContain('1 value is not drawn');
    expect(container.querySelector('text.vzf-excluded-note')?.textContent).toBe('1 value is not drawn: a logarithmic axis has no place for zero or a negative number');
  });

  it('ignores `transform.y`: a count is read as a LENGTH from a baseline', () => {
    const plain = render(<VizHistogram data={BINS} />);
    const withLogY = render(<VizHistogram data={BINS} domain={{ transform: { y: 'log' } }} />);
    expect(marksOf(withLogY.container, 'rect.vzf-histbar')).toEqual(marksOf(plain.container, 'rect.vzf-histbar'));
  });

  it('with NO bins at all under a logarithmic axis, draws nothing rather than throwing on a phantom domain', () => {
    const { container } = render(<VizHistogram data={[]} domain={{ transform: { x: 'log' } }} />);
    expect(container.querySelectorAll('rect.vzf-histbar')).toHaveLength(0);
  });
});

describe('VizHeatmap — a logarithmic bucket axis', () => {
  const CELLS: HeatmapCellDatum[] = [
    { x0: 1, x1: 10, y: 'Casual', count: 4 },
    { x0: 10, x1: 100, y: 'Casual', count: 9 },
  ];

  it('gives equal-width pixels to equal-factor buckets', () => {
    const { container } = render(<VizHeatmap data={CELLS} domain={{ x: [1, 100], transform: { x: 'log' } }} />);
    const widths = Array.from(container.querySelectorAll('rect.vzf-heatcell')).map((r) => Number(r.getAttribute('width')));
    expect(widths).toHaveLength(2);
    expect(widths[0]!).toBeCloseTo(widths[1]!, 6);
  });

  it('drops a bucket the logarithm cannot place and counts the CELLS a reader is missing', () => {
    const withZero: HeatmapCellDatum[] = [
      { x0: 0, x1: 1, y: 'Casual', count: 1 },
      { x0: 0, x1: 1, y: 'Formal', count: 2 },
      ...CELLS,
    ];
    const { container } = render(<VizHeatmap data={withZero} domain={{ transform: { x: 'log' } }} />);
    // two rows survive as ROWS (a row is a category, not a position), and the [0, 1) bucket is gone
    expect(container.querySelectorAll('rect.vzf-heatcell')).toHaveLength(4); // 2 rows × 2 placeable buckets
    expect(nameOf(container)).toContain('2 values are not drawn');
    expect(container.querySelector('text.vzf-excluded-note')?.textContent).toContain('2 values are not drawn');
  });

  it('with NO buckets at all under a logarithmic axis, draws nothing rather than throwing on a phantom domain', () => {
    const { container } = render(<VizHeatmap data={[]} domain={{ transform: { x: 'log' } }} />);
    expect(container.querySelectorAll('rect.vzf-heatcell')).toHaveLength(0);
  });
});

describe('the two charts with no logarithmic axis at all', () => {
  it('VizBar ignores the key on BOTH channels — its x is a band, its y is a length from a baseline', () => {
    const BARS = [
      { category: 'Casual', count: 4 },
      { category: 'Formal', count: 900 },
    ];
    const plain = render(<VizBar data={BARS} field="category" />);
    const withLog = render(<VizBar data={BARS} field="category" domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(marksOf(withLog.container, 'rect.vzf-barrect')).toEqual(marksOf(plain.container, 'rect.vzf-barrect'));
    expect(nameOf(withLog.container)).toBe(nameOf(plain.container));
  });

  it('VizNetwork ignores the key — x and y are ONE spatial substrate, and a factor axis would turn a ring into a spiral', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 10 },
      { id: 'c', x: 100, y: 100 },
    ];
    const edges = [{ source: 'a', target: 'b', sx: 0, sy: 0, tx: 10, ty: 10 }];
    const plain = render(<VizNetwork nodes={nodes} edges={edges} keyField="id" />);
    const withLog = render(<VizNetwork nodes={nodes} edges={edges} keyField="id" domain={{ transform: { x: 'log', y: 'log' } }} />);
    expect(marksOf(withLog.container, 'circle.vzf-net-node')).toEqual(marksOf(plain.container, 'circle.vzf-net-node'));
    expect(nameOf(withLog.container)).toBe(nameOf(plain.container));
  });
});
