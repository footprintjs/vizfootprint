/**
 * AN ANSWER NAMES A VIEW THE WAY A PERSON KNOWS IT — `ReachingClause.fromLabel`
 * and the one fallback order behind it (`./layers.ts` · `labelAt`).
 *
 * The sheet says which view's gesture reached these rows. Before this it said
 * `net~nodes` — an internal address, not a name anybody declared for a reader.
 * The session holds the definition, so the session resolves the name once and
 * the answer carries it; a consumer that resolved its own would drift from the
 * receipt's.
 *
 * The order, pinned here end to end: the LAYER's declared label, else the
 * VIEW's, else NOTHING — the key absent, the consumer falling back to the
 * address it already holds, and no name invented.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef, LayerDecl, ViewDecl } from '../def/types.js';
import { EDGES, NETWORK_RELATIONS, NODES, edgesLayer, makeNetworkDef, nodesLayer } from '../def/network.fixture.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { labelAt } from './layers.js';
import type { Cause } from '../cause/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const NODES_ADDRESS = layerAddress('net', 'nodes');
const EDGES_ADDRESS = layerAddress('net', 'edges');
/** Both ways round, so a clause travels from either layer to the other and each side's label can be asked for. */
const BOTH_WAYS = [
  { source: NODES_ADDRESS, kind: 'point' as const, target: EDGES_ADDRESS, response: 'filter' as const },
  { source: EDGES_ADDRESS, kind: 'point' as const, target: NODES_ADDRESS, response: 'filter' as const },
];
const linked = (layers: readonly LayerDecl[], extra: Partial<DashboardDef> = {}) =>
  buildDashboard(makeNetworkDef(layers, { relations: NETWORK_RELATIONS, links: BOTH_WAYS, ...extra })).createSession();
/** `[from, fromLabel]` per reaching clause — `undefined` where the key is absent. */
const named = (clauses: readonly { from: string; fromLabel?: string }[]): unknown[] => clauses.map((c) => [c.from, c.fromLabel]);

describe('ReachingClause.fromLabel — the declared name, or nothing', () => {
  it('a LABELLED LAYER answers with its own label, not its view\'s', async () => {
    const s = linked([nodesLayer, edgesLayer]);
    await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause });
    // the nodes layer declares `label: 'Diseases'`; its view declares 'Disease network' — the layer is the closer name and wins
    expect(named(s.clausesFor(EDGES_ADDRESS))).toEqual([[NODES_ADDRESS, 'Diseases']]);
  });

  it('a layer that declares NO label answers with its VIEW\'s label — never the view\'s label plus a layerId', async () => {
    const s = linked([nodesLayer, edgesLayer]);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause });
    // `edgesLayer` declares none, so the honest name is the thing the person was looking at: the view.
    // 'Disease network~edges' and 'Disease network edges' appear in no declaration and are never manufactured.
    expect(named(s.clausesFor(NODES_ADDRESS))).toEqual([[EDGES_ADDRESS, 'Disease network']]);
  });

  it('NEITHER labelled: the key is ABSENT — the clause answers exactly as it did before the field existed, with no name invented', async () => {
    const bare: LayerDecl = { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'] }; // no label
    const s = linked([bare, edgesLayer], { actors: { net: { actor: 'user' } } }); // …and no view label either
    await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause });
    // (the clause reaches the edges layer TRAVELLED — `edges` has no `group`, and a declared relation joins the tables — which `./via.session.test.ts` pins; the name is this test's point)
    expect(s.clausesFor(EDGES_ADDRESS).map((c) => [c.from, c.response, c.via?.from])).toEqual([[NODES_ADDRESS, 'filter', { kind: 'point', field: 'group', value: 'viral' }]]);
    expect(s.clausesFor(EDGES_ADDRESS).every((c) => !('fromLabel' in c))).toBe(true); // absent, not `undefined` — omit, never invent
  });

  it('a PLAIN view (no layers) with a label answers with it, on the per-view window AND on the whole-dashboard one', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    expect(named(s.clausesFor('scatter'))).toEqual([['bar', 'Category']]);
    // the no-view window builds its list in the OTHER place (`viewClauses`) and passes through the same filler
    const whole = await s.viewQuery();
    expect(whole.ok && named(whole.clauses)).toEqual([['bar', 'Category']]);
    const scatter = await s.viewQuery({ viewId: 'scatter' });
    expect(scatter.ok && named(scatter.clauses)).toEqual([['bar', 'Category']]);
  });

  it('an address the map does not answer — an unknown view, or a layer this def no longer declares — has no label and does not throw', () => {
    const views = new Map<string, ViewDecl>([['net', { viewId: 'net', meta: { actor: 'user', label: 'Disease network' }, layers: [nodesLayer] }]]);
    expect(labelAt(views, NODES_ADDRESS)).toBe('Diseases');
    expect(labelAt(views, 'net')).toBe('Disease network');
    expect(labelAt(views, EDGES_ADDRESS)).toBeUndefined(); // the view is here; this layer is not
    expect(labelAt(views, 'gone')).toBeUndefined(); // no such view at all
    expect(labelAt(new Map(), NODES_ADDRESS)).toBeUndefined();
  });

  it('a BLANK declared label is not a name — it falls through exactly as an absent one does', () => {
    const blankLayer: LayerDecl = { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y'], label: '   ' };
    // the layer's label is whitespace-only: falls through to the VIEW's, same as declaring none
    const withViewLabel = new Map<string, ViewDecl>([['net', { viewId: 'net', meta: { actor: 'user', label: 'Disease network' }, layers: [blankLayer] }]]);
    expect(labelAt(withViewLabel, NODES_ADDRESS)).toBe('Disease network');
    // the layer's is blank AND the view's is '' — nothing to fall through TO: absent, not the blank string
    const bothBlank = new Map<string, ViewDecl>([['net', { viewId: 'net', meta: { actor: 'user', label: '' }, layers: [blankLayer] }]]);
    expect(labelAt(bothBlank, NODES_ADDRESS)).toBeUndefined();
    // a bare view (no layers) whose own label is whitespace-only: no third rung, so nothing
    const blankView = new Map<string, ViewDecl>([['net', { viewId: 'net', meta: { actor: 'user', label: '  ' } }]]);
    expect(labelAt(blankView, 'net')).toBeUndefined();
  });

  it('the label rides the window the SHEET reads, beside the travel that makes it a sentence', async () => {
    const s = linked([nodesLayer, edgesLayer]);
    // `group` is a nodes column; the edges table has no such column, so this clause reaches the edges window through the
    // first declared relation (`edges.source → nodes.id`, labelled) as `source IN {flu, cold}` — both edges start at a viral node
    await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause });
    const q = await s.viewQuery({ viewId: EDGES_ADDRESS });
    expect(q.ok && [q.count, q.clauses.map((c) => [c.fromLabel, c.narrowed, c.via?.label])]).toEqual([EDGES.length, [['Diseases', undefined, 'one end of the tie']]]);
    // and the nodes window, whose own clause never reaches it, is unfiltered by nobody
    const own = await s.viewQuery({ viewId: NODES_ADDRESS });
    expect(own.ok && [own.count, own.clauses]).toEqual([NODES.length, []]);
  });
});
