// @vitest-environment jsdom
/**
 * `<VizHistogram>` — the primitives-tier proof chart: host-owned bins render
 * as buckets; the shared brush primitive's three gestures (drag → ONE
 * edge-snapped interval, click → the bucket's interval, click-again →
 * cleared) all emit the R3 shape; the own-interval outline and the
 * click-again comparison derive from the addressable fold
 * (`selfSelectedInterval`), never local state; the x axis label is the
 * re-encode affordance in both modes; date bins ride the ISO rail.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// jsdom ships no PointerEvent — polyfill it as a MouseEvent subclass so
// fireEvent.pointer* carries clientX/pointerId to the brush handlers.
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

import { VizHistogram, type HistogramBinDatum } from './VizHistogram.js';
import { selectionForView } from '../contract/selection.js';
import type { ColumnView, SelectionView } from '../adapter/types.js';

afterEach(cleanup);

// four host-computed buckets over [0, 100] (equal width 25), counts 2/0/5/3
const BINS: HistogramBinDatum[] = [
  { x0: 0, x1: 25, count: 2 },
  { x0: 25, x1: 50, count: 0 },
  { x0: 50, x1: 75, count: 5 },
  { x0: 75, x1: 100, count: 3 },
];

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'date', type: 'date' },
  { field: 'category', type: 'string' },
];

// geometry (defaults width=420, PAD.l=30, PAD.r=30): x maps [0,100] → [30,390]
const PX = (v: number): number => 30 + (v / 100) * 360;

function ownSelection(value: unknown): ReturnType<typeof selectionForView> {
  const rows: SelectionView[] = [{ viewId: 'histogram', field: 'price', kind: 'interval', value }];
  return selectionForView(rows, 'histogram');
}

function brushOn(svg: Element, fromX: number, toX: number): void {
  fireEvent.pointerDown(svg, { clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: toX, pointerId: 1 });
}

describe('VizHistogram — rendering host-owned bins', () => {
  it('renders one bar + one full-height hit area per bucket, counts above non-empty bars', () => {
    const { container } = render(<VizHistogram data={BINS} field="price" />);
    expect(container.querySelectorAll('rect.vzf-histbar')).toHaveLength(4);
    expect(container.querySelectorAll('rect.vzf-hist-hit')).toHaveLength(4);
    // counts label only the non-empty buckets (2, 5, 3 — never a "0")
    const vals = Array.from(container.querySelectorAll('text.vzf-barval')).map((t) => t.textContent);
    expect(vals).toEqual(['2', '5', '3']);
    // every bucket edge is a tick (≤12 edges → no thinning): 0/25/50/75/100
    const ticks = Array.from(container.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
    expect(ticks).toEqual(['0', '25', '50', '75', '100']);
    // the empty bucket is still a keyboard-reachable, labelled affordance
    expect(screen.getByRole('button', { name: 'price 25–50 (0 rows)' })).toBeTruthy();
  });

  it('thins edge ticks when there are many edges but always keeps the last edge', () => {
    const many: HistogramBinDatum[] = Array.from({ length: 30 }, (_, i) => ({ x0: i, x1: i + 1, count: 1 }));
    const { container } = render(<VizHistogram data={many} field="v" />);
    const ticks = Array.from(container.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(ticks[0]).toBe('0');
    expect(ticks[ticks.length - 1]).toBe('30');
  });

  it('thinning is width-aware: a narrow cockpit cell keeps only what fits (first + last always)', () => {
    const eight: HistogramBinDatum[] = Array.from({ length: 8 }, (_, i) => ({ x0: i * 25, x1: (i + 1) * 25, count: 1 }));
    const { container } = render(<VizHistogram data={eight} field="v" width={150} />);
    const ticks = Array.from(container.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
    // the mid label steps in but would crowd the always-shown final edge → dropped
    expect(ticks).toEqual(['0', '200']);
  });

  it('skips a bin whose date edge cannot be parsed — never guessed into place', () => {
    const { container } = render(
      <VizHistogram
        data={[
          { x0: '2026-04-01', x1: '2026-04-05', count: 2 },
          { x0: 'not a date', x1: '2026-04-09', count: 9 },
        ]}
        field="date"
      />,
    );
    expect(container.querySelectorAll('rect.vzf-histbar')).toHaveLength(1);
  });

  it('date bins position by epoch and label by day', () => {
    const { container } = render(
      <VizHistogram
        data={[
          { x0: '2026-04-01', x1: '2026-04-05', count: 2 },
          { x0: '2026-04-05', x1: '2026-04-09', count: 3 },
        ]}
        field="date"
      />,
    );
    const ticks = Array.from(container.querySelectorAll('text.vzf-tick')).map((t) => t.textContent);
    expect(ticks).toEqual(['2026-04-01', '2026-04-05', '2026-04-09']);
  });
});

describe('VizHistogram — the brush gesture (drag → ONE edge-snapped interval)', () => {
  it('a drag across buckets emits one interval snapped to the covered bucket edges', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={BINS} field="price" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-histogram')!;
    // drag from inside bucket 2 (v≈30) to inside bucket 3 (v≈60) → snaps to [25, 75]
    brushOn(svg, PX(30), PX(60));
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [25, 75], encoding: { kind: 'interval', field: 'price' } });
  });

  it('the live brush rectangle rides the shared .vzf-brush overlay while dragging', () => {
    const { container } = render(<VizHistogram data={BINS} field="price" />);
    const svg = container.querySelector('svg.vzf-histogram')!;
    fireEvent.pointerDown(svg, { clientX: PX(30), pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: PX(60), pointerId: 1 });
    expect(container.querySelector('rect.vzf-brush')).toBeTruthy();
    fireEvent.pointerUp(svg, { clientX: PX(60), pointerId: 1 });
  });

  it('a drag over NO bucket emits nothing — an interval is never fabricated', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={[]} field="price" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-histogram')!;
    brushOn(svg, 100, 300);
    expect(onEmit).not.toHaveBeenCalled();
    expect(container.querySelector('rect.vzf-brush')).toBeNull(); // the brush cleared itself
  });
});

describe('VizHistogram — the tap gestures (click a bucket / click-again clears)', () => {
  it('a click on a bucket emits THAT bucket\'s interval', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={BINS} field="price" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-histogram')!;
    brushOn(svg, PX(60), PX(60)); // a sub-4px "drag" = a click at v≈60 → bucket [50, 75]
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [50, 75], encoding: { kind: 'interval', field: 'price' } });
  });

  it('clicking the SELECTED bucket again emits the CLEARED interval (derived from the fold, not local state)', () => {
    const onEmit = vi.fn();
    const { container } = render(
      <VizHistogram data={BINS} field="price" selection={ownSelection([50, 75])} onEmit={onEmit} />,
    );
    const svg = container.querySelector('svg.vzf-histogram')!;
    brushOn(svg, PX(60), PX(60));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'price' } });
  });

  it('a click with no buckets at all clears (the scatter/line tap discipline)', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={[]} field="price" onEmit={onEmit} />);
    brushOn(container.querySelector('svg.vzf-histogram')!, 200, 200);
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'price' } });
  });

  it('the LAST bucket is closed: a click exactly at the top edge still hits it', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={BINS} field="price" onEmit={onEmit} />);
    brushOn(container.querySelector('svg.vzf-histogram')!, PX(100), PX(100));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [75, 100], encoding: { kind: 'interval', field: 'price' } });
  });

  it('Enter on a bucket\'s hit area selects it; Enter again (once selected) clears — keyboard parity', () => {
    const onEmit = vi.fn();
    const { rerender } = render(<VizHistogram data={BINS} field="price" onEmit={onEmit} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'price 50–75 (5 rows)' }), { key: 'Enter' });
    expect(onEmit).toHaveBeenLastCalledWith({ rawValue: [50, 75], encoding: { kind: 'interval', field: 'price' } });
    // the host lands the commit; the fold returns as the selection prop
    rerender(<VizHistogram data={BINS} field="price" selection={ownSelection([50, 75])} onEmit={onEmit} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'price 50–75 (5 rows)' }), { key: ' ' });
    expect(onEmit).toHaveBeenLastCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'price' } });
  });

  it('date buckets emit their ISO edge strings on the interval rail', () => {
    const onEmit = vi.fn();
    const { container } = render(
      <VizHistogram
        data={[
          { x0: '2026-04-01', x1: '2026-04-05', count: 2 },
          { x0: '2026-04-05', x1: '2026-04-09', count: 3 },
        ]}
        field="date"
        onEmit={onEmit}
      />,
    );
    const svg = container.querySelector('svg.vzf-histogram')!;
    brushOn(svg, 40, 380); // across both buckets
    expect(onEmit).toHaveBeenCalledWith({
      rawValue: ['2026-04-01', '2026-04-09'],
      encoding: { kind: 'interval', field: 'date' },
    });
  });
});

describe('VizHistogram — the own-interval outline (from the addressable fold)', () => {
  it('buckets inside the view\'s own live interval wear the selection outline', () => {
    const { container } = render(
      <VizHistogram data={BINS} field="price" selection={ownSelection([25, 75])} />,
    );
    const selected = Array.from(container.querySelectorAll('rect.vzf-histbar.vzf-selected'));
    expect(selected).toHaveLength(2); // buckets [25,50] and [50,75]
    expect(container.querySelector('[data-bucket="25"][aria-pressed="true"]')).toBeTruthy();
    expect(container.querySelector('[data-bucket="0"][aria-pressed="false"]')).toBeTruthy();
  });

  it('no outline for a cleared own clause, a half-open interval, or someone ELSE\'s clause', () => {
    const cleared = render(<VizHistogram data={BINS} field="price" selection={ownSelection(null)} />);
    expect(cleared.container.querySelectorAll('.vzf-selected')).toHaveLength(0);
    cleanup();
    const halfOpen = render(<VizHistogram data={BINS} field="price" selection={ownSelection([null, 75])} />);
    expect(halfOpen.container.querySelectorAll('.vzf-selected')).toHaveLength(0);
    cleanup();
    const other = render(
      <VizHistogram
        data={BINS}
        field="price"
        selection={selectionForView([{ viewId: 'scatter', field: 'price', kind: 'interval', value: [0, 100] }], 'histogram')}
      />,
    );
    expect(other.container.querySelectorAll('.vzf-selected')).toHaveLength(0);
  });
});

describe('VizHistogram — the re-encode affordance (both modes)', () => {
  it('contract mode: an axis-label click asks the HOST; no built-in picker opens', () => {
    const onReencodeRequest = vi.fn();
    const { container } = render(
      <VizHistogram data={BINS} field="price" columns={COLS} onReencodeRequest={onReencodeRequest} />,
    );
    fireEvent.click(container.querySelector('[data-axis-channel="x"]')!);
    expect(onReencodeRequest).toHaveBeenCalledWith('x');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('convenience mode: the built-in picker opens honestly restricted (x = numeric/date only) and fires onReencode', () => {
    const onReencode = vi.fn();
    const { container } = render(
      <VizHistogram data={BINS} field="price" columns={COLS} encoding={{ x: 'price' }} onReencode={onReencode} />,
    );
    fireEvent.click(container.querySelector('[data-axis-channel="x"]')!);
    const catOpt = screen.getByRole('button', { name: /category/ }) as HTMLButtonElement;
    expect(catOpt.disabled).toBe(true); // a string column cannot ride the x channel
    expect(catOpt.getAttribute('title')).toContain('numeric or date');
    const dateOpt = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="date"]') as HTMLButtonElement;
    expect(dateOpt.disabled).toBe(false); // date domains are first-class
    fireEvent.click(dateOpt);
    expect(onReencode).toHaveBeenCalledWith('histogram', 'x', 'date');
    expect(screen.queryByRole('dialog')).toBeNull(); // picking closed it
  });

  it('without an encoding fold the picker highlights the field prop as current', () => {
    const { container } = render(<VizHistogram data={BINS} field="price" columns={COLS} />);
    fireEvent.click(container.querySelector('[data-axis-channel="x"]')!);
    const priceOpt = document.querySelector('[data-vzf-modal="encoding-picker"] [data-field="price"]')!;
    expect(priceOpt.getAttribute('aria-current')).toBe('true');
  });

  it('a custom className rides the svg root', () => {
    const { container } = render(<VizHistogram data={BINS} field="price" className="my-hist" />);
    expect(container.querySelector('svg.vzf-histogram.my-hist')).toBeTruthy();
  });

  it('a pointer-down on the axis label never starts (or clears) a brush', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizHistogram data={BINS} field="price" onEmit={onEmit} />);
    const axis = container.querySelector('[data-axis-channel="x"] .vzf-axis-label')!;
    fireEvent.pointerDown(axis, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(axis, { clientX: 200, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled();
  });
});

describe('the accessible name (the prose plane\'s altShort)', () => {
  it('takes ariaLabel over its own construction line', () => {
    const { container } = render(<VizHistogram data={BINS} field="price" ariaLabel="Cases by report state" />);
    expect(container.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Cases by report state'); // a group: its marks are buttons, and must stay reachable
  });
});
