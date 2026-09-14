import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { buildDashboard, vizAsTools, whatLanded, type DashboardDef, type VizToolsOptions, type VizAnalysisResult, type VizCompactAnalysisResult } from './index.js';
import { analysisResultProjector } from './compactAnalysis.js';
import type { AnalysisOutput } from '../analysis/index.js';
import { rankAnalysis } from '../analysis/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../session/dashboard.fixture.js';
import type { DispatchResult } from '../session/index.js';
import type { RankDecl } from '../def/index.js';

const schema = { source: { id: 'synthetic:nodes', version: 'basis:1' }, table: 'nodes', grain: 'one retained node summary', columns: [
  { name: 'node', type: 'string' as const, role: 'identifier' as const, meaning: 'Complete node identifier' },
  { name: 'latency', type: 'number' as const, role: 'measure' as const, meaning: 'p95 of recorded sample averages', unit: 'us' },
] };
const rank: RankDecl = { builtin: 'rank', schema, plan: { kind: 'rank', version: 1, ops: 1, source: schema.source,
  selectionRef: 'selection:nodes', keys: ['node'], metric: 'latency', direction: 'desc', limit: 8, missing: 'exclude', ties: 'keys-ascending' },
  operationId: 'op:rank', resultRef: 'result:rank' };
const def: DashboardDef = { data: { nodes: { key: 'node', rows: Array.from({ length: 10 }, (_, i) => ({ node: `node-${i}`, latency: i })),
  columns: { node: { type: 'string' }, latency: { type: 'number', role: 'measure', unit: 'us' } } } },
  defaultTable: 'nodes', actors: { filter: { actor: 'user' } }, analyses: { rank } };
const compact = (extra = {}): VizToolsOptions => ({ analysisResults: { mode: 'compact', ...extra } } as VizToolsOptions);
const sessionFor = (definition: DashboardDef = def) => {
  const session = buildDashboard(definition).createSession({ as: 'agent' });
  const dispatch = session.dispatch.bind(session);
  const observed: DispatchResult[] = [];
  vi.spyOn(session, 'dispatch').mockImplementation(async (...args) => { const result = await dispatch(...args); observed.push(result); return result; });
  return { session, observed };
};
function analysisOf(result: Record<string, unknown>): any { return result.analysis; }

describe('opt-in compact analysis tool results', () => {
  it('keeps default results exact and all nine descriptors byte-identical across modes and calls', async () => {
    expectTypeOf<Extract<VizAnalysisResult['result'], { ok: true }>['output']>().toEqualTypeOf<AnalysisOutput>();
    expectTypeOf<Extract<VizCompactAnalysisResult['result'], { ok: true }>['projection']['mode']>().toEqualTypeOf<'compact'>();
    const { session, observed } = sessionFor();
    const full = vizAsTools(session), small = vizAsTools(session, compact());
    const descriptions = JSON.stringify(full.tools());
    expect(JSON.stringify(small.tools())).toBe(descriptions);
    const result = await full.call('viz.declare_analysis', { analysisId: 'rank' });
    expect(analysisOf(result)).toEqual(observed[0]!.ok && observed[0]!.analysis);
    expect(analysisOf(result).result.output.ranking.rows).toHaveLength(8);
    await small.call('viz.declare_analysis', { analysisId: 'rank' });
    expect(JSON.stringify(small.tools())).toBe(descriptions);
  });

  it.each(['viz.dispatch', 'viz.declare_analysis'])('projects the saved native rank through %s without changing its commit or source population', async tool => {
    const { session, observed } = sessionFor();
    await session.dispatch({ verb: 'filter', viewId: 'filter', field: 'latency', range: [0, 7], cause: { requestedBy: 'user', computedBy: 'user' } });
    const result = await vizAsTools(session, compact({ rowLimit: 2 })).call(tool, { verb: 'analyze', analysisId: 'rank', table: 'nodes' });
    const native = observed.at(-1)!;
    if (!native.ok || !native.analysis) throw new Error('Fixture did not rank');
    const analysis = analysisOf(result);
    expect(analysis.result).toMatchObject({ ok: true, projection: { mode: 'compact', status: 'summarized', output: { as: 'table', name: 'ranked_nodes' },
      summary: { operation: 'rank', resultRef: 'result:rank', operationId: 'op:rank', source: schema.source, table: 'nodes',
        population: { scanned: 8, selected: 8, known: 8 }, ranking: { shown: 8, total: 8, complete: true }, rowPage: { returned: 2, omitted: 6 },
        conventions: { population: 'analysis-input' }, rows: [{ value: 7, sourceRef: { keys: { node: 'node-7' } } }, { value: 6 }] },
      retrieval: { kind: 'host-required', sessionId: session.id, analysisId: 'rank', commitId: native.analysis.commit!.id } } });
    expect('output' in analysis.result).toBe(false);
    expect(analysis.commit).toEqual(native.analysis.commit);
    expect(whatLanded(result)).toEqual({ commit: native.analysis.commit!.id });
    expect(session.log.records).toHaveLength(2);
    expect(native.analysis.result.ok && native.analysis.result.output).toHaveProperty('rows.length', 8);
    expect(analysis.result.projection.summary.fieldDefinitions[1]).toMatchObject({ unit: 'us', meaning: schema.columns[1]!.meaning });
  });

  it('discloses summary overflow after the analysis committed, without a raw-output fallback or rerun', async () => {
    const { session } = sessionFor();
    const result = await vizAsTools(session, compact({ maxCharacters: 1 })).call('viz.declare_analysis', { analysisId: 'rank' });
    expect(analysisOf(result).result).toMatchObject({ ok: true, projection: { status: 'omitted', reason: 'summary-limit', executed: true, committed: true } });
    expect(analysisOf(result).result.output).toBeUndefined();
    expect(analysisOf(result).result.projection.summary).toBeUndefined();
    expect(whatLanded(result)).toEqual({ commit: session.cursor() });
    expect(session.log.records).toHaveLength(1);
  });

  it('does not promote an arbitrary module merely because its output contains a ranking property', async () => {
    const { builtin, ...options } = rank; void builtin;
    const { session } = sessionFor({ ...def, analyses: { rank: rankAnalysis(options) } });
    const result = await vizAsTools(session, compact()).call('viz.declare_analysis', { analysisId: 'rank' });
    expect(analysisOf(result).result).toMatchObject({ ok: true, projection: { status: 'omitted', reason: 'unsupported-analysis', executed: true, committed: true } });
    expect(session.log.records).toHaveLength(1);
  });

  it.each(['analysis', 'table', 'channel', 'missing-receipt', 'operation', 'reference', 'plan', 'schema', 'population', 'malformed'])(
    'does not summarize a native receipt whose %s no longer matches its committed scope', async changed => {
      const { session } = sessionFor();
      const original = await session.declareAnalysis('rank');
      const altered = JSON.parse(JSON.stringify(original));
      switch (changed) {
        case 'analysis': altered.commit.value.id = 'other-analysis'; break;
        case 'table': altered.commit.value.table = 'other-table'; break;
        case 'channel': altered.result.output.as = 'scalar'; break;
        case 'missing-receipt': delete altered.result.output.ranking; break;
        case 'operation': altered.result.output.ranking.operationId = 'other-operation'; break;
        case 'reference': altered.result.output.ranking.resultRef = 'other-reference'; break;
        case 'plan': altered.result.output.ranking.plan.direction = 'asc'; break;
        case 'schema': altered.result.output.ranking.schema.source.version = 'other-basis'; break;
        case 'population': altered.result.output.ranking.conventions.population = 'provider-snapshot'; break;
        case 'malformed': altered.result.output.ranking.rows[0].value = null; break;
      }
      const projected = analysisResultProjector(session.id, { mode: 'compact' })(altered);
      expect(projected).toMatchObject({ ok: true, projection: { status: 'omitted', reason: 'invalid-receipt', executed: true, committed: true } });
      expect(original.result.ok && original.result.output).toHaveProperty('ranking.rows.0.value', 9);
      expect(session.log.records).toHaveLength(1);
    },
  );

  it('names uncommitted successful output honestly and retains geometry metadata without serving arbitrary values', async () => {
    const { session } = sessionFor(makeDashboardDef());
    const native = await session.declareAnalysis('regression');
    expect(native.result.ok).toBe(true);
    const { commit, ...withoutCommit } = native; void commit;
    const result = analysisResultProjector(session.id, { mode: 'compact' })(withoutCommit);
    expect(result).toMatchObject({ ok: true, projection: { committed: false, output: { as: 'geometry', layer: 'reg_price_rating' }, status: 'omitted' } });
    if (result.ok && 'projection' in result) expect(result.projection.retrieval.commitId).toBeUndefined();
  });

  it('keeps successful non-analysis decision receipts intact in compact mode', async () => {
    const { session, observed } = sessionFor(makeDashboardDef());
    const port = vizAsTools(session, compact());
    const actual = await port.call('viz.dispatch', { verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating' });
    expect(actual).toEqual(observed[0]);
    expect(actual.reencoded).toEqual({ viewId: 'scatter', channel: 'x', field: 'rating' });
  });

  it('preserves a test’s hypothesis/FDR and a transform’s materialization gap when output summaries are unsupported', async () => {
    const base = makeDashboardDef();
    const { session, observed } = sessionFor({ ...base, analyses: { ...base.analyses, overPrice: { builtin: 'formula', expression: 'price * 2', name: 'price' } } });
    const port = vizAsTools(session, compact());
    for (const analysisId of ['correlation', 'overPrice']) {
      const result = await port.call('viz.declare_analysis', { analysisId });
      const native = observed.at(-1)!;
      if (!native.ok || !native.analysis) throw new Error('Fixture did not run');
      const { result: _output, ...receipt } = analysisOf(result); void _output;
      const { result: _nativeOutput, ...expected } = native.analysis; void _nativeOutput;
      expect(receipt).toEqual(expected);
      expect(analysisOf(result).result.projection).toMatchObject({ status: 'omitted', reason: 'unsupported-analysis' });
    }
    expect(session.ledger()).toHaveLength(1);
    expect(analysisOf(await port.call('viz.declare_analysis', { analysisId: 'clustering' })).materialized).toEqual(['cluster_id']);
  });

  it('keeps a genuine failed native analysis unchanged', async () => {
    const { session, observed } = sessionFor(makeDashboardDef({ rows: SAMPLE_ROWS.slice(0, 3) }));
    const result = await vizAsTools(session, compact()).call('viz.declare_analysis', { analysisId: 'regression' });
    expect(analysisOf(result)).toEqual(observed[0]!.ok && observed[0]!.analysis);
    expect(analysisOf(result).result).toEqual({ ok: false, reason: 'degenerate-fit', n: 3, fitDegenerate: true });
    expect(whatLanded(result)).toBeUndefined();
    expect(session.log.records).toHaveLength(0);
  });

  it.each([{ rowLimit: 0 }, { rowLimit: 17 }, { maxCharacters: 0 }, { maxCharacters: 64_001 }])('refuses invalid host projection configuration before execution: %j', options => {
    const { session } = sessionFor();
    expect(() => vizAsTools(session, compact(options))).toThrow(/analysisResults/);
    expect(session.log.records).toHaveLength(0);
  });
  it('refuses unknown host modes before execution and snapshots valid controls', async () => {
    const { session } = sessionFor();
    expect(() => vizAsTools(session, compact({ mode: 'unknown' }))).toThrow(/analysisResults.mode/);
    const options = { mode: 'compact' as const, rowLimit: 1 };
    const port = vizAsTools(session, { analysisResults: options });
    options.rowLimit = 16;
    const result = await port.call('viz.declare_analysis', { analysisId: 'rank' });
    expect(analysisOf(result).result.projection.summary.rows).toHaveLength(1);
  });
});
