// @vitest-environment jsdom
/**
 * `<VizHeatmap>` — the D30 compound-cell chart, composed from the public
 * primitives tier: host-computed 2-D cells render on the shared sequential
 * ramp (zero = the honest neutral, never step 1); a cell click emits ONE
 * cell emission carrying BOTH fields; clicking the selected cell again emits
 * the CLEARED cell — both derived from the addressable fold
 * (`selfSelectedCell`), never local state; cells are keyboard-actionable;
 * both axis labels re-encode (x numeric/date, y category/numeric); date
 * edges ride the ISO rail.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { VizHeatmap, type HeatmapCellDatum } from './VizHeatmap.js';
import { selectionForView } from '../contract/selection.js';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, SelectionView } from '../adapter/types.js';

afterEach(cleanup);

// two host buckets × two categories; one cell honestly empty
const CELLS: HeatmapCellDatum[] = [
  { x0: 0, x1: 50, y: 'Casual', count: 4 },
  { x0: 50, x1: 100, y: 'Casual', count: 0 },
  { x0: 0, x1: 50, y: 'Formal', count: 1 },
  { x0: 50, x1: 100, y: 'Formal', count: 9 },
];

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'date', type: 'date' },
  { field: 'category', type: 'string' },
  { field: 'inStock', type: 'boolean' },
];

function ownSelection(value: unknown): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [
    { viewId: 'heatmap', field: 'price × category', kind: 'cell', value, fields: ['price', 'category'] },
  ];
  return selectionForView(rows, 'heatmap');
}

function renderHeatmap(over: Partial<Parameters<typeof VizHeatmap>[0]> = {}) {
  const onEmit = vi.fn<(e: ChartEmission) => void>();
  const utils = render(
    <VizHeatmap viewId="heatmap" data={CELLS} xField="price" yField="category" columns={COLS} onEmit={onEmit} {...over} />,
  );
  return { onEmit, ...utils };
}

describe('rendering — host cells on the shared ramp, honest absence', () => {
  it('draws one rect per cell, colored by the shared seq ramp; row labels + edge ticks show', () => {
    const { container } = renderHeatmap();
    expect(container.querySelectorAll('rect.vzf-heatcell')).toHaveLength(4);
    // the max cell rides the top step; a small one a low step — both via the shared tokens
    const hot = container.querySelector('[data-cell="50|Formal"]')!;
    expect(hot.getAttribute('fill')).toBe('var(--vzf-seq-5)');
    const low = container.querySelector('[data-cell="0|Formal"]')!;
    expect(low.getAttribute('fill')).toBe('var(--vzf-seq-1)');
    // row headers + the bucket-edge ticks
    const text = container.textContent ?? '';
    expect(text).toContain('Casual');
    expect(text).toContain('Formal');
    expect(text).toContain('100'); // the final edge always labels
  });

  it('a ZERO-count cell wears the honest neutral (never ramp step 1) + the no-rows tooltip', () => {
    const { container } = renderHeatmap();
    const empty = container.querySelector('[data-cell="50|Casual"]')!;
    expect(empty.getAttribute('fill')).toBe('var(--vzf-map-empty)');
    expect(empty.getAttribute('class') ?? '').toContain('vzf-heatcell-empty');
    expect(empty.querySelector('title')!.textContent).toContain('no rows under the current selection');
  });

  it('an all-zero heatmap replaces the legend range with the honest absence line', () => {
    const { container } = renderHeatmap({ data: CELLS.map((c) => ({ ...c, count: 0 })) });
    expect(container.textContent).toContain('no rows under the current selection');
    // and still renders every (neutral) cell — dim, never hide
    expect(container.querySelectorAll('rect.vzf-heatcell-empty')).toHaveLength(4);
  });

  it('ISO-date x edges position by epoch and label by day (the shared date rail)', () => {
    const dateCells: HeatmapCellDatum[] = [
      { x0: '2026-05-01', x1: '2026-05-15', y: 'Casual', count: 2 },
      { x0: '2026-05-15', x1: '2026-05-29', y: 'Casual', count: 3 },
    ];
    const { container } = renderHeatmap({ data: dateCells, xField: 'date' });
    expect(container.querySelectorAll('rect.vzf-heatcell')).toHaveLength(2);
    expect(container.textContent).toContain('2026-05-29');
  });

  it('SPARSE host data: a missing (bucket, category) combination renders as the honest zero cell', () => {
    // three of the four combinations supplied — the grid still draws all four
    const sparse = CELLS.filter((c) => !(c.x0 === 50 && c.y === 'Formal'));
    const { container } = renderHeatmap({ data: sparse });
    expect(container.querySelectorAll('rect.vzf-heatcell')).toHaveLength(4);
    const missing = container.querySelector('[data-cell="50|Formal"]')!;
    expect(missing.getAttribute('fill')).toBe('var(--vzf-map-empty)');
  });

  it('a custom className rides the svg (the shared chart-class contract)', () => {
    const { container } = renderHeatmap({ className: 'my-heat' });
    expect(container.querySelector('svg.vzf-heatmap.my-heat')).not.toBeNull();
  });

  it('x edge ticks thin at a narrow width and a stepped label colliding with the final edge drops', () => {
    // 8 buckets at width 200 (the tight gutter): fit=3 → step=3 → the i=6
    // label sits within 44px of the final-edge label and is dropped (the
    // VizHistogram discipline)
    const many: HeatmapCellDatum[] = Array.from({ length: 8 }, (_, i) => ({
      x0: i * 10,
      x1: (i + 1) * 10,
      y: 'Casual',
      count: i + 1,
    }));
    const { container } = renderHeatmap({ data: many, width: 200 });
    const ticks = [...container.querySelectorAll('text.vzf-tick')].map((t) => t.textContent);
    expect(ticks).toContain('0'); // the first stepped edge
    expect(ticks).toContain('80'); // the final edge always shows
    expect(ticks).not.toContain('60'); // the collider (i=6) was dropped, not the final edge
  });

  it('a squeezed cockpit cell tightens the row-label gutter and truncates honestly (full name stays on the cell aria)', () => {
    const { container } = renderHeatmap({ width: 200 });
    const rowLabels = [...container.querySelectorAll('text.vzf-heat-row')].map((t) => t.textContent);
    expect(rowLabels).toContain('Casu…'); // truncated in the tight gutter
    expect(rowLabels).not.toContain('Casual');
    // the full name is never lost — it rides every cell's aria-label
    expect(container.querySelector('[data-cell="0|Casual"]')!.getAttribute('aria-label')).toContain('category Casual');
    // a roomy cell shows the full label
    const { container: wide } = renderHeatmap({ width: 420 });
    expect([...wide.querySelectorAll('text.vzf-heat-row')].map((t) => t.textContent)).toContain('Casual');
  });

  it('an unparseable date edge SKIPS its bucket (never guessed); empty data renders an empty plot', () => {
    const junk: HeatmapCellDatum[] = [
      { x0: 'not-a-date', x1: 'also-not', y: 'Casual', count: 2 },
      { x0: '2026-05-01', x1: '2026-05-15', y: 'Casual', count: 3 },
    ];
    const { container } = renderHeatmap({ data: junk, xField: 'date' });
    expect(container.querySelectorAll('rect.vzf-heatcell')).toHaveLength(1); // the junk bucket is gone
    const { container: empty } = renderHeatmap({ data: [] });
    expect(empty.querySelectorAll('rect.vzf-heatcell')).toHaveLength(0);
    expect(empty.querySelector('svg.vzf-heatmap')).not.toBeNull(); // frame + axes still draw
  });
});

describe('the D30 cell gesture — one click, one compound emission', () => {
  it('a cell click emits ONE cell emission carrying BOTH fields and the bucket interval', () => {
    const { container, onEmit } = renderHeatmap();
    fireEvent.click(container.querySelector('[data-cell="0|Casual"]')!);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]![0]).toEqual({
      rawValue: [[0, 50], 'Casual'],
      encoding: { kind: 'cell', fields: ['price', 'category'] },
    });
  });

  it('the selected cell (from the fold, not local state) wears the outline; clicking it AGAIN clears', () => {
    const { container, onEmit } = renderHeatmap({ selection: ownSelection([[0, 50], 'Casual']) });
    const selected = container.querySelector('[data-cell="0|Casual"]')!;
    expect(selected.getAttribute('class') ?? '').toContain('vzf-selected');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(selected);
    expect(onEmit.mock.calls[0]![0]).toEqual({ rawValue: null, encoding: { kind: 'cell', fields: ['price', 'category'] } });
  });

  it('clicking a DIFFERENT cell while one is selected selects the new cell (last-wins, no clear)', () => {
    const { container, onEmit } = renderHeatmap({ selection: ownSelection([[0, 50], 'Casual']) });
    fireEvent.click(container.querySelector('[data-cell="50|Formal"]')!);
    expect(onEmit.mock.calls[0]![0]).toEqual({
      rawValue: [[50, 100], 'Formal'],
      encoding: { kind: 'cell', fields: ['price', 'category'] },
    });
  });

  it('a date-edge cell emits the ISO string interval side (the honest string pair, no numeric cast)', () => {
    const dateCells: HeatmapCellDatum[] = [{ x0: '2026-05-01', x1: '2026-05-15', y: 'Casual', count: 2 }];
    const { container, onEmit } = renderHeatmap({ data: dateCells, xField: 'date' });
    fireEvent.click(container.querySelector('[data-cell="2026-05-01|Casual"]')!);
    expect(onEmit.mock.calls[0]![0]).toEqual({
      rawValue: [['2026-05-01', '2026-05-15'], 'Casual'],
      encoding: { kind: 'cell', fields: ['date', 'category'] },
    });
  });

  it('cells are keyboard-actionable: focusable, Enter selects (the shared keyActivates)', () => {
    const { container, onEmit } = renderHeatmap();
    const cell = container.querySelector('[data-cell="0|Formal"]')!;
    expect(cell.getAttribute('role')).toBe('button');
    expect(cell.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(onEmit.mock.calls[0]![0]).toEqual({
      rawValue: [[0, 50], 'Formal'],
      encoding: { kind: 'cell', fields: ['price', 'category'] },
    });
  });

  it('no onEmit handler → a click is a safe no-op (display-only mount)', () => {
    const { container } = renderHeatmap({ onEmit: undefined });
    expect(() => fireEvent.click(container.querySelector('[data-cell="0|Casual"]')!)).not.toThrow();
  });
});

describe('the re-encode affordances — both axes, honestly restricted', () => {
  it('x axis: the built-in picker disables a string column with the numeric/date reason', () => {
    const { container, getByText } = renderHeatmap();
    fireEvent.click(container.querySelector('[data-axis-channel="x"]')!);
    const catOption = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="category"]') as HTMLButtonElement;
    expect(catOption.disabled).toBe(true);
    expect(catOption.title).toContain('numeric or date');
    void getByText;
  });

  it('y axis: string and number columns encode; boolean/date are disabled with the category reason', () => {
    const onReencode = vi.fn();
    const { container } = renderHeatmap({ onReencode });
    fireEvent.click(container.querySelector('[data-axis-channel="y"]')!);
    const boolOption = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="inStock"]') as HTMLButtonElement;
    expect(boolOption.disabled).toBe(true);
    expect(boolOption.title).toContain('category (string) or numeric');
    const dateOption = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="date"]') as HTMLButtonElement;
    expect(dateOption.disabled).toBe(true);
    // picking category fires the reencode verb through the chart's callback
    fireEvent.click(document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="category"]')!);
    expect(onReencode).toHaveBeenCalledWith('heatmap', 'y', 'category');
  });

  it('contract mode: an axis click asks the HOST (reencodeRequest) and the built-in picker never opens', () => {
    const onReencodeRequest = vi.fn();
    const { container } = renderHeatmap({ onReencodeRequest });
    fireEvent.click(container.querySelector('[data-axis-channel="y"]')!);
    expect(onReencodeRequest).toHaveBeenCalledWith('y');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
