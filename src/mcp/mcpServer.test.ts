/**
 * The dogfood proof: vizfootprint/mcp really is an MCP server. A genuine MCP
 * Client (from @modelcontextprotocol/sdk) connects over an in-memory transport
 * and drives the live session — tools/list + tools/call — with zero
 * framework-specific glue, exposing the SAME verb set as `vizAsTools` (family
 * dual-surface parity).
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildDashboard, vizAsTools } from '../agent/index.js';
import { mcpServer } from './index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { InteractionSession } from '../session/index.js';

function freshSession(): InteractionSession {
  return buildDashboard(makeDashboardDef()).createSession();
}

async function connectClient(session: InteractionSession) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = mcpServer(session);
  await server.connect(serverT);
  const client = new Client({ name: 'test-host', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

// The SDK's CallToolResult is a union; narrow to the text-content arm.
const text = (res: unknown) =>
  JSON.parse(((res as { content: { type: string; text: string }[] }).content[0]!).text) as Record<string, unknown>;

describe('mcpServer — a real MCP server backed by a live session', () => {
  it('tools/list returns the FIXED nine semantic tools', async () => {
    const client = await connectClient(freshSession());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'viz.whats_here',
      'viz.dispatch',
      'viz.declare_analysis',
      'viz.why',
      'viz.fork',
      'viz.checkpoint',
      'viz.paths',
      'viz.compare',
      'viz.propose_chart',
    ]);
  });

  it('MCP tool set is IDENTICAL to vizAsTools (family dual-surface parity)', async () => {
    const session = freshSession();
    const portNames = vizAsTools(session).tools().map((t) => t.name);
    const client = await connectClient(freshSession());
    const mcpNames = (await client.listTools()).tools.map((t) => t.name);
    expect(mcpNames).toEqual(portNames);
  });

  it('tools/call routes to the session — dispatch a select, get the commit back as data', async () => {
    const client = await connectClient(freshSession());
    const res = await client.callTool({
      name: 'viz.dispatch',
      arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' },
    });
    const payload = text(res);
    expect(payload['ok']).toBe(true);
    expect((payload['commit'] as { value: unknown }).value).toBe('Formal');
  });

  it('drives the full R4 task over MCP — cluster + correlation, ledger read back', async () => {
    const client = await connectClient(freshSession());
    await client.callTool({ name: 'viz.declare_analysis', arguments: { analysisId: 'clustering' } });
    await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'select', viewId: 'cluster', field: 'cluster_id', value: 2 } });
    await client.callTool({ name: 'viz.declare_analysis', arguments: { analysisId: 'correlation' } });
    const here = text(await client.callTool({ name: 'viz.whats_here', arguments: {} }));
    expect((here['fdr'] as { tests: number }).tests).toBe(1);
  });

  it('the tool array is byte-identical across calls (cache-stable, no list_changed)', async () => {
    const session = freshSession();
    const client = await connectClient(session);
    const before = JSON.stringify((await client.listTools()).tools);
    await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Work' } });
    const after = JSON.stringify((await client.listTools()).tools);
    expect(after).toBe(before);
  });

  it('why over MCP comes back as a machine-shaped cross-tier result (not isError)', async () => {
    const client = await connectClient(freshSession());
    // An unknown column on a fresh session is a TYPED miss — a normal result the
    // model reads, never an isError crash, and never a fabricated slice.
    const res = await client.callTool({ name: 'viz.why', arguments: { target: 'rowCount' } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toEqual({ ok: false, missing: 'no-such-target', target: { kind: 'column', column: 'rowCount' } });
  });

  it('why over MCP returns a threaded slice once an analysis has materialized the column', async () => {
    const client = await connectClient(freshSession());
    await client.callTool({ name: 'viz.declare_analysis', arguments: { analysisId: 'clustering' } });
    const res = await client.callTool({ name: 'viz.why', arguments: { target: 'cluster_id' } });
    expect(res.isError).toBeFalsy();
    const slice = text(res);
    expect(slice['ok']).toBe(true);
    expect(slice['targetKind']).toBe('column');
    // machine-shaped: a flat {tier,id,kind} commit array, no prose.
    expect(Array.isArray(slice['commits'])).toBe(true);
  });

  it('routes paths + compare (BR-1) — branch by name over MCP, then read the structured diff', async () => {
    const client = await connectClient(freshSession());
    const a = text(await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' } }));
    const aId = (a['commit'] as { id: string }).id;
    await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] } });
    await client.callTool({ name: 'viz.fork', arguments: { fromCommitId: aId } });
    await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', intent: 'premium focus' } });

    const listed = text(await client.callTool({ name: 'viz.paths', arguments: { action: 'list' } }));
    expect(listed['current']).toBe('premium-focus');
    expect((listed['paths'] as { name: string }[]).map((p) => p.name).sort()).toEqual(['main', 'premium-focus']);

    const switched = text(await client.callTool({ name: 'viz.paths', arguments: { action: 'switch', name: 'main' } }));
    expect(switched['ok']).toBe(true);

    const cmp = text(await client.callTool({ name: 'viz.compare', arguments: { a: 'main', b: 'premium-focus' } }));
    expect(cmp['ok']).toBe(true);
    expect(cmp['ancestor']).toBe(aId);
    expect((cmp['changed'] as { key: string }[]).map((c) => c.key)).toEqual(['selection:bar']);
    expect((cmp['a'] as { rows: number }).rows).toBe(7);
    expect((cmp['b'] as { rows: number }).rows).toBe(8);

    // whats_here surfaces the current path over MCP too
    const here = text(await client.callTool({ name: 'viz.whats_here', arguments: {} }));
    expect((here['paths'] as { current: string }).current).toBe('main');
  });

  it('an unknown tool comes back as isError, never a crash', async () => {
    const client = await connectClient(freshSession());
    const res = await client.callTool({ name: 'viz.push_dom_event', arguments: {} });
    expect(res.isError).toBe(true);
  });

  it('routes propose_chart (RP-3) — a valid chart is ledgered; a transform spec comes back as a NORMAL gap, not isError', async () => {
    const client = await connectClient(freshSession());
    const spec = {
      mark: { type: 'circle' },
      params: [{ name: 'b', select: { type: 'interval', encodings: ['x'] } }],
      encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } },
    };
    const ok = await client.callTool({ name: 'viz.propose_chart', arguments: { id: 'pr', spec, rationale: 'price vs rating' } });
    expect(ok.isError).toBeFalsy();
    const okPayload = text(ok);
    expect(okPayload['ok']).toBe(true);
    expect(okPayload['chartId']).toBe('pr');
    expect(okPayload['ledgered']).toBe(true);

    // whats_here surfaces the chart over MCP
    const here = text(await client.callTool({ name: 'viz.whats_here', arguments: {} }));
    expect((here['charts'] as unknown[]).length).toBe(1);

    // a transform-carrying spec is a typed gap the model reads — a normal result, never isError.
    const bad = await client.callTool({
      name: 'viz.propose_chart',
      arguments: { id: 'agg', spec: { ...spec, transform: [{ aggregate: [] }] } },
    });
    expect(bad.isError).toBeFalsy();
    const badPayload = text(bad);
    expect(badPayload['ok']).toBe(false);
    expect((badPayload['gap'] as { code: string }).code).toBe('chart-transforms-not-owned');
  });
});
