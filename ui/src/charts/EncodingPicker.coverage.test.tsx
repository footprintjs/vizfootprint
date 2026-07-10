// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EncodingPicker } from './EncodingPicker.js';
import type { ColumnView } from '../adapter/types.js';

afterEach(cleanup);

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'rating', type: 'number' },
  { field: 'category', type: 'string' },
];

describe('EncodingPicker focus management', () => {
  it('falls back to any focusable element (the close button) when every column is disabled', () => {
    render(
      <EncodingPicker
        open
        viewId="scatter"
        channel="y"
        columns={COLS}
        compatible={() => ({ ok: false, reason: 'nope' })}
        onReencode={() => {}}
        onClose={() => {}}
      />,
    );
    // no `.vzf-col-option:not([disabled])` exists, so the initial-focus query
    // falls back to the general FOCUSABLE selector, landing on Close.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('does not restore focus to a non-HTMLElement opener (e.g. an SVG axis label)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.setAttribute('tabindex', '0');
    document.body.appendChild(svg);
    (svg as unknown as { focus: () => void }).focus();
    expect(document.activeElement).toBe(svg);
    expect(svg instanceof HTMLElement).toBe(false);
    const focusSpy = vi.spyOn(svg as unknown as { focus: () => void }, 'focus');

    const { rerender } = render(
      <EncodingPicker open viewId="scatter" channel="y" columns={COLS} onReencode={() => {}} onClose={() => {}} />,
    );
    focusSpy.mockClear();
    rerender(
      <EncodingPicker open={false} viewId="scatter" channel="y" columns={COLS} onReencode={() => {}} onClose={() => {}} />,
    );
    // restoreRef.current (the svg) is not an HTMLElement, so the restore-focus
    // branch must be skipped entirely.
    expect(focusSpy).not.toHaveBeenCalled();
    document.body.removeChild(svg);
  });
});

describe('EncodingPicker Tab focus trap', () => {
  it('Shift+Tab from the first node (Close) wraps to the last node', () => {
    render(<EncodingPicker open viewId="scatter" channel="color" columns={COLS} onReencode={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    const lastOption = screen.getByRole('button', { name: /category/ });
    expect(document.activeElement).toBe(lastOption);
  });

  it('Tab from the last node wraps back to the first node (Close)', () => {
    render(<EncodingPicker open viewId="scatter" channel="color" columns={COLS} onReencode={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const lastOption = screen.getByRole('button', { name: /category/ });
    lastOption.focus();
    expect(document.activeElement).toBe(lastOption);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('plain Tab on the first node (not last) does not wrap', () => {
    render(<EncodingPicker open viewId="scatter" channel="color" columns={COLS} onReencode={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    closeBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    // neither the shift+first nor the plain+last condition matches → no wrap
    expect(document.activeElement).toBe(closeBtn);
  });

  it('ignores keys that are neither Escape nor Tab', () => {
    const onClose = vi.fn();
    render(<EncodingPicker open viewId="scatter" channel="color" columns={COLS} onReencode={() => {}} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('treats an empty focusable set (mocked) as a no-op — the length-0 / nullish-fallback guard', () => {
    render(<EncodingPicker open viewId="scatter" channel="color" columns={COLS} onReencode={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    closeBtn.focus();
    // Force `modalRef.current?.querySelectorAll(...)` to itself resolve to
    // `undefined` for exactly the Tab handler's one call, so the `?? []`
    // fallback is used and `nodes.length === 0` is reached.
    const spy = vi.spyOn(Element.prototype, 'querySelectorAll').mockReturnValueOnce(undefined as unknown as NodeListOf<Element>);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    spy.mockRestore();
    // guarded return — focus does not move
    expect(document.activeElement).toBe(closeBtn);
  });
});

describe('EncodingPicker backdrop / empty state / disabled click', () => {
  it('a mousedown that bubbles from a child of the backdrop does not close', () => {
    const onClose = vi.fn();
    const { container } = render(
      <EncodingPicker open viewId="scatter" channel="y" columns={COLS} onReencode={() => {}} onClose={onClose} />,
    );
    const modal = container.querySelector('.vzf-modal')!;
    fireEvent.mouseDown(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the empty state when there are no columns', () => {
    render(<EncodingPicker open viewId="scatter" channel="y" columns={[]} onReencode={() => {}} onClose={() => {}} />);
    expect(screen.getByText('no columns available yet')).toBeTruthy();
  });

  it('a disabled option is natively unclickable — no onReencode/onClose fires', () => {
    const onReencode = vi.fn();
    const onClose = vi.fn();
    render(
      <EncodingPicker
        open
        viewId="scatter"
        channel="y"
        columns={COLS}
        compatible={(_ch, col) => (col.field === 'category' ? { ok: false, reason: 'no' } : { ok: true })}
        onReencode={onReencode}
        onClose={onClose}
      />,
    );
    const disabledBtn = screen.getByRole('button', { name: /category/ }) as HTMLButtonElement;
    expect(disabledBtn.disabled).toBe(true);
    fireEvent.click(disabledBtn);
    expect(onReencode).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
