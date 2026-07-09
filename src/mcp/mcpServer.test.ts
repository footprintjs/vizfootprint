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
  it('tools/list returns the FIXED six semantic tools', async () => {
    const client = await connectClient(freshSession());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'viz.whats_here',
      'viz.dispatch',
      'viz.declare_analysis',
      'viz.why',
      'viz.fork',
      'viz.checkpoint',
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

  it('why over MCP comes back as a typed not-implemented marker (not isError)', async () => {
    const client = await connectClient(freshSession());
    const res = await client.callTool({ name: 'viz.why', arguments: { target: 'rowCount' } });
    expect(res.isError).toBeFalsy();
    expect(text(res)['owner']).toBe('L6');
  });

  it('an unknown tool comes back as isError, never a crash', async () => {
    const client = await connectClient(freshSession());
    const res = await client.callTool({ name: 'viz.push_dom_event', arguments: {} });
    expect(res.isError).toBe(true);
  });
});
