/**
 * Coverage packet COV-demo-agent — closes the remaining gaps in `core.ts`:
 * the `/api/dispatch` rejection arms (`dispatchUser`'s per-verb shape guards),
 * the default-intent state projection (`${verb} ${field ?? analysisId ?? ''}`),
 * `seek`/`checkpoint`'s own guards, the live/no-provider mode branch, the
 * `trace()` passthrough, and the 60-entry activity ring-buffer cap.
 *
 * These call `createAnalyst` DIRECTLY (same style as the "time-travel" and
 * "mock chat turn" describe blocks in server.test.ts) rather than through
 * `startServer` — the server's `/api/*` routes run the esbuild-bundled
 * `.cache/core.mjs` (a separate compiled module), so exercising them over
 * HTTP does not instrument `demo-agent/src/core.ts` itself. Always the
 * scripted mock (`mock: true`) — no network calls, no fixed ports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mock, type LLMResponse } from 'agentfootprint/llm-providers';
import { createAnalyst } from './core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// demo-agent's own seeded copy (id/category/price/rating + date/region — see gen-data.mjs)
const CSV = readFileSync(path.join(__dirname, '..', 'data', 'dresses.csv'), 'utf8');

describe('createAnalyst — mode + provider fallback (core.ts:109-124)', () => {
  it('mode defaults to "live" and falls through toward the real browserAnthropic provider when neither mock nor a provider is given — surfaces the provider\'s own construction error rather than crashing silently or secretly using the mock', () => {
    expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(() => createAnalyst({ csv: CSV })).toThrow(
      'BrowserAnthropicProvider requires `apiKey`. Browser providers do not read environment variables.',
    );
  });

  it('mode is "mock" and state()/trace() both work when mock:true is given (no provider construction, no throw)', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const state = await analyst.state();
    expect(state.mode).toBe('mock');

    // trace() forwards to the assistant's AgentThinkingUI trace (core.ts:131-133) —
    // never invoked over HTTP in the existing suite (that goes through the
    // bundled core), so exercise it directly here.
    const trace = analyst.trace();
    expect(trace.agent).toBe('Viz Analyst');
    expect(trace.asker).toBe('you');
    expect(Array.isArray(trace.steps)).toBe(true);
  });
});

describe('dispatchUser — per-verb rejection arms (core.ts:145-167)', () => {
  it('filter without viewId/field is rejected with a named error, not a silent no-op', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'filter' } as any);
    expect(res).toEqual({ ok: false, error: 'filter needs viewId and field' });
  });

  it('filter WITHOUT a range defaults the commit\'s range to null (the `body.range ?? null` fallback)', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'filter', viewId: 'scatter', field: 'price', intent: 'no range given' });
    expect(res.ok).toBe(true);
    expect(res.commit.value).toBeNull();
    expect(res.commit.cause.requestedBy).toBe('user');
  });

  it('select without viewId/field is rejected with a named error', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'select' } as any);
    expect(res).toEqual({ ok: false, error: 'select needs viewId and field' });
  });

  it('select without an explicit intent derives one from verb+field ("select category")', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    expect(res.ok).toBe(true);
    expect(res.commit.cause.intent).toBe('select category');
  });

  it('analyze without analysisId is rejected with a named error', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'analyze' } as any);
    expect(res).toEqual({ ok: false, error: 'analyze needs analysisId' });
  });

  it('analyze without an explicit intent derives one from verb+analysisId when field is absent ("analyze correlation")', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'analyze', analysisId: 'correlation' });
    expect(res.ok).toBe(true);
    // 'analyze' results nest the landed commit under `analysis.commit` (unlike
    // filter/select/reencode, which put it at the top level).
    expect(res.analysis.commit.cause.intent).toBe('analyze correlation');
  });

  it('reencode missing viewId/channel/field (all absent) is rejected with the reencode-specific error', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'reencode' } as any);
    expect(res).toEqual({ ok: false, error: 'reencode needs viewId, channel, and field' });
  });

  it('reencode missing only field (viewId + channel present) is STILL rejected — the third OR operand', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'reencode', viewId: 'scatter', channel: 'x' } as any);
    expect(res).toEqual({ ok: false, error: 'reencode needs viewId, channel, and field' });
  });

  it('a FULLY valid reencode dispatch lands a user-badged commit under viewId "encoding:<viewId>"', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'reencode', viewId: 'scatter', channel: 'x', field: 'rating', intent: 'axis swap' });
    expect(res.ok).toBe(true);
    expect(res.commit.viewId).toBe('encoding:scatter');
    expect(res.commit.field).toBe('x');
    expect(res.commit.value).toBe('rating');
    expect(res.commit.cause.requestedBy).toBe('user');

    const state = await analyst.state();
    expect((state.encodings as Record<string, Record<string, string>>)['scatter']).toEqual({ x: 'rating', y: 'rating' });
  });

  it('an unsupported verb is rejected by name, quoting the bad verb — and the intent-projection fallback (verb, no field, no analysisId) does not throw even though it is never surfaced', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'bogus' } as any);
    expect(res).toEqual({ ok: false, error: 'unsupported human verb "bogus"' });
  });
});

describe('dispatchUser — navigate verb: the LY-2 cockpit-layout path + plain declared-view navigate (core.ts navigate branch)', () => {
  it('navigate without a viewId is rejected with a named error, not a silent no-op', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.dispatchUser({ verb: 'navigate' } as any);
    expect(res).toEqual({ ok: false, error: 'navigate needs a viewId' });
  });

  it('navigate to a DECLARED view lands no commit (RP-1: the verb itself is the record) and reports navigatedTo', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'navigate', viewId: 'scatter', intent: 'pan the scatter' });
    expect(res.ok).toBe(true);
    expect(res.navigatedTo).toBe('scatter');
    expect(res.commit).toBeUndefined();
    expect((await analyst.state()).records).toHaveLength(0);
  });

  it('navigate to an UNDECLARED view is an honest needs-view gap', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'navigate', viewId: 'ghost' });
    expect(res.ok).toBe(false);
    expect(res.rejection.op).toBe('navigate');
    expect(res.rejection.code).toBe('needs-view');
  });

  it('a layout navigate (viewId="layout:dashboard", field+value present) lands a user-badged commit; state().layouts reflects it verbatim', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    expect((await analyst.state()).layouts).toEqual({}); // nothing landed yet — the honest empty fold

    const res: any = await analyst.dispatchUser({
      verb: 'navigate',
      viewId: 'layout:dashboard',
      field: 'preset',
      value: 'grid',
      intent: 'layout = grid',
    });
    expect(res.ok).toBe(true);
    expect(res.navigatedTo).toBe('layout:dashboard');
    expect(res.commit.cause.requestedBy).toBe('user');
    expect(res.commit.cause.intent).toBe('layout = grid');

    const state = await analyst.state();
    expect(state.layouts).toEqual({ dashboard: { preset: 'grid' } });
    expect((state.records as { viewId: string }[]).some((r) => r.viewId === 'layout:dashboard')).toBe(true);
  });

  it('a layout navigate missing field is the session\'s own typed guard-failed gap (never silently dropped)', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res: any = await analyst.dispatchUser({ verb: 'navigate', viewId: 'layout:dashboard' });
    expect(res.ok).toBe(false);
    expect(res.rejection.op).toBe('navigate');
    expect(res.rejection.code).toBe('guard-failed');
  });
});

describe('seek — commitId guard + unknown-commit gap (core.ts:170-174)', () => {
  it('an empty commitId is rejected before touching the session', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.seek('');
    expect(res).toEqual({ ok: false, error: 'seek needs a commitId' });
  });

  it('a well-formed but unknown commitId surfaces the session\'s own gap detail', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.seek('totally-bogus-id');
    expect(res).toEqual({ ok: false, error: 'no commit "totally-bogus-id" to seek to' });
  });
});

describe('checkpoint — label guard (core.ts:176-180)', () => {
  it('an empty label is rejected', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.checkpoint('');
    expect(res).toEqual({ ok: false, error: 'checkpoint needs a non-empty label' });
  });

  it('a whitespace-only label is ALSO rejected (the guard trims before checking length)', async () => {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const res = await analyst.checkpoint('   ');
    expect(res).toEqual({ ok: false, error: 'checkpoint needs a non-empty label' });
  });
});

describe('BR-3 — named paths / compare / bring-over / undo (core.ts paths|compare|bringOver|undo + state().paths)', () => {
  /** Seed two named paths: two linear user commits, seek back, act → auto-named fork. */
  async function seedTwoPaths() {
    const analyst = createAnalyst({ csv: CSV, mock: true });
    const c1: any = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'pick formal' });
    const c2: any = await analyst.dispatchUser({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, 150], intent: 'brush mid price' });
    await analyst.seek(c1.commit.id); // detaches HEAD (travel by id)
    const c3: any = await analyst.dispatchUser({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', intent: 'branch pick party' });
    return { analyst, id1: c1.commit.id as string, id2: c2.commit.id as string, id3: c3.commit.id as string };
  }

  it('state().paths carries the BR-1 surface (current/detached/list/events) and grows a second named path after a fork', async () => {
    const { analyst } = await seedTwoPaths();
    const st = await analyst.state();
    expect(st.paths.list.length).toBe(2);
    expect(st.paths.current).toBe(st.paths.list.find((p) => p.active)!.name);
    expect(st.paths.detachedAt).toBeNull();
    expect(st.paths.events.filter((e) => e.type === 'create').length).toBe(2);
  });

  it('paths switch moves HEAD to the named path; an unknown name comes back as a typed gap; a missing name is a named error', async () => {
    const { analyst } = await seedTwoPaths();
    const st = await analyst.state();
    const other = st.paths.list.find((p) => !p.active)!.name;
    const res: any = await analyst.paths({ action: 'switch', name: other });
    expect(res.ok).toBe(true);
    expect(res.name).toBe(other);
    expect((await analyst.state()).paths.current).toBe(other);

    const miss: any = await analyst.paths({ action: 'switch', name: 'no-such-path' });
    expect(miss.ok).toBe(false);
    expect(miss.gap.op).toBe('switchPath');

    expect(await analyst.paths({ action: 'switch' })).toEqual({ ok: false, error: 'paths switch needs a name' });
  });

  it('paths rename really renames (state reflects it); missing from/to is a named error', async () => {
    const { analyst } = await seedTwoPaths();
    const current = (await analyst.state()).paths.current!;
    const res: any = await analyst.paths({ action: 'rename', from: current, to: 'my-side-quest' });
    expect(res.ok).toBe(true);
    expect((await analyst.state()).paths.current).toBe('my-side-quest');

    expect(await analyst.paths({ action: 'rename', from: current })).toEqual({ ok: false, error: 'paths rename needs string from and to' });
  });

  it('paths new starts a named path at a commit (custom name honored); missing commitId is a named error; an unknown action is rejected by name', async () => {
    const { analyst, id1 } = await seedTwoPaths();
    const res: any = await analyst.paths({ action: 'new', commitId: id1, name: 'from-the-top' });
    expect(res.ok).toBe(true);
    expect(res.name).toBe('from-the-top');
    expect((await analyst.state()).paths.list.map((p) => p.name)).toContain('from-the-top');

    expect(await analyst.paths({ action: 'new' })).toEqual({ ok: false, error: 'paths new needs a commitId' });
    expect(await analyst.paths({ action: 'bogus' } as any)).toEqual({ ok: false, error: 'unsupported paths action "bogus"' });
  });

  it('TL-1: archive hides a path from state().paths.list while archivedList keeps it — and restore is the inverse', async () => {
    const { analyst } = await seedTwoPaths();
    const before = await analyst.state();
    const dead = before.paths.list.find((p) => !p.active)!.name;

    const archived: any = await analyst.paths({ action: 'archive', name: dead });
    expect(archived.ok).toBe(true);
    const hidden = await analyst.state();
    expect(hidden.paths.list.map((p) => p.name)).not.toContain(dead);
    // the /api/state extension the UI adapter reads: the hidden rows, flagged
    expect(hidden.paths.archivedList.find((p) => p.name === dead)).toMatchObject({ archived: true });
    expect(hidden.paths.archived).toBe(1);
    // hiding never touches the record OR the statistics
    expect(hidden.records).toEqual(before.records);
    expect(hidden.fdr).toEqual(before.fdr);

    expect(((await analyst.paths({ action: 'restore', name: dead })) as any).ok).toBe(true);
    expect((await analyst.state()).paths.list.map((p) => p.name)).toContain(dead);

    expect(await analyst.paths({ action: 'archive' })).toEqual({ ok: false, error: 'paths archive needs a name' });
    expect(await analyst.paths({ action: 'restore' })).toEqual({ ok: false, error: 'paths restore needs a name' });
  });

  it('TL-1: discard rewinds the current path and keeps the dropped future as an archived path', async () => {
    const { analyst, id1, id2 } = await seedTwoPaths();
    await analyst.paths({ action: 'switch', name: 'main' }); // main = id1 → id2

    const res: any = await analyst.paths({ action: 'discard', commitId: id1 });
    expect(res.ok).toBe(true);
    expect(res).toMatchObject({ path: 'main', at: id1, keptTip: id2, steps: 1 });
    const st = await analyst.state();
    expect(st.paths.list.find((p) => p.name === 'main')!.tip).toBe(id1);
    expect(st.paths.archivedList.find((p) => p.tip === id2)).toBeDefined();
    expect((st.records as { id: string }[]).some((r) => r.id === id2)).toBe(true); // nothing erased

    // commitId is optional (from the cursor) — here that is the rewound tip, so honestly nothing to do
    const atTip: any = await analyst.paths({ action: 'discard' });
    expect(atTip.ok).toBe(false);
    expect(atTip.gap.op).toBe('discardFromHere');
    expect(await analyst.paths({ action: 'discard', commitId: 7 } as any)).toEqual({
      ok: false,
      error: 'paths discard commitId, if present, must be a string',
    });
  });

  it('TL-1: adopt replays the other path\'s steps here and answers with the per-step report', async () => {
    const { analyst } = await seedTwoPaths();
    const st = await analyst.state();
    const other = st.paths.list.find((p) => !p.active)!.name;
    await analyst.paths({ action: 'switch', name: other });
    const source = st.paths.list.find((p) => p.active)!.name;

    const res: any = await analyst.paths({ action: 'adopt', name: source });
    expect(res.ok).toBe(true);
    expect(res.applied).toBeGreaterThan(0);
    expect(res.steps.every((s: any) => typeof s.commitId === 'string')).toBe(true);
    // the source path is untouched by the adopt
    expect((await analyst.state()).paths.list.find((p) => p.name === source)!.tip).toBe(
      st.paths.list.find((p) => p.name === source)!.tip,
    );
    expect(await analyst.paths({ action: 'adopt' })).toEqual({ ok: false, error: 'paths adopt needs a name' });
  });

  it('compare answers the session CompareResult verbatim (ancestor + changed sides + row counts); empty refs are a named error', async () => {
    const { analyst, id1 } = await seedTwoPaths();
    const st = await analyst.state();
    const [a, b] = st.paths.list.map((p) => p.name);
    const res: any = await analyst.compare(a!, b!);
    expect(res.ok).toBe(true);
    expect(res.ancestor).toBe(id1); // both paths fork off the first commit
    expect(typeof res.a.rows).toBe('number');
    expect(typeof res.b.rows).toBe('number');
    // the two tips selected different categories → the bar selection differs
    expect(res.changed.length + res.onlyA.length + res.onlyB.length).toBeGreaterThan(0);

    expect(await analyst.compare('', 'x')).toEqual({ ok: false, error: 'compare needs string a and b (path names or commit ids)' });
  });

  it('bringOver lands a user-badged commit whose cause carries replayedFrom; an empty commitId is a named error', async () => {
    const { analyst, id2 } = await seedTwoPaths();
    // cursor sits on the fork tip (Party path); bring the other path's price brush over
    const res: any = await analyst.bringOver(id2);
    expect(res.ok).toBe(true);
    expect(res.commit.cause.replayedFrom).toBe(id2);
    expect(res.commit.cause.requestedBy).toBe('user');

    expect(await analyst.bringOver('')).toEqual({ ok: false, error: 'bringOver needs a commitId' });
  });

  it('undo lands a user-badged commit whose cause carries revertOf; an empty commitId is a named error', async () => {
    const { analyst, id3 } = await seedTwoPaths();
    const res: any = await analyst.undo(id3); // revert the fork tip's own select
    expect(res.ok).toBe(true);
    expect(res.commit.cause.revertOf).toBe(id3);
    expect(res.commit.cause.requestedBy).toBe('user');

    expect(await analyst.undo('')).toEqual({ ok: false, error: 'undo needs a commitId' });
  });
});

describe('the per-turn activity ring buffer caps at 60 entries (core.ts:120-123)', () => {
  it('caps the retained activity strip at 60 even when far more than 60 tool calls land across concurrent turns', async () => {
    // A provider that NEVER answers with final text — every request comes back
    // as another `whats_here` tool call, so each concurrent `chat()` turn runs
    // the full documented default of 14 ReAct iterations (AssistantOptions'
    // "ReAct iteration cap. Default 14.") before hitting the loop's budget exit.
    let calls = 0;
    const foreverToolCalls = mock({
      name: 'forever-tool-calls',
      respond: (): Partial<LLMResponse> => {
        calls += 1;
        return { content: '', toolCalls: [{ id: `f${calls}`, name: 'whats_here', args: {} }], stopReason: 'tool_use' };
      },
    });

    const analyst = createAnalyst({ csv: CSV, provider: foreverToolCalls });
    // core.ts resets `activity` at the START of every chat() call, so the cap
    // can only be proven by OVERLAPPING (concurrent, un-awaited) turns sharing
    // the one buffer — 5 turns x 14 tool calls each = 70 real pushes, none of
    // which reset each other's progress mid-flight.
    await Promise.all([1, 2, 3, 4, 5].map((i) => analyst.chat(`turn ${i}`)));

    expect(calls).toBe(70); // proves 70 real tool round-trips actually happened
    const state = await analyst.state();
    expect(state.activity.length).toBe(60); // yet the retained buffer never exceeds the cap
    expect(state.activity.every((step) => step.tool === 'whats_here')).toBe(true);
  }, 30_000);
});
