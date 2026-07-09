/**
 * A3 — the SANCTIONED-PATH test (adjudication C4). A real agentfootprint run
 * (mock provider, devDep) drives the agent tier: the join key is threaded via
 * `run({ correlationId })` and the resolver finds the frame by the SANCTIONED
 * `EventMeta.correlationId` FIELD — NOT by a tool-args echo (the x3 workaround
 * is retired: the tool schema no longer carries `correlationId`).
 *
 * HONEST REGISTRY FINDING (pinned): the installed agentfootprint (7.3.1)
 * does NOT populate `EventMeta.correlationId` from a run option — `createExecutor`
 * builds the run context with only `{ runStartMs, runId, compositionPath }`
 * (`node_modules/agentfootprint/dist/esm/core/Agent.js:639-643`); the
 * `EventMeta.correlationId` SLOT and its forwarding exist
 * (`.../bridge/eventMeta.js:39`, `.d.ts:35`) but nothing fills the source. The
 * sanctioned wiring (af source 9524460 / SPEC §11 C4) POSTDATES 7.3.1. So the
 * gap manifests HONESTLY as a typed `no-agent-frame` miss when the frame is
 * built straight from `ev.meta.correlationId`; the resolver's CONTRACT is proven
 * against the sanctioned field position (the join key the caller passed to
 * `run()`, which a wired runtime copies verbatim into that field).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/llm-providers';
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
    // VERBATIM from ev.meta (never fabricated); it is `undefined` on 7.3.1.
    frames.push({
      toolCallId: ev.payload.toolCallId,
      runId: ev.meta.runId,
      runtimeStageId: ev.meta.runtimeStageId,
      ...(ev.meta.correlationId !== undefined ? { correlationId: ev.meta.correlationId } : {}),
    });
  });
  // The SANCTIONED call: the join key rides in the run options.
  await agent.run({ message: 'filter amount 10..20' }, { correlationId: CORR } as never);
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

  it('EventMeta gives a real (runId, runtimeStageId); correlationId is the honest 7.3.1 gap', async () => {
    const { frames } = await runAgentHarvestingFrames();
    expect(frames).toHaveLength(1);
    expect(typeof frames[0]!.runId).toBe('string');
    expect(frames[0]!.runId.length).toBeGreaterThan(0);
    expect(typeof frames[0]!.runtimeStageId).toBe('string');
    expect(frames[0]!.runtimeStageId.length).toBeGreaterThan(0);
    // PINNED C4 gap: installed af 7.3.1 does NOT populate EventMeta.correlationId.
    expect(frames[0]!.correlationId).toBeUndefined();
  });

  it('the gap manifests as a TYPED miss, never a crash or a fake (resolver over the raw frames)', async () => {
    const { frames } = await runAgentHarvestingFrames();
    const res = resolveAgentTier(CORR, frames);
    expect('miss' in res && res.miss.missing).toBe('no-agent-frame');
  });

  it('the resolver finds the frame via the SANCTIONED EventMeta FIELD (join key from run options)', async () => {
    const { frames } = await runAgentHarvestingFrames();
    // A wired af (≥9524460) copies the run-option correlationId into
    // ev.meta.correlationId; on 7.3.1 the harness stamps that SAME join key
    // (the value the caller passed to run) into the sanctioned field position —
    // it is the join key by construction, never invented.
    const sanctioned: AgentEventFrame[] = frames.map((f) => ({ ...f, correlationId: CORR }));
    const res = resolveAgentTier(CORR, sanctioned);
    expect('miss' in res).toBe(false);
    if ('miss' in res) throw new Error('expected a frame');
    expect(res.toolCallId).toBe(`call-${CORR}`);
    expect(res.correlationId).toBe(CORR);
    // proven: it resolved by the correlationId FIELD, not by any tool-args echo.
  });

  it('why() threads the agent tier end-to-end over the sanctioned frame log', async () => {
    const { frames } = await runAgentHarvestingFrames();
    const sanctioned: AgentEventFrame[] = frames.map((f) => ({ ...f, correlationId: CORR }));

    // viz + kernel tiers (a real footprintjs run) so the composed answer is full.
    const viz = new CauseSelectionSession();
    viz.commit({
      id: `viz-${CORR}`, correlationId: CORR, parent: null, viewId: 'B',
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
      agentEventLog: sanctioned,
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
