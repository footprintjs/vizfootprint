/**
 * SMOKE — not an acceptance test. Verifies my assumptions about the real
 * packages before the A1..A3 tests lean on them:
 *  (1) the kernel run commits rowCount + threads correlationId into state,
 *  (2) reads are tracked into the execution tree (keysReadFromExecutionTree),
 *  (3) sliceForKey('rowCount') roots at `count` and EXCLUDES the decoy stage,
 *  (4) the agent mock ReAct loop fires tool_start with my correlationId in args
 *      and an EventMeta carrying runId + runtimeStageId.
 */

import { describe, it, expect } from 'vitest';
import { sliceForKey, keysReadFromExecutionTree, sliceToJSON } from 'footprintjs/trace';
import { Agent, defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/llm-providers';
import { runKernel } from './kernel.js';

describe('smoke — kernel', () => {
  it('commits rowCount, threads correlationId, slice excludes decoy', async () => {
    const res = await runKernel({ correlationId: 'corr-1', field: 'amount', range: [10, 20] });
    expect(res.rowCount).toBe(3); // amounts 12,15,18 in [10,20]
    expect(res.committedCorrelationId).toBe('corr-1');

    const slice = sliceForKey(
      res.snapshot.commitLog,
      'rowCount',
      keysReadFromExecutionTree(res.snapshot.executionTree),
    );
    const json = sliceToJSON(slice);
    const stageIds = Object.values(json.nodes ?? {}).map((n) => n.stageId).sort();
    // eslint-disable-next-line no-console
    console.log('SMOKE slice nodes:', JSON.stringify(json.nodes, null, 2));
    // eslint-disable-next-line no-console
    console.log('SMOKE writerId:', json.writerId, 'keysReadKind:', json.keysReadKind, 'coverage:', JSON.stringify(slice.readsCoverage));
    expect(stageIds).toContain('count');
    expect(stageIds).not.toContain('decoy');
  });
});

describe('smoke — agent', () => {
  it('mock ReAct fires tool_start with correlationId in args + meta.runId', async () => {
    const seen: Array<{ toolName: string; args: Record<string, unknown>; runId: string; runtimeStageId: string; iterIndex?: number }> = [];

    const applyFilter = defineTool({
      name: 'apply_filter',
      description: 'Apply an interval filter and count rows.',
      inputSchema: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          range: { type: 'array', items: { type: 'number' } },
          correlationId: { type: 'string' },
        },
        required: ['field', 'range', 'correlationId'],
      },
      execute: (args: { field: string; range: [number, number]; correlationId: string }) => {
        return { ok: true, echoed: args.correlationId };
      },
    });

    const provider = mock({
      replies: [
        { toolCalls: [{ id: 't1', name: 'apply_filter', args: { field: 'amount', range: [10, 20], correlationId: 'corr-1' } }] },
        { content: 'Done: 3 rows.' },
      ],
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('You filter data.')
      .tool(applyFilter)
      .build();

    agent.on('agentfootprint.stream.tool_start', (ev) => {
      seen.push({
        toolName: ev.payload.toolName,
        args: ev.payload.args as Record<string, unknown>,
        runId: ev.meta.runId,
        runtimeStageId: ev.meta.runtimeStageId,
        iterIndex: ev.meta.iterIndex,
      });
    });

    const answer = await agent.run({ message: 'filter amount 10..20' });
    // eslint-disable-next-line no-console
    console.log('SMOKE agent answer:', answer);
    // eslint-disable-next-line no-console
    console.log('SMOKE tool_start events:', JSON.stringify(seen, null, 2));

    expect(seen.length).toBe(1);
    expect(seen[0]!.toolName).toBe('apply_filter');
    expect(seen[0]!.args.correlationId).toBe('corr-1');
    expect(typeof seen[0]!.runId).toBe('string');
    expect(seen[0]!.runId.length).toBeGreaterThan(0);
    expect(typeof seen[0]!.runtimeStageId).toBe('string');
    // meta.correlationId is NOT populated by the Agent runtime (dead slot) —
    // record what we actually get so the report is honest.
    // eslint-disable-next-line no-console
    console.log('SMOKE agent snapshot commitValues:', agent.getLastSnapshot()?.commitValues);
  });
});
