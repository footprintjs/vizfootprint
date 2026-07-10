/**
 * Node-side acceptance for the mixed-principal demo (NO API calls — the scripted
 * mock provider drives a real tool sequence end-to-end):
 *   1. the server boots and the page + app bundle + CSV + /api/state return 200;
 *   2. the browser app bundle builds (esbuild) into non-empty JS;
 *   3. a human dispatch lands a `user`-badged commit on the shared session;
 *   4. one mock chat turn drives whats_here → dispatch(filter) → declare_analysis
 *      (correlation) → a grounded reply, landing `agent`-badged commits AND one
 *      LORD++ ledger row — the mixed-principal log, both authors in one history.
 *
 * (3)/(4) run the REAL landed layers (session + tool port + agentfootprint Agent
 * over the mock) — the same modules the server ships.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from './server.mjs';
import { buildAppBundle } from './build.mjs';
import { createAnalyst } from './src/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = readFileSync(path.join(__dirname, '..', 'demo', 'data', 'dresses.csv'), 'utf8');

async function postJSON(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

describe('demo-agent server + bundle', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    handle = await startServer({ port: 0, mock: true });
  }, 60_000);
  afterAll(async () => {
    await handle.close();
  });

  it('serves the page, the app bundle, the CSV, and /api/state with 200', async () => {
    for (const p of ['/', '/bundle/app.js', '/data/dresses.csv', '/api/state']) {
      const res = await fetch(handle.url + p);
      expect(res.status, p).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(0);
    }
    expect((await fetch(handle.url + '/nope')).status).toBe(404);
  });

  it('the app bundle builds into non-empty browser JS', async () => {
    const js = await buildAppBundle();
    expect(js.length).toBeGreaterThan(5000);
    // it really pulled in the reused SVG charts + the src predicate evaluator
    expect(js).toContain('scatter');
  }, 60_000);

  it('a human dispatch lands a user-badged commit', async () => {
    const res = await postJSON(handle.url + '/api/dispatch', {
      verb: 'select',
      viewId: 'bar',
      field: 'category',
      value: 'Formal',
      intent: 'human picks Formal',
    });
    expect(res['ok']).toBe(true);
    const commit = res['commit'] as { cause?: { requestedBy?: string } };
    expect(commit.cause?.requestedBy).toBe('user');
  });
});

describe('mock chat turn drives the real tool surface', () => {
  it('whats_here → filter → declare correlation → agent commits + one ledger row', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });

    // a human moves first (user-badged), then the analyst works (agent-badged)
    await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', intent: 'human picks Party' });
    const reply = await analyst.chat('Is price correlated with rating? Declare it and read the ledger honestly.');
    expect(reply.text.length).toBeGreaterThan(20);
    expect(reply.correlationId).toBe('turn-1'); // the 7.4.0 per-turn join key

    const state = await analyst.state();
    const records = state.records as { cause: { requestedBy: string } }[];
    const badges = records.map((r) => r.cause.requestedBy);
    expect(badges).toContain('user'); // the human's commit
    expect(badges.filter((b) => b === 'agent').length).toBeGreaterThanOrEqual(1); // the analyst's commits

    const fdr = state.fdr as { ledger: unknown[]; tests: number };
    expect(fdr.ledger.length).toBe(1); // exactly one declared test
    expect(fdr.tests).toBe(1);

    // the activity strip recorded the real six-tool calls it made
    const tools = state.activity.map((a) => a.tool);
    expect(tools).toEqual(['whats_here', 'dispatch', 'declare_analysis']);

    expect((state.gaps as unknown[]).length).toBe(0); // the scripted task hits no gaps
  }, 60_000);

  it('an agent request for a nonexistent column files exactly one typed gap', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    // dispatch straight through the human path but on a column that does not exist
    const res = await analyst.dispatchUser({ verb: 'select', viewId: 'scatter', field: 'discount_pct', value: 10, intent: 'ask for a missing column' });
    expect((res as { ok: boolean }).ok).toBe(false);
    const state = await analyst.state();
    const gaps = state.gaps as { code: string }[];
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.code).toBe('needs-column');
  }, 30_000);
});

/**
 * The AgentThinkingUI (atui) debugger surface:
 *   - GET /debug (and ?embed) return the isolated debugger page (200 HTML);
 *   - the atui + React UMD/CSS are served LOCALLY from /vendor (200, NOT a
 *     redirect to a CDN — hardened + offline, mirroring the dress-shop);
 *   - GET /api/trace returns agentfootprint's `agentThinkingTrace()` output —
 *     atui's NATIVE Trace shape (no adapter) — after one mock turn.
 */
describe('agent debugger surface (atui, served local)', () => {
  let handle: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    handle = await startServer({ port: 0, mock: true });
  }, 60_000);
  afterAll(async () => {
    await handle.close();
  });

  it('serves /debug and /debug?embed as HTML 200 wired to the local vendor assets', async () => {
    for (const p of ['/debug', '/debug?embed=1']) {
      const res = await fetch(handle.url + p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type'), p).toContain('text/html');
      const html = await res.text();
      expect(html, p).toContain('AgentThinkingUI'); // mounts atui
      expect(html, p).toContain('/vendor/atui.umd.js'); // from OUR origin, not a CDN
      expect(html, p).toContain('/vendor/react.js');
      expect(html, p).not.toContain('unpkg.com'); // proves no CDN fallback
    }
  });

  it('serves the atui + React UMD/CSS LOCALLY — 200, never redirected to a CDN', async () => {
    const assets: [string, string][] = [
      ['/vendor/atui.umd.js', 'javascript'],
      ['/vendor/atui.css', 'css'],
      ['/vendor/react.js', 'javascript'],
      ['/vendor/react-dom.js', 'javascript'],
    ];
    for (const [p, kind] of assets) {
      const res = await fetch(handle.url + p);
      expect(res.status, p).toBe(200);
      expect(res.redirected, `${p} must not be bounced to a CDN`).toBe(false);
      expect(res.url, p).toBe(handle.url + p); // stayed on our own origin
      expect(res.headers.get('content-type'), p).toContain(kind);
      expect((await res.text()).length, p).toBeGreaterThan(1000);
    }
    // the vendored UMD is the REAL atui build (exposes its browser global)
    const umd = await (await fetch(handle.url + '/vendor/atui.umd.js')).text();
    expect(umd).toContain('AgentThinkingUI');
  });

  it('/api/trace returns an atui-shaped Trace after a mock turn', async () => {
    // empty (but well-formed) before any turn
    const before = (await (await fetch(handle.url + '/api/trace')).json()) as { steps: unknown[] };
    expect(Array.isArray(before.steps)).toBe(true);

    // one scripted turn: whats_here → dispatch(filter) → declare_analysis → answer
    await postJSON(handle.url + '/api/chat', { message: 'Is price correlated with rating? Declare it and read the ledger honestly.' });

    const t = (await (await fetch(handle.url + '/api/trace')).json()) as {
      task: string;
      agent: string;
      model: string;
      asker: string;
      steps: { kind: string; tool?: string }[];
    };
    expect(t.agent).toBe('Viz Analyst');
    expect(t.asker).toBe('you');
    expect(typeof t.model).toBe('string');
    expect(t.task.length).toBeGreaterThan(0);
    expect(t.steps.length).toBeGreaterThan(0);
    const kinds = t.steps.map((s) => s.kind);
    expect(kinds).toContain('answer'); // the turn finished
    const asks = t.steps.filter((s) => s.kind === 'ask').map((s) => s.tool);
    expect(asks).toEqual(['whats_here', 'dispatch', 'declare_analysis']); // the real tool beats
  }, 60_000);
});
