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
import { mock, type LLMRequest } from 'agentfootprint/llm-providers';
import { createAssistant } from './analyst.js';
import { buildAnalystSurface } from './def.js';
import type { VizToolResult, VizToolsPort } from '../../src/agent/index.js';

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
