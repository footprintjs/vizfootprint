// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VizDashboard } from './VizDashboard.js';
import { VizPanel, VizCard } from './VizPanel.js';

afterEach(cleanup);

describe('VizDashboard', () => {
  it('renders slots into the grid and carries the .vzf scoping root', () => {
    const { container } = render(
      <VizDashboard top={<div>T</div>} main={<div>M</div>} side={<div>S</div>} bottom={<div>B</div>} />,
    );
    expect(container.querySelector('.vzf.vzf-root')).not.toBeNull();
    expect(container.querySelector('.vzf-slot-top')?.textContent).toBe('T');
    expect(container.querySelector('.vzf-slot-main')?.textContent).toBe('M');
    expect(container.querySelector('.vzf-slot-side')?.textContent).toBe('S');
    expect(container.querySelector('.vzf-slot-bottom')?.textContent).toBe('B');
  });

  it('applies theme variables + data-theme onto the scoping root', () => {
    const { container } = render(<VizDashboard theme={{ mode: 'dark', colors: { brand: '#112233' } }} main={<div />} />);
    const root = container.querySelector('.vzf-root') as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--vzf-brand')).toBe('#112233');
  });

  it('readOnly dims the acting slots and shows the note', () => {
    const { container } = render(<VizDashboard readOnly main={<div>charts</div>} />);
    expect(container.querySelector('.vzf-dashboard')?.classList.contains('vzf-readonly')).toBe(true);
    expect(container.querySelector('[data-readonly="true"]')).not.toBeNull();
    expect(container.querySelector('.vzf-readonly-note')).not.toBeNull();
  });

  it('accepts children as an alias for the main slot', () => {
    const { container } = render(
      <VizDashboard>
        <div>childmain</div>
      </VizDashboard>,
    );
    expect(container.querySelector('.vzf-slot-main')?.textContent).toBe('childmain');
  });
});

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
