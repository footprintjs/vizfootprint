/**
 * THE DEMO'S OWN SHAPE — a histogram with a voice over a table an aggregate
 * mints, and the crossfilter default.
 *
 * This is the break a consumer hit: the default rule minted an edge from that
 * view to every other view, each `response: 'filter'`, each handing a clause
 * naming a column of the minted table and of no other. The engine refused the
 * WHOLE read (`table "measurements" has no column "radii"`) and killed the
 * export, and the definition had to declare `response: 'none'` on all ten
 * edges by hand.
 *
 * Both halves of the fix are pinned here: the MAP declines an edge whose clause
 * could never reach the target's table (law 1), and the READ narrows away
 * whatever the declaration could not see and REPORTS it on the clause
 * (laws 2 and 3) — so the read succeeds and the reason is where a reader of the
 * sheet already looks.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { Measure } from '../derive/index.js';
import { exportFromSession } from './export.js';
import { reject, type DataProvider } from '../data/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

const ROWS = [
  { id: 'm1', planet: 'Kepler-22b', radius: 2.4, mass: 9.1 },
  { id: 'm2', planet: 'Kepler-22b', radius: 2.1, mass: 8.4 },
  { id: 'm3', planet: 'TRAPPIST-1e', radius: 0.9, mass: 0.7 },
];

const RADII: Measure = { as: 'radii', expr: { op: 'sum', args: [{ col: 'radius' }] } };
const HIST = layerAddress('hist', 'agg');

/**
 * The demo, in three views: two over the declared table, one drawing the table
 * the act mints — and it keeps its voice (`eaded69`).
 *
 * @param groupBy - `['planet']` mints a table that SHARES the parent's group
 *   column, which is the demo's real shape (law 1 cannot decline it, and law 2
 *   carries the read); `[]` mints one whose only column is the measure, which
 *   law 1 can prove unreachable at build.
 */
function exoplanets(groupBy: readonly string[]): DashboardDef {
  return {
    meta: { title: 'radii' },
    data: {
      measurements: {
        rows: [...ROWS],
        key: 'id',
        columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' }, mass: { role: 'measure' } },
      },
    },
    actors: { scatter: { actor: 'user', label: 'The scatter' }, table: { actor: 'user', label: 'The table' }, hist: { actor: 'user', label: 'The histogram' } },
    analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: [...groupBy], measures: [RADII] } },
    encodings: [{ viewId: 'hist', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'agg', table: 'radii_per_planet', chartKind: 'bar', channels: ['x', 'y'], initial: { y: 'radii' } }] }],
    defaultTable: 'measurements',
  } as DashboardDef;
}

describe('the ten hand-declared silences — a minted-table view with a voice, under the crossfilter default', () => {
  it('the read SURVIVES the clause the target cannot judge, the clause is listed with its reason, and the export walks', async () => {
    const s = buildDashboard(exoplanets(['planet'])).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    // the gesture the demo could not afford: a pick on the minted table's own measure
    const picked = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    expect(picked.ok).toBe(true);

    // the MAP still sends it — `radii_per_planet` and `measurements` share `planet`, so law 1 keeps the edge
    expect(s.clausesFor('scatter')).toMatchObject([{ from: HIST, response: 'filter', clause: { field: 'radii', value: 4.5 } }]);
    // …and the READ no longer dies of it: every row is there, and the clause says why it filtered nothing
    const q = await s.viewQuery({ viewId: 'scatter' });
    expect(q.ok && q.count).toBe(ROWS.length);
    expect(q.ok && q.clauses).toMatchObject([
      { from: HIST, response: 'filter', narrowed: { column: 'radii', reason: 'table "measurements" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows' } },
    ]);
    // the second view too — the demo had TEN of these, and none of them needs a declaration now
    const other = await s.viewQuery({ viewId: 'table' });
    expect(other.ok && other.count).toBe(ROWS.length);

    // …and the export the demo lost: it walks, and its receipt names the same clause
    const walked = await exportFromSession(s, { table: 'measurements', viewId: 'scatter', format: 'csv' });
    expect(walked.ok).toBe(true);
    expect(walked.ok && walked.body.split('\n')).toHaveLength(ROWS.length + 1);
    expect(walked.ok && walked.receipt.count).toBe(ROWS.length);
    // the receipt carries the reason too — a reader holding the file can see which clause claimed nothing
    expect(walked.ok && walked.receipt.clauses).toMatchObject([{ from: HIST, narrowed: { column: 'radii' } }]);
  });

  it('narrowing drops a clause a table cannot judge and NEVER one it can — the same view, on the shared group column', async () => {
    const s = buildDashboard(exoplanets(['planet'])).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    // `planet` IS a column of both tables, so this clause is a claim about the parent's rows and must still bite
    await s.dispatch({ verb: 'select', viewId: HIST, field: 'planet', value: 'Kepler-22b', cause });
    const parent = await s.viewQuery({ viewId: 'scatter' });
    expect(parent.ok && parent.count).toBe(2); // two of the three measurements
    expect(parent.ok && parent.clauses.every((c) => c.narrowed === undefined)).toBe(true);
  });

  it('an engine that cannot DESCRIBE its table narrows nothing — refuse on evidence, never on ignorance', async () => {
    const s = buildDashboard(exoplanets(['planet'])).createSession();
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'planet', value: 'Kepler-22b', cause });
    expect(await s.selectedRows()).toHaveLength(2); // the clause is judged, and it bites
    // the schema goes dark: the clause is left exactly as it was, and the read files its own refusal
    const provider = (s as unknown as { runtime: { providerFor(t: string): DataProvider } }).runtime.providerFor('measurements');
    provider.columns = async () => reject('memory', 'columns', 'no-backend-connection', 'the table store is offline');
    expect(await s.selectedRows()).toHaveLength(2); // still filtered by the clause nobody could disprove
  });

  it('law 1: when the minted table shares NO column, the default mints no edge at all and the map says why', async () => {
    const s = buildDashboard(exoplanets([])).createSession();
    const graph = (await s.overview()).links;
    // nothing from the histogram's own address reaches the two views over `measurements`, and nothing reaches it
    expect(graph.edges.some((e) => e.source === HIST || e.target === HIST)).toBe(false);
    expect(graph.declined?.some((d) => d.source === HIST && d.target === 'scatter' && d.reason.includes('no relation joins those tables and they share no column'))).toBe(true);
    // the views over the SAME table keep every edge they had
    expect(graph.edges.some((e) => e.source === 'scatter' && e.target === 'table')).toBe(true);
  });

  // REVIEW FINDING: `doLink` used to call `validateLinks` with no `reach`, so a
  // runtime `link` dispatch never got the refusal the SAME edge gets from the
  // def door — the comment beside that call already promised "the same
  // refusals a declared edge gets, in the same sentences." Reproduced before
  // the fix: the dispatch below returned `ok: true`.
  it('review fix: a runtime link dispatch gets the SAME reach-law door a declared edge gets', async () => {
    const s = buildDashboard(exoplanets([])).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const refused = await s.dispatch({ verb: 'link', source: HIST, kind: 'point', target: 'scatter', response: 'filter', cause });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.rejection.detail).toContain('no relation joins those tables and they share no column');
    // the mapped case too: a mapping onto a column the target table's STATIC declaration does not have
    const badMap = await s.dispatch({ verb: 'link', source: 'scatter', kind: 'point', target: HIST, response: 'filter', mapping: [{ from: 'planet', to: 'bogus' }], cause });
    expect(badMap.ok).toBe(false);
    expect(!badMap.ok && badMap.rejection.detail).toContain('has no column "bogus"');
  });
});
