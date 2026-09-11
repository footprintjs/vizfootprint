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

describe('the accessible name (the prose plane\'s altShort)', () => {
  it('takes ariaLabel over its own construction line', () => {
    const { container } = render(<VizScatter data={[]} xField="price" yField="rating" ariaLabel="Cases by report state" />);
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Cases by report state');
  });
});

describe('VizScatter — the y axis on the RIGHT edge (the second axis of a frame)', () => {
  const ROWS = [
    { id: 'a', x: 10, y: 2 },
    { id: 'b', x: 90, y: 8 },
  ];
  /** Every y tick of a chart — a tick group whose stroke is HORIZONTAL — with where its text sits and which way it reads. */
  const yTicksOf = (container: Element): { x: number; anchor: string | null }[] =>
    [...container.querySelectorAll('g')]
      .filter((g) => {
        const line = g.querySelector(':scope > line.vzf-axis');
        return line !== null && g.querySelector(':scope > text.vzf-tick') !== null && line.getAttribute('y1') === line.getAttribute('y2');
      })
      .map((g) => {
        const text = g.querySelector(':scope > text.vzf-tick')!;
        return { x: Number(text.getAttribute('x')), anchor: text.getAttribute('text-anchor') };
      });
  const yLabelOf = (container: Element): Element => container.querySelector('.vzf-axis-group[data-axis-channel="y"]')!;
  const dotsOf = (container: Element): [number, number][] => [...container.querySelectorAll('circle.vzf-dot')].map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);

  it('absent: byte-identical to the chart before sides existed', () => {
    const plain = render(<VizScatter data={ROWS} width={400} height={300} />).container.innerHTML;
    cleanup();
    const left = render(<VizScatter data={ROWS} width={400} height={300} axisSide="left" />).container.innerHTML;
    expect(left).toBe(plain);
  });

  it('right: the axis line, its ticks (reading rightward) and its label stand on the right edge; the marks are placed exactly as on the left', () => {
    const left = render(<VizScatter data={ROWS} width={400} height={300} />).container;
    const leftDots = dotsOf(left);
    const leftTicks = yTicksOf(left);
    const leftLabel = yLabelOf(left).getAttribute('transform');
    cleanup();
    const right = render(<VizScatter data={ROWS} width={400} height={300} axisSide="right" />).container;
    // the y axis LINE is vertical at the plot's right edge (width − mirrored right pad = 400 − 52)
    const vertical = [...right.querySelectorAll('line.vzf-axis')].filter((l) => l.getAttribute('x1') === l.getAttribute('x2') && l.getAttribute('y1') !== l.getAttribute('y2'));
    expect(vertical.map((l) => l.getAttribute('x1'))).toContain('348');
    // the ticks read rightward, past the edge
    const ticks = yTicksOf(right);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBe(leftTicks.length);
    expect(leftTicks.every((t) => t.anchor === 'end' && t.x === 52 - 8)).toBe(true);
    expect(ticks.every((t) => t.anchor === 'start' && t.x === 348 + 8)).toBe(true);
    // the label faces the right edge: rotated +90 at 14px in from it
    expect(yLabelOf(right).getAttribute('transform')).toBe('rotate(90 386 150)');
    expect(leftLabel).toBe('rotate(-90 14 150)');
    // the marks: the same dots at the same HEIGHTS (the y scale is untouched). The plot box is [18, 348] on the right
    // versus [52, 382] on the left — the SAME width shifted by the swapped margins — so every x moves by exactly −34;
    // a frame undoes that shift by where it places the svg (`padOnSide`, the one owner of the swap).
    expect(dotsOf(right)).toEqual(leftDots.map(([cx, cy]) => [cx - 34, cy]));
  });

  it("axes: 'y' draws the y axis alone — no x line, no x ticks, no x label — for the frame that draws x once", () => {
    const { container } = render(<VizScatter data={ROWS} width={400} height={300} axes="y" axisSide="right" />);
    expect(container.querySelector('.vzf-axis-group[data-axis-channel="x"]')).toBeNull();
    expect(yLabelOf(container)).not.toBeNull();
    // every axis stroke is the vertical y line or a 4px y tick — no baseline runs across the plot
    const baseline = [...container.querySelectorAll('line.vzf-axis')].filter((l) => l.getAttribute('y1') === l.getAttribute('y2') && Math.abs(Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'))) > 4);
    expect(baseline).toHaveLength(0);
    expect(yTicksOf(container).length).toBeGreaterThan(0);
  });
});
