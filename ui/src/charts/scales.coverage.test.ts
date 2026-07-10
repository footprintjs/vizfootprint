import { describe, it, expect } from 'vitest';
import { linearScale, extent, ticks } from './scales.js';

describe('linearScale', () => {
  it('maps domain to range and inverts back', () => {
    const s = linearScale(0, 10, 100, 200);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(200);
    expect(s(5)).toBe(150);
    expect(s.invert(150)).toBe(5);
    expect(s.domain).toEqual([0, 10]);
    expect(s.range).toEqual([100, 200]);
  });

  it('falls back to a divisor of 1 when the domain is degenerate (d0 === d1)', () => {
    // (r1 - r0) / (d1 - d0 || 1) — d1-d0 is 0 (falsy), so the scale must use
    // the `|| 1` fallback rather than dividing by zero.
    const s = linearScale(5, 5, 0, 100);
    expect(Number.isFinite(s(5))).toBe(true);
    expect(s(5)).toBe(0); // r0 + (5-5)*100 = 0
    expect(s(6)).toBe(100); // r0 + (6-5)*100 = 100 (slope is exactly 100, not Infinity)
  });
});

describe('extent', () => {
  it('returns a padded default domain for an empty row set', () => {
    expect(extent([], (d: { v: number }) => d.v, 5)).toEqual([-5, 6]);
    expect(extent([], (d: { v: number }) => d.v)).toEqual([0, 1]);
  });

  it('returns a padded default domain when every accessed value is non-finite', () => {
    // NaN fails every `<`/`>` comparison, so lo/hi never move off their
    // Infinity/-Infinity seeds — the isFinite guard must catch that.
    const rows = [{ v: NaN }, { v: NaN }];
    expect(extent(rows, (d) => d.v, 2)).toEqual([-2, 3]);
  });

  it('pads a degenerate (all-equal) extent so lo !== hi', () => {
    expect(extent([{ v: 5 }], (d: { v: number }) => d.v, 1)).toEqual([3, 7]);
    expect(extent([{ v: 5 }, { v: 5 }], (d: { v: number }) => d.v)).toEqual([4, 6]);
  });

  it('returns the true [min, max] padded by `pad` for a normal spread', () => {
    const rows = [{ v: 3 }, { v: 9 }, { v: -1 }];
    expect(extent(rows, (d) => d.v, 1)).toEqual([-2, 10]);
  });
});

describe('ticks', () => {
  it('produces n+1 evenly-spaced values across [lo, hi]', () => {
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});
