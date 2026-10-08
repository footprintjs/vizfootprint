/**
 * A+B — the real in-repo host bridge, not a hand-stamped call fixture.
 * Scripted providers drive AgentFootprint's native tool dispatcher. The host
 * records its tool-start stream and forwards execute's exact call context over
 * the ordinary VizToolsPort; no model, network or fabricated stage is involved.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mock, type LLMResponse } from 'agentfootprint/providers';
import type { AgentEventFrame, CrossTierSlice, VizToolCallContext, VizToolsPort } from 'vizfootprint/agent';
import { createAssistant, type ActivityStep } from './analyst.js';
import { buildAnalystSurface } from './def.js';

const CSV = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dresses.csv'), 'utf8');

/** Script one ordinary native call and a standard why query; ids repeat on purpose. */
function oneSelection(category: string): Partial<LLMResponse>[] {
  return [
    { toolCalls: [{ id: 'c1', name: 'dispatch', args: { verb: 'select', viewId: 'bar', field: 'category', value: category } }] },
    { toolCalls: [{ id: 'why1', name: 'why', args: { target: { kind: 'selection', viewId: 'bar' } } }] },
    { content: 'done' },
  ];
}

function whyAnswers(activity: readonly ActivityStep[]): CrossTierSlice[] {
  return activity.filter((step) => step.tool === 'why').map((step) => {
    const result = step.result as unknown as CrossTierSlice;
    expect(result.ok).toBe(true);
    return result;
  });
}

describe('A+B — native AgentFootprint → VizToolsPort exact attribution', () => {
  it('two calls in one turn are linked to their OWN native call, even when the runtime stage is shared', async () => {
    const { port, session } = buildAnalystSurface(CSV);
    const schemasBefore = JSON.stringify(port.tools());
    const captured: VizToolCallContext[] = [];
    const observedAtDispatch: AgentEventFrame[][] = [];
    const wrappingPort: VizToolsPort = {
      tools: () => port.tools(),
      call: async (name, args, context) => {
        expect(context).toBeDefined();
        captured.push({ ...context! });
        // Detached now, proving tool_start was already observed before dispatch.
        observedAtDispatch.push(context!.agentEventLog!.map((frame) => ({ ...frame })));
        return port.call(name, args, context);
      },
    };
    const activity: ActivityStep[] = [];
    const assistant = createAssistant(wrappingPort, {
      provider: mock({ replies: [
        { toolCalls: [
          { id: 'c1', name: 'dispatch', args: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' } },
          { id: 'c2', name: 'dispatch', args: { verb: 'filter', viewId: 'scatter', field: 'price', range: [40, 200] } },
        ] },
        { toolCalls: [
          { id: 'w1', name: 'why', args: { target: { kind: 'selection', viewId: 'bar' } } },
          { id: 'w2', name: 'why', args: { target: { kind: 'selection', viewId: 'scatter' } } },
        ] },
        { content: 'done' },
      ] }),
      onActivity: (step) => activity.push(step),
    });
    const turn = await assistant.send('Select Formal, filter price, and explain both selections.');
    expect(turn).toEqual({ text: 'done', correlationId: 'turn-1' });

    const [first, second] = session.log.records;
    expect(first!.agentCall).toEqual({ toolCallId: 'c1', runId: captured[0]!.runId });
    expect(second!.agentCall).toEqual({ toolCallId: 'c2', runId: captured[1]!.runId });
    expect(captured[0]!.runId).toBeTruthy();
    expect(captured[0]!.runId).toBe(captured[1]!.runId);
    const started = observedAtDispatch[1]!;
    expect(started.map((frame) => frame.toolCallId)).toEqual(['c1', 'c2']);
    expect(started[0]!.runtimeStageId).toBe(started[1]!.runtimeStageId);
    expect(started[0]!.runtimeStageId).not.toBe('unknown#0');
    expect(observedAtDispatch[0]![0]!.toolCallId).toBe('c1');

    const [whyFirst, whySecond] = whyAnswers(activity);
    expect(whyFirst!.threaded).toBe(true);
    expect(whySecond!.threaded).toBe(true);
    expect(whyFirst!.agent).toEqual(started[0]);
    expect(whySecond!.agent).toEqual(started[1]);
    expect(whyFirst!.viz.commitId).toBe(first!.id);
    expect(whySecond!.viz.commitId).toBe(second!.id);
    expect(JSON.stringify(port.tools())).toBe(schemasBefore);
    const properties = port.tools().find((tool) => tool.name === 'viz.dispatch')!.inputSchema['properties'] as Record<string, unknown>;
    for (const key of ['toolCallId', 'runId', 'agentCall', 'correlationId']) expect(properties).not.toHaveProperty(key);
    expect(assistant.trace().steps.some((step) => step.kind === 'answer')).toBe(true);
  });

  it('successive native runs may reuse c1: each why keeps its real run, and old frames remain available', async () => {
    const { port, session } = buildAnalystSurface(CSV);
    const captured: VizToolCallContext[] = [];
    const wrappingPort: VizToolsPort = {
      tools: () => port.tools(),
      call: async (name, args, context) => {
        captured.push({ ...context!, agentEventLog: context!.agentEventLog!.map((frame) => ({ ...frame })) });
        return port.call(name, args, context);
      },
    };
    const activity: ActivityStep[] = [];
    const assistant = createAssistant(wrappingPort, {
      provider: mock({ replies: [...oneSelection('Formal'), ...oneSelection('Party')] }),
      onActivity: (step) => activity.push(step),
    });
    await assistant.send('Select Formal.');
    await assistant.send('Now select Party.');
    const [first, second] = session.log.records;
    expect(first!.agentCall!.toolCallId).toBe('c1');
    expect(second!.agentCall!.toolCallId).toBe('c1');
    expect(first!.agentCall!.runId).not.toBe(second!.agentCall!.runId);
    const [whyFirst, whySecond] = whyAnswers(activity);
    expect(whyFirst!.agent!.runId).toBe(first!.agentCall!.runId);
    expect(whySecond!.agent!.runId).toBe(second!.agentCall!.runId);
    expect(whyFirst!.threaded).toBe(true);
    expect(whySecond!.threaded).toBe(true);
    const latestFrames = captured.at(-1)!.agentEventLog!;
    expect(latestFrames.filter((frame) => frame.toolCallId === 'c1')).toHaveLength(2);
    const oldWhy = await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } }, {
      toolCallId: 'read-old', runId: 'host-read', agentEventLog: latestFrames,
    });
    // Current selection is still the second run; retained first-run frames do
    // not become candidates merely because both providers used "c1".
    expect((oldWhy as unknown as CrossTierSlice).agent!.runId).toBe(second!.agentCall!.runId);
    session.seek(first!.id);
    const historicalWhy = await port.call('viz.why', { target: { kind: 'selection', viewId: 'bar' } }, {
      toolCallId: 'read-old', runId: 'host-read', agentEventLog: latestFrames,
    });
    expect((historicalWhy as unknown as CrossTierSlice).agent!.runId).toBe(first!.agentCall!.runId);
    expect((historicalWhy as unknown as CrossTierSlice).threaded).toBe(true);
  });

  it('a host that supplies no event evidence gets an honest not-linked answer, never a manufactured stage', async () => {
    const { port } = buildAnalystSurface(CSV);
    const wrappingPort: VizToolsPort = {
      tools: () => port.tools(),
      call: (name, args, context) => port.call(name, args, { toolCallId: context!.toolCallId, runId: context!.runId }),
    };
    const activity: ActivityStep[] = [];
    const assistant = createAssistant(wrappingPort, { provider: mock({ replies: oneSelection('Formal') }), onActivity: (step) => activity.push(step) });
    await assistant.send('Select Formal and explain it.');
    const answer = whyAnswers(activity)[0]!;
    expect(answer.threaded).toBe(false);
    expect(answer.agent).toBeNull();
    expect(answer.misses).toContainEqual({ tier: 'agent', missing: 'no-agent-tier' });
  });

  it('duplicate native frame evidence is ambiguous: standard why lists both candidates and credits neither', async () => {
    const { port } = buildAnalystSurface(CSV);
    const wrappingPort: VizToolsPort = {
      tools: () => port.tools(),
      call: (name, args, context) => {
        const evidence = context!.agentEventLog!;
        const frames = name === 'viz.why' ? [...evidence, { ...evidence[0]! }] : evidence;
        return port.call(name, args, { ...context!, agentEventLog: frames });
      },
    };
    const activity: ActivityStep[] = [];
    const assistant = createAssistant(wrappingPort, { provider: mock({ replies: oneSelection('Formal') }), onActivity: (step) => activity.push(step) });
    await assistant.send('Select Formal and explain it.');
    const answer = whyAnswers(activity)[0]!;
    expect(answer.threaded).toBe(false);
    expect(answer.agent).toBeNull();
    const ambiguity = answer.misses.find((miss) => miss.missing === 'ambiguous-join')!;
    expect(ambiguity.candidates).toHaveLength(2);
    expect(ambiguity.candidates![0]).toEqual(ambiguity.candidates![1]);
    expect(answer.commits.some((commit) => commit.tier === 'agent')).toBe(false);
  });
});
