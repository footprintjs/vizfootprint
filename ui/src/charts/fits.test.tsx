// @vitest-environment jsdom
/**
 * The encoding plane in the charts: when the wire carries `fits`, the built-in
 * picker greys a column with the SESSION's sentence; a column the verdicts do
 * not name falls back to the chart-side rule.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EncodingPicker } from './EncodingPicker.js';
import { VizBar } from './VizBar.js';
import { VizLine } from './VizLine.js';
import { VizScatter } from './VizScatter.js';
import { VizHistogram } from './VizHistogram.js';
import { VizHeatmap } from './VizHeatmap.js';
import { VizBoxPlot } from './VizBoxPlot.js';
import type { ColumnView, FitView } from '../adapter/types.js';

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'category', type: 'string' },
  { field: 'ghost', type: 'string' },
  { field: 'extra', type: 'string' },
];
const VERDICTS: FitView[] = [
  { field: 'price', ok: true },
  { field: 'category', ok: false, because: 'the house says no' },
  { field: 'ghost', ok: false },
];
const FITS = { x: VERDICTS, y: VERDICTS, category: VERDICTS, color: VERDICTS };

afterEach(cleanup);

describe('EncodingPicker with fits', () => {
  it('greys with the session sentence, says "does not fit" when the verdict has none, and disables a column the verdicts do not name', () => {
    render(<EncodingPicker open viewId="v" channel="x" columns={COLS} fits={FITS} onReencode={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('the house says no')).toBeTruthy();
    expect(screen.getByText('does not fit')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^price/ }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('the session does not know a column "extra"')).toBeTruthy();
  });
  it('a channel the verdicts do not cover disables everything with a reason; no verdicts at all fall back to the chart rule', () => {
    render(<EncodingPicker open viewId="v" channel="size" columns={COLS} fits={FITS} onReencode={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByText('the session did not judge a "size" channel for this view')).toHaveLength(COLS.length);
    cleanup();
    render(<EncodingPicker open viewId="v" channel="x" columns={COLS} onReencode={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/x needs a numeric or date column — "extra" is string/)).toBeTruthy();
  });
});

describe('every re-encodable chart hands the channel verdicts to its picker', () => {
  const opens = (name: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByText('the house says no')).toBeTruthy();
  };
  it('VizBar', () => {
    render(<VizBar viewId="bar" data={[]} field="category" columns={COLS} fits={FITS} />);
    opens(/Encode the category axis/);
  });
  it('VizScatter', () => {
    render(<VizScatter viewId="s" data={[]} xField="price" yField="price" columns={COLS} fits={FITS} />);
    opens(/Encode the x axis/);
  });
  it('VizLine', () => {
    render(<VizLine viewId="l" data={[{ date: '2026-01-01', value: 1 }]} dateField="date" valueField="value" columns={COLS} fits={FITS} width={400} />);
    opens(/Encode the y axis/);
  });
  it('VizHistogram', () => {
    render(<VizHistogram viewId="h" data={[]} field="price" columns={COLS} fits={FITS} />);
    opens(/Encode the x axis/);
  });
  it('VizHeatmap', () => {
    render(<VizHeatmap viewId="hm" data={[]} xField="price" yField="category" columns={COLS} fits={FITS} />);
    opens(/Encode the x axis/);
  });
  it('VizBoxPlot', () => {
    render(<VizBoxPlot viewId="bp" data={[]} xField="category" yField="price" columns={COLS} fits={FITS} />);
    opens(/Encode the x axis/);
  });
});
