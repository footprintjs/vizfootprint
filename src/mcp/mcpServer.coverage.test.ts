/**
 * mcpServer.coverage.test.ts — closes the remaining gaps in mcpServer.ts: the
 * `args ?? {}` nullish default when a client omits `arguments` entirely, and
 * the genuinely-unexpected-throw branch (never a domain rejection — those are
 * typed `{ok:false}` results the port always returns; a THROW can only reach
 * this handler from something outside the port's own typed surface, e.g. the
 * host-installed `log.stampData` hook — which the session calls while JUDGING a
 * commit, before anything has moved — blowing up).
 *
 * It used to be a mounted `ViewAdapter.applyClause` that threw here. That is no
 * longer a throw at all: adapter notification is an OUTBOUND effect now, filed
 * as an `effect-failed` gap so a bad renderer cannot fail an act that happened
 * (src/session/README.md, the all-or-nothing law).
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
  it('a host hook that blows up while a commit is judged surfaces as a caught, non-crashing isError', async () => {
    const session = freshSession();
    session.log.stampData = () => {
      throw new Error('adapter boom');
    };

    const client = await connectClient(session);
    const res = await client.callTool({
      name: 'viz.dispatch',
      arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' },
    });
    expect(res.isError).toBe(true);
    const payload = res as { content: { type: string; text: string }[] };
    expect(payload.content[0]!.text).toBe("vizfootprint: tool 'viz.dispatch' failed: Error: adapter boom");
    expect(session.log.records).toHaveLength(0); // and the act did not half-happen
  });

  it('a mounted adapter that throws is NOT an error here — the act happened, so the tool answers ok', async () => {
    const session = freshSession();
    session.mountView('bar', {
      capabilities: { canProbe: true },
      applyClause: () => {
        throw new Error('adapter boom');
      },
    });

    const client = await connectClient(session);
    const res = await client.callTool({
      name: 'viz.dispatch',
      arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' },
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)['ok']).toBe(true);
    expect(session.log.records).toHaveLength(1);
    expect(session.gaps().at(-1)).toMatchObject({ code: 'effect-failed', target: 'bar' });
  });
});
