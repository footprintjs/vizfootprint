// @vitest-environment jsdom
/**
 * A DRAG ON A SCATTER RECORDS THE VALUE UNDER THE POINTER, AS IT IS.
 *
 * Found in review: a scatter rounded the two ends of a dragged range so they
 * read cleanly. A rounded end has moved: it either leaves out a mark the
 * pointer covered or takes in one it did not. A drag across the whole plot,
 * where the smallest or the largest value can stand on the edge, left that
 * value outside its own range about half the time. The line chart never
 * rounded (`numericSpan`); the scatter now follows the same rule.
 *
 * | the drag                                               | before                                   | now                                      |
 * |--------------------------------------------------------|------------------------------------------|------------------------------------------|
 * | between two pixels inside the plot                     | each end rounded to the nearest          | the scale's own inverse of each pixel    |
 * | to or past an edge of the plot                         | the edge's inverse, rounded              | the axis's own end, exactly              |
 * | across the whole plot, logarithmic x                   | lowest or highest point often left out   | both ends inside                         |
 * | across the whole plot, linear x on a declared domain   | lowest or highest point sometimes out    | both ends inside                         |
 * | any drag                                               | a covered point could fall just outside  | every covered point is inside, no other  |
 * | a logarithmic axis narrower than one part in 1e10      | highest point left out                   | inside                                   |
 * | a release under 4 px                                   | the cleared interval                     | the same                                 |
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { VizScatter } from './VizScatter.js';
import { linearScale, logScale } from '../primitives/scales.js';

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
const points = (xs: readonly number[]) => xs.map((x, i) => ({ id: `p${String(i)}`, x, y: i }));
const LOG = { transform: { x: 'log' as const } };

/** Drag across the chart's svg and hand back what was recorded. */
function drag(container: HTMLElement, from: number, to: number, onEmit: ReturnType<typeof vi.fn>): [number, number] | null {
  const svg = container.querySelector('svg.vzf-scatter')!;
  fireEvent.pointerDown(svg, { clientX: from, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: to, pointerId: 1 });
  return onEmit.mock.calls.at(-1)![0].rawValue as [number, number] | null;
}

describe('a drag on a scatter records the scale’s own inverse of each pixel', () => {
  it('linear: 100.3 px to 300.7 px on a 0 … 1000 axis, to the last digit a number holds', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points([0, 500, 1000])} domain={{ x: [0, 1000] }} width={520} xField="mass" onEmit={onEmit} />);
    const x = linearScale(0, 1000, 52, 502);
    expect(drag(container, 100.3, 300.7, onEmit)).toEqual([x.invert(100.3), x.invert(300.7)]);
    // it used to record [107.33, 552.67]
    expect(x.invert(100.3)).toBeCloseTo(107.3333333, 6);
  });

  it('logarithmic: the same, on the curve', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points([1, 10, 100, 1000])} domain={{ x: [1, 1000], ...LOG }} width={520} xField="mass" onEmit={onEmit} />);
    const x = logScale(1, 1000, 52, 502);
    expect(drag(container, 197, 357, onEmit)).toEqual([x.invert(197), x.invert(357)]);
  });

  it('a reversed drag records the same range, low end first', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points([0, 500, 1000])} domain={{ x: [0, 1000] }} width={520} xField="mass" onEmit={onEmit} />);
    const forward = drag(container, 100.3, 300.7, onEmit);
    expect(drag(container, 300.7, 100.3, onEmit)).toEqual(forward);
  });

  it('a release under 4 px records the cleared interval, as before', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points([0, 500, 1000])} width={520} xField="mass" onEmit={onEmit} />);
    expect(drag(container, 200, 202, onEmit)).toBeNull();
  });
});

describe('a pointer held at an edge of the plot is at the axis’s own end', () => {
  it('a drag that starts left of the plot and ends right of it records the axis’s two ends exactly', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points([123456.789, 500000, 987654.321])} domain={LOG} width={520} xField="mass" onEmit={onEmit} />);
    // it used to record [123460, 987650], which holds neither end
    expect(drag(container, -40, 560, onEmit)).toEqual([123456.789, 987654.321]);
  });

  it('…and exactly at the edge pixels too, on a declared linear domain', () => {
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points([0.1, 0.2, 0.7])} domain={{ x: [0.1, 0.7] }} width={520} xField="mass" onEmit={onEmit} />);
    expect(drag(container, 52, 502, onEmit)).toEqual([0.1, 0.7]);
  });

  it('across the whole plot holds the lowest and the highest point: 200 logarithmic charts and 200 linear ones on a declared domain', () => {
    const next = random(9);
    for (let run = 0; run < 400; run++) {
      const log = run % 2 === 0;
      const lo = log ? 10 ** (next() * 12 - 6) : (next() - 0.5) * 10 ** (next() * 8 - 2);
      const xs = log ? [lo, lo * (1 + next() * 50), lo * (60 + next() * 10 ** (next() * 6))] : [lo, lo + 1 + next() * 500, lo + 600 + next() * 10 ** (next() * 6)];
      // the marks stand ON the plot's two edges: a logarithmic axis takes no room, and a declared domain is drawn as declared
      const domain = log ? LOG : { x: [xs[0]!, xs[2]!] as const };
      const onEmit = vi.fn();
      const { container } = render(<VizScatter data={points(xs)} domain={domain} width={520} xField="mass" onEmit={onEmit} />);
      const [a, b] = drag(container, -40, 560, onEmit)!;
      const what = `${log ? 'log' : 'linear'} ${xs.join(' ')} → [${String(a)}, ${String(b)}]`;
      expect(a, what).toBe(xs[0]);
      expect(b, what).toBe(xs[2]);
      cleanup();
    }
  });

  it('on a logarithmic axis narrower than a number can step across, the highest point is still inside', () => {
    // seven points over a ratio of about 1 + 6.7e-12: the inverse of the right edge fell just short of the top
    const base = 4.4732122632036744e198;
    const top = 4.4732122632338654e198;
    const xs = Array.from({ length: 7 }, (_, i) => base + ((top - base) * i) / 6);
    const onEmit = vi.fn();
    const { container } = render(<VizScatter data={points(xs)} domain={LOG} width={637} xField="mass" onEmit={onEmit} />);
    const [a, b] = drag(container, -40, 700, onEmit)!;
    expect(a).toBe(xs[0]);
    expect(b).toBe(xs[6]);
  });
});

describe('what a drag covers is what it records', () => {
  it('every point whose mark the pointer covered is inside the range, and no point more than a hundredth of a pixel outside it is (300 charts, 5 points each)', () => {
    const next = random(21);
    let covered = 0;
    let outside = 0;
    for (let run = 0; run < 300; run++) {
      const log = run % 2 === 0;
      const base = log ? 10 ** (next() * 8 - 4) : (next() - 0.5) * 2000;
      const xs = Array.from({ length: 5 }, () => (log ? base * 10 ** (next() * 3) : base + next() * 10 ** (1 + next() * 3))).sort((p, q) => p - q);
      const onEmit = vi.fn();
      const { container } = render(<VizScatter data={points(xs)} {...(log ? { domain: LOG } : {})} width={520} xField="mass" onEmit={onEmit} />);
      const dots = [...container.querySelectorAll('circle.vzf-dot')].map((c) => Number(c.getAttribute('cx')));
      const [from, to] = [40 + next() * 200, 280 + next() * 240];
      const [a, b] = drag(container, from, to, onEmit)!;
      // the brush holds the pointer inside the plot, 52 … 502
      const [left, right] = [Math.max(52, from), Math.min(502, to)];
      xs.forEach((x, i) => {
        const what = `${log ? 'log' : 'linear'} point ${String(x)} at ${String(dots[i])}px, drag ${String(left)}…${String(right)} → [${String(a)}, ${String(b)}]`;
        if (dots[i]! >= left && dots[i]! <= right) {
          covered += 1;
          expect(x >= a && x <= b, what).toBe(true);
        } else if (dots[i]! < left - 0.01 || dots[i]! > right + 0.01) {
          outside += 1;
          expect(x < a || x > b, what).toBe(true);
        }
      });
      cleanup();
    }
    expect(covered).toBeGreaterThan(400);
    expect(outside).toBeGreaterThan(400);
  });
});
