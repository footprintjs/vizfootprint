/**
 * A CLAUSE TRAVELS A RELATION — `session.ts` · `travelOf` / `travelledSets` /
 * `retravelStale`, read through `clausesFor` (`ReachingClause.via`), the
 * overview (`SelectionInfo.travelled`) and `why()` (`TierCommit.via`).
 *
 * The law: a clause reaching a consumer whose table LACKS its column, over an
 * edge a declared relation explains (`LinkEdge.via`), is re-phrased by the
 * engine that holds the source's rows — a semi-join — and arrives as a `match`
 * on the relation's far column, the shape every tier already judges. Where the
 * consumer has the column, the direct path (unchanged); where no relation end
 * reaches, the narrowed reading (unchanged). The sets are held per landing
 * commit, so a seek reads them back with no engine, and folded again where the
 * rows moved from under them.
 *
 * Exoplanet-shaped, counted by hand: five planets, four references, one
 * declared relation `planets.radius_ref → references.ref`.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync, layerAddress } from '../def/index.js';
import type { DashboardDef, DashboardRuntime, SourceAdapter } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { WhyResult } from '../why/index.js';
import { memoryProvider, reject, type DataProvider, type EvaluateOptions } from '../data/index.js';
import { EDGES, NETWORK_RELATIONS, NODES, edgesLayer, makeNetworkDef, nodesLayer } from '../def/network.fixture.js';
import { unjudgeableWords } from './clausesReaching.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

// ── the desk: a scatter over `planets`, a year chart over `references`, joined by one relation ──

const PLANETS = [
  { pl_name: 'Kepler-22b', radius_ref: 'ref-A' },
  { pl_name: 'TRAPPIST-1e', radius_ref: 'ref-B' },
  { pl_name: 'HD 209458 b', radius_ref: 'ref-A' }, // shares its reference with Kepler-22b
  { pl_name: 'GJ 1214 b', radius_ref: 'ref-C' },
  { pl_name: 'Unrefereed', radius_ref: null }, // a null key joins nothing
];
const REFERENCES = [
  { ref: 'ref-A', year: 2011 },
  { ref: 'ref-B', year: 2017 },
  { ref: 'ref-C', year: 2009 },
  { ref: 'ref-D', year: 2020 }, // cited by no planet
];
const RADIUS_REF = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const LABEL = 'where the composite took its accepted radius from';
const SCATTER = layerAddress('mass_radius', 'planets');
const YEARS = layerAddress('by_year', 'references');

function exoplanets(extra: Partial<DashboardDef> = {}): DashboardDef {
  return {
    meta: { title: 'exoplanets' },
    data: {
      planets: { rows: [...PLANETS], key: 'pl_name', columns: { pl_name: { role: 'identifier' }, radius_ref: { role: 'dimension' } } },
      references: { rows: [...REFERENCES], key: 'ref', columns: { ref: { role: 'identifier' }, year: { role: 'measure' } } },
    },
    actors: { mass_radius: { actor: 'user', label: 'Mass–radius' }, by_year: { actor: 'user', label: 'Discoveries by year' } },
    encodings: [
      { viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'radius_ref' } }] },
      { viewId: 'by_year', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'references', table: 'references', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'year' } }] },
    ],
    relations: [{ ...RADIUS_REF, label: LABEL }],
    defaultTable: 'planets',
    ...extra,
  } as DashboardDef;
}

/** The pick the design names: three planets, two of which cite one reference — 3 rows fold to 2 far values. */
const THREE = ['Kepler-22b', 'TRAPPIST-1e', 'HD 209458 b'];
const pickThree = (s: ReturnType<ReturnType<typeof buildDashboard>['createSession']>) => s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: THREE, cause });
const TRAVELLED = { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] };
const VIA = { path: [RADIUS_REF], label: LABEL, rows: 3 };

describe('the pick of three planets reaches the years as a match on `ref`', () => {
  it('`clausesFor(years)`: the travelled clause, `via` naming the relation, its label, the rows and the clause the source made — and NO `narrowed`', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    expect((await pickThree(s)).ok).toBe(true);
    expect(s.clausesFor(YEARS)).toEqual([{ from: SCATTER, fromLabel: 'Mass–radius', response: 'filter', clause: TRAVELLED, via: { ...VIA, from: { kind: 'match', field: 'pl_name', values: THREE } } }]);
    expect('narrowed' in s.clausesFor(YEARS)[0]!).toBe(false);
  });

  it('the window over the years judges it as any match: the two cited references, hand-counted', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await pickThree(s);
    const q = await s.viewQuery({ viewId: YEARS });
    expect(q.ok && [q.count, q.rows.map((r) => r['ref'])]).toEqual([2, ['ref-A', 'ref-B']]);
    expect(q.ok && q.clauses[0]?.narrowed).toBeUndefined();
    // the pick's own window is untouched: a clause never reaches itself, so every planet is there
    const own = await s.viewQuery({ viewId: SCATTER });
    expect(own.ok && [own.count, own.clauses]).toEqual([PLANETS.length, []]);
  });

  it('`why({ kind: "chart" })` on the years: the pick anchors (it was judged) and the row says how it got there — 3 planets → 2 references', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const pick = await pickThree(s);
    const r: WhyResult = s.why({ kind: 'chart', viewId: YEARS });
    expect(r.ok && r.commits).toEqual([{ tier: 'viz', id: id(pick), kind: 'declaring', response: 'filter', via: { ...VIA, values: 2 } }]);
    // …and as a reaching clause beside a newer anchor, the same `via` rides its own row
    await s.dispatch({ verb: 'select', viewId: YEARS, field: 'year', value: 2011, cause });
    const beside = s.why({ kind: 'chart', viewId: YEARS });
    expect(beside.ok && beside.commits.map((c) => [c.kind, c.via?.values])).toEqual([
      ['declaring', undefined],
      ['reaching-clause', 2],
    ]);
  });

  it('the overview row carries `travelled` by consumer, and never `narrowedFor` for the same consumer', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const pick = await pickThree(s);
    const o = await s.overview();
    // the entry carries the CONSUMER's declared name beside the relation's (`TravelledAt.label` — `labelAt`'s answer, `NarrowedAt.label`'s twin)
    expect(o.activeSelections).toEqual([{ viewId: SCATTER, field: 'pl_name', kind: 'match', value: { values: THREE }, commitId: id(pick), travelled: { [YEARS]: { clause: TRAVELLED, via: VIA, label: 'Discoveries by year' } } }]);
    expect(JSON.stringify(o.filters)).not.toContain('travelled'); // the basis shape is untouched
  });

  it('a relation that declares no label, a consumer that declares none: both keys absent — omit, never invent', async () => {
    const s = buildDashboard(exoplanets({ relations: [RADIUS_REF], actors: { mass_radius: { actor: 'user' }, by_year: { actor: 'user' } } })).createSession();
    await pickThree(s);
    const c = s.clausesFor(YEARS)[0]!;
    expect(c.via).toEqual({ path: [RADIUS_REF], rows: 3, from: { kind: 'match', field: 'pl_name', values: THREE } });
    expect((await s.overview()).activeSelections[0]?.travelled?.[YEARS]).toEqual({ clause: TRAVELLED, via: { path: [RADIUS_REF], rows: 3 } });
    await s.dispatch({ verb: 'select', viewId: YEARS, field: 'year', value: 2011, cause }); // a newer anchor, so the pick rides as a reaching clause
    const r = s.why({ kind: 'chart', viewId: YEARS });
    expect(r.ok && r.commits[1]?.via).toEqual({ path: [RADIUS_REF], rows: 3, values: 2 });
  });

  it('a null near value joins nothing: the pick of the unrefereed planet becomes an empty set — matching nothing, honestly', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: 'Unrefereed', cause });
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual({ kind: 'match', field: 'ref', values: [] });
    const q = await s.viewQuery({ viewId: YEARS });
    expect(q.ok && q.count).toBe(0);
  });
});

describe('the set moves with the log: clear, replace, seek', () => {
  it('a clear drops it; a second pick replaces it; a seek back reads the earlier set with no engine in the room', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const first = await pickThree(s);
    const second = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: 'GJ 1214 b', cause });
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-C'] });
    expect(s.clausesFor(YEARS)[0]?.via?.rows).toBe(1);
    // SYNCHRONOUS — the record was written under the first commit when it landed; the seek reads it back
    expect(s.seek(id(first)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
    expect(s.seek(id(second)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-C'] });
    const cleared = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: null, cause });
    expect(cleared.ok).toBe(true);
    expect(s.clausesFor(YEARS)).toEqual([]);
    expect('travelled' in ((await s.overview()).activeSelections[0] ?? {})).toBe(false);
  });

  it('a cleared source an edge still `leave`s in force keeps the travelled clause — under the commit that landed it', async () => {
    const s = buildDashboard(exoplanets({ links: [{ source: SCATTER, kind: 'match', target: YEARS, response: 'filter', onClear: 'leave' }] })).createSession();
    await pickThree(s);
    const cleared = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: null, cause });
    expect(s.clausesFor(YEARS)).toMatchObject([{ from: SCATTER, response: 'filter', clause: TRAVELLED, via: VIA }]);
    const o = await s.overview();
    expect(o.clearedSelections).toEqual([{ viewId: SCATTER, field: 'pl_name', kind: 'match', value: { values: THREE }, clearedBy: id(cleared), travelled: { [YEARS]: { clause: TRAVELLED, via: VIA, label: 'Discoveries by year' } } }]);
    const q = await s.viewQuery({ viewId: YEARS });
    expect(q.ok && q.count).toBe(2);
  });
});

describe('where the clause does NOT travel', () => {
  it('a consumer whose table HAS the column takes the direct path — byte-identical to before', async () => {
    const def = exoplanets();
    const withSheet = { ...def, actors: { ...def.actors, sheet: { actor: 'user' } }, encodings: [...def.encodings!, { viewId: 'sheet', chartKind: 'bar', channels: ['x'], initial: { x: 'pl_name' } }] } as DashboardDef;
    const s = buildDashboard(withSheet).createSession();
    await pickThree(s);
    expect(s.clausesFor('sheet')).toEqual([{ from: SCATTER, fromLabel: 'Mass–radius', response: 'filter', clause: { kind: 'match', field: 'pl_name', values: THREE } }]);
    // the years still get the travelled one; the overview names only the consumer that travelled
    expect(Object.keys((await s.overview()).activeSelections[0]?.travelled ?? {})).toEqual([YEARS]);
  });

  it('a column the edge REMAPPED stays the author\'s aim (mapped-aim law) — no travel; an identity mapping, or one on another field, changes nothing', async () => {
    const aimed = buildDashboard(exoplanets({ links: [{ source: SCATTER, kind: 'match', target: YEARS, response: 'filter', mapping: [{ from: 'pl_name', to: 'ref' }] }] })).createSession();
    await pickThree(aimed);
    expect(aimed.clausesFor(YEARS)).toEqual([{ from: SCATTER, fromLabel: 'Mass–radius', response: 'filter', clause: { kind: 'match', field: 'ref', values: THREE }, mappedFields: [{ from: 'pl_name', to: 'ref' }] }]);
    expect('travelled' in (await aimed.overview()).activeSelections[0]!).toBe(false);
    // an identity pair on the clause's own field is not an aim (the def door refuses one onto a column it can SEE is missing, so the
    // target here is bare `rows` — the door cannot judge it, and the landed list says the column is absent): the clause travels
    const def = exoplanets();
    const bareRefs = { ...def, data: { ...def.data, references: { rows: [...REFERENCES], key: 'ref' } }, links: [{ source: SCATTER, kind: 'match', target: YEARS, response: 'filter', mapping: [{ from: 'pl_name', to: 'pl_name' }] }] } as DashboardDef;
    const identity = buildDashboard(bareRefs).createSession();
    await pickThree(identity);
    expect(identity.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
    const elsewhere = buildDashboard(exoplanets({ links: [{ source: SCATTER, kind: 'match', target: YEARS, response: 'filter', mapping: [{ from: 'radius_ref', to: 'ref' }] }] })).createSession();
    await pickThree(elsewhere);
    expect(elsewhere.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
  });

  it('a `none` edge reaches nothing, so nothing travels; a `highlight` edge travels with its own response', async () => {
    const off = buildDashboard(exoplanets({ links: [{ source: SCATTER, kind: 'match', target: YEARS, response: 'none' }] })).createSession();
    await pickThree(off);
    expect(off.clausesFor(YEARS)).toEqual([]);
    expect('travelled' in (await off.overview()).activeSelections[0]!).toBe(false);
    const lit = buildDashboard(exoplanets({ links: [{ source: SCATTER, kind: 'match', target: YEARS, response: 'highlight' }] })).createSession();
    await pickThree(lit);
    expect(lit.clausesFor(YEARS)).toMatchObject([{ response: 'highlight', clause: TRAVELLED }]);
  });

  it('a `link` edit at run time moves the edge, and the travelled reading follows it: off → gone; back → travelled, response and all', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await pickThree(s);
    expect((await s.dispatch({ verb: 'link', source: SCATTER, kind: 'match', target: YEARS, response: 'none', cause })).ok).toBe(true);
    expect(s.clausesFor(YEARS)).toEqual([]);
    expect((await s.dispatch({ verb: 'link', source: SCATTER, kind: 'match', target: YEARS, response: 'highlight', cause })).ok).toBe(true);
    // the edited edge carries `via` like the base's (`currentGraph` hands the relations to `applyLinkOverrides`), so the set still applies
    expect(s.clausesFor(YEARS)).toMatchObject([{ response: 'highlight', clause: TRAVELLED, via: VIA }]);
  });

  it('a table no listed relation end reaches keeps the narrowed reading it has today', async () => {
    // `other` is bare rows landed as [x]; the relation names a column of it the rows never carried, so no far end is present there
    const def = exoplanets({
      data: { ...exoplanets().data, other: { rows: [{ x: 1 }], key: 'x' } },
      relations: [{ ...RADIUS_REF, label: LABEL }, { from: { table: 'other', column: 'ghost' }, to: { table: 'planets', column: 'pl_name' } }],
      actors: { ...exoplanets().actors, elsewhere: { actor: 'user', label: 'Elsewhere' } },
      encodings: [...exoplanets().encodings!, { viewId: 'elsewhere', chartKind: 'bar', channels: ['x'], layers: [{ layerId: 'other', table: 'other', chartKind: 'bar', channels: ['x'], initial: { x: 'x' } }] }],
    } as Partial<DashboardDef>);
    const s = buildDashboard(def).createSession();
    await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'radius_ref', value: 'ref-A', cause });
    const other = layerAddress('elsewhere', 'other');
    expect(s.clausesFor(other)).toEqual([{ from: SCATTER, fromLabel: 'Mass–radius', response: 'filter', clause: { kind: 'point', field: 'radius_ref', value: 'ref-A' } }]);
    const o = await s.overview();
    expect(o.activeSelections[0]?.narrowedFor).toEqual({ [other]: { column: 'radius_ref', reason: unjudgeableWords('other', 'radius_ref'), label: 'Elsewhere' } });
    expect(Object.keys(o.activeSelections[0]?.travelled ?? {})).toEqual([YEARS]); // the years still travel: a pick on `radius_ref` folds to itself
    expect(o.activeSelections[0]?.travelled?.[YEARS]).toEqual({ clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { ...VIA, rows: 2 }, label: 'Discoveries by year' });
  });

  it('a table nothing describes (its engine cannot list columns) is ignorance, and ignorance travels nothing', async () => {
    const refuser: DataProvider = {
      engine: 'memory',
      capabilities: { canEvaluateSQL: false, canMaterialize: false },
      tables: async () => [],
      columns: async () => reject('memory', 'columns', 'unknown-table'),
      evaluate: async () => reject('memory', 'evaluate', 'unknown-table'),
      materializeColumn: async () => reject('memory', 'materializeColumn', 'unknown-table'),
    };
    const def = exoplanets();
    const bare = { ...def, data: { ...def.data, references: { rows: [...REFERENCES], key: 'ref' } } } as DashboardDef; // no `columns`: the def says nothing
    const s = buildDashboard(bare, { providers: { references: refuser } }).createSession();
    await pickThree(s);
    expect(s.clausesFor(YEARS)).toEqual([{ from: SCATTER, fromLabel: 'Mass–radius', response: 'filter', clause: { kind: 'match', field: 'pl_name', values: THREE } }]);
    expect('travelled' in (await s.overview()).activeSelections[0]!).toBe(false);
  });
});

describe('the engine would not answer: the narrowed reading stands, and the refusal is filed beside the act', () => {
  /** The memory engine for `planets`, refusing (or throwing on) exactly the travel's ask — the projection of the near column. */
  function planetsThat(behaviour: 'refuse' | 'throw'): DataProvider {
    const real = memoryProvider(PLANETS, { tableName: 'planets' });
    return {
      ...real,
      evaluate: async (table, clause, options?: EvaluateOptions) => {
        if (options?.columns?.includes('radius_ref') !== true) return real.evaluate(table, clause, options);
        if (behaviour === 'throw') throw new Error('the connection dropped');
        return reject('memory', 'evaluate', 'no-backend-connection', 'the engine went away');
      },
    };
  }

  it('a REJECTION: the act lands, the years keep the narrowed reading, and a `needs-backend-data` gap names the relation and the consumer', async () => {
    const s = buildDashboard(exoplanets(), { providers: { planets: planetsThat('refuse') } }).createSession();
    const pick = await pickThree(s);
    expect(pick.ok).toBe(true);
    expect(s.clausesFor(YEARS)).toEqual([{ from: SCATTER, fromLabel: 'Mass–radius', response: 'filter', clause: { kind: 'match', field: 'pl_name', values: THREE } }]);
    const o = await s.overview();
    expect(o.activeSelections[0]?.narrowedFor).toEqual({ [YEARS]: { column: 'pl_name', reason: unjudgeableWords('references', 'pl_name'), label: 'Discoveries by year' } });
    expect('travelled' in o.activeSelections[0]!).toBe(false);
    expect(s.gaps().map((g) => [g.code, g.op, g.detail])).toEqual([['needs-backend-data', 'select', `the match on "${SCATTER}" could not travel planets.radius_ref → references.ref to "${YEARS}" — the engine went away`]]);
  });

  it('a THROW is caught the same way — never a throw out of dispatch', async () => {
    const s = buildDashboard(exoplanets(), { providers: { planets: planetsThat('throw') } }).createSession();
    expect((await pickThree(s)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.via).toBeUndefined();
    expect(s.gaps().map((g) => g.detail)).toEqual([`the match on "${SCATTER}" could not travel planets.radius_ref → references.ref to "${YEARS}" — the memory engine threw: the connection dropped`]);
  });

  it('a fold at a READ door (a replayed log has no record) files nothing: a projection does not spend the ledger', async () => {
    const source = buildDashboard(exoplanets()).createSession();
    await pickThree(source);
    const s = buildDashboard(exoplanets(), { providers: { planets: planetsThat('refuse') } }).createSession();
    expect((await s.replay(source.log.records)).ok).toBe(true);
    expect((await s.overview()).activeSelections[0]?.narrowedFor).toBeDefined();
    expect(s.gaps()).toEqual([]);
  });
});

describe('the rows move: the set is folded again at the next door that can ask an engine', () => {
  it('a re-land of the SOURCE (the refresh door bumps its version): the read door and the overview fold the set again; a synchronous read in between serves the record as it stood', async () => {
    let current = { rows: [...PLANETS], version: 'v1' };
    const carrier: SourceAdapter = {
      via: 'http',
      open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async () => ({ rows: [...current.rows], version: current.version, retrievedAt: 'now' }), close: async () => {} }),
    };
    const def = exoplanets();
    const sourced = { ...def, data: { ...def.data, planets: { source: { format: 'rows', via: 'http', at: 'https://example.test/planets' }, key: 'pl_name', columns: def.data['planets']!.columns } } } as DashboardDef;
    const dash = await buildDashboardAsync(sourced, { sources: [carrier] });
    const s = dash.createSession();
    await pickThree(s);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
    // the rows move: TRAPPIST-1e now cites ref-D
    current = { rows: PLANETS.map((p) => (p.pl_name === 'TRAPPIST-1e' ? { ...p, radius_ref: 'ref-D' } : p)), version: 'v2' };
    expect((await dash.refresh(['planets'])).tables['planets']).toMatchObject({ changed: true, from: 'v1', to: 'v2' });
    // the window: a synchronous read serves the record as it stood — the set is folded again at the next engine-side door
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
    const q = await s.viewQuery({ viewId: YEARS });
    expect(q.ok && [q.count, q.clauses[0]?.clause]).toEqual([2, { kind: 'match', field: 'ref', values: ['ref-A', 'ref-D'] }]);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-A', 'ref-D'] });
    expect((await s.overview()).activeSelections[0]?.travelled?.[YEARS]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-A', 'ref-D'] });
    // the record carries the versions it was folded at (`TravelRecord.at`) — a stamp, so a re-land is a fact and not a guess
    const records = (s as unknown as { travelledByCommit: Map<string, { at: Record<string, string | null> }> }).travelledByCommit;
    expect([...records.values()].map((r) => r.at)).toEqual([{ planets: 'v2', references: null }]);
    expect((s as unknown as { runtime: DashboardRuntime }).runtime.sources['planets']?.version).toBe('v2');
  });

  it('a replayed log holds no record: the sets are folded at the next door — the replay\'s own closing overview — and a seek then reads them back', async () => {
    const source = buildDashboard(exoplanets()).createSession();
    const pick = await pickThree(source);
    await source.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: 'GJ 1214 b', cause });
    const s = buildDashboard(exoplanets()).createSession();
    const replayed = await s.replay(source.log.records);
    // `replay` answers with an overview, and that overview is an engine-side door: the TIP's clause is folded by the time it returns…
    expect(replayed.ok && replayed.overview.activeSelections[0]?.travelled?.[YEARS]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-C'] });
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-C'] });
    // …and the EARLIER commit's is not: a seek to it reads no record (the window), the next door folds it, a second seek reads it back
    expect(s.seek(id(pick)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.via).toBeUndefined();
    expect((await s.overview()).activeSelections[0]?.travelled?.[YEARS]?.clause).toEqual(TRAVELLED);
    expect(s.seek(source.head!).ok).toBe(true);
    expect(s.seek(id(pick)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
  });
});

describe('one ask per near column, and the two-column kinds travel too', () => {
  it('two consumers over the far table share ONE engine ask', async () => {
    const real = memoryProvider(PLANETS, { tableName: 'planets' });
    const asks: (readonly string[] | undefined)[] = [];
    const counting: DataProvider = {
      ...real,
      evaluate: async (table, clause, options?: EvaluateOptions) => {
        asks.push(options?.columns);
        return real.evaluate(table, clause, options);
      },
    };
    const def = exoplanets();
    const two = { ...def, actors: { ...def.actors, refs: { actor: 'user' } }, encodings: [...def.encodings!, { viewId: 'refs', chartKind: 'bar', channels: ['x'], layers: [{ layerId: 'sheet', table: 'references', chartKind: 'bar', channels: ['x'], initial: { x: 'ref' } }] }] } as DashboardDef;
    const s = buildDashboard(two, { providers: { planets: counting } }).createSession();
    await pickThree(s);
    expect(asks.filter((a) => a?.includes('radius_ref'))).toHaveLength(1);
    expect(s.clausesFor(layerAddress('refs', 'sheet'))[0]?.clause).toEqual(TRAVELLED);
  });

  it('a CELL on the scatter travels as a match on `ref`', async () => {
    const s = buildDashboard(exoplanets({ capabilities: [{ viewId: 'mass_radius', canProbe: true, encodings: ['point', 'match', 'cell'] }] })).createSession();
    const res = await s.dispatch({ verb: 'select', viewId: SCATTER, fields: ['pl_name', 'radius_ref'], values: ['Kepler-22b', 'ref-A'], cause });
    expect(res.ok).toBe(true);
    expect(s.clausesFor(YEARS)).toMatchObject([{ clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { ...VIA, rows: 1, from: { kind: 'cell', fields: ['pl_name', 'radius_ref'], value: ['Kepler-22b', 'ref-A'] } } }]);
    const cleared = await s.dispatch({ verb: 'select', viewId: SCATTER, fields: ['pl_name', 'radius_ref'], values: null, cause });
    expect(cleared.ok && s.clausesFor(YEARS)).toEqual([]);
  });

  it('a NEIGHBOURHOOD on the edges travels to the nodes over the FIRST relation on the edge — `source`, so the node set is the sources of the ego\'s ties', async () => {
    const EDGES_ADDRESS = layerAddress('net', 'edges');
    const NODES_ADDRESS = layerAddress('net', 'nodes');
    const s = buildDashboard(
      makeNetworkDef([nodesLayer, edgesLayer], {
        relations: NETWORK_RELATIONS,
        capabilities: [{ viewId: 'net', canProbe: true, encodings: ['point', 'neighbourhood'] }],
        links: [{ source: EDGES_ADDRESS, kind: 'neighbourhood', target: NODES_ADDRESS, response: 'filter' }],
      }),
    ).createSession();
    const walk = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: 'cold', cause });
    expect(walk.ok).toBe(true);
    // cold's ego is {cold, flu, strep}; both ties keep both ends in it; their SOURCES are flu and cold — strep, a target only, is not on this path
    expect(s.clausesFor(NODES_ADDRESS)).toMatchObject([{ clause: { kind: 'match', field: 'id', values: ['flu', 'cold'] }, via: { path: [NETWORK_RELATIONS[0]!].map(({ from, to }) => ({ from, to })), label: 'one end of the tie', rows: EDGES.length } }]);
    const q = await s.viewQuery({ viewId: NODES_ADDRESS });
    expect(q.ok && [q.count, NODES.length]).toEqual([2, 3]);
    const cleared = await s.dispatch({ verb: 'select', viewId: EDGES_ADDRESS, field: 'source', seed: null, cause });
    expect(cleared.ok && s.clausesFor(NODES_ADDRESS)).toEqual([]);
  });
});
