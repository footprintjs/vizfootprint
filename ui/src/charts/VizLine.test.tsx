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
import { VizBar } from './VizBar.js';
import { noSlotsCoveredNote, noValuesCoveredNote } from '../primitives/scales.js';
import { noSlotValuesNote, ambiguousSlotNote } from '../primitives/slotValues.js';
import { selectionForView, clausePredicate } from '../contract/selection.js';
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
  // THE NUMBER IS ACCEPTED NOW, and this test used to assert the opposite. The veto was honest while
  // it stood — the chart had no numeric-run arm — and it is gone because the chart HAS one: a picker
  // that greys a column the chart draws is the same capability lie in the other direction.
  it('x accepts a reported date column AND a number (the numeric run arm) — a type it cannot draw is still refused WITH the reason', () => {
    const compat = lineCompat();
    expect(compat('x', { field: 'shipped', type: 'date' }).ok).toBe(true);
    expect(compat('x', { field: 'resnum', type: 'number' }).ok).toBe(true);
    const bad = compat('x', { field: 'blob', type: 'unknown' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('needs a date, a number or a category column');
    expect(bad.reason).toContain('"blob" is unknown');
  });

  it('x also accepts a column vouched for via dateFields (ISO strings report as "string")', () => {
    const compat = lineCompat(['date']);
    expect(compat('x', { field: 'date', type: 'string' }).ok).toBe(true);
  });

  // THE WIDENED DOOR (a line's x takes a category, `CHART_REQUIREMENTS.line.x`): this chart draws
  // it as a band (`lineMark`, the discriminated `LinePoint` union), so the veto widens with it
  it('x now also accepts a category column outright — a string or a boolean — with no dateFields vouch needed', () => {
    const compat = lineCompat();
    expect(compat('x', { field: 'category', type: 'string' }).ok).toBe(true);
    expect(compat('x', { field: 'flag', type: 'boolean' }).ok).toBe(true);
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

describe('VizLine — date display formatting', () => {
  const intraday = [
    { date: '2026-04-01T16:00:00.000Z', value: 10 },
    { date: '2026-04-01T16:05:00.000Z', value: 20 },
  ];

  it('keeps the date-only default markup unchanged', () => {
    const plain = render(<VizLine data={intraday} />).container.innerHTML;
    const explicit = render(<VizLine data={intraday} formatDate={(iso) => iso.slice(0, 10)} />).container.innerHTML;
    expect(explicit).toBe(plain);
    expect(plain).toContain('2026-04-01 · mean value 10 (1 row)');
  });

  it('formats intraday ticks and tooltips without changing positions or emitted ISO bounds', () => {
    const base = render(<VizLine data={intraday} width={520} />).container;
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={intraday} width={520} formatDate={(iso) => iso.slice(11, 19) + ' UTC'} onEmit={onEmit} />);
    const ticks = [...container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent);
    expect(ticks).toContain('16:00:00 UTC');
    expect(ticks).toContain('16:05:00 UTC');
    expect(container.querySelector('circle.vzf-line-dot title')!.textContent).toBe('16:00:00 UTC · mean value 10 (1 row)');
    const positions = (root: HTMLElement) => [...root.querySelectorAll('circle.vzf-line-dot')].map((dot) => [dot.getAttribute('cx'), dot.getAttribute('cy')]);
    expect(positions(container)).toEqual(positions(base));
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 520, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [intraday[0]!.date, intraday[1]!.date], encoding: { kind: 'interval', field: 'date' } });
  });

  it('keeps formatter output as literal text and never formats category labels', () => {
    const label = '<img src=x onerror=alert(1)>';
    const dated = render(<VizLine data={intraday} formatDate={() => label} />).container;
    expect(dated.querySelector('text.vzf-tick')!.textContent).toBe(label);
    expect(dated.querySelector('img')).toBeNull();
    const formatDate = vi.fn(() => 'wrong');
    const band = render(<VizLine data={[{ category: 'queue', value: 1 }]} formatDate={formatDate} />).container;
    expect(formatDate).not.toHaveBeenCalled();
    expect(band.querySelector('circle.vzf-line-dot title')!.textContent).toBe('queue · mean value 1 (1 row)');
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
  it('the x-axis picker enables date-capable, category AND numeric columns — the three x kinds this chart draws (the current dateField is vouched for by default)', () => {
    const onReencode = vi.fn();
    render(<VizLine data={DATA} dateField="date" valueField="price" columns={COLS} onReencode={onReencode} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the x axis/ }));
    const dialog = screen.getByRole('dialog');
    // 'date' reports type 'string' but is vouched for; 'shipped' reports 'date'
    expect((within(dialog).getByRole('button', { name: /^date/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(dialog).getByRole('button', { name: /shipped/ }) as HTMLButtonElement).disabled).toBe(false);
    // 'category' (a string, the widened door) is offered now — this chart draws it as a band
    expect((within(dialog).getByRole('button', { name: /^category/ }) as HTMLButtonElement).disabled).toBe(false);
    // 'price' (a number) is offered too now — this chart draws it as a RUN OF NUMBERS, and the veto
    // that used to grey it was honest only while the chart had no such arm
    expect((within(dialog).getByRole('button', { name: /price/ }) as HTMLButtonElement).disabled).toBe(false);
    // picking the enabled date column fires the UI-0 verb
    fireEvent.click(within(dialog).getByRole('button', { name: /shipped/ }));
    expect(onReencode).toHaveBeenCalledWith('line', 'x', 'shipped');
  });

  // REGRESSION (defect 1): the chart's OWN rule must be able to veto a column the session's encoding
  // plane admits, and say who refused. The column it vetoes used to be the NUMBER — honest while this
  // chart had no numeric run — and the case is not gone with that arm: a column whose type nothing can
  // fold (a provider that typed it `unknown`) is a column this chart cannot position, on any of its
  // three x kinds, and a picker that offered it would promise a picture it cannot draw.
  it('vetoes an x column the session would allow but this chart cannot position, and says who refused', () => {
    const onReencode = vi.fn();
    const cols: ColumnView[] = [...COLS, { field: 'blob', type: 'unknown' }];
    render(
      <VizLine
        data={DATA}
        dateField="date"
        valueField="price"
        columns={cols}
        // the session judged every column fine for a continuous x
        fits={{ x: cols.map((c) => ({ field: c.field, ok: true })) }}
        onReencode={onReencode}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Encode the x axis/ }));
    const dialog = screen.getByRole('dialog');
    const blob = within(dialog).getByRole('button', { name: /blob/ }) as HTMLButtonElement;
    expect(blob.disabled, 'a column no scale can be folded from is refused by the chart').toBe(true);
    expect(blob.getAttribute('data-veto')).toBe('chart');
    expect(blob.textContent).toContain('the x of a line needs a date, a number or a category column');
    expect(within(dialog).getByText(/greyed by this chart, not by the session/)).toBeTruthy();
    // the columns the chart CAN draw are still offered and still land the verb
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

  it('a band ignores the time window (a band has no between to window) and DOES draw the drag rectangle (law 13)', () => {
    const { container } = render(<VizLine data={BAND} width={520} xDomain={['2026-01-01', null]} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 520, pointerId: 1 });
    // THE DEFECT THIS PACKET CAME FROM: the protein desk's 185-slot line had no brush element of any
    // kind (`vzf-chart-frame · vzf-chart vzf-line · vzf-axis · … · vzf-axis-caret` and nothing else),
    // so a reader dragging across it saw nothing move and 185 dots before and after
    expect(container.querySelector('rect.vzf-brush')).not.toBeNull();
    fireEvent.pointerUp(svg, { clientX: 520, pointerId: 1 });
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

describe('VizLine — the y axis on the RIGHT edge (the second axis of a frame)', () => {
  const ROWS = [
    { date: '2026-04-01', value: 10 },
    { date: '2026-04-10', value: 40 },
  ];
  /** Every y tick of a chart — a tick group whose stroke is HORIZONTAL — with where its text sits and which way it reads. */
  const yTicksOf = (container: Element): { x: number; anchor: string | null }[] =>
    [...container.querySelectorAll('g')]
      .filter((g) => {
        const line = g.querySelector(':scope > line.vzf-axis');
        return line !== null && g.querySelector(':scope > text.vzf-tick') !== null && line.getAttribute('y1') === line.getAttribute('y2');
      })
      .map((g) => {
        const text = g.querySelector(':scope > text.vzf-tick')!;
        return { x: Number(text.getAttribute('x')), anchor: text.getAttribute('text-anchor') };
      });
  const yLabelOf = (container: Element): Element => container.querySelector('.vzf-axis-group[data-axis-channel="y"]')!;
  /** The dots, as (cx, cy) pairs — the marks' pixels. */
  const dotsOf = (container: Element): [number, number][] => [...container.querySelectorAll('circle.vzf-line-dot')].map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);

  it('absent: byte-identical to the chart before sides existed', () => {
    const plain = render(<VizLine data={ROWS} width={400} height={300} />).container.innerHTML;
    cleanup();
    const left = render(<VizLine data={ROWS} width={400} height={300} axisSide="left" />).container.innerHTML;
    expect(left).toBe(plain);
  });

  it('right: the axis line, its ticks (reading rightward) and its label stand on the right edge; the marks are placed exactly as on the left', () => {
    const left = render(<VizLine data={ROWS} width={400} height={300} />).container;
    const leftDots = dotsOf(left);
    const leftTicks = yTicksOf(left);
    const leftPaths = left.querySelectorAll('path.vzf-line-path').length;
    const leftLabel = yLabelOf(left).getAttribute('transform');
    cleanup();
    const right = render(<VizLine data={ROWS} width={400} height={300} axisSide="right" />).container;
    // the y axis LINE is vertical at the plot's right edge (width − mirrored right pad = 400 − 52)
    const vertical = [...right.querySelectorAll('line.vzf-axis')].filter((l) => l.getAttribute('x1') === l.getAttribute('x2') && l.getAttribute('y1') !== l.getAttribute('y2'));
    expect(vertical.map((l) => l.getAttribute('x1'))).toContain('348');
    // the ticks read rightward, past the edge
    const ticks = yTicksOf(right);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBe(leftTicks.length);
    expect(leftTicks.every((t) => t.anchor === 'end' && t.x === 52 - 8)).toBe(true);
    expect(ticks.every((t) => t.anchor === 'start' && t.x === 348 + 8)).toBe(true);
    // the label faces the right edge: rotated +90 at 14px in from it
    expect(yLabelOf(right).getAttribute('transform')).toBe('rotate(90 386 150)');
    expect(leftLabel).toBe('rotate(-90 14 150)');
    // the marks: the same dots at the same HEIGHTS (the y scale is untouched) — a side is where the axis is, never
    // where the data is. The plot box is [18, 348] on the right versus [52, 382] on the left, the SAME width shifted
    // by the swapped margins, so every x moves by exactly −34; a frame undoes that shift by where it places the svg.
    expect(dotsOf(right)).toEqual(leftDots.map(([cx, cy]) => [cx - 34, cy]));
    expect(right.querySelectorAll('path.vzf-line-path').length).toBe(leftPaths);
  });

  it("axes: 'y' draws the y axis alone — no x line, no x ticks, no x label — for the frame that draws x once", () => {
    const { container } = render(<VizLine data={ROWS} width={400} height={300} axes="y" axisSide="right" />);
    expect(container.querySelector('.vzf-axis-group[data-axis-channel="x"]')).toBeNull();
    expect(yLabelOf(container)).not.toBeNull();
    // every axis stroke is the vertical y line or a 4px y tick — no baseline runs across the plot
    const baseline = [...container.querySelectorAll('line.vzf-axis')].filter((l) => l.getAttribute('y1') === l.getAttribute('y2') && Math.abs(Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'))) > 4);
    expect(baseline).toHaveLength(0);
    expect(yTicksOf(container).length).toBeGreaterThan(0);
  });

  it('a LOGARITHMIC y on the right: the domain, the decade ticks and the excluded-zero count are the curve’s, untouched by which edge draws them (packet W review, P1)', () => {
    const data = [{ category: 'a', value: 10 }, { category: 'b', value: 0 }, { category: 'c', value: 1000 }];
    const domain = { categories: ['a', 'b', 'c'], transform: { y: 'log' as const } };
    const tickText = (c: Element) => [...c.querySelectorAll('text.vzf-tick')].map((t) => t.textContent);
    const leftTickText = tickText(render(<VizLine data={data} width={520} domain={domain} />).container);
    cleanup();
    const right = render(<VizLine data={data} width={520} domain={domain} axisSide="right" />).container;
    // the SAME decade ticks, the SAME excluded zero, the SAME dropped connector — a side moves pixels, never the curve
    expect(tickText(right)).toEqual(leftTickText);
    expect(right.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
    expect(right.querySelector('svg')!.getAttribute('aria-label')).toContain('1 value is not drawn');
    expect(right.querySelectorAll('path.vzf-line-path')).toHaveLength(0);
    // …and the decade ticks read off the RIGHT edge, the same as any other right-side y tick (520 − mirrored PAD.r 52, + 8)
    const decadeTicks = yTicksOf(right);
    expect(decadeTicks.length).toBeGreaterThan(0);
    expect(decadeTicks.every((t) => t.anchor === 'start' && t.x === 468 + 8)).toBe(true);
  });
});

describe('VizLine — the ink of its scale (one edge of a two-scale frame)', () => {
  const ROWS = [
    { date: '2026-04-01', value: 10 },
    { date: '2026-04-10', value: 40 },
  ];
  const HUE = 'var(--vzf-scale-left)';
  /** Every element the hue is meant to reach: the y axis line, each y tick's group, the axis label's group. */
  const hued = (container: Element): string[] => [...container.querySelectorAll('[style*="--vzf-scale-hue"]')].map((el) => el.getAttribute('style') ?? '');

  it('absent: byte-identical to the chart before hues existed — and a hue reaches EXACTLY the axis and the ink, nothing else', () => {
    const withHue = render(<VizLine data={ROWS} width={400} height={300} axes="y" scaleHue={HUE} />).container.innerHTML;
    cleanup();
    const plain = render(<VizLine data={ROWS} width={400} height={300} axes="y" />).container.innerHTML;
    // take the hue back out — the variable off the axis parts, the brand back on the marks — and the
    // markup IS the markup this chart drew before the prop existed: the hue moved no pixel and no attribute
    const stripped = withHue
      .replaceAll(` style="--vzf-scale-hue: ${HUE};"`, '')
      .replaceAll(`; --vzf-scale-hue: ${HUE};`, ';')
      .replaceAll(HUE, 'var(--vzf-brand)');
    expect(stripped).toBe(plain);
  });

  it('present: the y axis line, every one of its ticks, its label AND the unsplit marks are drawn in it', () => {
    const { container } = render(<VizLine data={ROWS} width={400} height={300} axes="y" scaleHue={HUE} />);
    // the axis line itself
    const axisLine = [...container.querySelectorAll('line.vzf-axis')].find((l) => l.getAttribute('x1') === l.getAttribute('x2'))!;
    expect(axisLine.getAttribute('style')).toBe(`--vzf-scale-hue: ${HUE};`);
    // one hued group per y tick (4 ticks), plus the axis label's own group — the stylesheet spends the
    // variable per element (`.vzf-axis` on its stroke, `.vzf-tick`/`.vzf-axis-label` on their fill)
    expect(hued(container)).toHaveLength(1 + 4 + 1);
    expect(container.querySelector('.vzf-axis-group[data-axis-channel="y"]')?.getAttribute('style')).toBe(`cursor: pointer; --vzf-scale-hue: ${HUE};`);
    // the marks: this layer's line and its dots, in the same hue as the axis they are read against
    expect(container.querySelector('path.vzf-line-path')?.getAttribute('stroke')).toBe(HUE);
    expect([...container.querySelectorAll('circle.vzf-line-dot')].map((c) => c.getAttribute('fill'))).toEqual([HUE, HUE]);
  });

  it('a chart SPLIT into series keeps its series colours and takes the hue on its axis alone — identity is never colour-alone', () => {
    const split = [
      { date: '2026-04-01', value: 10, series: 'north' },
      { date: '2026-04-10', value: 40, series: 'north' },
      { date: '2026-04-01', value: 30, series: 'south' },
      { date: '2026-04-10', value: 20, series: 'south' },
    ];
    const colorOf = (name: string | undefined): string => (name === 'north' ? '#111111' : '#222222');
    const { container } = render(<VizLine data={split} width={400} height={300} axes="y" scaleHue={HUE} colorOf={colorOf} />);
    // the marks answer to `colorOf`, not to the frame: a hue that already names a series may not be overwritten
    expect([...container.querySelectorAll('path.vzf-line-path')].map((pth) => pth.getAttribute('stroke'))).toEqual(['#111111', '#222222']);
    expect([...container.querySelectorAll('.vzf-line-legend rect')].map((r) => r.getAttribute('fill'))).toEqual(['#111111', '#222222']);
    // …and the axis is still the scale's: the hue says WHICH EDGE these series are read against
    const axisLine = [...container.querySelectorAll('line.vzf-axis')].find((l) => l.getAttribute('x1') === l.getAttribute('x2'))!;
    expect(axisLine.getAttribute('style')).toBe(`--vzf-scale-hue: ${HUE};`);
  });
});

/**
 * A BAND IS A RANGE TOO (law 13) — the BAND BRUSH.
 *
 * THE MEASURED DEFECT: the protein desk's biggest chart could not be selected
 * at all. Driven in a browser, its element classes were `vzf-chart-frame ·
 * vzf-chart vzf-line · vzf-axis · vzf-tick · vzf-line-series · vzf-line-path ·
 * vzf-line-dot · vzf-line-legend · vzf-axis-group · vzf-axis-affordance ·
 * vzf-axis-hit · vzf-axis-label · vzf-axis-caret` — NO brush element of any
 * kind — and a drag left every count unchanged: 185 dots before, 185 after.
 * Its x is a band because two chains share one residue-number axis, so a slot
 * holds a residue of each, and this chart's own words were "a band line draws
 * no brush".
 *
 * The law: a drag selects THE SLOTS WHOSE POINTS IT CROSSES (`slotsCovered`,
 * the one owner), in the BAND's order, landed as the MATCH `VizBar`'s own drag
 * over the same band lands (`matchEmission`, the one owner of the words).
 */
describe('VizLine — a band is a range too: the band brush (law 13)', () => {
  const PLOT_L = 52;
  const PLOT_R = 18;
  /** The centre of slot `index` of `count`, at this width — the SAME arithmetic the dots are drawn by. */
  const centre = (index: number, count: number, width = 520): number => PLOT_L + ((width - PLOT_L - PLOT_R) / count) * index + (width - PLOT_L - PLOT_R) / count / 2;
  const BAND3 = [
    { category: 'Formal', value: 4 },
    { category: 'Casual', value: 2 },
    { category: 'Party', value: 9 },
  ];
  /** Drag across the chart's own svg, `from` → `to`, and hand back what it emitted. */
  const drag = (container: HTMLElement, from: number, to: number, selector = 'svg.vzf-line'): void => {
    const svg = container.querySelector(selector)!;
    fireEvent.pointerDown(svg, { clientX: from, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: to, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: to, pointerId: 1 });
  };

  it('THE SLOTS COVERED: a drag lands the match over every slot whose point it crossed, and nothing else', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={onEmit} />);
    // slots at 127 / 277 / 427 — a drag from 100 to 300 crosses the first two
    drag(container, 100, 300);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Formal', 'Casual'] }, encoding: { kind: 'match', field: 'shelf' } });
  });

  it('ONE SLOT: a drag that starts and ends inside one slot selects that slot — the edges are SLOTS, not pixels', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={onEmit} />);
    // 270 → 285 never leaves the middle slot (202..352) and crosses its point at 277
    drag(container, 270, 285);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Casual'] }, encoding: { kind: 'match', field: 'shelf' } });
  });

  it('NOTHING COVERED: a drag that crosses no point selects nothing and SAYS SO — never an empty keep-list', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={onEmit} />);
    // 300 → 400 sits between the second point (277) and the third (427): it crosses neither
    drag(container, 300, 400);
    expect(onEmit).not.toHaveBeenCalled();
    // the brush cleared (the primitive's own "never fabricate" arm) …
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
    // … and the reader is told, in the library's one polite live region — never silence
    expect(document.querySelector('.vzf-live-region')!.textContent!.trim()).toBe(noSlotsCoveredNote());
    expect(noSlotsCoveredNote()).toBe('a drag selects the slots whose points it crosses — this one crossed none, so nothing was selected');
  });

  it('ORDER IS THE BAND’S: a right-to-left drag and a left-to-right one over the same slots are ONE selection', () => {
    const leftToRight = vi.fn();
    const rightToLeft = vi.fn();
    const a = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={leftToRight} />);
    drag(a.container, 100, 460);
    cleanup();
    const b = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={rightToLeft} />);
    drag(b.container, 460, 100);
    expect(rightToLeft.mock.calls[0]![0]).toEqual(leftToRight.mock.calls[0]![0]);
    // and it is the band's own order, not the pointer's
    expect(leftToRight.mock.calls[0]![0].rawValue).toEqual({ values: ['Formal', 'Casual', 'Party'] });
  });

  it('THE SAME CLAUSE AS THE BAR’S over the same band — byte-identical, so two charts on one band cannot drift', () => {
    const fromLine = vi.fn();
    const line = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={fromLine} />);
    drag(line.container, 100, 300);
    cleanup();
    // the bar's own drag-run over the same three slots: press the first bar, release over the second
    const fromBar = vi.fn();
    const bar = render(<VizBar data={BAND3.map((d) => ({ category: d.category, count: d.value }))} field="shelf" width={520} onEmit={fromBar} />);
    const bars = bar.container.querySelectorAll('rect.vzf-barrect');
    fireEvent.pointerDown(bars[0]!, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar.container.querySelector('svg.vzf-bar')!, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(bar.container.querySelector('svg.vzf-bar')!, { clientX: 300, pointerId: 1 });
    expect(JSON.stringify(fromBar.mock.calls[0]![0])).toBe(JSON.stringify(fromLine.mock.calls[0]![0]));
  });

  it('THE ROUND TRIP: what the chart emits, the read door accepts, and the chart draws in the SAME slots', () => {
    const onEmit = vi.fn();
    const { container, rerender } = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={onEmit} />);
    drag(container, 100, 300);
    const emission = onEmit.mock.calls[0]![0] as { rawValue: unknown; encoding: { kind: string; field: string } };
    // the session's fold of that emission, read back through the contract's OWN door
    const selection = selectionForView([{ viewId: 'line', field: emission.encoding.field, kind: 'match', value: emission.rawValue }], 'line');
    rerender(<VizLine viewId="line" data={BAND3} width={520} dateField="shelf" selection={selection} onEmit={onEmit} />);
    const outlined = [...container.querySelectorAll('circle.vzf-line-dot.vzf-selected')].map((d) => Number(d.getAttribute('cx')));
    expect(outlined).toEqual([centre(0, 3), centre(1, 3)]);
    // the third slot's point is untouched
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(3);
  });

  it('A BAND OF ONE SLOT: the whole plot is one slot, and a drag anywhere across it selects it', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={[{ category: 'only', value: 1 }]} width={520} dateField="shelf" onEmit={onEmit} />);
    drag(container, 60, 490);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['only'] }, encoding: { kind: 'match', field: 'shelf' } });
  });

  it('THE DESK’S OWN CASE — 185 slots in 940px, about 5px each — is hittable: a drag over one slot selects one', () => {
    const onEmit = vi.fn();
    const names = Array.from({ length: 185 }, (_, i) => `r${String(i + 1)}`);
    const data = names.map((category, i) => ({ category, value: i }));
    const { container } = render(<VizLine data={data} width={940} dateField="residue" onEmit={onEmit} />);
    const slot = (940 - PLOT_L - PLOT_R) / 185; // ≈ 4.7 viewBox units
    expect(slot).toBeLessThan(5);
    // a 5px drag centred on slot 100's point crosses that one point and no other
    const at = centre(100, 185, 940);
    drag(container, at - 2, at + 2);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['r101'] }, encoding: { kind: 'match', field: 'residue' } });
    // …and a wider drag lands the run it crossed, in the band's order, nothing missing at either end
    onEmit.mockClear();
    drag(container, centre(10, 185, 940), centre(19, 185, 940));
    expect((onEmit.mock.calls[0]![0] as { rawValue: { values: string[] } }).rawValue.values).toEqual(names.slice(10, 20));
  });

  it('A BAND WHOSE SLOTS ARE NARROWER THAN A PIXEL still answers honestly — the slots the drag crossed, however many', () => {
    const onEmit = vi.fn();
    const data = Array.from({ length: 300 }, (_, i) => ({ category: `c${String(i)}`, value: i }));
    const { container } = render(<VizLine data={data} width={200} dateField="c" onEmit={onEmit} />);
    // 130 units over 300 slots is 0.433 each: a 10-unit drag crosses 23 of them, and the answer names all 23
    drag(container, 100, 110);
    const values = (onEmit.mock.calls[0]![0] as { rawValue: { values: string[] } }).rawValue.values;
    expect(values).toHaveLength(23);
    expect(values[0]).toBe('c111');
    expect(values[22]).toBe('c133');
  });

  it('a sub-4px release on a band SELECTS THE SLOT under the pointer — it used to release the match, which left a 5px slot reachable by nothing but a drag (see reachableMarks.test.tsx for the whole law)', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={BAND3} width={520} dateField="shelf" onEmit={onEmit} />);
    // the release pixel decides: 202 is the middle slot's left edge (slots of 150 from 52), so the tap
    // lands 'Casual' — the clause `VizBar`'s own click lands, and no longer the cleared match
    drag(container, 200, 202);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Casual', encoding: { kind: 'point', field: 'shelf' } });
  });

  it('a drag inside an EXCLUDE set keeps its polarity — `VizBar` · `endRun`’s own law, through the same clause', () => {
    const onEmit = vi.fn();
    const selection = selectionForView([{ viewId: 'line', field: 'shelf', kind: 'match', value: { values: ['Party'], exclude: true } }], 'line');
    const { container } = render(<VizLine viewId="line" data={BAND3} width={520} dateField="shelf" selection={selection} onEmit={onEmit} />);
    drag(container, 100, 300);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Formal', 'Casual'], exclude: true }, encoding: { kind: 'match', field: 'shelf' } });
    // an excluded slot's point wears the exclude class, never the keep one
    expect(container.querySelectorAll('circle.vzf-line-dot.vzf-excluded')).toHaveLength(1);
  });

  it('BYTE IDENTITY: a continuous-x line’s brush is unchanged in every respect, and its dots take no outline from a selection', () => {
    const onEmit = vi.fn();
    const dated = [
      { date: '2026-04-01', value: 1 },
      { date: '2026-04-08', value: 2 },
      { date: '2026-04-15', value: 3 },
    ];
    const bare = render(<VizLine data={dated} width={520} onEmit={onEmit} />);
    const withoutSelection = bare.container.innerHTML; // idle, before any gesture
    drag(bare.container, 100, 400);
    // still the SNAPPED ISO interval, on the date field, exactly as before law 13
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: ['2026-04-01', '2026-04-15'], encoding: { kind: 'interval', field: 'date' } });
    cleanup();
    // …and a run handed a SELECTION draws the same markup: a dated line's own clause is an interval,
    // which names no point to outline (`markClass` is a band's, and a run reads nothing from the prop)
    const selection = selectionForView([{ viewId: 'line', field: 'date', kind: 'match', value: { values: ['2026-04-01'] } }], 'line');
    const withIt = render(<VizLine viewId="line" data={dated} width={520} selection={selection} onEmit={vi.fn()} />);
    expect(withIt.container.innerHTML).toBe(withoutSelection);
  });
});

describe('VizLine — a run over NUMBERS emits numbers: the numeric brush', () => {
  /**
   * THE DEFECT, measured on a real page: two line charts over a residue-number axis invited a drag.
   * The brush DREW, the gesture FIRED, and nothing happened — 162 marks before the drag and 162
   * after, the session's refusal ledger climbing once per drag. The chart positioned every run
   * through `epochOf` and snapped each endpoint to the nearest data DATE, so a numeric column was
   * handed date-shaped STRINGS it can never answer.
   *
   * TWO EARLIER BRIEFS SAID THE CAUSE WAS A BAND X. It was not, and the band brush built on that
   * reading (`describe` above) never addressed this. Recorded here because a wrong recorded cause is
   * worse than none.
   */
  const PLOT_L = 52;
  const PLOT_R = 18;
  /** 5 residues, 10 apart: the plot spans [100, 140] over 52…502, so one unit is 11.25 viewBox units. */
  const RESNUM = [100, 110, 120, 130, 140].map((at) => ({ at, value: at / 10 }));
  /** The pixel a value sits at on that axis — the SAME arithmetic the dots are drawn by. */
  const at520 = (v: number): number => PLOT_L + ((520 - PLOT_L - PLOT_R) / 40) * (v - 100);
  const drag = (container: HTMLElement, from: number, to: number): void => {
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: from, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: to, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: to, pointerId: 1 });
  };

  it('THE BOUNDS ARE THE AXIS’S, NOT THE MARKS’: the emitted interval is the span the pointer covered, in numbers, un-snapped', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" onEmit={onEmit} />);
    // 97 → 232 inverts to exactly 104 → 116: NEITHER is a data value, and that is the point — the
    // date arm snaps because its rail is strings, and a number needs no such protection
    drag(container, 97, 232);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: [104, 116], encoding: { kind: 'interval', field: 'resnum' } });
    // the bounds are NUMBERS, not the strings a date rail carries — the whole defect in one assertion
    const [lo, hi] = onEmit.mock.calls[0]![0].rawValue as [unknown, unknown];
    expect(typeof lo).toBe('number');
    expect(typeof hi).toBe('number');
  });

  it('ONE VALUE COVERED is a selection: the span that reached exactly one mark still emits its own span', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" onEmit={onEmit} />);
    // 160 → 170 sits around the mark at 110 (164.5) and reaches no other
    drag(container, 160, 170);
    const [lo, hi] = onEmit.mock.calls[0]![0].rawValue as [number, number];
    expect(lo).toBeLessThan(110);
    expect(hi).toBeGreaterThan(110);
    expect(hi).toBeLessThan(120);
  });

  it('EMPTY IS AN ANSWER: a span that covers no value emits NOTHING and says so — never a clause no row can answer', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" onEmit={onEmit} />);
    // 170 → 270 lies between the marks at 110 (164.5) and 120 (277)
    drag(container, 170, 270);
    expect(onEmit).not.toHaveBeenCalled();
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
    // …and the reader is told, in the library's one polite live region — the band arm's SHAPE, a run's own WORDS
    expect(document.querySelector('.vzf-live-region')!.textContent!.trim()).toBe(noValuesCoveredNote());
    expect(noValuesCoveredNote()).toBe('a drag selects the values its span covers — this one covered none, so nothing was selected');
  });

  it('ORDER IS THE AXIS’S: a right-to-left drag and a left-to-right one over the same span are ONE selection', () => {
    const leftToRight = vi.fn();
    const rightToLeft = vi.fn();
    const a = render(<VizLine data={RESNUM} width={520} dateField="resnum" onEmit={leftToRight} />);
    drag(a.container, 97, 232);
    cleanup();
    const b = render(<VizLine data={RESNUM} width={520} dateField="resnum" onEmit={rightToLeft} />);
    drag(b.container, 232, 97);
    expect(rightToLeft.mock.calls[0]![0]).toEqual(leftToRight.mock.calls[0]![0]);
    expect(rightToLeft.mock.calls[0]![0].rawValue).toEqual([104, 116]);
  });

  it('THE ROUND TRIP: what the chart emits, the read door accepts, and the chart draws as its OWN live selection in the same range', () => {
    const onEmit = vi.fn();
    const { container, rerender } = render(<VizLine viewId="line" data={RESNUM} width={520} dateField="resnum" onEmit={onEmit} />);
    drag(container, 97, 232);
    const emission = onEmit.mock.calls[0]![0] as { rawValue: unknown; encoding: { kind: string; field: string } };
    // the session's fold of that emission, read back through the contract's OWN door
    const selection = selectionForView([{ viewId: 'line', field: emission.encoding.field, kind: 'interval', value: emission.rawValue }], 'line');
    rerender(<VizLine viewId="line" data={RESNUM} width={520} dateField="resnum" selection={selection} onEmit={onEmit} />);
    const outlined = [...container.querySelectorAll('circle.vzf-line-dot.vzf-selected')].map((d) => Number(d.getAttribute('cx')));
    // the one mark inside [104, 116] is the one at 110 — drawn where it has always been drawn
    expect(outlined).toEqual([at520(110)]);
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(5);
  });

  it('AN OPEN SIDE claims everything on it, and a STRING bound claims nothing (no cross-type coercion, the read door’s own law)', () => {
    const open = selectionForView([{ viewId: 'line', field: 'resnum', kind: 'interval', value: [null, 115] }], 'line');
    const a = render(<VizLine viewId="line" data={RESNUM} width={520} dateField="resnum" selection={open} onEmit={vi.fn()} />);
    expect(a.container.querySelectorAll('circle.vzf-line-dot.vzf-selected')).toHaveLength(2); // 100 and 110
    cleanup();
    // an ISO interval landed on a NUMERIC axis outlines nothing: no row of it could be kept either
    const crossType = selectionForView([{ viewId: 'line', field: 'resnum', kind: 'interval', value: ['2026-01-01', '2026-12-31'] }], 'line');
    const b = render(<VizLine viewId="line" data={RESNUM} width={520} dateField="resnum" selection={crossType} onEmit={vi.fn()} />);
    expect(b.container.querySelectorAll('circle.vzf-line-dot.vzf-selected')).toHaveLength(0);
  });

  it('A TAP CLEARS, exactly as on a run of dates — a run has no tiled slot for a press to land in', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 201, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'resnum' } });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
  });

  it('A DECLARED AXIS is the one the bounds come from — a drag reads the frame’s domain, not the marks’ extent', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" domain={{ x: [0, 1000] }} onEmit={onEmit} />);
    // on [0, 1000] over 52…502 one unit is 0.45: 97 → 322 inverts to exactly 100 → 600
    drag(container, 97, 322);
    expect(onEmit.mock.calls[0]![0].rawValue).toEqual([100, 600]);
  });

  it('A DECLARED AXIS DRAGGED BEYOND EVERY MARK emits nothing and says so — a clause that silently moved to a distant mark is a clause the reader did not make', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" domain={{ x: [0, 1000] }} onEmit={onEmit} />);
    // every mark sits below 140 ⇒ below pixel 115; this drag lives out at 551…773 on the axis
    drag(container, 300, 400);
    expect(onEmit).not.toHaveBeenCalled();
    expect(document.querySelector('.vzf-live-region')!.textContent!.trim()).toBe(noValuesCoveredNote());
  });

  it('THE REGRESSION THAT STARTED THIS: residue-shaped numbers are DRAWN, in order, and land a numeric clause', () => {
    // what the old date arm did to these six residues, pinned so nobody rebuilds it: two of them
    // cannot be parsed at all (silently dropped), and the rest are re-ordered into calendar years
    expect(Number.isNaN(Date.parse('13'))).toBe(true);
    expect(Number.isNaN(Date.parse('31'))).toBe(true);
    expect(Date.parse('107')).toBeLessThan(Date.parse('99')); // residue 107 was drawn LEFT of residue 99
    const onEmit = vi.fn();
    const residues = [1, 13, 31, 99, 107, 241];
    const data = residues.map((at) => ({ at, value: at }));
    const { container } = render(<VizLine data={data} width={520} dateField="resnum" onEmit={onEmit} />);
    // every residue is drawn — none dropped (the old arm drew four of the six) …
    const cx = [...container.querySelectorAll('circle.vzf-line-dot')].map((d) => Number(d.getAttribute('cx')));
    expect(cx).toHaveLength(6);
    // … and in the AXIS's order, ascending in the residue number
    expect([...cx].sort((a, b) => a - b)).toEqual(cx);
    drag(container, 100, 400);
    const [lo, hi] = onEmit.mock.calls[0]![0].rawValue as [number, number];
    expect(typeof lo).toBe('number');
    expect(lo).toBeGreaterThan(1);
    expect(hi).toBeLessThan(241);
  });

  it('A NUMBER THE AXIS CANNOT PLACE is skipped and never guessed — the date arm’s own law, through one reader', () => {
    const { container } = render(<VizLine data={[{ at: 100, value: 1 }, { at: Number.NaN, value: 2 }, { at: Number.POSITIVE_INFINITY, value: 3 }, { at: 120, value: 4 }]} width={520} dateField="resnum" onEmit={vi.fn()} />);
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
  });

  it('THE NAVIGATE WINDOW is read in the axis’s own quantity, and a bound it cannot read leaves that side OPEN', () => {
    const inside = render(<VizLine data={RESNUM} width={520} dateField="resnum" xDomain={[110, 130]} onEmit={vi.fn()} />);
    expect(inside.container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(3);
    cleanup();
    // an ISO string is not this axis's quantity: that side is open, exactly as an unparseable date has always been
    const open = render(<VizLine data={RESNUM} width={520} dateField="resnum" xDomain={['2026-01-01', 120]} onEmit={vi.fn()} />);
    expect(open.container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(3);
  });

  it('A NUMBER HANDED A BAND ORDER is a SLOT named by its number — a declared band outvotes the points’ own quantity', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={RESNUM} width={520} dateField="resnum" domain={{ categories: ['100', '110', '120', '130', '140'] }} onEmit={onEmit} />);
    // the band's tick labels are the numbers' own text, and a drag lands the MATCH a band speaks
    expect([...container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent)).toContain('110');
    drag(container, 100, 300);
    expect(onEmit.mock.calls[0]![0].encoding.kind).toBe('match');
  });

  it('BYTE IDENTITY, THE DATE ARM: a run of dates handed its OWN live interval draws exactly the markup it draws with none — the read-back is the numeric arm’s alone', () => {
    const dated = [
      { date: '2026-04-01', value: 1 },
      { date: '2026-04-08', value: 2 },
      { date: '2026-04-15', value: 3 },
    ];
    const bare = render(<VizLine viewId="line" data={dated} width={520} onEmit={vi.fn()} />);
    const withoutSelection = bare.container.innerHTML;
    cleanup();
    const own = selectionForView([{ viewId: 'line', field: 'date', kind: 'interval', value: ['2026-04-01', '2026-04-08'] }], 'line');
    const withIt = render(<VizLine viewId="line" data={dated} width={520} selection={own} onEmit={vi.fn()} />);
    expect(withIt.container.innerHTML).toBe(withoutSelection);
  });

  it('BYTE IDENTITY, THE BAND ARM: an INTERVAL landed on a band’s field outlines nothing — a band reads its match, and the numeric read-back cannot leak into it', () => {
    const band = [
      { category: 'Formal', value: 4 },
      { category: 'Casual', value: 2 },
    ];
    const asInterval = selectionForView([{ viewId: 'line', field: 'shelf', kind: 'interval', value: [0, 10] }], 'line');
    const { container } = render(<VizLine viewId="line" data={band} width={520} dateField="shelf" selection={asInterval} onEmit={vi.fn()} />);
    expect(container.querySelectorAll('circle.vzf-line-dot.vzf-selected')).toHaveLength(0);
    expect(container.querySelectorAll('circle.vzf-line-dot')).toHaveLength(2);
  });
});

describe('VizLine — A SLOT IS A NAME FOR A VALUE: a band drawn over a column that is not text', () => {
  const PLOT_L = 52;
  const PLOT_R = 18;
  const centre = (index: number, count: number, width = 520): number => PLOT_L + ((width - PLOT_L - PLOT_R) / count) * index + (width - PLOT_L - PLOT_R) / count / 2;
  const drag = (container: HTMLElement, from: number, to: number): void => {
    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: from, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: to, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: to, pointerId: 1 });
  };

  /**
   * THE DEFECT, measured end to end on a real page. A reader dragged across a line drawn as a BAND
   * over a column of NUMBERS: the gesture reached the record and LANDED A COMMIT — 4 commits before
   * the drag and 5 after, the session's refused-requests panel unchanged at 3 — and it matched
   * NOTHING (185 marks in force before, 0 after; the companion bar chart 372 rects to 2). The clause
   * carried the slots' SPELLINGS (`["1","2"]`) against a column holding numbers, and the library is
   * right not to match them. A landed clause that kept nothing is worse than a refusal AND worse than
   * the dead gesture it replaced, because the record now claims the question was answered.
   *
   * A band's slots are named by `String(cell)` all the way down; the ROWS still hold the column's own
   * values, and the clause carries THOSE (`../primitives/slotValues.ts`, the one owner).
   */
  const NUMBERS = [
    { category: '1', cell: 1, value: 4 },
    { category: '2', cell: 2, value: 2 },
    { category: '3', cell: 3, value: 9 },
  ];
  /** The rows behind that band, as a provider holds them — `resnum` is a column of NUMBERS. */
  const ROWS = [{ resnum: 1, v: 4 }, { resnum: 2, v: 2 }, { resnum: 3, v: 9 }];

  it('THE DRAG lands the slots\' own VALUES — numbers, not their spelling', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={NUMBERS} width={520} dateField="resnum" onEmit={onEmit} />);
    drag(container, 100, 300);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: [1, 2] }, encoding: { kind: 'match', field: 'resnum' } });
  });

  it('THE TAP lands the slot\'s own value too — one owner, so a press and a drag cannot read one band two ways', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizLine data={NUMBERS} width={520} dateField="resnum" onEmit={onEmit} />);
    drag(container, 200, 202); // a sub-4px release inside the middle slot
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 2, encoding: { kind: 'point', field: 'resnum' } });
  });

  it('THE SAME CLAUSE AS THE BAR\'S for the same pixel, on a band of NUMBERS — byte-identical, tap and drag alike, because both ask the one owner', () => {
    const bars = NUMBERS.map((d) => ({ category: d.category, cell: d.cell, count: d.value }));
    // the TAP: the line's sub-4px release inside the middle slot …
    const fromLine = vi.fn();
    const line = render(<VizLine data={NUMBERS} width={520} dateField="resnum" onEmit={fromLine} />);
    drag(line.container, 300, 301);
    cleanup();
    // … and the BAR's own click on the bar that stands in that slot
    const fromBar = vi.fn();
    const bar = render(<VizBar data={bars} field="resnum" width={520} onEmit={fromBar} />);
    fireEvent.click(bar.container.querySelectorAll('rect.vzf-mark-hit')[1]!);
    expect(JSON.stringify(fromBar.mock.calls[0]![0])).toBe(JSON.stringify(fromLine.mock.calls[0]![0]));
    cleanup();
    // the DRAG: the line's brush across two slots, and the bar's drag-run over the same two
    const dragLine = vi.fn();
    const line2 = render(<VizLine data={NUMBERS} width={520} dateField="resnum" onEmit={dragLine} />);
    drag(line2.container, 100, 300);
    cleanup();
    const dragBar = vi.fn();
    const bar2 = render(<VizBar data={bars} field="resnum" width={520} onEmit={dragBar} />);
    const svg = bar2.container.querySelector('svg.vzf-bar')!;
    fireEvent.pointerDown(bar2.container.querySelectorAll('rect.vzf-barrect')[0]!, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, pointerId: 1 });
    expect(JSON.stringify(dragBar.mock.calls[0]![0])).toBe(JSON.stringify(dragLine.mock.calls[0]![0]));
  });

  it('THE ROUND TRIP, and the ROW COUNT is the assertion: the emission goes through the real read door, the rows narrow to exactly the covered slots, and the chart outlines them', () => {
    const onEmit = vi.fn();
    const { container, rerender } = render(<VizLine data={NUMBERS} width={520} dateField="resnum" onEmit={onEmit} />);
    // before: every row is kept
    expect(ROWS.length).toBe(3);
    drag(container, 100, 300);
    const emission = onEmit.mock.calls[0]![0] as { rawValue: unknown; encoding: { kind: 'match'; field: string } };
    // THE ROWS THE LANDED CLAUSE ACTUALLY KEEPS — the library's own reading of the wire, compiled by
    // the contract tier. A test that stopped at "something was emitted" is how this survived.
    const keeps = clausePredicate('match', emission.encoding.field, emission.rawValue);
    expect(ROWS.filter(keeps).map((r) => r.resnum)).toEqual([1, 2]);
    // …and the chart outlines the same two slots off the fold of that very clause
    const selection = selectionForView([{ viewId: 'line', field: emission.encoding.field, kind: 'match', value: emission.rawValue }], 'line');
    rerender(<VizLine viewId="line" data={NUMBERS} width={520} dateField="resnum" selection={selection} onEmit={onEmit} />);
    const outlined = [...container.querySelectorAll('circle.vzf-line-dot.vzf-selected')].map((d) => Number(d.getAttribute('cx')));
    expect(outlined).toEqual([centre(0, 3), centre(1, 3)]);
  });

  it('WHAT THE DEFECT USED TO LAND kept nothing, and that is the whole packet in one assertion', () => {
    // the clause the chart emitted before this packet: the slots' spelling
    const spelled = clausePredicate('match', 'resnum', { values: ['1', '2'] });
    expect(ROWS.filter(spelled)).toEqual([]); // a commit on the record, 0 rows kept
    const valued = clausePredicate('match', 'resnum', { values: [1, 2] });
    expect(ROWS.filter(valued)).toHaveLength(2);
  });

  it('A BOOLEAN column is the same law with no declaration disagreeing anywhere — `true`, never `"true"`', () => {
    const onEmit = vi.fn();
    const data = [{ category: 'true', cell: true, value: 3 }, { category: 'false', cell: false, value: 1 }];
    const { container } = render(<VizLine data={data} width={520} dateField="inStock" onEmit={onEmit} />);
    drag(container, 60, 300);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: [true] }, encoding: { kind: 'match', field: 'inStock' } });
    const keeps = clausePredicate('match', 'inStock', { values: [true] });
    expect([{ inStock: true }, { inStock: false }].filter(keeps)).toEqual([{ inStock: true }]);
  });

  it('A NAME THE ROWS DO NOT REACH IS SKIPPED, never guessed — a frame may declare a category these rows do not hold', () => {
    const onEmit = vi.fn();
    // the frame declares four slots; the rows reach three of them
    const { container } = render(<VizLine data={NUMBERS} width={520} dateField="resnum" domain={{ categories: ['1', '2', '9', '3'] }} onEmit={onEmit} />);
    drag(container, 60, 460); // across all four slots — and "9" is a slot no row reaches
    const values = (onEmit.mock.calls[0]![0] as { rawValue: { values: unknown[] } }).rawValue.values;
    // the three the rows DO reach, in the band's order; "9" contributes nothing, because inventing a
    // value for it (the number 9? the string "9"?) would be a clause the reader did not make
    expect(values).toEqual([1, 2, 3]);
  });

  it('EVERY NAME SKIPPED ⇒ NOTHING, said out loud — never an empty keep-list, which is the sharpest failure there is', () => {
    const onEmit = vi.fn();
    // four declared slots, and the rows reach only the first; the drag crosses the last two
    const data = [{ category: '1', cell: 1, value: 4 }];
    const { container } = render(<VizLine data={data} width={520} dateField="resnum" domain={{ categories: ['1', '7', '8', '9'] }} onEmit={onEmit} />);
    drag(container, 300, 460);
    expect(onEmit).not.toHaveBeenCalled();
    expect(document.querySelector('.vzf-live-region')!.textContent!.trim()).toBe(noSlotValuesNote());
  });

  it('A SLOT NAMING TWO VALUES: the drag takes both (a match is a set), the PRESS refuses it by name and points at the gesture that can', () => {
    const mixed = [
      { category: '1', cell: 1, value: 4 },
      { category: '1', cell: '1', value: 6 },
      { category: '2', cell: 2, value: 2 },
    ];
    const onEmit = vi.fn();
    const a = render(<VizLine data={mixed} width={520} dateField="resnum" onEmit={onEmit} />);
    drag(a.container, 60, 200); // the first slot of two
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: { values: [1, '1'] }, encoding: { kind: 'match', field: 'resnum' } });
    // both rows the slot drew are kept — the mark the reader dragged over was one mark over two rows
    const keeps = clausePredicate('match', 'resnum', { values: [1, '1'] });
    expect([{ resnum: 1 }, { resnum: '1' }, { resnum: 2 }].filter(keeps)).toHaveLength(2);
    cleanup();
    // …and a PRESS lands nothing: a point addresses ONE value, and half the mark is the same lie smaller
    const pressed = vi.fn();
    const b = render(<VizLine data={mixed} width={520} dateField="resnum" onEmit={pressed} />);
    drag(b.container, 100, 102);
    expect(pressed).not.toHaveBeenCalled();
    expect(document.querySelector('.vzf-live-region')!.textContent!.trim()).toBe(ambiguousSlotNote('1', [1, '1']));
  });

  it('BYTE IDENTITY: a band over a STRING column is untouched — drag, tap and the empty slots a drag rides over', () => {
    const strings = [
      { category: 'Formal', cell: 'Formal', value: 4 },
      { category: 'Casual', cell: 'Casual', value: 2 },
      { category: 'Party', cell: 'Party', value: 9 },
    ];
    const withCell = vi.fn();
    const a = render(<VizLine data={strings} width={520} dateField="shelf" onEmit={withCell} />);
    drag(a.container, 100, 300);
    cleanup();
    // …the same chart, given no cells at all (a host that never heard of them)
    const withoutCell = vi.fn();
    const b = render(<VizLine data={strings.map(({ category, value }) => ({ category, value }))} width={520} dateField="shelf" onEmit={withoutCell} />);
    drag(b.container, 100, 300);
    expect(JSON.stringify(withCell.mock.calls[0]![0])).toBe(JSON.stringify(withoutCell.mock.calls[0]![0]));
    expect(withCell.mock.calls[0]![0]).toEqual({ rawValue: { values: ['Formal', 'Casual'] }, encoding: { kind: 'match', field: 'shelf' } });
    cleanup();
    // …and a slot the frame declared that no row reaches STILL rides along on a name band (`VizBar` ·
    // `endRun`'s own law): on a name band there is nothing to guess, because the name IS the value
    const declared = vi.fn();
    const c = render(<VizLine data={strings} width={520} dateField="shelf" domain={{ categories: ['Formal', 'Smart', 'Casual', 'Party'] }} onEmit={declared} />);
    drag(c.container, 60, 300); // four slots of 112.5: the centres at 108 and 221 are crossed
    expect((declared.mock.calls[0]![0] as { rawValue: { values: unknown[] } }).rawValue.values).toEqual(['Formal', 'Smart']);
  });
});
