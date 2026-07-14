/**
 * The key/datum translation seam (emission.ts) — every arm of the vega-signal
 * → host-DATA-space conversion, including the documented day-granularity
 * WIDENING of the 'date' format.
 */
import { describe, it, expect } from 'vitest';
import { msToIso, intervalRawValue, pointRawValue, navigateViewState } from './emission.js';

const MAY_3_NOON_UTC = Date.UTC(2026, 4, 3, 12, 30, 15, 250);
const MAY_9_UTC = Date.UTC(2026, 4, 9);

describe('msToIso', () => {
  it("'date' floors to the UTC calendar day (the documented widening)", () => {
    expect(msToIso(MAY_3_NOON_UTC, 'date')).toBe('2026-05-03');
    expect(msToIso(MAY_9_UTC, 'date')).toBe('2026-05-09');
  });
  it("'datetime' keeps full ISO precision", () => {
    expect(msToIso(MAY_3_NOON_UTC, 'datetime')).toBe('2026-05-03T12:30:15.250Z');
  });
});

describe('intervalRawValue', () => {
  it('a quantitative pair passes through as numbers', () => {
    expect(intervalRawValue({ price: [34.5, 245] }, 'price', false, 'date')).toEqual([34.5, 245]);
  });
  it('a temporal pair becomes ISO date strings (day-floored under "date")', () => {
    expect(intervalRawValue({ date: [MAY_3_NOON_UTC, MAY_9_UTC] }, 'date', true, 'date')).toEqual([
      '2026-05-03',
      '2026-05-09',
    ]);
    expect(intervalRawValue({ date: [MAY_3_NOON_UTC, MAY_9_UTC] }, 'date', true, 'datetime')).toEqual([
      '2026-05-03T12:30:15.250Z',
      '2026-05-09T00:00:00.000Z',
    ]);
  });
  it.each([
    ['a cleared brush ({})', {}],
    ['a null signal', null],
    ['a non-object signal', 42],
    ['a missing field', { other: [1, 2] }],
    ['a non-array field value', { price: 'x' }],
    ['a wrong-length pair', { price: [1, 2, 3] }],
    ['a null-bounds pair (empty data)', { price: [null, null] }],
    ['a NaN bound', { price: [Number.NaN, 2] }],
  ])('%s → null (cleared)', (_label, sig) => {
    expect(intervalRawValue(sig, 'price', false, 'date')).toBeNull();
  });
});

describe('pointRawValue', () => {
  it('the toggle set yields its MOST RECENT value (one clause per view)', () => {
    expect(pointRawValue({ category: ['Casual'] }, 'category')).toBe('Casual');
    expect(pointRawValue({ category: ['Casual', 'Formal'] }, 'category')).toBe('Formal');
  });
  it.each([
    ['a cleared selection ({})', {}],
    ['a null signal', null],
    ['an empty toggle set', { category: [] }],
    ['a non-array field value', { category: 'Casual' }],
  ])('%s → null (cleared)', (_label, sig) => {
    expect(pointRawValue(sig, 'category')).toBeNull();
  });
});

describe('navigateViewState', () => {
  const channels = [
    { channel: 'x' as const, field: 'price', temporal: false },
    { channel: 'y' as const, field: 'date', temporal: true },
  ];
  it('maps FIELD-keyed domains to CHANNEL-keyed view state, ISO for temporal', () => {
    expect(navigateViewState({ price: [10, 50], date: [MAY_3_NOON_UTC, MAY_9_UTC] }, channels, 'date')).toEqual({
      x: [10, 50],
      y: ['2026-05-03', '2026-05-09'],
    });
  });
  it('skips channels whose field carries no domain yet', () => {
    expect(navigateViewState({ price: [10, 50] }, channels, 'date')).toEqual({ x: [10, 50] });
  });
  it('no domains at all → null (nothing to record)', () => {
    expect(navigateViewState({}, channels, 'date')).toBeNull();
    expect(navigateViewState(null, channels, 'date')).toBeNull();
  });
});
