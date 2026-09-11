// @vitest-environment jsdom
/**
 * VizLine — behavioral suite: aggregation (mean per date per series), time
 * brush → snapped ISO interval emission, click-to-clear, picker restrictions
 * (x = date-capable only, y = numeric only), keyboard axis affordance,
 * empty/degenerate data, legend, colors.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// mirrors charts.test.tsx's PointerEvent polyfill (jsdom ships none)
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId: number;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
      }
    }
    (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
  }
});

import { VizLine, lineCompat } from './VizLine.js';
import type { ColumnView } from '../adapter/types.js';

afterEach(cleanup);

const COLS: ColumnView[] = [
  { field: 'date', type: 'string' }, // providers type ISO strings as 'string'
  { field: 'shipped', type: 'date' }, // a provider that DID sniff a date
  { field: 'price', type: 'number' },
  { field: 'category', type: 'string' },
];

// four distinct dates, two series, one date with TWO rows in series A (mean check)
const DATA = [
  { date: '2026-04-01', value: 10, series: 'A' },
  { date: '2026-04-01', value: 30, series: 'A' }, // mean with the row above = 20
  { date: '2026-04-10', value: 40, series: 'A' },
  { date: '2026-04-20', value: 50, series: 'A' },
  { date: '2026-04-01', value: 5, series: 'B' },
  { date: '2026-04-30', value: 15, series: 'B' },
];

describe('lineCompat — the x/y channel restrictions', () => {
  it('x accepts a reported date column, refuses others WITH the reason', () => {
    const compat = lineCompat();
    expect(compat('x', { field: 'shipped', type: 'date' }).ok).toBe(true);
    const bad = compat('x', { field: 'price', type: 'number' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('needs a date column');
    expect(bad.reason).toContain('"price" is number');
  });

  it('x also accepts a column vouched for via dateFields (ISO strings report as "string")', () => {
    const compat = lineCompat(['date']);
    expect(compat('x', { field: 'date', type: 'string' }).ok).toBe(true);
    expect(compat('x', { field: 'category', type: 'string' }).ok).toBe(false);
  });

  it('y accepts only numeric columns, refusing even dates WITH the reason', () => {
    const compat = lineCompat();
    expect(compat('y', { field: 'price', type: 'number' }).ok).toBe(true);
    const badDate = compat('y', { field: 'shipped', type: 'date' });
    expect(badDate.ok).toBe(false);
    expect(badDate.reason).toContain('y needs a numeric column');
  });

  it('other channels fall through to the default rule (color accepts anything)', () => {
    const compat = lineCompat();
    expect(compat('color', { field: 'category', type: 'string' }).ok).toBe(true);
  });
});

describe('VizLine — aggregation and rendering', () => {
  it('draws one path per multi-point series and a dot per (series, date) with the MEAN value', () => {
    const { container } = render(<VizLine data={DATA} />);
    expect(container.querySelectorAll('path.vzf-line-path')).toHaveLength(2); // A and B
    // A has 3 distinct dates, B has 2 → 5 dots (the duplicate 04-01 rows in A merge into one)
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(5);
    // the merged dot's tooltip carries the mean of 10 and 30 over 2 rows
    const titles = [...container.querySelectorAll('circle.vzf-line-dot title')].map((t) => t.textContent);
    expect(titles).toContain('2026-04-01 · A · mean value 20 (2 rows)');
    expect(titles).toContain('2026-04-01 · B · mean value 5 (1 row)');
  });

  it('a single-row series renders its dot but no path (a line needs two points)', () => {
    const { container } = render(<VizLine data={[{ date: '2026-04-01', value: 10 }]} />);
    expect(container.querySelectorAll('path.vzf-line-path')).toHaveLength(0);
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(1);
  });

  it('unparseable dates are skipped (never positioned by guesswork)', () => {
    const { container } = render(
      <VizLine data={[{ date: 'not-a-date', value: 10 }, { date: '2026-04-01', value: 20 }]} />,
    );
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(1);
  });

  it('empty data renders the frame without dots, paths, or a legend — and never throws', () => {
    const { container } = render(<VizLine data={[]} />);
    expect(container.querySelector('svg.vzf-line')).toBeTruthy();
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(0);
    expect(container.querySelector('.vzf-line-legend')).toBeNull();
  });

  it('colours series via colorOf and falls back to the brand token without it', () => {
    const colorOf = vi.fn((s: string | undefined) => (s === 'A' ? '#111111' : '#222222'));
    const { container } = render(<VizLine data={DATA} colorOf={colorOf} />);
    expect(colorOf).toHaveBeenCalledWith('A');
    expect(colorOf).toHaveBeenCalledWith('B');
    const paths = container.querySelectorAll('path.vzf-line-path');
    expect(paths[0]!.getAttribute('stroke')).toBe('#111111');
    expect(paths[1]!.getAttribute('stroke')).toBe('#222222');

    const { container: plain } = render(<VizLine data={[{ date: '2026-04-01', value: 1 }, { date: '2026-04-02', value: 2 }]} />);
    expect(plain.querySelector('path.vzf-line-path')!.getAttribute('stroke')).toBe('var(--vzf-brand)');
  });

  it('shows an inline legend for ≥2 series (identity is never colour-alone), labelling an unnamed series "all"', () => {
    const { container } = render(
      <VizLine data={[{ date: '2026-04-01', value: 1 }, { date: '2026-04-01', value: 2, series: 'B' }]} />,
    );
    const legend = container.querySelector('.vzf-line-legend')!;
    expect(legend.textContent).toContain('all');
    expect(legend.textContent).toContain('B');
  });

  it('the legend is a band ABOVE the plot, never over it: the plot starts below the rows, and long lists wrap', () => {
    const one = render(<VizLine data={[{ date: '2026-04-01', value: 1 }, { date: '2026-04-02', value: 2 }]} />).container;
    const axisTop = (c: HTMLElement): number => Number(c.querySelectorAll('line.vzf-axis')[1]!.getAttribute('y1'));
    expect(axisTop(one)).toBe(18); // no legend ⇒ the plot keeps the top padding
    const two = render(<VizLine data={[{ date: '2026-04-01', value: 1, series: 'A' }, { date: '2026-04-01', value: 2, series: 'B' }]} />).container;
    expect(axisTop(two)).toBe(18 + 14 + 4); // one legend row above the plot
    const rows = (c: HTMLElement): Set<string> => new Set([...c.querySelectorAll('.vzf-line-legend > g')].map((g) => g.getAttribute('transform')!.split(', ')[1]!));
    expect(rows(two).size).toBe(1);
    const nine = render(<VizLine width={320} data={Array.from({ length: 9 }, (_, i) => ({ date: '2026-04-01', value: i, series: `Region number ${i}` }))} />).container;
    expect(rows(nine).size).toBeGreaterThan(1); // nine long names cannot share one 250px row
    expect(axisTop(nine)).toBe(18 + rows(nine).size * 14 + 4);
    const items = [...nine.querySelectorAll('.vzf-line-legend > g')].map((g) => g.getAttribute('transform')!);
    expect(items[0]).toBe('translate(52, 18)'); // the first name sits at the left edge of the plot's column
  });

  it('renders 3 x ticks (first/middle/last data dates) with inward edge anchors, and appends className', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      value: i,
    }));
    const { container } = render(<VizLine data={many} className="extra" />);
    const svg = container.querySelector('svg.vzf-line')!;
    expect(svg.getAttribute('class')).toBe('vzf-chart vzf-line extra');
    const tickEls = [...container.querySelectorAll('text.vzf-tick')].filter((t) => (t.textContent ?? '').startsWith('2026-'));
    expect(tickEls.map((t) => t.textContent)).toEqual(['2026-04-01', '2026-04-07', '2026-04-12']);
    // the edge labels anchor INWARD so they never clip at the plot edges
    expect(tickEls[0]!.getAttribute('text-anchor')).toBe('start');
    expect(tickEls[1]!.getAttribute('text-anchor')).toBe('middle');
    expect(tickEls[2]!.getAttribute('text-anchor')).toBe('end');
  });

  it('drops the middle tick when uneven date gaps would crowd it into an edge label', () => {
    // three of four dates cluster at the far right — the middle candidate
    // (2026-06-28) would sit on top of the end-anchored last label
    const clustered = ['2026-04-01', '2026-06-27', '2026-06-28', '2026-06-29'].map((date, i) => ({ date, value: i }));
    const { container } = render(<VizLine data={clustered} />);
    const tickEls = [...container.querySelectorAll('text.vzf-tick')].filter((t) => (t.textContent ?? '').startsWith('2026-'));
    expect(tickEls.map((t) => t.textContent)).toEqual(['2026-04-01', '2026-06-29']);
  });

  it('two dates tick as first+last; a single date gets one centered tick', () => {
    const two = [{ date: '2026-04-01', value: 1 }, { date: '2026-04-08', value: 2 }];
    const { container } = render(<VizLine data={two} />);
    const twoTicks = [...container.querySelectorAll('text.vzf-tick')].filter((t) => (t.textContent ?? '').startsWith('2026-'));
    expect(twoTicks.map((t) => t.getAttribute('text-anchor'))).toEqual(['start', 'end']);

    const { container: one } = render(<VizLine data={[{ date: '2026-04-01', value: 1 }]} />);
    const oneTick = [...one.querySelectorAll('text.vzf-tick')].filter((t) => (t.textContent ?? '').startsWith('2026-'));
    expect(oneTick).toHaveLength(1);
    expect(oneTick[0]!.getAttribute('text-anchor')).toBe('middle');
  });
});

describe('VizLine — the time brush', () => {
  it('a horizontal drag emits an ISO interval SNAPPED to the data dates, on the date field', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={DATA} dateField="date" onEmit={onEmit} width={520} />);
    const svg = container.querySelector('svg.vzf-line')!;
    // full-width drag: the snapped bounds are the first and last distinct dates
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 520, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 520, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledTimes(1);
    const emission = onEmit.mock.calls[0]![0];
    expect(emission.encoding).toEqual({ kind: 'interval', field: 'date' });
    expect(emission.rawValue).toEqual(['2026-04-01', '2026-04-30']);
  });

  it('the brush rect draws during the drag', () => {
    const { container } = render(<VizLine data={DATA} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, pointerId: 1 });
    expect(container.querySelector('rect.vzf-brush')).toBeTruthy();
  });

  it('a click (sub-4px) clears: null interval emission and no brush rect', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={DATA} onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 151, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'date' } });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
  });

  it('a drag over a chart with NO dated rows emits nothing (an interval is never fabricated)', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={[]} onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled();
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
  });

  it('a single-date dataset snaps both ends to that date ([d, d] — a valid one-day interval)', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={[{ date: '2026-04-05', value: 1 }]} onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 400, pointerId: 1 });
    expect(onEmit.mock.calls[0]![0].rawValue).toEqual(['2026-04-05', '2026-04-05']);
  });

  it('a pointer-move with no prior pointer-down is a no-op', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={DATA} onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerMove(svg, { clientX: 200, pointerId: 1 });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('a pointer-down on an axis label never starts (or, on release, clears) a brush', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={DATA} columns={COLS} onEmit={onEmit} />);
    const axisText = container.querySelector('.vzf-axis-group .vzf-axis-label')!;
    fireEvent.pointerDown(axisText, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(axisText, { clientX: 260, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled();
  });
});

describe('VizLine — the encoding picker', () => {
  it('the x-axis picker enables ONLY date-capable columns (the current dateField is vouched for by default)', () => {
    const onReencode = vi.fn();
    render(<VizLine data={DATA} dateField="date" valueField="price" columns={COLS} onReencode={onReencode} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the x axis/ }));
    const dialog = screen.getByRole('dialog');
    // 'date' reports type 'string' but is vouched for; 'shipped' reports 'date'
    expect((within(dialog).getByRole('button', { name: /^date/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(dialog).getByRole('button', { name: /shipped/ }) as HTMLButtonElement).disabled).toBe(false);
    const price = within(dialog).getByRole('button', { name: /price/ }) as HTMLButtonElement;
    expect(price.disabled).toBe(true);
    expect(price.getAttribute('title')).toContain('needs a date column');
    // picking the enabled date column fires the UI-0 verb
    fireEvent.click(within(dialog).getByRole('button', { name: /shipped/ }));
    expect(onReencode).toHaveBeenCalledWith('line', 'x', 'shipped');
  });

  // REGRESSION (defect 1): the session's encoding plane admits ANY continuous
  // column on a line's x (number or date), but this chart positions every
  // point with Date.parse — a numeric column would be drawn as calendar years
  // (week 12 ⇒ Dec 2001) and every value it cannot parse would be dropped in
  // silence. When the host passes `fits`, the chart's own rule must still be
  // able to veto, and say so.
  it('vetoes a NUMERIC x column the session would allow, and says who refused', () => {
    const onReencode = vi.fn();
    render(
      <VizLine
        data={DATA}
        dateField="date"
        valueField="price"
        columns={COLS}
        // the session judged every column fine for a continuous x
        fits={{ x: COLS.map((c) => ({ field: c.field, ok: c.type !== 'category' })) }}
        onReencode={onReencode}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Encode the x axis/ }));
    const dialog = screen.getByRole('dialog');
    const price = within(dialog).getByRole('button', { name: /price/ }) as HTMLButtonElement;
    expect(price.disabled, 'a number on a Date.parse axis is refused by the chart').toBe(true);
    expect(price.getAttribute('data-veto')).toBe('chart');
    expect(price.textContent).toContain('the time axis needs a date column');
    expect(within(dialog).getByText(/greyed by this chart, not by the session/)).toBeTruthy();
    // the date columns the chart CAN draw are still offered and still land the verb
    fireEvent.click(within(dialog).getByRole('button', { name: /shipped/ }));
    expect(onReencode).toHaveBeenCalledWith('line', 'x', 'shipped');
  });

  it('the y-axis picker enables only numeric columns and honours an explicit dateFields prop', () => {
    const onReencode = vi.fn();
    render(
      <VizLine data={DATA} dateField="date" valueField="price" columns={COLS} dateFields={['shipped']} onReencode={onReencode} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Encode the y axis/ }));
    const dialog = screen.getByRole('dialog');
    const cat = within(dialog).getByRole('button', { name: /category/ }) as HTMLButtonElement;
    expect(cat.disabled).toBe(true);
    expect(cat.getAttribute('title')).toContain('y needs a numeric column');
    expect((within(dialog).getByRole('button', { name: /price/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: /price/ }));
    expect(onReencode).toHaveBeenCalledWith('line', 'y', 'price');
  });

  it('the picker highlights the encoding-fold field when an encoding map is passed', () => {
    render(<VizLine data={DATA} columns={COLS} encoding={{ y: 'price' }} viewId="ts" />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the y axis/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /price/ }).getAttribute('aria-current')).toBe('true');
  });

  it('contract mode: an axis click asks the HOST via onReencodeRequest — no built-in picker (RP-1)', () => {
    const onReencodeRequest = vi.fn();
    render(<VizLine data={DATA} columns={COLS} onReencodeRequest={onReencodeRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the x axis/ }));
    expect(onReencodeRequest).toHaveBeenCalledWith('x');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('layer 4 navigate — xDomain shows a window without filtering the data', () => {
  it('draws only the dates inside the window (ISO or epoch bounds, either side open); no window = the data extent', () => {
    const data = [
      { date: '2026-01-01', value: 1 },
      { date: '2026-02-01', value: 2 },
      { date: '2026-03-01', value: 3 },
      { date: 'not a date', value: 9 },
    ];
    const dots = (el: HTMLElement) => el.querySelectorAll('circle').length;
    const { container, rerender } = render(<VizLine viewId="line" data={data} dateField="date" valueField="value" width={400} height={200} />);
    expect(dots(container)).toBe(3);
    rerender(<VizLine viewId="line" data={data} dateField="date" valueField="value" width={400} height={200} xDomain={['2026-01-15', null]} />);
    expect(dots(container)).toBe(2);
    rerender(<VizLine viewId="line" data={data} dateField="date" valueField="value" width={400} height={200} xDomain={[null, Date.UTC(2026, 1, 15)]} />);
    expect(dots(container)).toBe(2);
    rerender(<VizLine viewId="line" data={data} dateField="date" valueField="value" width={400} height={200} xDomain={['2026-01-15', '2026-02-15']} />);
    expect(dots(container)).toBe(1);
  });
});


describe('the accessible name (the prose plane\'s altShort)', () => {
  it('takes ariaLabel over its own construction line', () => {
    const { container } = render(<VizLine data={DATA} ariaLabel="Cases by report state" />);
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Cases by report state');
  });
});

describe('VizLine — a line on a BAND (band versus run is the x column’s, never a prop)', () => {
  // the SAME slot geometry every mark on a band uses (`bandWidth`/`bandCentre`, ../primitives/scales.ts):
  // PAD.l = 52, PAD.r = 18, so at width 520 a three-slot band is 150 wide and its centres sit at 127 / 277 / 427
  const centreOf = (index: number, count: number, width = 520): number => 52 + ((width - 52 - 18) / count) * index + (width - 52 - 18) / count / 2;
  const dotsOf = (c: HTMLElement): { name: string; cx: number }[] =>
    [...c.querySelectorAll('circle.vzf-line-dot')].map((d) => ({ name: d.querySelector('title')!.textContent!.split(' · ')[0]!, cx: Number(d.getAttribute('cx')) }));
  const BAND = [
    { category: 'Formal', value: 4 },
    { category: 'Casual', value: 2 },
    { category: 'Casual', value: 6 }, // mean with the row above = 4
    { category: 'Party', value: 9 },
  ];

  it('points that carry a category make x a band: each sits at its slot’s CENTRE, in the points’ own first-seen order, with the mean per category', () => {
    const { container } = render(<VizLine data={BAND} width={520} />);
    expect(dotsOf(container)).toEqual([
      { name: 'Formal', cx: centreOf(0, 3) },
      { name: 'Casual', cx: centreOf(1, 3) },
      { name: 'Party', cx: centreOf(2, 3) },
    ]);
    // the tooltip names the category, and the mean is the mean
    expect(container.querySelectorAll('circle.vzf-line-dot')[1]!.querySelector('title')!.textContent).toBe('Casual · mean value 4 (2 rows)');
    // one run of three adjacent slots: ONE path through all three centres
    const paths = container.querySelectorAll('path.vzf-line-path');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute('d')!.startsWith(`M${centreOf(0, 3)},`)).toBe(true);
  });

  it('the frame’s band order decides the slots (`domain.categories`), and a category the frame did not name is APPENDED, never dropped', () => {
    const { container } = render(<VizLine data={BAND} width={520} domain={{ categories: ['Casual', 'Formal', 'Work'] }} />);
    // four slots: the frame's three in its order, then 'Party' appended — the `bandOrder` law
    expect(dotsOf(container)).toEqual([
      { name: 'Casual', cx: centreOf(0, 4) },
      { name: 'Formal', cx: centreOf(1, 4) },
      { name: 'Party', cx: centreOf(3, 4) },
    ]);
    // the band's labels ARE the axis: one tick per slot, in the band's order, the empty 'Work' slot included
    expect([...container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent).slice(0, 4)).toEqual(['Casual', 'Formal', 'Work', 'Party']);
  });

  it('a slot with no point is a GAP: the segments on either side stop at their own points — two paths, never one crossing the empty slot', () => {
    const data = [
      { category: 'a', value: 1 },
      { category: 'b', value: 2 },
      { category: 'd', value: 4 },
      { category: 'e', value: 5 },
    ];
    const { container } = render(<VizLine data={data} width={520} domain={{ categories: ['a', 'b', 'c', 'd', 'e'] }} />);
    const paths = [...container.querySelectorAll('path.vzf-line-path')].map((p) => p.getAttribute('d')!);
    expect(paths).toHaveLength(2);
    // a–b, then d–e: neither path reaches into c's slot
    expect(paths[0]).toBe(`M${centreOf(0, 5)},${paths[0]!.split(',')[1]!.split(' ')[0]!} L${centreOf(1, 5)},${paths[0]!.split(',')[2]!}`);
    expect(paths[1]!.startsWith(`M${centreOf(3, 5)},`)).toBe(true);
    expect(paths[1]!.includes(`L${centreOf(4, 5)},`)).toBe(true);
    // every dot is still drawn — a gap is in the CONNECTORS, not in the points
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(4);
    // a lone point between two gaps draws its dot and no path (a line needs two points)
    const lone = render(<VizLine data={[{ category: 'a', value: 1 }, { category: 'c', value: 3 }]} width={520} domain={{ categories: ['a', 'b', 'c'] }} />);
    expect(lone.container.querySelectorAll('path.vzf-line-path')).toHaveLength(0);
    expect(lone.container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
  });

  it('y is untouched by the band: its own padded extent and ticks as on a run, and a logarithmic y still ticks at decades and excludes what it cannot place', () => {
    const { container } = render(<VizLine data={BAND} width={520} />);
    // the y ticks step inside the chart's own 0.5 padding, exactly as they do over dates: means 4 · 4 · 9
    const yTicks = [...container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent).slice(3);
    expect(yTicks.slice(0, 4)).toEqual(['4', '5.7', '7.3', '9']);
    const log = render(<VizLine data={[{ category: 'a', value: 10 }, { category: 'b', value: 0 }, { category: 'c', value: 1000 }]} width={520} domain={{ categories: ['a', 'b', 'c'], transform: { y: 'log' } }} />);
    // the zero has no position on a logarithmic y — not drawn, and counted in the accessible name
    expect(log.container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
    expect(log.container.querySelector('svg')!.getAttribute('aria-label')).toContain('1 value is not drawn');
    expect([...log.container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent)).toEqual(['a', 'b', 'c', '10', '100', '1000']); // decade ticks, after the three band labels
    // b's slot is empty (excluded), so a and c are two lone points: no connector across a value that was never placed
    expect(log.container.querySelectorAll('path.vzf-line-path')).toHaveLength(0);
  });

  it('a band draws NO brush (an interval has no meaning on a band) and ignores the time window (a band has no between to window)', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={BAND} width={520} onEmit={onEmit} xDomain={['2026-01-01', null]} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 520, pointerId: 1 });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
    fireEvent.pointerUp(svg, { clientX: 520, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled();
    // every point drawn — the window filtered nothing
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(3);
  });

  it('a dated point handed to a band becomes a slot named by its date — nothing is dropped; and with `axes={false}` the band draws no tick and gives up no plot', () => {
    const { container } = render(<VizLine data={[{ category: 'a', value: 1 }, { date: '2026-04-01', value: 2 }]} width={520} />);
    expect(dotsOf(container).map((d) => d.name)).toEqual(['a', '2026-04-01']);
    const framed = render(<VizLine data={[{ category: 'a very long category name indeed', value: 1 }, { category: 'another very long category name', value: 2 }]} width={200} height={200} axes={false} />);
    expect(framed.container.querySelectorAll('text.vzf-tick')).toHaveLength(0);
    // the plot bottom is PAD.b from the bottom exactly: the dots' cy for the higher value sit at the top pad of the plot,
    // and the lower at height - PAD.b (44) minus the 0.5 padding's share — pinned via the axis-less baseline not moving
    const cys = [...framed.container.querySelectorAll('circle.vzf-line-dot')].map((d) => Number(d.getAttribute('cy')));
    expect(Math.max(...cys)).toBeLessThanOrEqual(200 - 44);
  });

  it('long band labels slant, and the plot gives up room for them the way a bar chart does', () => {
    const { container } = render(<VizLine data={[{ category: 'a very long category name indeed', value: 1 }, { category: 'another very long category name', value: 2 }]} width={200} height={300} />);
    const ticks = [...container.querySelectorAll('text.vzf-tick')].filter((t) => t.getAttribute('transform')?.startsWith('rotate(-40'));
    expect(ticks).toHaveLength(2);
    // clipped labels keep the whole name in a title
    expect(ticks[0]!.querySelector('title')!.textContent).toBe('a very long category name indeed');
    // the baseline moved up by SLANT_PAD (40): the axis line sits at 300 - (44 + 40)
    const axis = container.querySelector('line.vzf-axis')!;
    expect(Number(axis.getAttribute('y1'))).toBe(300 - 84);
    // a label too wide for its slot but short enough for the slant is drawn whole on the slant — no title, nothing clipped
    // (three slots of 70px at width 280; 12 characters × 6px = 72px does not fit flat, and 12 is what 48px of slant room holds)
    cleanup();
    const whole = render(<VizLine data={[{ category: 'abcdefghijkl', value: 1 }, { category: 'nopqrstuvwxy', value: 2 }, { category: 'c', value: 3 }]} width={280} height={300} />).container;
    const slanted = [...whole.querySelectorAll('text.vzf-tick')].filter((t) => t.getAttribute('transform')?.startsWith('rotate(-40'));
    expect(slanted.map((t) => t.textContent)).toEqual(['abcdefghijkl', 'nopqrstuvwxy']);
    expect(slanted.every((t) => t.querySelector('title') === null)).toBe(true);
  });
});
