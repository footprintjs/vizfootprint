/**
 * THE NEIGHBOURHOOD SELECT (packet 5) — one gesture on a node selects that
 * node AND what it touches.
 *
 * The law under test: the act names ONE endpoint of the acting view's table
 * and the node it walks from; the session reads the OTHER endpoint off the
 * declared relations (never the rows), walks the edges ONCE at the cursor, and
 * lands ONE commit carrying the question (seed, derivation, hops) with its
 * answer (the walked ids). Folding as you WALK equals folding a REPLAY, so
 * every path here is asserted twice: live, and after a seek or a replay.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { EDGES, NETWORK_RELATIONS, NODES, edgesLayer, makeNetworkDef, nodesLayer } from '../def/network.fixture.js';
import { noSqlConnection } from './dashboard.fixture.js';
import { reject, type DataProvider, type WalkAsk } from '../data/index.js';
import { egoIds } from './neighbourhood.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
/** A node-link that says it can be walked from — the voice is DECLARED; nothing assumes a walk (`../links/voice.ts`). */
const WALKS: DashboardDef['capabilities'] = [{ viewId: 'net', canProbe: true, encodings: ['point', 'interval', 'match', 'neighbourhood'] }];
const fresh = (extra: Partial<DashboardDef> = {}) =>
  buildDashboard(makeNetworkDef(undefined, { relations: NETWORK_RELATIONS, capabilities: WALKS, ...extra })).createSession();

const EDGES_ADDRESS = layerAddress('net', 'edges');
const TIES_ADDRESS = layerAddress('net', 'ties');
/** The same node-link with a SECOND layer over the edges table — another view live on the table the walk reads. */
const twoEdgeLayers = () =>
  buildDashboard(
    makeNetworkDef([nodesLayer, edgesLayer, { layerId: 'ties', table: 'edges', chartKind: 'line', channels: ['x'], initial: {} }], { relations: NETWORK_RELATIONS, capabilities: WALKS }),
  ).createSession();
const NODES_ADDRESS = layerAddress('net', 'nodes');
/** The seed's own walk over the fixture's two ties: flu—cold—strep. */
const COLD_EGO = ['cold', 'flu', 'strep'];
/** The WIRE BODY a walk from `cold` carries — the question and its answer, the same bytes on the commit and on the live selection. */
const COLD_WALK = { seed: 'cold', derivation: 'ego', hops: 1, ids: COLD_EGO };

describe('the walk itself (egoIds) — rows in, ids out', () => {
  it('the seed comes first, then the others in row order, each once', () => {
    expect(egoIds(EDGES, ['source', 'target'], 'cold')).toEqual(COLD_EGO);
    expect(egoIds(EDGES, ['source', 'target'], 'flu')).toEqual(['flu', 'cold']);
    expect(egoIds(EDGES, ['source', 'target'], 'strep')).toEqual(['strep', 'cold']);
  });

  it('a node no edge names is alone in its own neighbourhood; a self-loop names only itself', () => {
    expect(egoIds(EDGES, ['source', 'target'], 'measles')).toEqual(['measles']);
    expect(egoIds([{ source: 'flu', target: 'flu' }], ['source', 'target'], 'flu')).toEqual(['flu']);
  });

  it('an endpoint with no value names no node — a missing end is not a tie to null', () => {
    const ragged = [
      { source: 'flu', target: null },
      { source: 'flu' },
      { source: 'cold', target: 'strep' },
    ];
    expect(egoIds(ragged, ['source', 'target'], 'flu')).toEqual(['flu']);
    expect(egoIds(ragged, ['source', 'target'], 'cold')).toEqual(['cold', 'strep']);
  });
});

describe('one gesture, one commit', () => {
  it('lands exactly ONE commit carrying the question and its answer, and narrows the edges to the ego net', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause('alt-click cold'), correlationId: 'turn-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(s.log.records).toHaveLength(1);
    expect(res.commit).toMatchObject({
      viewId: EDGES_ADDRESS,
      kind: 'neighbourhood',
      field: 'source ↔ target',
      fields: ['source', 'target'],
      value: COLD_WALK,
      correlationId: 'turn-1',
    });
    // the induced ego subgraph: BOTH endpoints inside the walked set
    expect(res.commit!.predicateSQL).toBe(`(("source" IN ('cold', 'flu', 'strep')) AND ("target" IN ('cold', 'flu', 'strep')))`);
    expect(await s.selectedRows('edges')).toEqual(EDGES);
    const o = await s.overview();
    expect(o.activeSelections).toEqual([
      // THE WIRE LAW: a live selection's `value` is the shape its commit carries — one triple, one reader (`clauseFromWire`)
      { viewId: EDGES_ADDRESS, field: 'source ↔ target', kind: 'neighbourhood', value: COLD_WALK, fields: ['source', 'target'], commitId: res.commit!.id },
    ]);
  });

  it('a tie that LEAVES the walked set is not selected — the rows are the ones the highlight promised', async () => {
    // the walk from an END of the path: flu's ego set is {flu, cold}, and cold→strep is a
    // neighbour's tie to a stranger — one edge-hop past the set, drawn dim by the chart
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', cause: userCause('alt-click flu') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.commit!.value as { ids: readonly unknown[] }).ids).toEqual(['flu', 'cold']);
    expect(await s.selectedRows('edges')).toEqual([{ source: 'flu', target: 'cold', weight: 5 }]);
  });

  it('either endpoint names the same walk — the pair is read in DECLARATION order, so the bytes are the same', async () => {
    const a = fresh();
    const b = fresh();
    const fromSource = await a.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', cause: userCause() });
    const fromTarget = await b.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'target', seed: 'flu', cause: userCause() });
    expect(fromSource.ok && fromTarget.ok).toBe(true);
    if (!fromSource.ok || !fromTarget.ok) return;
    expect(fromTarget.commit!.value).toEqual(fromSource.commit!.value);
    expect(fromTarget.commit!.fields).toEqual(fromSource.commit!.fields);
    expect(fromTarget.commit!.predicateSQL).toBe(fromSource.commit!.predicateSQL);
  });

  it('a node no edge names keeps NOTHING — an empty walk is a real always-false predicate, never "everything"', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'measles', cause: userCause() });
    expect(res.ok && (res.commit!.value as { ids: unknown[] }).ids).toEqual(['measles']); // itself, and nothing else
    expect(await s.selectedRows('edges')).toEqual([]);
    // and a seed INSIDE the graph keeps every edge its neighbourhood touches — an ego net, not one row
    const inside = await fresh().dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'strep', cause: userCause() });
    expect(inside.ok && (inside.commit!.value as { ids: unknown[] }).ids).toEqual(['strep', 'cold']);
  });

  it('the walk reads the rows AT THE CURSOR — another view live on the same table narrows what it can find', async () => {
    const s = twoEdgeLayers();
    await s.dispatch({ verb: 'filter', viewId: TIES_ADDRESS, field: 'weight', range: [4, 6], cause: userCause('the strong ties only') });
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    expect(res.ok && (res.commit!.value as { ids: unknown[] }).ids).toEqual(['cold', 'flu']); // strep rode the weak tie, which is not there to walk
  });

  it('a clause about ANOTHER table\'s column is not judged here — one selection elsewhere cannot make every walk impossible', async () => {
    // RE-PINNED (the frame is its layers, ../def/README.md "Layers", law 6a): with no view-level `initial`, `net`
    // is a FRAME and a gesture at it is refused by name — so the VIEW's clause this test needs is landed on a
    // `net` that binds something of its own, which reads the default table at its own address exactly as before.
    const s = fresh({ encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], initial: { x: 'size' }, layers: [nodesLayer, edgesLayer] }] });
    // `net` is a VIEW, so its clause reaches every table (`clauseReaches`) — and
    // "size" is a NODES column. Judged against the edges table the engine would
    // refuse the whole read, and with it the walk; a sentence about a column
    // these rows do not have is not a claim about these rows.
    const picked = await s.dispatch({ verb: 'select', viewId: 'net', field: 'size', value: 12, cause: userCause('the biggest node') });
    expect(picked.ok).toBe(true);
    const walk = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    expect(walk.ok && (walk.commit!.value as { ids: unknown[] }).ids).toEqual(COLD_EGO);
  });

  it('the acting view own clause is NOT read back into its next walk — a view is never filtered by itself', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'measles', cause: userCause() }); // keeps no edge at all
    const again = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'strep', cause: userCause() });
    // the second gesture answers about the graph on screen, not about the ego net the first one left behind
    expect(again.ok && (again.commit!.value as { ids: unknown[] }).ids).toEqual(['strep', 'cold']);
  });
});

describe('the fold — walking it and replaying it answer the same', () => {
  it('a seek back and forward restores the walk at that cursor', async () => {
    const s = fresh();
    const first = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    const second = await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    expect(second.ok).toBe(true);
    s.seek(first.ok ? first.commit!.id : '');
    const back = await s.overview();
    expect(back.activeSelections.map((a) => [a.viewId, a.kind, a.value])).toEqual([[EDGES_ADDRESS, 'neighbourhood', COLD_WALK]]);
    expect(await s.selectedRows('edges')).toEqual(EDGES);
    s.seek(second.ok ? second.commit!.id : '');
    expect((await s.overview()).activeSelections).toHaveLength(2);
  });

  it('a replay onto a fresh session rebuilds the same rows and the same bytes', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    const other = fresh();
    const replay = await other.replay(s.log.records);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(other.log.records.map((r) => r.predicateSQL)).toEqual(s.log.records.map((r) => r.predicateSQL));
    expect(await other.selectedRows('edges')).toEqual(await s.selectedRows('edges'));
    expect(replay.overview.activeSelections.map((a) => a.value)).toEqual([COLD_WALK]);
  });

  it('seed: null clears it — the one spelling of cleared, and the clause is gone', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'strep', cause: userCause() });
    const cleared = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'target', seed: null, cause: userCause() });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.commit).toMatchObject({ kind: 'neighbourhood', value: null, fields: ['source', 'target'] });
    expect(cleared.commit!.predicateSQL).toBe('null');
    const o = await s.overview();
    expect(o.activeSelections).toEqual([]);
    // a CLEARED walk is projected from the clause it left behind, which keeps the ANSWER and never the
    // question — so the wire body stands with its seed honestly UNNAMED rather than invented
    expect(o.clearedSelections.map((c) => [c.kind, c.value])).toEqual([
      ['neighbourhood', { seed: null, derivation: 'ego', hops: 1, ids: ['strep', 'cold'] }],
    ]);
    expect(await s.selectedRows('edges')).toEqual(EDGES);
  });
});

describe('a walk on the default table — the fold a compare counts', () => {
  /** The same graph, read the other way round: `edges` is the default table and a plain view acts on it. */
  const edgesFirst = () =>
    buildDashboard(
      makeNetworkDef(undefined, {
        relations: [...NETWORK_RELATIONS],
        defaultTable: 'edges',
        actors: { net: { actor: 'user', label: 'Disease network' }, ties: { actor: 'user', label: 'The ties' } },
        capabilities: [...WALKS!, { viewId: 'ties', canProbe: true, encodings: ['neighbourhood'] }],
      }),
    ).createSession();

  it('compare counts the rows each side\u2019s walk keeps — the fold rebuilds the clause, not just its label', async () => {
    const s = edgesFirst();
    const alone = await s.dispatch({ verb: 'select', viewId: 'ties', field: 'source', seed: 'measles', cause: userCause() });
    const ego = await s.dispatch({ verb: 'select', viewId: 'ties', field: 'source', seed: 'cold', cause: userCause() });
    expect(alone.ok && ego.ok).toBe(true);
    if (!alone.ok || !ego.ok) return;
    const cmp = await s.compare(alone.commit!.id, ego.commit!.id);
    expect(cmp.ok).toBe(true);
    if (!cmp.ok) return;
    expect([cmp.a.rows, cmp.b.rows]).toEqual([0, EDGES.length]);
  });
});

describe('every refusal is a sentence, and lands nothing', () => {
  const refusal = async (act: Parameters<ReturnType<typeof fresh>['dispatch']>[0], session = fresh()) => {
    const res = await session.dispatch(act);
    expect(res.ok).toBe(false);
    expect(session.log.records).toHaveLength(0);
    return res.ok ? '' : `${res.rejection.code}: ${res.rejection.detail}`;
  };

  it('a view nobody declared', async () => {
    expect(await refusal({ verb: 'select', viewId: 'ghost', field: 'source', seed: 'cold', cause: userCause() })).toBe('needs-view: no declared view "ghost"');
  });

  it('a view that declares no capability at all — a walk is declared, never assumed', async () => {
    const silent = buildDashboard(makeNetworkDef(undefined, { relations: NETWORK_RELATIONS })).createSession();
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }, silent)).toBe(
      'guard-failed: view "net~edges" declares no capability, and a neighbourhood selection is never assumed — declare encodings: ["neighbourhood"] on it',
    );
    // and the offers say the same thing — the act door and the voice never differ
    expect((await silent.overview()).offers.some((o) => o.kind === 'neighbourhood')).toBe(false);
    // RE-PINNED (review fix, `offersOf`/../session/offers.ts): `net` here has no view-level `initial`, so it is
    // a FRAME (the frame is its layers, ../def/README.md "Layers" law 6a) — its own address is no longer offered
    // (an offer the door refuses is a broken promise); its layers offer the same voice under their own addresses.
    expect((await fresh().overview()).offers.filter((o) => o.kind === 'neighbourhood').map((o) => o.viewId)).toEqual([NODES_ADDRESS, EDGES_ADDRESS]);
  });

  it('a view whose declared voice does not include the walk', async () => {
    const narrow = fresh({ capabilities: [{ viewId: 'net', canProbe: true, encodings: ['point'] }] });
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }, narrow)).toBe(
      'guard-failed: view "net~edges" does not encode a neighbourhood selection',
    );
  });

  it('a seed that was never named — a walk says what it starts from, or says null', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: undefined, cause: userCause() })).toBe(
      'guard-failed: select.seed is missing — a neighbourhood names the node it walks from, or `null` to clear it (the one spelling of cleared; `undefined` does not survive JSON)',
    );
  });

  it('a reserved session field', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: '__analysis__', seed: 'cold', cause: userCause() })).toBe(
      'guard-failed: field "__analysis__" is reserved by the session and cannot be selected on',
    );
  });

  it('a table that joins nothing — the gesture is on a table with no relation at all', async () => {
    const s = buildDashboard(makeNetworkDef(undefined, { capabilities: WALKS })).createSession(); // the same def, no relations declared
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }, s)).toBe(
      'guard-failed: table "edges" declares no relation, so "source" is not an endpoint — a neighbourhood is walked over an edge, and an edge is two columns naming one identity',
    );
  });

  it('a column that is not an endpoint — the endpoints it could have named are quoted', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'weight', seed: 'cold', cause: userCause() })).toBe(
      'guard-failed: "edges.weight" is not an endpoint — the endpoints of "edges" are source, target',
    );
  });

  it('an edge with only one end declared', async () => {
    const half = fresh({ relations: [NETWORK_RELATIONS[0]!] });
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }, half)).toBe(
      'guard-failed: "edges" names "nodes.id" through one column (source) — a neighbourhood walks an edge with exactly two ends',
    );
  });

  it('an endpoint column the table does not actually have — the walk is refused before it reads a row', async () => {
    // the `edges` table declares no columns here, so the def door cannot judge the
    // relation's own column; the act does, against what the engine really lists
    const ghosted = buildDashboard(
      makeNetworkDef(undefined, {
        data: {
          nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
          edges: { rows: EDGES },
        },
        relations: [
          { from: { table: 'edges', column: 'ghost' }, to: { table: 'nodes', column: 'id' } },
          { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
        ],
        capabilities: WALKS,
      }),
    ).createSession();
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'target', seed: 'cold', cause: userCause() }, ghosted)).toBe(
      'needs-column: no column "ghost" in table "edges"',
    );
  });

  it('a backend that cannot list the columns, and one that cannot serve the rows', async () => {
    const blind = buildDashboard(
      makeNetworkDef(undefined, {
        data: {
          nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
          edges: { rows: EDGES, engine: 'wasm', columns: { source: { role: 'dimension' }, target: { role: 'dimension' } } },
        },
        relations: [...NETWORK_RELATIONS],
        capabilities: WALKS,
      }),
      { availableEngines: ['memory', 'wasm'], ...noSqlConnection },
    ).createSession();
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }, blind)).toContain('needs-backend-data:');

    // columns it can list, rows it cannot serve — reached the way atomicity.test.ts reaches it (no provider-injection seam)
    const offline = fresh();
    const provider = (offline as unknown as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('edges');
    provider.evaluate = async () => reject('memory', 'evaluate', 'no-backend-connection', 'the reader is offline');
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }, offline)).toBe(
      'needs-backend-data: the reader is offline',
    );
  });

  it('a gesture from the NODES layer, whose own table is not the edge table', async () => {
    expect(await refusal({ verb: 'select', viewId: NODES_ADDRESS, field: 'id', seed: 'cold', cause: userCause() })).toBe(
      'guard-failed: table "nodes" declares no relation, so "id" is not an endpoint — a neighbourhood is walked over an edge, and an edge is two columns naming one identity',
    );
  });
});

describe('the picture and the plan — a walk saved, applied, and taken back', () => {
  it('a saved picture carries the QUESTION, and applying it RE-ASKS the walk over the rows that are there now', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    const saved = s.saveSelection('the cold ego net', { live: 'all' }, 'user');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.saved.conditions).toEqual([
      { viewId: EDGES_ADDRESS, kind: 'neighbourhood', field: 'source ↔ target', fields: ['source', 'target'], value: COLD_WALK },
    ]);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause: userCause() });
    const applied = await s.applySaved('the cold ego net', userCause());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.applied.map((c) => [c.kind, c.value])).toEqual([['neighbourhood', COLD_WALK]]);
    expect((await s.overview()).activeSelections.map((a) => a.value)).toEqual([COLD_WALK]);
  });

  it('a picture built from HANDED-IN conditions keeps the walk\'s pair — the label is never gated as a column', async () => {
    const s = fresh();
    // the caller hands the pair in: a PAIR kind carries its columns in `fields`, and dropping them
    // would leave `applySaved`'s column gate reading the display label "source ↔ target" as a column
    const saved = s.saveSelection('the cold ego net', {
      conditions: [{ viewId: EDGES_ADDRESS, kind: 'neighbourhood', field: 'anything', fields: ['source', 'target'], value: COLD_WALK }],
    }, 'user');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.saved.conditions).toEqual([
      // the label is MINTED from the pair, never echoed: one display spelling, wherever the picture came from
      { viewId: EDGES_ADDRESS, kind: 'neighbourhood', field: 'source ↔ target', fields: ['source', 'target'], value: COLD_WALK },
    ]);
    const applied = await s.applySaved('the cold ego net', userCause());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.applied.map((c) => [c.kind, c.value])).toEqual([['neighbourhood', COLD_WALK]]);
    // and a pair kind handed in WITHOUT its columns is refused in the same sentence a cell gets
    expect(s.saveSelection('no pair', {
      conditions: [{ viewId: EDGES_ADDRESS, kind: 'neighbourhood', field: 'source ↔ target', value: COLD_WALK }],
    }, 'user')).toMatchObject({ ok: false, rejected: `a neighbourhood condition on "${EDGES_ADDRESS}" needs its two fields` });
  });

  it('applying a picture that does not name the walk CLEARS it kind-faithfully — a cleared neighbourhood, pair and all', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: NODES_ADDRESS, field: 'group', value: 'viral', cause: userCause() });
    expect(s.saveSelection('just the viral ones', { viewId: NODES_ADDRESS }, 'user').ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    const applied = await s.applySaved('just the viral ones', userCause());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.cleared.map((c) => [c.viewId, c.kind, c.field, c.value])).toEqual([[EDGES_ADDRESS, 'neighbourhood', 'source ↔ target', null]]);
    expect((await s.overview()).activeSelections.map((a) => a.viewId)).toEqual([NODES_ADDRESS]);
  });

  it('undo takes the walk back kind-faithfully — a cleared NEIGHBOURHOOD, pair and all', async () => {
    const s = fresh();
    const landed = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    const undone = await s.undo(landed.commit!.id);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.commit).toMatchObject({ kind: 'neighbourhood', value: null, fields: ['source', 'target'] });
    expect((await s.overview()).activeSelections).toEqual([]);
  });

  it('a bring-over of a walk RE-ASKS it on the other path, from the seed it recorded', async () => {
    const s = fresh();
    const landed = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    s.seek(s.log.records[0]!.id);
    s.newPathAt(s.log.records[0]!.id, 'other');
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause: userCause() });
    const brought = await s.bringOver(landed.commit!.id);
    expect(brought.ok).toBe(true);
    if (!brought.ok) return;
    expect(brought.recipe).toMatchObject({ apply: 'selection', kind: 'neighbourhood', fields: ['source', 'target'] });
    expect(brought.commit).toMatchObject({ kind: 'neighbourhood', value: { seed: 'cold', ids: COLD_EGO } });
  });
});

// ── TWO HOPS, PATHS AND COMPONENTS (packet D) ────────────────────────────────

/** The fixture graph is a path: flu — cold — strep, plus `measles`, a node no edge names. */
describe('which walk the act asks for (R3): the same verb, the same commit, three questions', () => {
  it('two hops of ego reaches past the neighbours, and the record says it asked for two', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'ego', hops: 2 }, cause: userCause('two hops out from flu') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit!.value).toEqual({ seed: 'flu', derivation: 'ego', hops: 2, ids: ['flu', 'cold', 'strep'] });
    // and the induced subgraph is now the whole path, where one hop kept only flu—cold
    expect(await s.selectedRows('edges')).toEqual(EDGES);
  });

  it('a PATH lands the nodes in order with its length, and `to` rides on the value — only here', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause: userCause('how does flu reach strep') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit!.value).toEqual({ seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] });
    expect(res.commit!.predicateSQL).toBe(`(("source" IN ('flu', 'cold', 'strep')) AND ("target" IN ('flu', 'cold', 'strep')))`);
    // an ego walk's value carries no `to` at all — the key is present only for the derivation that has one
    const ego = await fresh().dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', cause: userCause() });
    expect(ego.ok && 'to' in (ego.commit!.value as object)).toBe(false);
  });

  it('NO PATH is a landed answer: the two nodes, `hops: null`, and no tie between them', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'measles' }, cause: userCause() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit!.value).toEqual({ seed: 'flu', derivation: 'path', hops: null, to: 'measles', ids: ['flu', 'measles'] });
    // the honest picture of "no path": the predicate keeps no edge, because no edge joins those two
    expect(await s.selectedRows('edges')).toEqual([]);
  });

  it('a COMPONENT lands everything the seed reaches, with the farthest distance as its hops', async () => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'target', seed: 'strep', walk: { derivation: 'component' }, cause: userCause('the whole outbreak') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit!.value).toEqual({ seed: 'strep', derivation: 'component', hops: 2, ids: ['strep', 'cold', 'flu'] });
    expect(await s.selectedRows('edges')).toEqual(EDGES);
  });

  it('the WALK reads the rows at the cursor too — a filter on the edges shortens the path away', async () => {
    const s = twoEdgeLayers();
    await s.dispatch({ verb: 'filter', viewId: TIES_ADDRESS, field: 'weight', range: [4, 6], cause: userCause('the strong ties only') });
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause: userCause() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // cold—strep rode the weak tie, so at THIS cursor there is no path at all
    expect(res.commit!.value).toEqual({ seed: 'flu', derivation: 'path', hops: null, to: 'strep', ids: ['flu', 'strep'] });
  });

  it('a replay of those three commits rebuilds the same bytes and the same rows', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'ego', hops: 2 }, cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'strep', walk: { derivation: 'component' }, cause: userCause() });
    const other = fresh();
    const replay = await other.replay(s.log.records);
    expect(replay.ok).toBe(true);
    expect(other.log.records.map((r) => r.value)).toEqual(s.log.records.map((r) => r.value));
    expect(other.log.records.map((r) => r.predicateSQL)).toEqual(s.log.records.map((r) => r.predicateSQL));
  });
});

describe('an unaskable walk is refused in a sentence, and nothing lands (R3/R4)', () => {
  const refusal = async (act: Parameters<ReturnType<typeof fresh>['dispatch']>[0], session = fresh()) => {
    const res = await session.dispatch(act);
    expect(res.ok).toBe(false);
    expect(session.log.records).toHaveLength(0);
    return res.ok ? '' : `${res.rejection.code}: ${res.rejection.detail}`;
  };

  it('hops asked of a path', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep', hops: 2 }, cause: userCause() })).toBe(
      'guard-failed: select.walk.hops is only asked of an "ego" walk — a "path" walk answers its own distance, so it cannot also be told one',
    );
  });

  it('a path with no `to`', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path' }, cause: userCause() })).toBe(
      'guard-failed: select.walk.to is missing — a "path" walk runs from the seed TO a node, and the node it runs to is named, never guessed',
    );
  });

  it('three hops — the policy, said as one', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'ego', hops: 3 as 1 | 2 }, cause: userCause() })).toContain(
      'guard-failed: select.walk.hops must be 1 or 2 — past two hops an ego set is most of any real graph',
    );
  });

  it('`to` on a component', async () => {
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'component', to: 'strep' }, cause: userCause() })).toBe(
      'guard-failed: select.walk.to is only asked of a "path" walk — a "component" walk has no far end to name',
    );
  });

  it('the question is judged BEFORE the rows are read — an unaskable walk asks no engine anything', async () => {
    const offline = fresh();
    const provider = (offline as unknown as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('edges');
    provider.evaluate = async () => reject('memory', 'evaluate', 'no-backend-connection', 'the reader is offline');
    // a reader that cannot serve a row still gets the walk's own sentence, not the backend's
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path' }, cause: userCause() }, offline)).toContain('select.walk.to is missing');
  });

  it('an ANSWER too big to record is its own code — nothing about the declaration can repair it (R4)', async () => {
    // a star with more neighbours than a commit records: the walk is legal, its answer is not carriable
    const hub = Array.from({ length: 10_000 }, (_, i) => ({ source: 'hub', target: `n${i}`, weight: 1 }));
    const big = buildDashboard(
      makeNetworkDef(undefined, {
        data: {
          nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
          edges: { rows: hub, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
        },
        relations: [...NETWORK_RELATIONS],
        capabilities: WALKS,
      }),
    ).createSession();
    expect(await refusal({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'hub', cause: userCause() }, big)).toBe(
      'result-too-large: the 1-hop neighbourhood of "hub" holds 10,001 nodes, past the 10,000 one commit records — filter the edges first, or select by a column instead',
    );
  });
});

describe('the wire re-asks the SAME question (R5)', () => {
  it('a picture saved with a PATH re-walks a path — not the ego set the default would have given', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause: userCause() });
    const saved = s.saveSelection('how flu reaches strep', { live: 'all' }, 'user');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const PATH = { seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] };
    expect(saved.saved.conditions.map((c) => c.value)).toEqual([PATH]);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause: userCause() });
    const applied = await s.applySaved('how flu reaches strep', userCause());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    // the whole question came back: the derivation, the far end, and the length TODAY's rows give
    expect(applied.applied.map((c) => c.value)).toEqual([PATH]);
  });

  it('a picture saved with TWO HOPS re-asks two hops; a one-hop picture asks the act it always asked', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'ego', hops: 2 }, cause: userCause() });
    expect(s.saveSelection('two hops from flu', { live: 'all' }, 'user').ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause: userCause() }); // a plain one-hop walk
    expect(s.saveSelection('the cold ego net', { live: 'all' }, 'user').ok).toBe(true);

    const two = await s.applySaved('two hops from flu', userCause());
    expect(two.ok && two.applied.map((c) => c.value)).toEqual([{ seed: 'flu', derivation: 'ego', hops: 2, ids: ['flu', 'cold', 'strep'] }]);
    const one = await s.applySaved('the cold ego net', userCause());
    expect(one.ok && one.applied.map((c) => c.value)).toEqual([COLD_WALK]); // byte-identical to the record it was saved from
  });

  it('a COMPONENT picture re-asks the component — the recorded hops is its ANSWER and is never asked back', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'strep', walk: { derivation: 'component' }, cause: userCause() });
    expect(s.saveSelection('the whole outbreak', { live: 'all' }, 'user').ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause: userCause() });
    const applied = await s.applySaved('the whole outbreak', userCause());
    expect(applied.ok && applied.applied.map((c) => c.value)).toEqual([{ seed: 'strep', derivation: 'component', hops: 2, ids: ['strep', 'cold', 'flu'] }]);
  });

  it('a picture naming a derivation this build does not mint is REFUSED by name — never re-asked as a different walk', async () => {
    const s = fresh();
    const saved = s.saveSelection('a walk from another build', {
      conditions: [
        {
          viewId: EDGES_ADDRESS,
          kind: 'neighbourhood',
          field: 'source ↔ target',
          fields: ['source', 'target'],
          value: { seed: 'flu', derivation: 'lasso', hops: 4, ids: ['flu', 'cold'] },
        },
      ],
    }, 'user');
    expect(saved.ok).toBe(true);
    // ONE condition, and it is not landable here: the whole apply is refused, and nothing was touched
    const applied = await s.applySaved('a walk from another build', userCause());
    expect(applied.ok).toBe(false);
    expect(applied.ok ? '' : applied.rejected).toContain('"lasso" is not a walk this build knows how to run');
    expect(s.log.records).toHaveLength(0);
  });

  it('a bring-over re-asks the walk it recorded — a path brought over is a path', async () => {
    const s = fresh();
    const landed = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause: userCause() });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    s.seek(s.log.records[0]!.id);
    s.newPathAt(s.log.records[0]!.id, 'other');
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause: userCause() });
    const brought = await s.bringOver(landed.commit!.id);
    expect(brought.ok).toBe(true);
    if (!brought.ok) return;
    expect(brought.commit!.value).toEqual({ seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] });
  });
});

describe('the act names the SEED, and the picture is the INDUCED subgraph over the set it walked', () => {
  /** a — b — c, plus the CHORD a — c (two of a's neighbours, tied), plus the tail c — d. */
  const TRIANGLE = [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'b', target: 'c', weight: 1 },
    { source: 'a', target: 'c', weight: 1 },
    { source: 'c', target: 'd', weight: 1 },
  ];
  const triangle = () =>
    buildDashboard(
      makeNetworkDef(undefined, {
        data: {
          nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
          edges: { rows: TRIANGLE, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
        },
        relations: [...NETWORK_RELATIONS],
        capabilities: WALKS,
      }),
    ).createSession();

  it('an ego set keeps the CHORDS — a tie between two neighbours is inside the set, so it is in the picture', async () => {
    const s = triangle();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'a', cause: userCause() });
    expect(res.ok && res.commit!.value).toMatchObject({ ids: ['a', 'b', 'c'] });
    // b — c joins two NEIGHBOURS of the seed: both ends are in the set, so it is kept. c — d is not.
    expect(await s.selectedRows('edges')).toEqual(TRIANGLE.slice(0, 3));
  });

  it('a PATH has no chords to keep — an edge between two of its nodes would BE a shorter path', async () => {
    const s = triangle();
    const res = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'a', walk: { derivation: 'path', to: 'd' }, cause: userCause() });
    expect(res.ok && res.commit!.value).toEqual({ seed: 'a', derivation: 'path', hops: 2, to: 'd', ids: ['a', 'c', 'd'] });
    // exactly the path's own two ties: a — c and c — d. The same predicate as every other walk.
    expect(await s.selectedRows('edges')).toEqual([TRIANGLE[2], TRIANGLE[3]]);
  });

  it('a `walk` payload carrying its own `seed` never moves the act — the node the act named is the node recorded', async () => {
    const s = fresh();
    const res = await s.dispatch({
      verb: 'select',
      viewId: EDGES_ADDRESS,
      field: 'source',
      seed: 'flu',
      // an untyped caller (or an agent's payload) can carry any key; the act's own seed still wins,
      // or the receipt would name one node and the commit another
      walk: { derivation: 'ego', seed: 'strep' } as WalkAsk,
      cause: userCause(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit!.value).toEqual({ seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] });
  });

  it('an UNDO that puts a walk back re-asks the walk it recorded (R5) — a path comes back a path', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'flu', walk: { derivation: 'path', to: 'strep' }, cause: userCause() });
    const cleared = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause: userCause() });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const undone = await s.undo(cleared.commit!.id); // undoing the CLEAR asks the walk again
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.commit!.value).toEqual({ seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] });
  });
});
