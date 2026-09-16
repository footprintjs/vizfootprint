/**
 * The rank door's refusals that the first tests never reached — each pinned so
 * a wrong plan, a tampered receipt or a refusing sort is REFUSED in words, never
 * ranked silently (`rank/run.ts` · `normalizeRankPlan`, `rankData`;
 * `rank/summary.ts` · `summarizeRankResult`; `summary.ts` · `summarizeDataResult`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArrayProfileProvider, rankData, summarizeDataResult, summarizeRankResult, type ProfileSchema, type RankPlan, type RankResult } from './index.js';

// What the SORT answers, when a test overrides it — `undefined` = the real memory provider.
// Only the ranking table is intercepted: the scan that precedes the sort is untouched.
let sortAnswer: Record<string, unknown> | undefined;
vi.mock('./memoryProvider.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./memoryProvider.js')>();
  const memoryProvider: typeof mod.memoryProvider = (...args) => {
    const provider = mod.memoryProvider(...args);
    if (sortAnswer === undefined || !('ranking' in (args[0] as object))) return provider;
    return { ...provider, evaluate: async () => sortAnswer as never };
  };
  return { ...mod, memoryProvider };
});
afterEach(() => { sortAnswer = undefined; });

const schema: ProfileSchema = { source: { id: 'synthetic:nodes', version: 'v1' }, table: 'nodes', grain: 'one node summary', columns: [
  { name: 'cluster', type: 'string', role: 'identifier', meaning: 'cluster' },
  { name: 'node', type: 'string', role: 'identifier', meaning: 'node' },
  { name: 'latency', type: 'number', role: 'measure', unit: 'us', meaning: 'p95 latency' },
] };
const plan: RankPlan = { kind: 'rank', version: 1, ops: 1, source: schema.source, selectionRef: 'selection:all', keys: ['cluster', 'node'], metric: 'latency', direction: 'desc', limit: 2, missing: 'exclude', ties: 'keys-ascending' };
const opts = { operationId: 'operation:rank', resultRef: 'result:rank' };
const rows = [{ cluster: 'c', node: 'a', latency: 10 }, { cluster: 'c', node: 'b', latency: 100 }];
const run = (overrides: Partial<RankPlan> = {}) => rankData(createArrayProfileProvider(schema, rows), { ...plan, ...overrides } as RankPlan, opts);
const clone = (result: RankResult): RankResult => JSON.parse(JSON.stringify(result)) as RankResult;

describe('a rank plan is refused by name', () => {
  it('needs kind rank and version 1', async () => {
    await expect(run({ kind: 'profile' as never })).rejects.toThrow(/kind rank and version 1/);
    await expect(run({ version: 2 as never })).rejects.toThrow(/kind rank and version 1/);
  });
  it('a metric cannot also be an identity key', async () => {
    await expect(run({ keys: ['cluster', 'latency'] })).rejects.toThrow(/cannot also be an identity key/);
  });
});

describe('the sort is one existing provider, and its refusal is the rank\'s', () => {
  it('a refused sort with a detail throws that detail', async () => {
    sortAnswer = { ok: false, engine: 'memory', operation: 'evaluate', reason: 'unsupported-sort', detail: 'the sort said no' };
    await expect(run()).rejects.toThrow(/the sort said no/);
  });
  it('a refused sort without a detail throws the rank\'s own sentence', async () => {
    sortAnswer = { ok: false, engine: 'memory', operation: 'evaluate', reason: 'unsupported-sort' };
    await expect(run()).rejects.toThrow(/Rank sort was refused/);
  });
  it('a sort that answers no rows ranks nothing rather than inventing rows', async () => {
    sortAnswer = { ok: true, count: 0 };
    const outcome = await run().catch((error: unknown) => error);
    // either an honest empty ranking, or the receipt's own consistency refusal — never fabricated rows
    if (outcome instanceof Error) expect(outcome.message).toMatch(/rank|rows|shown/i);
    else expect((outcome as RankResult).rows).toEqual([]);
  });
});

describe('a tampered rank receipt is refused by its projection', () => {
  it('a key whose declared role is not an identity', async () => {
    const result = clone(await run());
    (result.schema.columns.find((c) => c.name === 'node') as { role: string }).role = 'measure';
    expect(() => summarizeRankResult(result)).toThrow(/Invalid rank key definition: node/);
  });
  it('an execution that is not the one bounded strategy', async () => {
    const result = clone(await run());
    (result.execution as { strategy: string }).strategy = 'top-k';
    expect(() => summarizeRankResult(result)).toThrow(/Unsupported rank execution/);
  });
  it('a negative elapsed time', async () => {
    const result = clone(await run());
    (result.execution as { elapsedMs: number }).elapsedMs = -1;
    expect(() => summarizeRankResult(result)).toThrow(/Invalid elapsedMs/);
  });
  it('a result whose kind is inherited, not its own', () => {
    expect(() => summarizeDataResult(Object.create({ kind: 'rank' }) as RankResult)).toThrow(/own kind value/);
  });
});
