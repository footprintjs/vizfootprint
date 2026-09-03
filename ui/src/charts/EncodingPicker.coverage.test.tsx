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

  // REGRESSION (defect 3): the axis affordance that OPENS this picker is an
  // SVG node, and the modal's restore used to be guarded by `instanceof
  // HTMLElement` — false for SVG. Picking a column therefore left focus on
  // <body>: a keyboard user lost their place on every re-encode.
  it('restores focus to an SVG opener (the axis label) when the picker closes', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.setAttribute('tabindex', '0');
    document.body.appendChild(svg);
    (svg as unknown as { focus: () => void }).focus();
    expect(document.activeElement).toBe(svg);
    expect(svg instanceof HTMLElement).toBe(false); // exactly why the old guard dropped it
    const focusSpy = vi.spyOn(svg as unknown as { focus: () => void }, 'focus');

    const { rerender } = render(
      <EncodingPicker open viewId="scatter" channel="y" columns={COLS} onReencode={() => {}} onClose={() => {}} />,
    );
    focusSpy.mockClear();
    rerender(
      <EncodingPicker open={false} viewId="scatter" channel="y" columns={COLS} onReencode={() => {}} onClose={() => {}} />,
    );
    expect(focusSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(svg);
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

describe('EncodingPicker — the two judges (defect 1: the chart may VETO)', () => {
  const FITS = {
    x: [
      { field: 'price', ok: true },
      { field: 'rating', ok: true },
      { field: 'category', ok: false, because: 'x needs a continuous column' },
    ],
  };

  it('a column the SESSION allows but the CHART cannot draw is disabled, marked, and explained in words', () => {
    render(
      <EncodingPicker
        open
        viewId="line"
        channel="x"
        columns={COLS}
        fits={FITS}
        // the chart's own rule: only `rating` is drawable on x here
        compatible={(_ch, col) => (col.field === 'rating' ? { ok: true } : { ok: false, reason: 'the time axis needs a date column' })}
        onReencode={() => {}}
        onClose={() => {}}
      />,
    );
    const price = screen.getByRole('button', { name: /price/ }) as HTMLButtonElement;
    expect(price.disabled, 'the host said yes; the chart says no — the intersection refuses').toBe(true);
    expect(price.getAttribute('data-veto')).toBe('chart');
    expect(price.getAttribute('title')).toContain('the session would allow it, this chart cannot draw it');
    // the chart's own sentence is the visible reason
    expect(price.textContent).toContain('the time axis needs a date column');
    // the host's own refusal keeps the SESSION's sentence and is not marked as a chart veto
    const category = screen.getByRole('button', { name: /category/ }) as HTMLButtonElement;
    expect(category.disabled).toBe(true);
    expect(category.getAttribute('data-veto')).toBe(null);
    expect(category.textContent).toContain('x needs a continuous column');
    // and the note says out loud that ONE column was greyed by the chart
    const note = document.querySelector('[data-vzf="chart-veto-note"]')!;
    // it sits ABOVE the list: a note under a scrolling list is under the fold
    expect(note.compareDocumentPosition(document.querySelector('[role="listbox"]')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the note comes before the columns it explains').toBeTruthy();
    expect(note.textContent).toContain('One column below is greyed by this chart, not by the session');
    // the column both judges accept stays pickable
    expect((screen.getByRole('button', { name: /rating/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('counts the vetoes in plural when more than one column is greyed by the chart', () => {
    render(
      <EncodingPicker
        open
        viewId="line"
        channel="x"
        columns={COLS}
        fits={FITS}
        compatible={() => ({ ok: false, reason: 'this chart plots dates' })}
        onReencode={() => {}}
        onClose={() => {}}
      />,
    );
    // price + rating are host-allowed and chart-refused; category was refused by the host itself
    expect(document.querySelector('[data-vzf="chart-veto-note"]')!.textContent).toContain('2 columns below are greyed by this chart, not by the session');
  });

  it('a chart that refuses without a sentence still gets one', () => {
    render(
      <EncodingPicker open viewId="line" channel="x" columns={COLS} fits={FITS} compatible={() => ({ ok: false })} onReencode={() => {}} onClose={() => {}} />,
    );
    const price = screen.getByRole('button', { name: /price/ }) as HTMLButtonElement;
    expect(price.textContent).toContain('this chart cannot draw it');
    expect(price.getAttribute('title')).toContain('the session would allow it');
  });

  it('with verdicts and NO chart rule, the host decides alone and no note appears', () => {
    render(<EncodingPicker open viewId="line" channel="x" columns={COLS} fits={FITS} onReencode={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('button', { name: /price/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('[data-vzf="chart-veto-note"]')).toBe(null);
  });

  it('announces the new binding politely, and asks for it, when a column is picked', () => {
    const onReencode = vi.fn();
    render(<EncodingPicker open viewId="line" channel="x" columns={COLS} fits={FITS} onReencode={onReencode} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /price/ }));
    expect(onReencode).toHaveBeenCalledWith('line', 'x', 'price');
    const region = document.querySelector('.vzf-live-region')!;
    expect(region.getAttribute('aria-live'), 'polite, never assertive').toBe('polite');
    expect(region.textContent).toBe('x now encodes price');
  });
});
