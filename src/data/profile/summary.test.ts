import { describe, expect, it } from 'vitest';
import { profileData } from './run.js';
import { profileGroups } from './groups.js';
import { createArrayProfileProvider } from './memory.js';
import { summarizeProfileResult } from './summary.js';
import type { ProfileResult, ProfileSchema } from './types.js';
import type { ProfileSummaryOptions } from './summary.js';

const schema: ProfileSchema = { source: { id: 'synthetic:requests', version: '1' }, table: 'requests', grain: 'one observed request', columns: [
  { name: 'client', type: 'string', role: 'identifier', meaning: 'Source client identity' },
  { name: 'duration', type: 'number', role: 'measure', meaning: 'Known completed request duration', unit: 'ms' },
  { name: 'success', type: 'boolean', role: 'dimension', meaning: 'Recorded outcome' },
] };
const rows = [{ client: 'a', duration: 0, success: true }, { client: 'b', duration: 10, success: false },
  { client: 'b', duration: null, success: null }, { client: null, duration: 20, success: true }, { client: 'c', duration: 30, success: true }];
const plan = { kind: 'profile' as const, version: 1 as const, ops: 1, source: schema.source, selectionRef: 'all',
  fields: [{ field: 'duration', statistics: ['mean', 'p95'] as const }, { field: 'success', frequencies: true }], quantileMethod: 'linear' as const };
const options = { operationId: 'test', resultRef: 'saved:1' };
const result = () => profileData(createArrayProfileProvider(schema, rows), plan, options);

describe('bounded receipt context for models and UI explanations', () => {
  it('keeps scope, units, known/unknown denominators and deterministic factual wording', async () => {
    const receipt = await result(); const summary = summarizeProfileResult(receipt);
    expect(summary).toMatchObject({ resultRef: 'saved:1', operation: 'profile', source: schema.source, selection: { ref: 'all' },
      inputGrain: schema.grain, outputGrain: 'One summary of the selected source rows',
      fieldCoverage: { total: 2, returned: 2, omitted: 0 }, method: { quantileMethod: 'linear', arithmetic: 'IEEE-754' } });
    expect(summary.values![0]).toMatchObject({ field: 'duration', known: 4, unknown: 1, statistics: { mean: 15 } });
    expect(summary.values![1]!.frequencies).toEqual({ values: [{ value: false, count: 1 }, { value: true, count: 3 }], totalDistinct: 2, omitted: 0, order: 'value-ascending' });
    expect(summary.fieldDefinitions[0]).toMatchObject({ meaning: schema.columns[1]!.meaning, unit: 'ms' });
    expect(summary.explanation).toBe('5 of 5 source rows matched the selection. Input grain: one observed request.');
    expect(summary.notes.join(' ')).toContain('not the original observations');
    expect(summary).not.toHaveProperty('groups');
    expect(Object.isFrozen(summary.values![0]!.statistics)).toBe(true);
    expect(summary.values![0]!.statistics).not.toBe(receipt.fields[0]!.statistics);
    expect(receipt.fields[0]!.statistics).toEqual(summary.values![0]!.statistics);
  });

  it('pages groups without losing the selection, exclusions, methods or group identity', async () => {
    const receipt = await profileGroups(createArrayProfileProvider(schema, rows), { ...plan, kind: 'group-profile',
      groupBy: ['client'], unknownKeys: 'exclude', where: { op: 'gte', args: [{ col: 'duration' }, { lit: 0 }] } }, options);
    const a = summarizeProfileResult(receipt, { groupLimit: 1, fields: ['duration'] });
    const b = summarizeProfileResult(receipt, { groupOffset: a.groupPage!.nextOffset!, groupLimit: 2, fields: ['duration'] });
    expect(a.groupPage).toEqual({ total: 3, offset: 0, returned: 1, nextOffset: 1 });
    expect(b.groupPage).toEqual({ total: 3, offset: 1, returned: 2, nextOffset: null });
    expect([...a.groups!, ...b.groups!].map(group => group.ref)).toEqual(receipt.groups.map(group => group.ref));
    expect(a.selection.where).toEqual(receipt.plan.where);
    expect(a.grouping).toEqual({ by: ['client'], unknownKeys: 'exclude', order: 'first-seen', fieldDefinitions: [schema.columns[0]] });
    expect(a.population).toMatchObject({ scanned: 5, selected: 4, grouped: 3, withUnknownKeys: 1, excludedUnknownKeys: 1 });
    expect(a.fieldCoverage).toEqual({ total: 2, returned: 1, omitted: 1 });
    expect(a.outputGrain).toContain('client');
    expect(summarizeProfileResult(receipt, { groupOffset: 99 }).groupPage).toEqual({ total: 3, offset: 99, returned: 0, nextOffset: null });
  });

  it('preserves null estimates and exposes frequency omission rather than implying top categories', async () => {
    const actual = await profileData(createArrayProfileProvider(schema, [{ client: 'a', duration: null }, { client: 'b', duration: null }]),
      { kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'missing', fields: [{ field: 'duration', statistics: ['mean'] }, { field: 'client', frequencies: true }] }, options);
    const summary = summarizeProfileResult(actual, { frequencyLimit: 1 });
    expect(summary.method.quantileMethod).toBeNull();
    expect(summary.values![0]).toMatchObject({ known: 0, unknown: 2, statistics: { mean: null } });
    expect(summary.values![1]!.frequencies).toMatchObject({ totalDistinct: 2, omitted: 1, order: 'value-ascending' });
  });

  it('defaults to bounded fields and explicitly counts the unserved definitions', async () => {
    const wide: ProfileSchema = { ...schema, columns: Array.from({ length: 20 }, (_, i) => ({ name: 'x' + i, type: 'number', role: 'measure', meaning: 'Synthetic measure ' + i })) };
    const receipt = await profileData(createArrayProfileProvider(wide, []), { ...plan, fields: wide.columns.map(column => ({ field: column.name })) }, options);
    const summary = summarizeProfileResult(receipt);
    expect(summary.fieldDefinitions).toHaveLength(8); expect(summary.fieldCoverage).toEqual({ total: 20, returned: 8, omitted: 12 });
    expect(summary.values![0]).toEqual({ field: 'x0', known: 0, unknown: 0 });
  });

  it.each([{ groupLimit: 0 }, { groupLimit: 17 }, { frequencyLimit: 17 }, { maxCharacters: 64001 },
    { groupOffset: -1 }, { groupOffset: 0.5 }, { fields: [] }, { fields: ['typo'] }, { fields: ['duration', 'duration'] },
    { fields: [''] }, { fields: Array(17).fill('duration') }, { fields: 'duration' }])('refuses invalid projection options %j', async input => {
    expect(() => summarizeProfileResult(awaited, input as unknown as ProfileSummaryOptions)).toThrow();
  });
});
// Engine result fixture used only for malformed option checks; ordinary results above are actually executed.
const awaited = { kind: 'profile', schema, plan, fields: [] } as unknown as ProfileResult;

it('refuses overflowing context without trimming identifiers or silently dropping evidence', async () => {
  const receipt = await result();
  expect(() => summarizeProfileResult(receipt, { maxCharacters: 100 })).toThrowError(/exceeds maxCharacters/);
  expect(receipt.resultRef).toBe('saved:1');
});

it('rejects impossible selected structures without claiming to authenticate a receipt', async () => {
  const receipt = await result();
  expect(() => summarizeProfileResult({ ...receipt, kind: 'bad' } as unknown as ProfileResult)).toThrow(/Unsupported result/);
  expect(() => summarizeProfileResult(receipt, { groupOffset: 1 })).toThrow(/no group pages/);
  expect(() => summarizeProfileResult({ ...receipt, schema: { ...schema, columns: [schema.columns[0]!] } })).toThrow(/Missing result field definition/);
  expect(() => summarizeProfileResult({ ...receipt, fields: [] })).toThrow(/Missing result field values/);
});

it('refuses accessor fields without reading them and retains group-key meaning separately', async () => {
  let reads = 0;
  const fields = Object.defineProperty([], '0', { enumerable: true, get() { reads++; return reads === 1 ? 'duration' : 'success'; } });
  const receipt = await result();
  expect(() => summarizeProfileResult(receipt, { fields })).toThrow(/accessors/);
  expect(reads).toBe(0);
  const grouped = await profileGroups(createArrayProfileProvider(schema, rows), { ...plan, kind: 'group-profile', groupBy: ['client'], unknownKeys: 'include' }, options);
  const summary = summarizeProfileResult(grouped, { fields: ['duration'], groupLimit: 1 });
  expect(summary.fieldDefinitions.map(field => field.name)).toEqual(['duration']);
  expect(summary.grouping!.fieldDefinitions).toEqual([schema.columns[0]]);
  expect(summary.grouping!.fieldDefinitions[0]!.meaning).toBe('Source client identity');
  expect(summary.groups![0]!.keys.client).toBe('a');
});
