/**
 * A CLAUSE TRAVELS A RELATION — THE WASM ENGINE'S HALF, judged with no WASM
 * bundle in the room (`../data/sqlConnection.coverage.helpers.ts` ·
 * `fakeSqlBackend`, the AK precedent in `./landedColumns.session.test.ts`).
 *
 * WHAT is pinned here, and what is not: the fake does not evaluate a `WHERE`
 * — which rows a clause keeps is `memoryProvider`'s law, pinned against real
 * rows in `./via.session.test.ts` — so the ASK is the assertion. The travel
 * must send the source table's SQL engine ONE projection of the near column
 * under the clause (`SELECT "radius_ref" … WHERE ("pl_name" IN (…))`), read the
 * answer's near values back deduplicated with nulls dropped, and take the
 * engine's own COUNT as `via.rows`. The fake answers every row, so the set it
 * yields is every reference the planets cite — hand-counted below.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import { fakeSqlBackend } from '../data/sqlConnection.coverage.helpers.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

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
];
const RADIUS_REF = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const SCATTER = layerAddress('mass_radius', 'planets');
const YEARS = layerAddress('by_year', 'references');

/** The exoplanet shape with `planets` on the wasm engine — the relation is the same, only the engine that folds the near values differs. */
function exoplanetsOnWasm(): DashboardDef {
  return {
    meta: { title: 'exoplanets on wasm' },
    data: {
      planets: { rows: [...PLANETS], key: 'pl_name', engine: 'wasm', columns: { pl_name: { role: 'identifier' }, radius_ref: { role: 'dimension' } } },
      references: { rows: [...REFERENCES], key: 'ref', columns: { ref: { role: 'identifier' }, year: { role: 'measure' } } },
    },
    actors: { mass_radius: { actor: 'user', label: 'Mass–radius' }, by_year: { actor: 'user', label: 'Discoveries by year' } },
    encodings: [
      { viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'radius_ref' } }] },
      { viewId: 'by_year', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'references', table: 'references', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'year' } }] },
    ],
    relations: [{ ...RADIUS_REF, label: 'where the composite took its accepted radius from' }],
    defaultTable: 'planets',
  } as DashboardDef;
}

describe('the travel through the wasm engine', () => {
  it('asks the SQL backend for ONE projection of the near column under the clause, and reads the set back deduplicated, nulls dropped, with the engine\'s count', async () => {
    const backend = fakeSqlBackend();
    const s = buildDashboard(exoplanetsOnWasm(), { openSqlConnection: async () => backend }).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', values: ['Kepler-22b', 'TRAPPIST-1e'], cause });
    expect(pick.ok).toBe(true);
    // THE ASK: the near column projected under the pick's own predicate — one statement, once
    const travels = backend.asked.filter((sql) => sql.startsWith('SELECT "radius_ref"'));
    expect(travels).toEqual(['SELECT "radius_ref" FROM "planets" WHERE ("pl_name" IN (\'Kepler-22b\', \'TRAPPIST-1e\'))']);
    // THE ANSWER: the fake hands every landed row back (a WHERE is not its law), so the set is every reference cited — each once, the null gone
    expect(s.clausesFor(YEARS)).toEqual([
      {
        from: SCATTER,
        fromLabel: 'Mass–radius',
        response: 'filter',
        clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B', 'ref-C'] },
        via: { path: [RADIUS_REF], label: 'where the composite took its accepted radius from', rows: PLANETS.length, from: { kind: 'match', field: 'pl_name', values: ['Kepler-22b', 'TRAPPIST-1e'] } },
      },
    ]);
    // …and the years, on the memory engine, judge that set as any match
    const q = await s.viewQuery({ viewId: YEARS });
    expect(q.ok && [q.count, q.clauses[0]?.narrowed]).toEqual([REFERENCES.length, undefined]);
    expect((await s.overview()).activeSelections[0]?.travelled?.[YEARS]).toMatchObject({ clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B', 'ref-C'] }, label: 'Discoveries by year' });
  });

  it('a backend that refuses the projection: the act lands, the years keep the narrowed reading, the gap quotes the engine', async () => {
    const backend = fakeSqlBackend({ fail: (sql) => (sql.startsWith('SELECT "radius_ref"') ? 'Binder Error: the fold went away' : undefined) });
    const s = buildDashboard(exoplanetsOnWasm(), { openSqlConnection: async () => backend }).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: SCATTER, field: 'pl_name', value: 'Kepler-22b', cause });
    expect(pick.ok).toBe(true);
    expect(s.clausesFor(YEARS)[0]?.via).toBeUndefined();
    expect((await s.overview()).activeSelections[0]?.narrowedFor?.[YEARS]?.column).toBe('pl_name');
    expect(s.gaps().map((g) => [g.code, g.detail.includes('could not travel planets.radius_ref → references.ref'), g.detail.includes('Binder Error: the fold went away')])).toEqual([['needs-backend-data', true, true]]);
  });
});
