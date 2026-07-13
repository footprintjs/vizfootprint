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
import { buildAppBundle, readUiStylesheet } from './build.mjs';
import { createAnalyst } from './src/core.js';
import { scriptedReencodeMock, scriptedDateFilterMock } from './src/analyst.js';
import { stepBackTarget, stepForwardTarget } from './src/stepNav.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// demo-agent's own seeded copy (id/category/price/rating + date/region — see gen-data.mjs)
const CSV = readFileSync(path.join(__dirname, 'data', 'dresses.csv'), 'utf8');

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

  it('the vizfootprint-ui stylesheet reads as non-empty CSS (UI-2 — the dashboard is styled by the package)', () => {
    const css = readUiStylesheet().toString('utf8');
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain('.vzf');
  });

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

  it('/api/state exposes columns/encodings/defaultTable — what the vizfootprint-ui adapter needs (UI-2)', async () => {
    const state = (await (await fetch(handle.url + '/api/state')).json()) as {
      defaultTable: string;
      columns: Record<string, { field: string; type: string }[]>;
      encodings: Record<string, Record<string, string>>;
    };
    expect(state.defaultTable).toBe('data');
    expect(state.columns['data']?.map((c) => c.field).sort()).toEqual(['category', 'date', 'id', 'price', 'rating', 'region']);
    expect(state.encodings['scatter']).toEqual({ x: 'price', y: 'rating' });
    expect(state.encodings['line']).toEqual({ x: 'date', y: 'price' });
    expect(state.encodings['map']).toEqual({ region: 'region' });
    // 'table' has no visual-encoding surface at all (no channels to rebind) —
    // it appears as a declared view (below) but with an EMPTY encoding fold.
    expect(state.encodings['table']).toEqual({});
  });

  it('/api/state declares the line/map/table views too — whats_here (the SAME overview) is what the agent reads', async () => {
    const state = (await (await fetch(handle.url + '/api/state')).json()) as { views: { viewId: string }[] };
    expect(state.views.map((v) => v.viewId).sort()).toEqual(['agent', 'bar', 'cluster', 'line', 'map', 'scatter', 'table']);
  });
});

describe('UI-2: reencode — the human dashboard path (axis click -> POST /api/dispatch) and the agent path (chat tool call)', () => {
  it('a human reencode dispatch lands a user-badged commit under viewId "encoding:<viewId>" and updates the fold', async () => {
    const handle = await startServer({ port: 0, mock: true });
    try {
      const res = await postJSON(handle.url + '/api/dispatch', {
        verb: 'reencode',
        viewId: 'scatter',
        channel: 'x',
        field: 'rating',
        intent: 'human reencode: x -> rating',
      });
      expect(res['ok']).toBe(true);
      const commit = res['commit'] as { viewId?: string; field?: string; value?: unknown; cause?: { requestedBy?: string } };
      expect(commit.viewId).toBe('encoding:scatter');
      expect(commit.field).toBe('x');
      expect(commit.value).toBe('rating');
      expect(commit.cause?.requestedBy).toBe('user');

      const state = (await (await fetch(handle.url + '/api/state')).json()) as { encodings: Record<string, Record<string, string>> };
      expect(state.encodings['scatter']).toEqual({ x: 'rating', y: 'rating' });
    } finally {
      await handle.close();
    }
  }, 30_000);

  it('an invalid reencode verb payload is rejected with a clear error, not a silent no-op', async () => {
    const handle = await startServer({ port: 0, mock: true });
    try {
      const res = await postJSON(handle.url + '/api/dispatch', { verb: 'reencode', viewId: 'scatter' }); // missing channel/field
      expect(res['ok']).toBe(false);
      expect(String(res['error'])).toContain('reencode needs');
    } finally {
      await handle.close();
    }
  }, 30_000);

  it('the agent drives reencode through the SAME tool boundary the chat uses (scriptedReencodeMock, provider override)', async () => {
    // scriptedReencodeMock scripts whats_here -> dispatch(reencode x->rating on
    // the scatter) -> a grounded answer — the exact tool sequence a real "change
    // the x axis of the scatter to rating" chat turn drives, LLM stubbed.
    const analyst = createAnalyst({ csv: CSV, mock: true, provider: scriptedReencodeMock() });
    const reply = await analyst.chat('Change the x axis of the scatter to rating.');
    expect(reply.text.length).toBeGreaterThan(0);

    const state = await analyst.state();
    const records = state.records as { viewId: string; field: string; value: unknown; cause: { requestedBy: string } }[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ viewId: 'encoding:scatter', field: 'x', value: 'rating', cause: { requestedBy: 'agent' } });
    expect((state.encodings as Record<string, Record<string, string>>)['scatter']).toEqual({ x: 'rating', y: 'rating' });

    const tools = state.activity.map((a) => a.tool);
    expect(tools).toEqual(['whats_here', 'dispatch']);
  }, 30_000);

  it('FILTER-1: the agent can now date-filter through the SAME tool boundary ("Filter to May", scriptedDateFilterMock)', async () => {
    // Previously a gap: the filter tool validated range as numbers-only, so a
    // date window had no way in. scriptedDateFilterMock drives the exact
    // sequence a real "Filter to May and tell me what changed" turn does.
    const analyst = createAnalyst({ csv: CSV, mock: true, provider: scriptedDateFilterMock() });
    const reply = await analyst.chat('Filter to May and tell me what changed.');
    expect(reply.text.length).toBeGreaterThan(0);

    const state = await analyst.state();
    const records = state.records as { viewId: string; field: string; value: unknown; cause: { requestedBy: string } }[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ viewId: 'line', field: 'date', value: ['2026-05-01', '2026-05-31'], cause: { requestedBy: 'agent' } });

    const tools = state.activity.map((a) => a.tool);
    expect(tools).toEqual(['whats_here', 'dispatch']);
  }, 30_000);

  it('POST /api/chat with a custom provider drives the same reencode through the live server + /api/state', async () => {
    const handle = await startServer({ port: 0, mock: true, provider: scriptedReencodeMock() });
    try {
      const reply = await postJSON(handle.url + '/api/chat', { message: 'change the x axis of the scatter to rating' });
      expect(String(reply['text']).length).toBeGreaterThan(0);
      const state = (await (await fetch(handle.url + '/api/state')).json()) as {
        records: { viewId: string; cause: { requestedBy: string } }[];
        encodings: Record<string, Record<string, string>>;
      };
      expect(state.records.some((r) => r.viewId === 'encoding:scatter' && r.cause.requestedBy === 'agent')).toBe(true);
      expect(state.encodings['scatter']).toEqual({ x: 'rating', y: 'rating' });
    } finally {
      await handle.close();
    }
  }, 30_000);
});

describe('time-travel: seek + branch-on-act + two-truths (Phase B wiring)', () => {
  it('seeking back then acting branches; the branch map gains a second lineage; the fold rebuilds at the cursor', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const c1 = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'pick Formal' });
    await analyst.dispatchUser({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 120], intent: 'brush price' });
    const firstId = (c1 as { commit: { id: string } }).commit.id;

    let st = await analyst.state();
    expect(st.branches.length).toBe(1);
    expect(st.cursor).toBe(st.head);
    expect((st.activeSelections as unknown[]).length).toBe(2);

    // seek back to c1 (read-only): the fold rebuilds to just the bar select
    const seek = await analyst.seek(firstId);
    expect(seek.ok).toBe(true);
    st = await analyst.state();
    expect(st.cursor).toBe(firstId);
    expect(st.viewingPast).toBe(true);
    expect((st.activeSelections as unknown[]).length).toBe(1);

    // act from the past → a SIBLING branch sprouts, and the new lineage is active
    await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', intent: 'branch pick' });
    st = await analyst.state();
    expect(st.branches.length).toBe(2);
    expect(st.viewingPast).toBe(false);
    expect(st.branches.filter((b) => b.active).length).toBe(1);
  }, 30_000);

  it('checkpoint names the cursor; the GLOBAL ledger survives travel (cursor-local 0 vs global 1)', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    await analyst.dispatchUser({ verb: 'filter', viewId: 'scatter', field: 'price', range: [0, 500], intent: 'brush all' });
    const cp = await analyst.checkpoint('before-test');
    expect((cp as { ok: boolean }).ok).toBe(true);

    await analyst.dispatchUser({ verb: 'analyze', analysisId: 'correlation', intent: 'declare correlation' });
    let st = await analyst.state();
    expect((st.fdr as { tests: number }).tests).toBe(1);
    const cid = st.checkpoints.find((c) => c.label === 'before-test')!.commitId!;

    // travel back to the checkpoint: cursor-local sees 0 tests, global stays 1 (never rewinds)
    await analyst.seek(cid);
    st = await analyst.state();
    expect(st.cursor).toBe(cid);
    expect(st.cursorTests).toBe(0);
    expect((st.fdr as { tests: number }).tests).toBe(1);
  }, 30_000);

  it('POST /api/seek and /api/checkpoint drive the shared session', async () => {
    const handle = await startServer({ port: 0, mock: true });
    try {
      const c1 = await postJSON(handle.url + '/api/dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Work', intent: 'pick Work' });
      const id = (c1['commit'] as { id: string }).id;
      const ck = await postJSON(handle.url + '/api/checkpoint', { label: 'p1' });
      expect(ck['ok']).toBe(true);
      await postJSON(handle.url + '/api/dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [10, 90], intent: 'brush' });
      const seek = await postJSON(handle.url + '/api/seek', { commitId: id });
      expect(seek['ok']).toBe(true);
      const st = (await (await fetch(handle.url + '/api/state')).json()) as { cursor: string; viewingPast: boolean; checkpoints: { label: string }[] };
      expect(st.cursor).toBe(id);
      expect(st.viewingPast).toBe(true);
      expect(st.checkpoints.map((c) => c.label)).toContain('p1');
    } finally {
      await handle.close();
    }
  }, 60_000);
});

describe('time-travel: step back/forward (fork-safe navigation — replaces drag-to-scrub)', () => {
  it('forward at a fork follows the ACTIVE lane (not the earliest-created sibling); back returns the parent; both edges disable', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });

    // a genuine ROOT, then a common-prefix commit that becomes the FORK point
    const r0 = await analyst.dispatchUser({ verb: 'filter', viewId: 'scatter', field: 'price', range: [0, 500], intent: 'seed root' });
    const rootId = (r0 as { commit: { id: string } }).commit.id;
    const f0 = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'common prefix (fork point)' });
    const forkId = (f0 as { commit: { id: string } }).commit.id;

    // branch A: the FIRST child of the fork point, created before branch B
    const a0 = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', intent: 'branch A tip' });
    const branchATip = (a0 as { commit: { id: string } }).commit.id;

    // seek back to the fork point and act again → branch B sprouts as a SIBLING
    // and becomes the new active lane (R8 branch-on-act)
    await analyst.seek(forkId);
    const b0 = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', intent: 'branch B tip' });
    const branchBTip = (b0 as { commit: { id: string } }).commit.id;

    const st = await analyst.state();
    expect(st.head).toBe(branchBTip);
    expect(st.branches.length).toBe(2); // two lineages via the API — the packet's "2-branch history"
    const records = st.records as { id: string; parent: string | null }[];

    // THE at-fork rule: forward from the fork point follows the ACTIVE lane
    // (branch B), even though branch A was created first.
    expect(stepForwardTarget(records, forkId, st.head)).toBe(branchBTip);
    // forward at the true root is unambiguous (one child, no fork yet)
    expect(stepForwardTarget(records, rootId, st.head)).toBe(forkId);

    // back from either tip returns to the shared fork point
    expect(stepBackTarget(records, branchBTip)).toBe(forkId);
    expect(stepBackTarget(records, branchATip)).toBe(forkId);
    // back at the true root is disabled (no parent)
    expect(stepBackTarget(records, rootId)).toBe(null);

    // forward is disabled at both leaves: the abandoned (off-lane) branch A
    // tip, and the live head itself
    expect(stepForwardTarget(records, branchATip, st.head)).toBe(null);
    expect(stepForwardTarget(records, st.head, st.head)).toBe(null);
  }, 30_000);
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
