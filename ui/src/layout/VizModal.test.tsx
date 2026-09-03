// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VizModal } from './VizModal.js';

afterEach(cleanup);

describe('VizModal — the one modal system', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <VizModal open={false} onClose={() => {}} title="T">
        body
      </VizModal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('open: dialog semantics — role, aria-modal, the title labels the dialog', () => {
    render(
      <VizModal open onClose={() => {}} title="Commit log">
        body
      </VizModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)?.textContent).toBe('Commit log');
  });

  it('a titleId override wins over the generated id', () => {
    render(
      <VizModal open onClose={() => {}} title="T" titleId="my-title">
        body
      </VizModal>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe('my-title');
    expect(document.getElementById('my-title')).not.toBeNull();
  });

  it("defaults to size 'small'; 'large' stamps the report-surface class", () => {
    const { container, rerender } = render(<VizModal open onClose={() => {}} title="T" />);
    expect(container.querySelector('.vzf-modal-backdrop')?.classList.contains('vzf-modal-small')).toBe(true);
    rerender(<VizModal open onClose={() => {}} title="T" size="large" />);
    expect(container.querySelector('.vzf-modal-backdrop')?.classList.contains('vzf-modal-large')).toBe(true);
  });

  it('stamps data-vzf-modal from `name` and passes className onto the dialog', () => {
    const { container } = render(<VizModal open onClose={() => {}} title="T" name="report-gaps" className="extra" />);
    expect(container.querySelector('[data-vzf-modal="report-gaps"]')).not.toBeNull();
    expect(container.querySelector('.vzf-modal')?.classList.contains('extra')).toBe(true);
  });

  it('renders a footer row only when one is supplied', () => {
    const { container, rerender } = render(<VizModal open onClose={() => {}} title="T" />);
    expect(container.querySelector('.vzf-modal-foot')).toBeNull();
    rerender(<VizModal open onClose={() => {}} title="T" footer={<button>Save</button>} />);
    expect(container.querySelector('.vzf-modal-foot')?.textContent).toBe('Save');
  });

  it('the ✕ button and Esc both close', () => {
    const onClose = vi.fn();
    render(<VizModal open onClose={onClose} title="T" />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a mousedown on the backdrop itself closes; one bubbling from the dialog does not', () => {
    const onClose = vi.fn();
    const { container } = render(<VizModal open onClose={onClose} title="T" />);
    fireEvent.mouseDown(container.querySelector('.vzf-modal')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector('.vzf-modal-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('without initialFocus, focus lands on the first focusable (the ✕ button)', () => {
    render(
      <VizModal open onClose={() => {}} title="T">
        <button>inner</button>
      </VizModal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('an initialFocus selector picks the landing element', () => {
    render(
      <VizModal open onClose={() => {}} title="T" initialFocus=".land-here">
        <button className="land-here">inner</button>
      </VizModal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inner' }));
  });

  it('restores focus to the (HTMLElement) opener when the modal closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<VizModal open onClose={() => {}} title="T" />);
    expect(document.activeElement).not.toBe(opener);
    rerender(<VizModal open={false} onClose={() => {}} title="T" />);
    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });

  // defect 3: an SVG opener (every axis label is one) used to be dropped by an
  // `instanceof HTMLElement` guard — focus fell back to <body>.
  it('restores focus to an SVG opener too (an axis label is an SVG node)', () => {
    const opener = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    opener.setAttribute('tabindex', '0');
    document.body.appendChild(opener);
    (opener as unknown as { focus: () => void }).focus();
    expect(opener instanceof HTMLElement).toBe(false);
    const { rerender } = render(<VizModal open onClose={() => {}} title="T" />);
    expect(document.activeElement).not.toBe(opener);
    rerender(<VizModal open={false} onClose={() => {}} title="T" />);
    expect(document.activeElement).toBe(opener);
    document.body.removeChild(opener);
  });

  it('an opener that is no element at all (nothing focused) restores nothing', () => {
    const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
    const { rerender } = render(<VizModal open onClose={() => {}} title="T" />);
    rerender(<VizModal open={false} onClose={() => {}} title="T" />);
    spy.mockRestore();
    // no throw, nothing focused — the guard simply did not fire
    expect(document.querySelector('.vzf-modal')).toBe(null);
  });

  it('traps Tab: forward from the last focusable wraps to the first', () => {
    render(
      <VizModal open onClose={() => {}} title="T" footer={<button>Save</button>}>
        <input aria-label="field" />
      </VizModal>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});
