/**
 * THE MAP SAYS WHY AN EDGE CROSSES TABLES — `LinkEdge.via` (`types.ts`) and
 * the one finder that writes it, `reach.ts` · `relationPath`.
 *
 * The reach law keeps an edge on three grounds (`tablesCanReach`); the second,
 * a declared relation, is now WRITTEN on the edge: a reader of the graph sees
 * which relation is the reason the two tables reach one another, and the
 * session's travel strategy reads the same fact instead of finding it again.
 * The key is absent on every edge no relation explains — same table, a shared
 * column name, a graph judged by no reach — so a graph built before the key
 * existed is byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { applyLinkOverrides, edgeId, materializeLinks, relationPath, type LinkView, type ReachRelation, type TableReach } from './index.js';

/** The exoplanet desk's shape: a scatter over `planets`, a year chart over `references`, one declared relation between the two tables. */
const SCATTER: LinkView = { viewId: 'mass_radius~planets', voice: ['point'], table: 'planets' };
const YEARS: LinkView = { viewId: 'by_year~references', voice: ['point'], table: 'references' };
const SHEET: LinkView = { viewId: 'sheet', voice: ['point'], table: 'planets' };
const RADIUS_REF: ReachRelation = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const MASS_REF: ReachRelation = { from: { table: 'planets', column: 'mass_ref' }, to: { table: 'references', column: 'ref' } };
const COLUMNS = { planets: ['pl_name', 'radius_ref', 'mass_ref'], references: ['ref', 'year'] };
const JOINED: TableReach = { relations: [RADIUS_REF], columns: COLUMNS };
const TWICE: TableReach = { relations: [RADIUS_REF, MASS_REF], columns: COLUMNS };
/** Two tables that share a column NAME and no relation — the third ground, which is not a relation. */
const SHARED: TableReach = { relations: [], columns: { planets: ['pl_name', 'year'], references: ['ref', 'year'] } };

describe('relationPath — the one finder', () => {
  it('finds the relation either way round (a relation is undirected as a permission), in declaration order, and nothing when none joins the pair', () => {
    expect(relationPath('planets', 'references', [RADIUS_REF])).toEqual([RADIUS_REF]);
    expect(relationPath('references', 'planets', [RADIUS_REF])).toEqual([RADIUS_REF]);
    expect(relationPath('planets', 'references', [MASS_REF, RADIUS_REF])).toEqual([MASS_REF, RADIUS_REF]);
    expect(relationPath('planets', 'measurements', [RADIUS_REF])).toBeUndefined();
    expect(relationPath('planets', 'references', [])).toBeUndefined();
  });
});

describe('the default rule writes `via` on an edge a declared relation explains', () => {
  it('a default edge over the relation carries it — from either side of the relation, the same relation', () => {
    const g = materializeLinks([SCATTER, YEARS], [], 'crossfilter', JOINED);
    expect(g.edges.map((e) => [e.id, e.via])).toEqual([
      [edgeId(SCATTER.viewId, 'point', YEARS.viewId), [RADIUS_REF]],
      [edgeId(YEARS.viewId, 'point', SCATTER.viewId), [RADIUS_REF]],
    ]);
    expect(g).not.toHaveProperty('declined');
  });

  it('two relations joining the pair are BOTH listed, in declaration order', () => {
    const g = materializeLinks([SCATTER, YEARS], [], 'crossfilter', TWICE);
    expect(g.edges[0]?.via).toEqual([RADIUS_REF, MASS_REF]);
  });

  it('a declared edge over the relation carries the same fact — the map says what is true, not who asked', () => {
    const g = materializeLinks([SCATTER, YEARS], [{ source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'highlight' }], 'crossfilter', JOINED);
    const declared = g.edges.find((e) => e.origin === 'declared');
    expect(declared).toEqual({ id: edgeId(SCATTER.viewId, 'point', YEARS.viewId), source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'highlight', origin: 'declared', via: [RADIUS_REF] });
    // a declared edge with a mapping carries it too: the mapping is the author's aim, the relation is still the join
    const mapped = materializeLinks([SCATTER, YEARS], [{ source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'filter', mapping: [{ from: 'pl_name', to: 'ref' }] }], 'none', JOINED);
    expect(mapped.edges[0]?.via).toEqual([RADIUS_REF]);
  });
});

describe('no `via` where no relation is the reason', () => {
  it('two views over ONE table: absent — a view judges its own sentences', () => {
    const g = materializeLinks([SCATTER, SHEET], [], 'crossfilter', JOINED);
    expect(g.edges).toHaveLength(2);
    for (const e of g.edges) expect(e).not.toHaveProperty('via');
  });

  it('tables that share only a column name: the edge stands on that ground, and carries no relation', () => {
    const g = materializeLinks([SCATTER, YEARS], [], 'crossfilter', SHARED);
    expect(g.edges).toHaveLength(2);
    for (const e of g.edges) expect(e).not.toHaveProperty('via');
  });

  it('a declined edge is unchanged — the reach law still refuses it, and records the refusal as before', () => {
    const apart: TableReach = { relations: [], columns: { planets: ['pl_name'], references: ['ref', 'year'] } };
    const g = materializeLinks([SCATTER, YEARS], [], 'crossfilter', apart);
    expect(g.edges).toEqual([]);
    expect(g.declined?.map((d) => Object.keys(d).sort())).toEqual([
      ['id', 'kind', 'reason', 'source', 'target'],
      ['id', 'kind', 'reason', 'source', 'target'],
    ]);
  });

  it('a graph materialized with NO reach is byte-identical to one built before the key existed — and so is a view with no table', () => {
    const unjudged = materializeLinks([SCATTER, YEARS]);
    expect(JSON.stringify(unjudged)).not.toContain('via');
    const untabled = materializeLinks([{ viewId: 'a', voice: ['point'] }, { viewId: 'b', voice: ['point'], table: 'references' }], [], 'crossfilter', JOINED);
    expect(JSON.stringify(untabled)).not.toContain('via');
  });
});

describe('an EDITED edge carries the same fact (`applyLinkOverrides`, given the relations)', () => {
  const base = materializeLinks([SCATTER, YEARS], [], 'crossfilter', JOINED);
  const id = edgeId(SCATTER.viewId, 'point', YEARS.viewId);

  it('an edit of a base edge keeps `via`; an edit appended over joined tables gains it; a fold given no relations writes none', () => {
    const edited = applyLinkOverrides(base, new Map([[id, { source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'highlight' }]]), JOINED.relations);
    expect(edited.edges.find((e) => e.id === id)).toEqual({ id, source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'highlight', origin: 'edited', via: [RADIUS_REF] });
    // appended: the base under `linkDefault: 'none'` never had the edge, and the edit still crosses joined tables
    const silent = materializeLinks([SCATTER, YEARS], [], 'none', JOINED);
    const appended = applyLinkOverrides(silent, new Map([[id, { source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'filter' }]]), JOINED.relations);
    expect(appended.edges).toEqual([{ id, source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'filter', origin: 'edited', via: [RADIUS_REF] }]);
    // no relations handed in: the edited edge is written exactly as before this key existed
    const bare = applyLinkOverrides(base, new Map([[id, { source: SCATTER.viewId, kind: 'point', target: YEARS.viewId, response: 'highlight' }]]));
    expect(bare.edges.find((e) => e.id === id)).not.toHaveProperty('via');
  });
});
