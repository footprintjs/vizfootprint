/**
 * L5 agent surface — `vizAsTools`. The headline R4 acceptance (a SCRIPTED agent
 * completes a multi-step task through the tools ALONE, with zero synthetic
 * input), the zero-synthetic-input structural checks, and the Q8 two-string
 * discipline against a prompt-injection corpus.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, vizAsTools } from './index.js';
import { makeDashboardDef, INJECTION_ROWS, INJECTION_CATEGORY } from '../session/dashboard.fixture.js';
import type { VizToolResult, VizToolsPort } from './index.js';

const TOOL_NAMES = [
  'viz.whats_here',
  'viz.dispatch',
  'viz.declare_analysis',
  'viz.why',
  'viz.fork',
  'viz.checkpoint',
  'viz.paths',
  'viz.compare',
];

function get(result: VizToolResult, key: string): unknown {
  return (result as Record<string, unknown>)[key];
}

/**
 * A plain function (NO LLM) driving the surface through tool calls only —
 * filter -> cluster -> filter-by-cluster -> declare correlation -> read ledger.
 */
async function scriptedAnalyst(port: VizToolsPort) {
  const trace: VizToolResult[] = [];
  trace.push(await port.call('viz.whats_here'));
  trace.push(await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], intent: 'focus mid prices' }));
  const clustered = await port.call('viz.declare_analysis', { analysisId: 'clustering' });
  trace.push(clustered);
  trace.push(await port.call('viz.dispatch', { verb: 'select', viewId: 'cluster', field: 'cluster_id', value: 2, intent: 'filter to cluster 2' }));
  const corr = await port.call('viz.declare_analysis', { analysisId: 'correlation' });
  trace.push(corr);
  const finalHere = await port.call('viz.whats_here');
  trace.push(finalHere);
  return { trace, clustered, corr, finalHere };
}

describe('R4 — a scripted agent completes a multi-step task through tools alone', () => {
  it('filter -> cluster -> filter-by-cluster -> declare correlation -> read ledger', async () => {
    const session = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(session);
    const { clustered, corr, finalHere } = await scriptedAnalyst(port);

    // clustering materialized cluster_id (R11 landing spot).
    expect(get(clustered.analysis as VizToolResult, 'materialized')).toEqual(['cluster_id']);
    // the correlation ran over the (filtered + clustered) selection and landed a test.
    const corrAnalysis = corr.analysis as VizToolResult;
    expect(get(corrAnalysis, 'kind')).toBe('test');
    expect(get(corrAnalysis, 'fdrStep')).toBeDefined();
    // reading the ledger back through whats_here shows exactly one test.
    const fdr = get(finalHere, 'fdr') as { tests: number; ledger: unknown[] };
    expect(fdr.tests).toBe(1);
    expect(fdr.ledger).toHaveLength(1);
    // Everything was honored — no gaps filed along the whole task.
    expect(get(finalHere, 'gaps')).toBe(0);
    expect(session.ledger()).toHaveLength(1);
  });
});

describe('R4 — zero synthetic input (only semantic verbs, no raw-event path)', () => {
  it('exposes exactly the eight fixed semantic tools; none pushes a raw event', () => {
    const session = buildDashboard(makeDashboardDef()).createSession();
    const names = vizAsTools(session).tools().map((t) => t.name);
    expect(names.sort()).toEqual([...TOOL_NAMES].sort());
    expect(names.some((n) => /event|pointer|dom|mouse|keydown|pixel/i.test(n))).toBe(false);
  });

  it('dispatch rejects an unknown verb — there is no raw-input escape hatch', async () => {
    const port = vizAsTools(buildDashboard(makeDashboardDef()).createSession());
    const bad = await port.call('viz.dispatch', { verb: 'emit_pointermove', x: 12, y: 40 });
    expect(bad.ok).toBe(false);
    expect(get(bad, 'reason')).toBe('PAYLOAD_INVALID');
  });

  it('declare_analysis exposes no raw-row input — an analysis runs over the current selection', () => {
    const port = vizAsTools(buildDashboard(makeDashboardDef()).createSession());
    const decl = port.tools().find((t) => t.name === 'viz.declare_analysis')!;
    const props = Object.keys((decl.inputSchema as { properties: Record<string, unknown> }).properties);
    expect(props).not.toContain('input');
    expect(props).not.toContain('rows');
    expect(props).toContain('analysisId');
  });

  it('an unknown tool name returns a structured error listing the real tools', async () => {
    const port = vizAsTools(buildDashboard(makeDashboardDef()).createSession());
    const res = await port.call('viz.push_dom_event', {});
    expect(get(res, 'reason')).toBe('UNKNOWN_TOOL');
    expect(get(res, 'tools')).toEqual(TOOL_NAMES);
  });
});

describe('Q6 — reencode is wired through the dispatch tool (the 8th verb, agent surface)', () => {
  it('dispatch schema enumerates reencode and exposes a channel property', () => {
    const port = vizAsTools(buildDashboard(makeDashboardDef()).createSession());
    const dispatch = port.tools().find((t) => t.name === 'viz.dispatch')!;
    const schema = dispatch.inputSchema as { properties: { verb: { enum: string[] } } & Record<string, unknown> };
    expect(schema.properties.verb.enum).toContain('reencode');
    expect(Object.keys(schema.properties)).toContain('channel');
  });

  it('a scripted agent rebinds a channel through viz.dispatch and reads it back via whats_here', async () => {
    const session = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(session);

    const res = await port.call('viz.dispatch', {
      verb: 'reencode',
      viewId: 'scatter',
      channel: 'x',
      field: 'rating',
      intent: 'swap x to rating',
    });
    expect(get(res, 'ok')).toBe(true);
    expect(get(res, 'reencoded')).toEqual({ viewId: 'scatter', channel: 'x', field: 'rating' });

    const here = await port.call('viz.whats_here');
    const views = get(here, 'views') as { viewId: string; encodings: Record<string, string>; columns: { field: string }[] }[];
    const scatter = views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.encodings).toEqual({ x: 'rating', y: 'rating' });
    // Per-view available columns, so a chat agent can answer "what can I put on x?" from one entry.
    expect(scatter.columns.map((c) => c.field).sort()).toEqual(['category', 'id', 'price', 'rating']);
  });

  it('an invalid channel rejects with a typed guard-failed gap over the tool port', async () => {
    const port = vizAsTools(buildDashboard(makeDashboardDef()).createSession());
    const res = await port.call('viz.dispatch', { verb: 'reencode', viewId: 'scatter', channel: 'nope', field: 'price' });
    expect(get(res, 'ok')).toBe(false);
    expect((get(res, 'gap') as { code: string }).code).toBe('guard-failed');
  });
});

describe('BR-1 — paths + compare drive a REAL session end-to-end through the tools alone', () => {
  it('branch by acting from a fork, then list / switch / rename / new — all through viz.paths', async () => {
    const session = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(session);

    // build a two-step main line, then branch off step 1 with an intent
    const a = await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const aId = (get(a, 'commit') as { id: string }).id;
    await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] });
    await port.call('viz.fork', { fromCommitId: aId });
    await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', intent: 'premium focus' });

    // list: both paths named, the branch-on-act one from its cause
    const listed = await port.call('viz.paths', { action: 'list' });
    expect(listed.ok).toBe(true);
    expect(get(listed, 'current')).toBe('premium-focus');
    const names = (get(listed, 'paths') as { name: string }[]).map((p) => p.name).sort();
    expect(names).toEqual(['main', 'premium-focus']);

    // whats_here shows the current path name + path count (disclosure on the RESULT channel)
    const here = await port.call('viz.whats_here');
    const paths = get(here, 'paths') as { current: string; list: unknown[] };
    expect(paths.current).toBe('premium-focus');
    expect(paths.list).toHaveLength(2);

    // switch back to main by NAME — the next act extends main
    const switched = await port.call('viz.paths', { action: 'switch', name: 'main' });
    expect(switched).toMatchObject({ ok: true, name: 'main' });
    expect((get(await port.call('viz.whats_here'), 'paths') as { current: string }).current).toBe('main');

    // rename the auto-named branch
    const renamed = await port.call('viz.paths', { action: 'rename', name: 'premium-focus', newName: 'casual-line' });
    expect(renamed).toMatchObject({ ok: true, name: 'casual-line' });

    // start a NEW named path at the fork point
    const fresh = await port.call('viz.paths', { action: 'new', commitId: aId, name: 'experiment' });
    expect(fresh).toMatchObject({ ok: true, name: 'experiment', cursor: aId });
    const finalNames = ((get(await port.call('viz.paths', { action: 'list' }), 'paths')) as { name: string }[]).map((p) => p.name).sort();
    expect(finalNames).toEqual(['casual-line', 'experiment', 'main']);
  });

  it('compare returns the structured diff + per-side row counts, agent-narratable JSON', async () => {
    const session = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(session);
    const a = await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
    const aId = (get(a, 'commit') as { id: string }).id;
    await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] });
    await port.call('viz.fork', { fromCommitId: aId });
    await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', intent: 'premium focus' });

    const cmp = await port.call('viz.compare', { a: 'main', b: 'premium-focus' });
    expect(cmp.ok).toBe(true);
    expect(get(cmp, 'ancestor')).toBe(aId);
    expect((get(cmp, 'changed') as { key: string }[]).map((c) => c.key)).toEqual(['selection:bar']);
    expect((get(cmp, 'onlyA') as { key: string }[]).map((c) => c.key)).toEqual(['selection:scatter']);
    expect(get(cmp, 'a')).toMatchObject({ ref: 'main', rows: 7 });
    expect(get(cmp, 'b')).toMatchObject({ ref: 'premium-focus', rows: 8 });
    // the whole result is plain JSON — an MCP host serializes it as-is
    expect(() => JSON.stringify(cmp)).not.toThrow();
  });

  it('mutations route through the SESSION (typed gaps come back as data); malformed payloads are PAYLOAD_INVALID', async () => {
    const port = vizAsTools(buildDashboard(makeDashboardDef()).createSession());
    await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });

    const ghost = await port.call('viz.paths', { action: 'switch', name: 'ghost' });
    expect(ghost.ok).toBe(false);
    expect((get(ghost, 'gap') as { op: string }).op).toBe('switchPath'); // the session filed it — not the port

    expect((await port.call('viz.paths', { action: 'teleport' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'switch' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'rename', name: 'main' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'new' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'new', commitId: 's1', name: 7 })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.compare', { a: 'main' })).reason).toBe('PAYLOAD_INVALID');

    const badCompare = await port.call('viz.compare', { a: 'main', b: 'ghost' });
    expect(badCompare.ok).toBe(false);
    expect((get(badCompare, 'gap') as { op: string }).op).toBe('compare');
  });
});

describe('Q8 — two-string discipline against a prompt-injection corpus', () => {
  it('a category named "IGNORE PREVIOUS INSTRUCTIONS" stays inert DATA, never the instruction channel', async () => {
    const session = buildDashboard(makeDashboardDef({ rows: INJECTION_ROWS })).createSession();
    const port = vizAsTools(session);

    // The tool descriptors are authored constants — never carry app content.
    expect(JSON.stringify(port.tools())).not.toContain('IGNORE PREVIOUS INSTRUCTIONS');

    // Select the adversarial category AND stamp the injection string as the intent.
    const sel = await port.call('viz.dispatch', {
      verb: 'select',
      viewId: 'bar',
      field: 'category',
      value: INJECTION_CATEGORY,
      intent: INJECTION_CATEGORY,
    });
    expect(sel.ok).toBe(true);
    const commit = get(sel, 'commit') as { value: unknown; cause: { intent?: string } };
    // The hostile string rode as inert DATA (a commit value + an inert cause.intent).
    expect(commit.value).toBe(INJECTION_CATEGORY);
    expect(commit.cause.intent).toBe(INJECTION_CATEGORY);

    // whats_here echoes it ONLY in a structured data field (activeSelections.value)...
    const here = await port.call('viz.whats_here');
    const active = get(here, 'activeSelections') as { field: string; value: unknown }[];
    expect(active).toContainEqual({ viewId: 'bar', field: 'category', kind: 'point', value: INJECTION_CATEGORY });

    // ...never in the column facets (schema only — VALUES are never disclosed here)...
    const columns = get(here, 'columns') as Record<string, unknown>;
    expect(JSON.stringify(columns)).not.toContain('IGNORE PREVIOUS INSTRUCTIONS');

    // ...and the tool descriptors are STILL injection-free after the select.
    expect(JSON.stringify(port.tools())).not.toContain('IGNORE PREVIOUS INSTRUCTIONS');
  });
});
