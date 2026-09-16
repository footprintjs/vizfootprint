/**
 * The rank builtin at the DASHBOARD's doors: a declaration the analysis refuses
 * is refused at build in the analysis's own words (`builtinAnalyses.ts` · `SPECS.rank`),
 * and an analysis that requires the complete input refuses a provider that answers a
 * count without its rows (`session.ts` · `allRows`).
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, type DashboardDef, type RankDecl } from './index.js';
import { isRejection, memoryProvider, type DataProvider } from '../data/index.js';

const rows = [{ node: 'b', latency: 20 }, { node: 'a', latency: 30 }, { node: 'z', latency: 0 }];
const schema = { source: { id: 'seed:nodes', version: 'basis1' }, table: 'nodes', grain: 'one node summary', columns: [
  { name: 'node', type: 'string' as const, role: 'identifier' as const, meaning: 'node identity' },
  { name: 'latency', type: 'number' as const, role: 'measure' as const, meaning: 'sample p95 latency', unit: 'us' },
] };
const rank: RankDecl = { builtin: 'rank', schema, plan: { kind: 'rank', version: 1, ops: 1, source: schema.source, selectionRef: 'selection:current', keys: ['node'], metric: 'latency', direction: 'desc', limit: 2, missing: 'exclude', ties: 'keys-ascending' }, operationId: 'operation:rank', resultRef: 'result:rank' };
const def: DashboardDef = { data: { nodes: { rows, key: 'node', columns: { node: { type: 'string' }, latency: { type: 'number', role: 'measure', unit: 'us' } } } }, defaultTable: 'nodes', actors: { filter: { actor: 'user' } }, analyses: { ranking: rank } };

describe('the rank builtin at the doors', () => {
  it('a declaration the analysis refuses is refused at build, in its words', () => {
    expect(() => buildDashboard({ ...def, analyses: { ranking: { ...rank, operationId: '' } } })).toThrow(/operationId/);
  });
  it('a provider that answers a count without its rows cannot feed an analysis that requires the complete input', async () => {
    const real = memoryProvider({ nodes: rows });
    const countOnly: DataProvider = { ...real, evaluate: async (table, clause, options) => {
      const res = await real.evaluate(table, clause, options);
      return isRejection(res) ? res : { ...res, rows: undefined as never };
    } };
    const session = buildDashboard(def, { providers: { nodes: countOnly } }).createSession();
    const result = await session.declareAnalysis('ranking', { table: 'nodes' });
    expect(JSON.stringify(result)).toContain('provider returned 0 of 3 rows');
  });
});
