// @vitest-environment jsdom
/**
 * A DRAGGED RANGE HOLDS EVERYTHING THE POINTER COVERED.
 *
 * Found in review: a scatter rounds the two ends of a dragged range so they
 * read cleanly, and it rounded each to the nearest. A drag that reaches the
 * edge of the plot is held at the axis's own end, where the smallest or the
 * largest value can stand, and rounding that end to the nearest left the value
 * outside its own range about half the time.
 *
 * | the drag                                         | before                                  | now                                     |
 * |--------------------------------------------------|-----------------------------------------|-----------------------------------------|
 * | across the whole plot, logarithmic x             | lowest or highest point often left out  | both ends inside                        |
 * | across the whole plot, linear x                  | lowest or highest point sometimes out   | both ends inside                        |
 * | any drag                                         | a covered point could fall just outside | every covered point is inside           |
 * | a bound that needs no rounding                   | as it is                                | as it is                                |
 * | how far a bound may move                         | half a step of the last digit           | less than one step, always outward      |
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { VizScatter } from './VizScatter.js';
import { roundToAxis } from '../primitives/scales.js';

afterEach(cleanup);

// jsdom has no PointerEvent: without one a pointer event carries no clientX and a drag reads NaN
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

const random = (seed: number) => (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

describe('roundToAxis — to one side', () => {
  it('down never answers more than the value, up never less, and both are one of the two neighbouring rounded values', () => {
    // linear, an axis ten wide: hundredths
    expect(roundToAxis(2.676, 10, undefined, undefined, 'down')).toBe(2.67);
    expect(roundToAxis(2.676, 10, undefined, undefined, 'up')).toBe(2.68);
    expect(roundToAxis(2.671, 10, undefined, undefined, 'down')).toBe(2.67);
    expect(roundToAxis(2.671, 10, undefined, undefined, 'up')).toBe(2.68);
    expect(roundToAxis(-2.676, 10, undefined, undefined, 'down')).toBe(-2.68);
    expect(roundToAxis(-2.676, 10, undefined, undefined, 'up')).toBe(-2.67);
    // logarithmic: four significant digits
    expect(roundToAxis(123456.789, 0, 'log', undefined, 'down')).toBe(123400);
    expect(roundToAxis(123456.789, 0, 'log', undefined, 'up')).toBe(123500);
    expect(roundToAxis(987654.321, 0, 'log', undefined, 'down')).toBe(987600);
    expect(roundToAxis(987654.321, 0, 'log', undefined, 'up')).toBe(987700);
  });

  it('a value that needs no rounding is itself, whichever way', () => {
    for (const toward of ['down', 'up'] as const) {
      expect(roundToAxis(2.67, 10, undefined, undefined, toward)).toBe(2.67);
      expect(roundToAxis(0, 10, undefined, undefined, toward)).toBe(0);
      expect(roundToAxis(1234, 0, 'log', undefined, toward)).toBe(1234);
      expect(roundToAxis(0, 0, 'log', undefined, toward)).toBe(0);
      expect(roundToAxis(Number.NaN, 10, undefined, undefined, toward)).toBeNaN();
      expect(roundToAxis(Infinity, 10, undefined, undefined, toward)).toBe(Infinity);
    }
  });

  it('with no side asked it rounds to the nearest, as before', () => {
    expect(roundToAxis(2.676, 10)).toBe(2.68);
    expect(roundToAxis(2.671, 10)).toBe(2.67);
    expect(roundToAxis(123456.789, 0, 'log')).toBe(123500);
  });

  it('20,000 generated values, linear and logarithmic: down ≤ value ≤ up, each within one step of the nearest', () => {
    const next = random(3);
    for (let run = 0; run < 20000; run++) {
      const log = next() < 0.5;
      const value = (log ? 1 : next() < 0.5 ? -1 : 1) * 10 ** (next() * 16 - 8) * (1 + next());
      const span = 10 ** (next() * 10 - 5);
      const kind = log ? ('log' as const) : undefined;
      const pixel = log ? Math.abs(value) * 10 ** (-next() * 8) : undefined;
      const [down, nearest, up] = [roundToAxis(value, span, kind, pixel, 'down'), roundToAxis(value, span, kind, pixel), roundToAxis(value, span, kind, pixel, 'up')];
      const what = `${String(value)} span ${String(span)} ${log ? 'log' : 'linear'}`;
      expect(down, what).toBeLessThanOrEqual(value);
      expect(up, what).toBeGreaterThanOrEqual(value);
      expect([down, up], what).toContain(nearest);
      if (down !== up) expect(nearest === value, what).toBe(false);
    }
  });
});

describe('a drag on a scatter', () => {
  /** Drag across the chart's svg and hand back the recorded range. */
  const drag = (container: HTMLElement, from: number, to: number, onEmit: ReturnType<typeof vi.fn>): [number, number] => {
    const svg = container.querySelector('svg.vzf-scatter')!;
    fireEvent.pointerDown(svg, { clientX: from, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: to, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: to, pointerId: 1 });
    return onEmit.mock.calls.at(-1)![0].rawValue as [number, number];
  };

  it('across the whole plot holds the lowest and the highest point: 200 logarithmic and 200 linear charts', () => {
    const next = random(9);
    for (let run = 0; run < 400; run++) {
      const log = run % 2 === 0;
      const lo = log ? 10 ** (next() * 12 - 6) : (next() - 0.5) * 10 ** (next() * 8 - 2);
      const xs = log ? [lo, lo * (1 + next() * 50), lo * (60 + next() * 10 ** (next() * 6))] : [lo, lo + 1 + next() * 500, lo + 600 + next() * 10 ** (next() * 6)];
      const onEmit = vi.fn();
      const { container } = render(<VizScatter data={xs.map((x, i) => ({ id: `p${String(i)}`, x, y: i }))} {...(log ? { domain: { transform: { x: 'log' as const } } } : {})} width={520} xField="mass" onEmit={onEmit} />);
      const [a, b] = drag(container, -40, 560, onEmit);
      const what = `${log ? 'log' : 'linear'} ${xs.join(' ')} → [${String(a)}, ${String(b)}]`;
      expect(a, what).toBeLessThanOrEqual(xs[0]!);
      expect(b, what).toBeGreaterThanOrEqual(xs[2]!);
      cleanup();
    }
  });

  it('any drag holds every point whose mark the pointer covered (300 charts, 5 points each)', () => {
    const next = random(21);
    let covered = 0;
    for (let run = 0; run < 300; run++) {
      const log = run % 2 === 0;
      const base = log ? 10 ** (next() * 8 - 4) : (next() - 0.5) * 2000;
      const xs = Array.from({ length: 5 }, () => (log ? base * 10 ** (next() * 3) : base + next() * 10 ** (1 + next() * 3))).sort((p, q) => p - q);
      const onEmit = vi.fn();
      const { container } = render(<VizScatter data={xs.map((x, i) => ({ id: `p${String(i)}`, x, y: i }))} {...(log ? { domain: { transform: { x: 'log' as const } } } : {})} width={520} xField="mass" onEmit={onEmit} />);
      const dots = [...container.querySelectorAll('circle.vzf-dot')].map((c) => Number(c.getAttribute('cx')));
      const [from, to] = [40 + next() * 200, 280 + next() * 240];
      const [a, b] = drag(container, from, to, onEmit);
      // the brush holds the pointer inside the plot, 52 … 502
      const [left, right] = [Math.max(52, from), Math.min(502, to)];
      xs.forEach((x, i) => {
        if (dots[i]! < left || dots[i]! > right) return;
        covered += 1;
        expect(x >= a && x <= b, `${log ? 'log' : 'linear'} point ${String(x)} at ${String(dots[i])}px, drag ${String(left)}…${String(right)} → [${String(a)}, ${String(b)}]`).toBe(true);
      });
      cleanup();
    }
    expect(covered).toBeGreaterThan(400);
  });

  it('a bound moves outward by less than one step of its last digit: a linear axis of a thousand is read to hundredths', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={[0, 500, 1000].map((x, i) => ({ id: `p${String(i)}`, x, y: i }))} domain={{ x: [0, 1000] }} width={520} xField="mass" onEmit={onEmit} />);
    // the plot is 450 px for 1000: 100.3 px and 300.7 px are 107.333… and 552.666…
    const [a, b] = drag(container, 100.3, 300.7, onEmit);
    expect(a).toBe(107.33);
    expect(b).toBe(552.67);
  });
});
