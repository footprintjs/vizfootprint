/**
 * TL-1 acceptance (agent tier) — the `paths` tool grows the four LIFECYCLE
 * actions: archive / restore / discard / adopt, plus `list` with
 * `includeArchived`.
 *
 * What these pin:
 *   1. an agent can tidy its own dead ends through the FIXED tool array — the
 *      tool list bytes never change (Mode B), only the schema's action enum;
 *   2. the descriptions and the result `note` teach the honesty rule verbatim
 *      ("Hidden, not erased — the statistics remember."), and no runtime data
 *      is ever interpolated into an instruction string (Q8);
 *   3. every rejection comes back as DATA: a session-filed typed gap, or a
 *      PAYLOAD_INVALID for a malformed call — never a throw;
 *   4. whats_here reports the archived COUNT, so the agent can see dead ends
 *      exist without listing them;
 *   5. MCP parity — the same actions over a real MCP client, same results.
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildDashboard, vizAsTools, HIDDEN_NOT_ERASED } from './index.js';
import { mcpServer } from '../mcp/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { InteractionSession } from '../session/index.js';
import type { VizToolResult, VizToolsPort } from './index.js';

function get(result: VizToolResult, key: string): unknown {
  return (result as Record<string, unknown>)[key];
}

function freshSession(): InteractionSession {
  return buildDashboard(makeDashboardDef()).createSession();
}

/** main (a → b) plus a sibling "premium-focus" forked at a. Leaves the port on the sibling. */
async function twoPaths(port: VizToolsPort): Promise<{ aId: string; bId: string }> {
  const a = await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' });
  const aId = (get(a, 'commit') as { id: string }).id;
  const b = await port.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] });
  const bId = (get(b, 'commit') as { id: string }).id;
  await port.call('viz.fork', { fromCommitId: aId });
  await port.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', intent: 'premium focus' });
  return { aId, bId };
}

describe('TL-1 agent surface — the paths tool tidies dead ends without erasing them', () => {
  it('archive hides a path from list, includeArchived reveals it flagged, restore brings it back', async () => {
    const port = vizAsTools(freshSession());
    await twoPaths(port);

    const archived = await port.call('viz.paths', { action: 'archive', name: 'main' });
    expect(archived).toMatchObject({ ok: true, name: 'main', detached: false, note: HIDDEN_NOT_ERASED });

    const listed = await port.call('viz.paths', { action: 'list' });
    expect((get(listed, 'paths') as { name: string }[]).map((p) => p.name)).toEqual(['premium-focus']);
    expect(get(listed, 'archived')).toBe(1);

    const all = await port.call('viz.paths', { action: 'list', includeArchived: true });
    expect((get(all, 'paths') as { name: string; archived?: true }[]).find((p) => p.name === 'main')?.archived).toBe(true);

    const restored = await port.call('viz.paths', { action: 'restore', name: 'main' });
    expect(restored).toMatchObject({ ok: true, name: 'main' });
    expect(get(await port.call('viz.paths', { action: 'list' }), 'archived')).toBe(0);
  });

  it('whats_here reports the archived count without listing them', async () => {
    const port = vizAsTools(freshSession());
    await twoPaths(port);
    await port.call('viz.paths', { action: 'archive', name: 'main' });

    const paths = get(await port.call('viz.whats_here'), 'paths') as { archived: number; list: { name: string }[] };
    expect(paths.archived).toBe(1);
    expect(paths.list.map((p) => p.name)).toEqual(['premium-focus']);
  });

  it('discard rewinds the path and keeps the abandoned future as an archived path', async () => {
    const port = vizAsTools(freshSession());
    const { aId, bId } = await twoPaths(port);
    await port.call('viz.paths', { action: 'switch', name: 'main' });

    const res = await port.call('viz.paths', { action: 'discard', commitId: aId });
    expect(res).toMatchObject({ ok: true, path: 'main', at: aId, keptTip: bId, steps: 1, note: HIDDEN_NOT_ERASED });

    const all = get(await port.call('viz.paths', { action: 'list', includeArchived: true }), 'paths') as {
      name: string;
      tip: string;
      archived?: true;
    }[];
    expect(all.find((p) => p.name === get(res, 'kept'))).toMatchObject({ tip: bId, archived: true });
    // omitting commitId discards from the CURSOR — which is now the rewound tip, so honestly nothing to do
    const atTip = await port.call('viz.paths', { action: 'discard' });
    expect(atTip.ok).toBe(false);
    expect((get(atTip, 'gap') as { op: string }).op).toBe('discardFromHere');
  });

  it('adopt replays another path\'s steps here, reporting applied / skipped / conflicts', async () => {
    const session = freshSession();
    const port = vizAsTools(session);
    const { aId } = await twoPaths(port); // on premium-focus (a → Casual)
    await port.call('viz.paths', { action: 'switch', name: 'main' });

    const res = await port.call('viz.paths', { action: 'adopt', name: 'premium-focus' });
    expect(res).toMatchObject({ ok: true, path: 'premium-focus', ancestor: aId, applied: 1, skipped: 0 });
    // main's own step touched a DIFFERENT view, so there is honestly no conflict here
    expect(get(res, 'conflicts')).toEqual([]);
    const step = (get(res, 'steps') as { commitId: string; landedAs: string }[])[0]!;
    expect(session.log.records.find((r) => r.id === step.landedAs)?.cause.replayedFrom).toBe(step.commitId);
    // the source path is untouched, and the whole result is plain JSON an MCP host can serialize
    expect((get(await port.call('viz.paths', { action: 'list' }), 'paths') as { name: string }[]).map((p) => p.name).sort()).toEqual([
      'main',
      'premium-focus',
    ]);
    expect(() => JSON.stringify(res)).not.toThrow();
  });

  it('every lifecycle rejection is DATA — a session gap or PAYLOAD_INVALID, never a throw', async () => {
    const port = vizAsTools(freshSession());
    await twoPaths(port);

    const ghost = await port.call('viz.paths', { action: 'archive', name: 'ghost' });
    expect(ghost.ok).toBe(false);
    expect((get(ghost, 'gap') as { op: string }).op).toBe('archivePath'); // the SESSION filed it, not the port
    const notArchived = await port.call('viz.paths', { action: 'restore', name: 'main' });
    expect((get(notArchived, 'gap') as { op: string }).op).toBe('restorePath');
    const self = await port.call('viz.paths', { action: 'adopt', name: 'premium-focus' });
    expect((get(self, 'gap') as { op: string }).op).toBe('adoptPath');

    expect((await port.call('viz.paths', { action: 'archive' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'restore' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'adopt' })).reason).toBe('PAYLOAD_INVALID');
    expect((await port.call('viz.paths', { action: 'discard', commitId: 7 })).reason).toBe('PAYLOAD_INVALID');
    const bogus = await port.call('viz.paths', { action: 'vanish' });
    expect(bogus.reason).toBe('PAYLOAD_INVALID');
    expect(get(bogus, 'detail')).toContain('archive|restore|discard|adopt');
  });

  it('the tool ARRAY is byte-identical across the lifecycle (Mode B: no list_changed churn)', async () => {
    const port = vizAsTools(freshSession());
    const before = JSON.stringify(port.tools());
    await twoPaths(port);
    await port.call('viz.paths', { action: 'archive', name: 'main' });
    expect(JSON.stringify(port.tools())).toBe(before);
  });

  it('the schema + description teach the lifecycle honestly, with no runtime data interpolated (Q8)', () => {
    const tool = vizAsTools(freshSession()).tools().find((t) => t.name === 'viz.paths')!;
    const action = (tool.inputSchema['properties'] as Record<string, { enum?: string[] }>)['action']!;
    expect(action.enum).toEqual(['list', 'switch', 'rename', 'new', 'archive', 'restore', 'discard', 'adopt']);
    expect(tool.description).toContain('hidden is not erased');
    expect(tool.description).toContain('never refunds alpha');
    // the description is an authored constant: no commit id, path name, or column value can reach it
    expect(tool.description).not.toMatch(/\bs\d+\b/);
  });
});

describe('TL-1 MCP parity — the same lifecycle over a real MCP client', () => {
  it('archive / list(includeArchived) / discard / adopt behave identically through tools/call', async () => {
    const session = freshSession();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await mcpServer(session).connect(serverT);
    const client = new Client({ name: 'test-host', version: '0.0.0' });
    await client.connect(clientT);
    const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await client.callTool({ name: 'viz.paths', arguments: args });
      return JSON.parse(((res as { content: { text: string }[] }).content[0]!).text) as Record<string, unknown>;
    };

    // the same two-path setup, driven over MCP
    const a = await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal' } });
    const aId = (JSON.parse(((a as { content: { text: string }[] }).content[0]!).text).commit as { id: string }).id;
    await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130] } });
    await client.callTool({ name: 'viz.fork', arguments: { fromCommitId: aId } });
    await client.callTool({ name: 'viz.dispatch', arguments: { verb: 'select', viewId: 'bar', field: 'category', value: 'Casual', intent: 'premium focus' } });

    expect(await call({ action: 'archive', name: 'premium-focus' })).toMatchObject({ ok: true, detached: true, note: HIDDEN_NOT_ERASED });
    expect((await call({ action: 'list' }))['archived']).toBe(1);
    expect(await call({ action: 'restore', name: 'premium-focus' })).toMatchObject({ ok: true });

    await call({ action: 'switch', name: 'main' });
    expect(await call({ action: 'discard', commitId: aId })).toMatchObject({ ok: true, path: 'main', note: HIDDEN_NOT_ERASED });
    expect(await call({ action: 'adopt', name: 'premium-focus' })).toMatchObject({ ok: true, applied: 1 });
    // nothing was erased: the three authored steps are all still in the log,
    // discarded price filter included, plus the one the adopt replayed.
    expect(session.log.records.map((r) => r.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(session.paths({ includeArchived: true }).some((p) => p.tip === 's2' && p.archived === true)).toBe(true);
  });
});
