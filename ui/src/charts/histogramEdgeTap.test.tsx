// @vitest-environment jsdom
/**
 * A TAP AT THE EDGE OF A HISTOGRAM picks the bucket that stands there.
 *
 * Found in review: a tap beside the plot is held at the plot's edge, and the
 * chart worked that pixel back to a value to find its bucket. At the right edge
 * that value could fall past the last bucket's end in its last digit, so the
 * tap cleared the selection where it should have picked the last bucket.
 * Which of the two happened was float luck.
 *
 * | the tap                                          | before                                  | now                          |
 * |--------------------------------------------------|-----------------------------------------|------------------------------|
 * | in the right margin, the last bucket ends there  | cleared, on some charts (float luck)    | the last bucket, always      |
 * | in the left margin, the first bucket starts there| the first bucket                        | the first bucket             |
 * | inside a bucket                                  | that bucket                             | that bucket                  |
 * | at an edge, on a domain wider than the buckets   | cleared: no bucket stands there         | cleared                      |
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { VizHistogram, type HistogramBinDatum } from './VizHistogram.js';

afterEach(cleanup);

// jsdom has no PointerEvent: without one a pointer event carries no clientX and a tap reads NaN
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

/** Tap the histogram at one pixel and hand back what it recorded. */
function tap(bins: readonly HistogramBinDatum[], at: number, props: Partial<Parameters<typeof VizHistogram>[0]> = {}): unknown {
  const onEmit = vi.fn();
  const { container } = render(<VizHistogram data={[...bins]} field="mass" width={420} onEmit={onEmit} {...props} />);
  const svg = container.querySelector('svg.vzf-histogram')!;
  fireEvent.pointerDown(svg, { clientX: at, pointerId: 1 });
  fireEvent.pointerUp(svg, { clientX: at, pointerId: 1 });
  const got = onEmit.mock.calls.at(-1)?.[0].rawValue as unknown;
  cleanup();
  return got;
}
const binsOf = (edges: readonly number[]): HistogramBinDatum[] => edges.slice(1).map((x1, i) => ({ x0: edges[i]!, x1, count: i + 1 }));

describe('a tap at the edge of a histogram', () => {
  it('in the right margin picks the last bucket: the case a reviewer found, logarithmic', () => {
    const edges = [2.2366, 20.068, 180.06, 1615.578467852089];
    expect(tap(binsOf(edges), 420 + 10, { domain: { transform: { x: 'log' } } })).toEqual([180.06, 1615.578467852089]);
  });

  it('in either margin picks the bucket that stands there: 200 logarithmic and 200 linear histograms', () => {
    let seed = 41;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 400; run++) {
      const log = run % 2 === 0;
      const start = log ? 10 ** (next() * 8 - 4) : (next() - 0.5) * 10 ** (next() * 6);
      const edges = [start];
      for (let i = 0; i < 3; i++) edges.push(log ? edges[i]! * (1.5 + next() * 20) : edges[i]! + 0.5 + next() * 10 ** (next() * 4));
      const bins = binsOf(edges);
      const props = log ? { domain: { transform: { x: 'log' as const } } } : {};
      const what = `${log ? 'log' : 'linear'} ${edges.join(' ')}`;
      expect(tap(bins, 420 + 10, props), `${what}: right margin`).toEqual([edges[2], edges[3]]);
      expect(tap(bins, -10, props), `${what}: left margin`).toEqual([edges[0], edges[1]]);
    }
  });

  it('inside a bucket picks that bucket, as before', () => {
    // 0 … 30 across the plot, 30 … 390 px: 200 px is inside the second of three equal buckets
    expect(tap(binsOf([0, 10, 20, 30]), 200)).toEqual([10, 20]);
  });

  it('at an edge of a domain wider than the buckets there is no bucket: the tap clears, as before', () => {
    expect(tap(binsOf([10, 20, 30]), 420 + 10, { domain: { x: [0, 100] } })).toBeNull();
    expect(tap(binsOf([10, 20, 30]), -10, { domain: { x: [0, 100] } })).toBeNull();
  });
});
