/**
 * stats.coverage.test.ts — direct unit tests of the pure numeric kernels,
 * closing the edge-case gaps the integration tests (builtins.test.ts,
 * defineAnalysis.test.ts) never exercise: the `quantileBins` guard, `pearson`
 * with too few points, a tie-broken quantile sort, a zero-variance `ols` fit,
 * and `normalApproxPValue`'s early-return branches.
 */

import { describe, it, expect } from 'vitest';
import { mean, ols, pearson, quantileBins, normalApproxPValue } from './stats.js';

describe('mean', () => {
  it('is the arithmetic mean of a non-empty array', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('quantileBins', () => {
  it('throws for k < 1', () => {
    expect(() => quantileBins([1, 2, 3], 0)).toThrow(
      new Error('quantileBins: k must be >= 1'),
    );
  });

  it('throws for a negative k', () => {
    expect(() => quantileBins([1, 2, 3], -2)).toThrow(Error);
  });

  it('ties are broken by original index (stable), not left to sort() order', () => {
    // Four EQUAL values: the sort comparator's `a.v - b.v` is 0 for every
    // pair, forcing the `|| a.i - b.i` tie-break to decide the order — which
    // must reproduce original index order (bin ids increase with index).
    const bins = quantileBins([5, 5, 5, 5], 4);
    expect(bins).toEqual([0, 1, 2, 3]);
  });

  it('a mix of tied and distinct values still bins deterministically by (value, then index)', () => {
    const bins = quantileBins([10, 5, 5, 20], 2);
    // sorted by (value, index): 5(i=1), 5(i=2), 10(i=0), 20(i=3)
    // ranks:                     0        1       2        3
    // k=2 -> bin = floor(rank*2/4): 0,0,1,1
    expect(bins[1]).toBe(0); // value 5 at i=1 -> rank 0
    expect(bins[2]).toBe(0); // value 5 at i=2 -> rank 1
    expect(bins[0]).toBe(1); // value 10 -> rank 2
    expect(bins[3]).toBe(1); // value 20 -> rank 3
  });

  it('k = 1 puts everything in bin 0', () => {
    expect(quantileBins([3, 1, 2], 1)).toEqual([0, 0, 0]);
  });
});

describe('pearson', () => {
  it('n < 2 (too few paired points) returns {r: NaN, n} without dividing by zero', () => {
    expect(pearson([], [])).toEqual({ r: Number.NaN, n: 0 });
    expect(pearson([1], [2])).toEqual({ r: Number.NaN, n: 1 });
  });

  it('n uses the SHORTER of the two arrays', () => {
    expect(pearson([1], [2, 3]).n).toBe(1);
  });

  it('a zero-variance x (denom === 0) returns {r: NaN, n} rather than NaN-propagating silently uncaught', () => {
    const { r, n } = pearson([5, 5, 5], [1, 2, 3]);
    expect(Number.isNaN(r)).toBe(true);
    expect(n).toBe(3);
  });

  it('perfectly correlated data gives r = 1', () => {
    const { r } = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
    expect(r).toBeCloseTo(1, 10);
  });

  it('perfectly anti-correlated data gives r = -1', () => {
    const { r } = pearson([1, 2, 3, 4], [8, 6, 4, 2]);
    expect(r).toBeCloseTo(-1, 10);
  });
});

describe('ols', () => {
  it('a zero-variance x (sxx === 0) yields slope NaN, not a divide-by-zero Infinity', () => {
    const { slope, intercept, domain } = ols([5, 5, 5], [1, 2, 3]);
    expect(Number.isNaN(slope)).toBe(true);
    expect(Number.isNaN(intercept)).toBe(true); // my - NaN*mx propagates NaN, honestly
    expect(domain).toEqual([5, 5]);
  });

  it('fits an exact line for noiseless linear data', () => {
    const { slope, intercept, domain } = ols([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(slope).toBeCloseTo(2, 10);
    expect(intercept).toBeCloseTo(1, 10);
    expect(domain).toEqual([0, 3]);
  });
});

describe('normalApproxPValue', () => {
  it('a non-finite r (NaN) returns 1 (the ELSE arm of the inner ternary)', () => {
    expect(normalApproxPValue(Number.NaN, 100)).toBe(1);
  });

  it('a non-finite r (Infinity) also returns 1', () => {
    expect(normalApproxPValue(Number.POSITIVE_INFINITY, 100)).toBe(1);
  });

  it('a finite r with n < 3 (too few points) returns 0 (the THEN arm of the inner ternary)', () => {
    expect(normalApproxPValue(0.5, 2)).toBe(0);
  });

  it('a finite r with |r| >= 1 (n large enough) returns 0, not a division by zero', () => {
    expect(normalApproxPValue(1, 100)).toBe(0);
    expect(normalApproxPValue(-1, 100)).toBe(0);
  });

  it('an ordinary finite r with n >= 3 and |r| < 1 computes a real two-sided p-value in (0, 1]', () => {
    const p = normalApproxPValue(0.9, 12);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.01);
  });

  it('r = 0 (no correlation) gives p close to 1', () => {
    const p = normalApproxPValue(0, 50);
    expect(p).toBeCloseTo(1, 1);
  });
});
