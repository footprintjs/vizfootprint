/**
 * Relations on the dashboard def — the edges between TABLES. Six laws
 * (src/def/README.md, "Relations"), each pinned here: every refusal sentence
 * the door speaks, the identity law, the conditional column check (declared
 * columns at the door, the engine's columns post-build), the frozen runtime,
 * the overview echo, the surface part, and the revision moving when an edge
 * is added — and law 6, the permission an analysis reads another table under.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, validateDashboardDef, relationEdgeId, joinsTables, relationsFrom, judgeAnalysisReads, neighbourhoodEndpoints, RELATION_KINDS } from './index.js';
import type { DashboardDef, RelationDecl, RelationEdge, RelationKind } from './index.js';
import { defRevision } from './revision.js';
import { vizAsTools, SURFACE_PARTS, cacheClassOf } from '../agent/index.js';

/** Three tables: `cells` declares no columns, `nodes` has a key, `edges` declares columns without a key. */
const graphDef = (): DashboardDef => ({
  data: {
    cells: { rows: [{ disease: 'A', jurisdiction: 'TX', cases: 3 }] },
    nodes: { rows: [{ disease: 'A', cases_total: 3 }], key: 'disease', columns: { disease: { role: 'identifier' }, cases_total: { role: 'measure' } } },
    edges: { rows: [{ source: 'A', target: 'B', weight: 1 }], columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
  },
  actors: { v: { actor: 'user' } },
  defaultTable: 'cells',
});

const SOURCE: RelationDecl = { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' } };
const TARGET: RelationDecl = { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'disease' }, kind: 'one-to-one', label: 'the other end' };

/** The def with `relations` spliced in as whatever the test hands over — the door judges the raw value. */
const withRelations = (relations: unknown): unknown => ({ ...graphDef(), relations });

describe('relations at the def door — every refusal is a sentence', () => {
  it('a well-formed declaration is accepted, and `relations` is a known top-level key', () => {
    expect(validateDashboardDef(withRelations([SOURCE, TARGET]))).toEqual([]);
    expect(validateDashboardDef(withRelations(undefined))).toEqual([]);
  });

  it('the list and each entry must have the shape { from, to, kind?, label? } — unknown keys named', () => {
    expect(validateDashboardDef(withRelations('nope'))).toEqual(['relations, if present, must be an array of { from, to }']);
    expect(validateDashboardDef(withRelations([null]))).toEqual(['relations[0] must be an object { from, to, kind?, label? }']);
    expect(validateDashboardDef(withRelations([{ ...SOURCE, extra: 1 }]))).toEqual(['relations[0]: unknown key "extra"']);
  });

  it('an end is exactly { table, column } with non-empty strings — a missing column, an empty one and a bare string are refused; an extra key is named and the end is still judged', () => {
    const from = 'relations[0].from must be { table, column } with non-empty strings';
    const to = 'relations[0].to must be { table, column } with non-empty strings';
    expect(validateDashboardDef(withRelations([{ from: { table: 'edges' }, to: SOURCE.to }]))).toEqual([from]);
    expect(validateDashboardDef(withRelations([{ from: { table: 'edges', column: '' }, to: SOURCE.to }]))).toEqual([from]);
    expect(validateDashboardDef(withRelations([{ from: SOURCE.from, to: 'nodes.disease' }]))).toEqual([to]);
    expect(validateDashboardDef(withRelations([{}]))).toEqual([from, to]);
    // the offending key is quoted, the way a relation's own unknown key is — and a well-formed end beside it is judged, not skipped
    expect(validateDashboardDef(withRelations([{ from: { table: 'edges', column: 'source', x: 1 }, to: SOURCE.to }]))).toEqual(['relations[0].from: unknown key "x"']);
    expect(validateDashboardDef(withRelations([{ from: { table: 'edges', column: 'ghost', x: 1 }, to: { ...SOURCE.to, y: 2 } }]))).toEqual([
      'relations[0].from: unknown key "x"',
      'relations[0].to: unknown key "y"',
      'relations[0].from.column "ghost" is not a declared column of "edges"',
    ]);
  });

  it('law 3: both tables must be declared, and the sentence names the tables that are', () => {
    expect(validateDashboardDef(withRelations([{ from: { table: 'ghost', column: 'x' }, to: SOURCE.to }]))).toEqual(['relations[0].from.table "ghost" is not a declared data table — the tables are cells, nodes, edges']);
    expect(validateDashboardDef(withRelations([{ from: SOURCE.from, to: { table: 'ghost', column: 'x' } }]))).toEqual(['relations[0].to.table "ghost" is not a declared data table — the tables are cells, nodes, edges']);
  });

  it('law 2 at the door: from.column must be a declared column WHEN the table declares its columns; a table without them is judged post-build', () => {
    expect(validateDashboardDef(withRelations([{ from: { table: 'edges', column: 'ghost' }, to: SOURCE.to }]))).toEqual(['relations[0].from.column "ghost" is not a declared column of "edges"']);
    // `cells` declares no columns: the door has nothing to judge against, and says nothing (lintData will)
    expect(validateDashboardDef(withRelations([{ from: { table: 'cells', column: 'ghost' }, to: SOURCE.to }]))).toEqual([]);
    // a declared column is an OWN key of `columns`: a prototype name is not one, at the door and at the key it mirrors
    for (const column of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(validateDashboardDef(withRelations([{ from: { table: 'edges', column }, to: SOURCE.to }]))).toEqual([`relations[0].from.column "${column}" is not a declared column of "edges"`]);
    }
    const keyed = { ...graphDef(), data: { ...graphDef().data, nodes: { ...graphDef().data['nodes'], key: 'constructor' } } };
    expect(validateDashboardDef(keyed)).toEqual(['data["nodes"].key "constructor" is not a declared column']);
  });

  it('law 1: a relation points at an identity — the target table must declare a key, and to.column must be that key', () => {
    expect(validateDashboardDef(withRelations([{ from: SOURCE.from, to: { table: 'cells', column: 'disease' } }]))).toEqual(['relations[0].to "cells.disease" — declare data["cells"].key first; a relation points at an identity']);
    expect(validateDashboardDef(withRelations([{ from: SOURCE.from, to: { table: 'nodes', column: 'cases_total' } }]))).toEqual(['relations[0].to.column "cases_total" is not the key of "nodes" — the key is "disease"; a relation points at an identity']);
  });

  it('law 3: a self-join is refused in this version, and an edge is declared once', () => {
    expect(validateDashboardDef(withRelations([{ from: { table: 'nodes', column: 'cases_total' }, to: SOURCE.to }]))).toEqual(['relations[0] joins "nodes" to itself — not in this version']);
    expect(validateDashboardDef(withRelations([SOURCE, { ...SOURCE, label: 'again' }]))).toEqual(['relations[1] repeats the edge edges.source → nodes.disease']);
    expect(relationEdgeId(SOURCE.from, SOURCE.to)).toBe('edges.source → nodes.disease');
    // the repeat check keys by the four names, not by their spelling: `a.b`.`c` and `a`.`b.c` are two edges
    const dotted = {
      ...graphDef(),
      data: { ...graphDef().data, 'a.b': { rows: [], columns: { c: { role: 'dimension' } } }, a: { rows: [], columns: { 'b.c': { role: 'dimension' } } } },
      relations: [{ from: { table: 'a.b', column: 'c' }, to: SOURCE.to }, { from: { table: 'a', column: 'b.c' }, to: SOURCE.to }],
    };
    expect(validateDashboardDef(dotted)).toEqual([]);
  });

  it('law 4: kind is one of the two declared cardinalities; label is a string', () => {
    expect(RELATION_KINDS).toEqual(['many-to-one', 'one-to-one']);
    expect(validateDashboardDef(withRelations([{ ...SOURCE, kind: 'many-to-many' }]))).toEqual(['relations[0].kind must be one of many-to-one|one-to-one']);
    expect(validateDashboardDef(withRelations([{ ...SOURCE, label: 42 }]))).toEqual(['relations[0].label must be a string']);
  });

  it('a table refused on its own line is not refused again through a relation, at either end; a malformed or empty table map is not judged at all', () => {
    const bad = { ...graphDef(), data: { ...graphDef().data, bad: 'nope' }, relations: [{ from: { table: 'bad', column: 'x' }, to: SOURCE.to }, { from: SOURCE.from, to: { table: 'bad', column: 'x' } }] };
    // `bad` IS declared, so neither end is "not a declared data table" — and "declare its key first" is no advice for a string
    expect(validateDashboardDef(bad)).toEqual(['data["bad"] must be an object { rows | csv, engine? }']);
    const noData = validateDashboardDef({ ...graphDef(), data: 'nope', relations: 'nope' });
    expect(noData).toContain('data must be an object mapping table name -> { rows | csv | source }');
    expect(noData).not.toContain('relations, if present, must be an array of { from, to }');
    // the empty map is refused on its own line; no table sentence is spoken that would name no tables
    const empty = validateDashboardDef({ ...graphDef(), data: {}, relations: [SOURCE] });
    expect(empty).toContain('data must declare at least one table');
    expect(empty.some((p) => p.startsWith('relations'))).toBe(false);
  });
});

describe('relations on the runtime and the overview', () => {
  it('the runtime writes each kind out and is frozen; the overview echoes the same object, never re-derived; a def without relations serves []', async () => {
    const def: DashboardDef = { ...graphDef(), relations: [SOURCE, TARGET] };
    const session = buildDashboard(def).createSession();
    const o = await session.overview();
    expect(o.relations).toEqual([
      { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' }, kind: 'many-to-one' },
      { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'disease' }, kind: 'one-to-one', label: 'the other end' },
    ]);
    // the def's own declaration is untouched: the default was written onto the runtime, not back into the def
    expect(def.relations![0]!.kind).toBeUndefined();
    // and the served shape SAYS so: `RelationEdge.kind` is required, so a reader never writes `?? 'many-to-one'`
    const served: RelationKind = o.relations[0]!.kind;
    expect(served).toBe('many-to-one');
    expect(Object.isFrozen(o.relations)).toBe(true);
    expect(Object.isFrozen(o.relations[0])).toBe(true);
    expect(Object.isFrozen(o.relations[0]!.from)).toBe(true);
    expect(() => {
      (o.relations as unknown as unknown[]).push('x');
    }).toThrow();
    // the keys precedent: a frozen build-time constant is handed back by reference, so two reads are one object
    expect((await session.overview()).relations).toBe(o.relations);
    const plain = await buildDashboard(graphDef()).createSession().overview();
    expect(plain.relations).toEqual([]);
    expect(Object.isFrozen(plain.relations)).toBe(true);
  });

  it('law 2 post-build: lintData judges every relation\'s source column against the engine, the way it judges a key', async () => {
    const good = buildDashboard({ ...graphDef(), relations: [{ from: { table: 'cells', column: 'disease' }, to: SOURCE.to }] });
    expect(await good.lintData()).toEqual([]);
    const bad = buildDashboard({ ...graphDef(), relations: [SOURCE, { from: { table: 'cells', column: 'ghost' }, to: SOURCE.to }] });
    expect(await bad.lintData()).toEqual(['relations[1].from.column "ghost" names no column of "cells" — the columns are disease, jurisdiction, cases']);
    // an engine that cannot list columns is named as such, never mistaken for a missing column
    const stub = buildDashboard({ ...graphDef(), data: { ...graphDef().data, cells: { rows: [], engine: 'wasm' } }, relations: [{ from: { table: 'cells', column: 'disease' }, to: SOURCE.to }] }, { availableEngines: ['memory', 'wasm'] });
    expect((await stub.lintData())[0]).toMatch(/^relations\[0\]\.from\.column "disease": the engine cannot list this table's columns — /);
  });

  it('the revision moves when a relation is added — a relation is part of the declaration', () => {
    const base = graphDef();
    expect(defRevision({ ...base, relations: [SOURCE] })).not.toBe(defRevision(base));
    expect(buildDashboard({ ...base, relations: [SOURCE] }).revision).toBe(defRevision({ ...base, relations: [SOURCE] }));
  });
});

describe('relations on the agent surface', () => {
  it('`relations` is a part beside `tables`, with the same policy, and whats_here serves it on request', async () => {
    const at = SURFACE_PARTS.findIndex((p) => p.part === 'relations');
    expect(SURFACE_PARTS[at - 1]!.part).toBe('tables');
    expect(SURFACE_PARTS[at]).toEqual({ part: 'relations', scope: 'global', stability: 'immutable', cacheClass: cacheClassOf('global', 'immutable') });
    const session = buildDashboard({ ...graphDef(), relations: [SOURCE, TARGET] }).createSession({ as: 'agent' });
    const port = vizAsTools(session, { as: 'agent' });
    const a = (await port.call('viz.whats_here', { of: ['relations'] })) as Record<string, unknown>;
    expect(a['ok']).toBe(true);
    expect(a['relations']).toEqual((await session.overview()).relations);
    expect((a['omitted'] as { part: string }[]).some((o) => o.part === 'tables')).toBe(true);
    expect('tables' in a).toBe(false);
  });
});

describe('law 6 — a relation is a PERMISSION to read across', () => {
  /** The two edges as the runtime carries them (`kind` written out) — the shape `judgeAnalysisReads` is handed. */
  const edges = (): readonly RelationEdge[] => [{ ...SOURCE, kind: 'many-to-one' }, { ...TARGET, kind: 'one-to-one' }];
  const tables = ['cells', 'nodes', 'edges'];

  it('a join is a join in either direction — the arrow points at an identity, not at a reader', () => {
    expect(joinsTables(edges(), 'nodes', 'edges')).toBe(true);
    expect(joinsTables(edges(), 'edges', 'nodes')).toBe(true);
    expect(joinsTables(edges(), 'cells', 'nodes')).toBe(false);
  });

  it('FOLLOWING one, though, runs one way: the edges hold the columns, the nodes hold the key', () => {
    // the join `bringOver` walks — from the table that POINTS at the table pointed AT
    expect(relationsFrom(edges(), 'edges', 'nodes').map((r) => [r.from.column, r.to.column])).toEqual([
      ['source', 'disease'],
      ['target', 'disease'],
    ]);
    // …and nothing comes back the other way without an aggregate nobody asked for
    expect(relationsFrom(edges(), 'nodes', 'edges')).toEqual([]);
    expect(relationsFrom(edges(), 'cells', 'nodes')).toEqual([]);
  });

  it('a permitted read says nothing, from either end, and reading nothing is permitted', () => {
    expect(judgeAnalysisReads('layout', 'nodes', ['edges'], tables, edges())).toEqual([]);
    expect(judgeAnalysisReads('bringOver', 'edges', ['nodes'], tables, edges())).toEqual([]);
    expect(judgeAnalysisReads('plain', 'cells', [], tables, edges())).toEqual([]);
  });

  it('an undeclared table is refused by name, and a declared one no relation joins is refused with the advice', () => {
    expect(judgeAnalysisReads('layout', 'nodes', ['ghost'], tables, edges())).toEqual([
      'analysis "layout" reads table "ghost", which is not a declared data table — the tables are cells, nodes, edges',
    ]);
    expect(judgeAnalysisReads('layout', 'nodes', ['cells'], tables, edges())).toEqual([
      'analysis "layout" reads table "cells", which no declared relation joins to "nodes" — declare the relation first',
    ]);
  });

  it('a read of its OWN table is named as that, not sent to declare a self-join the relation door refuses (law 3)', () => {
    expect(judgeAnalysisReads('layout', 'nodes', ['nodes'], tables, edges())).toEqual([
      'analysis "layout" reads table "nodes", which is the table it already runs over — `reads` names the tables BESIDE it',
    ]);
    // and the advice the OTHER sentence gives — "declare the relation first" —
    // really would be refused for this pair
    expect(validateDashboardDef(withRelations([{ from: { table: 'nodes', column: 'cases_total' }, to: SOURCE.to }]))).toEqual([
      'relations[0] joins "nodes" to itself — not in this version',
    ]);
  });

  it('the table the analysis RUNS OVER is judged first, and alone — a typo there is not the read\u2019s fault', () => {
    // Blaming the read would quote "edges", a perfectly good table, and ask for
    // a relation to "ndoes" that the def door would itself refuse.
    expect(judgeAnalysisReads('layout', 'ndoes', ['edges'], tables, edges())).toEqual([
      'analysis "layout" runs over table "ndoes", which is not a declared data table — the tables are cells, nodes, edges',
    ]);
    // an analysis that reads nothing beside its own table is unchanged by that judge
    expect(judgeAnalysisReads('layout', 'ndoes', [], tables, edges())).toEqual([]);
  });

  it('every problem at once, one sentence each — the judge never throws and never stops at the first', () => {
    expect(judgeAnalysisReads('layout', 'nodes', ['ghost', 'cells', 'edges'], tables, edges())).toHaveLength(2);
    expect(judgeAnalysisReads('layout', 'nodes', ['edges'], tables, [])).toHaveLength(1); // a dashboard that declares no relation permits no read
  });
});

describe('law 7 — the walk\u2019s two columns: an edge is two relations at one identity', () => {
  const TIES: RelationEdge[] = [
    { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' }, kind: 'many-to-one' },
    { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'disease' }, kind: 'many-to-one' },
  ];

  it('either end names the SAME pair, in declaration order — so a gesture on either lands the same bytes', () => {
    expect(neighbourhoodEndpoints(TIES, 'edges', 'source')).toEqual({ fields: ['source', 'target'] });
    expect(neighbourhoodEndpoints(TIES, 'edges', 'target')).toEqual({ fields: ['source', 'target'] });
  });

  it('a table that declares no relation at all is refused by name — there is no edge to walk', () => {
    expect(neighbourhoodEndpoints(TIES, 'cells', 'disease')).toEqual({
      rejected: 'table "cells" declares no relation, so "disease" is not an endpoint — a neighbourhood is walked over an edge, and an edge is two columns naming one identity',
    });
    expect(neighbourhoodEndpoints([], 'edges', 'source')).toEqual({
      rejected: 'table "edges" declares no relation, so "source" is not an endpoint — a neighbourhood is walked over an edge, and an edge is two columns naming one identity',
    });
  });

  it('a column that is not an endpoint is refused, and the endpoints it could have named are quoted', () => {
    expect(neighbourhoodEndpoints(TIES, 'edges', 'weight')).toEqual({
      rejected: '"edges.weight" is not an endpoint — the endpoints of "edges" are source, target',
    });
  });

  it('one end is no edge, and three ends is not one either — both refusals count the columns', () => {
    expect(neighbourhoodEndpoints([TIES[0]!], 'edges', 'source')).toEqual({
      rejected: '"edges" names "nodes.disease" through one column (source) — a neighbourhood walks an edge with exactly two ends',
    });
    const three: RelationEdge[] = [...TIES, { from: { table: 'edges', column: 'via' }, to: { table: 'nodes', column: 'disease' }, kind: 'many-to-one' }];
    expect(neighbourhoodEndpoints(three, 'edges', 'via')).toEqual({
      rejected: '"edges" names "nodes.disease" through 3 columns (source, target, via) — a neighbourhood walks an edge with exactly two ends',
    });
  });

  it('the pair is the ends naming ONE identity — a third relation to another table is not part of the walk', () => {
    const mixed: RelationEdge[] = [...TIES, { from: { table: 'edges', column: 'week' }, to: { table: 'weeks', column: 'iso' }, kind: 'many-to-one' }];
    expect(neighbourhoodEndpoints(mixed, 'edges', 'source')).toEqual({ fields: ['source', 'target'] });
    expect(neighbourhoodEndpoints(mixed, 'edges', 'week')).toEqual({
      rejected: '"edges" names "weeks.iso" through one column (week) — a neighbourhood walks an edge with exactly two ends',
    });
  });
});
