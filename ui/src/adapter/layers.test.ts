// @vitest-environment node
/**
 * Layers on the adapter (protocol 1.2): `ViewView.layers` is PROJECTED from
 * `overview.views[].layers` (Law 1 — the key stays absent where the wire
 * carries none), the poll mapper drops what is malformed without inventing,
 * and `layerRowsFor` is the ONE door for a layer's rows — the session
 * resolves the table from the address, the host never spells it.
 */
import { describe, it, expect } from 'vitest';
import { layerAddress } from 'vizfootprint/def';
import { mapPollState, type RawPollState } from './sessionView.js';
import { layerRowsFor } from './layerRows.js';
import { buildNetworkFixture, EDGES, NODES } from './network.fixture.js';
import { buildDashboard } from 'vizfootprint/agent';
import { createSessionView, sessionSource } from './sessionView.js';

describe('ViewView.layers — projected, never derived', () => {
  it('over a REAL two-table session the view carries its two layers, each with ITS table, in declared order', async () => {
    const { view } = await buildNetworkFixture();
    const net = view.getState().views.find((v) => v.viewId === 'net')!;
    expect(net.layers).toEqual([
      { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], label: 'Diseases' },
      { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'] },
    ]);
  });

  it('a plain view has NO layers key — byte-identical to the adapter before layers existed', async () => {
    const dashboard = buildDashboard({
      meta: { title: 'plain' },
      data: { data: { rows: [{ a: 1 }] } },
      actors: { bar: { actor: 'user' } },
      encodings: [{ viewId: 'bar', chartKind: 'bar', channels: ['category'], initial: { category: 'a' } }],
      defaultTable: 'data',
    });
    const view = createSessionView(sessionSource(dashboard.createSession({ as: 'user' })), { as: 'user' });
    await view.refresh();
    const bar = view.getState().views[0]!;
    expect('layers' in bar).toBe(false);
    expect(JSON.stringify(view.getState().views)).not.toContain('layers');
  });

  it('the poll mapper keeps well-formed layers, drops malformed rows, and never invents a list', () => {
    const raw = {
      records: [],
      views: [
        {
          viewId: 'net',
          actor: 'user',
          layers: [
            { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 7, 'y'], label: 'Diseases' },
            { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x'], label: 3 },
            { layerId: 'ghost', chartKind: 'line', channels: [] }, // no table — not a layer
            { layerId: 'bad', table: 'edges', chartKind: 'line', channels: 'x' },
            'nonsense',
            null,
          ],
        },
        { viewId: 'odd', actor: 'user', layers: 'not a list' },
        { viewId: 'plain', actor: 'user' },
      ],
      cursor: null,
      head: null,
    } as unknown as RawPollState;
    const state = mapPollState(raw);
    expect(state.views.find((v) => v.viewId === 'net')!.layers).toEqual([
      { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'], label: 'Diseases' },
      { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x'] },
    ]);
    expect(state.views.find((v) => v.viewId === 'odd')!.layers).toEqual([]);
    expect('layers' in state.views.find((v) => v.viewId === 'plain')!).toBe(false);
  });

  it("the poll mapper keeps a resolution that names one of the two MODES and drops the rest — a dropped one lands on the library's own default", () => {
    const raw = {
      records: [],
      views: [
        {
          viewId: 'net',
          actor: 'user',
          frame: {
            x: { mode: 'shared', basis: 'table' },
            color: { mode: 'independent', guide: 'per-layer' },
            y: { mode: 'fixed' }, // not one of the two words — dropped, so `y` takes the shared default
            size: 'shared',
            r: null,
          },
        },
        { viewId: 'odd', actor: 'user', frame: 'shared' },
        { viewId: 'listy', actor: 'user', frame: [] },
        { viewId: 'nulled', actor: 'user', frame: null },
        { viewId: 'plain', actor: 'user' },
      ],
      cursor: null,
      head: null,
    } as unknown as RawPollState;
    const state = mapPollState(raw);
    expect(state.views.find((v) => v.viewId === 'net')!.frame).toEqual({ x: { mode: 'shared', basis: 'table' }, color: { mode: 'independent', guide: 'per-layer' } });
    for (const viewId of ['odd', 'listy', 'nulled']) expect(state.views.find((v) => v.viewId === viewId)!.frame).toEqual({});
    // and a view the wire says nothing about carries no key at all
    expect('frame' in state.views.find((v) => v.viewId === 'plain')!).toBe(false);
  });
});

describe('layerRowsFor — the one door for a layer\'s rows', () => {
  it('answers the edges layer from ITS table under its address — no table spelled by the host', async () => {
    const { session } = await buildNetworkFixture();
    const edges = await layerRowsFor(session, layerAddress('net', 'edges'));
    expect(edges.ok && [edges.columns, edges.rows, edges.count]).toEqual([['source', 'target', 'weight'], EDGES, EDGES.length]);
    const nodes = await layerRowsFor(session, layerAddress('net', 'nodes'), { columns: ['group'], limit: 2 });
    expect(nodes.ok && [nodes.columns, nodes.key, nodes.rows.length, nodes.count]).toEqual([['group', 'id'], 'id', 2, NODES.length]);
  });

  it('a layer the map does not declare comes back as the session\'s own refusal', async () => {
    const { session } = await buildNetworkFixture();
    const ghost = await layerRowsFor(session, layerAddress('net', 'ghost'));
    expect(ghost.ok === false && ghost.reason).toBe('unknown-view');
  });

  it('the window rides through and only the clauses reaching the layer narrow it', async () => {
    const { session, view } = await buildNetworkFixture();
    await view.emit(layerAddress('net', 'edges'), { rawValue: 5, encoding: { kind: 'point', field: 'weight' } });
    // the edges layer's OWN clause does not narrow its own rows; the nodes are a sibling with no default edge — untouched
    const edges = await layerRowsFor(session, layerAddress('net', 'edges'));
    expect(edges.ok && [edges.count, edges.clauses]).toEqual([EDGES.length, []]);
    const nodes = await layerRowsFor(session, layerAddress('net', 'nodes'), { offset: 1 });
    expect(nodes.ok && [nodes.count, nodes.start, nodes.rows.length, nodes.clauses]).toEqual([NODES.length, 1, NODES.length - 1, []]);
    // a synchronous fake serves too — the door is structural
    const sync = await layerRowsFor({ viewQuery: () => ({ ok: false as const, reason: 'engine' as const, rejected: 'no' }) }, 'x');
    expect(sync).toEqual({ ok: false, reason: 'engine', rejected: 'no' });
  });
});
