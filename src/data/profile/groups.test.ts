import { describe, expect, it, vi } from 'vitest';
import { profileGroups } from './groups.js';
import { groupBasePlan, normalizeGroupPlan, GROUP_PROFILE_DEFAULT_LIMITS } from './groups.validate.js';
import { createArrayProfileProvider } from './memory.js';
import { profileData } from './run.js';
import type { GroupProfileEvent, GroupProfilePlan } from './groups.types.js';
import type { ProfileSchema } from './types.js';

const schema: ProfileSchema = { source: { id: 'requests', version: 'before-1' }, table: 'requests', grain: 'one observed request', columns: [
  { name: 'client', type: 'string', role: 'identifier', meaning: 'Observed client' },
  { name: 'operation', type: 'string', role: 'dimension', meaning: 'Recorded operation' },
  { name: 'duration', type: 'number', role: 'measure', meaning: 'Completed request duration', unit: 'ms' },
  { name: 'successful', type: 'boolean', role: 'dimension', meaning: 'Recorded success' },
] };
const rows = [
  { client: 'a', operation: 'read', duration: 1, successful: true },
  { client: 'a', operation: 'read', duration: 7, successful: false },
  { client: 'b', operation: 'read', duration: 100, successful: true },
  { client: 'b', operation: 'write', duration: 999, successful: true },
  { client: null, operation: 'read', duration: 20, successful: null },
  { client: 'ignored', operation: null, duration: 500, successful: true },
  { client: 'c', operation: 'read', duration: null, successful: null },
];
const plan: GroupProfilePlan = { kind: 'group-profile', version: 1, ops: 1, source: schema.source, selectionRef: 'reads',
  where: { op: 'eq', args: [{ col: 'operation' }, { lit: 'read' }] }, groupBy: ['client', 'operation'], unknownKeys: 'include',
  fields: [{ field: 'duration', statistics: ['sum', 'mean', 'p95'] }, { field: 'successful', frequencies: true }], quantileMethod: 'linear',
};
const options = { operationId: 'segmentation-1', resultRef: 'result:client-operation' };
const provider = () => createArrayProfileProvider(schema, rows);

describe('grouped profiling: one selected population and drill references', () => {
  it('reports the input and output grains, group coverage and within-group statistics', async () => {
    const result = await profileGroups(provider(), plan, options);
    expect(result.kind).toBe('group-profile'); expect(result.plan).toMatchObject(plan);
    expect(result.schema.grain).toBe('one observed request');
    expect(result.grain).toEqual({ kind: 'group', groupBy: ['client', 'operation'], sourceGrain: schema.grain });
    expect(result.groupOrder).toBe('first-seen');
    expect(result.population).toEqual({ scanned: 7, selected: 5, excluded: 2, predicateUnknown: 1, grouped: 5, withUnknownKeys: 1, excludedUnknownKeys: 0 });
    expect(result.groups.map(group => [group.keys.client, group.rowCount, group.fields[0]!.known, group.fields[0]!.unknown]))
      .toEqual([['a', 2, 2, 0], ['b', 1, 1, 0], [null, 1, 1, 0], ['c', 1, 0, 1]]);
    expect(result.groups[0]!.fields[0]).toMatchObject({ unit: 'ms', statistics: { sum: 8, mean: 4 } });
    expect(result.groups[0]!.fields[0]!.statistics!.p95).toBeCloseTo(6.7);
    expect(result.groups[3]!.fields[0]!.statistics).toEqual({ sum: null, mean: null, p95: null });
    expect(result.conventions.statisticsPopulation).toBe('known-selected-group-values');
    expect(result.groups.map(group => group.ref)).toEqual([0, 1, 2, 3].map(index => ({ resultRef: options.resultRef, index })));
  });

  it('replays every group filter through the original API and recovers exactly its evidence population', async () => {
    const source = provider();
    const result = await profileGroups(source, plan, options);
    for (const group of result.groups) {
      const replay = await profileData(source, { ...groupBasePlan(plan), where: group.where, selectionRef: JSON.stringify(group.ref) }, options);
      expect(replay.population.selected).toBe(group.rowCount);
      expect(replay.fields).toEqual(group.fields);
    }
  });

  it('streams once with the union of keys, predicates and measures, and labels operation events', async () => {
    const scan = vi.fn(async function* (_ref, columns) {
      expect(columns).toEqual(['operation', 'duration', 'successful', 'client']);
      yield* rows;
    });
    const events: GroupProfileEvent[] = [];
    const result = await profileGroups({ describe: () => schema, scan }, plan, { ...options, progressEvery: 3, onEvent: event => events.push(event) });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(result.execution.passes).toBe(1);
    expect(events.map(event => [event.operation, event.status, event.scanned, event.selected]))
      .toEqual([['group-profile', 'started', 0, 0], ['group-profile', 'progress', 3, 3], ['group-profile', 'progress', 6, 4], ['group-profile', 'completed', 7, 5]]);
    expect(events.at(-1)!.resultRef).toBe(options.resultRef);
  });

  it('keeps excluded unknown-key rows visible in population coverage and does not profile their measurements', async () => {
    const source = createArrayProfileProvider(schema, [{ client: null, operation: 'read', duration: 'invalid outside grouped population' }]);
    const result = await profileGroups(source, { ...plan, unknownKeys: 'exclude' }, options);
    expect(result.groups).toEqual([]);
    expect(result.population).toEqual({ scanned: 1, selected: 1, excluded: 0, predicateUnknown: 0, grouped: 0, withUnknownKeys: 1, excludedUnknownKeys: 1 });
    expect(result.execution.retainedValues).toBe(0);
    await expect(profileGroups(source, plan, options)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });

  it('does not return partial groups when the combined retention budget is exceeded', async () => {
    const events: GroupProfileEvent[] = [];
    await expect(profileGroups(provider(), { ...plan, limits: { maxRetainedValues: 3 } }, { ...options, onEvent: event => events.push(event) }))
      .rejects.toMatchObject({ code: 'PROFILE_LIMIT' });
    expect(events.map(event => event.status)).toEqual(['started', 'failed']);
    expect(events.at(-1)).not.toHaveProperty('resultRef');
  });

  it('captures caller-owned ids and plan before awaiting the provider', async () => {
    const changeable = { ...options }; const input = structuredClone(plan);
    const result = await profileGroups({ describe: async () => {
      changeable.resultRef = 'wrong'; changeable.operationId = 'wrong';
      (input as unknown as { groupBy: string[] }).groupBy[0] = 'successful';
      return schema;
    }, scan: () => rows }, input, changeable);
    expect(result.resultRef).toBe(options.resultRef); expect(result.operationId).toBe(options.operationId);
    expect(result.groups[0]!.ref.resultRef).toBe(options.resultRef);
    expect(result.plan.groupBy).toEqual(['client', 'operation']);
  });

  it('reads accessor-backed options once so groups, receipt and completion share validated identities', async () => {
    const reads = { operation: 0, result: 0, interval: 0, signal: 0, observer: 0 };
    const events: GroupProfileEvent[] = [];
    const result = await profileGroups(provider(), plan, {
      get operationId() { return `operation:${++reads.operation}`; },
      get resultRef() { return `result:${++reads.result}`; },
      get progressEvery() { reads.interval++; return 2; },
      get signal() { reads.signal++; return undefined; },
      get onEvent() { reads.observer++; return (event: GroupProfileEvent) => { events.push(event); }; },
    });
    expect(reads).toEqual({ operation: 1, result: 1, interval: 1, signal: 1, observer: 1 });
    expect(result.resultRef).toBe('result:1'); expect(result.operationId).toBe('operation:1');
    expect(result.groups.every(group => group.ref.resultRef === result.resultRef)).toBe(true);
    expect(events.every(event => event.operationId === result.operationId)).toBe(true);
    expect(events.at(-1)).toMatchObject({ status: 'completed', resultRef: result.resultRef });
  });

  it('uses shared cancellation and closes the source, with only one terminal event', async () => {
    const controller = new AbortController(); const events: GroupProfileEvent[] = []; let closed = false;
    const source = { describe: () => schema, *scan() { try { yield* rows; } finally { closed = true; } } };
    await expect(profileGroups(source, plan, { ...options, signal: controller.signal, progressEvery: 1,
      onEvent: event => { events.push(event); if (event.status === 'progress') controller.abort(); },
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(closed).toBe(true); expect(events.map(event => event.status)).toEqual(['started', 'progress', 'cancelled']);
  });
});

describe('group-profile plan boundary', () => {
  it('normalizes independent grouping caps while preserving all base profile semantics', () => {
    const normalized = normalizeGroupPlan(plan);
    expect(normalized.limits).toEqual(GROUP_PROFILE_DEFAULT_LIMITS);
    expect(Object.isFrozen(normalized)).toBe(true); expect(Object.isFrozen(normalized.groupBy)).toBe(true);
    const overridden = normalizeGroupPlan({ ...plan, limits: { maxGroups: 4096, maxGroupFields: 16_384, maxScannedRows: 10, maxRetainedValues: 9 } });
    expect(overridden.limits).toMatchObject({ maxGroups: 4096, maxGroupFields: 16_384, maxScannedRows: 10, maxRetainedValues: 9 });
    const base = groupBasePlan(overridden);
    expect(base.kind).toBe('profile'); expect(base).not.toHaveProperty('groupBy'); expect(base).not.toHaveProperty('unknownKeys');
    expect(base.limits).not.toHaveProperty('maxGroups'); expect(base.limits).not.toHaveProperty('maxGroupFields');
    expect(base.limits!.maxRetainedValues).toBe(9);
    expect(groupBasePlan(plan)).not.toHaveProperty('limits');
  });

  it.each([
    { kind: 'profile' }, { groupBy: [] }, { groupBy: 'client' }, { groupBy: ['', 'client'] },
    { groupBy: ['client', 'client'] }, { groupBy: ['a', 'b', 'c', 'd', 'e'] },
    { unknownKeys: 'drop' }, { unknownKeys: undefined }, { extra: true },
    { limits: null }, { limits: { maxGroups: 0 } }, { limits: { maxGroups: 4097 } },
    { limits: { maxGroupFields: 0 } }, { limits: { maxGroupFields: 16_385 } },
    { limits: { unknown: 1 } }, { limits: { maxScannedRows: 0 } },
    { fields: [{ field: 'duration', statistics: ['average'] }] }, { ops: 99 },
  ])('refuses malformed plans before source access: %j', async changed => {
    const source = { describe: vi.fn(() => schema), scan: vi.fn(() => rows) };
    await expect(profileGroups(source, { ...plan, ...changed } as unknown as GroupProfilePlan, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(source.describe).not.toHaveBeenCalled(); expect(source.scan).not.toHaveBeenCalled();
  });

  it('refuses keys outside the schema or unsupported types before scanning', async () => {
    const scan = vi.fn(() => rows);
    await expect(profileGroups({ describe: () => schema, scan }, { ...plan, groupBy: ['typo'] }, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    for (const type of ['date', 'unknown'] as const) {
      const definition = { ...schema, columns: schema.columns.map(c => c.name === 'client' ? { ...c, type } : c) };
      await expect(profileGroups({ describe: () => definition, scan }, plan, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    }
    expect(scan).not.toHaveBeenCalled();
  });
});
