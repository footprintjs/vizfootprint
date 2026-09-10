/**
 * THE LOGARITHMIC AXIS (protocol 1.6), primitive by primitive: the scale that
 * refuses a non-positive bound, the clamp that decides what a non-positive
 * bound means, the one owner of which builder a channel gets, the decade ticks,
 * their labels, the placeability predicate and the words for what was left out.
 */
import { describe, it, expect } from 'vitest';
import { linearScale, extent, logScale, logDomain, extentFor, scaleFor, placeable, logTicks, logTickLabel, excludedNote } from './scales.js';

describe('logScale', () => {
  it('puts a decade at an equal pixel span and inverts back', () => {
    const s = logScale(1, 1000, 0, 300);
    expect(s(1)).toBe(0);
    expect(s(10)).toBeCloseTo(100, 6);
    expect(s(100)).toBeCloseTo(200, 6);
    expect(s(1000)).toBe(300);
    expect(s.invert(100)).toBeCloseTo(10, 6);
    expect(s.domain).toEqual([1, 1000]);
    expect(s.range).toEqual([0, 300]);
  });

  it('places a value outside its domain at its true position (nothing is clamped)', () => {
    const s = logScale(1, 100, 0, 200);
    expect(s(1000)).toBeCloseTo(300, 6); // one decade past the high bound
    expect(s(0.1)).toBeCloseTo(-100, 6);
  });

  it('refuses a non-positive bound rather than answering NaN', () => {
    expect(() => logScale(0, 100, 0, 1)).toThrow(RangeError);
    expect(() => logScale(-5, 100, 0, 1)).toThrow(/no place for -5/);
    expect(() => logScale(1, 0, 0, 1)).toThrow(/no place for 0/);
  });

  it('falls back to a divisor of 1 when the two bounds are the same decade point', () => {
    const s = logScale(10, 10, 0, 100);
    expect(Number.isFinite(s(10))).toBe(true);
    expect(s(10)).toBe(0);
  });
});

describe('logDomain', () => {
  it('leaves a positive span alone, in order', () => {
    expect(logDomain(2, 500)).toEqual([2, 500]);
    expect(logDomain(500, 2)).toEqual([2, 500]);
  });

  it('widens a flat domain by a decade on each side', () => {
    expect(logDomain(10, 10)).toEqual([1, 100]);
  });

  it('lifts a low bound of zero or below to one decade under the high bound', () => {
    expect(logDomain(0, 100)).toEqual([10, 100]);
    expect(logDomain(-40, 100)).toEqual([10, 100]);
  });

  it('answers the placeholder decade when nothing is positive', () => {
    // no mark can be drawn on it — every cell was excluded, and the chart's
    // words carry the story (excludedNote)
    expect(logDomain(-9, 0)).toEqual([1, 10]);
    expect(logDomain(0, 0)).toEqual([1, 10]);
  });
});

describe('extentFor — the log-aware empty fallback `extent` cannot give on its own', () => {
  it('is `extent` itself off any non-empty rows, for either kind', () => {
    const rows = [{ v: 3 }, { v: 30 }];
    expect(extentFor(rows, (r) => r.v, 5, 'log')).toEqual(extent(rows, (r) => r.v, 5));
    expect(extentFor(rows, (r) => r.v, 5, undefined)).toEqual(extent(rows, (r) => r.v, 5));
  });

  it('answers [0, 0] for NO rows under a logarithmic kind — the pair `logDomain` reads as its placeholder', () => {
    expect(extentFor([] as { v: number }[], (r) => r.v, 5, 'log')).toEqual([0, 0]);
    expect(logDomain(...extentFor([] as { v: number }[], (r) => r.v, 5, 'log'))).toEqual([1, 10]);
  });

  it('leaves `extent`\'s own [0,1]-widened default alone for NO rows under linear or no kind', () => {
    expect(extentFor([] as { v: number }[], (r) => r.v, 5, 'linear')).toEqual(extent([], () => 0, 5));
    expect(extentFor([] as { v: number }[], (r) => r.v, 5, undefined)).toEqual(extent([], () => 0, 5));
  });
});

describe('scaleFor', () => {
  it('is the linear builder itself for a linear or absent transform', () => {
    expect(scaleFor(undefined)).toBe(linearScale);
    expect(scaleFor('linear')).toBe(linearScale);
  });

  it('builds a logarithmic scale for "log"', () => {
    const s = scaleFor('log')(1, 100, 0, 200);
    expect(s(10)).toBeCloseTo(100, 6);
  });

  it('clamps through logDomain so a chart can hand it a domain reaching zero', () => {
    // logScale itself refuses this pair; scaleFor is the caller that decides
    // what it means, so no chart ever has to
    const s = scaleFor('log')(0, 100, 0, 200);
    expect(s.domain).toEqual([10, 100]);
    expect(Number.isFinite(s(100))).toBe(true);
  });
});

describe('placeable', () => {
  it('places every finite number on a linear axis', () => {
    expect(placeable(undefined, 0)).toBe(true);
    expect(placeable('linear', -3)).toBe(true);
    expect(placeable(undefined, Number.NaN)).toBe(false);
    expect(placeable(undefined, Infinity)).toBe(false);
  });

  it('places only the positive numbers on a logarithmic axis', () => {
    expect(placeable('log', 0.001)).toBe(true);
    expect(placeable('log', 0)).toBe(false);
    expect(placeable('log', -1)).toBe(false);
    expect(placeable('log', Number.NaN)).toBe(false);
  });
});

describe('logTicks', () => {
  it('gives the powers of ten inside the span', () => {
    expect(logTicks(1, 1000)).toEqual([1, 10, 100, 1000]);
    expect(logTicks(0.5, 200)).toEqual([1, 10, 100]);
  });

  it('thins to at most `max` while keeping both ends', () => {
    const t = logTicks(1, 1e8, 4);
    expect(t.length).toBeLessThanOrEqual(4);
    expect(t[0]).toBe(1);
    expect(t[t.length - 1]).toBe(1e8);
  });

  it('falls back to the 1-2-5 mantissas when fewer than two decades are in view', () => {
    // 1 is in range, so a reader still meets a labelled power of ten
    expect(logTicks(0.8, 8)).toEqual([1, 2, 5]);
    expect(logTicks(200, 900)).toEqual([200, 500]);
  });

  it('answers no ticks at all for a span no logarithm can describe', () => {
    expect(logTicks(0, 100)).toEqual([]);
    expect(logTicks(-1, 100)).toEqual([]);
    expect(logTicks(100, 10)).toEqual([]);
    expect(logTicks(5, 5)).toEqual([]);
  });
});

describe('logTickLabel', () => {
  it('writes the readable middle as it is, never rounded to zero', () => {
    expect(logTickLabel(1)).toBe('1');
    expect(logTickLabel(0.1)).toBe('0.1');
    expect(logTickLabel(0.001)).toBe('0.001');
    expect(logTickLabel(1000)).toBe('1000');
  });

  it('writes the far decades in exponential notation', () => {
    expect(logTickLabel(10000)).toBe('1e+4');
    expect(logTickLabel(1e-4)).toBe('1e-4');
  });
});

describe('excludedNote', () => {
  it('is empty when nothing was excluded, so a linear chart is byte-identical', () => {
    expect(excludedNote(0)).toBe('');
    expect(excludedNote(-1)).toBe('');
  });

  it('names the count and the reason, with its own leading separator', () => {
    expect(excludedNote(1)).toBe(' — 1 value is not drawn: a logarithmic axis has no place for zero or a negative number');
    expect(excludedNote(700)).toContain('700 values are not drawn');
  });
});
