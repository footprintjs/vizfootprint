/**
 * THE VALUE UNDER A POINTER, for a drag that records a span of numbers.
 *
 * | the pointer                               | the value                                   |
 * |-------------------------------------------|---------------------------------------------|
 * | inside the scale's range                  | the scale's own inverse, as it is           |
 * | at, or past, the low end of the range     | the domain's low end, exactly               |
 * | at, or past, the high end of the range    | the domain's high end, exactly              |
 * | a scale whose range runs the other way    | the same, with the ends the other way round |
 * | a logarithmic scale                       | the same rule                               |
 * | a range with no length                    | the low end at its one pixel                |
 */
import { describe, expect, it } from 'vitest';
import { linearScale, logScale, pointerValue } from './scales.js';

describe('pointerValue', () => {
  it('inside the range it is the scale’s own inverse', () => {
    const x = linearScale(0, 1000, 52, 502);
    expect(pointerValue(x, 100.3)).toBe(x.invert(100.3));
    expect(pointerValue(x, 501.999)).toBe(x.invert(501.999));
    const log = logScale(1, 1000, 52, 502);
    expect(pointerValue(log, 300)).toBe(log.invert(300));
  });

  it('at or past an end of the range it is that end of the domain, exactly', () => {
    const x = linearScale(0.1, 0.7, 52, 502);
    expect(pointerValue(x, 52)).toBe(0.1);
    expect(pointerValue(x, -40)).toBe(0.1);
    expect(pointerValue(x, 502)).toBe(0.7);
    expect(pointerValue(x, 9000)).toBe(0.7);
  });

  it('where the edge pixel’s inverse misses the end in its last digit, the end is still answered', () => {
    // found by a reviewer: 551076752.5303997 was recorded as …3988 at the right edge of a logarithmic axis
    const log = logScale(7.123, 551076752.5303997, 52, 502);
    expect(pointerValue(log, 502)).toBe(551076752.5303997);
    expect(pointerValue(log, 52)).toBe(7.123);
  });

  it('a range that runs the other way (a value axis grows upward) has its ends the other way round', () => {
    const y = linearScale(0, 10, 300, 20);
    expect(pointerValue(y, 300)).toBe(0);
    expect(pointerValue(y, 400)).toBe(0);
    expect(pointerValue(y, 20)).toBe(10);
    expect(pointerValue(y, 5)).toBe(10);
    expect(pointerValue(y, 160)).toBe(y.invert(160));
  });

  it('a range with no length answers the low end at its one pixel, where the bare inverse has no answer', () => {
    const flat = linearScale(0, 10, 100, 100);
    expect(pointerValue(flat, 100)).toBe(0);
    expect(pointerValue(flat, 99)).toBe(0);
    expect(pointerValue(flat, 150)).toBe(10);
  });

  it('5,000 generated scales: at both edges the answer is the domain’s end, whatever the inverse says', () => {
    let seed = 13;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let missed = 0;
    for (let run = 0; run < 5000; run++) {
      const log = run % 2 === 0;
      const lo = log ? 10 ** (next() * 20 - 10) : (next() - 0.5) * 10 ** (next() * 12 - 4);
      const hi = log ? lo * (1 + 10 ** (next() * 10 - 6)) : lo + 10 ** (next() * 12 - 6);
      const [r0, r1] = [next() * 80, 200 + next() * 700];
      const scale = log ? logScale(lo, hi, r0, r1) : linearScale(lo, hi, r0, r1);
      expect(pointerValue(scale, r0)).toBe(lo);
      expect(pointerValue(scale, r1)).toBe(hi);
      if (scale.invert(r1) !== hi || scale.invert(r0) !== lo) missed += 1;
    }
    // the rule is not idle: the bare inverse misses an end on a real share of these
    expect(missed).toBeGreaterThan(100);
  });
});
