// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// mirrors charts.test.tsx's PointerEvent polyfill (jsdom ships none)
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

import { VizScatter } from './VizScatter.js';
import type { ColumnView } from '../adapter/types.js';

afterEach(cleanup);

const COLS: ColumnView[] = [
  { field: 'price', type: 'number' },
  { field: 'rating', type: 'number' },
];

describe('VizScatter degenerate/empty data', () => {
  it('renders no dots and a safe default axis domain when data is empty', () => {
    const { container } = render(<VizScatter data={[]} xField="price" yField="rating" />);
    expect(container.querySelectorAll('circle.vzf-dot')).toHaveLength(0);
    // the chart must still render without throwing (extent's empty-rows guard)
    expect(container.querySelector('svg.vzf-scatter')).toBeTruthy();
  });
});

describe('VizScatter styling / props', () => {
  it('appends the className prop to the chart svg', () => {
    const data = [{ id: '1', x: 1, y: 1 }];
    const { container } = render(<VizScatter data={data} className="extra-class" />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    expect(svg.getAttribute('class')).toBe('vzf-chart vzf-scatter extra-class');
  });

  it('uses colorOf for dot fill when provided', () => {
    const data = [
      { id: '1', x: 1, y: 1, category: 'A' },
      { id: '2', x: 2, y: 2, category: 'B' },
    ];
    const colorOf = vi.fn((c: string | undefined) => (c === 'A' ? '#111111' : '#222222'));
    const { container } = render(<VizScatter data={data} colorOf={colorOf} />);
    expect(colorOf).toHaveBeenCalledWith('A');
    expect(colorOf).toHaveBeenCalledWith('B');
    const dots = container.querySelectorAll('circle.vzf-dot');
    expect(dots[0]!.getAttribute('fill')).toBe('#111111');
    expect(dots[1]!.getAttribute('fill')).toBe('#222222');
  });

  it('renders a regression overlay line when `regression` is provided', () => {
    const data = [{ id: '1', x: 0, y: 0 }];
    const { container } = render(
      <VizScatter data={data} regression={{ slope: 2, intercept: 1, domain: [0, 10] }} />,
    );
    const line = container.querySelector('line.vzf-regline');
    expect(line).toBeTruthy();
  });

  it('renders no regression overlay when `regression` is null/omitted', () => {
    const data = [{ id: '1', x: 0, y: 0 }];
    const { container } = render(<VizScatter data={data} regression={null} />);
    expect(container.querySelector('line.vzf-regline')).toBeNull();
  });

  it('a dot without a category omits the " · category" segment from its title', () => {
    const data = [{ id: '1', x: 5, y: 5 }]; // no `category`
    const { container } = render(<VizScatter data={data} xLabel="price" yLabel="rating" />);
    const title = container.querySelector('circle.vzf-dot title')!;
    expect(title.textContent).toBe('1 · price 5 · rating 5');
    expect(title.textContent).not.toContain(' · undefined');
  });
});

describe('VizScatter x-axis encoding picker (default currentField branch)', () => {
  it('opening the x-axis picker (no encoding prop) defaults currentField to xField', () => {
    const data = [{ id: '1', x: 1, y: 1 }];
    render(<VizScatter data={data} xField="price" yField="rating" columns={COLS} />);
    fireEvent.click(screen.getByRole('button', { name: /Encode the x axis/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /price/ }).getAttribute('aria-current')).toBe('true');
  });
});

describe('VizScatter pointer edge cases', () => {
  it('a pointermove with no prior pointerdown is a no-op (no brush, no emit)', () => {
    const onEmit = vi.fn();
    const data = [{ id: '1', x: 1, y: 1 }];
    const { container } = render(<VizScatter data={data} onEmit={onEmit} />);
    const svg = container.querySelector('svg.vzf-scatter')!;
    fireEvent.pointerMove(svg, { clientX: 200, pointerId: 1 });
    expect(container.querySelector('rect.vzf-brush')).toBeNull();
    expect(onEmit).not.toHaveBeenCalled();
  });
});
