// @vitest-environment jsdom
/**
 * LY-1 — the cockpit's user-pickable, DRIVEN arrangements: the Flow/Grid/Focus
 * switcher (keyboard-accessible radiogroup), the saved order, the focus rail
 * with live-cell thumbnails, and pointer drag-to-reorder. The cockpit never
 * keeps arrangement state — every gesture only calls `onLayoutChange`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { VizCockpit, orderCharts, reorderIds, type CockpitChart } from './VizCockpit.js';
import type { LayoutView } from '../adapter/types.js';

// jsdom ships no PointerEvent — polyfill it as a MouseEvent subclass so the
// drag handle's pointer listeners fire (mirrors charts.test.tsx's polyfill).
if (typeof window.PointerEvent === 'undefined') {
  class PE extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: typeof PE }).PointerEvent = PE;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
});

const cell = (id: string, weight?: number): CockpitChart => ({ id, ...(weight !== undefined ? { weight } : {}), render: () => <svg className="vzf-chart" /> });
const CHARTS: CockpitChart[] = [cell('scatter', 3), cell('line', 3), cell('bar', 2), cell('map', 2)];
const flow = (over: Partial<LayoutView> = {}): LayoutView => ({ preset: 'flow', order: [], focusId: null, ...over });

describe('orderCharts / reorderIds — the pure order helpers', () => {
  it('saved order leads, unknown saved ids drop, unsaved charts append in consumer order', () => {
    expect(orderCharts(CHARTS, ['bar', 'ghost', 'line']).map((c) => c.id)).toEqual(['bar', 'line', 'scatter', 'map']);
    expect(orderCharts(CHARTS, []).map((c) => c.id)).toEqual(['scatter', 'line', 'bar', 'map']);
  });
  it('reorderIds moves the dragged id to the target position', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });
});

describe('the layout switcher (radiogroup in the top strip)', () => {
  it('renders Flow/Grid/Focus with aria state + roving tabindex; a click picks the preset', () => {
    const onChange = vi.fn();
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow({ preset: 'grid' })} onLayoutChange={onChange} />);
    const group = container.querySelector('[data-vzf="layout-switch"]')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    const options = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(options.map((o) => o.textContent)).toEqual(['Flow', 'Grid', 'Focus']); // plain names
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(options.map((o) => o.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    fireEvent.click(container.querySelector('[data-preset-option="focus"]')!);
    expect(onChange).toHaveBeenCalledWith({ preset: 'focus' });
  });

  it('arrow keys pick the neighbour preset (select follows arrow, wrapping)', () => {
    const onChange = vi.fn();
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow()} onLayoutChange={onChange} />);
    const active = container.querySelector('[data-preset-option="flow"]')!;
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'grid' });
    fireEvent.keyDown(active, { key: 'ArrowLeft' }); // wraps backwards from flow
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'focus' });
    fireEvent.keyDown(active, { key: 'Enter' }); // not an arrow — ignored
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('shows without a top node; disables when read-only or when undriven (no onLayoutChange)', () => {
    const readonly = render(<VizCockpit charts={CHARTS} layout={flow()} onLayoutChange={vi.fn()} readOnly />);
    expect(readonly.container.querySelector('[data-vzf="cockpit-top"]')).not.toBeNull(); // strip exists for the switcher alone
    expect(readonly.container.querySelector('[data-vzf="cockpit-top-main"]')).toBeNull(); // no top node given
    for (const o of readonly.container.querySelectorAll('.vzf-layout-option')) expect((o as HTMLButtonElement).disabled).toBe(true);
    expect(readonly.container.querySelectorAll('[data-vzf="drag-handle"]')).toHaveLength(0); // present mode never authors
    cleanup();
    const undriven = render(<VizCockpit charts={CHARTS} layout={flow()} />);
    for (const o of undriven.container.querySelectorAll('.vzf-layout-option')) expect((o as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const plain = render(<VizCockpit charts={CHARTS} />); // no layout at all → no switcher, no strip
    expect(plain.container.querySelector('[data-vzf="layout-switch"]')).toBeNull();
    expect(plain.container.querySelector('[data-vzf="cockpit-top"]')).toBeNull();
  });
});

describe('the three presets — grid templates on the charts band', () => {
  const bandOf = (layout?: LayoutView) => {
    const { container } = render(<VizCockpit charts={CHARTS} layout={layout} onLayoutChange={vi.fn()} />);
    return container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
  };

  it('flow (and no layout at all) keeps the weighted band byte-identical', () => {
    const undriven = bandOf(undefined);
    expect(undriven.style.gridTemplateColumns).toBe('minmax(0, 3fr) minmax(0, 3fr) minmax(0, 2fr) minmax(0, 2fr)');
    expect(undriven.getAttribute('data-preset')).toBe('flow');
    cleanup();
    const driven = bandOf(flow());
    expect(driven.style.gridTemplateColumns).toBe('minmax(0, 3fr) minmax(0, 3fr) minmax(0, 2fr) minmax(0, 2fr)');
    expect(driven.style.gridTemplateRows).toBe('');
  });

  it('grid = equal cells: 2×N for 3+ charts, side-by-side for a pair, weighted fallback for one', () => {
    const four = bandOf(flow({ preset: 'grid' }));
    expect(four.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(four.style.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))');
    expect(four.getAttribute('data-preset')).toBe('grid');
    cleanup();
    const { container: two } = render(<VizCockpit charts={CHARTS.slice(0, 2)} layout={flow({ preset: 'grid' })} onLayoutChange={vi.fn()} />);
    const band2 = two.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    expect(band2.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(band2.style.gridTemplateRows).toBe('repeat(1, minmax(0, 1fr))');
    cleanup();
    const { container: one } = render(<VizCockpit charts={CHARTS.slice(0, 1)} layout={flow({ preset: 'grid' })} onLayoutChange={vi.fn()} />);
    expect((one.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement).style.gridTemplateColumns).toBe('minmax(0, 3fr)');
  });

  it('the saved order reorders the DOM cells (drag persistence renders back)', () => {
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow({ order: ['map', 'bar'] })} onLayoutChange={vi.fn()} />);
    const ids = Array.from(container.querySelectorAll('[data-chart]')).map((el) => el.getAttribute('data-chart'));
    expect(ids).toEqual(['map', 'bar', 'scatter', 'line']);
  });
});

describe('the focus preset — one hero + a live thumbnail rail', () => {
  it('marks the focused hero, lines the thumbs on row 2, and keeps captions to the hero', () => {
    const charts = CHARTS.map((c, i) => ({ ...c, caption: `cap-${c.id}` }));
    const { container } = render(<VizCockpit charts={charts} layout={flow({ preset: 'focus', focusId: 'bar' })} onLayoutChange={vi.fn()} />);
    const band = container.querySelector('[data-vzf="cockpit-charts"]') as HTMLElement;
    expect(band.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(band.style.gridTemplateRows).toBe('minmax(0, 1fr) minmax(84px, 16%)');
    const hero = container.querySelector('[data-chart="bar"]') as HTMLElement;
    expect(hero.getAttribute('data-focused')).toBe('true');
    expect(hero.classList.contains('vzf-focused')).toBe(true);
    expect(hero.style.gridColumn).toBe('1 / -1');
    expect(hero.querySelector('.vzf-thumb-overlay')).toBeNull(); // the hero is fully interactive
    // thumbs: everyone else, row 2, sequential columns, an overlay each (still LIVE cells)
    const thumbs = Array.from(container.querySelectorAll('.vzf-cockpit-cell.vzf-thumb')) as HTMLElement[];
    expect(thumbs.map((t) => t.getAttribute('data-chart'))).toEqual(['scatter', 'line', 'map']);
    expect(thumbs.map((t) => t.style.gridRow)).toEqual(['2', '2', '2']);
    expect(thumbs.map((t) => t.style.gridColumn)).toEqual(['1', '2', '3']);
    for (const t of thumbs) expect(t.querySelector('[data-vzf="focus-thumb"]')).not.toBeNull();
  });

  it('clicking a thumbnail swaps focus through onLayoutChange (never local state)', () => {
    const onChange = vi.fn();
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow({ preset: 'focus', focusId: 'scatter' })} onLayoutChange={onChange} />);
    const thumb = container.querySelector('[data-chart="line"] [data-vzf="focus-thumb"]') as HTMLButtonElement;
    expect(thumb.getAttribute('aria-label')).toBe('Focus line');
    fireEvent.click(thumb);
    expect(onChange).toHaveBeenCalledWith({ focusId: 'line' });
  });

  it('defaults the hero honestly: null focusId → first cell; a stale focusId → first cell; one chart → no rail', () => {
    const noFocus = render(<VizCockpit charts={CHARTS} layout={flow({ preset: 'focus' })} onLayoutChange={vi.fn()} />);
    expect(noFocus.container.querySelector('[data-focused="true"]')?.getAttribute('data-chart')).toBe('scatter');
    cleanup();
    const stale = render(<VizCockpit charts={CHARTS} layout={flow({ preset: 'focus', focusId: 'ghost' })} onLayoutChange={vi.fn()} />);
    expect(stale.container.querySelector('[data-focused="true"]')?.getAttribute('data-chart')).toBe('scatter');
    cleanup();
    const single = render(<VizCockpit charts={CHARTS.slice(0, 1)} layout={flow({ preset: 'focus', focusId: 'scatter' })} onLayoutChange={vi.fn()} />);
    expect(single.container.querySelectorAll('.vzf-thumb')).toHaveLength(0); // nothing to rail
    expect((single.container.querySelector('[data-chart="scatter"]') as HTMLElement).style.gridColumn).toBe(''); // no placement needed
    cleanup();
    const empty = render(<VizCockpit charts={[]} layout={flow({ preset: 'focus' })} onLayoutChange={vi.fn()} />);
    expect(empty.container.querySelectorAll('[data-chart]')).toHaveLength(0); // degenerate: no cells, no hero
  });
});

describe('drag-to-reorder (pointer-based; the drop lands ONE order change)', () => {
  it('drag over a sibling highlights it; dropping there emits the new order', () => {
    const onChange = vi.fn();
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow()} onLayoutChange={onChange} />);
    const handle = container.querySelector('[data-chart="map"] [data-vzf="drag-handle"]')!;
    const scatterCell = container.querySelector('[data-chart="scatter"]')!;

    fireEvent.pointerDown(handle, { pointerId: 1 });
    expect(container.querySelector('[data-chart="map"]')!.classList.contains('vzf-dragging')).toBe(true);
    fireEvent.pointerMove(scatterCell, { pointerId: 1 }); // window listener; target = the cell under the pointer
    expect(scatterCell.classList.contains('vzf-drop-target')).toBe(true);
    fireEvent.pointerMove(container.querySelector('[data-chart="map"]')!, { pointerId: 1 }); // over itself → no target
    expect(container.querySelector('.vzf-drop-target')).toBeNull();
    fireEvent.pointerUp(scatterCell, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith({ order: ['map', 'scatter', 'line', 'bar'] });
    expect(container.querySelector('.vzf-dragging')).toBeNull(); // drag state fully cleared
  });

  it('dropping outside any cell (or back on itself) changes nothing; pointercancel aborts', () => {
    const onChange = vi.fn();
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow()} onLayoutChange={onChange} />);
    const handle = container.querySelector('[data-chart="bar"] [data-vzf="drag-handle"]')!;

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(window, { pointerId: 1 }); // target = window → not an Element → no cell
    expect(container.querySelector('.vzf-drop-target')).toBeNull();
    fireEvent.pointerUp(document.body, { pointerId: 1 }); // outside every cell
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { pointerId: 2 });
    fireEvent.pointerUp(handle, { pointerId: 2 }); // back on itself (the handle sits inside the bar cell)
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { pointerId: 3 });
    fireEvent.pointerCancel(window, { pointerId: 3 });
    expect(container.querySelector('.vzf-dragging')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses real hit-testing when the engine has elementFromPoint', () => {
    const onChange = vi.fn();
    const { container } = render(<VizCockpit charts={CHARTS} layout={flow()} onLayoutChange={onChange} />);
    // hit-test resolves an element INSIDE the cell (jsdom's ChartFrame renders no svg at 0×0 — use the caption-less cell interior, the handle)
    const lineInner = container.querySelector('[data-chart="line"] [data-vzf="drag-handle"]')!;
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = vi.fn(() => lineInner);
    const handle = container.querySelector('[data-chart="scatter"] [data-vzf="drag-handle"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(document.body, { pointerId: 1, clientX: 40, clientY: 40 });
    expect(container.querySelector('[data-chart="line"]')!.classList.contains('vzf-drop-target')).toBe(true);
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 40, clientY: 40 });
    expect(onChange).toHaveBeenCalledWith({ order: ['line', 'scatter', 'bar', 'map'] });
  });
});
