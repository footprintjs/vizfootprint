/**
 * Coverage packet COV-demo-agent — closes the remaining gaps in `analyst.ts`:
 * the provider-absent construction fallback (`options.provider ?? browserAnthropic(...)`),
 * the `trace()` passthrough before any turn has run, the "Recent conversation"
 * transcript prefix (only present from the SECOND turn on), and the isPaused
 * arm of `send()` — the viz tool port never pauses in production (it has no
 * askHuman-shaped tool), so a real pause is forced here with a fake
 * `VizToolsPort` whose `call()` raises `pauseHere()`, the same control-flow
 * mechanism a real tool would use (agentfootprint's documented pause API).
 *
 * These call `createAssistant`/`buildAnalystSurface` DIRECTLY — analyst.ts's
 * own exports — rather than going through `startServer` (which runs the
 * esbuild-bundled `.cache/core.mjs`, a separate compiled module that does not
 * get instrumented as `demo-agent/src/analyst.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pauseHere } from 'agentfootprint';
import { mock, type LLMRequest } from 'agentfootprint/providers';
import { createAssistant, scriptedCleanupMock } from './analyst.js';
import { buildAnalystSurface } from './def.js';
import type { VizToolResult, VizToolsPort } from 'vizfootprint/agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// demo-agent's own seeded copy (id/category/price/rating + date/region — see gen-data.mjs)
const CSV = readFileSync(path.join(__dirname, '..', 'data', 'dresses.csv'), 'utf8');

describe('createAssistant — provider-absent construction falls back toward the real provider (analyst.ts:117-119)', () => {
  it('with no provider and no ANTHROPIC_API_KEY set, constructing throws the real provider\'s own clean error (never silently substitutes a mock)', () => {
    expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
    const { port } = buildAnalystSurface(CSV);
    expect(() => createAssistant(port, {})).toThrow(
      'BrowserAnthropicProvider requires `apiKey`. Browser providers do not read environment variables.',
    );
  });

  it('a supplied provider short-circuits the fallback entirely — construction never touches browserAnthropic', () => {
    const { port } = buildAnalystSurface(CSV);
    const assistant = createAssistant(port, { provider: mock({ reply: 'hi' }) });
    expect(assistant).toBeTruthy();
  });
});

describe('trace() before any turn has run (analyst.ts:134-136)', () => {
  it('returns a well-formed, empty atui Trace (task defaults to "", no steps yet)', () => {
    const { port } = buildAnalystSurface(CSV);
    const assistant = createAssistant(port, { provider: mock({ reply: 'hi' }) });
    const trace = assistant.trace();
    expect(trace.task).toBe('');
    expect(trace.agent).toBe('Viz Analyst');
    expect(trace.asker).toBe('you');
    // atui always seeds a leading 'prompt' step (the system/task framing) —
    // no 'ask'/'return'/'answer' beats exist yet since no turn has run.
    expect(trace.steps.map((s) => s.kind)).toEqual(['prompt']);
  });
});

describe('send() — the "Recent conversation" transcript prefix only appears from the SECOND turn (analyst.ts:139-141)', () => {
  it('turn 1 sees no prefix; turn 2 (same assistant instance) sees the prefix', async () => {
    const { port } = buildAnalystSurface(CSV);
    // Inspect exactly what the LLM request's first message actually contained —
    // real, observable proof of the transcript-priming behavior (not an
    // assumption about internal state).
    const provider = mock({
      respond: (req: LLMRequest): string => {
        const first = req.messages[0]?.content ?? '';
        return first.includes('Recent conversation:') ? 'has-prefix' : 'no-prefix';
      },
    });
    const assistant = createAssistant(port, { provider });

    const r1 = await assistant.send('first message');
    expect(r1.text).toBe('no-prefix');
    expect(r1.correlationId).toBe('turn-1');

    const r2 = await assistant.send('second message');
    expect(r2.text).toBe('has-prefix');
    expect(r2.correlationId).toBe('turn-2');
  });
});

describe('TL-1 — the "clean up my dead ends" scripted turn, over the REAL tool port', () => {
  it('reads the paths LIST back, archives every path but the current one, and states the honesty line — while the ledger stays put', async () => {
    const { port, session } = buildAnalystSurface(CSV);
    // two dead ends beside the path we are on: act, travel back, act again ×2
    const a = await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const aId = ((a as Record<string, unknown>)['commit'] as { id: string }).id;
    await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] });
    await port.call('viz.fork', { fromCommitId: aId });
    await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Party', intent: 'party lane' });
    await port.call('viz.fork', { fromCommitId: aId });
    await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Work', intent: 'work lane' });
    await port.call('viz.declare_analysis', { analysisId: 'correlation' }); // a real test on a lane about to be hidden

    const before = await session.overview();
    const recordsBefore = session.log.records.length;
    expect(before.fdr.tests).toBe(1);
    expect(session.paths()).toHaveLength(3);
    const current = before.paths.current!;

    const assistant = createAssistant(port, { provider: scriptedCleanupMock() });
    const { text } = await assistant.send('Clean up my dead ends — archive everything but this path.');

    // exactly the two dead ends are hidden; the path we are on is untouched
    expect(session.paths().map((p) => p.name)).toEqual([current]);
    expect(session.paths({ includeArchived: true })).toHaveLength(3);
    // the reply states the rule in plain words
    expect(text).toContain('Hidden, not erased — the statistics remember');
    expect(text).toContain('never refunded');
    // …and the statistics really did remember
    const after = await session.overview();
    expect(after.fdr).toEqual(before.fdr);
    expect(after.paths.archived).toBe(2);
    expect(session.log.records.length).toBe(recordsBefore); // hiding is never a commit, and never a deletion
  });

  it('handed a transcript with NO paths listing in it, it invents no target — it just replies', async () => {
    // Driven at the provider boundary: two tool bodies that carry no `paths`
    // array at all. The scan finds nothing and must return an empty target list
    // rather than guessing a path name out of whatever else came back.
    const provider = scriptedCleanupMock();
    const res = await provider.complete({
      model: 'mock',
      messages: [
        { role: 'user', content: 'clean up' },
        { role: 'tool', content: '{"ok":true}' },
        { role: 'tool', content: '{"ok":true,"gap":{"detail":"nope"}}' },
      ],
    });
    expect(res.toolCalls ?? []).toEqual([]); // no archive call was fabricated
    expect(res.content).toContain('Hidden, not erased');
  });

  it('one dead end reads in the singular', async () => {
    const listing = JSON.stringify({ ok: true, current: 'main', paths: [{ name: 'main' }, { name: 'side' }] });
    const res = await scriptedCleanupMock().complete({
      model: 'mock',
      messages: [
        { role: 'user', content: 'clean up' },
        { role: 'tool', content: '{"ok":true}' },
        { role: 'tool', content: listing },
        { role: 'tool', content: '{"ok":true,"name":"side"}' }, // the one archive already done
      ],
    });
    expect(res.content).toContain('Archived the one dead end');
  });

  it('with nothing to tidy it archives nothing and still tells the truth', async () => {
    const { port, session } = buildAnalystSurface(CSV);
    await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const assistant = createAssistant(port, { provider: scriptedCleanupMock() });
    const { text } = await assistant.send('Clean up my dead ends.');
    expect(session.paths({ includeArchived: true }).filter((p) => p.archived === true)).toHaveLength(0);
    expect(text).toContain('Hidden, not erased');
  });
});

describe('send() — the isPaused arm (analyst.ts:147-149)', () => {
  it('surfaces the "run paused unexpectedly" message when a tool call raises a real pause (pauseHere) — the viz port itself never does this in production, so it is forced via a fake port', async () => {
    // Same control-flow mechanism a real askHuman-shaped tool would use
    // (agentfootprint's documented `pauseHere()` — thrown inside a tool's
    // execute(), caught by the Agent's tool-call stage, forwarded as a pause).
    const pausingPort: VizToolsPort = {
      tools: () => [{ name: 'viz.whats_here', description: 'test probe tool', inputSchema: { type: 'object', properties: {} } }],
      call: async (): Promise<VizToolResult> => {
        pauseHere({ question: 'approve this action?' });
        return {}; // unreachable — pauseHere always throws
      },
    };
    const provider = mock({
      respond: () => ({ content: '', toolCalls: [{ id: 't1', name: 'whats_here', args: {} }], stopReason: 'tool_use' as const }),
    });
    const assistant = createAssistant(pausingPort, { provider });

    const result = await assistant.send('please pause');
    expect(result.text).toBe('The run paused unexpectedly (no confirmation gate is wired).');
    expect(result.correlationId).toBe('turn-1');
  });
});
