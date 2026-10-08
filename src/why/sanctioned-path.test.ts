/**
 * A3 — the SANCTIONED-PATH test (adjudication C4). A real agentfootprint run
 * (mock provider, devDep) drives the agent tier. The exact address is native
 * `(runId, payload.toolCallId)`, never a model-argument echo. EventMeta still
 * carries the run-option correlationId as a turn label, but it cannot select
 * a particular call. The in-repo native-host regression additionally proves
 * execute's context supplies this exact identity on ordinary tool calls.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { resolveAgentTier, why } from './index.js';
import type { AgentEventFrame, WhySources } from './index.js';
import { CauseSelectionSession } from '../log/index.js';
import { runKernel } from './kernel.fixture.js';

const CORR = 'corr-sanctioned-1';

/** Run a mock agent that calls a correlationId-FREE tool; harvest EventMeta frames. */
async function runAgentHarvestingFrames(): Promise<{
  frames: AgentEventFrame[];
  toolArgsSeen: Record<string, unknown>[];
  toolHasCorrelationIdProp: boolean;
}> {
  const toolArgsSeen: Record<string, unknown>[] = [];

  // The tool-args workaround is RETIRED: no `correlationId` in the schema.
  const applyFilter = defineTool({
    name: 'apply_filter',
    description: 'Apply an interval filter over the dataset and count matching rows.',
    inputSchema: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        range: { type: 'array', items: { type: 'number' } },
      },
      required: ['field', 'range'],
    },
    execute: (args: Record<string, unknown>) => {
      toolArgsSeen.push(args);
      return { rowCount: 3 };
    },
  });
  const toolHasCorrelationIdProp = Object.prototype.hasOwnProperty.call(
    (applyFilter as { inputSchema?: { properties?: Record<string, unknown> } }).inputSchema?.properties ?? {},
    'correlationId',
  );

  const provider = mock({
    replies: [
      { toolCalls: [{ id: `call-${CORR}`, name: 'apply_filter', args: { field: 'amount', range: [10, 20] } }] },
      { content: 'done' },
    ],
  });
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
    .system('You filter data with apply_filter.')
    .tool(applyFilter)
    .build();

  const frames: AgentEventFrame[] = [];
  const off = agent.on('agentfootprint.stream.tool_start', (ev) => {
    // Harvest the SANCTIONED shape straight from EventMeta — correlationId taken
    // VERBATIM from ev.meta (never fabricated); it is populated on af ≥7.4.0.
    frames.push({
      toolCallId: ev.payload.toolCallId,
      runId: ev.meta.runId,
      runtimeStageId: ev.meta.runtimeStageId,
      ...(ev.meta.correlationId !== undefined ? { correlationId: ev.meta.correlationId } : {}),
    });
  });
  // The SANCTIONED turn label rides in the run options
  // (`AgentRunOptions.correlationId`, publicly typed — no cast needed).
  await agent.run({ message: 'filter amount 10..20' }, { correlationId: CORR });
  off();

  return { frames, toolArgsSeen, toolHasCorrelationIdProp };
}

describe('A3 — sanctioned agent-tier path (C4)', () => {
  it('the tool-args workaround is retired: the tool schema carries no correlationId', async () => {
    const { toolHasCorrelationIdProp, toolArgsSeen } = await runAgentHarvestingFrames();
    expect(toolHasCorrelationIdProp).toBe(false);
    // and the tool never RECEIVED a correlationId arg at fire time.
    expect(toolArgsSeen).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(toolArgsSeen[0]!, 'correlationId')).toBe(false);
  });

  it('EventMeta gives a real (runId, runtimeStageId, correlationId) — the C4 gap is CLOSED on af 7.4.0', async () => {
    const { frames } = await runAgentHarvestingFrames();
    expect(frames).toHaveLength(1);
    expect(typeof frames[0]!.runId).toBe('string');
    expect(frames[0]!.runId.length).toBeGreaterThan(0);
    expect(typeof frames[0]!.runtimeStageId).toBe('string');
    expect(frames[0]!.runtimeStageId.length).toBeGreaterThan(0);
    // CLOSED C4 gap: installed af 7.4.0 DOES populate EventMeta.correlationId
    // from the run-option turn label, verbatim.
    expect(frames[0]!.correlationId).toBe(CORR);
  });

  it('the resolver finds the frame by its exact native run and call identity', async () => {
    const { frames } = await runAgentHarvestingFrames();
    // Unlike the retired x3 workaround, this is the RAW harvested frame log —
    // nothing stamped or fabricated. af ≥7.4.0 already copied the run-option
    // correlationId into ev.meta.correlationId (SANCTIONED field position).
    const res = resolveAgentTier({ toolCallId: frames[0]!.toolCallId, runId: frames[0]!.runId }, frames);
    expect('miss' in res).toBe(false);
    if ('miss' in res) throw new Error('expected a frame');
    expect(res.toolCallId).toBe(`call-${CORR}`);
    expect(res.correlationId).toBe(CORR);
    // Proven: exact run/call identity resolved, independently of the turn label.
  });

  it('a call that never ran degrades to no-agent-frame without correlation fallback', async () => {
    const { frames } = await runAgentHarvestingFrames();
    // Same native frame log, but asked about a call identity that never ran.
    // The now-live sanctioned path must still fail HONESTLY, not silently
    // fall back to the wrong frame or a fake match.
    const res = resolveAgentTier({ toolCallId: 'call-never-ran', runId: frames[0]!.runId }, frames);
    expect('miss' in res && res.miss).toEqual({ tier: 'agent', missing: 'no-agent-frame' });
  });

  it('why() threads the agent tier end-to-end over the real, wired frame log', async () => {
    const { frames } = await runAgentHarvestingFrames();

    // viz + kernel tiers (a real footprintjs run) so the composed answer is full.
    const viz = new CauseSelectionSession();
    viz.commit({
      id: `viz-${CORR}`, correlationId: CORR, agentCall: { toolCallId: frames[0]!.toolCallId, runId: frames[0]!.runId }, parent: null, viewId: 'B',
      actorMeta: { actor: 'agent' }, kind: 'interval', field: 'amount', value: [10, 20],
      cause: { requestedBy: 'agent', computedBy: 'system' },
    });
    const kernel = await runKernel({ correlationId: CORR, field: 'amount', range: [10, 20] });

    const sources: WhySources = {
      vizRecords: viz.records,
      declaringCommitId: `viz-${CORR}`,
      inputSelectionCommitIds: [],
      kernelSnapshot: kernel.snapshot,
      kernelKey: 'rowCount',
      correlationId: CORR,
      agentEventLog: frames,
    };
    const r = why({ kind: 'column', column: 'rowCount' }, sources);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.threaded).toBe(true);
    expect(r.agent).not.toBeNull();
    expect(r.agent!.toolCallId).toBe(`call-${CORR}`);
    expect(r.misses).toEqual([]); // all three tiers threaded — no honest miss
  });
});
