// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VizPanel, VizCard } from './VizPanel.js';

afterEach(cleanup);

describe('VizPanel / VizCard', () => {
  it('VizCard renders a title + children', () => {
    render(<VizCard title="Commit log">body</VizCard>);
    expect(screen.getByText('Commit log')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('VizPanel collapses/expands on header click (uncontrolled) and fires onToggle', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <VizPanel title="Gaps" onToggle={onToggle}>
        <div>panelbody</div>
      </VizPanel>,
    );
    const panel = container.querySelector('.vzf-panel')!;
    expect(panel.classList.contains('vzf-collapsed')).toBe(false);
    fireEvent.click(container.querySelector('.vzf-panel-head')!);
    expect(panel.classList.contains('vzf-collapsed')).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('a non-collapsible panel has no toggle affordance', () => {
    const { container } = render(
      <VizPanel title="Static" collapsible={false}>
        <div>x</div>
      </VizPanel>,
    );
    expect(container.querySelector('.vzf-panel-toggle')).toBeNull();
    expect(container.querySelector('.vzf-panel-head')?.getAttribute('role')).toBeNull();
  });
});
