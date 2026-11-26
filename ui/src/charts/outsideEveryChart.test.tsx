// @vitest-environment jsdom
/**
 * EVERY CHART SAYS WHAT STANDS OUTSIDE THE SPAN ITS AXIS WAS GIVEN.
 *
 * A chart handed a span draws on it. A mark past the span is drawn at its true
 * place, which is past the plot's edge, so only words can say it is there. The
 * scatter and the line's value axis said so; the others drew it in silence.
 *
 * | the chart, the axis   | given      | the data                    | before  | now, in the picture and in the accessible name                          |
 * |-----------------------|------------|-----------------------------|---------|--------------------------------------------------------------------------|
 * | bar, count            | 0…5        | counts 4, 9, 2              | silence | y has 1 bar outside its declared bounds [0, 5]                           |
 * | bar, count            | 3…5        | counts 4, 9, 2              | silence | …declared bounds [3, 5], drawn as [0, 5] because a count is read from zero |
 * | histogram, count      | 0…4        | counts 2, 0, 5, 3           | silence | y has 1 bin outside its declared bounds [0, 4]                           |
 * | histogram, bins       | 25…75      | bins 0…100 in four          | silence | x has 2 bins that reach outside the span this axis was given [25, 75]    |
 * | histogram, bins, days | two days   | three day-wide bins         | silence | the span is written as days                                              |
 * | box plot, values      | 0…90       | an outlier at 95, one at 99 | silence | y has 2 boxes that reach outside the span this axis was given [0, 90]    |
 * | heat map, columns     | 0…50       | columns 0…50, 50…100        | silence | x has 1 column that reaches outside the span this axis was given [0, 50] |
 * | line, x numbers       | 1…100      | positions 1, 10, 100, 1000  | silence | x has 1 position outside its declared bounds [1, 100]                    |
 * | line, x dates         | two days   | three days                  | silence | the bounds are written as days                                           |
 * | line on bands         | any        |                             | no span | nothing: a band has no span                                              |
 * | any, nothing outside  | wide       |                             | nothing | nothing                                                                  |
 * | any, no span given    | none       |                             | nothing | nothing                                                                  |
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { VizBar } from './VizBar.js';
import { VizHistogram } from './VizHistogram.js';
import { VizBoxPlot } from './VizBoxPlot.js';
import { VizHeatmap } from './VizHeatmap.js';
import { VizLine } from './VizLine.js';
import { outsideNotes, dayOfEpoch } from '../primitives/scales.js';

afterEach(cleanup);

const TAIL = ' — bounds say what the quantity CAN be, so either they are wrong or this data is';
/** The outside sentences in the picture, and the chart's accessible name. */
function said(container: HTMLElement): { notes: string[]; name: string } {
  return {
    notes: [...container.querySelectorAll('text.vzf-outside-note')].map((t) => t.textContent ?? ''),
    name: container.querySelector('svg.vzf-chart')?.getAttribute('aria-label') ?? '',
  };
}
/** One sentence, in the picture and at the end of the name. */
function expectSaid(container: HTMLElement, sentence: string): void {
  const { notes, name } = said(container);
  expect(notes).toEqual([sentence]);
  expect(name.endsWith(` — ${sentence}`)).toBe(true);
}
/** No sentence, and a name that does not mention one. */
function expectSilent(container: HTMLElement): void {
  const { notes, name } = said(container);
  expect(notes).toEqual([]);
  expect(name).not.toContain('outside');
}

const BARS = [
  { category: 'Casual', count: 4 },
  { category: 'Formal', count: 9 },
  { category: 'Party', count: 2 },
];
const BINS = [
  { x0: 0, x1: 25, count: 2 },
  { x0: 25, x1: 50, count: 0 },
  { x0: 50, x1: 75, count: 5 },
  { x0: 75, x1: 100, count: 3 },
];
const DAY_BINS = [
  { x0: '2026-04-01', x1: '2026-04-02', count: 2 },
  { x0: '2026-04-02', x1: '2026-04-03', count: 1 },
  { x0: '2026-04-03', x1: '2026-04-04', count: 3 },
];
const BOXES = [
  { category: 'Casual', q1: 20, median: 30, q3: 45, whiskerLo: 10, whiskerHi: 60, outliers: [95], count: 12 },
  { category: 'Formal', q1: 40, median: 55, q3: 70, whiskerLo: 25, whiskerHi: 90, outliers: [], count: 8 },
  { category: 'Party', q1: 15, median: 22, q3: 30, whiskerLo: 5, whiskerHi: 38, outliers: [2, 99], count: 10 },
];
const CELLS = [
  { x0: 0, x1: 50, y: 'Casual', count: 4 },
  { x0: 50, x1: 100, y: 'Casual', count: 0 },
  { x0: 0, x1: 50, y: 'Formal', count: 1 },
  { x0: 50, x1: 100, y: 'Formal', count: 9 },
];
const day = (iso: string): number => Date.parse(iso);

describe('a bar chart’s count axis', () => {
  it('says how many bars are taller than the ceiling it was given', () => {
    expectSaid(render(<VizBar data={BARS} field="category" domain={{ y: [0, 5] }} />).container, `y has 1 bar outside its declared bounds [0, 5]${TAIL}`);
  });
  it('names both pairs where the declared one does not start at zero: a count is drawn from zero', () => {
    expectSaid(render(<VizBar data={BARS} field="category" domain={{ y: [3, 5] }} />).container, `y has 1 bar outside its declared bounds [3, 5], drawn as [0, 5] because a count is read from zero${TAIL}`);
  });
  it('counts only above the ceiling: a bar shorter than a declared low end is inside a count’s span', () => {
    expectSilent(render(<VizBar data={BARS} field="category" domain={{ y: [3, 9] }} />).container);
  });
  it('is silent with nothing outside, and with no span given', () => {
    expectSilent(render(<VizBar data={BARS} field="category" domain={{ y: [0, 9] }} />).container);
    cleanup();
    expectSilent(render(<VizBar data={BARS} field="category" />).container);
  });
});

describe('a histogram', () => {
  it('says how many bins are taller than the ceiling', () => {
    expectSaid(render(<VizHistogram data={BINS} field="price" domain={{ y: [0, 4] }} />).container, `y has 1 bin outside its declared bounds [0, 4]${TAIL}`);
  });
  it('says how many bins reach outside the span of its bin axis, without calling the span declared', () => {
    expectSaid(render(<VizHistogram data={BINS} field="price" domain={{ x: [25, 75] }} />).container, 'x has 2 bins that reach outside the span this axis was given [25, 75]');
  });
  it('a bin that only overhangs one end is one that reaches outside', () => {
    expectSaid(render(<VizHistogram data={BINS} field="price" domain={{ x: [0, 90] }} />).container, 'x has 1 bin that reaches outside the span this axis was given [0, 90]');
  });
  it('writes a date span as days', () => {
    const domain = { x: [day('2026-04-02'), day('2026-04-04')] as const };
    expectSaid(render(<VizHistogram data={DAY_BINS} field="day" domain={domain} />).container, 'x has 1 bin that reaches outside the span this axis was given [2026-04-02, 2026-04-04]');
  });
  it('says both axes, x first, and is silent where the span holds every bin', () => {
    const both = said(render(<VizHistogram data={BINS} field="price" domain={{ x: [25, 75], y: [0, 4] }} />).container);
    expect(both.notes).toHaveLength(2);
    expect(both.notes[0]).toMatch(/^x has 2 bins/);
    expect(both.notes[1]).toMatch(/^y has 1 bin /);
    cleanup();
    expectSilent(render(<VizHistogram data={BINS} field="price" domain={{ x: [0, 100], y: [0, 5] }} />).container);
    cleanup();
    expectSilent(render(<VizHistogram data={BINS} field="price" />).container);
  });
});

describe('a box plot’s value axis', () => {
  it('says how many boxes have a whisker or an outlier past the span', () => {
    expectSaid(render(<VizBoxPlot viewId="b" data={BOXES} xField="category" yField="price" domain={{ y: [0, 90] }} />).container, 'y has 2 boxes that reach outside the span this axis was given [0, 90]');
  });
  it('is silent where the span holds every whisker and outlier, and with no span', () => {
    expectSilent(render(<VizBoxPlot viewId="b" data={BOXES} xField="category" yField="price" domain={{ y: [0, 100] }} />).container);
    cleanup();
    expectSilent(render(<VizBoxPlot viewId="b" data={BOXES} xField="category" yField="price" />).container);
  });
  it('writes a date span as days', () => {
    const dated = [{ category: 'A', q1: '2026-04-02', median: '2026-04-03', q3: '2026-04-04', whiskerLo: '2026-04-01', whiskerHi: '2026-04-06', outliers: [], count: 5 }];
    const domain = { y: [day('2026-04-02'), day('2026-04-06')] as const };
    expectSaid(render(<VizBoxPlot viewId="b" data={dated} xField="category" yField="when" domain={domain} />).container, 'y has 1 box that reaches outside the span this axis was given [2026-04-02, 2026-04-06]');
  });
});

describe('a heat map’s column axis', () => {
  it('says how many columns reach outside the span', () => {
    expectSaid(render(<VizHeatmap viewId="h" data={CELLS} xField="price" yField="category" domain={{ x: [0, 50] }} />).container, 'x has 1 column that reaches outside the span this axis was given [0, 50]');
  });
  it('is silent where the span holds every column, and with no span', () => {
    expectSilent(render(<VizHeatmap viewId="h" data={CELLS} xField="price" yField="category" domain={{ x: [0, 100] }} />).container);
    cleanup();
    expectSilent(render(<VizHeatmap viewId="h" data={CELLS} xField="price" yField="category" />).container);
  });
  it('writes a date span as days', () => {
    const dated = [
      { x0: '2026-04-01', x1: '2026-04-02', y: 'A', count: 1 },
      { x0: '2026-04-02', x1: '2026-04-03', y: 'A', count: 2 },
    ];
    const domain = { x: [day('2026-04-01'), day('2026-04-02')] as const };
    expectSaid(render(<VizHeatmap viewId="h" data={dated} xField="when" yField="k" domain={domain} />).container, 'x has 1 column that reaches outside the span this axis was given [2026-04-01, 2026-04-02]');
  });
});

describe('a line’s x axis', () => {
  const run = [1, 10, 100, 1000].map((at, i) => ({ at, value: i + 1 }));
  it('says how many positions stand outside the span of a run of numbers', () => {
    expectSaid(render(<VizLine data={run} domain={{ x: [1, 100] }} />).container, `x has 1 position outside its declared bounds [1, 100]${TAIL}`);
  });
  it('writes the bounds of a run of dates as days', () => {
    const days = ['2026-04-01', '2026-04-02', '2026-04-03'].map((date, i) => ({ date, value: i + 1 }));
    const domain = { x: [day('2026-04-01'), day('2026-04-02')] as const };
    expectSaid(render(<VizLine data={days} domain={domain} />).container, `x has 1 position outside its declared bounds [2026-04-01, 2026-04-02]${TAIL}`);
  });
  it('says x before y, and nothing on bands, inside the span, or with no span', () => {
    const both = said(render(<VizLine data={run} domain={{ x: [1, 100], y: [1, 2] }} />).container);
    expect(both.notes.map((note) => note.slice(0, 5))).toEqual(['x has', 'y has']);
    cleanup();
    const banded = [{ at: 'A', value: 1 }, { at: 'B', value: 2 }];
    expectSilent(render(<VizLine data={banded as never} domain={{ categories: ['A', 'B'], x: [0, 0.5] }} />).container);
    cleanup();
    expectSilent(render(<VizLine data={run} domain={{ x: [1, 1000] }} />).container);
    cleanup();
    expectSilent(render(<VizLine data={run} />).container);
  });
});

describe('outsideNotes: the one owner of the sentence', () => {
  it('a count axis is counted against zero up to the ceiling, and a ceiling below one is one', () => {
    expect(outsideNotes([{ channel: 'y', given: [0, 0.5], values: [1, 2], count: true }])).toEqual([`y has 1 value outside its declared bounds [0, 0.5], drawn as [0, 1] because a count is read from zero${TAIL}`]);
    expect(outsideNotes([{ channel: 'y', given: [0, 5], values: [-1, 5], count: true }])).toEqual([`y has 1 value outside its declared bounds [0, 5]${TAIL}`]);
  });
  it('a mark with width is counted once, whichever end reaches out, and an absent end is not a reach', () => {
    expect(outsideNotes([{ channel: 'x', given: [0, 10], values: [[-1, 11], [2, 3], [Number.NaN, 5], [9, 12]], noun: ['bin', 'bins'] }])).toEqual(['x has 2 bins that reach outside the span this axis was given [0, 10]']);
  });
  it('a mark with width on a logarithmic axis is counted against the span as it is drawn', () => {
    expect(outsideNotes([{ channel: 'x', given: [1, 100], values: [[0.5, 2], [10, 100]], kind: 'log', noun: ['bin', 'bins'] }])).toEqual(['x has 1 bin that reaches outside the span this axis was given [1, 100]']);
  });
  it('dayOfEpoch writes a day, and an epoch no date can hold as its number', () => {
    expect(dayOfEpoch(Date.parse('2026-04-01T13:00:00Z'))).toBe('2026-04-01');
    expect(dayOfEpoch(9e15)).toBe('9000000000000000');
    expect(dayOfEpoch(-9e15)).toBe('-9000000000000000');
  });
});
