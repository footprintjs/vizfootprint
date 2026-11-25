/**
 * AN AXIS A CHART SIZES ITSELF: room as a share of the span, ticks at round
 * values, labels to the step's precision.
 *
 * Three faults, one cause. A scatter padded its x axis by 5 data units and its
 * y by 0.5, cut the span into even pieces for ticks, and rounded the labels.
 *
 * | the data                          | before                                   | now                                   |
 * |-----------------------------------|------------------------------------------|---------------------------------------|
 * | points in −0.5 … 0.5              | axis −5.5 … 5.5; ticks "−1 0 0 0 1"      | axis −0.55 … 0.55; −0.4 −0.2 0 0.2 0.4 |
 * | points in 0 … 1000                | axis −5 … 1005                           | axis −50 … 1050; 0 200 … 1000          |
 * | −3,710,000 … −3,704,000           | six-digit labels, cut off                | −3.710M −3.708M −3.706M −3.704M        |
 * | 2.40 … 2.50                       | "2.5 2.4 2.4"                            | 2.40 2.42 … 2.50                       |
 * | one value                         | ±1 plus the fixed pad                    | 5% of the value each side; ±1 at zero  |
 * | nothing                           | [0 − pad, 1 + pad]                       | [0, 1]                                |
 * | a logarithmic axis                | no room, decade ticks                    | the same                              |
 * | a span tiny beside its offset     | —                                        | two ticks, the ends; never a long loop |
 */
import { describe, expect, it } from 'vitest';
import { EXTENT_ROOM, padFor, roomyExtent, roundStep, roundTicks, stepDecimals } from './scales.js';

const labels = (lo: number, hi: number, target = 5): string[] => roundTicks(lo, hi, target).map((t) => t.label);
const span = (values: readonly number[], kind?: 'log'): [number, number] => roomyExtent(values, (v) => v, kind);

describe('roomyExtent — room is a share of the span', () => {
  it('leaves the same share at each end whatever units the data is in', () => {
    expect(EXTENT_ROOM).toBe(0.05);
    expect(span([-0.5, 0.5])).toEqual([-0.55, 0.55]);
    expect(span([0, 1000])).toEqual([-50, 1050]);
    expect(span([0, 0.001])[1]).toBeCloseTo(0.00105, 12);
    // the picture is the same at every scale: the data takes 1 / 1.1 of the axis
    for (const k of [1e-6, 1, 1e6]) {
      const [lo, hi] = span([2 * k, 7 * k]);
      expect((7 * k - 2 * k) / (hi - lo)).toBeCloseTo(1 / 1.1, 12);
    }
  });

  it('one value gets a share of its own size at each side, and ±1 at zero', () => {
    expect(span([200])).toEqual([190, 210]);
    expect(span([-200, -200])).toEqual([-210, -190]);
    expect(span([0])).toEqual([-1, 1]);
  });

  it('nothing to measure is the placeholder [0, 1]', () => {
    expect(span([])).toEqual([0, 1]);
    expect(span([Number.NaN])).toEqual([0, 1]);
    expect(span([Number.POSITIVE_INFINITY, 1])).toEqual([0, 1]);
  });

  it('a logarithmic axis takes no room, and its empty answer is the log-aware one', () => {
    expect(span([10, 1000], 'log')).toEqual([10, 1000]);
    expect(span([], 'log')).toEqual([0, 0]);
  });

  it('takes another share when asked', () => {
    expect(roomyExtent([0, 10], (v) => v, undefined, 0.1)).toEqual([-1, 11]);
    expect(roomyExtent([0, 10], (v) => v, undefined, 0)).toEqual([0, 10]);
  });
});

describe('padFor — the older additive room, kept for callers of their own', () => {
  it('a logarithmic axis takes none', () => {
    expect(padFor(undefined, 5)).toBe(5);
    expect(padFor('linear', 0.5)).toBe(0.5);
    expect(padFor('log', 5)).toBe(0);
  });
});

describe('roundStep — the steps a person counts in', () => {
  it.each([
    [1, 5, 0.2],
    [1.1, 5, 0.2],
    [10, 5, 2],
    [100, 4, 20],
    [6000, 4, 2000],
    [0.1, 4, 0.02],
    [7, 4, 2],
    [40, 4, 10],
    [3, 4, 1],
    [0.0006, 4, 0.0002],
    [80, 1, 100],
  ])('a span of %d in about %i steps: %d', (width, target, step) => {
    expect(roundStep(width, target)).toBeCloseTo(step, 12);
  });

  it('no span, no step', () => {
    for (const [width, target] of [[0, 5], [-1, 5], [Number.NaN, 5], [Number.POSITIVE_INFINITY, 5], [10, 0]] as const) expect(roundStep(width, target)).toBe(0);
  });
});

describe('stepDecimals', () => {
  it.each([[1, 0], [25, 0], [0.2, 1], [0.05, 2], [0.0001, 4], [2000, 0], [0.1 + 0.2, 1], [0, 0], [-1, 0], [Number.NaN, 0], [1e-13, 12]])('%d needs %i', (step, d) => {
    expect(stepDecimals(step)).toBe(d);
  });
});

describe('roundTicks — round values, labelled to the step', () => {
  it('the reported cases', () => {
    expect(labels(-0.55, 0.55)).toEqual(['-0.4', '-0.2', '0', '0.2', '0.4']);
    expect(labels(-0.5, 0.5)).toEqual(['-0.4', '-0.2', '0', '0.2', '0.4']);
    expect(labels(-3_710_000, -3_704_000, 4)).toEqual(['-3.710M', '-3.708M', '-3.706M', '-3.704M']);
    expect(labels(2.4, 2.5, 4)).toEqual(['2.40', '2.42', '2.44', '2.46', '2.48', '2.50']);
    expect(labels(0, 1000, 4)).toEqual(['0', '200', '400', '600', '800', '1000']);
  });

  it('every tick is inside the span and is a multiple of one step', () => {
    for (const [lo, hi] of [[-0.55, 0.55], [6, 94], [-3_710_300, -3_703_700], [0.4709, 0.4717], [-50, 1050], [1e-7, 9e-7]] as const) {
      const ticks = roundTicks(lo, hi, 5);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      const step = ticks[1]!.value - ticks[0]!.value;
      for (const [i, t] of ticks.entries()) {
        expect(t.value).toBeGreaterThanOrEqual(lo - step * 1e-6);
        expect(t.value).toBeLessThanOrEqual(hi + step * 1e-6);
        if (i > 0) expect(t.value - ticks[i - 1]!.value).toBeCloseTo(step, 10);
      }
      // no two ticks read the same: the fault the rounding used to make
      expect(new Set(ticks.map((t) => t.label)).size).toBe(ticks.length);
    }
  });

  it('one unit for the whole axis, chosen by its largest tick', () => {
    expect(labels(0, 12_345_678, 4)).toEqual(['0', '2M', '4M', '6M', '8M', '10M', '12M']);
    expect(labels(9000, 11_000, 4)).toEqual(['9.0k', '9.5k', '10.0k', '10.5k', '11.0k']);
    expect(labels(0, 4e9, 4)).toEqual(['0', '1B', '2B', '3B', '4B']);
    expect(labels(0, 3e12, 3)).toEqual(['0', '1T', '2T', '3T']);
    // below ten thousand an axis is written in full
    expect(labels(0, 9000, 3)).toEqual(['0', '2000', '4000', '6000', '8000']);
  });

  it('zero is zero: never −0, never 0.0, never a float crumb', () => {
    const ticks = roundTicks(-0.3, 0.3, 6);
    const zero = ticks.find((t) => t.label === '0')!;
    expect(Object.is(zero.value, 0)).toBe(true);
    expect(ticks.map((t) => t.label)).not.toContain('-0.0');
  });

  it('a step too fine for decimals is written as the language writes a small number', () => {
    expect(labels(1e-9, 5e-9, 4)).toEqual(['1e-9', '2e-9', '3e-9', '4e-9', '5e-9']);
  });

  it('a span with no round value inside it is ticked at its ends', () => {
    // one step of 0.1 is asked for across 0.11 … 0.19, and no multiple of 0.1 lies inside
    expect(roundTicks(0.11, 0.19, 1).map((t) => t.value)).toEqual([0.11, 0.19]);
  });

  it('a flat span has one tick; a span that is not finite has none; bounds may come either way round', () => {
    expect(labels(3, 3)).toEqual(['3']);
    expect(roundTicks(Number.NaN, 1, 5)).toEqual([]);
    expect(roundTicks(0, Number.POSITIVE_INFINITY, 5)).toEqual([]);
    expect(labels(10, 0, 5)).toEqual(labels(0, 10, 5));
  });

  it('a span tiny beside its own offset, or one asked for too many ticks, is ticked at its ends and returns at once', () => {
    const started = Date.now();
    expect(roundTicks(1e16, 1e16 + 2, 5)).toHaveLength(2);
    expect(roundTicks(1e300, 1e300 * (1 + 1e-15), 5).length).toBeLessThanOrEqual(101);
    expect(roundTicks(-9e15, 9e15, 5).length).toBeLessThanOrEqual(101);
    expect(roundTicks(0, 1, 1e9)).toHaveLength(2);
    expect(roundTicks(0, 1, 1e9).map((t) => t.value)).toEqual([0, 1]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
