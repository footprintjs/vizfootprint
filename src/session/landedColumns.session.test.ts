/**
 * ONE KNOWLEDGE OF A TABLE'S COLUMNS — `why()` and the overview judge a bare
 * `rows` table from what the engine LANDED (`session.ts` · `tableReachAt`,
 * reading `runtime.landedColumns`; `narrowedAt` is the one judgement both ask).
 *
 * Before this, three judges of "does this table have this column" did not
 * share what they knew: the read door asked the engine on every read, the
 * overview asked it again per poll and judged from that, and `why()` —
 * synchronous — could ask only the definition, so on a table declared as bare
 * `rows` it stayed silent where the other two spoke. Now the landing is learned
 * once (`../def/landedColumns.def.test.ts` pins who writes it) and every
 * synchronous judge reads it. Pinned here: `why()` marks the clause it could not
 * before, the overview's answer is UNCHANGED from what its own engine reading
 * gave (`./narrowedFor.session.test.ts` is the proof, untouched — the two agree
 * by construction now, not by luck), a re-land that brings the column takes the
 * mark away, a table nothing described answers def-only, a derived column on a
 * bare table is still known, and the mapped-aim exemption holds for both judges.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync, layerAddress } from '../def/index.js';
import type { DashboardDef, DashboardRuntime, SourceAdapter } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { Measure } from '../derive/index.js';
import type { WhyResult } from '../why/index.js';
import { reject, type DataProvider } from '../data/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { unjudgeableWords } from './clausesReaching.js';
import { fakeSqlBackend } from '../data/sqlConnection.coverage.helpers.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');
/** The commit set as flat rows — id, role, response, and the narrowed column when the answer marked one (`./why.narrowed.test.ts`'s reader). */
const rows = (r: WhyResult): unknown[] =>
  (r.ok ? r.commits : []).map((c) => [c.id, c.kind, ...(c.response !== undefined ? [c.response] : []), ...(c.narrowed !== undefined ? [`narrowed:${c.narrowed.column}`] : [])]);

/** The not-ok shape: a marked clause is no anchor, and with no other candidate the picture is the definition's — but the miss NAMES what reached it (`./why.narrowed.test.ts`). */
const reached = (r: WhyResult): unknown => (r.ok ? 'ok' : { missing: r.missing, reached: r.reached });

const SHEET_LAYER = layerAddress('table', 'sheet');
const NO_RADIUS_ON_SHEET = unjudgeableWords('sheet', 'radius');

/**
 * AG's own shape (`./narrowedFor.session.test.ts` · `bareRowsBeside`): `main`
 * declares its columns and carries `radius`; `sheet` is bare `rows` — no
 * `columns` key, `undeclared` to the definition — and the `table` view's layer
 * reads it. A brush on `main.radius` reaches `table~sheet` through the
 * crossfilter default on the shared `planet`, where `sheet` has no `radius`.
 */
function bareRowsBeside(sheet: DashboardDef['data'][string] = { rows: [{ planet: 'X', name: 'row' }], key: 'planet' }): DashboardDef {
  return {
    meta: { title: 'bare rows' },
    data: {
      main: { rows: [{ id: 'm1', planet: 'X', radius: 2.4 }], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' } } },
      sheet,
    },
    actors: { main: { actor: 'user', label: 'Main' }, table: { actor: 'user', label: 'Table' } },
    encodings: [
      { viewId: 'main', chartKind: 'histogram', channels: ['x'], initial: { x: 'radius' } },
      { viewId: 'table', chartKind: 'bar', channels: ['x'], layers: [{ layerId: 'sheet', table: 'sheet', chartKind: 'bar', channels: ['x'], initial: { x: 'name' } }] },
    ],
    defaultTable: 'main',
  } as DashboardDef;
}

describe('why() on a consumer over a bare `rows` table — the clause it could never mark before', () => {
  it('lists the reaching clause WITH `narrowed`, in the read door’s own words, and the overview names the same column for the same consumer', async () => {
    const s = buildDashboard(bareRowsBeside()).createSession();
    const brush = await s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    // BEFORE: `{ ok: true, … commits: [[brush, 'declaring', 'filter']] }` — the brush ANCHORED the answer, credited as the
    // reason for a picture it never shaped, because the definition declared no columns for `sheet` and `why()` had nothing
    // else to ask. AFTER: it is no anchor, and the miss names it, marked — the shape a DECLARED table has always given.
    expect(reached(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual({
      missing: 'declared-in-def',
      reached: [{ id: id(brush), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radius', reason: NO_RADIUS_ON_SHEET } }],
    });
    // the overview: the SAME judgement (`narrowedAt`), so the chip and the flagship answer cannot part ways here
    const o = await s.overview();
    expect(o.activeSelections[0]?.narrowedFor).toEqual({ [SHEET_LAYER]: { column: 'radius', reason: NO_RADIUS_ON_SHEET, label: 'Table' } });
    // …and the read door, which asks the engine live, narrows the same clause — three judges, one answer
    const q = await s.viewQuery({ viewId: SHEET_LAYER });
    expect(q.ok && q.clauses[0]?.narrowed).toEqual({ column: 'radius', reason: NO_RADIUS_ON_SHEET });
  });

  it('beside a judgeable clause, the marked one rides as a reaching-clause and the judgeable one anchors — exactly a declared table’s shape', async () => {
    // a third view over `main` (a view holds ONE live clause, so the two clauses must come from two sources)
    const base = bareRowsBeside();
    const def = { ...base, actors: { ...base.actors, other: { actor: 'user', label: 'Other' } }, encodings: [...base.encodings!, { viewId: 'other', chartKind: 'point', channels: ['x'], initial: { x: 'planet' } }] } as DashboardDef;
    const s = buildDashboard(def).createSession();
    const brush = await s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    const pick = await s.dispatch({ verb: 'select', viewId: 'other', field: 'planet', value: 'X', cause });
    const res = s.why({ kind: 'chart', viewId: SHEET_LAYER });
    expect(rows(res)).toEqual([
      [id(pick), 'declaring', 'filter'],
      [id(brush), 'reaching-clause', 'filter', 'narrowed:radius'],
    ]);
    expect(res.ok && res.commits[1]?.narrowed).toEqual({ column: 'radius', reason: NO_RADIUS_ON_SHEET });
  });

  it('a column the bare table DOES carry is judged plainly — no mark, byte-identical to before', async () => {
    const s = buildDashboard(bareRowsBeside()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'main', field: 'planet', value: 'X', cause });
    expect(rows(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual([[id(pick), 'declaring', 'filter']]);
    expect('narrowedFor' in (await s.overview()).activeSelections[0]!).toBe(false);
  });

  it('the shared fixture (`data`, bare `rows`): a clause on a real column is credited exactly as it always was', async () => {
    // `./why.narrowed.test.ts` pins this answer as the def-only one; it is unchanged because `category` LANDED
    const s = buildDashboard(makeDashboardDef()).createSession();
    const older = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause });
    const newest = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(newest), 'declaring', 'filter'],
      [id(older), 'reaching-clause', 'filter'],
    ]);
  });
});

describe('a LAZY wasm table (AK review target 1): the overview must not regress from what it marked at 5bed521', () => {
  it('overview().narrowedFor and why() both mark it — the first read pays for the lazy landing, and `WasmBackend.whenLanded` learns it the moment that read does (`../def/wasmBackend.ts`, `../def/wasmEngine.def.test.ts`)', async () => {
    const backend = fakeSqlBackend();
    const dash = buildDashboard(bareRowsBeside({ rows: [{ planet: 'X', name: 'row' }], key: 'planet', engine: 'wasm' } as DashboardDef['data'][string]), { openSqlConnection: async () => backend });
    const s = dash.createSession();
    const brush = await s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    // BEFORE AK (5bed521): `overview()` awaited `effectiveColumnsOf('sheet')` for the Sources projection, paying for
    // the lazy landing, and handed that live list to the narrowing walk — `radius` was `absent`, and the entry was PRESENT.
    // A naive AK regressed this to permanently absent (the sync door never asks a lazy table); this pins the fix.
    const o = await s.overview();
    expect(o.activeSelections[0]?.narrowedFor).toEqual({ [SHEET_LAYER]: { column: 'radius', reason: NO_RADIUS_ON_SHEET, label: 'Table' } });
    // …and `why()` must agree with the overview — one knowledge, three judges (the same law this whole packet exists for)
    expect(reached(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual({
      missing: 'declared-in-def',
      reached: [{ id: id(brush), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radius', reason: NO_RADIUS_ON_SHEET } }],
    });
  });
});

describe('the sync door scheduling window: nothing commits a clause before `learnLanded`s microtask', () => {
  it('an un-awaited dispatch has not committed by the exact same tick — `doProbe` itself awaits `effectiveColumnsOf` before it writes the log, so there is no clause to mis-judge before the window closes, and the commit judges correctly once it lands', async () => {
    const s = buildDashboard(bareRowsBeside()).createSession();
    // fired but NOT awaited: if the library could commit a clause synchronously, `why()` asked in this
    // exact same tick would already see it and would have to judge it against a still-empty registry
    const pending = s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    // same tick, zero microtasks have run: `doProbe` itself has an `await` (`effectiveColumnsOf`) before its
    // own commit, so nothing has landed yet — there is NOTHING to mark, honestly, not a false absence
    expect(s.why({ kind: 'chart', viewId: SHEET_LAYER })).toEqual({ ok: false, missing: 'declared-in-def', target: { kind: 'chart', viewId: SHEET_LAYER } });
    const brush = await pending;
    expect(brush.ok).toBe(true);
    // the commit is in NOW, and it judges correctly: `learnLanded` was scheduled at BUILD, strictly before this
    // dispatch was even called, over the same one-hop `columns()` read `doProbe`'s own `effectiveColumnsOf` just
    // paid — it cannot still be pending by the time a same-depth chain started later has resolved
    expect(reached(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual({
      missing: 'declared-in-def',
      reached: [{ id: id(brush), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radius', reason: NO_RADIUS_ON_SHEET } }],
    });
  });
});

describe('a re-land moves the knowledge: the column arrives, the mark goes', () => {
  it('after a refresh whose new rows carry the column, why() no longer marks the clause, the version moved, and the registry holds the new one', async () => {
    let current: { rows: readonly Record<string, unknown>[]; version: string } = { rows: [{ planet: 'X', name: 'row' }], version: 'v1' };
    const carrier: SourceAdapter = {
      via: 'http',
      open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async () => ({ rows: [...current.rows], version: current.version, retrievedAt: 'now' }), close: async () => {} }),
    };
    const dash = await buildDashboardAsync(bareRowsBeside({ source: { format: 'rows', via: 'http', at: 'https://example.test/sheet' }, key: 'planet' } as DashboardDef['data'][string]), { sources: [carrier] });
    const s = dash.createSession();
    const landed = (s as unknown as { runtime: DashboardRuntime }).runtime.landedColumns;
    const brush = await s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    expect(reached(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual({
      missing: 'declared-in-def',
      reached: [{ id: id(brush), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radius', reason: NO_RADIUS_ON_SHEET } }],
    });
    expect(landed.get('sheet')).toEqual({ version: 'v1', columns: [{ name: 'planet', type: 'string' }, { name: 'name', type: 'string' }] });

    current = { rows: [{ planet: 'X', name: 'row', radius: 2.4 }], version: 'v2' }; // the source now carries `radius`
    expect((await dash.refresh(['sheet'])).tables['sheet']).toMatchObject({ changed: true, from: 'v1', to: 'v2' });
    // the same session, the same clause, no new dispatch: the judge reads the landing, and the landing moved — the brush anchors now
    expect(rows(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual([[id(brush), 'declaring', 'filter']]);
    expect('narrowedFor' in (await s.overview()).activeSelections[0]!).toBe(false);
    expect(dash.sources['sheet']?.version).toBe('v2');
    expect(landed.get('sheet')).toEqual({ version: 'v2', columns: [{ name: 'planet', type: 'string' }, { name: 'name', type: 'string' }, { name: 'radius', type: 'number' }] });
    // …and the read door, asking the engine live, agrees the clause now judges rows
    const q = await s.viewQuery({ viewId: SHEET_LAYER });
    expect(q.ok && q.clauses[0]?.narrowed).toBeUndefined();
    expect(q.ok && q.count).toBe(1);
  });
});

describe('a table nothing described: the judge answers from the definition alone, as before', () => {
  it('a host provider that refuses `columns()` leaves the entry absent — why() and the overview say nothing, and neither throws', async () => {
    const refuser: DataProvider = {
      engine: 'memory',
      capabilities: { canEvaluateSQL: false, canMaterialize: false },
      tables: async () => [],
      columns: async () => reject('memory', 'columns', 'unknown-table'),
      evaluate: async () => reject('memory', 'evaluate', 'unknown-table'),
      materializeColumn: async () => reject('memory', 'materializeColumn', 'unknown-table'),
    };
    const s = buildDashboard(bareRowsBeside(), { providers: { sheet: refuser } }).createSession();
    const brush = await s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    // ignorance narrows nothing: `undeclared`, no mark — the exact answer given before the registry existed
    expect(rows(s.why({ kind: 'chart', viewId: SHEET_LAYER }))).toEqual([[id(brush), 'declaring', 'filter']]);
    expect('narrowedFor' in (await s.overview()).activeSelections[0]!).toBe(false);
  });
});

describe('what stays where it was', () => {
  it('a column an ACT computed on a bare `rows` table is known to why() — the derived overlay rides over a landed list as over a declared one', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    // `ratio` is nowhere in the definition and nowhere in the landing — it exists because this act made it, on this branch
    const made = await s.dispatch({ verb: 'analyze', analysisId: 'ratio', def: { builtin: 'derive', table: 'data', name: 'ratio', column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'price' }, { col: 'rating' }] } } }, cause });
    expect(made.ok).toBe(true);
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'ratio', value: 50, cause });
    expect(pick.ok).toBe(true);
    // a landing-only reading would have called `ratio` absent and marked a clause that filtered plenty
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([[id(pick), 'declaring', 'filter']]);
    expect('narrowedFor' in (await s.overview()).activeSelections[0]!).toBe(false);
  });

  it('an AIM that missed on a bare table stays unmarked in why() too — the read door refuses it by name; the two judges agree (`narrowedAt`)', async () => {
    // `./narrowedFor.session.test.ts` (g) pins the overview's half of this; `why()` now judges from the same list and keeps the same exemption
    const s = buildDashboard(makeDashboardDef()).createSession();
    const linked = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'category', to: 'nonexistent' }], cause });
    const aimed = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    // unmarked, and so it anchors — a mark here would soften an authoring error into an ordinary miss; the link edit rides beside it as it always has
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(aimed), 'declaring', 'filter'],
      [id(linked), 'link-edit'],
    ]);
    expect('narrowedFor' in (await s.overview()).activeSelections[0]!).toBe(false);
    expect(await s.viewQuery({ viewId: 'scatter' })).toMatchObject({ ok: false, reason: 'engine', engineReason: 'unknown-column' });
  });

  it('a mapped aim the DEFINITION itself knows is missing (a minted table outran its static declaration) stays MARKED — the exemption never applies off a landing, and why() agrees with the overview (`./narrowedFor.session.test.ts`, (e))', async () => {
    // `radii_per_planet` is a MINTED table, not a landed one — `tableReachAt` sets its columns from `derivedTablesAt()`
    // before the landed-list loop even runs, so it is never in `ReachAt.landed` and the mapped-aim exemption cannot apply
    const ROWS = [
      { id: 'm1', planet: 'Kepler-22b', radius: 2.4, mass: 9.1 },
      { id: 'm2', planet: 'Kepler-22b', radius: 2.1, mass: 8.4 },
      { id: 'm3', planet: 'TRAPPIST-1e', radius: 0.9, mass: 0.7 },
    ];
    const RADII: Measure = { as: 'radii', expr: { op: 'sum', args: [{ col: 'radius' }] } };
    const MASS_TOTAL: Measure = { as: 'massTotal', expr: { op: 'sum', args: [{ col: 'mass' }] } };
    const HIST = layerAddress('hist', 'agg');
    // statically, the def declares `radii_per_planet` WITH `massTotal` (so the link door accepts the mapping)…
    const statically: DashboardDef = {
      meta: { title: 'radii' },
      data: { measurements: { rows: ROWS, key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' }, mass: { role: 'measure' } } } },
      actors: { scatter: { actor: 'user', label: 'The scatter' }, hist: { actor: 'user', label: 'The histogram' } },
      analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII, MASS_TOTAL] } },
      links: [{ source: 'scatter', kind: 'point', target: HIST, response: 'filter', mapping: [{ from: 'mass', to: 'massTotal' }] }],
      encodings: [{ viewId: 'hist', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'agg', table: 'radii_per_planet', chartKind: 'bar', channels: ['x', 'y'], initial: { y: 'radii' } }] }],
      defaultTable: 'measurements',
    } as DashboardDef;
    const s = buildDashboard(statically).createSession();
    // …but the analysis that actually RUNS mints only `radii`: the live record wins, so `massTotal` is absent, not undeclared
    await s.declareAnalysis('radiiPerPlanet', { cause, def: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII] } });
    const picked = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    const massTotalMissing = { column: 'massTotal', reason: unjudgeableWords('radii_per_planet', 'massTotal') };
    expect(reached(s.why({ kind: 'chart', viewId: HIST }))).toEqual({
      missing: 'declared-in-def',
      reached: [{ id: id(picked), kind: 'reaching-clause', response: 'filter', narrowed: massTotalMissing }],
    });
    const row = (await s.overview()).activeSelections[0]!;
    expect(row.narrowedFor).toEqual({ [HIST]: { ...massTotalMissing, label: 'The histogram' } });
  });
});
