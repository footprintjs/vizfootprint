/**
 * src/data/bins — the host-side equal-width binning helper (v1): numeric +
 * date domains, honest skipping of unusable values, mixed-domain refusal,
 * fixed-edge recounting (the crossfilter recompute), and the edge-precision
 * rule (day-precision ISO edges on UTC midnights so they compare with
 * date-only column values).
 */
import { describe, it, expect } from 'vitest';
import { equalWidthBins, recountBins } from './bins.js';

describe('equalWidthBins — numeric domain', () => {
  it('divides [min, max] into equal-width buckets and counts right-open (last closed)', () => {
    const r = equalWidthBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { buckets: 5 });
    expect(r.domain).toBe('number');
    expect(r.bins.map((b) => [b.x0, b.x1])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
      [8, 10],
    ]);
    // 0,1 | 2,3 | 4,5 | 6,7 | 8,9,10 — the maximum folds into the CLOSED last bucket
    expect(r.bins.map((b) => b.count)).toEqual([2, 2, 2, 2, 3]);
  });

  it('a value exactly on an interior edge counts in the RIGHT bucket (right-open rule)', () => {
    const r = equalWidthBins([0, 5, 10], { buckets: 2 });
    expect(r.bins.map((b) => b.count)).toEqual([1, 2]); // 5 lands in [5, 10]
  });

  it('defaults to 10 buckets; fractional/low bucket counts clamp to a whole ≥ 1', () => {
    expect(equalWidthBins([0, 10]).bins).toHaveLength(10);
    expect(equalWidthBins([0, 10], { buckets: 2.9 }).bins).toHaveLength(2);
    expect(equalWidthBins([0, 10], { buckets: 0 }).bins).toHaveLength(1);
  });

  it('skips NaN and non-finite numbers — never guessed into a bucket', () => {
    const r = equalWidthBins([0, NaN, 10, Infinity, -Infinity], { buckets: 2 });
    expect(r.bins.map((b) => b.count)).toEqual([1, 1]);
  });

  it('empty (or all-unusable) input → zero buckets, numeric domain', () => {
    expect(equalWidthBins([])).toEqual({ domain: 'number', bins: [] });
    expect(equalWidthBins([NaN, 'not a date'])).toEqual({ domain: 'number', bins: [] });
  });

  it('an all-equal input → ONE degenerate zero-width bucket holding everything', () => {
    const r = equalWidthBins([7, 7, 7], { buckets: 4 });
    expect(r.bins).toEqual([{ x0: 7, x1: 7, count: 3 }]);
  });

  it('the last upper edge is EXACTLY the maximum (no floating drift)', () => {
    const r = equalWidthBins([0.1, 0.7], { buckets: 3 });
    expect(r.bins[r.bins.length - 1]!.x1).toBe(0.7);
  });
});

describe('equalWidthBins — date domain (ISO-8601 strings)', () => {
  it('bins by epoch; whole-day spans yield day-precision edges comparable with date-only values', () => {
    const r = equalWidthBins(['2026-04-01', '2026-04-03', '2026-04-05', '2026-04-09'], { buckets: 2 });
    expect(r.domain).toBe('date');
    // span = 8 days → two 4-day buckets, every edge a UTC midnight → date-only strings
    expect(r.bins.map((b) => [b.x0, b.x1])).toEqual([
      ['2026-04-01', '2026-04-05'],
      ['2026-04-05', '2026-04-09'],
    ]);
    expect(r.bins.map((b) => b.count)).toEqual([2, 2]); // 04-05 lands right (right-open rule)
  });

  it('an edge NOT on a UTC midnight comes back as full ISO (still lexicographically ordered)', () => {
    const r = equalWidthBins(['2026-04-01', '2026-04-02'], { buckets: 2 });
    expect(r.bins[0]!.x1).toBe('2026-04-01T12:00:00.000Z'); // half-day edge
    expect(r.bins[0]!.x0 < (r.bins[0]!.x1 as string)).toBe(true);
    expect(r.bins.map((b) => b.count)).toEqual([1, 1]);
  });

  it('skips unparseable date strings — never guessed', () => {
    const r = equalWidthBins(['2026-04-01', 'not a date', '2026-04-09'], { buckets: 2 });
    expect(r.bins.map((b) => b.count)).toEqual([1, 1]);
  });

  it('a pre-1970 (negative-epoch) midnight still renders day-precision', () => {
    const r = equalWidthBins(['1969-12-01', '1969-12-09'], { buckets: 2 });
    expect(r.bins.map((b) => [b.x0, b.x1])).toEqual([
      ['1969-12-01', '1969-12-05'],
      ['1969-12-05', '1969-12-09'],
    ]);
  });
});

describe('equalWidthBins — mixed domains refuse', () => {
  it('numbers and dates in one call throw (bin one column at a time)', () => {
    expect(() => equalWidthBins([1, '2026-04-01'])).toThrowError(/mixed numeric and date values/);
  });
});

describe('recountBins — the crossfilter recompute (fixed edges, new counts)', () => {
  const all = equalWidthBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { buckets: 5 });

  it('refills the SAME edges with the kept values (edges never move)', () => {
    const r = recountBins(all, [0, 9, 10]);
    expect(r.bins.map((b) => [b.x0, b.x1])).toEqual(all.bins.map((b) => [b.x0, b.x1]));
    expect(r.bins.map((b) => b.count)).toEqual([1, 0, 0, 0, 2]);
  });

  it('the upper bound stays closed: the maximum still lands in the last bucket', () => {
    expect(recountBins(all, [10]).bins[4]!.count).toBe(1);
  });

  it('skips values outside the fixed edges (no bucket invented for them)', () => {
    const r = recountBins(all, [-5, 3, 99]);
    expect(r.bins.map((b) => b.count)).toEqual([0, 1, 0, 0, 0]); // only 3 lands; -5/99 skipped
  });

  it('skips other-type and unusable values — the no-cross-type-coercion rule', () => {
    const r = recountBins(all, ['2026-04-01', NaN, 3]);
    expect(r.bins.map((b) => b.count)).toEqual([0, 1, 0, 0, 0]);
  });

  it('date bins recount by epoch; date-only and full-ISO values both land', () => {
    const dates = equalWidthBins(['2026-04-01', '2026-04-09'], { buckets: 2 });
    const r = recountBins(dates, ['2026-04-02', '2026-04-06T06:00:00.000Z', 'junk', 5]);
    expect(r.bins.map((b) => b.count)).toEqual([1, 1]); // junk + the number both skipped
  });

  it('empty bins recount to empty', () => {
    expect(recountBins({ domain: 'number', bins: [] }, [1, 2])).toEqual({ domain: 'number', bins: [] });
  });

  it('a degenerate single zero-width bucket recounts its exact value only', () => {
    const one = equalWidthBins([7, 7], { buckets: 3 });
    expect(recountBins(one, [7, 7, 7, 8]).bins).toEqual([{ x0: 7, x1: 7, count: 3 }]);
  });
});
