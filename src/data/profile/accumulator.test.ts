import { describe, expect, it } from 'vitest';
import { createFieldAccumulator } from './accumulator.js';
import { ProfileError } from './error.js';
import type { ProfileColumn, ProfileFieldRequest, ProfileQuantileMethod, ProfileStatistic } from './types.js';

const column: ProfileColumn = { name: 'duration', type: 'number', role: 'measure', meaning: 'Completed request duration', unit: 'ms' };
const statistics: ProfileStatistic[] = ['sum', 'min', 'max', 'mean', 'stddevPopulation', 'stddevSample', 'median', 'p95'];
function make(request: Partial<ProfileFieldRequest> = {}, limits: { maxExactValues?: number; maxDistinctValues?: number; quantileMethod?: ProfileQuantileMethod } = {}) {
  return createFieldAccumulator(column, { field: column.name, ...request }, {
    quantileMethod: 'linear', maxExactValues: 100, maxDistinctValues: 100, ...limits,
  });
}
function feed(values: unknown[], request: Partial<ProfileFieldRequest> = { statistics }) {
  const accumulator = make(request);
  values.forEach(value => accumulator.push(value));
  return accumulator.finish();
}
function expectProfileError(fn: () => unknown, code?: string) {
  try { fn(); throw new Error('Expected a ProfileError'); }
  catch (error) {
    expect(error).toBeInstanceOf(ProfileError);
    if (code) expect((error as ProfileError).code).toBe(code);
  }
}

describe('profile field accumulator: population and statistics', () => {
  it('matches independently calculated moments and both exact quantile conventions', () => {
    // Sum 40; squared deviations from mean 5 sum to 32. Type-7 median
    // averages positions 4 and 5; p95 interpolates 65% from 7 to 9.
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    const result = feed(values);
    expect(result).toMatchObject({ field: 'duration', type: 'number', role: 'measure',
      meaning: column.meaning, unit: 'ms', known: 8, unknown: 0 });
    expect(result.statistics).toMatchObject({ sum: 40, min: 2, max: 9, mean: 5, median: 4.5 });
    expect(result.statistics!.p95).toBeCloseTo(8.3, 12);
    expect(result.statistics!.stddevPopulation).toBeCloseTo(2, 12);
    expect(result.statistics!.stddevSample).toBeCloseTo(Math.sqrt(32 / 7), 12);
    const nearest = make({ statistics: ['median', 'p95'] }, { quantileMethod: 'nearest-rank' });
    values.reverse().forEach(value => nearest.push(value));
    expect(nearest.finish().statistics).toEqual({ median: 4, p95: 9 });
  });

  it('counts zero as known, excludes only null/undefined, and preserves signed measurements', () => {
    const result = feed([null, 0, undefined, -2, 2], { statistics, frequencies: true });
    expect(result.known).toBe(3);
    expect(result.unknown).toBe(2);
    expect(result.statistics).toMatchObject({ sum: 0, min: -2, max: 2, mean: 0, median: 0 });
    expect(result.frequencies).toEqual([{ value: -2, count: 1 }, { value: 0, count: 1 }, { value: 2, count: 1 }]);
  });

  it('returns null for every requested statistic on empty and all-unknown populations', () => {
    for (const values of [[], [null, undefined]]) {
      const result = feed(values, { statistics, frequencies: true });
      expect(result.known).toBe(0);
      expect(result.unknown).toBe(values.length);
      expect(result.statistics).toEqual(Object.fromEntries(statistics.map(stat => [stat, null])));
      expect(result.frequencies).toEqual([]);
    }
  });

  it('distinguishes a single observation from an estimable sample SD', () => {
    expect(feed([0]).statistics).toEqual({ sum: 0, min: 0, max: 0, mean: 0,
      stddevPopulation: 0, stddevSample: null, median: 0, p95: 0 });
    expect(feed([7, 7, 7]).statistics).toEqual({ sum: 21, min: 7, max: 7, mean: 7,
      stddevPopulation: 0, stddevSample: 0, median: 7, p95: 7 });
  });

  it('returns only requested outputs, with no implicit statistics or frequencies', () => {
    expect(feed([1, null], {})).toEqual({ field: 'duration', type: 'number', role: 'measure',
      meaning: column.meaning, unit: 'ms', known: 1, unknown: 1 });
    expect(feed([1, 2], { statistics: ['max'] }).statistics).toEqual({ max: 2 });
  });
});

describe('profile field accumulator: exact frequencies and type boundaries', () => {
  it('keeps arbitrary strings safe and orders by value independently of insertion order', () => {
    const text: ProfileColumn = { name: 'client', type: 'string', role: 'identifier', meaning: 'Client identity' };
    const acc = createFieldAccumulator(text, { field: 'client', frequencies: true }, { maxExactValues: 1, maxDistinctValues: 5 });
    ['z', '__proto__', 'constructor', '', '__proto__', 'A', null].forEach(v => acc.push(v));
    expect(acc.finish()).toEqual({ field: 'client', type: 'string', role: 'identifier', meaning: 'Client identity', known: 6, unknown: 1,
      frequencies: [{ value: '', count: 1 }, { value: 'A', count: 1 }, { value: '__proto__', count: 2 },
        { value: 'constructor', count: 1 }, { value: 'z', count: 1 }] });
  });

  it('supports false as a known boolean and sorts false before true', () => {
    const acc = createFieldAccumulator({ name: 'flag', type: 'boolean', role: 'dimension', meaning: 'Recorded flag' },
      { field: 'flag', frequencies: true }, { maxExactValues: 1, maxDistinctValues: 2 });
    [true, false, false, undefined].forEach(v => acc.push(v));
    expect(acc.finish()).toMatchObject({ known: 3, unknown: 1, frequencies: [{ value: false, count: 2 }, { value: true, count: 1 }] });
  });

  it('coalesces signed zeros in frequencies and orders numbers numerically', () => {
    expect(feed([10, 2, -0, 0], { frequencies: true }).frequencies)
      .toEqual([{ value: 0, count: 2 }, { value: 2, count: 1 }, { value: 10, count: 1 }]);
  });

  it.each(['1', true, NaN, Infinity, -Infinity, {}, [], new Date()])('refuses invalid numeric value %s without coercion', value => {
    const acc = make({ statistics: ['mean'] });
    acc.push(10);
    expectProfileError(() => acc.push(value));
    // A caught input error must not turn the retained prefix into a success.
    expectProfileError(() => acc.finish());
  });

  it('refuses statistics over identifiers and unsupported date/unknown domains', () => {
    for (const declaration of [
      { ...column, role: 'identifier' as const },
      { ...column, type: 'string' as const },
      { ...column, type: 'date' as const },
      { ...column, type: 'unknown' as const },
    ]) expectProfileError(() => createFieldAccumulator(declaration, { field: column.name, statistics: ['mean'] }, { maxExactValues: 10, maxDistinctValues: 10 }));
  });

  it('refuses cross-typed string and boolean inputs', () => {
    for (const [type, value] of [['string', 123], ['boolean', 'false']] as const) {
      const acc = createFieldAccumulator({ ...column, type, role: 'dimension' }, { field: column.name, frequencies: true }, { maxExactValues: 10, maxDistinctValues: 10 });
      expectProfileError(() => acc.push(value));
    }
  });
});

describe('profile field accumulator: resource and ownership limits', () => {
  it('counts only known retained values against the exact quantile limit and fails at the next value', () => {
    const acc = make({ statistics: ['median'] }, { maxExactValues: 2 });
    [null, 1, undefined, 3].forEach(v => acc.push(v));
    expect(acc.finish().statistics).toEqual({ median: 2 });
    expectProfileError(() => acc.push(5));
    expectProfileError(() => acc.finish());
  });

  it('caps distinct frequency values, not total observations, and never returns truncated frequencies', () => {
    const acc = make({ frequencies: true }, { maxDistinctValues: 2 });
    [1, 2, 1, 2, null].forEach(v => acc.push(v));
    expect(acc.finish().frequencies).toEqual([{ value: 1, count: 2 }, { value: 2, count: 2 }]);
    expectProfileError(() => acc.push(3));
    expectProfileError(() => acc.finish());
  });

  it('does not impose retention limits when neither exact values nor frequencies were requested', () => {
    const acc = make({ statistics: ['sum', 'mean', 'min', 'max'] }, { maxExactValues: 1, maxDistinctValues: 1 });
    for (let i = 1; i <= 1_000; i++) acc.push(i);
    expect(acc.finish().statistics).toEqual({ sum: 500_500, mean: 500.5, min: 1, max: 1_000 });
  });

  it('requires an explicit quantile method and sane direct-call contracts', () => {
    expectProfileError(() => createFieldAccumulator(column, { field: 'duration', statistics: ['median'] }, { maxExactValues: 10, maxDistinctValues: 10 }));
    expectProfileError(() => createFieldAccumulator(column, { field: 'wrong' }, { maxExactValues: 10, maxDistinctValues: 10 }));
    for (const limit of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expectProfileError(() => make({}, { maxExactValues: limit }));
      expectProfileError(() => make({}, { maxDistinctValues: limit }));
    }
  });

  it('rejects malformed direct-call requests and optional settings before any input is accepted', () => {
    for (const request of [
      { field: column.name, statistics: 'mean' },
      { field: column.name, statistics: ['not-a-statistic'] },
      { field: column.name, frequencies: 'yes' },
    ]) {
      expectProfileError(() => createFieldAccumulator(column, request as unknown as ProfileFieldRequest,
        { maxExactValues: 10, maxDistinctValues: 10 }), 'INVALID_PROFILE');
    }
    expectProfileError(() => createFieldAccumulator(column, { field: column.name }, {
      maxExactValues: 10, maxDistinctValues: 10,
      quantileMethod: 'approximate' as ProfileQuantileMethod,
    }), 'INVALID_PROFILE');
    expectProfileError(() => createFieldAccumulator(column, { field: column.name }, {
      maxExactValues: 10, maxDistinctValues: 10,
      reserve: false as unknown as (kind: 'exact' | 'frequency', value: number | string | boolean) => void,
    }), 'INVALID_PROFILE');
  });

  it('detaches input declarations and output objects so mutation cannot change the running profile', () => {
    const declaration = { ...column };
    const requested: ProfileStatistic[] = ['median', 'sum'];
    const acc = createFieldAccumulator(declaration, { field: 'duration', statistics: requested, frequencies: true }, { quantileMethod: 'linear', maxExactValues: 10, maxDistinctValues: 10 });
    acc.push(3); acc.push(1);
    declaration.meaning = 'Changed'; declaration.unit = 'seconds'; requested.push('max');
    const first = acc.finish() as unknown as { statistics: Record<string, number>; frequencies: { value: unknown; count: number }[] };
    first.statistics.sum = 999; first.frequencies[0]!.count = 999; first.frequencies.push({ value: 'fake', count: 1 });
    expect(acc.finish()).toMatchObject({ meaning: column.meaning, unit: 'ms', statistics: { median: 2, sum: 4 },
      frequencies: [{ value: 1, count: 1 }, { value: 3, count: 1 }] });
    expect(Object.keys(acc.finish().statistics!)).toEqual(['median', 'sum']);
  });
});

describe('profile field accumulator: finite arithmetic boundaries', () => {
  it('retains small contributions through cancellation rather than reporting a manufactured zero', () => {
    const result = feed([1e16, 1, -1e16], { statistics: ['sum', 'mean'] });
    expect(result.statistics!.sum).toBeCloseTo(1, 12);
    expect(result.statistics!.mean).toBeCloseTo(1 / 3, 12);
  });

  it('keeps finite means valid even when the unrequested sum would overflow', () => {
    const result = feed([Number.MAX_VALUE, Number.MAX_VALUE], { statistics: ['mean', 'min', 'max', 'stddevPopulation'] });
    expect(result.statistics).toEqual({ mean: Number.MAX_VALUE, min: Number.MAX_VALUE, max: Number.MAX_VALUE, stddevPopulation: 0 });
    expectProfileError(() => feed([Number.MAX_VALUE, Number.MAX_VALUE], { statistics: ['sum'] }));
  });

  it('rescales later larger observations and recovers finite totals after overflowing partial sums', () => {
    const values = [1e308, 1e308, Number.MAX_VALUE, -Number.MAX_VALUE, -1e308];
    const result = feed(values, { statistics: ['sum', 'mean'] });
    expect(result.statistics!.sum! / 1e308).toBeCloseTo(1, 12);
    expect(result.statistics!.mean! / 1e308).toBeCloseTo(1 / values.length, 12);
  });

  it('computes a finite mean when accumulated rounding residuals overflow only the final sum', () => {
    // Every addition rounds back to MAX_VALUE, but the compensated residual
    // eventually crosses its final overflow boundary. Divide before adding.
    const values = [Number.MAX_VALUE, ...Array<number>(10).fill(1e291)];
    const result = feed(values, { statistics: ['mean'] });
    const expected = Number.MAX_VALUE / values.length + 1e292 / values.length;
    expect(result.statistics!.mean).toBe(expected);
    expectProfileError(() => feed(values, { statistics: ['sum'] }), 'NUMERIC_OVERFLOW');
  });

  it('does not overflow intermediate quantile differences or squared deviations for finite answers', () => {
    const result = feed([-Number.MAX_VALUE, Number.MAX_VALUE], { statistics: ['median', 'p95', 'mean', 'stddevPopulation'] });
    expect(result.statistics!.median).toBe(0);
    expect(result.statistics!.mean).toBe(0);
    expect(result.statistics!.p95! / Number.MAX_VALUE).toBeCloseTo(0.9, 12);
    expect(result.statistics!.stddevPopulation! / Number.MAX_VALUE).toBeCloseTo(1, 12);
    // Sample SD is sqrt(2)*MAX_VALUE, genuinely outside finite Number range.
    expectProfileError(() => feed([-Number.MAX_VALUE, Number.MAX_VALUE], { statistics: ['stddevSample'] }));
  });

  it('keeps small spread beside a large offset without subtracting raw squared sums', () => {
    const result = feed([1e12 + 1, 1e12 + 2, 1e12 + 3, 1e12 + 4], { statistics: ['mean', 'stddevPopulation', 'stddevSample'] });
    expect(result.statistics!.mean).toBe(1e12 + 2.5);
    expect(result.statistics!.stddevPopulation).toBeCloseTo(Math.sqrt(1.25), 4);
    expect(result.statistics!.stddevSample).toBeCloseTo(Math.sqrt(5 / 3), 4);
  });
});

describe('profile field accumulator: shared retention reservations', () => {
  const options = { quantileMethod: 'linear' as const, maxExactValues: 10, maxDistinctValues: 10 };

  it('reserves every exact slot and only new frequency keys, excluding unknowns', () => {
    const reserved: [string, unknown][] = [];
    const acc = createFieldAccumulator(column, { field: column.name, statistics: ['median'], frequencies: true },
      { ...options, reserve: (kind, value) => { reserved.push([kind, value]); } });
    [null, -0, undefined, 0, 3].forEach(value => acc.push(value));
    expect(reserved).toEqual([['exact', 0], ['frequency', 0], ['exact', 0], ['exact', 3], ['frequency', 3]]);
    expect(acc.finish()).toMatchObject({ known: 3, unknown: 2, statistics: { median: 0 },
      frequencies: [{ value: 0, count: 2 }, { value: 3, count: 1 }] });
  });

  it('makes no reservation for constant-space statistics or counts alone', () => {
    let reserved = 0;
    for (const request of [{ field: column.name }, { field: column.name, statistics: ['sum', 'mean'] as ProfileStatistic[] }]) {
      const acc = createFieldAccumulator(column, request, { ...options, reserve: () => { reserved++; } });
      [1, 2, null, 3].forEach(value => acc.push(value));
      expect(acc.finish().known).toBe(3);
    }
    expect(reserved).toBe(0);
  });

  it('reserves safe string/boolean frequency keys and does not re-reserve while finishing', () => {
    for (const [type, values] of [['string', ['__proto__', '__proto__', '']], ['boolean', [false, true, false]]] as const) {
      const reserved: unknown[] = [];
      const acc = createFieldAccumulator({ ...column, type, role: 'dimension' }, { field: column.name, frequencies: true },
        { ...options, reserve: (kind, value) => { reserved.push([kind, value]); } });
      values.forEach(value => acc.push(value));
      acc.finish(); acc.finish();
      expect(reserved).toEqual([['frequency', values[0]], ['frequency', values[2] === '' ? '' : true]]);
    }
  });

  it('latches a rejected reservation, even when another retention reservation already succeeded', () => {
    const error = new ProfileError('PROFILE_LIMIT', 'Shared retention budget exhausted');
    const reservations: string[] = [];
    const acc = createFieldAccumulator(column, { field: column.name, statistics: ['median'], frequencies: true },
      { ...options, reserve: kind => { reservations.push(kind); if (kind === 'frequency') throw error; } });
    expect(() => acc.push(3)).toThrow(error);
    expect(reservations).toEqual(['exact', 'frequency']);
    expect(() => acc.finish()).toThrow(error);
    expect(() => acc.push(null)).toThrow(error);
    expect(reservations).toHaveLength(2);
  });

  it.each([new Error('Host reservation service failed'), undefined, null])('latches any host reservation exception without allowing a successful prefix: %s', error => {
    let reservations = 0;
    const acc = createFieldAccumulator(column, { field: column.name, frequencies: true },
      { ...options, reserve: () => { if (++reservations === 2) throw error; } });
    acc.push(1);
    for (const action of [() => acc.push(3), () => acc.finish(), () => acc.push(null)]) {
      let returned = false;
      try { action(); returned = true; }
      catch (thrown) { expect(thrown).toBe(error); }
      expect(returned).toBe(false);
    }
    expect(reservations).toBe(2);
  });

  it('lets one caller budget cap retention across multiple fields', () => {
    let used = 0;
    const reserve = () => { if (used === 3) throw new ProfileError('PROFILE_LIMIT', 'Shared limit'); used++; };
    const a = createFieldAccumulator(column, { field: column.name, statistics: ['median'] }, { ...options, reserve });
    const b = createFieldAccumulator(column, { field: column.name, frequencies: true }, { ...options, reserve });
    a.push(1); b.push(1); a.push(2);
    b.push(1); // An existing frequency value costs no additional retained key.
    expect(used).toBe(3);
    expectProfileError(() => b.push(2), 'PROFILE_LIMIT');
    expectProfileError(() => b.finish(), 'PROFILE_LIMIT');
  });
});
