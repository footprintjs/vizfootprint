/**
 * AN AXIS A CHART SIZES ITSELF: room as a share of the span, ticks at round
 * values, labels to the step's precision.
 *
 * Three faults, one cause. A scatter padded its x axis by 5 data units and its
 * y by 0.5, cut the span into even pieces for ticks, and rounded the labels.
 *
 * | the data                          | before                                   | now                                   |
 * |-----------------------------------|------------------------------------------|---------------------------------------|
 * | points in −0.5 … 0.5              | axis −5.5 … 5.5; ticks "0 0 0 0 1"      | axis −0.55 … 0.55; −0.4 −0.2 0 0.2 0.4 |
 * | points in 0 … 1000                | axis −5 … 1005                           | axis −50 … 1050; 0 200 … 1000          |
 * | −3,710,000 … −3,704,000           | six-digit labels, cut off                | −3.710M −3.708M −3.706M −3.704M        |
 * | 2.40 … 2.50                       | "2.5 2.4 2.4"                            | 2.40 2.42 … 2.50                       |
 * | one value                         | ±1 plus the fixed pad                    | 5% of the value each side; ±1 at zero  |
 * | nothing                           | [0 − pad, 1 + pad]                       | [0, 1]                                |
 * | a logarithmic axis                | no room, decade ticks                    | the same                              |
 * | a span tiny beside its offset     | —                                        | two ticks, the ends; never a long loop |
 */
import { describe, expect, it } from 'vitest';
import { EXTENT_ROOM, padFor, roomyExtent, roundStep, roundTicks, roundToAxis, stepDecimals } from './scales.js';

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

  it('takes another share when asked; a share that is not one is no room', () => {
    expect(roomyExtent([0, 10], (v) => v, undefined, 0.1)).toEqual([-1, 11]);
    expect(roomyExtent([0, 10], (v) => v, undefined, 0)).toEqual([0, 10]);
    for (const share of [Number.NaN, -0.5, Number.POSITIVE_INFINITY]) expect(roomyExtent([0, 10], (v) => v, undefined, share)).toEqual([0, 10]);
  });

  it('room that would overflow is not taken: the axis stays a pair of numbers', () => {
    expect(span([-1e308, 1e308])).toEqual([-1e308, 1e308]);
    expect(span([0, 1.75e308])).toEqual([0, 1.75e308]);
  });

  it('a row that is not a number is skipped, as it always was', () => {
    expect(span([3, Number.NaN, 7])).toEqual([2.8, 7.2]);
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

  it('very small and very large axes are written in exponent form, with the digits it takes to tell ticks apart', () => {
    expect(labels(1e-9, 5e-9, 4)).toEqual(['1.0e-9', '2.0e-9', '3.0e-9', '4.0e-9', '5.0e-9']);
    expect(labels(1e-14, 9e-14)).toEqual(['2.0e-14', '4.0e-14', '6.0e-14', '8.0e-14']);
    expect(labels(9.5e-15, 1.05e-14)).toEqual(['9.60e-15', '9.80e-15', '1.00e-14', '1.02e-14', '1.04e-14']);
    expect(labels(1e15, 5e15, 4)).toEqual(['1.0e+15', '2.0e+15', '3.0e+15', '4.0e+15', '5.0e+15']);
    expect(labels(1e300, 5e300, 4)).toEqual(['1.0e+300', '2.0e+300', '3.0e+300', '4.0e+300', '5.0e+300']);
    // …and none of them is called zero: only the tick at zero is
    expect(labels(0, 2.76e-15, 3)).toEqual(['0', '1.0e-15', '2.0e-15']);
  });

  it('a bound that is a multiple of the step is a tick, on every engine: the arithmetic is in whole numbers', () => {
    // Node 22 and Node 24 disagreed on the first of these: `10 ** -4` differs in its last bit between them
    for (const [lo, hi, first, last] of [
      [12_345, 12_345.001, '12345.0000', '12345.0010'],
      [0.3, 0.9, '0.3', '0.9'],
      [1.1, 1.7, '1.1', '1.7'],
      [-0.7, -0.1, '-0.7', '-0.1'],
      [1e-7, 7e-7, '1.0e-7', '7.0e-7'],
      [61_725, 61_725.005, '61725.000', '61725.005'],
    ] as const) {
      const said = labels(lo, hi, 6);
      expect([said[0], said.at(-1)], `${lo} … ${hi}`).toEqual([first, last]);
    }
    // the step itself is exact: a tenth of a thousandth, not a neighbour of it
    expect(roundStep(0.001, 5)).toBe(0.0002);
    expect(roundStep(0.6, 6)).toBe(0.1);
    expect(roundTicks(0, 0.001, 5).map((t) => t.value)).toEqual([0, 0.0002, 0.0004, 0.0006, 0.0008, 0.001]);
  });

  it('a narrow span far from zero is written in full: every tick reads differently', () => {
    expect(labels(1.7e9, 1.7e9 + 10)).toEqual(['1700000000', '1700000002', '1700000004', '1700000006', '1700000008', '1700000010']);
    expect(labels(12_345, 12_345.001)).toEqual(['12345.0000', '12345.0002', '12345.0004', '12345.0006', '12345.0008', '12345.0010']);
    expect(labels(1, 1.000001)).toEqual(['1.0000000', '1.0000002', '1.0000004', '1.0000006', '1.0000008', '1.0000010']);
    expect(labels(999_999, 1_000_001, 4)).toEqual(['999999.0', '999999.5', '1000000.0', '1000000.5', '1000001.0']);
    for (const [lo, hi] of [[1.7e12, 1.7e12 + 60_000], [1e9, 1e9 + 10], [1e7, 1e7 + 10]] as const) {
      const said = labels(lo, hi);
      expect(new Set(said).size).toBe(said.length);
    }
  });

  it('a span with no round value inside it is ticked at its ends', () => {
    // one step of 0.1 is asked for across 0.11 … 0.19, and no multiple of 0.1 lies inside
    expect(roundTicks(0.11, 0.19, 1).map((t) => t.value)).toEqual([0.11, 0.19]);
  });

  it('50,000 generated axes: never many ticks, always in order, inside the span, no two labels alike, each label true to its tick', () => {
    // a small seeded generator (mulberry32), so a failure can be run again
    let seed = 0x9e3779b9;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const SUFFIX: Record<string, number> = { k: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    const read = (label: string): number => {
      const unit = SUFFIX[label.at(-1)!];
      return unit === undefined ? Number(label) : Number(label.slice(0, -1)) * unit;
    };
    for (let run = 0; run < 50_000; run++) {
      const sign = random() < 0.5 ? -1 : 1;
      const offset = random() < 0.2 ? 0 : sign * 10 ** (random() * 40 - 20);
      const width = 10 ** (random() * 40 - 20);
      const lo = offset - (random() < 0.3 ? width : 0);
      const hi = offset + width;
      const target = 1 + Math.floor(random() * 8);
      const ticks = roundTicks(lo, hi, target);
      const where = `roundTicks(${lo}, ${hi}, ${target})`;
      expect(ticks.length, where).toBeLessThanOrEqual(101);
      if (lo === hi) continue; // the width vanished beside the offset: one tick, the value
      expect(ticks.length, where).toBeGreaterThanOrEqual(1);
      if (ticks.length === 1) {
        // one round value lies inside the span: it must be inside, and say what it is
        // (to within a millionth of the span, the same allowance the step gets below)
        expect(ticks[0]!.value, where).toBeGreaterThanOrEqual(lo - (hi - lo) * 1e-6);
        expect(ticks[0]!.value, where).toBeLessThanOrEqual(hi + (hi - lo) * 1e-6);
        continue;
      }
      const step = ticks[1]!.value - ticks[0]!.value;
      expect(step, where).toBeGreaterThan(0);
      const said = ticks.map((t) => t.label);
      expect(new Set(said).size, `${where} → ${said.join(' ')}`).toBe(said.length);
      for (const [i, t] of ticks.entries()) {
        // inside the span, to within a thirtieth of a step: the allowance a bound gets to count as a tick
        // when the division's last bit says it is not one (it is a fiftieth at thirteen digits)
        expect(t.value, where).toBeGreaterThanOrEqual(lo - step * 0.03);
        expect(t.value, where).toBeLessThanOrEqual(hi + step * 0.03);
        if (i > 0) expect(t.value, where).toBeGreaterThan(ticks[i - 1]!.value);
        // what the label says is the tick, to within half a step
        expect(Math.abs(read(t.label) - t.value), `${where} → "${t.label}" for ${t.value}`).toBeLessThanOrEqual(step / 2);
        if (t.label === '0') expect(t.value, where).toBe(0);
      }
    }
  });

  it('a flat span has one tick; a span that is not finite has none; bounds may come either way round', () => {
    expect(labels(3, 3)).toEqual(['3']);
    expect(labels(1e-14, 1e-14)).toEqual(['1e-14']);
    expect(roundTicks(Number.NaN, 1, 5)).toEqual([]);
    expect(roundTicks(0, Number.POSITIVE_INFINITY, 5)).toEqual([]);
    expect(labels(10, 0, 5)).toEqual(labels(0, 10, 5));
  });

  it('a span no run of round ticks can honestly cover is ticked at its two ends, written in full, at once', () => {
    const started = Date.now();
    // indices past the largest exact integer: a loop that walked to a bound would never end
    expect(labels(1e16, 1e16 + 2)).toEqual(['10000000000000000', '10000000000000002']);
    // more ticks asked for than an axis can hold
    expect(roundTicks(0, 1, 1e9).map((t) => t.value)).toEqual([0, 1]);
    // a span that overflows, and a step that does
    expect(labels(-1e308, 1e308, 4)).toEqual(['-1e+308', '1e+308']);
    expect(labels(0, Number.MAX_VALUE, 1)).toEqual(['0', '1.7976931348623157e+308']);
    // ticks that would differ only past the thirteenth digit
    expect(labels(1, 1 + 4e-14)).toEqual(['1', '1.00000000000004']);
    expect(roundTicks(-9e15, 9e15, 5).length).toBeLessThanOrEqual(101);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('roundToAxis — a dragged value, rounded to what the axis can show', () => {
  it.each([
    // an axis of ten or more: a hundredth, exactly as a drag was always recorded
    [123.456789, 1100, 123.46],
    [123.456789, 10, 123.46],
    [-0.005, 100, -0.01],
    // a smaller axis: a thousandth of its own decade
    [0.123456789, 1.1, 0.123],
    [0.000456789, 0.0011, 0.000457],
    [5.123456789e-7, 1e-6, 5.12e-7],
    // no span to judge by: a hundredth
    [1.23456, 0, 1.23],
    [1.23456, Number.NaN, 1.23],
    [1.23456, -5, 1.23],
  ])('%d on an axis %d wide is %d', (value, width, rounded) => {
    expect(roundToAxis(value, width)).toBe(rounded);
  });

  it('two ends of a drag across a tiny axis stay two different numbers', () => {
    expect(roundToAxis(0.0002, 0.0011)).not.toBe(roundToAxis(0.0009, 0.0011));
    expect(Number.isFinite(roundToAxis(1e-300, 1e-300))).toBe(true);
  });
});
