import { describe, expect, it } from 'vitest';
import { buildDashboard, type DashboardDef, type RankDecl } from '../def/index.js';
import { memoryProvider, type DataProvider } from '../data/index.js';
import { rankAnalysis } from '../analysis/index.js';
import { vizAsTools } from '../agent/index.js';

const rows = [{ node: 'b', latency: 20 }, { node: 'a', latency: 30 }, { node: 'z', latency: 0 }];
const schema = { source: { id: 'seed:nodes', version: 'basis1' }, table: 'nodes', grain: 'one node summary', columns: [
 { name: 'node', type: 'string' as const, role: 'identifier' as const, meaning: 'node identity' },
 { name: 'latency', type: 'number' as const, role: 'measure' as const, meaning: 'sample p95 latency', unit: 'us' }
] };
const rank: RankDecl = { builtin: 'rank', schema, plan: { kind: 'rank', version: 1, ops: 1, source: schema.source, selectionRef: 'selection:current', keys: ['node'], metric: 'latency', direction: 'desc', limit: 2, missing: 'exclude', ties: 'keys-ascending' }, operationId: 'op:rank', resultRef: 'result:rank' };
const def: DashboardDef = { data: { nodes: { rows, key: 'node', columns: { node: { type: 'string' }, latency: { type: 'number', role: 'measure', unit: 'us' } } } }, defaultTable: 'nodes', actors: { filter: { actor: 'user' } }, analyses: { ranking: rank } };

describe('native rank analysis', () => {
 it('lands one real analyze commit, preserves complete plan and returns refs without fabricating a table registration', async () => {
   const session = buildDashboard(def).createSession();
   const result = await session.dispatch({ verb: 'analyze', analysisId: 'ranking', table: 'nodes', cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'highest latency' } });
   expect(result.ok).toBe(true);
   if (!result.ok) return;
   expect(result.analysis?.result.ok && result.analysis.result.output).toMatchObject({ as: 'table', ranking: { total: 3, rows: [{ value: 30 }, { value: 20 }] } });
   expect(session.log.records).toHaveLength(1);
   expect(result.analysis?.commit?.cause).toMatchObject({ requestedBy: 'agent', computedBy: 'system', intent: 'highest latency' });
   expect(JSON.stringify(result.analysis?.commit?.value)).toContain('result:rank');
   expect(session.tablesAt()).toEqual(['nodes']);
   const port = vizAsTools(session, { as: 'agent' });
   expect(await port.call('viz.declare_analysis', { analysisId: 'ranking' })).toMatchObject({ ok: true, analysis: { result: { ok: true, output: { ranking: { total: 3 } } } } });
 });
 it('runs on the actual native selected input and the direct public factory works', async () => {
   const session = buildDashboard(def).createSession();
   await session.dispatch({ verb: 'filter', viewId: 'filter', field: 'latency', range: [0, 20], cause: { requestedBy: 'user', computedBy: 'user' } });
   const result = await session.declareAnalysis('ranking', { table: 'nodes' });
   expect(result.result.ok && result.result.output).toMatchObject({ ranking: { total: 2, population: { scanned: 2 }, rows: [{ value: 20 }, { value: 0 }] } });
   const { builtin, ...options } = rank; void builtin;
   const direct = await rankAnalysis(options).run(rows);
   expect(direct.result.ok && direct.result.output.ranking.total).toBe(3);
 });
 it('returns honest empty/all-missing results using declared schema while rejecting populated wrong types', async () => {
   for (const input of [[], [{ node: 'null', latency: null }]]) {
     const session = buildDashboard({ ...def, data: { nodes: { ...def.data.nodes!, rows: input } } }).createSession();
     const result = await session.declareAnalysis('ranking', { table: 'nodes' });
     expect(result.result.ok && result.result.output).toMatchObject({ ranking: { rows: [], total: 0, population: { scanned: input.length, known: 0, missing: input.length } } });
     expect(session.log.records).toHaveLength(1);
   }
   const wrong = buildDashboard({ ...def, data: { nodes: { rows: [{ node: 'n', latency: 'fast' }] } } }).createSession();
   const result = await wrong.declareAnalysis('ranking', { table: 'nodes' });
   expect(result.result.ok).toBe(false); expect(wrong.log.records).toHaveLength(0);
 });
 it('refuses substituted input and incompatible schema before committing', async () => {
   const session = buildDashboard(def).createSession();
   const input = await session.declareAnalysis('ranking', { table: 'nodes', input: rows.slice(0, 1) });
   expect(input.result.ok).toBe(false); expect(session.log.records).toHaveLength(0);
   const other = await session.declareAnalysis('wrong', { table: 'nodes', def: { ...rank, schema: { ...schema, table: 'other' } } });
   expect(other.result.ok).toBe(false); expect(session.log.records).toHaveLength(0);
 });
 it('refuses a capped native provider before ranking or committing', async () => {
   const underlying = memoryProvider({ nodes: rows });
   const capped: DataProvider = { ...underlying, async evaluate(table, clauses, options) { const result = await underlying.evaluate(table, clauses, options); return 'rows' in result && result.rows ? { ...result, rows: result.rows.slice(0, 1) } : result; } };
   const session = buildDashboard(def, { providers: { nodes: capped } }).createSession();
   const result = await session.declareAnalysis('ranking', { table: 'nodes' });
   expect(result.result.ok).toBe(false); expect(session.log.records).toHaveLength(0);
   expect(JSON.stringify(result)).toMatch(/complete|incomplete|capped/i);
 });
});
