/**
 * A CLAUSE TRAVELS A RELATION — CALL-COUNT PINS (review packet AL, target 3).
 *
 * `via.session.test.ts` pins the VALUES a seek/undo/replay reads back; this
 * file pins the ENGINE COST of reading them back — a wrapped provider counts
 * `evaluate` calls, so a regression that re-asks the engine on a synchronous
 * read (seek, undo) or asks it more than once per stale (source clause, near
 * column) at the next engine-side door (replay's closing overview) fails
 * here even though the VALUES it returns would still be right.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import { memoryProvider, type DataProvider, type EvaluateOptions } from '../data/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

const PLANETS = [
  { pl_name: 'Kepler-22b', radius_ref: 'ref-A' },
  { pl_name: 'TRAPPIST-1e', radius_ref: 'ref-B' },
  { pl_name: 'HD 209458 b', radius_ref: 'ref-A' },
  { pl_name: 'GJ 1214 b', radius_ref: 'ref-C' },
  { pl_name: 'Unrefereed', radius_ref: null },
];
const REFERENCES = [
  { ref: 'ref-A', year: 2011 },
  { ref: 'ref-B', year: 2017 },
  { ref: 'ref-C', year: 2009 },
  { ref: 'ref-D', year: 2020 },
];
const RADIUS_REF = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const LABEL = 'where the composite took its accepted radius from';
const SCATTER = layerAddress('mass_radius', 'planets');
const YEARS = layerAddress('by_year', 'references');
const THREE = ['Kepler-22b', 'TRAPPIST-1e', 'HD 209458 b'];
const TRAVELLED = { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] };

/** A `planets` provider that counts every `evaluate` ask projecting the near column (`radius_ref`) — the travel's own signature. */
function countingPlanets(): { provider: DataProvider; near: () => number } {
  const real = memoryProvider(PLANETS, { tableName: 'planets' });
  let calls = 0;
  const provider: DataProvider = {
    ...real,
    evaluate: async (table, clause, options?: EvaluateOptions) => {
      if (options?.columns?.includes('radius_ref') === true) calls++;
      return real.evaluate(table, clause, options);
    },
  };
  return { provider, near: () => calls };
}

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

describe('a seek reads a stored travel record back with NO engine call', () => {
  it('pick A, pick B (replaces), seek to A: the ask count does not move', async () => {
    const { provider, near } = countingPlanets();
    const s = buildDashboard(exoplanets(), { providers: { planets: provider } }).createSession();
    const first = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: THREE, cause });
    const second = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: 'GJ 1214 b', cause });
    expect(near()).toBe(2); // one ask per landed clause, at dispatch
    const before = near();
    expect(s.seek(id(first)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual(TRAVELLED);
    expect(near()).toBe(before); // read back from `travelledByCommit`, not re-asked
    expect(s.seek(id(second)).ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.clause).toEqual({ kind: 'match', field: 'ref', values: ['ref-C'] });
    expect(near()).toBe(before); // still no engine call — this is also a stored record
  });
});

describe('an undo makes no engine call when it reverts a selection to none', () => {
  it('undo of the only pick clears it — a clear never travels, so the ask count does not move', async () => {
    const { provider, near } = countingPlanets();
    const s = buildDashboard(exoplanets(), { providers: { planets: provider } }).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: THREE, cause });
    expect(near()).toBe(1);
    const undone = await s.undo(id(pick));
    expect(undone.ok).toBe(true);
    expect(s.clausesFor(YEARS)).toEqual([]);
    expect(near()).toBe(1); // undoing to "nothing selected" is a clear — `travelFor` is never called for one
  });
});

describe('a replayed log holds no travel record: the next engine-side door asks once per stale (source, near column)', () => {
  it('one live source, one near column: the closing overview of `replay` asks the engine exactly once', async () => {
    const source = buildDashboard(exoplanets()).createSession();
    await source.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: THREE, cause });
    const { provider, near } = countingPlanets();
    const s = buildDashboard(exoplanets(), { providers: { planets: provider } }).createSession();
    expect(near()).toBe(0);
    const replayed = await s.replay(source.log.records);
    expect(replayed.ok).toBe(true);
    expect(near()).toBe(1); // `retravelStale` refolds the one live record it inherited with no set, once
    const again = await s.overview();
    expect(again.activeSelections[0]?.travelled?.[YEARS]?.clause).toEqual(TRAVELLED);
    expect(near()).toBe(1); // the record is no longer stale — a second engine-side door asks nothing further
  });
});

describe('a read door never pays for travel when nothing is stale', () => {
  it('one dispatch with travel; three `viewQuery`s and two `overview`s ask the engine exactly once in total', async () => {
    const { provider, near } = countingPlanets();
    const s = buildDashboard(exoplanets(), { providers: { planets: provider } }).createSession();
    await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: THREE, cause });
    expect(near()).toBe(1); // the one ask, at dispatch
    await s.viewQuery({ viewId: YEARS });
    await s.viewQuery({ viewId: YEARS });
    await s.viewQuery({ viewId: YEARS });
    await s.overview();
    await s.overview();
    expect(near()).toBe(1); // nothing stale — no read door re-asks
  });
});

describe('a re-land of the CONSUMER (far) table alone', () => {
  it('bumps the record stale and re-asks the source even though the near values, and so the IN-list, are unchanged', async () => {
    const { provider, near } = countingPlanets();
    let refRows = { rows: [...REFERENCES], version: 'r1' };
    const refCarrier = {
      via: 'http' as const,
      open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async () => ({ rows: [...refRows.rows], version: refRows.version, retrievedAt: 'now' }), close: async () => {} }),
    };
    const def = exoplanets();
    const sourced = {
      ...def,
      data: { ...def.data, references: { source: { format: 'rows', via: 'http', at: 'https://example.test/references' }, key: 'ref', columns: def.data['references']!.columns } },
    } as DashboardDef;
    const { buildDashboardAsync } = await import('../def/index.js');
    const dash = await buildDashboardAsync(sourced, { sources: [refCarrier], providers: { planets: provider } });
    const s = dash.createSession();
    await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: THREE, cause });
    expect(near()).toBe(1);
    // the far table re-lands — its ROWS did not change in a way that touches `ref`, but the version moved
    refRows = { rows: [...REFERENCES], version: 'r2' };
    expect((await dash.refresh(['references'])).tables['references']).toMatchObject({ changed: true, from: 'r1', to: 'r2' });
    const q = await s.viewQuery({ viewId: YEARS });
    expect(q.ok && q.clauses[0]?.clause).toEqual(TRAVELLED); // the IN-list is unchanged — the near values never moved
    expect(near()).toBe(2); // …but the SOURCE was re-asked anyway: staleness is keyed to EVERY declared table's version, not just the near side's
  });
});
