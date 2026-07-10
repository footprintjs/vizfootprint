/**
 * mcpServer.coverage.test.ts — closes the remaining gaps in mcpServer.ts: the
 * `args ?? {}` nullish default when a client omits `arguments` entirely, and
 * the genuinely-unexpected-throw branch (never a domain rejection — those are
 * typed `{ok:false}` results the port always returns; a THROW can only reach
 * this handler from something outside the port's own typed surface, e.g. a
 * caller-supplied `ViewAdapter.applyClause` blowing up while the session hands
 * it a resolved clause — session.ts:585 calls it with no try/catch of its own).
 */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildDashboard } from '../agent/index.js';
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

const text = (res: unknown) =>
  JSON.parse(((res as { content: { type: string; text: string }[] }).content[0]!).text) as Record<string, unknown>;

describe('mcpServer — args ?? {} nullish default (a client that omits `arguments` entirely)', () => {
  it('tools/call with no arguments field still reaches the port with an empty object', async () => {
    const client = await connectClient(freshSession());
    // No `arguments` key at all — request.params.arguments is undefined on the wire.
    const res = await client.callTool({ name: 'viz.whats_here' });
    expect(res.isError).toBeFalsy();
    const payload = text(res);
    expect(payload['ok']).toBe(true);
    expect(payload['defaultTable']).toBe('data');
  });
});

describe('mcpServer — an unexpected throw (not a domain rejection) is caught and reported as isError', () => {
  it('a mounted ViewAdapter that throws in applyClause surfaces as a caught, non-crashing isError', async () => {
    const session = freshSession();
    const mounted = session.mountView('bar', {
      capabilities: { canProbe: true },
      applyClause: () => {
        throw new Error('adapter boom');
      },
    });
    expect(mounted.ok).toBe(true);

    const client = await connectClient(session);
    const res = await client.callTool({
      name: 'viz.dispatch',
      arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' },
    });
    expect(res.isError).toBe(true);
    const payload = res as { content: { type: string; text: string }[] };
    expect(payload.content[0]!.text).toBe("vizfootprint: tool 'viz.dispatch' failed: Error: adapter boom");
  });
});
