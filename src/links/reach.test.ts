/**
 * A DEFAULT EDGE IS A PROMISE THE ENGINE CAN KEEP — the reach law at both
 * doors.
 *
 * Law 1 (the MAP, at build): the `crossfilter` default may only mint an edge
 * whose clause could reach the target's table. Two views over tables no
 * relation joins and no column shares cannot filter one another, so an edge
 * between them is a promise nothing can keep — declined, and RECORDED with its
 * reason so a reader of the map meets it there.
 *
 * The declared-edge door: a hand-written `filter` between two such views is
 * refused by name, in the same words.
 *
 * The other half of the law lives at run time (law 2 / law 3 —
 * `../session/clausesReaching.ts`): whatever a declaration could not see is
 * narrowed at the read and reported on the clause.
 */
import { describe, expect, it } from 'vitest';
import { columnStanding, linksToMermaid, materializeLinks, tablesCanReach, unmappedColumn, unreachableWords, validateLinks, type LinkView, type TableReach } from './index.js';
import { validateDashboardDef } from '../def/index.js';
import { NETWORK_RELATIONS, makeNetworkDef } from '../def/network.fixture.js';

const HIST: LinkView = { viewId: 'hist', voice: ['point'], table: 'radii_per_planet' };
const SCATTER: LinkView = { viewId: 'scatter', voice: ['point'], table: 'measurements' };
const TABLE: LinkView = { viewId: 'table', voice: ['point'], table: 'measurements' };

/** The demo's shape: a minted table beside the declared one, sharing NO column and joined by NO relation. */
const APART: TableReach = { relations: [], columns: { radii_per_planet: ['bucket', 'radii'], measurements: ['planet', 'radius', 'mass'] } };
/** The same two tables, joined. */
const JOINED: TableReach = { ...APART, relations: [{ from: { table: 'radii_per_planet', column: 'bucket' }, to: { table: 'measurements', column: 'planet' } }] };

describe('tablesCanReach — the law, and the four kinds of ignorance it refuses to judge on', () => {
  it('one table judges its own sentences; a relation is a permission; a shared column name is a sentence both sides hear', () => {
    expect(tablesCanReach('measurements', 'measurements', APART)).toBe(true);
    expect(tablesCanReach('radii_per_planet', 'measurements', APART)).toBe(false);
    expect(tablesCanReach('measurements', 'radii_per_planet', APART)).toBe(false); // judged both ways round
    expect(tablesCanReach('radii_per_planet', 'measurements', JOINED)).toBe(true);
    expect(tablesCanReach('measurements', 'radii_per_planet', JOINED)).toBe(true); // a relation is undirected as a permission
    const overlap: TableReach = { relations: [], columns: { a: ['planet', 'x'], b: ['planet', 'y'] } };
    expect(tablesCanReach('a', 'b', overlap)).toBe(true);
  });
  it('answers TRUE on every ignorance — no reach, an unstated table, a table whose columns nothing declares', () => {
    expect(tablesCanReach('a', 'b', undefined)).toBe(true);
    expect(tablesCanReach(undefined, 'measurements', APART)).toBe(true);
    expect(tablesCanReach('radii_per_planet', undefined, APART)).toBe(true);
    expect(tablesCanReach('radii_per_planet', 'nobody_declared_me', APART)).toBe(true);
  });
});

describe('law 1 — the crossfilter default mints only the edges the engine could keep', () => {
  it('no default edge to a view whose table cannot judge its clause, and the declined one is RECORDED with its reason', () => {
    const g = materializeLinks([HIST, SCATTER, TABLE], [], 'crossfilter', APART);
    // scatter ↔ table share their table, so those two edges stand; every edge touching the histogram is declined
    expect(g.edges.map((e) => e.id)).toEqual(['scatter:point→table', 'table:point→scatter']);
    expect(g.declined?.map((d) => d.id)).toEqual(['hist:point→scatter', 'hist:point→table', 'scatter:point→hist', 'table:point→hist']);
    expect(g.declined?.[0]).toEqual({
      id: 'hist:point→scatter',
      source: 'hist',
      kind: 'point',
      target: 'scatter',
      reason: 'view "hist" draws table "radii_per_planet" and view "scatter" draws table "measurements" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there',
    });
    expect(g.declined![0]!.reason).toBe(unreachableWords(HIST, SCATTER)); // the map and the door say it in ONE spelling
  });
  it('two views over RELATED tables keep their edge, and so does a graph with no reach to judge by', () => {
    expect(materializeLinks([HIST, SCATTER], [], 'crossfilter', JOINED).edges.map((e) => e.id)).toEqual(['hist:point→scatter', 'scatter:point→hist']);
    const unjudged = materializeLinks([HIST, SCATTER]);
    expect(unjudged.edges.map((e) => e.id)).toEqual(['hist:point→scatter', 'scatter:point→hist']);
    expect(unjudged).not.toHaveProperty('declined'); // byte-identical to a graph built before this law
  });
  it('a DECLARED edge is untouched by law 1 — the author made a claim, and the def door judges it separately', () => {
    const g = materializeLinks([HIST, SCATTER], [{ source: 'hist', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'bucket', to: 'planet' }] }], 'crossfilter', APART);
    expect(g.edges.map((e) => [e.id, e.origin])).toEqual([['hist:point→scatter', 'declared']]);
    expect(g.declined?.map((d) => d.id)).toEqual(['hist:point→scatter', 'scatter:point→hist']); // the DEFAULT still declined; the declaration appended
  });
  it('the map says why an edge is absent — the mermaid note a reader of the graph meets', () => {
    const drawn = linksToMermaid(materializeLinks([HIST, SCATTER], [], 'crossfilter', APART));
    expect(drawn).toContain('%% no default point edge hist → scatter: view "hist" draws table "radii_per_planet" and view "scatter" draws table "measurements" — no relation joins those tables and they share no column');
    expect(linksToMermaid(materializeLinks([HIST, SCATTER]))).not.toContain('%% no default');
  });
});

describe('the declared-edge door — refused by name where it is knowable at declaration', () => {
  const run = (link: unknown, reach?: TableReach): string[] => {
    const problems: string[] = [];
    validateLinks([link], undefined, [HIST, SCATTER], problems, reach);
    return problems;
  };
  it('refuses a filter between unrelated views, names both tables, and gives the three remedies', () => {
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter' }, APART)).toEqual([
      'links[0]: view "hist" draws table "radii_per_planet" and view "scatter" draws table "measurements" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there. Declare a relation between the tables, map the field to one the target has, or write response: \'none\'',
    ]);
  });
  it('accepts it once a relation joins them, once a mapping names the target\'s column, when the response is not a filter, and when nothing knows the tables', () => {
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter' }, JOINED)).toEqual([]);
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'bucket', to: 'planet' }] }, APART)).toEqual([]);
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'highlight' }, APART)).toEqual([]); // drawn, not queried — law 3 reports it instead
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'none' }, APART)).toEqual([]);
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter' })).toEqual([]);
  });
  // REVIEW FINDING (packet N, law 1): the first cut of this door skipped the
  // MAPPED case entirely, so an author who named a landing column the target
  // table does not have was caught NOWHERE — a mapping only voids the
  // shared-column-name ground, it does not excuse checking the name itself.
  it('refuses a mapping onto a column the target does not have, even though the mapping voids the shared-column ground', () => {
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'bucket', to: 'nonexistent' }] }, APART)).toEqual([
      'links[0]: table "measurements" has no column "nonexistent" — the link from hist maps bucket → nonexistent. Name a column the table has, or write response: \'none\'',
    ]);
    // not knowable when nothing declares the target's columns — the read door catches it instead (`../session/clausesReaching.ts`)
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'bucket', to: 'nonexistent' }] })).toEqual([]);
    // a malformed entry is skipped by this ground (the shape check below refuses it by its own name)
    expect(run({ source: 'hist', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'bucket' }] }, APART)).toEqual(['links[0].mapping, if present, must be an array of { from, to } field names']);
    // a target that states no table is not knowable either way — the mapped ground is skipped, same as the unmapped one
    const NO_TABLE: LinkView = { viewId: 'ghost', voice: ['point'] };
    const problems: string[] = [];
    validateLinks([{ source: 'hist', kind: 'point', target: 'ghost', response: 'filter', mapping: [{ from: 'bucket', to: 'whatever' }] }], undefined, [HIST, NO_TABLE], problems, APART);
    expect(problems).toEqual([]);
  });
  it('the DEF door speaks it, over the tables the definition declares', () => {
    const apart = makeNetworkDef(undefined, { links: [{ source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'filter' }] });
    expect(validateDashboardDef(apart)).toEqual([
      'links[0]: view "net~nodes" draws table "nodes" and view "net~edges" draws table "edges" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there. Declare a relation between the tables, map the field to one the target has, or write response: \'none\'',
    ]);
    // the same edge, with the relations that make `edges` an edge table declared: accepted
    expect(validateDashboardDef(makeNetworkDef(undefined, { relations: NETWORK_RELATIONS, links: [{ source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'filter' }] }))).toEqual([]);
    // the mapped case: the relation joins the tables, but the mapping itself names a column "nodes" does not have
    expect(
      validateDashboardDef(
        makeNetworkDef(undefined, { relations: NETWORK_RELATIONS, links: [{ source: 'net~edges', kind: 'point', target: 'net~nodes', response: 'filter', mapping: [{ from: 'weight', to: 'bogus' }] }] }),
      ),
    ).toEqual(['links[0]: table "nodes" has no column "bogus" — the link from net~edges maps weight → bogus. Name a column the table has, or write response: \'none\'']);
  });
});

describe('columnStanding — the ONE synchronous judge, three answers and no fourth', () => {
  it('present / absent / undeclared — and `undeclared` is the definition saying nothing, not a no', () => {
    expect(columnStanding('measurements', 'planet', APART)).toBe('present');
    expect(columnStanding('measurements', 'radii', APART)).toBe('absent');
    expect(columnStanding('radii_per_planet', 'radii', APART)).toBe('present'); // a minted table's list is complete by construction
    expect(columnStanding('radii_per_planet', 'mass', APART)).toBe('absent');
    // no list at all: a table nothing declares, and no reading handed in
    expect(columnStanding('nobody_declared_me', 'planet', APART)).toBe('undeclared');
    expect(columnStanding('measurements', 'planet', undefined)).toBe('undeclared');
    // a table declaring an EMPTY list is still a list — it says the column is absent
    expect(columnStanding('bare', 'anything', { relations: [], columns: { bare: [] } })).toBe('absent');
  });

  it('ONE OWNER: the aimed-mapping door is this judge asked for `absent` alone', () => {
    const miss = [{ from: 'bucket', to: 'radii' }];
    expect(columnStanding('measurements', 'radii', APART)).toBe('absent');
    expect(unmappedColumn(miss, 'measurements', APART)).toEqual(miss[0]); // the same fact, at the aim door
    // and the other two answers are both "nothing to refuse on" there — a present column, and a table the def is silent about
    expect(unmappedColumn([{ from: 'bucket', to: 'planet' }], 'measurements', APART)).toBeUndefined();
    expect(unmappedColumn(miss, 'nobody_declared_me', APART)).toBeUndefined();
  });
});
