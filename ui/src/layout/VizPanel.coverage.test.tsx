// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { VizPanel, VizCard } from './VizPanel.js';

afterEach(cleanup);

describe('VizCard edges', () => {
  it('appends a supplied className', () => {
    const { container } = render(<VizCard className="extra" title="T">body</VizCard>);
    expect(container.querySelector('.vzf-card.extra')).not.toBeNull();
  });

  it('renders the header from actions alone when there is no title', () => {
    const { container } = render(<VizCard actions={<button>go</button>}>body</VizCard>);
    const head = container.querySelector('.vzf-panel-head');
    expect(head).not.toBeNull();
    expect(head?.querySelector('.vzf-section-head')).toBeNull(); // no title span
    expect(head?.querySelector('button')?.textContent).toBe('go');
  });
});

describe('VizPanel edges', () => {
  it('appends a supplied className', () => {
    const { container } = render(<VizPanel title="P" className="extra">x</VizPanel>);
    expect(container.querySelector('.vzf-panel.extra')).not.toBeNull();
  });

  it('a non-collapsible panel ignores header clicks — no state change, no onToggle call', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <VizPanel title="Static" collapsible={false} onToggle={onToggle}>
        <div>x</div>
      </VizPanel>,
    );
    const panel = container.querySelector('.vzf-panel')!;
    fireEvent.click(container.querySelector('.vzf-panel-head')!);
    expect(panel.classList.contains('vzf-collapsed')).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('a controlled `collapsed` prop drives the DOM directly and still fires onToggle', () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <VizPanel title="Controlled" collapsed={false} onToggle={onToggle}>
        <div>x</div>
      </VizPanel>,
    );
    const panel = container.querySelector('.vzf-panel')!;
    fireEvent.click(container.querySelector('.vzf-panel-head')!);
    expect(onToggle).toHaveBeenCalledWith(true);
    // the parent didn't feed the new value back — controlled means the DOM does NOT flip on its own
    expect(panel.classList.contains('vzf-collapsed')).toBe(false);
    rerender(
      <VizPanel title="Controlled" collapsed onToggle={onToggle}>
        <div>x</div>
      </VizPanel>,
    );
    expect(panel.classList.contains('vzf-collapsed')).toBe(true);
  });

  it('Enter and Space on the header toggle collapse; an unrelated key does nothing', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <VizPanel title="Keyboard" onToggle={onToggle}>
        <div>x</div>
      </VizPanel>,
    );
    const head = container.querySelector('.vzf-panel-head')!;
    fireEvent.keyDown(head, { key: 'Tab' });
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.keyDown(head, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith(true);
    fireEvent.keyDown(head, { key: ' ' });
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
