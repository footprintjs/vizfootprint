import { describe, expect, it, vi } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { vizAsTools } from '../agent/vizAsTools.js';
import { parseAgentCall } from '../log/agentCall.js';
import { CauseSelectionSession } from '../log/index.js';
import { memoryProvider } from '../data/index.js';
import { SAMPLE_ROWS } from './dashboard.fixture.js';

const cause = { requestedBy: 'agent', computedBy: 'agent' } as const;
const pick = { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause } as const;
const proposal = { id: 'proposal', spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } } };
const invalid = [null, [], {}, { runId: 'r' }, { toolCallId: '' }, { toolCallId: ' ' }, { toolCallId: 9 }, { toolCallId: null }, { toolCallId: 't', runId: '' }, { toolCallId: 't', runId: ' ' }, { toolCallId: 't', runId: 9 }, { toolCallId: 't', runId: null }];

function fresh() { return buildDashboard(makeDashboardDef()).createSession(); }
function state(s: ReturnType<typeof fresh>) {
  return { log: s.log.records, fdr: s.ledger(), head: s.head, cursor: s.cursor(), paths: s.paths({ includeArchived: true }), registered: s.hasAnalysis('new-analysis') };
}

describe('B1 — native identity is judged before any domain mutation', () => {
  it.each(invalid)('port rejects malformed host identity %j with a typed gap and no FDR or log change', async (identity) => {
    for (const [tool, args] of [['viz.propose_chart', proposal], ['viz.declare_analysis', { analysisId: 'correlation' }], ['viz.dispatch', pick], ['viz.paths', { action: 'new', commitId: 's1', name: 'unwanted' }]] as const) {
      const s = fresh();
      const before = state(s);
      const result = await vizAsTools(s).call(tool, args, identity as never);
      expect(result).toMatchObject({ ok: false, reason: 'PAYLOAD_INVALID', gap: { code: 'guard-failed', op: 'toolCall' } });
      expect(s.gaps()).toHaveLength(1);
      expect(state(s)).toEqual(before);
    }
  });

  it.each(invalid)('all direct mutation boundaries reject malformed identity %j before work', async (identity) => {
    for (const door of ['dispatch', 'declareAnalysis', 'proposeChart', 'adoptPath'] as const) {
      const s = fresh();
      const before = state(s);
      const register = vi.spyOn(s, 'registerAnalysis');
      const opts = { agentCall: identity as never };
      const result = door === 'dispatch'
        ? await s.dispatch({ verb: 'analyze', analysisId: 'new-analysis', def: { builtin: 'correlation', x: 'price', y: 'rating' }, cause }, opts)
        : door === 'declareAnalysis'
          ? await s.declareAnalysis('new-analysis', { ...opts, def: { builtin: 'correlation', x: 'price', y: 'rating' } })
          : door === 'proposeChart' ? await s.proposeChart(proposal, opts) : await s.adoptPath('not-needed', opts);
      if (door === 'dispatch') expect(result).toMatchObject({ ok: false, rejection: { code: 'guard-failed' } });
      else if (door === 'declareAnalysis') expect(result).toMatchObject({ kind: 'unknown', result: { ok: false, reason: 'guard-failed' }, gap: { code: 'guard-failed' } });
      else expect(result).toMatchObject({ ok: false, gap: { code: 'guard-failed' } });
      expect(register).not.toHaveBeenCalled();
      expect(state(s)).toEqual(before);
      const next = await s.dispatch(pick);
      expect(next.ok && next.commit!.id).toBe('s1');
    }
  });

  it('a rejected identity precedes even malformed or not-yet-built analysis declarations', async () => {
    const s = fresh();
    for (const def of [null, 3, 'bad', { kind: 'test' }, { kind: 'transform' }] as const) {
      const result = await s.declareAnalysis('new-analysis', { def: def as never, agentCall: {} as never });
      expect(result.result).toMatchObject({ ok: false, reason: 'guard-failed' });
      expect(result.kind).toBe(typeof def === 'object' && def !== null ? def.kind : 'unknown');
      expect(s.hasAnalysis('new-analysis')).toBe(false);
    }
    const registered = await s.declareAnalysis('correlation', { agentCall: {} as never });
    expect(registered.kind).toBe('test');
    expect(s.ledger()).toEqual([]);
    expect(s.log.records).toEqual([]);
  });

  it('strict session identities reject smuggled keys, while structurally wider host context is copied early', async () => {
    const s = fresh();
    const result = await s.dispatch(pick, { agentCall: { toolCallId: 't', extra: 'smuggled' } as never });
    expect(result).toMatchObject({ ok: false, rejection: { code: 'guard-failed' } });
    const context = { toolCallId: 'native', runId: 'r', correlationId: 'turn', runtimeStageId: 'tool#1', agentEventLog: [] };
    const pending = vizAsTools(s).call('viz.dispatch', pick, context);
    context.toolCallId = 'changed';
    context.runId = 'changed';
    await pending;
    expect(s.log.records[0]!.agentCall).toEqual({ toolCallId: 'native', runId: 'r' });
    expect(Object.isFrozen(context)).toBe(false);
  });

  it('valid partial native context stays unlinked, including an optional undefined native runId', async () => {
    const s = fresh();
    const port = vizAsTools(s, { agentEventLog: () => [{ toolCallId: 'native', runId: 'r', runtimeStageId: 'tool#1' }] });
    for (const context of [{ toolCallId: 'native' }, { toolCallId: 'native', runId: undefined }]) {
      expect((await port.call('viz.dispatch', pick, context)).ok).toBe(true);
      expect(s.log.records.at(-1)!.agentCall).toEqual({ toolCallId: 'native' });
      const why = await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } });
      expect(why.threaded).toBe(false);
      expect(why.misses).toContainEqual({ tier: 'agent', missing: 'no-join-key' });
    }
  });

  it('a direct analysis copies caller identity before a paused read and FDR spending', async () => {
    const provider = memoryProvider(SAMPLE_ROWS, { tableName: 'data' });
    const evaluate = provider.evaluate.bind(provider);
    let begin!: () => void;
    const began = new Promise<void>((resolve) => { begin = resolve; });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    provider.evaluate = async (...args) => { begin(); await finished; return evaluate(...args); };
    const s = buildDashboard(makeDashboardDef(), { providers: { data: provider } }).createSession();
    const identity = { toolCallId: 'native', runId: 'r' };
    const pending = s.declareAnalysis('correlation', { agentCall: identity });
    await began;
    identity.toolCallId = '';
    identity.runId = '';
    finish();
    const result = await pending;
    expect(result.commit!.agentCall).toEqual({ toolCallId: 'native', runId: 'r' });
    expect(s.log.records).toHaveLength(1);
    expect(s.ledger()).toHaveLength(1);
  });

  it('changing accessors are read once and the exact validated primitives are saved', async () => {
    let toolReads = 0;
    let runReads = 0;
    const identity = { get toolCallId() { return ++toolReads === 1 ? 'native' : ''; }, get runId() { return ++runReads === 1 ? 'r' : ''; } };
    const s = fresh();
    const result = await s.declareAnalysis('correlation', { agentCall: identity });
    expect(result.commit!.agentCall).toEqual({ toolCallId: 'native', runId: 'r' });
    expect([toolReads, runReads]).toEqual([1, 1]);
    const refused = await vizAsTools(fresh()).call('viz.propose_chart', proposal, { get toolCallId() { throw new Error('unreadable'); } } as never);
    expect(refused).toMatchObject({ ok: false, reason: 'PAYLOAD_INVALID', gap: { code: 'guard-failed' } });
  });

  it('the same identity parser/copy guards bare log writers before registry or clause work', () => {
    const log = new CauseSelectionSession();
    const register = vi.spyOn(log.registry, 'register');
    const clause = vi.spyOn(log.port, 'clause');
    expect(() => log.commit({ id: 'bad', parent: null, viewId: 'bar', actorMeta: { actor: 'agent' }, kind: 'point', field: 'category', value: 'Formal', cause, agentCall: { toolCallId: '' } })).toThrow('agentCall');
    expect(register).not.toHaveBeenCalled();
    expect(clause).not.toHaveBeenCalled();
    expect(parseAgentCall(undefined)).toMatchObject({ ok: false });
    expect(parseAgentCall({ toolCallId: 't' })).toMatchObject({ ok: true, identity: { toolCallId: 't' } });
  });
});
