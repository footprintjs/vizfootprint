import { describe, expect, it, vi } from 'vitest';
import { profileData } from './run.js';
import { createArrayProfileProvider } from './memory.js';
import type { ProfileEvent, ProfileOptions, ProfilePlan, ProfileProvider, ProfileSchema } from './types.js';

const schema: ProfileSchema = {
  source: { id: 'requests', version: 'capture-1' }, table: 'requests', grain: 'one recorded request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Observed client' },
    { name: 'duration', type: 'number', role: 'measure', meaning: 'Completed duration', unit: 'ms' },
    { name: 'port', type: 'number', role: 'identifier', meaning: 'Transport port' },
  ],
};
const rows = [
  { client: 'a', duration: 0, port: 445 }, { client: 'a', duration: 10, port: 445 },
  { client: 'a', duration: null, port: 445 }, { client: 'b', duration: 1000, port: 445 },
  { client: null, duration: 50, port: 445 },
];
const plan: ProfilePlan = {
  kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'client-a',
  where: { op: 'eq', args: [{ col: 'client' }, { lit: 'a' }] },
  fields: [{ field: 'duration', statistics: ['sum', 'mean', 'median', 'p95'] }, { field: 'client', frequencies: true }],
  quantileMethod: 'linear',
};
const options: ProfileOptions = { operationId: 'profile-1', resultRef: 'result-1' };
const provider = () => createArrayProfileProvider(schema, rows);

describe('profile execution: selected population and provenance', () => {
  it('filters before calculation and reports row grain, units, unknowns and actual scope', async () => {
    const result = await profileData(provider(), plan, options);
    expect(result.population).toEqual({ scanned: 5, selected: 3, excluded: 2, predicateUnknown: 1 });
    expect(result.fields[0]).toMatchObject({ known: 2, unknown: 1, unit: 'ms', statistics: { sum: 10, mean: 5, median: 5, p95: 9.5 } });
    expect(result.fields[1]!.frequencies).toEqual([{ value: 'a', count: 3 }]);
    expect(result.plan).toMatchObject(plan);
    expect(result.schema).toEqual(schema);
    expect(result.resultRef).toBe(options.resultRef);
    expect(result.execution).toMatchObject({ passes: 1, exact: true, strategy: 'stream', observerFailures: 0 });
    expect(result.conventions.statisticsPopulation).toBe('known-selected-values');
  });

  it('reports empty selections with null statistics, never a fabricated zero', async () => {
    const result = await profileData(provider(), { ...plan, where: { lit: false } }, options);
    expect(result.population).toEqual({ scanned: 5, selected: 0, excluded: 5, predicateUnknown: 0 });
    expect(result.fields[0]!.statistics).toEqual({ sum: null, mean: null, median: null, p95: null });
    expect(result.fields[1]!.frequencies).toEqual([]);
  });

  it('scans exactly once with only requested and predicate columns; async provider has the same answer', async () => {
    const scan = vi.fn(async function* (_source, projection) {
      expect(projection).toEqual(['client', 'duration']);
      for (const row of rows) yield row;
    });
    const result = await profileData({ describe: () => schema, scan }, plan, options);
    const memory = await profileData(provider(), plan, options);
    expect(result.fields).toEqual(memory.fields);
    expect(result.population).toEqual(memory.population);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0]![0]).toEqual(schema.source);
  });

  it('keeps existing Expr strict absence semantics, including false AND unknown', async () => {
    const result = await profileData(provider(), { ...plan, where: {
      op: 'and', args: [{ lit: false }, { op: 'eq', args: [{ col: 'client' }, { lit: 'a' }] }],
    } }, options);
    expect(result.population).toMatchObject({ selected: 0, predicateUnknown: 1 });
  });

  it('can explicitly select unknown cells, and distinguishes them from zero', async () => {
    const result = await profileData(provider(), { ...plan, where: { op: 'isAbsent', args: [{ col: 'duration' }] } }, options);
    expect(result.population.selected).toBe(1);
    expect(result.fields[0]).toMatchObject({ known: 0, unknown: 1, statistics: { sum: null } });
  });

  it('validates requested measure cells only within the selected population', async () => {
    const source = createArrayProfileProvider(schema, [{ client: 'a', duration: 2 }, { client: 'b', duration: 'bad' }]);
    expect((await profileData(source, plan, options)).fields[0]!.statistics!.mean).toBe(2);
    await expect(profileData(source, { ...plan, where: { lit: true } }, options)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });
});

describe('profile refusal before data access', () => {
  it.each([
    { version: 2 }, { ops: 999 }, { fields: [] }, { fields: [{ field: 'duration', statistics: ['sum', 'sum'] }] },
    { fields: [{ field: 'duration', statistics: ['average'] }] }, { quantileMethod: 'approximate' },
    { limits: { maxScannedRows: 0 } }, { limits: { maxScannedRows: 10_000_001 } },
    { limits: { maxExactValues: 1_000_001 } }, { limits: { maxDistinctValues: 4097 } },
    { limits: { maxRows: 1 } }, { source: { id: 'requests' } }, { selectionRef: '' },
    { fields: [{ field: 'duration' }, { field: 'duration' }] }, { fields: [{ field: 'client', frequencies: 'yes' }] },
  ])('refuses unsupported plans without reading the provider: %j', async change => {
    const describe = vi.fn(() => schema), scan = vi.fn(() => rows);
    await expect(profileData({ describe, scan }, { ...plan, ...change } as ProfilePlan, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(describe).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
  });

  it('requires explicit quantiles, refuses unknown keys and non-JSON payloads', async () => {
    const noMethod = { ...plan }; delete noMethod.quantileMethod;
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const input of [noMethod, { ...plan, surprise: true }, { ...plan, where: cyclic },
      { ...plan, where: () => true }, { ...plan, where: { lit: NaN } },
      { ...plan, selectionRef: new Date() }, { ...plan, fields: Array(2) },
    ]) await expect(profileData(provider(), input as ProfilePlan, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    const getter = vi.fn(() => plan.source);
    await expect(profileData(provider(), { ...plan, get source() { return getter(); } }, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { fields: [{ field: 'port', statistics: ['mean'] }] },
    { fields: [{ field: 'client', statistics: ['mean'] }] },
    { fields: [{ field: 'typo' }] }, { where: { col: 'duration' } },
    { where: { op: 'sum', args: [{ col: 'duration' }] } },
    { where: { op: 'eq', args: [{ col: 'typo' }, { lit: 'a' }] } },
  ])('judges schema and expression meaning before scan: %j', async change => {
    const scan = vi.fn(() => rows);
    await expect(profileData({ describe: () => schema, scan }, { ...plan, ...change } as ProfilePlan, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('refuses mismatched source version and unsupported referenced types before scanning', async () => {
    const scan = vi.fn(() => rows);
    await expect(profileData({ describe: () => ({ ...schema, source: { ...schema.source, version: 'capture-2' } }), scan }, plan, options))
      .rejects.toMatchObject({ code: 'SOURCE_MISMATCH' });
    for (const type of ['date', 'unknown'] as const) {
      await expect(profileData({ describe: () => ({ ...schema, columns: schema.columns.map(c => c.name === 'duration' ? { ...c, type } : c) }), scan }, plan, options))
        .rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    }
    expect(scan).not.toHaveBeenCalled();
  });
});

describe('profile lifecycle and iterator cleanup', () => {
  it('emits scoped progress and one terminal event without leaking row values', async () => {
    const events: ProfileEvent[] = [];
    await profileData(provider(), plan, { ...options, progressEvery: 2, onEvent: event => events.push(event) });
    expect(events.map(e => e.status)).toEqual(['started', 'progress', 'progress', 'completed']);
    expect(events.map(e => e.scanned)).toEqual([0, 2, 4, 5]);
    for (const event of events) {
      expect(event.source).toEqual(schema.source); expect(event.operationId).toBe(options.operationId);
      expect(event.selectionRef).toBe(plan.selectionRef); expect(event).not.toHaveProperty('rows');
    }
    expect(events.at(-1)!.resultRef).toBe(options.resultRef);
  });

  it('isolates failing observers, including the completed event', async () => {
    const result = await profileData(provider(), plan, { ...options, progressEvery: 2, onEvent: () => { throw new Error('observer unavailable'); } });
    expect(result.execution.observerFailures).toBe(4);
    expect(result.fields[0]!.statistics!.sum).toBe(10);
  });

  it('counts asynchronous observers as unsupported without waiting or leaking rejections', async () => {
    for (const onEvent of [async () => { throw new Error('late rejection'); }, () => new Promise<void>(() => {})]) {
      const result = await profileData(provider(), plan, { ...options, onEvent });
      expect(result.execution.observerFailures).toBe(2);
      expect(result.fields[0]!.statistics!.sum).toBe(10);
    }
  });

  it('cancels a pending describe promptly and consumes its eventual rejection', async () => {
    const controller = new AbortController(), events: ProfileEvent[] = [];
    let rejectDescribe!: (reason: Error) => void;
    const description = new Promise<ProfileSchema>((_resolve, reject) => { rejectDescribe = reject; });
    const scan = vi.fn(() => rows);
    const source: ProfileProvider = { describe: (_ref, signal) => { expect(signal).toBe(controller.signal); return description; }, scan };
    const task = profileData(source, plan, { ...options, signal: controller.signal, onEvent: event => events.push(event) });
    controller.abort();
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    rejectDescribe(new Error('late provider rejection'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scan).not.toHaveBeenCalled();
    expect(events.map(e => e.status)).toEqual(['started', 'cancelled']);
  });

  it('cancels pending async next, requests return once, and consumes late I/O failure', async () => {
    const controller = new AbortController(), events: ProfileEvent[] = [];
    let rejectIO!: (error: Error) => void, entered!: () => void, closed = false;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const io = new Promise<void>((_resolve, reject) => { rejectIO = reject; });
    const iterator = (async function* () { try { entered(); await io; yield rows[0]!; } finally { closed = true; } })();
    const returned = vi.spyOn(iterator, 'return');
    const task = profileData({ describe: () => schema, scan: () => iterator }, plan,
      { ...options, signal: controller.signal, onEvent: event => events.push(event) });
    await ready; controller.abort();
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(returned).toHaveBeenCalledTimes(1); expect(closed).toBe(false);
    rejectIO(new Error('I/O failed after cancellation'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(closed).toBe(true);
    expect(events.map(e => e.status)).toEqual(['started', 'cancelled']);
  });

  it('can cancel while cleanup after a failed row is pending', async () => {
    const controller = new AbortController();
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const closing = new Promise<void>(resolve => { release = resolve; });
    const iterator = (async function* () {
      try { yield { client: 9, duration: 1 }; } finally { entered(); await closing; }
    })();
    const task = profileData({ describe: () => schema, scan: () => iterator }, plan, { ...options, signal: controller.signal });
    await ready; controller.abort();
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    release();
  });

  it('cancels during a synchronous stream and closes the generator without returning a prefix', async () => {
    const controller = new AbortController();
    const events: ProfileEvent[] = [];
    let closed = false, yielded = 0;
    const source: ProfileProvider = { describe: () => schema, *scan() {
      try { for (let i = 0; i < 100_000; i++) { yielded++; yield rows[0]!; } }
      finally { closed = true; }
    } };
    const task = profileData(source, plan, { ...options, signal: controller.signal, progressEvery: 2,
      onEvent: event => { events.push(event); if (event.status === 'progress') setTimeout(() => controller.abort(), 0); },
    });
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(closed).toBe(true); expect(yielded).toBe(2);
    expect(events.map(e => e.status)).toEqual(['started', 'progress', 'cancelled']);
    expect(events.at(-1)).not.toHaveProperty('resultRef');
  });

  it('does not start the provider for an already cancelled job', async () => {
    const controller = new AbortController(); controller.abort();
    const describe = vi.fn(() => schema);
    await expect(profileData({ describe, scan: () => rows }, plan, { ...options, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(describe).not.toHaveBeenCalled();
  });

  it('refuses a scan limit across excluded rows and closes the iterator', async () => {
    let closed = false;
    const source: ProfileProvider = { describe: () => schema, *scan() {
      try { yield* rows; } finally { closed = true; }
    } };
    await expect(profileData(source, { ...plan, where: { lit: false }, limits: { maxScannedRows: 2 } }, options)).rejects.toMatchObject({ code: 'PROFILE_LIMIT' });
    expect(closed).toBe(true);
    expect((await profileData(provider(), { ...plan, limits: { maxScannedRows: 5 } }, options)).population.scanned).toBe(5);
  });

  it('fails on invalid predicate values or provider exceptions, with a failed event', async () => {
    for (const kind of ['invalid-value', 'provider-throw'] as const) {
      const events: ProfileEvent[] = []; let closed = false;
      const source: ProfileProvider = { describe: () => schema, *scan() {
        try { yield rows[0]!; if (kind === 'provider-throw') throw new Error('private driver details'); yield { client: 7, duration: 10 }; }
        finally { closed = true; }
      } };
      const code = kind === 'provider-throw' ? 'PROVIDER_FAILURE' : 'INVALID_VALUE';
      await expect(profileData(source, plan, { ...options, onEvent: e => events.push(e) })).rejects.toMatchObject({ code });
      expect(closed).toBe(true); expect(events.map(e => e.status)).toEqual(['started', 'failed']);
      expect(events.at(-1)!.error!.code).toBe(code);
    }
  });
});

describe('profile ownership and bounded values', () => {
  it('detaches the plan before awaiting the provider and snapshots an array provider', async () => {
    const input = structuredClone(plan), data = structuredClone(rows), definition = structuredClone(schema);
    const memory = createArrayProfileProvider(definition, data);
    const source: ProfileProvider = { describe: async ref => { (input as { selectionRef: string }).selectionRef = 'changed'; data[0]!.duration = 999; (definition.columns[0]! as { meaning: string }).meaning = 'Changed'; return memory.describe(ref); }, scan: memory.scan };
    const result = await profileData(source, input, options);
    expect(result.plan.selectionRef).toBe('client-a'); expect(result.fields[0]!.statistics!.sum).toBe(10);
    expect(result.schema.columns[0]!.meaning).toBe('Observed client');
    expect(result.plan).not.toBe(input); expect(result.schema).not.toBe(schema);
  });

  it('protects declarations from observer mutation and never treats inherited values as evidence', async () => {
    const memory = createArrayProfileProvider(schema, [Object.create({ client: 'a', duration: 100 }) as Record<string, unknown>]);
    const result = await profileData(memory, plan, { ...options, onEvent: event => { (event.source as { version: string }).version = 'wrong'; } });
    expect(result.population).toMatchObject({ selected: 0, predicateUnknown: 1 });
    expect(result.execution.observerFailures).toBe(2);
    expect(result.schema.source.version).toBe('capture-1');
  });

  it('handles prototype-like field names as ordinary own columns', async () => {
    const definition: ProfileSchema = { ...schema, columns: [{ name: '__proto__', type: 'number', role: 'measure', meaning: 'Test measure' }] };
    const data = [JSON.parse('{"__proto__":5}'), JSON.parse('{"__proto__":7}')];
    const result = await profileData(createArrayProfileProvider(definition, data), { ...plan, where: { lit: true }, fields: [{ field: '__proto__', statistics: ['sum'] }] }, options);
    expect(result.fields[0]!.statistics!.sum).toBe(12);
  });

  it('refuses exact-value, frequency and string bounds without a completed event', async () => {
    const trials: ProfilePlan[] = [
      { ...plan, limits: { maxExactValues: 1 } },
      { ...plan, where: { lit: true }, limits: { maxDistinctValues: 1 } },
    ];
    for (const trial of trials) {
      const events: ProfileEvent[] = [];
      await expect(profileData(provider(), trial, { ...options, onEvent: e => events.push(e) })).rejects.toMatchObject({ code: 'PROFILE_LIMIT' });
      expect(events.map(e => e.status)).toEqual(['started', 'failed']);
    }
    await expect(profileData(createArrayProfileProvider(schema, [{ client: 'x'.repeat(16_385), duration: 1 }]), plan, options))
      .rejects.toMatchObject({ code: 'PROFILE_LIMIT' });
  });

  it('applies a combined budget across fields and counts exact plus frequency retention separately', async () => {
    const exactAndFrequency: ProfilePlan = { ...plan, fields: [{ field: 'duration', statistics: ['median'], frequencies: true }], limits: { maxRetainedValues: 3 } };
    await expect(profileData(provider(), exactAndFrequency, options)).rejects.toMatchObject({ code: 'PROFILE_LIMIT' });
    const result = await profileData(provider(), { ...exactAndFrequency, limits: { maxRetainedValues: 4 } }, options);
    expect(result.execution.retainedValues).toBe(4); // Two exact observations and two distinct frequency keys.
    const definition: ProfileSchema = { ...schema, columns: ['first', 'second'].map(name => ({ name, type: 'string', role: 'dimension', meaning: name })) };
    const source = createArrayProfileProvider(definition, [{ first: 'abc', second: 'def' }, { first: 'abc', second: 'def' }]);
    const acrossFields: ProfilePlan = { ...plan, where: { lit: true }, fields: [{ field: 'first', frequencies: true }, { field: 'second', frequencies: true }], limits: { maxRetainedCharacters: 5 } };
    await expect(profileData(source, acrossFields, options)).rejects.toMatchObject({ code: 'PROFILE_LIMIT' });
    const bounded = await profileData(source, { ...acrossFields, limits: { maxRetainedCharacters: 6 } }, options);
    expect(bounded.execution.retainedCharacters).toBe(6); expect(bounded.execution.retainedValues).toBe(2);
    expect(bounded.fields[0]!.frequencies).toEqual([{ value: 'abc', count: 2 }]);
  });

  it('bounds array snapshots before execution limits and directs large sources to streaming', () => {
    const repeated = new Array(700_000).fill(rows[0]); // 2.1M declared cells, even though row count is legal.
    expect(() => createArrayProfileProvider(schema, repeated)).toThrow('2000000 declared cells');
    const stringRows = Array.from({ length: 801 }, () => ({ client: 'x'.repeat(10_000), duration: 1 }));
    expect(() => createArrayProfileProvider(schema, stringRows)).toThrow('8000000 string characters');
  });
});
