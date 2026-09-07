/**
 * TWO ACTS, ONE PICTURE — the end of the road for `../analysis/bringOver.ts`.
 *
 * A layout act writes `x` and `y` onto the nodes; a bringOver act then carries
 * them across the two declared relations onto the edges, as `source_x`,
 * `source_y`, `target_x` and `target_y`. That pair is the whole node-link
 * picture as DATA: an edge mark reads its own row and needs no lookup, and a
 * replay of the log alone rebuilds both acts, byte for byte, in a session that
 * declared no analyses at all.
 *
 * The laws are `../analysis/README.md` ("Bring a related table's columns over"),
 * `../def/README.md` law 6 (the relation is the permission AND the join) and
 * `./README.md` law 6 (the log records acts; column values are recomputed).
 */

import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef, RelationDecl } from '../def/index.js';
import { makeNetworkDef } from '../def/network.fixture.js';

/** `edges.source → nodes.id` and `edges.target → nodes.id` — two ties, so two columns come over per name. */
const RELATIONS: readonly RelationDecl[] = [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
];

/** Few passes: these suites are about where the numbers LAND, not how good they are. */
const MAP = { builtin: 'layout', algo: 'stress', table: 'nodes', edges: 'edges', seed: 5, iterations: 6 } as const;
const ENDS = { builtin: 'bringOver', table: 'edges', from: 'nodes', columns: ['x', 'y'] } as const;

const netWith = (extra: Partial<DashboardDef>): DashboardDef => makeNetworkDef(undefined, extra);
const sessionOn = (def: DashboardDef) => buildDashboard(def).createSession();
const wired = (): DashboardDef => netWith({ relations: RELATIONS, analyses: { map: { ...MAP }, ends: { ...ENDS } } });

type Session = ReturnType<typeof sessionOn>;

/** The edge rows as they now stand, with both endpoints' places on them. */
async function edgesOn(s: Session): Promise<Record<string, unknown>[]> {
  const res = await s.viewQuery({ table: 'edges', columns: ['source', 'target', 'source_x', 'source_y', 'target_x', 'target_y'], limit: 20 });
  return res.ok ? res.rows.map((r) => ({ ...r })) : [{ rejected: res.rejected }];
}

/** The node positions as they now stand, in node order. */
async function nodesOn(s: Session): Promise<Record<string, unknown>[]> {
  const res = await s.viewQuery({ columns: ['id', 'x', 'y'], limit: 20 });
  return res.ok ? res.rows.map((r) => ({ ...r })) : [{ rejected: res.rejected }];
}

/** Lay the graph out, then carry the places over. The order is the point: the second act reads the first act's columns. */
async function placeThenCarry(s: Session): Promise<void> {
  const laid = await s.declareAnalysis('map');
  expect(laid.gap).toBeUndefined();
  const carried = await s.declareAnalysis('ends', { table: 'edges' });
  expect(carried.gap).toBeUndefined();
  expect(carried.materialized).toEqual(['source_x', 'source_y', 'target_x', 'target_y']);
}

describe('a layout and a bringOver put the whole picture on the trace', () => {
  it('carries both endpoints’ places onto every edge row, and they ARE the node’s own', async () => {
    const s = sessionOn(wired());
    await placeThenCarry(s);

    const nodes = await nodesOn(s);
    const places = new Map(nodes.map((n) => [n['id'], { x: n['x'], y: n['y'] }]));
    const edges = await edgesOn(s);
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      expect({ x: edge['source_x'], y: edge['source_y'] }).toEqual(places.get(edge['source']));
      expect({ x: edge['target_x'], y: edge['target_y'] }).toEqual(places.get(edge['target']));
    }
  });

  it('the act carries the record that made it — a bringOver is data all the way down', async () => {
    const s = sessionOn(wired());
    await placeThenCarry(s);
    expect(s.log.records.at(-1)!.value).toMatchObject({ id: 'ends', table: 'edges', def: { builtin: 'bringOver', table: 'edges', from: 'nodes', columns: ['x', 'y'] } });
  });

  it('an endpoint that names no row lands null, never a guessed place', async () => {
    // one edge points at a disease the nodes table does not carry
    const s = sessionOn({
      meta: { title: 'a dangling tie' },
      data: {
        nodes: { rows: [{ id: 'flu', x: 1, y: 2 }], key: 'id', columns: { id: { role: 'identifier' }, x: { role: 'measure' }, y: { role: 'measure' } } },
        edges: { rows: [{ source: 'flu', target: 'ghost' }], columns: { source: { role: 'dimension' }, target: { role: 'dimension' } } },
      },
      actors: { net: { actor: 'user', label: 'a dangling tie' } },
      defaultTable: 'nodes',
      relations: RELATIONS,
      analyses: { ends: { ...ENDS } },
    });
    const out = await s.declareAnalysis('ends', { table: 'edges' });
    expect(out.gap).toBeUndefined();
    const res = await s.viewQuery({ table: 'edges', columns: ['source_x', 'source_y', 'target_x', 'target_y'], limit: 5 });
    expect(res.ok && res.rows[0]).toEqual({ source_x: 1, source_y: 2, target_x: null, target_y: null });
    // and how many rows the answer really covers is on the analysis's own
    // committed state — `../analysis/bringOver.test.ts` reads the counters there
  });
});

describe('the log alone rebuilds both acts', () => {
  it('REPLAY: a fresh session that declares NO analyses lands identical nodes and edges', async () => {
    const source = sessionOn(wired());
    await placeThenCarry(source);
    const nodes = await nodesOn(source);
    const edges = await edgesOn(source);

    const fresh = sessionOn(netWith({ relations: RELATIONS }));
    const res = await fresh.replay(JSON.stringify(source.log.records));
    expect(res).toMatchObject({ ok: true, landed: 2, reran: 2, filed: 0 });
    expect(await nodesOn(fresh)).toEqual(nodes);
    expect(await edgesOn(fresh)).toEqual(edges);
  });

  it('a second layout act warm-starts: every already-placed node stays, and the carried places stay with them', async () => {
    const s = sessionOn(wired());
    await placeThenCarry(s);
    const before = await nodesOn(s);
    const carried = await edgesOn(s);

    const again = await s.declareAnalysis('map');
    expect(again.materialized).toEqual(['x', 'y']);
    expect(await nodesOn(s)).toEqual(before);

    // and carrying them over again reaches the same numbers, from the newest act's columns
    const carriedAgain = await s.declareAnalysis('ends', { table: 'edges' });
    expect(carriedAgain.gap).toBeUndefined();
    expect(await edgesOn(s)).toEqual(carried);
  });
});

describe('the refusals — a bringOver that cannot be honest does not happen', () => {
  it('no relation points that way: the sentence names both tables and what to declare', async () => {
    const s = sessionOn(netWith({ analyses: { ends: { ...ENDS } } })); // no relations at all
    const out = await s.declareAnalysis('ends', { table: 'edges' });
    expect(out.commit).toBeUndefined();
    // law 6 answers first: the PERMISSION is the cheapest judge on the door
    expect(out.gap!.detail).toBe('analysis "ends" reads table "nodes", which no declared relation joins to "edges" — declare the relation first');
    expect(s.log.records).toHaveLength(0);
  });

  it('a relation that points the OTHER way is a permission but not a join, and the sentence says so', async () => {
    const backwards: readonly RelationDecl[] = [{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } }];
    // read from nodes' side: nodes may READ edges (either direction), but nothing points from nodes AT edges
    const s = sessionOn(netWith({ relations: backwards, analyses: { back: { builtin: 'bringOver', table: 'nodes', from: 'edges', columns: ['weight'] } } }));
    const out = await s.declareAnalysis('back', { table: 'nodes' });
    expect(out.commit).toBeUndefined();
    expect(out.gap!.detail).toBe('analysis "back" brings weight over from "edges", but no declared relation points from "nodes" at "edges" — declare the relation first');
  });

  it('declared on the wrong table: the act does not happen', async () => {
    const s = sessionOn(wired());
    const out = await s.declareAnalysis('ends'); // the default table is `nodes`, not `edges`
    expect(out.commit).toBeUndefined();
    // Law 6 is the cheaper judge and answers first: read on `nodes`, this act
    // would be reading its OWN table — and it is told exactly that, rather than
    // sent to declare a self-join the relation door refuses. The sentence
    // `bringOverProblems` keeps for the case law 6 lets through (a THIRD table,
    // joined to the related one) is pinned in `../analysis/bringOver.test.ts`.
    expect(out.gap!.detail).toBe('analysis "ends" reads table "nodes", which is the table it already runs over — `reads` names the tables BESIDE it');
    expect(s.log.records).toHaveLength(0);
  });

  it('the related table has no such column: the act throws rather than landing a column of nulls', async () => {
    const s = sessionOn(wired());
    // no layout act has run, so `nodes` has no `x` yet
    await expect(s.declareAnalysis('ends', { table: 'edges' })).rejects.toThrow(
      'analysis "ends" brings x, y over from "nodes", which has no such column — compute it there first',
    );
    expect(s.log.records).toHaveLength(0);
  });

  it('a name that would land on a DECLARED source column is refused by the session\u2019s own law', async () => {
    // `edges` already holds a column called `source_tag`, which is exactly the
    // name `source` × `tag` would produce — source data is the map, and a
    // computed column may not take its name. The sentence is `writeColumns`'
    // own: it is the only judge that can tell a declared column from one an
    // earlier act derived, which is why `bringOverProblems` does not try.
    const s = sessionOn({
      meta: { title: 'a collision' },
      data: {
        nodes: { rows: [{ id: 'a', tag: 7 }], key: 'id', columns: { id: { role: 'identifier' }, tag: { role: 'measure' } } },
        edges: { rows: [{ source: 'a', source_tag: 1 }], columns: { source: { role: 'dimension' }, source_tag: { role: 'measure' } } },
      },
      actors: { net: { actor: 'user', label: 'a collision' } },
      defaultTable: 'nodes',
      relations: [{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } }],
      analyses: { clash: { builtin: 'bringOver', table: 'edges', from: 'nodes', columns: ['tag'] } },
    });
    const out = await s.declareAnalysis('clash', { table: 'edges' });
    expect(out.materialized).toEqual([]);
    expect(out.gap!.detail).toBe(
      `analysis "clash" would write column "source_tag" over the declared source column "source_tag" of table "edges" — a computed column may not take a source column's name`,
    );
  });
});
