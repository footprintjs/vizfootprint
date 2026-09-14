import { describe, expect, it } from 'vitest';
import {
  createArrayProfileProvider, listDataOperations, listProfileOperations, profileData, profileGroups, rankData,
  summarizeDataResult, summarizeProfileResult, summarizeRankResult,
  type ProfileSchema, type RankPlan, type RankResult,
} from './index.js';

const schema: ProfileSchema = { source: { id: 'synthetic:nodes', version: 'basis-1' }, table: 'nodes', grain: 'one retained node summary', columns: [
  { name: 'cluster', type: 'string', role: 'identifier', meaning: 'Complete cluster identifier' },
  { name: 'node', type: 'string', role: 'identifier', meaning: 'Complete node identifier within cluster' },
  { name: 'latency', type: 'number', role: 'measure', unit: 'us', meaning: 'p95 of recorded sample-average latency; not operation p95' },
  { name: 'active', type: 'boolean', role: 'dimension', meaning: 'Whether the node is active in this snapshot' },
  { name: 'raw', type: 'string', role: 'dimension', meaning: 'Unrequested private source payload' },
] };
const plan: RankPlan = { kind: 'rank', version: 1, ops: 1, source: schema.source, selectionRef: 'selection:active',
  where: { op: 'eq', args: [{ col: 'active' }, { lit: true }] }, keys: ['cluster', 'node'], metric: 'latency',
  direction: 'desc', limit: 3, missing: 'exclude', ties: 'keys-ascending' };
const rows = [
  { cluster: 'c:😀', node: 'a:b', latency: 100, active: true, raw: 'SECRET ROW BODY' },
  { cluster: 'c:😀', node: 'b', latency: 100, active: true },
  { cluster: 'c', node: 'c', latency: 10, active: true },
  { cluster: 'c', node: 'zero', latency: 0, active: true },
  { cluster: 'c', node: 'missing', latency: null, active: true },
  { cluster: 'c', node: 'excluded', latency: 999, active: false },
];
const run = (overrides: Partial<RankPlan> = {}) => rankData(createArrayProfileProvider(schema, rows), { ...plan, ...overrides }, {
  operationId: 'operation:rank-1', resultRef: 'result:rank-1',
});
const clone = (result: RankResult): RankResult => JSON.parse(JSON.stringify(result)) as RankResult;

describe('bounded rank result context', () => {
  it('pages the saved rank while preserving scope, complete keys, units and independent population/top-N counts', async () => {
    const result = await run();
    const first = summarizeRankResult(result, { rowLimit: 1 });
    expect(first).toMatchObject({ operation: 'rank', version: 1, operationId: result.operationId, resultRef: result.resultRef,
      source: schema.source, table: 'nodes', selection: { ref: plan.selectionRef, where: plan.where }, inputGrain: schema.grain,
      population: { scanned: 6, selected: 5, excluded: 1, predicateUnknown: 0, known: 4, missing: 1 },
      ranking: { keys: plan.keys, metric: 'latency', direction: 'desc', limit: 3, shown: 3, total: 4, complete: false, omitted: 1 },
      rowPage: { offset: 0, returned: 1, total: 3, omitted: 2, nextOffset: 1 },
      method: { exact: true, aggregation: 'none' }, conventions: result.conventions,
    });
    expect(first.rows).toEqual(result.rows.slice(0, 1));
    expect(first.fieldDefinitions).toEqual(schema.columns.slice(0, 4));
    expect(JSON.stringify(first)).not.toContain('SECRET ROW BODY');
    expect(JSON.stringify(first)).not.toContain('Unrequested private source payload');
    expect(first.notes.join(' ')).toMatch(/existing.*not.*recompute/i);
    const last = summarizeRankResult(result, { rowOffset: 1, rowLimit: 2 });
    expect(last.rows).toEqual(result.rows.slice(1));
    expect(last.rowPage).toEqual({ offset: 1, returned: 2, total: 3, omitted: 1, nextOffset: null });
    expect(last.population).toEqual(first.population);
    expect(last.ranking).toEqual(first.ranking);
  });

  it('separates a complete ranking from its partial presentation and preserves native analysis-input scope', async () => {
    const original = await run({ limit: 10 });
    const native = { ...original, conventions: { ...original.conventions, population: 'analysis-input' as const } };
    const summary = summarizeRankResult(native, { rowLimit: 2 });
    expect(summary.ranking).toMatchObject({ shown: 4, total: 4, complete: true, omitted: 0 });
    expect(summary.rowPage).toMatchObject({ returned: 2, omitted: 2, nextOffset: 2 });
    expect(summary.conventions.population).toBe('analysis-input');
    expect(summarizeRankResult(original, { rowOffset: 3 }).rows[0]!.value).toBe(0);
  });

  it('returns an honest empty page/all-missing population without inventing a value', async () => {
    const result = await run({ where: { op: 'eq', args: [{ col: 'node' }, { lit: 'missing' }] } });
    const summary = summarizeRankResult(result);
    expect(summary.rows).toEqual([]);
    expect(summary.population).toMatchObject({ selected: 1, known: 0, missing: 1 });
    expect(summary.ranking).toMatchObject({ total: 0, shown: 0, omitted: 0, complete: true });
    expect(summary.rowPage).toEqual({ total: 0, offset: 0, returned: 0, omitted: 0, nextOffset: null });
    expect(summarizeRankResult(await run(), { rowOffset: 99 }).rowPage).toEqual({ total: 3, offset: 99, returned: 0, omitted: 3, nextOffset: null });
  });

  it('is detached and deeply frozen without freezing or modifying the caller receipt', async () => {
    const input = clone(await run());
    const before = JSON.stringify(input);
    const summary = summarizeRankResult(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.rows[0]!.sourceRef.keys)).toBe(true);
    expect(Object.isFrozen(summary.fieldDefinitions[0])).toBe(true);
    (input.rows[0]!.sourceRef.keys as Record<string, unknown>).node = 'changed';
    expect(summary.rows[0]!.sourceRef.keys.node).toBe('a:b');
    expect(summary.selection.where).not.toBe(input.plan.where);
  });

  it('enforces the exact JSON character budget, including escaped and non-BMP characters, with no silent clipping', async () => {
    const result = await run();
    const expected = summarizeRankResult(result);
    const length = JSON.stringify(expected).length;
    expect(summarizeRankResult(result, { maxCharacters: length })).toEqual(expected);
    expect(() => summarizeRankResult(result, { maxCharacters: length - 1 })).toThrow(/maxCharacters/i);
    expect(() => summarizeRankResult(result, { maxCharacters: 1 })).toThrow(/maxCharacters/i);
    expect(new TextEncoder().encode(JSON.stringify(expected)).byteLength).toBeGreaterThan(length);
  });

  it('rejects malformed controls, receipts and incomplete/foreign keys even on omitted rows', async () => {
    const result = await run();
    for (const options of [{ rowLimit: 0 }, { rowLimit: 17 }, { rowOffset: -1 }, { rowOffset: 0.5 }, { rowOffset: NaN }, { maxCharacters: 64001 }, { maxCharacters: Infinity }, { unknown: true }]) {
      expect(() => summarizeRankResult(result, options)).toThrow();
    }
    for (const key of ['rowOffset', 'rowLimit', 'maxCharacters']) {
      expect(() => summarizeRankResult(result, { [key]: null })).toThrow();
    }
    const corruptions: ((r: any) => void)[] = [
      r => { r.kind = 'profile'; }, r => { r.version = 2; }, r => { r.population.known++; },
      r => { r.population.scanned++; }, r => { r.shown--; }, r => { r.complete = true; },
      r => { r.rows[2].sourceRef.source.version = 'foreign'; }, r => { r.rows[2].sourceRef.table = 'foreign'; },
      r => { delete r.rows[2].sourceRef.keys.cluster; }, r => { r.rows[2].sourceRef.keys.extra = 'x'; },
      r => { r.rows[2].sourceRef.keys.node = null; }, r => { r.rows[2].value = Infinity; },
      r => { r.rows[2].position = 1; }, r => { r.conventions.position = 'dense'; },
      r => { r.rows[2].sourceRef.keys = r.rows[0].sourceRef.keys; }, r => { r.rows[2].raw = 'source body'; },
    ];
    for (const corrupt of corruptions) {
      const input = clone(result); corrupt(input);
      expect(() => summarizeRankResult(input, { rowLimit: 1 })).toThrow();
    }
    let reads = 0;
    const accessor = { ...result, get rows() { reads++; return result.rows; } };
    expect(() => summarizeRankResult(accessor)).toThrow(); expect(reads).toBe(0);
    expect(() => summarizeRankResult({ ...result, self: result } as RankResult)).toThrow();
  });

  it('provides additive shared discovery and summary dispatch without changing the profile APIs', async () => {
    expect(listProfileOperations().map(operation => operation.id)).toEqual(['profile', 'group-profile']);
    const operations = listDataOperations();
    expect(operations.map(operation => operation.id)).toEqual(['profile', 'group-profile', 'rank']);
    expect(operations[2]!.description).toMatch(/existing numeric/i);
    expect(Object.isFrozen(operations)).toBe(true);
    const rank = await run();
    expect(summarizeDataResult(rank, { rowLimit: 1 })).toEqual(summarizeRankResult(rank, { rowLimit: 1 }));
    const common = { version: 1 as const, ops: 1, source: schema.source, selectionRef: 'all', fields: [{ field: 'latency', statistics: ['max' as const] }] };
    const options = { operationId: 'operation:profile', resultRef: 'result:profile' };
    const profile = await profileData(createArrayProfileProvider(schema, rows), { kind: 'profile', ...common }, options);
    const grouped = await profileGroups(createArrayProfileProvider(schema, rows), { kind: 'group-profile', ...common, groupBy: ['cluster'], unknownKeys: 'include' }, options);
    expect(summarizeDataResult(profile)).toEqual(summarizeProfileResult(profile));
    expect(summarizeDataResult(grouped, { groupLimit: 1 })).toEqual(summarizeProfileResult(grouped, { groupLimit: 1 }));
    expect(() => summarizeDataResult(profile, { rowLimit: 1 })).toThrow(/option/i);
    expect(() => summarizeDataResult(grouped, { rowOffset: 1 })).toThrow(/option/i);
    expect(() => summarizeDataResult(rank, { fields: ['latency'] })).toThrow(/option/i);
    expect(() => summarizeDataResult(rank, { groupLimit: 1 })).toThrow(/option/i);
    expect(() => summarizeDataResult({ ...rank, kind: 'other' } as unknown as RankResult)).toThrow();
  });
});
