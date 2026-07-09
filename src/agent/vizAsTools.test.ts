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

const TOOL_NAMES = ['viz.whats_here', 'viz.dispatch', 'viz.declare_analysis', 'viz.why', 'viz.fork', 'viz.checkpoint'];

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
  it('exposes exactly the six fixed semantic tools; none pushes a raw event', () => {
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
