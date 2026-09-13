import { describe, expect, it, vi } from 'vitest';
import { profileCell } from './cell.js';
import { createArrayProfileProvider } from './memory.js';
import { profileData } from './run.js';
import type { ProfileOptions, ProfilePlan, ProfileProvider, ProfileSchema } from './types.js';

const schema: ProfileSchema = { source: { id: 'series', version: '1' }, table: 'series', grain: 'one observation',
  columns: [{ name: 'value', type: 'number', role: 'measure', meaning: 'Recorded value' }] };
const plan: ProfilePlan = { kind: 'profile', version: 1, ops: 1, source: schema.source,
  selectionRef: 'all', fields: [{ field: 'value', statistics: ['sum'] }] };
const options: ProfileOptions = { operationId: 'op', resultRef: 'result' };

describe('profile provider boundary', () => {
  it('profiles the full source when no predicate is supplied', async () => {
    const result = await profileData(createArrayProfileProvider(schema, [{ value: 3 }, { value: 5 }]), plan, options);
    expect(result.population).toEqual({ scanned: 2, selected: 2, excluded: 0, predicateUnknown: 0 });
    expect(result.fields[0]!.statistics!.sum).toBe(8);
  });

  it('refuses malformed providers and callback options before reading a source', async () => {
    for (const provider of [null, {}, { describe: () => schema }, { describe: 1, scan: () => [] }]) {
      await expect(profileData(provider as unknown as ProfileProvider, plan, options)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    }
    const provider = { describe: vi.fn(() => schema), scan: vi.fn(() => []) };
    await expect(profileData(provider, plan, { ...options, onEvent: 'bad' } as unknown as ProfileOptions)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    await expect(profileData(provider, plan, undefined as unknown as ProfileOptions)).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(provider.describe).not.toHaveBeenCalled(); expect(provider.scan).not.toHaveBeenCalled();
  });

  it('refuses a scan without a usable iterator or rows with getters', async () => {
    for (const scan of [() => null, () => ({}), () => ({ [Symbol.iterator]: () => ({ next: 5 }) })]) {
      await expect(profileData({ describe: () => schema, scan } as unknown as ProfileProvider, plan, options)).rejects.toMatchObject({ code: 'PROVIDER_FAILURE' });
    }
    const getter = vi.fn(() => 7);
    for (const row of [null, [], 3, { get value() { return getter(); } }]) {
      await expect(profileData({ describe: () => schema, scan: () => [row] } as unknown as ProfileProvider, plan, options)).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('contains a throwing thenable accessor in a status observer', async () => {
    const result = await profileData(createArrayProfileProvider(schema, []), plan, {
      ...options, onEvent: () => ({ get then() { throw new Error('observer accessor'); } }),
    });
    expect(result.execution.observerFailures).toBe(2);
  });

  it('does not interpret an unsupported cell type as an absent number', () => {
    expect(() => profileCell(null, { ...schema.columns[0]!, type: 'unknown' })).toThrow('not supported');
  });
});

describe('array provider snapshot boundary', () => {
  it('rejects nonarrays, oversized arrays and invalid rows before a scan is possible', () => {
    for (const rows of [null, {}, new Array(1_000_001), [null], [[]], [42]]) {
      expect(() => createArrayProfileProvider(schema, rows as never)).toThrow();
    }
  });

  it('refuses mutable/non-JSON cells and accessors without invoking them', () => {
    for (const value of [{}, [], new Date(), () => 7, Symbol('x'), 1n]) {
      expect(() => createArrayProfileProvider(schema, [{ value }])).toThrow('primitive cells');
    }
    const getter = vi.fn(() => 10);
    expect(() => createArrayProfileProvider(schema, [{ get value() { return getter(); } }])).toThrow('accessors');
    expect(getter).not.toHaveBeenCalled();
  });

  it('judges source, projection and cancellation when consumed outside profileData', () => {
    const provider = createArrayProfileProvider(schema, [{ value: 5 }]);
    const other = { ...schema.source, version: '2' };
    expect(() => provider.describe(other)).toThrow('snapshot');
    expect(() => [...provider.scan(other, ['value']) as Iterable<unknown>]).toThrow('snapshot');
    expect(() => [...provider.scan(schema.source, ['unknown']) as Iterable<unknown>]).toThrow('Unknown projected column');
    const controller = new AbortController(); controller.abort();
    expect(() => [...provider.scan(schema.source, ['value'], controller.signal) as Iterable<unknown>]).toThrow('cancelled');
    expect([...provider.scan(schema.source, ['value']) as Iterable<unknown>]).toEqual([{ value: 5 }]);
  });
});
