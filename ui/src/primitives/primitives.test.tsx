// @vitest-environment jsdom
/**
 * The primitives tier's own contract, tested at the primitive level (the
 * charts exercise them end to end; these pin the API semantics a consumer
 * composes against): the brush's completion discipline (clear vs tap vs
 * snap-or-nothing), point-select's click-again-clears three-way split, the
 * selection-consumption helpers, the re-encode two-mode dispatch, and the
 * shared date handling.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

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

import type { ChartEmission } from '../../../src/mosaic/index.js';
import { useHorizontalBrush, BrushOverlay, type HorizontalBrushOptions } from './brush.js';
import { pointEmission, togglePointEmission, keyActivates } from './pointSelect.js';
import { useKeepPredicate, selectedValue, dimClass } from './useSelection.js';
import { useReencodePicker } from './reencode.js';
import { epochOf, dayOf } from './scales.js';
import { selectionForView } from '../contract/selection.js';

afterEach(cleanup);

// ── a minimal probe chart: the brush primitive on a bare svg ───────────────────

function Probe(props: Partial<HorizontalBrushOptions> & { onState?: (brushW: number | null) => void }): JSX.Element {
  const { svgRef, brush, handlers } = useHorizontalBrush({
    plotLeft: 10,
    plotRight: 110,
    width: 120,
    field: 'price',
    snap: props.snap ?? ((lo, hi) => [lo, hi]),
    onTap: props.onTap,
    onEmit: props.onEmit,
  });
  props.onState?.(brush ? brush.w : null);
  return (
    <svg ref={svgRef} viewBox="0 0 120 60" {...handlers}>
      <g className="vzf-axis-group">
        <text x={60} y={55}>
          price
        </text>
      </g>
      <BrushOverlay brush={brush} y={5} height={40} />
    </svg>
  );
}

describe('useHorizontalBrush — the completion discipline', () => {
  it('a drag ≥4px emits the snapped interval and keeps the brush rectangle', () => {
    const onEmit = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 80, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 80, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [20, 80], encoding: { kind: 'interval', field: 'price' } });
    expect(container.querySelector('rect.vzf-brush')).toBeTruthy(); // the drawn range persists
  });

  it('a sub-4px release emits the CLEARED interval by default and drops the rectangle', () => {
    const onEmit = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 52, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'price' } });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
  });

  it('a chart-supplied onTap replaces the clear arm (the histogram gesture)', () => {
    const onEmit = vi.fn();
    const onTap = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} onTap={onTap} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 50, pointerId: 1 });
    expect(onTap).toHaveBeenCalledWith(50);
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('snap returning null clears the brush and emits NOTHING (never fabricate)', () => {
    const onEmit = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} snap={() => null} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 90, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled();
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
  });

  it('drag coordinates clamp into [plotLeft, plotRight]', () => {
    const onEmit = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: -40, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 400, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [10, 110], encoding: { kind: 'interval', field: 'price' } });
  });

  it('a pointer-down inside .vzf-axis-group never starts a brush; stray moves/ups are inert', () => {
    const onEmit = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('.vzf-axis-group text')!, { clientX: 60, pointerId: 1 });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
    fireEvent.pointerMove(svg, { clientX: 80, pointerId: 1 }); // no drag in flight
    fireEvent.pointerUp(svg, { clientX: 80, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('pointer-cancel completes like pointer-up (capture-loss safety)', () => {
    const onEmit = vi.fn();
    const { container } = render(<Probe onEmit={onEmit} />);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(svg, { clientX: 20, pointerId: 1 });
    fireEvent.pointerCancel(svg, { clientX: 60, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: [20, 60], encoding: { kind: 'interval', field: 'price' } });
  });
});

describe('BrushOverlay', () => {
  it('renders nothing for a null or zero-width brush, the shared rect otherwise', () => {
    const none = render(<svg>{BrushOverlay({ brush: null, y: 0, height: 10 })}</svg>);
    expect(none.container.querySelector('rect')).toBeNull();
    cleanup();
    const zero = render(<svg>{BrushOverlay({ brush: { x: 5, w: 0 }, y: 0, height: 10 })}</svg>);
    expect(zero.container.querySelector('rect')).toBeNull();
    cleanup();
    const live = render(<svg>{BrushOverlay({ brush: { x: 5, w: 20 }, y: 2, height: 10 })}</svg>);
    const rect = live.container.querySelector('rect.vzf-brush')!;
    expect(rect.getAttribute('x')).toBe('5');
    expect(rect.getAttribute('width')).toBe('20');
  });
});

describe('pointSelect — the three-way point language', () => {
  it('pointEmission is the plain R3 point shape', () => {
    expect(pointEmission('category', 'Formal')).toEqual({
      rawValue: 'Formal',
      encoding: { kind: 'point', field: 'category' },
    });
  });

  it('togglePointEmission: a new value selects; the selected value CLEARS (rawValue undefined, never null)', () => {
    expect(togglePointEmission('region', 'North', null)).toEqual({
      rawValue: 'North',
      encoding: { kind: 'point', field: 'region' },
    });
    const cleared = togglePointEmission('region', 'North', 'North');
    expect(cleared.rawValue).toBeUndefined();
    expect('rawValue' in cleared).toBe(true); // undefined = the cleared arm, not a missing key
    expect(cleared.encoding).toEqual({ kind: 'point', field: 'region' });
  });

  it('keyActivates fires on Enter and Space (with preventDefault), ignores other keys', () => {
    const activate = vi.fn();
    const { container } = render(
      <button onKeyDown={keyActivates(activate)} type="button">
        probe
      </button>,
    );
    const el = container.querySelector('button')!;
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'Escape' });
    fireEvent.keyDown(el, { key: 'a' });
    expect(activate).toHaveBeenCalledTimes(2);
  });
});

describe('useSelection — consumption helpers', () => {
  const selection = selectionForView(
    [
      { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' },
      { viewId: 'scatter', field: 'price', kind: 'interval', value: [10, 20] },
    ],
    'bar',
  );

  function KeepProbe(props: { selection?: typeof selection }): JSX.Element {
    const keep = useKeepPredicate(props.selection);
    return <div data-keep={keep === null ? 'null' : String(keep({ category: 'Formal', price: 15 }))} />;
  }

  it('useKeepPredicate memoizes the self-excluded fold; null without a selection', () => {
    const without = render(<KeepProbe />);
    expect(without.container.querySelector('div')!.getAttribute('data-keep')).toBe('null');
    cleanup();
    const withSel = render(<KeepProbe selection={selection} />);
    // bar's own point clause is excluded; the scatter interval keeps price 15
    expect(withSel.container.querySelector('div')!.getAttribute('data-keep')).toBe('true');
  });

  it('selectedValue: an explicit prop (even null) wins; otherwise the own point clause; else null', () => {
    expect(selectedValue('Party', selection)).toBe('Party');
    expect(selectedValue(null, selection)).toBeNull();
    expect(selectedValue(undefined, selection)).toBe('Formal');
    expect(selectedValue(undefined, undefined)).toBeNull();
  });

  it('dimClass — dim, never hide', () => {
    expect(dimClass(true)).toBe('');
    expect(dimClass(false)).toBe(' vzf-dim');
  });
});

describe('useReencodePicker — the two-mode dispatch', () => {
  function PickerProbe(props: { onReencodeRequest?: (c: string) => void }): JSX.Element {
    const { pickerChannel, openPicker, closePicker } = useReencodePicker(props.onReencodeRequest);
    return (
      <div>
        <button type="button" data-open onClick={() => openPicker('x')} />
        <button type="button" data-close onClick={closePicker} />
        <span data-channel>{pickerChannel ?? 'closed'}</span>
      </div>
    );
  }

  it('contract mode: the HOST is asked and the built-in picker never opens', () => {
    const onReencodeRequest = vi.fn();
    const { container } = render(<PickerProbe onReencodeRequest={onReencodeRequest} />);
    fireEvent.click(container.querySelector('[data-open]')!);
    expect(onReencodeRequest).toHaveBeenCalledWith('x');
    expect(container.querySelector('[data-channel]')!.textContent).toBe('closed');
  });

  it('convenience mode: openPicker sets the channel, closePicker clears it', () => {
    const { container } = render(<PickerProbe />);
    fireEvent.click(container.querySelector('[data-open]')!);
    expect(container.querySelector('[data-channel]')!.textContent).toBe('x');
    fireEvent.click(container.querySelector('[data-close]')!);
    expect(container.querySelector('[data-channel]')!.textContent).toBe('closed');
  });
});

describe('scales — the shared date handling', () => {
  it('epochOf parses ISO strings and answers null (never NaN) for junk', () => {
    expect(epochOf('2026-04-01')).toBe(Date.UTC(2026, 3, 1));
    expect(epochOf('not a date')).toBeNull();
  });

  it('dayOf trims a full timestamp to its day', () => {
    expect(dayOf('2026-04-01T12:30:00.000Z')).toBe('2026-04-01');
    expect(dayOf('2026-04-01')).toBe('2026-04-01');
  });
});

// the emission type stays the single vocabulary — a compile-time pin
const _pin: ChartEmission = pointEmission('f', 1);
void _pin;
