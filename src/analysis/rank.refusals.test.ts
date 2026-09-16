/**
 * The rank ANALYSIS's own door (`rank.ts` · `normalizeRankAnalysisOptions`,
 * `rankAnalysis().judgeTable`): the optional name and id ride the declaration,
 * a `where` rides the plan, a key that is not an identity is refused by name, and
 * a table lacking a declared column is judged unfit before any row is read.
 */
import { describe, expect, it } from 'vitest';
import { normalizeRankAnalysisOptions, rankAnalysis, type RankAnalysisOptions } from './rank.js';
import type { ProfileSchema, RankPlan } from '../data/index.js';

const schema: ProfileSchema = { source: { id: 'synthetic:nodes', version: 'v1' }, table: 'nodes', grain: 'one node summary', columns: [
  { name: 'node', type: 'string', role: 'identifier', meaning: 'node' },
  { name: 'latency', type: 'number', role: 'measure', unit: 'us', meaning: 'p95 latency' },
] };
const plan: RankPlan = { kind: 'rank', version: 1, ops: 1, source: schema.source, selectionRef: 'selection:all', keys: ['node'], metric: 'latency', direction: 'desc', limit: 2, missing: 'exclude', ties: 'keys-ascending' };
const base: RankAnalysisOptions = { schema, plan, operationId: 'operation:rank', resultRef: 'result:rank' };

describe('normalizeRankAnalysisOptions', () => {
  it('keeps a declared name, id and where', () => {
    const where = { op: 'lt' as const, args: [{ col: 'latency' }, { lit: 50 }] };
    const out = normalizeRankAnalysisOptions({ ...base, name: 'ranked', id: 'rank:1', plan: { ...plan, where } });
    expect([out.name, out.id, out.plan.where]).toEqual(['ranked', 'rank:1', where]);
  });
  it('refuses a key whose role is not an identity or a dimension', () => {
    const measureKey: ProfileSchema = { ...schema, columns: [{ name: 'node', type: 'string', role: 'measure', meaning: 'node' }, schema.columns[1]!] };
    expect(() => normalizeRankAnalysisOptions({ ...base, schema: measureKey })).toThrow(/Rank key/);
  });
});

describe('rankAnalysis().judgeTable', () => {
  it('names a declared column the table has not got', () => {
    const problems = rankAnalysis(base).def.judgeTable!('nodes', [{ name: 'node', type: 'string' }]);
    expect(problems).toEqual(['Rank input table has no column latency']);
  });
});
