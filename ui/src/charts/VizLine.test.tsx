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
});
