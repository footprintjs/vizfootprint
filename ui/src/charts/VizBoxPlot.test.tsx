// @vitest-environment jsdom
/**
 * `<VizBoxPlot>` — composed from the public primitives tier: host-summarized
 * quartiles/whiskers/outliers render per category; a category click emits the
 * point selection (`togglePointEmission`), click-again clears — both derived
 * from the addressable fold (`selfSelectedValue`), never local state;
 * outliers are individually hoverable but NOT separately selectable (v1
 * honest scope); both axis labels re-encode (x category, y numeric/date);
 * date statistics ride the ISO rail.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { VizBoxPlot, type BoxPlotDatum } from './VizBoxPlot.js';
import { selectionForView } from '../contract/selection.js';
import type { ChartEmission } from 'vizfootprint/mosaic';
import type { ColumnView, SelectionView } from '../adapter/types.js';

afterEach(cleanup);

// three host summaries — one with a single outlier, one clean, one with two outliers
const BOXES: BoxPlotDatum[] = [
  { category: 'Casual', q1: 20, median: 30, q3: 45, whiskerLo: 10, whiskerHi: 60, outliers: [95], count: 12 },
  { category: 'Formal', q1: 40, median: 55, q3: 70, whiskerLo: 25, whiskerHi: 90, outliers: [], count: 8 },
  { category: 'Party', q1: 15, median: 22, q3: 30, whiskerLo: 5, whiskerHi: 38, outliers: [2, 99], count: 10 },
];

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'date', type: 'date' },
  { field: 'category', type: 'string' },
  { field: 'inStock', type: 'boolean' },
];

function ownSelection(value: unknown): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [{ viewId: 'boxplot', field: 'category', kind: 'point', value }];
  return selectionForView(rows, 'boxplot');
}

function renderBoxPlot(over: Partial<Parameters<typeof VizBoxPlot>[0]> = {}) {
  const onEmit = vi.fn<(e: ChartEmission) => void>();
  const utils = render(
    <VizBoxPlot viewId="boxplot" data={BOXES} xField="category" yField="price" columns={COLS} onEmit={onEmit} {...over} />,
  );
  return { onEmit, ...utils };
}

describe('rendering — host-summarized boxes, whiskers, outliers', () => {
  it('draws one box + hit column per category, all decorative marks aria-hidden', () => {
    const { container } = renderBoxPlot();
    expect(container.querySelectorAll('rect.vzf-box')).toHaveLength(3);
    expect(container.querySelectorAll('rect.vzf-box-hit')).toHaveLength(3);
    expect(container.querySelector('rect.vzf-box')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('line.vzf-box-median')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('line.vzf-box-whisker')).toHaveLength(6); // 2 per box
    expect(container.querySelectorAll('line.vzf-box-cap')).toHaveLength(6);
    const text = container.textContent ?? '';
    expect(text).toContain('Casual');
    expect(text).toContain('Formal');
    expect(text).toContain('Party');
  });

  it('renders exactly the PLACEABLE outliers, individually — 3 across the fixture (1 + 0 + 2)', () => {
    const { container } = renderBoxPlot();
    expect(container.querySelectorAll('circle.vzf-box-outlier')).toHaveLength(3);
    const first = container.querySelectorAll('circle.vzf-box-outlier')[0]!;
    expect(first.querySelector('title')!.textContent).toContain('Casual outlier');
    expect(first.querySelector('title')!.textContent).toContain('95');
    expect(first.getAttribute('aria-label')).toContain('Casual outlier');
  });

  it('an outlier is hoverable but NOT selectable: no role/tabindex, and clicking it never emits', () => {
    const { container, onEmit } = renderBoxPlot();
    const outlier = container.querySelector('circle.vzf-box-outlier')!;
    expect(outlier.getAttribute('role')).toBeNull();
    expect(outlier.getAttribute('tabindex')).toBeNull();
    fireEvent.click(outlier);
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('a custom className rides the svg (the shared chart-class contract)', () => {
    const { container } = renderBoxPlot({ className: 'my-box' });
    expect(container.querySelector('svg.vzf-boxplot.my-box')).not.toBeNull();
  });

  it('category labels are width-aware: a moderately squeezed cell truncates with an ellipsis (full name stays on the hit column)', () => {
    // 3 categories at width 130: band = (130 - 48 - 16) / 3 = 22 → maxWhole=3
    // (all three names exceed it), one glyph reserved for the ellipsis → 2
    // real characters survive per label
    const { container } = renderBoxPlot({ width: 130 });
    const labels = [...container.querySelectorAll('text.vzf-box-catlabel')].map((t) => t.textContent);
    expect(labels).toEqual(['Ca…', 'Fo…', 'Pa…']);
    expect(labels).not.toContain('Casual');
    // the full name is never lost — it rides the hit column's own aria-label
    expect(container.querySelector('[data-box="Casual"]')!.getAttribute('aria-label')).toContain('category Casual');
    // a roomy cell shows the full, untouched category names
    const { container: wide } = renderBoxPlot({ width: 420 });
    expect([...wide.querySelectorAll('text.vzf-box-catlabel')].map((t) => t.textContent)).toEqual(['Casual', 'Formal', 'Party']);
  });

  it('category labels go honestly BLANK (never a colliding fragment) when a band is too tight for even one character', () => {
    // 3 categories at width 90: band ≈ 8.67 → maxWhole floors to 0, so even a
    // single character plus the ellipsis would overflow the band — blank wins
    const { container } = renderBoxPlot({ width: 90 });
    const labels = [...container.querySelectorAll('text.vzf-box-catlabel')].map((t) => t.textContent);
    expect(labels).toEqual(['', '', '']);
    // the boxes themselves still render — only the label is honestly withheld
    expect(container.querySelectorAll('rect.vzf-box')).toHaveLength(3);
    // the full name is still never lost — it rides the hit column's own aria-label
    expect(container.querySelector('[data-box="Casual"]')!.getAttribute('aria-label')).toContain('category Casual');
  });

  it('empty data renders an empty (but framed) plot — nothing fabricated', () => {
    const { container } = renderBoxPlot({ data: [] });
    expect(container.querySelectorAll('rect.vzf-box')).toHaveLength(0);
    expect(container.querySelector('svg.vzf-boxplot')).not.toBeNull();
  });

  it('a category whose core statistics cannot be placed is skipped ENTIRELY (never guessed)', () => {
    const junk: BoxPlotDatum[] = [
      { category: 'Junk', q1: 'not-a-date', median: 'also-not', q3: 'nope', whiskerLo: 'no', whiskerHi: 'no', outliers: [], count: 3 },
      { category: 'Formal', q1: 40, median: 55, q3: 70, whiskerLo: 25, whiskerHi: 90, outliers: [], count: 8 },
    ];
    const { container } = renderBoxPlot({ data: junk });
    expect(container.querySelectorAll('rect.vzf-box')).toHaveLength(1);
    expect(container.textContent).toContain('Formal');
    expect(container.textContent).not.toContain('Junk');
  });

  it('an unplaceable outlier is skipped individually — the rest of that box still renders', () => {
    const withJunkOutlier: BoxPlotDatum[] = [
      { category: 'Casual', q1: 20, median: 30, q3: 45, whiskerLo: 10, whiskerHi: 60, outliers: [95, 'not-a-date'], count: 13 },
    ];
    const { container } = renderBoxPlot({ data: withJunkOutlier });
    expect(container.querySelectorAll('rect.vzf-box')).toHaveLength(1);
    expect(container.querySelectorAll('circle.vzf-box-outlier')).toHaveLength(1); // only the real one placed
  });

  it('ISO-date statistics position by epoch and the y ticks read back as dates', () => {
    const dateBoxes: BoxPlotDatum[] = [
      {
        category: 'Casual',
        q1: '2026-04-03',
        median: '2026-04-05',
        q3: '2026-04-07',
        whiskerLo: '2026-04-01',
        whiskerHi: '2026-04-09',
        outliers: ['2026-05-01'],
        count: 5,
      },
    ];
    const { container } = renderBoxPlot({ data: dateBoxes, yField: 'date' });
    expect(container.querySelectorAll('rect.vzf-box')).toHaveLength(1);
    const ticks = [...container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent ?? '');
    expect(ticks.some((t) => /^\d{4}-\d{2}-\d{2}$/.test(t))).toBe(true); // at least one y tick prints a real ISO day
  });
});

describe('the point gesture — category select, click-again clears', () => {
  it('a box click emits the point selection on xField', () => {
    const { container, onEmit } = renderBoxPlot();
    fireEvent.click(container.querySelector('[data-box="Casual"]')!);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Casual', encoding: { kind: 'point', field: 'category' } });
  });

  it('the selected category (from the fold, not local state) wears the outline; clicking it AGAIN clears', () => {
    const { container, onEmit } = renderBoxPlot({ selection: ownSelection('Casual') });
    const hit = container.querySelector('[data-box="Casual"]')!;
    expect(hit.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-box="Casual"]')!.previousSibling); // sanity: hit rect exists among box marks
    const box = container.querySelectorAll('rect.vzf-box')[0]!;
    expect(box.getAttribute('class') ?? '').toContain('vzf-selected');
    fireEvent.click(hit);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: undefined, encoding: { kind: 'point', field: 'category' } });
  });

  it('clicking a DIFFERENT category while one is selected selects the new one (last-wins, no clear)', () => {
    const { container, onEmit } = renderBoxPlot({ selection: ownSelection('Casual') });
    fireEvent.click(container.querySelector('[data-box="Formal"]')!);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Formal', encoding: { kind: 'point', field: 'category' } });
  });

  it('an explicit `selected` prop wins over the fold', () => {
    const { container } = renderBoxPlot({ selected: 'Party', selection: ownSelection('Casual') });
    expect(container.querySelector('[data-box="Party"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-box="Casual"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('boxes are keyboard-actionable: focusable, Enter selects (the shared keyActivates)', () => {
    const { container, onEmit } = renderBoxPlot();
    const hit = container.querySelector('[data-box="Formal"]')!;
    expect(hit.getAttribute('role')).toBe('button');
    expect(hit.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(hit, { key: 'Enter' });
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: 'Formal', encoding: { kind: 'point', field: 'category' } });
  });

  it('no onEmit handler → a click is a safe no-op (display-only mount)', () => {
    const { container } = renderBoxPlot({ onEmit: undefined });
    expect(() => fireEvent.click(container.querySelector('[data-box="Casual"]')!)).not.toThrow();
  });
});

describe('the re-encode affordances — both axes, honestly restricted', () => {
  it('x axis: string/number columns encode; date is disabled with the category reason', () => {
    const { container } = renderBoxPlot();
    fireEvent.click(container.querySelector('[data-axis-channel="x"]')!);
    const dateOption = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="date"]') as HTMLButtonElement;
    expect(dateOption.disabled).toBe(true);
    expect(dateOption.title).toContain('category (string) or numeric');
    const priceOption = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="price"]') as HTMLButtonElement;
    expect(priceOption.disabled).toBe(false);
  });

  it('y axis: numeric/date columns encode; a string column is disabled with the numeric/date reason', () => {
    const onReencode = vi.fn();
    const { container } = renderBoxPlot({ onReencode });
    fireEvent.click(container.querySelector('[data-axis-channel="y"]')!);
    const catOption = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="category"]') as HTMLButtonElement;
    expect(catOption.disabled).toBe(true);
    expect(catOption.title).toContain('numeric or date');
    // picking price fires the reencode verb through the chart's callback
    fireEvent.click(document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="price"]')!);
    expect(onReencode).toHaveBeenCalledWith('boxplot', 'y', 'price');
  });

  it('contract mode: an axis click asks the HOST (reencodeRequest) and the built-in picker never opens', () => {
    const onReencodeRequest = vi.fn();
    const { container } = renderBoxPlot({ onReencodeRequest });
    fireEvent.click(container.querySelector('[data-axis-channel="y"]')!);
    expect(onReencodeRequest).toHaveBeenCalledWith('y');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('the accessible name (the prose plane\'s altShort)', () => {
  it('takes ariaLabel over its own construction line', () => {
    const { container } = renderBoxPlot({ ariaLabel: 'Cases by report state' });
    expect(container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Cases by report state'); // a group: its marks are buttons, and must stay reachable
  });
});
