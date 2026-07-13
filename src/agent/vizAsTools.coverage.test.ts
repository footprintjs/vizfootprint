/**
 * vizAsTools.coverage.test.ts — closes the remaining statement/branch gaps in
 * vizAsTools.ts: the object forms of `why`'s target coercion, every dispatch
 * verb's PAYLOAD_INVALID guard (missing/malformed args), the annotate/navigate/
 * fork/checkpoint success arms (never dispatched in the R4/Q6/Q8 suites), the
 * `viz.fork` / `viz.checkpoint` dedicated tool routes, `declare_analysis`'s
 * invalid-id guard + intent pass-through, and the filter `range: null` clear
 * path. Every assertion reads a real field off a real dispatch/tool result —
 * no execute-only lines.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, vizAsTools } from './index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { VizToolResult } from './index.js';

function get(result: VizToolResult, key: string): unknown {
  return (result as Record<string, unknown>)[key];
}

function freshPort() {
  return vizAsTools(buildDashboard(makeDashboardDef()).createSession());
}

describe('viz.why — object-form target coercion (coerceWhyTarget)', () => {
  it('{ column } coerces to a column target — identical to the string form', async () => {
    const port = freshPort();
    const byString = await port.call('viz.why', { target: 'rowCount' });
    const byObject = await port.call('viz.why', { target: { column: 'rowCount' } });
    expect(byObject).toEqual(byString);
    expect(get(byObject, 'missing')).toBe('no-such-target');
  });

  it('{ analysisId } coerces to a hypothesis target — an honest miss before the analysis ever ran', async () => {
    const port = freshPort();
    const res = await port.call('viz.why', { target: { analysisId: 'correlation' } });
    expect(res).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'hypothesis', analysisId: 'correlation' } });
  });

  it('an object with neither column nor analysisId is a typed PAYLOAD_INVALID (falls through to the error arm)', async () => {
    const port = freshPort();
    const res = await port.call('viz.why', { target: {} });
    expect(res).toEqual({
      ok: false,
      reason: 'PAYLOAD_INVALID',
      detail: 'why requires target: a column name (string), or { column } / { analysisId }',
    });
  });

  it('null is a typed PAYLOAD_INVALID (not an object, not a string)', async () => {
    const port = freshPort();
    const res = await port.call('viz.why', { target: null });
    expect(get(res, 'reason')).toBe('PAYLOAD_INVALID');
  });

  it('a number is a typed PAYLOAD_INVALID (typeof object guard rejects a non-null non-object)', async () => {
    const port = freshPort();
    const res = await port.call('viz.why', { target: 42 });
    expect(get(res, 'reason')).toBe('PAYLOAD_INVALID');
  });
});

describe('viz.dispatch — select/filter PAYLOAD_INVALID guards', () => {
  it('select without a viewId is rejected before it ever reaches the session', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'select', field: 'category', value: 'Formal' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'select requires string viewId and field' });
  });

  it('filter without a field is rejected before it ever reaches the session', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', range: [1, 2] });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'filter requires string viewId and field' });
  });

  it('a malformed filter.range (wrong arity) is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [1, 2, 3] });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'filter.range must be a [lo, hi] number pair or null' });
  });

  it('filter range: null clears an existing filter through the dispatch tool', async () => {
    const port = freshPort();
    const set = await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] });
    expect(get(set, 'ok')).toBe(true);
    const cleared = await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: null });
    expect(get(cleared, 'ok')).toBe(true);
    const commit = get(cleared, 'commit') as { value: unknown };
    expect(commit.value).toBeNull();
  });
});

describe('viz.dispatch — annotate (an inert note; never validated against a declared view)', () => {
  it('a well-formed annotate lands and echoes {target, note} verbatim', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'annotate', target: 'scatter', note: 'watch this cluster' });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'annotated')).toEqual({ target: 'scatter', note: 'watch this cluster' });
  });

  it('annotate missing note is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'annotate', target: 'scatter' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'annotate requires string target and note' });
  });

  it('annotate missing target is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'annotate', note: 'no target here' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'annotate requires string target and note' });
  });
});

describe('viz.dispatch — navigate', () => {
  it('navigating to a declared view succeeds and echoes navigatedTo', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'navigate', viewId: 'bar' });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'navigatedTo')).toBe('bar');
  });

  it('navigate without a viewId is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'navigate' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'navigate requires a string viewId' });
  });
});

describe('viz.dispatch — analyze without an analysisId', () => {
  it('a raw analyze dispatch missing analysisId is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'analyze' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'analyze requires a string analysisId' });
  });
});

describe('viz.dispatch — reencode PAYLOAD_INVALID guard', () => {
  it('reencode missing field is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'reencode', viewId: 'scatter', channel: 'x' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'reencode requires string viewId, channel, and field' });
  });
});

describe('viz.dispatch — fork / checkpoint (never dispatched by the R4/Q6/Q8 suites)', () => {
  it('fork without fromCommitId is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'fork' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'fork requires a string fromCommitId' });
  });

  it('a well-formed fork through viz.dispatch moves the cursor and succeeds', async () => {
    const port = freshPort();
    const sel = await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const commit = get(sel, 'commit') as { id: string };
    const res = await port.call('viz.dispatch', { verb: 'fork', fromCommitId: commit.id });
    expect(res).toEqual({ ok: true, verb: 'fork', intent: expect.any(String) });
  });

  it('checkpoint without a label is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'checkpoint' });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'checkpoint requires a string label' });
  });

  it('a well-formed checkpoint through viz.dispatch lands and echoes the label', async () => {
    const port = freshPort();
    const res = await port.call('viz.dispatch', { verb: 'checkpoint', label: 'my-checkpoint' });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'checkpoint')).toMatchObject({ label: 'my-checkpoint' });
  });
});

describe('viz.fork / viz.checkpoint — the dedicated tool routes (distinct switch arms from viz.dispatch)', () => {
  it('viz.fork routes to the fork verb and succeeds given a real commit id', async () => {
    const port = freshPort();
    const sel = await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Work' });
    const commit = get(sel, 'commit') as { id: string };
    const res = await port.call('viz.fork', { fromCommitId: commit.id });
    expect(res).toEqual({ ok: true, verb: 'fork', intent: expect.any(String) });
  });

  it('viz.fork without fromCommitId is a typed PAYLOAD_INVALID (same guard, dedicated route)', async () => {
    const port = freshPort();
    const res = await port.call('viz.fork', {});
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'fork requires a string fromCommitId' });
  });

  it('viz.checkpoint routes to the checkpoint verb and lands a named pointer', async () => {
    const port = freshPort();
    const res = await port.call('viz.checkpoint', { label: 'via-dedicated-tool' });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'checkpoint')).toMatchObject({ label: 'via-dedicated-tool' });
  });

  it('viz.checkpoint without a label is a typed PAYLOAD_INVALID (same guard, dedicated route)', async () => {
    const port = freshPort();
    const res = await port.call('viz.checkpoint', {});
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'checkpoint requires a string label' });
  });
});

describe('viz.declare_analysis — the invalid-id guard and the intent pass-through', () => {
  it('a missing analysisId is a typed PAYLOAD_INVALID (never reaches the session)', async () => {
    const port = freshPort();
    const res = await port.call('viz.declare_analysis', {});
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'declare_analysis requires a string analysisId' });
  });

  it('a non-string analysisId is a typed PAYLOAD_INVALID', async () => {
    const port = freshPort();
    const res = await port.call('viz.declare_analysis', { analysisId: 42 });
    expect(res).toEqual({ ok: false, reason: 'PAYLOAD_INVALID', detail: 'declare_analysis requires a string analysisId' });
  });

  it('an intent passed to declare_analysis rides through to the landed commit cause', async () => {
    const port = freshPort();
    const res = await port.call('viz.declare_analysis', { analysisId: 'clustering', intent: 'why does price cluster like this' });
    expect(get(res, 'ok')).toBe(true);
    const analysis = get(res, 'analysis') as { commit?: { cause: { intent?: string } } };
    expect(analysis.commit?.cause.intent).toBe('why does price cluster like this');
  });
});

describe('viz.declare_analysis — projectAnalysis omits absent commit/gap fields, includes present ones', () => {
  it('a backend rejection (the wasm stub always rejects evaluate) lands a gap and NO commit key', async () => {
    const session = buildDashboard(makeDashboardDef({ engine: 'wasm' })).createSession();
    const port = vizAsTools(session);
    const res = await port.call('viz.declare_analysis', { analysisId: 'correlation' });
    expect(get(res, 'ok')).toBe(true);
    const analysis = get(res, 'analysis') as VizToolResult;
    // R14: a backend-rejected input degrades to an honest degenerate flag, never a fabricated result.
    expect(get(analysis, 'result')).toEqual({ ok: false, reason: 'degenerate-fit', n: 0, fitDegenerate: true });
    // The rejection is filed as a typed gap (never silently dropped) — projected on the result.
    expect(get(analysis, 'gap')).toMatchObject({ code: 'needs-backend-data', op: 'declareAnalysis' });
    // No commit ever landed for a backend-rejected input — the key itself is absent, not null.
    expect('commit' in analysis).toBe(false);
  });
});

describe('viz.paths list — the no-active-path arm (BR-1)', () => {
  it('a fresh session lists no paths and a null current (main is unborn until the first commit)', async () => {
    const port = freshPort();
    const listed = await port.call('viz.paths', { action: 'list' });
    expect(listed).toEqual({ ok: true, current: null, paths: [] });
  });
});
