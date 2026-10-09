import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import { makeNetworkDef, NETWORK_RELATIONS } from '../def/network.fixture.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import { CauseSelectionSession, deserializeLog, parseCommitLog, replayLog, serializeLog } from '../log/index.js';
import { resolveAgentTier, why } from '../why/index.js';
import { vizAsTools } from './vizAsTools.js';
import type { AgentEventFrame } from '../why/index.js';

const first = { toolCallId: 'call-a', runId: 'run-1', correlationId: 'turn-1' };
const second = { toolCallId: 'call-b', runId: 'run-1', correlationId: 'turn-1' };
const frames: AgentEventFrame[] = [first, second].map((c) => ({ ...c, runtimeStageId: 'tool-calls#22' }));
const cause = { requestedBy: 'agent', computedBy: 'agent' } as const;
const pick = { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' };

describe('exact native call attribution, not turn guessing', () => {
  it('two changes in one turn identify their own calls through the normal why tool', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(s, { agentEventLog: () => frames });
    await port.call('viz.dispatch', pick, first);
    const a = await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } });
    await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100] }, second);
    const b = await port.call('viz.why', { target: { kind: 'selection', viewId: 'scatter' } });
    expect(a).toMatchObject({ threaded: true, agent: { toolCallId: 'call-a', runId: 'run-1' } });
    expect(b).toMatchObject({ threaded: true, agent: { toolCallId: 'call-b', runId: 'run-1' } });
    expect(s.log.records.map((r) => r.correlationId)).toEqual(['turn-1', 'turn-1']);
    expect(s.log.records.map((r) => r.agentCall)).toEqual([first, second].map(({ toolCallId, runId }) => ({ toolCallId, runId })));
  });

  it('model-authored identities and batch labels cannot override trusted context or create it', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(s);
    const spoof = { ...pick, toolCallId: 'spoof', runId: 'spoof', agentCall: { toolCallId: 'spoof', runId: 'spoof' }, correlationId: 'spoof' };
    await port.call('viz.dispatch', spoof, first);
    expect(s.log.records[0]).toMatchObject({ agentCall: { toolCallId: 'call-a', runId: 'run-1' }, correlationId: 'turn-1' });
    await port.call('viz.dispatch', spoof);
    expect(s.log.records[1]!.agentCall).toBeUndefined();
    expect(s.log.records[1]!.correlationId).toBeUndefined();
    expect(JSON.stringify(port.tools())).not.toContain('toolCallId');
    expect(JSON.stringify(port.tools())).not.toContain('agentCall');
  });

  it('a legacy correlation-only record stays honestly unlinked even with one matching turn frame', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    await s.dispatch({ ...pick, verb: 'select', cause, correlationId: 'turn-1' });
    const port = vizAsTools(s, { agentEventLog: () => [frames[0]!] });
    expect(await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } })).toMatchObject({ threaded: false, agent: null, misses: [{ tier: 'agent', missing: 'no-join-key' }, { tier: 'kernel', missing: 'no-kernel-snapshot' }] });
  });

  it('missing log, empty log and duplicate exact candidates are distinct honest misses', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    let log: readonly AgentEventFrame[] | undefined;
    const port = vizAsTools(s, { agentEventLog: () => log });
    await port.call('viz.dispatch', pick, first);
    const target = { target: { kind: 'selection', viewId: 'bar' } };
    expect(await port.call('viz.why', target)).toMatchObject({ threaded: false, agent: null, misses: [{ missing: 'no-agent-tier' }, { missing: 'no-kernel-snapshot' }] });
    log = [];
    expect(await port.call('viz.why', target)).toMatchObject({ threaded: false, agent: null, misses: [{ missing: 'no-agent-frame' }, { missing: 'no-kernel-snapshot' }] });
    log = [frames[0]!, { ...frames[0]!, runtimeStageId: 'other-stage' }];
    expect(await port.call('viz.why', target)).toMatchObject({ threaded: false, agent: null, misses: [{ missing: 'ambiguous-join', candidates: log }, { missing: 'no-kernel-snapshot' }] });
    // A per-call native host snapshot overrides the port's live getter.
    expect(await port.call('viz.why', target, { ...second, agentEventLog: [frames[0]!] })).toMatchObject({ threaded: true, agent: { toolCallId: 'call-a' } });
  });

  it('a repeated call id in another run cannot win, and an unqualified id is never proof', () => {
    const elsewhere = { ...frames[0]!, runId: 'other-run' };
    expect(resolveAgentTier(first, [elsewhere, frames[0]!])).toEqual(frames[0]);
    expect(resolveAgentTier(first, [elsewhere])).toEqual({ miss: { tier: 'agent', missing: 'no-agent-frame' } });
    expect(resolveAgentTier({ toolCallId: 'call-a' }, [elsewhere])).toEqual({ miss: { tier: 'agent', missing: 'no-join-key' } });
    const duplicate = resolveAgentTier(first, [frames[0]!, frames[0]!]);
    expect(duplicate).toMatchObject({ miss: { missing: 'ambiguous-join' } });
    if ('miss' in duplicate) expect(duplicate.miss.candidates?.[0]).not.toBe(frames[0]);
  });

  it('the standard port preserves partial host identity without inventing a run from a matching frame', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(s, { agentEventLog: () => [frames[0]!] });
    await port.call('viz.dispatch', pick, { toolCallId: 'call-a' });
    expect(s.log.records[0]!.agentCall).toEqual({ toolCallId: 'call-a' });
    const result = await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } });
    expect(result).toMatchObject({ threaded: false, agent: null });
    expect(result.misses).toContainEqual({ tier: 'agent', missing: 'no-join-key' });
  });

  it('the legacy viz correlation fallback cannot credit another target native call', () => {
    const log = new CauseSelectionSession();
    const input = { parent: null, viewId: 'bar', actorMeta: { actor: 'agent' as const }, kind: 'point' as const, field: 'category', value: 'Formal', cause };
    log.commit({ ...input, id: 'wanted' });
    log.commit({ ...input, id: 'decoy-a', parent: 'wanted', correlationId: 'turn-1', agentCall: { toolCallId: first.toolCallId, runId: first.runId } });
    log.commit({ ...input, id: 'decoy-b', parent: 'decoy-a', correlationId: 'turn-1', agentCall: { toolCallId: second.toolCallId, runId: second.runId } });
    const sources = { vizRecords: log.records, declaringCommitId: 'wanted', inputSelectionCommitIds: [], correlationId: 'turn-1', agentEventLog: frames };
    for (const vizRecords of [log.records, log.records.slice(0, 2)]) {
      const result = why({ kind: 'column', column: 'category' }, { ...sources, vizRecords });
      expect(result).toMatchObject({ threaded: false, agent: null });
      if (result.ok) expect(result.misses).toContainEqual({ tier: 'agent', missing: 'no-join-key' });
    }
  });

  it.each([
    { ...pick },
    { ...pick, value: null },
    { verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'] },
    { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100] },
    { verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[60, 100], [1, 3]] },
    { verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating' },
    { verb: 'reencode', viewId: 'scatter', bindings: { x: 'rating', y: 'price' } },
    { verb: 'navigate', viewId: 'layout:dashboard', field: 'preset', value: 'grid' },
    { verb: 'annotate', target: 'bar', note: 'native host note' },
    { verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight' },
    { verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Native words', author: { kind: 'human' } } },
    { verb: 'describe', viewId: 'scatter', slot: 'caption', proposal: true, record: { text: 'Proposed words', author: { kind: 'human' } } },
  ])('dispatch $verb records trusted identity on every commit-producing path', async (args) => {
    const base = makeDashboardDef();
    const s = buildDashboard({ ...base, capabilities: [...base.capabilities!, { viewId: 'scatter', canProbe: true, encodings: ['point', 'interval', 'cell'] }] }).createSession();
    const result = await vizAsTools(s).call('viz.dispatch', args, first);
    expect(result.ok).toBe(true);
    expect(s.log.records).toHaveLength(1);
    expect(s.log.records[0]).toMatchObject({ agentCall: { toolCallId: 'call-a', runId: 'run-1' }, correlationId: 'turn-1' });
  });

  it('neighbourhood and proposal accept/decline forward native context', async () => {
    const s = buildDashboard(makeNetworkDef(undefined, { relations: NETWORK_RELATIONS, capabilities: [{ viewId: 'net', canProbe: true, encodings: ['neighbourhood'] }] })).createSession();
    expect((await vizAsTools(s).call('viz.dispatch', { verb: 'select', viewId: layerAddress('net', 'edges'), field: 'source', seed: 'cold' }, first)).ok).toBe(true);
    expect(s.log.records[0]!.agentCall).toEqual({ toolCallId: 'call-a', runId: 'run-1' });
    const prose = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(prose);
    const offer = { verb: 'describe', viewId: 'scatter', slot: 'caption', proposal: true, record: { text: 'words', author: { kind: 'human' } } };
    await port.call('viz.dispatch', offer, first);
    expect((await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter', slot: 'caption', accept: 's1' }, second)).ok).toBe(true);
    await port.call('viz.dispatch', offer, first);
    expect((await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter', slot: 'caption', decline: { proposal: 's3', reason: 'not needed' } }, second)).ok).toBe(true);
    expect(prose.log.records.map((r) => r.agentCall?.toolCallId)).toEqual(['call-a', 'call-b', 'call-a', 'call-b']);
  });

  it('analysis and both chart-proposal records carry native identity', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(s, { agentEventLog: () => frames });
    await port.call('viz.declare_analysis', { analysisId: 'clustering' }, first);
    expect(await port.call('viz.why', { target: 'cluster_id' })).toMatchObject({ threaded: true, agent: { toolCallId: 'call-a' } });
    await port.call('viz.propose_chart', { id: 'proposal', spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } } }, second);
    expect(s.log.records.map((r) => r.agentCall?.toolCallId)).toEqual(['call-a', 'call-b', 'call-b']);
    const restored = buildDashboard(makeDashboardDef()).createSession();
    await restored.replay(deserializeLog(serializeLog(s.log.records)));
    expect(restored.log.records.map((r) => r.agentCall)).toEqual(s.log.records.map((r) => r.agentCall));
    expect(replayLog(serializeLog(s.log.records)).records.map((r) => r.agentCall)).toEqual(s.log.records.map((r) => r.agentCall));
  });

  it('adopting a path credits the adopting call, not the call that wrote its source', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(s, { agentEventLog: () => frames });
    await port.call('viz.dispatch', pick, first);
    await port.call('viz.dispatch', { ...pick, value: 'Party' }, first);
    await port.call('viz.paths', { action: 'new', commitId: 's1', name: 'alternate' });
    expect((await port.call('viz.paths', { action: 'adopt', name: 'main' }, second)).ok).toBe(true);
    expect(s.log.records.at(-1)).toMatchObject({ cause: { replayedFrom: 's2' }, agentCall: { toolCallId: 'call-b', runId: 'run-1' }, correlationId: 'turn-1' });
    expect(await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } })).toMatchObject({ threaded: true, agent: { toolCallId: 'call-b' } });
    // Ordinary adoption without host context must not inherit the old identity.
    await port.call('viz.paths', { action: 'new', commitId: 's1', name: 'plain' });
    await port.call('viz.paths', { action: 'adopt', name: 'main' });
    expect(s.log.records.at(-1)!.agentCall).toBeUndefined();
  });

  it('the saved identity is copied, frozen, shape-checked and optional on old recordings', () => {
    const log = new CauseSelectionSession();
    const input = { id: 'one', parent: null, viewId: 'bar', actorMeta: { actor: 'agent' as const }, kind: 'point' as const, field: 'category', value: 'Formal', cause };
    const identity = { toolCallId: 'native', runId: 'run' };
    log.commit({ ...input, agentCall: identity });
    identity.toolCallId = 'changed';
    expect(log.records[0]!.agentCall).toEqual({ toolCallId: 'native', runId: 'run' });
    expect(Object.isFrozen(log.records[0]!.agentCall)).toBe(true);
    for (const malformed of [null, [], {}, { toolCallId: '' }, { toolCallId: 1 }, { toolCallId: 't', runId: 3 }, { toolCallId: 't', runId: '' }, { toolCallId: 't', extra: 1 }]) {
      expect(parseCommitLog([{ ...log.records[0], agentCall: malformed }]).ok).toBe(false);
      expect(() => log.commit({ ...input, id: 'bad', agentCall: malformed as never })).toThrow('agentCall');
    }
    const old = new CauseSelectionSession().commit(input).record;
    expect(parseCommitLog([old]).ok).toBe(true);
    const noRun = new CauseSelectionSession().commit({ ...input, agentCall: { toolCallId: 'unqualified' } }).record;
    expect(deserializeLog(serializeLog([noRun]))[0]!.agentCall).toEqual({ toolCallId: 'unqualified' });
  });
});
