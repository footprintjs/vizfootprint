// @vitest-environment jsdom
/**
 * THE STALE-AXIS REGRESSION (the bug this file pins).
 *
 * A chart is told which field a channel encodes TWICE: through its own
 * per-channel field prop (`field` / `xField` / `dateField` …) and through
 * `encoding`, the session's live channel→field map. When a person re-encodes
 * a channel, `encoding` moves; a host that still passes its original field
 * prop leaves the two disagreeing — and the chart used to answer differently
 * depending on which part of it you asked: the built-in picker read
 * `encoding`, while the axis label, the accessible name, the tooltips and the
 * EMITTED field read the stale prop. The axis said one field, the picker said
 * another, in the same chart, at the same moment.
 *
 * Every case below renders a chart with a STALE field prop beside a LIVE
 * `encoding` and asserts the one answer wins everywhere. Before the fix each
 * axis assertion failed (the label still read the stale prop).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { VizBar } from './VizBar.js';
import { VizLine } from './VizLine.js';
import { VizScatter } from './VizScatter.js';
import { VizHistogram } from './VizHistogram.js';
import { VizHeatmap } from './VizHeatmap.js';
import { VizBoxPlot } from './VizBoxPlot.js';
import { boundField } from './binding.js';

afterEach(cleanup);

/** The axis-label group's own accessible name — "Encode the x axis (currently price)". */
const axisName = (container: HTMLElement, channel: string): string =>
  container.querySelector(`[data-axis-channel="${channel}"]`)!.getAttribute('aria-label')!;

/** The visible axis-label text (the trailing ⤢ caret is decoration). */
const axisText = (container: HTMLElement, channel: string): string =>
  container.querySelector(`[data-axis-channel="${channel}"] .vzf-axis-label`)!.textContent!.replace('⤢', '');

describe('boundField — the one answer per channel', () => {
  it('takes the session binding when the channel has one', () => {
    expect(boundField({ x: 'price' }, 'x', 'value')).toBe('price');
  });

  it('falls back to the chart′s own field prop when the channel is unbound', () => {
    expect(boundField({ y: 'price' }, 'x', 'value')).toBe('value');
  });
});

describe('a re-encoded channel moves the axis (VizBar)', () => {
  const data = [
    { category: 'a', count: 4 },
    { category: 'b', count: 9 },
  ];

  it('the axis label, the accessible name and the emitted field all follow the encoding', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizBar data={data} field="report_state" encoding={{ category: 'flag' }} onEmit={onEmit} />);

    expect(axisText(container, 'category')).toBe('flag');
    expect(axisName(container, 'category')).toContain('currently flag');
    expect(container.querySelector('svg.vzf-bar')!.getAttribute('aria-label')).toBe('count by flag');

    fireEvent.click(screen.getByRole('button', { name: /select a/ }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'a', encoding: { kind: 'point', field: 'flag' } });
  });

  it('an explicit label still wins over both (the caller said the words)', () => {
    const { container } = render(<VizBar data={data} field="report_state" label="Silence" encoding={{ category: 'flag' }} />);
    expect(axisText(container, 'category')).toBe('Silence');
  });

  it('without an encoding map nothing changes — the field prop is the answer', () => {
    const { container } = render(<VizBar data={data} field="report_state" />);
    expect(axisText(container, 'category')).toBe('report_state');
  });
});

describe('a re-encoded channel moves the axis (VizLine)', () => {
  const data = [
    { date: '2025-01-01', value: 1 },
    { date: '2025-01-08', value: 3 },
  ];

  it('both axes follow the encoding, and the brush emits under the encoded x', () => {
    const onEmit = vi.fn();
    const { container } = render(
      <VizLine data={data} dateField="t" valueField="cases" encoding={{ x: 'week_start', y: 'ytd' }} onEmit={onEmit} width={400} height={300} />,
    );

    expect(axisText(container, 'x')).toBe('week_start');
    expect(axisText(container, 'y')).toBe('ytd');
    expect(container.querySelector('svg.vzf-line')!.getAttribute('aria-label')).toBe('ytd over week_start');
    expect(container.querySelector('circle.vzf-line-dot title')!.textContent).toContain('mean ytd');

    const svg = container.querySelector('svg.vzf-line')!;
    fireEvent.pointerDown(svg, { clientX: 60, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 100, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith(expect.objectContaining({ encoding: { kind: 'interval', field: 'week_start' } }));
  });

  it('an unbound channel keeps the chart′s own field prop', () => {
    const { container } = render(<VizLine data={data} dateField="t" valueField="cases" encoding={{ y: 'ytd' }} />);
    expect(axisText(container, 'x')).toBe('t');
    expect(axisText(container, 'y')).toBe('ytd');
  });
});

describe('a re-encoded channel moves the axis (VizScatter)', () => {
  const data = [
    { id: '1', x: 1, y: 2 },
    { id: '2', x: 8, y: 9 },
  ];

  it('both axes and the point tooltips follow the encoding', () => {
    const { container } = render(<VizScatter data={data} xField="price" yField="rating" encoding={{ x: 'ytd', y: 'prev52_max' }} />);
    expect(axisText(container, 'x')).toBe('ytd');
    expect(axisText(container, 'y')).toBe('prev52_max');
    expect(container.querySelector('svg.vzf-scatter')!.getAttribute('aria-label')).toBe('scatter of prev52_max against ytd');
    expect(container.querySelector('circle.vzf-dot title')!.textContent).toContain('ytd 1');
  });

  it('the brush emits under the encoded x field', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={data} xField="price" encoding={{ x: 'ytd' }} onEmit={onEmit} width={400} height={300} />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    fireEvent.pointerDown(svg, { clientX: 60, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 100, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith(expect.objectContaining({ encoding: { kind: 'interval', field: 'ytd' } }));
  });
});

describe('a re-encoded channel moves the axis (VizHistogram)', () => {
  const bins = [
    { x0: 0, x1: 10, count: 3 },
    { x0: 10, x1: 20, count: 5 },
  ];

  it('the axis, the accessible name and the bucket emission follow the encoding', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={bins} field="price" encoding={{ x: 'ytd' }} onEmit={onEmit} width={400} height={300} />);
    expect(axisText(container, 'x')).toBe('ytd');
    expect(container.querySelector('svg.vzf-histogram')!.getAttribute('aria-label')).toBe('histogram of ytd');
    expect(container.querySelector('rect.vzf-hist-hit')!.getAttribute('aria-label')).toContain('ytd ');

    fireEvent.keyDown(screen.getByRole('button', { name: 'ytd 0–10 (3 rows)' }), { key: 'Enter' });
    expect(onEmit).toHaveBeenCalledWith(expect.objectContaining({ encoding: { kind: 'interval', field: 'ytd' } }));
  });
});

describe('a re-encoded channel moves the axis (VizHeatmap)', () => {
  const cells = [
    { x0: 0, x1: 10, y: 'a', count: 3 },
    { x0: 10, x1: 20, y: 'b', count: 5 },
  ];

  it('both axes and the cell emission′s field PAIR follow the encoding', () => {
    const onEmit = vi.fn();
    const { container } = render(
      <VizHeatmap data={cells} xField="price" yField="category" encoding={{ x: 'ytd', y: 'kind' }} onEmit={onEmit} />,
    );
    expect(axisText(container, 'x')).toBe('ytd');
    expect(axisText(container, 'y')).toBe('kind');
    expect(container.querySelector('svg.vzf-heatmap')!.getAttribute('aria-label')).toBe('rows by ytd and kind');

    fireEvent.click(container.querySelector('rect.vzf-heatcell')!);
    expect(onEmit).toHaveBeenCalledWith(expect.objectContaining({ encoding: { kind: 'cell', fields: ['ytd', 'kind'] } }));
  });
});

describe('a re-encoded channel moves the axis (VizBoxPlot)', () => {
  const boxes = [{ category: 'a', q1: 1, median: 2, q3: 3, whiskerLo: 0, whiskerHi: 4, outliers: [], count: 7 }];

  it('both axes and the point emission follow the encoding', () => {
    const onEmit = vi.fn();
    const { container } = render(
      <VizBoxPlot data={boxes} xField="category" yField="value" encoding={{ x: 'kind', y: 'ytd' }} onEmit={onEmit} />,
    );
    expect(axisText(container, 'x')).toBe('kind');
    expect(axisText(container, 'y')).toBe('ytd');
    expect(container.querySelector('svg.vzf-boxplot')!.getAttribute('aria-label')).toBe('box plot of ytd by kind');

    fireEvent.click(screen.getByRole('button', { name: /kind a/ }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'a', encoding: { kind: 'point', field: 'kind' } });
  });
});

describe('the axis and the picker never disagree', () => {
  const cols = [
    { field: 'report_state', type: 'string' as const },
    { field: 'flag', type: 'string' as const },
  ];

  it('the picker highlights the same field the axis names', () => {
    const { container } = render(
      <VizBar data={[{ category: 'a', count: 1 }]} field="report_state" columns={cols} encoding={{ category: 'flag' }} />,
    );
    expect(axisText(container, 'category')).toBe('flag');
    fireEvent.click(container.querySelector('[data-axis-channel="category"]')!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /flag/ }).getAttribute('aria-current')).toBe('true');
    expect(within(dialog).getByRole('button', { name: /report_state/ }).getAttribute('aria-current')).toBeNull();
  });
});

describe('a chart with neither an encoding nor a field prop keeps its documented default', () => {
  it('VizHistogram falls back to "value"', () => {
    const { container } = render(<VizHistogram data={[{ x0: 0, x1: 10, count: 1 }]} />);
    expect(axisText(container, 'x')).toBe('value');
  });

  it('VizHeatmap falls back to "value" × "category"', () => {
    const { container } = render(<VizHeatmap data={[{ x0: 0, x1: 10, y: 'a', count: 1 }]} />);
    expect(axisText(container, 'x')).toBe('value');
    expect(axisText(container, 'y')).toBe('category');
  });

  it('VizBoxPlot falls back to "category" × "value"', () => {
    const { container } = render(
      <VizBoxPlot data={[{ category: 'a', q1: 1, median: 2, q3: 3, whiskerLo: 0, whiskerHi: 4, outliers: [], count: 1 }]} />,
    );
    expect(axisText(container, 'x')).toBe('category');
    expect(axisText(container, 'y')).toBe('value');
  });
});
