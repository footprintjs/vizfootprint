/**
 * src/data/boxSummary — the host-side box-plot summary helper (v1): type-7
 * linear-interpolation quartiles, Tukey whiskers (real data points inside the
 * fence), outlier listing, numeric + date domains, honest skipping of
 * unusable values, mixed-domain refusal, and empty-input honesty (`null`).
 * Every quartile/fence figure below is HAND-COMPUTED in the comment beside
 * it — not just asserted against the implementation.
 */
import { describe, it, expect } from 'vitest';
import { boxSummary } from './boxSummary.js';

describe('boxSummary — numeric domain, no outliers', () => {
  it('[1..10]: type-7 quartiles, Tukey fence covers the whole range', () => {
    // sorted = 1..10 (n=10). h = (n-1)*p:
    //   q1: h=(9)*0.25=2.25 -> idx2=3, idx3=4 -> 3 + 0.25*(4-3) = 3.25
    //   median: h=4.5 -> idx4=5, idx5=6 -> 5 + 0.5*(6-5) = 5.5
    //   q3: h=6.75 -> idx6=7, idx7=8 -> 7 + 0.75*(8-7) = 7.75
    // iqr = 4.5; fence = [3.25 - 6.75, 7.75 + 6.75] = [-3.5, 14.5]
    // every real value (1..10) sits inside the fence -> whiskers = data min/max
    const s = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s).toEqual({
      domain: 'number',
      q1: 3.25,
      median: 5.5,
      q3: 7.75,
      whiskerLo: 1,
      whiskerHi: 10,
      outliers: [],
      count: 10,
    });
  });

  it('order of input does not matter — the function sorts internally', () => {
    const shuffled = boxSummary([7, 2, 9, 4, 1, 10, 5, 3, 8, 6]);
    const ordered = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(shuffled).toEqual(ordered);
  });

  it('[10, 20]: two values, fractional quartiles, both are their own whiskers', () => {
    // sorted=[10,20], n=2. h=(1)*p:
    //   q1: h=0.25 -> 10 + 0.25*10 = 12.5
    //   median: h=0.5 -> 10 + 5 = 15
    //   q3: h=0.75 -> 10 + 7.5 = 17.5
    // iqr=5; fence=[12.5-7.5, 17.5+7.5]=[5, 25] -> both 10 and 20 are inliers
    const s = boxSummary([10, 20]);
    expect(s).toEqual({
      domain: 'number',
      q1: 12.5,
      median: 15,
      q3: 17.5,
      whiskerLo: 10,
      whiskerHi: 20,
      outliers: [],
      count: 2,
    });
  });
});

describe('boxSummary — numeric domain, an outlier is fenced out', () => {
  it('[1..9, 100]: the same quartiles as [1..10] (100 replaces the last slot), but 100 fences out', () => {
    // sorted=[1,2,3,4,5,6,7,8,9,100], n=10 -> the SAME h/index math as the
    // [1..10] fixture above for q1/median/q3 (only the top value changed):
    //   q1=3.25, median=5.5, q3=7.75, iqr=4.5, fence=[-3.5, 14.5]
    // 100 > 14.5 -> fenced OUT; the next-highest real value (9) becomes whiskerHi
    const s = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(s).toEqual({
      domain: 'number',
      q1: 3.25,
      median: 5.5,
      q3: 7.75,
      whiskerLo: 1,
      whiskerHi: 9,
      outliers: [100],
      count: 10,
    });
  });

  it('whiskerK is configurable — k=0 (fence = [q1, q3]) fences out everything past the box', () => {
    // same fixture, k=0 -> fence=[q1,q3]=[3.25,7.75]; inliers are the real
    // values landing inside: 4,5,6,7 (3 < 3.25, 8 > 7.75, both excluded)
    const s = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], { whiskerK: 0 });
    expect(s).toEqual({
      domain: 'number',
      q1: 3.25,
      median: 5.5,
      q3: 7.75,
      whiskerLo: 4,
      whiskerHi: 7,
      outliers: [1, 2, 3, 8, 9, 100],
      count: 10,
    });
  });

  it('a negative whiskerK clamps to 0 — the same result as an explicit 0', () => {
    const negative = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], { whiskerK: -3 });
    const zero = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], { whiskerK: 0 });
    expect(negative).toEqual(zero);
  });
});

describe('boxSummary — degenerate inputs', () => {
  it('an all-equal input collapses q1/median/q3/whiskers to the one value; no outliers', () => {
    const s = boxSummary([7, 7, 7, 7]);
    expect(s).toEqual({ domain: 'number', q1: 7, median: 7, q3: 7, whiskerLo: 7, whiskerHi: 7, outliers: [], count: 4 });
  });

  it('a single value: every statistic is that value', () => {
    const s = boxSummary([42]);
    expect(s).toEqual({ domain: 'number', q1: 42, median: 42, q3: 42, whiskerLo: 42, whiskerHi: 42, outliers: [], count: 1 });
  });

  it('skips NaN and non-finite numbers — never guessed into the summary', () => {
    const withJunk = boxSummary([1, NaN, 2, 3, 4, 5, 6, 7, 8, 9, 10, Infinity, -Infinity]);
    const clean = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(withJunk).toEqual(clean);
  });

  it('empty (or all-unusable) input -> null, honestly, never a zeroed-out summary', () => {
    expect(boxSummary([])).toBeNull();
    expect(boxSummary([NaN, 'not a date'])).toBeNull();
  });
});

describe('boxSummary — date domain (ISO-8601 strings)', () => {
  it('5 evenly-spaced whole days: quartile positions land exactly on real values (day-precision edges)', () => {
    // positions (days from 04-01): 0,2,4,6,8 ; n=5, h=(4)*p:
    //   q1: h=1 (exact) -> day2 = 2026-04-03
    //   median: h=2 (exact) -> day4 = 2026-04-05
    //   q3: h=3 (exact) -> day6 = 2026-04-07
    // iqr = 4 days; fence = [day2 - 6days, day6 + 6days] = [day(-4), day12]
    // all 5 values (day0..day8) sit inside -> whiskers = the data's own extremes
    const s = boxSummary(['2026-04-01', '2026-04-03', '2026-04-05', '2026-04-07', '2026-04-09']);
    expect(s).toEqual({
      domain: 'date',
      q1: '2026-04-03',
      median: '2026-04-05',
      q3: '2026-04-07',
      whiskerLo: '2026-04-01',
      whiskerHi: '2026-04-09',
      outliers: [],
      count: 5,
    });
  });

  it('two whole days: fractional quartiles come back as full ISO (not on a UTC midnight)', () => {
    // sorted=[day0=04-01T00:00, day1=04-02T00:00], n=2. h=(1)*p:
    //   q1: h=0.25 -> day0 + 6h  = 2026-04-01T06:00:00.000Z
    //   median: h=0.5 -> day0 + 12h = 2026-04-01T12:00:00.000Z
    //   q3: h=0.75 -> day0 + 18h = 2026-04-01T18:00:00.000Z
    // iqr=12h; fence=[6h-18h, 18h+18h]=[-12h, +36h] -> both day0,day1 inliers
    // (both ARE UTC midnights, so whiskers print back day-precision)
    const s = boxSummary(['2026-04-01', '2026-04-02']);
    expect(s).toEqual({
      domain: 'date',
      q1: '2026-04-01T06:00:00.000Z',
      median: '2026-04-01T12:00:00.000Z',
      q3: '2026-04-01T18:00:00.000Z',
      whiskerLo: '2026-04-01',
      whiskerHi: '2026-04-02',
      outliers: [],
      count: 2,
    });
  });

  it('a far-future date fences out as a date outlier', () => {
    const s = boxSummary(['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05', '2031-01-01']);
    expect(s!.domain).toBe('date');
    expect(s!.outliers).toEqual(['2031-01-01']);
    expect(s!.whiskerHi).toBe('2026-04-05'); // the next-highest real (non-outlier) day
  });

  it('skips unparseable date strings — never guessed', () => {
    const withJunk = boxSummary(['2026-04-01', 'not a date', '2026-04-03', '2026-04-05', '2026-04-07', '2026-04-09']);
    const clean = boxSummary(['2026-04-01', '2026-04-03', '2026-04-05', '2026-04-07', '2026-04-09']);
    expect(withJunk).toEqual(clean);
  });

  it('a pre-1970 (negative-epoch) whole-day input still renders day-precision edges', () => {
    const s = boxSummary(['1969-12-01', '1969-12-03', '1969-12-05', '1969-12-07', '1969-12-09']);
    expect(s).toMatchObject({ domain: 'date', whiskerLo: '1969-12-01', whiskerHi: '1969-12-09' });
  });
});

describe('boxSummary — mixed domains refuse', () => {
  it('numbers and dates in one call throw (summarize one column at a time)', () => {
    expect(() => boxSummary([1, '2026-04-01'])).toThrowError(/mixed numeric and date values/);
  });
});
