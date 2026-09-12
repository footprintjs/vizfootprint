/**
 * Layers in the session: a layer address (`viewId~layerId`) is a viewId
 * everywhere a viewId is accepted, and an act on it is gated on the LAYER's
 * table — a select on `net~edges` lands one commit under that address as its
 * own source, a select on `net~nodes` is judged against the nodes columns, a
 * column of the wrong table is refused in a sentence, sibling layers get no
 * default edge while a declared link routes, `viewQuery` on an address
 * defaults to the layer's table (and refuses one that disagrees), a layer's
 * prose is written and judged against the layer's own surface and table, the
 * overview projects `views[].layers`, and a dashboard with no layers is
 * byte-identical to before layers existed.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, LAYER_MARKER, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { EDGES, NETWORK_RELATIONS, NODES, edgesLayer, makeNetworkDef, nodesLayer } from '../def/network.fixture.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { RESERVED_ID_MARKER } from './namespaces.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = (extra: Partial<DashboardDef> = {}) => buildDashboard(makeNetworkDef(undefined, extra)).createSession();
const NODES_ADDRESS = layerAddress('net', 'nodes');
const EDGES_ADDRESS = layerAddress('net', 'edges');
/**
 * RE-PINNED (the frame is its layers, ../def/README.md "Layers", law 6a): `net`
 * declares layers and NO view-level `initial`, so it is a FRAME — its own
 * address reads no rows and a gesture there is refused by name. The fact these
 * tests used to pin at `net` ("the view itself is still gated on the default
 * table") holds for a layered view that BINDS something of its own, so it is
 * pinned on this def, where `net` carries a view-level `initial`.
 */
const withOwnBinding = () => buildDashboard(makeNetworkDef(undefined, { encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], initial: { x: 'size' }, layers: [nodesLayer, edgesLayer] }] })).createSession();
const FRAME_REFUSAL = `view "net" reads only through its layers — a gesture lands under one of them: ${NODES_ADDRESS}, ${EDGES_ADDRESS}`;

describe('layers — an address is a viewId, gated on the layer table', () => {
  it('a select on the edges layer lands ONE commit under the address, as the layer own source; the nodes count ignores it', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause: userCause('the strong tie'), correlationId: 'turn-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit).toMatchObject({ viewId: EDGES_ADDRESS, field: 'weight', value: 5, actorMeta: { actor: 'user', label: 'edges' }, correlationId: 'turn-1' });
    expect(s.log.records).toHaveLength(1);
    const o = await s.overview();
    expect(o.activeSelections.map((a) => a.viewId)).toEqual([EDGES_ADDRESS]);
    expect(o.selectedRowCount).toBe(NODES.length); // a clause on the edges table is not the nodes count's
    expect(await s.selectedRows('nodes')).toHaveLength(NODES.length);
    expect(await s.selectedRows('edges')).toEqual([EDGES[0]]);
    // a second act on the same layer re-registers the same source — the meta is a pure function of the map
    const again = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 1, cause: userCause() });
    expect(again.ok && again.commit?.actorMeta).toEqual({ actor: 'user', label: 'edges' });
    // the nodes layer carries its declared label
    const nodes = await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    expect(nodes.ok && nodes.commit?.actorMeta).toEqual({ actor: 'user', label: 'Diseases' });
    expect((await s.overview()).selectedRowCount).toBe(2);
  });

  it('a layer\'s clause on another table does not narrow an analysis over the default table — an analysis reads its own table under the clauses that reach it', async () => {
    const s = fresh();
    const pick = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause: userCause('the strong tie') });
    expect(pick.ok).toBe(true);
    // a groupBy over nodes: every node is still there, so both groups are — the edges clause names a column nodes has not
    const res = await s.dispatch({ verb: 'analyze', analysisId: 'byGroup', def: { builtin: 'groupBy', by: 'group', measure: 'size' }, cause: userCause('by group') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.analysis?.result.ok).toBe(true);
    expect(res.analysis?.result.ok && res.analysis.result.output.as === 'table' && res.analysis.result.output.rows.map((r) => r['group']).sort()).toEqual(['bacterial', 'viral']);
  });

  it('a select on the nodes layer is judged against the nodes columns; a column of the wrong table is refused in a sentence', async () => {
    const s = fresh();
    const wrong = await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'weight', value: 5, cause: userCause() });
    expect(wrong.ok).toBe(false);
    expect(JSON.stringify(wrong)).toMatch(/needs-column/);
    expect(JSON.stringify(wrong)).toContain('no column \\"weight\\" in table \\"nodes\\"');
    const wrongEdge = await s.dispatch({ verb: 'filter', viewId: EDGES_ADDRESS, field: 'size', range: [0, 10], cause: userCause() });
    expect(JSON.stringify(wrongEdge)).toContain('no column \\"size\\" in table \\"edges\\"');
    const cell = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, fields: ['source', 'group'], values: ['flu', 'viral'], cause: userCause() });
    expect(JSON.stringify(cell)).toContain('no column \\"group\\" in table \\"edges\\"');
    const ghost = await s.dispatch({ verb: 'select', viewId: layerAddress('net', 'ghost'), field: 'weight', value: 5, cause: userCause() });
    expect(JSON.stringify(ghost)).toMatch(/needs-view/);
    expect(s.log.records).toHaveLength(0);
    // the view's own address is a FRAME here (no view-level `initial`): a gesture at it is refused by name, naming its layers (law 6a)
    const atFrame = await s.dispatch({ verb: 'select', viewId: 'net', field: 'group', value: 'viral', cause: userCause() });
    expect(atFrame).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: FRAME_REFUSAL } });
    expect(s.log.records).toHaveLength(0);
    // …and a layered view that BINDS something of its own is still gated on the default table at its own address, as before
    const view = await withOwnBinding().dispatch({ verb: 'select', viewId: 'net', field: 'group', value: 'viral', cause: userCause() });
    expect(view.ok && view.commit?.actorMeta).toEqual({ actor: 'user', label: 'Disease network' });
    const okCell = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, fields: ['source', 'target'], values: ['flu', 'cold'], cause: userCause() });
    expect(okCell.ok && okCell.commit?.viewId).toBe(EDGES_ADDRESS);
  });

  it('sibling layers get no default edge; a declared link between them routes', async () => {
    const silent = fresh();
    await silent.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    expect(silent.clausesFor(EDGES_ADDRESS)).toEqual([]);
    expect(silent.clausesFor('net')).toEqual([]);
    expect((await silent.overview()).links.edges).toEqual([]);
    // REVIEW OF PACKET N: the runtime `link` verb now gets the same reach-law
    // door a DECLARED edge gets (`InteractionSessionImpl.doLink`, a gap the
    // packet left open — see `reach.test.ts`'s "the DEF door speaks it" for the
    // identical nodes/edges edge, refused with no relation declared). `nodes`
    // and `edges` are joined in the domain (an edge names its ends' node ids),
    // so the fixture states that relation, exactly as the def door requires.
    const linked = fresh({ relations: NETWORK_RELATIONS, links: [{ source: NODES_ADDRESS, kind: 'point', target: EDGES_ADDRESS, response: 'highlight' }] });
    await linked.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    // `fromLabel` = the NODES LAYER's own declared label — the name the person knows the thing they brushed by (see `./clauseLabel.session.test.ts`).
    // The clause TRAVELS the first declared relation (`edges` has no `group`; `edges.source → nodes.id` is on the edge's `via`), so it
    // arrives as the `match` on `source` — pinned in full by `./via.session.test.ts`; here only the route and the name are the point
    expect(linked.clausesFor(EDGES_ADDRESS)).toMatchObject([{ from: NODES_ADDRESS, fromLabel: 'Diseases', response: 'highlight', clause: { kind: 'match', field: 'source', values: ['flu', 'cold'] }, via: { from: { kind: 'point', field: 'group', value: 'viral' } } }]);
    expect(linked.clausesFor('net')).toEqual([]);
    const q = await linked.viewQuery({ viewId: EDGES_ADDRESS });
    expect(q.ok && [q.count, q.clauses.map((c) => [c.from, c.response])]).toEqual([EDGES.length, [[NODES_ADDRESS, 'highlight']]]);
    // the link verb edits an edge between layers, landing with the layer's meta
    const edit = await linked.dispatch({ verb: 'link', source: NODES_ADDRESS, kind: 'point', target: EDGES_ADDRESS, response: 'filter', cause: userCause() });
    expect(edit.ok && edit.commit?.actorMeta).toEqual({ actor: 'user', label: 'Diseases' });
  });

  it('viewQuery on a layer address defaults the table to the layer table, and the no-view window applies only the clauses on the table asked', async () => {
    const s = fresh();
    const edges = await s.viewQuery({ viewId: EDGES_ADDRESS });
    expect(edges.ok && [edges.columns, edges.rows, edges.count]).toEqual([['source', 'target', 'weight'], EDGES, EDGES.length]);
    const nodes = await s.viewQuery({ viewId: NODES_ADDRESS, columns: ['group'] });
    expect(nodes.ok && [nodes.columns, nodes.key, nodes.count]).toEqual([['group', 'id'], 'id', NODES.length]);
    const view = await s.viewQuery({ viewId: 'net' });
    expect(view.ok && view.count).toBe(NODES.length);
    const ghost = await s.viewQuery({ viewId: layerAddress('net', 'ghost') });
    expect(ghost.ok === false && ghost.reason).toBe('unknown-view');
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    const whole = await s.viewQuery();
    expect(whole.ok && [whole.count, whole.clauses.map((c) => c.from)]).toEqual([2, [NODES_ADDRESS]]);
    const wholeEdges = await s.viewQuery({ table: 'edges' });
    expect(wholeEdges.ok && [wholeEdges.count, wholeEdges.clauses.map((c) => c.from)]).toEqual([1, [EDGES_ADDRESS]]);
  });

  it('an address and a table that disagree are refused by name; the two that agree serve the layer window', async () => {
    const s = fresh();
    const clash = await s.viewQuery({ viewId: EDGES_ADDRESS, table: 'nodes' });
    expect(clash.ok === false && clash.reason).toBe('table-mismatch');
    expect(clash.ok === false && clash.rejected).toBe(`layer "${EDGES_ADDRESS}" reads table "edges", not "nodes" — ask for its window without a table, or ask table "nodes" without the layer`);
    const agree = await s.viewQuery({ viewId: EDGES_ADDRESS, table: 'edges' });
    expect(agree.ok && agree.rows).toEqual(EDGES);
    // a VIEW declares no table of its own, so an explicit table still names the window it reads — only a layer can disagree
    const view = await s.viewQuery({ viewId: 'net', table: 'edges' });
    expect(view.ok && view.count).toBe(EDGES.length);
  });

  it('a layer carries prose of its own: derived words read the LAYER surface, and stated bindings are current the moment they are written', async () => {
    const s = fresh();
    // the library's own construction line, written from the layer's chartKind and channels — never the frame's
    const derived = await s.dispatch({ verb: 'describe', viewId: NODES_ADDRESS, slot: 'howToRead', record: { author: { kind: 'derived' } }, cause: userCause() });
    expect(derived.ok && derived.described).toMatchObject({ status: 'derived', text: 'a point with size on size, group on color' });
    const frame = await s.dispatch({ verb: 'describe', viewId: 'net', slot: 'howToRead', record: { author: { kind: 'derived' } }, cause: userCause() });
    expect(frame.ok && frame.described).toMatchObject({ status: 'derived', text: 'a network with nothing bound' });
    // an agent states the layer's own bindings as its basis: the words are current on the commit that wrote them
    const caption = await s.dispatch({ verb: 'describe', viewId: EDGES_ADDRESS, slot: 'caption', record: { text: 'Ties', author: { kind: 'agent', model: 'm' }, basis: { encodings: { size: 'weight' } } }, cause: userCause() });
    expect(caption.ok && caption.described).toMatchObject({ status: 'current', changed: [] });
    // …and an accepted proposal is judged against the columns the LAYER reads, exactly as the proposal was
    const proposed = await s.dispatch({ verb: 'describe', viewId: EDGES_ADDRESS, slot: 'title', record: { text: 'The ties', author: { kind: 'agent', model: 'm' }, basis: { columns: ['weight'] } }, proposal: true, cause: userCause() });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const accepted = await s.dispatch({ verb: 'describe', viewId: EDGES_ADDRESS, slot: 'title', record: null, accept: proposed.proposed!.proposal, cause: userCause() });
    expect(accepted.ok && accepted.described).toMatchObject({ status: 'current', changed: [], text: 'The ties' });
    // a layer that declares no bindings says exactly that, in its own voice
    const bare = buildDashboard(makeNetworkDef([nodesLayer, { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'] }])).createSession();
    const nothing = await bare.dispatch({ verb: 'describe', viewId: EDGES_ADDRESS, slot: 'howToRead', record: { author: { kind: 'derived' } }, cause: userCause() });
    expect(nothing.ok && nothing.described).toMatchObject({ status: 'derived', text: 'a line with nothing bound' });
  });

  it('the overview projects views[].layers from the map; the fold, seek and compare read an address like a viewId', async () => {
    const s = fresh();
    const o = await s.overview();
    expect(o.views).toHaveLength(1);
    expect(o.views[0]!.layers).toEqual([
      { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], label: 'Diseases' },
      { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'] },
    ]);
    expect(o.links.views.map((v) => v.viewId)).toEqual(['net', NODES_ADDRESS, EDGES_ADDRESS]);
    const a = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause: userCause() });
    const b = await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'bacterial', cause: userCause() });
    if (!a.ok || !b.ok) throw new Error('both land');
    s.seek(a.commit!.id);
    expect((await s.overview()).activeSelections.map((x) => x.viewId)).toEqual([EDGES_ADDRESS]);
    const cmp = await s.compare(a.commit!.id, b.commit!.id);
    expect(cmp.ok && [cmp.a.rows, cmp.b.rows]).toEqual([NODES.length, 1]); // the edges clause is not the nodes count's at either tip
  });

  it('navigate, mountView, saved selections and describe take an address; reencode on a layer is refused with a sentence', async () => {
    const s = fresh();
    const nav = await s.dispatch({ verb: 'navigate', viewId: EDGES_ADDRESS, cause: userCause() });
    expect(nav.ok && nav.navigatedTo).toBe(EDGES_ADDRESS);
    expect(s.mountView(EDGES_ADDRESS, { capabilities: { canProbe: true } })).toEqual({ ok: true });
    expect(s.mountView(layerAddress('net', 'ghost'), { capabilities: { canProbe: true } }).ok).toBe(false);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', value: 5, cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    // RE-PINNED (law 6a): `net` is a frame, so the gesture at it is refused and lands no clause — the picture holds the two layers
    expect(await s.dispatch({ verb: 'select', viewId: 'net', field: 'size', value: 12, cause: userCause() })).toMatchObject({ ok: false, rejection: { detail: FRAME_REFUSAL } });
    const saved = s.saveSelection('the tie', { live: 'all' });
    expect(saved.ok && saved.saved.conditions.map((c) => c.viewId)).toEqual([EDGES_ADDRESS, NODES_ADDRESS]);
    const one = s.saveSelection('nodes only', { viewId: NODES_ADDRESS });
    expect(one.ok).toBe(true);
    const applied = await s.applySaved('the tie', userCause('back'));
    expect(applied.ok && [applied.applied.map((c) => c.viewId), applied.refused]).toEqual([[EDGES_ADDRESS, NODES_ADDRESS], []]);
    const prose = await s.dispatch({ verb: 'describe', viewId: NODES_ADDRESS, slot: 'title', record: { text: 'The diseases', author: { kind: 'human' } }, cause: userCause() });
    expect(prose.ok && prose.commit).toMatchObject({ viewId: `prose:${NODES_ADDRESS}`, actorMeta: { actor: 'user', label: 'Diseases' } });
    const proposal = await s.dispatch({ verb: 'describe', viewId: EDGES_ADDRESS, slot: 'caption', record: { text: 'Ties', author: { kind: 'agent', model: 'm' }, levels: ['trend'], basis: { filters: {}, columns: ['weight'] } }, proposal: true, cause: userCause() });
    expect(proposal.ok && proposal.commit?.viewId).toBe(`prose:${EDGES_ADDRESS}`);
    const re = await s.dispatch({ verb: 'reencode', viewId: NODES_ADDRESS, channel: 'size', field: 'size', cause: userCause() });
    expect(re.ok).toBe(false);
    expect(JSON.stringify(re)).toContain('is a layer — its bindings are declared on the layer and cannot be re-encoded; reencode names the view');
    const reGhost = await s.dispatch({ verb: 'reencode', viewId: layerAddress('net', 'ghost'), channel: 'size', field: 'size', cause: userCause() });
    expect(JSON.stringify(reGhost)).toMatch(/needs-view/);
  });

  it('a layer answers with its view capability: a no-probe view refuses a select on its layer', async () => {
    const s = fresh({ capabilities: [{ viewId: 'net', canProbe: false }] });
    const res = await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    expect(JSON.stringify(res)).toContain(`view \\"${NODES_ADDRESS}\\" declares no-probe capability`);
  });

  it('the marker is reserved beside the session names by import, never respelled', () => {
    expect(RESERVED_ID_MARKER).toBe(LAYER_MARKER);
  });

  it('byte identity: a dashboard with no layers carries no layers anywhere, and its guards speak of the default table as before', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const o = await s.overview();
    expect(JSON.stringify(o)).not.toContain('layers');
    expect(o.views.every((v) => !('layers' in v))).toBe(true);
    expect(o.links.views.map((v) => v.viewId)).toEqual(['scatter', 'bar', 'cluster', 'display']);
    expect(o.links.edges.filter((e) => e.origin === 'default')).toHaveLength(o.links.edges.length);
    const wrong = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'weight', value: 5, cause: userCause() });
    expect(JSON.stringify(wrong)).toContain('no column \\"weight\\" in table \\"data\\"');
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const whole = await s.viewQuery();
    expect(whole.ok && [whole.count, whole.clauses.map((c) => c.from)]).toEqual([8, ['bar']]);
    expect((await s.overview()).selectedRowCount).toBe(8);
  });
});
