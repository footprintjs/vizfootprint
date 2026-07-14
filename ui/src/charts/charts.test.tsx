// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

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
import { EncodingPicker } from './EncodingPicker.js';
import { VizScatter } from './VizScatter.js';
import { VizBar } from './VizBar.js';
import { defaultCompat } from './compat.js';
import { selectionForView } from '../contract/selection.js';
import type { ColumnView } from '../adapter/types.js';

afterEach(cleanup);

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'rating', type: 'number' },
  { field: 'category', type: 'string' },
];

describe('defaultCompat', () => {
  it('positional channels require numeric/date, categorical accept anything', () => {
    expect(defaultCompat('y', { field: 'price', type: 'number' }).ok).toBe(true);
    const bad = defaultCompat('y', { field: 'category', type: 'string' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('numeric or date');
    expect(defaultCompat('color', { field: 'category', type: 'string' }).ok).toBe(true);
  });
});

describe('EncodingPicker', () => {
  it('lists columns, disables incompatible ones with a reason, and fires onReencode', () => {
    const onReencode = vi.fn();
    const onClose = vi.fn();
    render(<EncodingPicker open viewId="scatter" channel="y" columns={COLS} currentField="rating" onReencode={onReencode} onClose={onClose} />);
    // the string column is disabled for the y channel, with a reason on its title
    const catOpt = screen.getByRole('button', { name: /category/ }) as HTMLButtonElement;
    expect(catOpt.disabled).toBe(true);
    expect(catOpt.getAttribute('title')).toContain('numeric or date');
    // picking a compatible column fires the UI-0 verb + closes
    fireEvent.click(screen.getByRole('button', { name: /price/ }));
    expect(onReencode).toHaveBeenCalledWith('scatter', 'y', 'price');
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the current field, closes on Escape and on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(<EncodingPicker open viewId="bar" channel="color" columns={COLS} currentField="category" onReencode={() => {}} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /category/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    const backdrop = container.querySelector('.vzf-modal-backdrop')!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('focuses the first option when opened (focus trap entry)', () => {
    render(<EncodingPicker open viewId="scatter" channel="color" columns={COLS} onReencode={() => {}} onClose={() => {}} />);
    // color accepts all → first option (price) is focusable and receives focus
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /price/ }));
  });

  it('renders nothing when closed', () => {
    const { container } = render(<EncodingPicker open={false} viewId="s" channel="x" columns={COLS} onReencode={() => {}} onClose={() => {}} />);
    expect(container.querySelector('.vzf-modal')).toBeNull();
  });
});

describe('VizScatter', () => {
  const rows = [
    { id: '1', price: 20, rating: 3, category: 'Casual' },
    { id: '2', price: 80, rating: 5, category: 'Formal' },
    { id: '3', price: 120, rating: 2, category: 'Party' },
  ];
  const data = rows.map((r) => ({ id: r.id, x: r.price, y: r.rating, category: r.category, row: r }));

  it('renders a dot per datum and dims those failing the NON-SELF clauses of the selection (RP-1)', () => {
    const selection = selectionForView(
      [
        { viewId: 'bar', field: 'price', kind: 'interval', value: [50, 200] },
        // the scatter's OWN brush must never dim the scatter (self-exclusion)
        { viewId: 'scatter', field: 'rating', kind: 'interval', value: [5, 5] },
      ],
      'scatter',
    );
    const { container } = render(<VizScatter data={data} xField="price" yField="rating" selection={selection} />);
    const dots = container.querySelectorAll('circle.vzf-dot');
    expect(dots).toHaveLength(3);
    expect(container.querySelectorAll('circle.vzf-dim')).toHaveLength(1); // only id=1 (price 20) — its own rating clause is excluded
  });

  it('a datum without a source row is never dimmed (no evidence, no dimming)', () => {
    const selection = selectionForView([{ viewId: 'bar', field: 'price', kind: 'interval', value: [50, 200] }], 'scatter');
    const bare = data.map(({ id, x, y, category }) => ({ id, x, y, category })); // rows stripped
    const { container } = render(<VizScatter data={bare} xField="price" yField="rating" selection={selection} />);
    expect(container.querySelectorAll('circle.vzf-dim')).toHaveLength(0);
  });

  it('clicking an axis label opens the encoding picker for that channel', () => {
    const onReencode = vi.fn();
    render(<VizScatter data={data} xField="price" yField="rating" columns={COLS} onReencode={onReencode} />);
    const yAxis = screen.getByRole('button', { name: /Encode the y axis/ });
    fireEvent.click(yAxis);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /rating/ }));
    expect(onReencode).toHaveBeenCalledWith('scatter', 'y', 'rating');
  });

  it('a horizontal brush emits a DATA-space interval on the x field', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={data} xField="price" yField="rating" onEmit={onEmit} width={520} />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    fireEvent.pointerDown(svg, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledTimes(1);
    const emission = onEmit.mock.calls[0]![0];
    expect(emission.encoding).toEqual({ kind: 'interval', field: 'price' });
    expect(Array.isArray(emission.rawValue)).toBe(true);
    expect(emission.rawValue[0]).toBeLessThan(emission.rawValue[1]);
  });

  it('a click (no drag) clears the brush by emitting a null interval', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={data} xField="price" onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    fireEvent.pointerDown(svg, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 151, pointerId: 1 });
    expect(onEmit).toHaveBeenCalledWith({ rawValue: null, encoding: { kind: 'interval', field: 'price' } });
  });

  it('a pointer-down on an axis label never starts (or clears) a brush', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={data} xField="price" columns={COLS} onEmit={onEmit} />);
    const axisText = container.querySelector('.vzf-axis-group .vzf-axis-label')!;
    fireEvent.pointerDown(axisText, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(axisText, { clientX: 260, pointerId: 1 });
    expect(onEmit).not.toHaveBeenCalled(); // no null-interval "clear" emission
  });

  it('contract mode: an axis click ASKS THE HOST via onReencodeRequest — the built-in picker never opens', () => {
    const onReencodeRequest = vi.fn();
    render(<VizScatter data={data} xField="price" yField="rating" columns={COLS} onReencodeRequest={onReencodeRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the y axis/ }));
    expect(onReencodeRequest).toHaveBeenCalledWith('y');
    expect(screen.queryByRole('dialog')).toBeNull(); // the host owns the picker
  });
});

describe('VizBar', () => {
  const data = [
    { category: 'Casual', count: 4 },
    { category: 'Formal', count: 9 },
    { category: 'Party', count: 2 },
  ];

  it('renders a bar per datum, outlines the selected one, and emits a point on click', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizBar data={data} field="category" selected="Formal" onEmit={onEmit} />);
    expect(container.querySelectorAll('rect.vzf-barrect')).toHaveLength(3);
    expect(container.querySelectorAll('rect.vzf-selected')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /select Party/ }));
    expect(onEmit).toHaveBeenCalledWith({ rawValue: 'Party', encoding: { kind: 'point', field: 'category' } });
  });

  it('the category axis label opens a picker where string columns are allowed', () => {
    render(<VizBar data={data} field="category" columns={COLS} onReencode={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the category axis/ }));
    const dialog = screen.getByRole('dialog');
    // in the categorical channel, the string column option is NOT disabled
    const catOpt = within(dialog).getByRole('button', { name: /category/ }) as HTMLButtonElement;
    expect(catOpt.disabled).toBe(false);
  });

  it("the outline derives from the selection fold's own point clause when `selected` is omitted (RP-1)", () => {
    const selection = selectionForView([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }], 'bar');
    const { container } = render(<VizBar data={data} field="category" selection={selection} />);
    const outlined = container.querySelector('rect.vzf-selected')!;
    expect(outlined.getAttribute('aria-label')).toContain('Formal');
  });

  it('an explicit `selected` prop wins over the selection derivation', () => {
    const selection = selectionForView([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' }], 'bar');
    const { container } = render(<VizBar data={data} field="category" selection={selection} selected="Party" />);
    expect(container.querySelector('rect.vzf-selected')!.getAttribute('aria-label')).toContain('Party');
  });

  it('contract mode: the category axis click asks the host via onReencodeRequest — no built-in picker', () => {
    const onReencodeRequest = vi.fn();
    render(<VizBar data={data} field="category" columns={COLS} onReencodeRequest={onReencodeRequest} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the category axis/ }));
    expect(onReencodeRequest).toHaveBeenCalledWith('category');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
