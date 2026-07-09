/**
 * x3 — the hand-wired THREE-TIER chain (no LLM API calls).
 *
 *   viz (Mosaic cause-log)  →  agent (agentfootprint ReAct)  →  kernel (footprintjs)
 *
 * ONE correlationId is threaded end to end. The agent's `apply_filter` tool is
 * the single seam where all three tiers meet: it (a) dispatches a cause-tagged
 * interval commit into the viz log using the correlationId AS the commit id,
 * (b) runs the footprintjs kernel with the correlationId in the run input (so it
 * lands in committed state), and (c) records the join row. A tool_start listener
 * harvests the agent-side frame (runId + runtimeStageId from EventMeta) which is
 * merged in by toolCallId after the run.
 *
 * Where the join key lives in each tier (verified in the report):
 *   - viz:    CommitRecord.id           (no dedicated field — id IS the key)
 *   - agent:  ToolStartPayload.args.correlationId   (rides in tool args)
 *   - kernel: committed state key `corrId` (written by the `load` stage)
 *
 * Decoys planted for A2: a user category viz commit, a SECOND agent question
 * (corr-amt-2) with its own tool call + kernel run, and the kernel's `decoy`
 * stage write (`auditNote`).
 */

import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/llm-providers';
import { CauseSelectionSession, type CommitRecord } from '../x1-replay/log.js';
import type { Cause } from '../../src/cause/index.js';
import { runKernel, type KernelResult } from './kernel.js';

/** The composed join row — the mapping table entry for one correlationId. */
export interface JoinRecord {
  readonly correlationId: string;
  /** Viz tier: the cause-tagged commit (id === correlationId). */
  readonly viz: { readonly commitId: string; readonly viewId: string; readonly cause: Cause };
  /** Agent tier: the tool-call frame. runId/runtimeStageId come from EventMeta. */
  readonly agent: {
    readonly toolCallId: string;
    readonly iteration: number;
    readonly runId: string;
    readonly runtimeStageId: string;
  };
  /** Kernel tier: the footprintjs run this correlationId produced. */
  readonly kernel: KernelResult;
}

/** Everything a test needs to interrogate the chain. */
export interface Chain {
  /** The correlationId of the ONE question `whyRowCount` is asked about. */
  readonly tracked: string;
  /** The decoy question's correlationId (its whole tier trail must be excluded). */
  readonly decoy: string;
  /** correlationId → composed join row. */
  readonly joinTable: ReadonlyMap<string, JoinRecord>;
  /** The full viz commit log (tracked + decoys). */
  readonly vizRecords: readonly CommitRecord[];
  /** Ids of the planted decoy viz commits (must never appear in a slice). */
  readonly decoyVizCommitIds: readonly string[];
}

/** Agent-side frame harvested from a `tool_start` EventMeta. */
interface AgentFrame {
  readonly toolCallId: string;
  readonly runId: string;
  readonly runtimeStageId: string;
  readonly iterIndex: number;
}

/**
 * Build + execute the chain. Returns a fully-populated {@link Chain}. Pure
 * wiring over the REAL packages — no post-processing of traces.
 */
export async function buildChain(): Promise<Chain> {
  const TRACKED = 'corr-amt-1';
  const DECOY_Q = 'corr-amt-2';

  const viz = new CauseSelectionSession();
  let lastVizId: string | null = null;

  // DECOY viz commit #1 — a user category point-select, unrelated to any run.
  const decoyCat = viz.commit({
    id: 'decoy-cat',
    parent: lastVizId,
    viewId: 'A',
    actorMeta: { actor: 'user', label: 'Category picker' },
    kind: 'point',
    field: 'category',
    value: 'Ops',
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'user clicks Ops' },
  });
  lastVizId = decoyCat.record.id;

  const joinTable = new Map<string, JoinRecord>();
  const framesByToolCallId = new Map<string, AgentFrame>();

  // The seam. One tool, shared across both agent runs.
  const applyFilter = defineTool({
    name: 'apply_filter',
    description: 'Apply an interval filter over the dataset and count matching rows.',
    inputSchema: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        range: { type: 'array', items: { type: 'number' } },
        correlationId: { type: 'string' },
      },
      required: ['field', 'range', 'correlationId'],
    },
    execute: async (
      args: { field: 'amount'; range: [number, number]; correlationId: string },
      ctx,
    ) => {
      // (a) viz tier — cause-tagged interval commit; id === the join key.
      //     requestedBy:agent, computedBy:system (packet §4).
      const vizCommit = viz.commit({
        id: args.correlationId,
        parent: lastVizId,
        viewId: 'B',
        actorMeta: { actor: 'agent', label: 'Amount brush' },
        kind: 'interval',
        field: args.field,
        value: [args.range[0], args.range[1]],
        cause: {
          requestedBy: 'agent',
          computedBy: 'system',
          intent: `agent brushes ${args.field} ${args.range[0]}..${args.range[1]}`,
        },
      });
      lastVizId = vizCommit.record.id;

      // (b) kernel tier — correlationId rides in the run input → committed state.
      const kernel = await runKernel({
        correlationId: args.correlationId,
        field: args.field,
        range: args.range,
      });

      // (c) record the join row (agent frame merged post-run by toolCallId).
      joinTable.set(args.correlationId, {
        correlationId: args.correlationId,
        viz: {
          commitId: vizCommit.record.id,
          viewId: vizCommit.record.viewId,
          cause: vizCommit.record.cause,
        },
        agent: {
          toolCallId: ctx.toolCallId,
          iteration: ctx.iteration,
          runId: '', // filled in after the run from the harvested frame
          runtimeStageId: '',
        },
        kernel,
      });

      return { rowCount: kernel.rowCount, correlationId: args.correlationId };
    },
  });

  const scriptFor = (correlationId: string, range: [number, number]) =>
    mock({
      replies: [
        {
          toolCalls: [
            { id: `call-${correlationId}`, name: 'apply_filter', args: { field: 'amount', range, correlationId } },
          ],
        },
        { content: `Filtered ${correlationId}.` },
      ],
    });

  // One Agent per question (fresh provider script each). Same tool + listener.
  const runQuestion = async (correlationId: string, range: [number, number]) => {
    const agent = Agent.create({ provider: scriptFor(correlationId, range), model: 'mock', maxIterations: 4 })
      .system('You filter data with apply_filter.')
      .tool(applyFilter)
      .build();

    const off = agent.on('agentfootprint.stream.tool_start', (ev) => {
      framesByToolCallId.set(ev.payload.toolCallId, {
        toolCallId: ev.payload.toolCallId,
        runId: ev.meta.runId,
        runtimeStageId: ev.meta.runtimeStageId,
        iterIndex: ev.meta.iterIndex ?? -1,
      });
    });
    await agent.run({ message: `filter amount ${range[0]}..${range[1]}` });
    off();
  };

  await runQuestion(TRACKED, [10, 20]); // the tracked question
  await runQuestion(DECOY_Q, [40, 50]); // the DECOY agent tool call + kernel run

  // Merge the harvested agent frames (runId/runtimeStageId) into the join rows.
  for (const [correlationId, rec] of joinTable) {
    const frame = framesByToolCallId.get(rec.agent.toolCallId);
    if (frame) {
      joinTable.set(correlationId, {
        ...rec,
        agent: { ...rec.agent, runId: frame.runId, runtimeStageId: frame.runtimeStageId },
      });
    }
  }

  return {
    tracked: TRACKED,
    decoy: DECOY_Q,
    joinTable,
    vizRecords: viz.records,
    decoyVizCommitIds: ['decoy-cat', DECOY_Q],
  };
}
