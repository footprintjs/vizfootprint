// @vitest-environment jsdom
/**
 * A CHART'S SCALES ARE SWAPPABLE — one test per 2D chart: GIVEN a domain the
 * axis shows it, and `axes={false}` draws no guide at all. That every chart is
 * byte-identical WITHOUT the props is proved by its own suite, which this
 * change did not touch — the props are absent there, and absent is the default.
 *
 * Three laws that hold across all of them, each pinned once here rather than
 * six times: a value OUTSIDE the domain is drawn at its true position (a domain
 * says what the axis means, and a row past it is a data fact, not an overflow);
 * a domain that is not two finite numbers is not a domain, on the count axes
 * too; and `axes={false}` takes the guide away and leaves the MARGIN BOX, so
 * two charts stacked on one frame still line up.
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
import { bandOrder, domainOr } from '../primitives/scales.js';

afterEach(cleanup);

/** Every tick label a chart drew, in document order. */
const ticksOf = (container: Element): (string | null)[] => Array.from(container.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
/** Everything a chart drew as a GUIDE: axis lines, ticks, axis labels. */
const guideOf = (container: Element): number => container.querySelectorAll('.vzf-axis, text.vzf-tick, .vzf-axis-group, text.vzf-box-catlabel, text.vzf-heat-row').length;
/** Where every MARK landed — the geometry, so a moved margin box shows up as a moved mark. (A guide's own rects are not marks: `AxisLabel` draws two.) */
const marksOf = (container: Element): string =>
  Array.from(container.querySelectorAll('rect, circle, path'))
    .filter((el) => !el.classList.contains('vzf-axis') && el.closest('.vzf-axis-group') === null)
    .map((el) => ['x', 'y', 'width', 'height', 'cx', 'cy', 'd'].map((a) => el.getAttribute(a) ?? '').join('/'))
    .join(' ');

const LINE = [
  { date: '2026-01-04', value: 40 },
  { date: '2026-01-11', value: 60 },
];
const BARS = [
  { category: 'Casual', count: 4 },
  { category: 'Formal', count: 9 },
];
const POINTS = [
  { id: 'a', x: 10, y: 20 },
  { id: 'b', x: 30, y: 40 },
];
const BINS: HistogramBinDatum[] = [
  { x0: 0, x1: 25, count: 2 },
  { x0: 25, x1: 50, count: 5 },
];
const BOXES: BoxPlotDatum[] = [{ category: 'Casual', q1: 20, median: 30, q3: 45, whiskerLo: 10, whiskerHi: 60, outliers: [], count: 12 }];
const CELLS: HeatmapCellDatum[] = [
  { x0: 0, x1: 50, y: 'Casual', count: 4 },
  { x0: 50, x1: 100, y: 'Casual', count: 9 },
];

describe('domainOr — the two guards a linear scale needs', () => {
  it('the frame’s domain wins; a flat one is widened; one that is not two finite numbers is not a domain', () => {
    expect(domainOr([0, 100], [7, 8])).toEqual([0, 100]);
    expect(domainOr(undefined, [7, 8])).toEqual([7, 8]);
    // a scale divides by the span, so a flat domain is widened exactly as `extent` widens flat data
    expect(domainOr([5, 5], [7, 8])).toEqual([4, 6]);
    // reversed comes back in order — an axis is a span, not a direction
    expect(domainOr([100, 0], [7, 8])).toEqual([0, 100]);
    expect(domainOr([Number.NaN, 3], [7, 8])).toEqual([7, 8]);
    expect(domainOr([0, Number.POSITIVE_INFINITY], [7, 8])).toEqual([7, 8]);
  });
});

describe('bandOrder — the frame’s slots, and what a chart does with one it has no row for', () => {
  it('the frame’s list decides the order; a category outside it is APPENDED, never hidden; with no list the chart keeps its own', () => {
    expect(bandOrder(['b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
    expect(bandOrder(['b'], ['a', 'b'])).toEqual(['b', 'a']); // "a" is a data fact, not an overflow
    expect(bandOrder(undefined, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('VizBar: a band with no row of its own is EMPTY — no bar, no value, no highlight, and never a zero', () => {
    const { container } = render(
      <VizBar data={BARS} field="category" domain={{ categories: ['Casual', 'Sporty', 'Formal'] }} highlight={[{ category: 'Casual', count: 2 }]} />,
    );
    // three slots, two bars: "Sporty" is a silence, and a zero-height bar with a tooltip saying 0 would be a claim
    expect(container.querySelectorAll('text.vzf-tick')).toHaveLength(3);
    expect(Array.from(container.querySelectorAll('rect.vzf-barrect')).map((r) => r.getAttribute('aria-label'))).toEqual(['select Casual (4)', 'select Formal (9)']);
    expect(container.querySelectorAll('rect.vzf-barhl')).toHaveLength(2); // one per BAR — the empty slot has no share either
    // …and the slots are in the frame's order: Formal is third, not second
    const ticks = Array.from(container.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
    expect(ticks).toEqual(['Casual', 'Sporty', 'Formal']);
  });

  it('VizBar: no ticks, no tick room — with axes={false} the slant never takes plot height from the frame', () => {
    const long = [
      { category: 'Extraordinarily Long Shelf Name One', count: 4 },
      { category: 'Extraordinarily Long Shelf Name Two', count: 9 },
    ];
    const slanted = render(<VizBar data={long} field="category" width={240} />).container;
    // with its own guide the labels slant and the plot gives up room for them
    expect(Array.from(slanted.querySelectorAll('text.vzf-tick')).some((t) => t.getAttribute('transform') !== null)).toBe(true);
    const withGuide = Number(slanted.querySelector('rect.vzf-barrect')?.getAttribute('height'));
    cleanup();
    const bare = render(<VizBar data={long} field="category" width={240} axes={false} />).container;
    const withoutGuide = Number(bare.querySelector('rect.vzf-barrect')?.getAttribute('height'));
    // no guide is drawn, so no room is kept for one: the bar is TALLER, on the frame's own box
    expect(withoutGuide).toBeGreaterThan(withGuide);
  });
});

describe('given a domain, the axis shows it', () => {
  it('VizLine: the y ticks span the frame’s domain, not the data’s own extent', () => {
    const own = render(<VizLine data={LINE} />).container;
    expect(ticksOf(own)).not.toContain('100');
    cleanup();
    // y in the value column's own units; x in epoch ms (this chart positions dates on a linear scale)
    const framed = render(<VizLine data={LINE} domain={{ y: [0, 100] }} />).container;
    expect(ticksOf(framed)).toContain('100');
    expect(ticksOf(framed)).toContain('0');
  });

  it('VizBar: the frame’s ceiling shortens every bar, and the baseline stays at zero', () => {
    const own = render(<VizBar data={BARS} field="category" />).container;
    const tallest = (c: Element): number => Math.max(...Array.from(c.querySelectorAll('rect.vzf-barrect')).map((r) => Number(r.getAttribute('height'))));
    const before = tallest(own);
    cleanup();
    // the tallest bar is 9 of a ceiling of 90, so it draws a tenth of the plot it filled on its own scale
    const framed = render(<VizBar data={BARS} field="category" domain={{ y: [0, 90] }} />).container;
    expect(tallest(framed)).toBeCloseTo(before / 10, 5);
    const bottoms = Array.from(framed.querySelectorAll('rect.vzf-barrect')).map((r) => Number(r.getAttribute('y')) + Number(r.getAttribute('height')));
    expect(new Set(bottoms.map((b) => Math.round(b)))).toHaveLength(1); // one baseline for every bar
  });

  it('VizScatter: the ticks span the frame’s domain on both axes', () => {
    const framed = render(<VizScatter data={POINTS} domain={{ x: [0, 200], y: [0, 100] }} />).container;
    expect(ticksOf(framed)).toContain('200');
    expect(ticksOf(framed)).toContain('100');
  });

  it('VizHistogram: the frame’s x widens the value axis, so a bin sits where the frame says', () => {
    const own = render(<VizHistogram data={BINS} field="price" />).container;
    const firstWidth = (c: Element): number => Number(c.querySelector('rect.vzf-histbar')!.getAttribute('width'));
    const before = firstWidth(own);
    cleanup();
    // the same two buckets on an axis twice as wide in DATA units draw half as wide in pixels
    const framed = render(<VizHistogram data={BINS} field="price" domain={{ x: [0, 100] }} />).container;
    expect(firstWidth(framed)).toBeLessThan(before);
  });

  it('VizBoxPlot: the y ticks span the frame’s domain', () => {
    const framed = render(<VizBoxPlot data={BOXES} xField="category" yField="price" domain={{ y: [0, 100] }} />).container;
    expect(ticksOf(framed)).toContain('100');
    expect(ticksOf(framed)).toContain('0');
  });

  it('VizHeatmap: the frame’s x moves every cell, because the bucket axis is the frame’s', () => {
    const own = render(<VizHeatmap data={CELLS} xField="price" yField="category" />).container;
    const firstCell = (c: Element): number => Number(c.querySelector('rect.vzf-heatcell')!.getAttribute('width'));
    const before = firstCell(own);
    cleanup();
    const framed = render(<VizHeatmap data={CELLS} xField="price" yField="category" domain={{ x: [0, 200] }} />).container;
    expect(firstCell(framed)).toBeLessThan(before);
  });

  it('VizNetwork: the substrate is the frame’s span, and it stays ONE px-per-unit for both axes', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 10 },
    ];
    const own = render(<VizNetwork nodes={nodes} edges={[]} keyField="id" />).container;
    const at = (c: Element, id: string): { cx: number; cy: number } => {
      const circle = Array.from(c.querySelectorAll('circle')).find((el) => el.getAttribute('aria-label')?.includes(id) || el.querySelector('title')?.textContent?.includes(id));
      return { cx: Number(circle?.getAttribute('cx')), cy: Number(circle?.getAttribute('cy')) };
    };
    const ownSpan = Math.abs(at(own, 'b').cx - at(own, 'a').cx);
    cleanup();
    // the same two nodes on a substrate ten times as wide in layout units sit ten times closer in pixels
    const framed = render(<VizNetwork nodes={nodes} edges={[]} keyField="id" domain={{ x: [0, 100], y: [0, 100] }} />).container;
    const framedSpan = Math.abs(at(framed, 'b').cx - at(framed, 'a').cx);
    expect(framedSpan).toBeLessThan(ownSpan);
    // one unit for both axes: equal layout distances are equal pixel distances, whichever way they run
    expect(framedSpan).toBeCloseTo(Math.abs(at(framed, 'b').cy - at(framed, 'a').cy), 5);
  });
});

describe('a value outside the domain is DRAWN, at its true position — one law for every chart', () => {
  it('VizScatter: a point past the frame’s domain is drawn past the axis’s end, and it is still drawn', () => {
    const framed = render(<VizScatter data={POINTS} domain={{ x: [0, 5], y: [0, 5] }} />).container;
    const axisEnd = Number(framed.querySelector('line.vzf-axis')!.getAttribute('x2'));
    const cxs = Array.from(framed.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')));
    // both points are still there — a domain says what the axis MEANS, it drops no row and clamps nothing
    expect(cxs).toHaveLength(2);
    expect(Math.max(...cxs)).toBeGreaterThan(axisEnd);
  });

  it('VizBar: a count past the frame’s ceiling draws a bar taller than the plot, above its top edge', () => {
    const framed = render(<VizBar data={BARS} field="category" domain={{ y: [0, 1] }} />).container;
    const bars = Array.from(framed.querySelectorAll('rect.vzf-barrect'));
    expect(bars).toHaveLength(2);
    // the tallest bar's top is off the plot: the reader SEES that this layer runs past what the frame was folded over
    expect(Math.min(...bars.map((b) => Number(b.getAttribute('y'))))).toBeLessThan(0);
  });
});

describe('a domain that is not two finite numbers is not a domain — on every axis, the count ones included', () => {
  it('VizBar and VizHistogram keep their own ceiling rather than scaling by NaN', () => {
    const nan = render(<VizBar data={BARS} field="category" domain={{ y: [0, Number.NaN] }} />).container;
    const heights = Array.from(nan.querySelectorAll('rect.vzf-barrect')).map((r) => Number(r.getAttribute('height')));
    expect(heights.every((h) => Number.isFinite(h) && h > 0)).toBe(true);
    cleanup();
    // …and the same bars as with no domain at all, because that is what "not a domain" means
    const own = render(<VizBar data={BARS} field="category" />).container;
    expect(Array.from(own.querySelectorAll('rect.vzf-barrect')).map((r) => r.getAttribute('height'))).toEqual(heights.map(String));
    cleanup();
    const inf = render(<VizHistogram data={BINS} field="price" domain={{ y: [0, Number.POSITIVE_INFINITY] }} />).container;
    const bins = Array.from(inf.querySelectorAll('rect.vzf-histbar')).map((r) => Number(r.getAttribute('height')));
    expect(bins.every((h) => Number.isFinite(h) && h > 0)).toBe(true);
  });
});

describe('axes={false} — the frame draws one guide for the whole stack', () => {
  it('every 2D chart draws NO axis line, tick or axis label, and still draws its marks', () => {
    const cases: readonly (readonly [string, JSX.Element, JSX.Element])[] = [
      ['line', <VizLine data={LINE} />, <VizLine data={LINE} axes={false} />],
      ['bar', <VizBar data={BARS} field="category" />, <VizBar data={BARS} field="category" axes={false} />],
      ['scatter', <VizScatter data={POINTS} />, <VizScatter data={POINTS} axes={false} />],
      ['histogram', <VizHistogram data={BINS} field="price" />, <VizHistogram data={BINS} field="price" axes={false} />],
      ['boxplot', <VizBoxPlot data={BOXES} xField="category" yField="price" />, <VizBoxPlot data={BOXES} xField="category" yField="price" axes={false} />],
      ['heatmap', <VizHeatmap data={CELLS} xField="price" yField="category" />, <VizHeatmap data={CELLS} xField="price" yField="category" axes={false} />],
    ];
    for (const [name, own, bare] of cases) {
      const withGuide = render(own).container;
      expect(guideOf(withGuide), `${name} draws a guide by default`).toBeGreaterThan(0);
      const placed = marksOf(withGuide);
      cleanup();
      const withoutGuide = render(bare).container;
      expect(guideOf(withoutGuide), `${name} draws no guide under axes={false}`).toBe(0);
      // the marks are still there — a chart without a guide is not a chart without data
      expect(withoutGuide.querySelectorAll('rect, circle, path').length, `${name} still draws its marks`).toBeGreaterThan(0);
      // …and they are in the SAME PLACE: the guide goes, the margin box stays, so a stack of layers
      // drawn one over another still lines up (that alignment is the whole point of one merged guide)
      expect(marksOf(withoutGuide), `${name} keeps its margin box under axes={false}`).toBe(placed);
      cleanup();
    }
  });
});
