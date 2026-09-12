/**
 * A CLAUSE THAT FILTERED NOTHING IS NOT PROVENANCE — the why door's half of
 * laws 2/3 (`./clausesReaching.ts`).
 *
 * `why({ kind: 'chart' })` names every commit that shaped what a view SHOWS.
 * A selection that reached the view but named a column its table does not have
 * shaped nothing: crediting it is a false claim, and dropping it silently is
 * another (a clause nobody mentions reads as a clause nobody sent). So it is
 * MARKED — `TierCommit.narrowed`, carrying the read door's own sentence — and
 * kept off the ANCHOR.
 *
 * The judgement is synchronous, from the DEFINITION (`../links/reach.ts` ·
 * `columnStanding`), and it has three answers. All three are pinned here: a
 * table that declares its columns, a table an ACT mints, and a table that
 * declares none — where the definition says nothing and so does the answer.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress, validateDashboardDef } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { Measure } from '../derive/index.js';
import type { WhyResult } from '../why/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { NETWORK_RELATIONS, makeNetworkDef } from '../def/network.fixture.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');
/** The commit an `analyze` dispatch landed — it rides under `analysis`, the way every analysis answer carries its commit. */
const actId = (r: { ok: boolean; analysis?: { commit?: { id: string } } }): string => (r.ok && r.analysis?.commit ? r.analysis.commit.id : '');
/** The commit set as flat rows — id, role, and the narrowed column when the answer marked one. */
const rows = (r: WhyResult): unknown[] =>
  (r.ok ? r.commits : []).map((c) => [c.id, c.kind, ...(c.response !== undefined ? [c.response] : []), ...(c.narrowed !== undefined ? [`narrowed:${c.narrowed.column}`] : [])]);

const ROWS = [
  { id: 'm1', planet: 'Kepler-22b', radius: 2.4, mass: 9.1 },
  { id: 'm2', planet: 'Kepler-22b', radius: 2.1, mass: 8.4 },
  { id: 'm3', planet: 'TRAPPIST-1e', radius: 0.9, mass: 0.7 },
];
const RADII: Measure = { as: 'radii', expr: { op: 'sum', args: [{ col: 'radius' }] } };
const HIST = layerAddress('hist', 'agg');
/** A scatter that COLOURS by `dense` — a column no definition declares; `DENSE` is the act that makes it. */
const DRAWS_DENSE = { viewId: 'scatter', chartKind: 'point', channels: ['x', 'y', 'color'], initial: { x: 'radius', y: 'mass', color: 'dense' } } as const;
const DENSE = { builtin: 'derive', table: 'measurements', name: 'dense', column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'mass' }, { col: 'radius' }] } } } as const;

/**
 * The demo's shape (`./reach.session.test.ts`): two views over a table that
 * DECLARES its four columns, one over a table an act MINTS with two — and the
 * shared `planet` keeps the crossfilter edges in both directions, so a clause
 * each way round reaches a table that cannot judge it.
 */
function exoplanets(extra: Partial<DashboardDef> = {}): DashboardDef {
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
    analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII] } },
    encodings: [{ viewId: 'hist', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'agg', table: 'radii_per_planet', chartKind: 'bar', channels: ['x', 'y'], initial: { y: 'radii' } }] }],
    defaultTable: 'measurements',
    ...extra,
  } as DashboardDef;
}

const NO_RADII = 'table "measurements" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows';
const NO_MASS = 'table "radii_per_planet" has no column "mass" — a sentence about a column these rows do not have is not a claim about these rows';

describe("why({ kind: 'chart' }) — a clause that filtered nothing is marked, never credited", () => {
  it('a DECLARED target: the clause it cannot judge rides marked with the read door\'s own sentence, and the judgeable one anchors', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const silent = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    const real = await s.dispatch({ verb: 'select', viewId: 'table', field: 'planet', value: 'Kepler-22b', cause });
    const res = s.why({ kind: 'chart', viewId: 'scatter' });
    // the judgeable clause is the newest thing that shaped the picture, so it anchors;
    // the one the table cannot judge is reported beside it, marked
    expect(rows(res)).toEqual([
      [id(real), 'declaring', 'filter'],
      [id(silent), 'reaching-clause', 'filter', 'narrowed:radii'],
    ]);
    // the MARK quotes the one owner of the sentence — the same words the read door reports
    expect(res.ok && res.commits[1]?.narrowed).toEqual({ column: 'radii', reason: NO_RADII });
    // …and the read door says exactly that about the same clause, in the same words
    const q = await s.viewQuery({ viewId: 'scatter' });
    expect(q.ok && q.clauses.find((c) => c.from === HIST)?.narrowed).toEqual({ column: 'radii', reason: NO_RADII });
  });

  it('NEWEST and unjudgeable is still not the anchor: the older clause that filtered something is', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const real = await s.dispatch({ verb: 'select', viewId: 'table', field: 'planet', value: 'Kepler-22b', cause });
    const silent = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    // `silent` stands LAST on the branch — the anchor law's "newest that shaped it" would
    // have taken it before this packet. It shaped nothing, so it cannot be the reason.
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([
      [id(real), 'declaring', 'filter'],
      [id(silent), 'reaching-clause', 'filter', 'narrowed:radii'],
    ]);
  });

  it('a MINTED target table judges from the act\'s own column list, the same way', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    // `radii_per_planet` is ['planet', 'radii'] by construction — `mass` is a column of the PARENT
    const silent = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    const real = await s.dispatch({ verb: 'select', viewId: 'table', field: 'planet', value: 'Kepler-22b', cause });
    const res = s.why({ kind: 'chart', viewId: HIST });
    expect(rows(res)).toEqual([
      [id(real), 'declaring', 'filter'],
      [id(silent), 'reaching-clause', 'filter', 'narrowed:mass'],
    ]);
    expect(res.ok && res.commits[1]?.narrowed?.reason).toBe(NO_MASS);
  });

  it('nothing else shaped it: the picture really is the definition\'s — and the miss NAMES the clause that reached it, marked', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const silent = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    // A marked clause is no anchor, and there is no other candidate — so the code is
    // the one an untouched chart gets. But a miss names what reached it (omit, never
    // deny, applied to the miss): the reader asked why the picture looks as it does,
    // and the door knows a clause reached it and said nothing about its rows.
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual({
      ok: false,
      missing: 'declared-in-def',
      target: { kind: 'chart', viewId: 'scatter' },
      reached: [{ id: id(silent), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radii', reason: NO_RADII } }],
    });
  });

  it('a chart NOTHING reached: no `reached` key at all — byte-identical to the answer given before the field existed', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    // an untouched chart, then one under acts that reach it not: an analysis that
    // mints a table nobody draws here, and words on another view
    const untouched = { ok: false, missing: 'declared-in-def', target: { kind: 'chart', viewId: 'scatter' } };
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual(untouched);
    await s.declareAnalysis('radiiPerPlanet', { cause });
    expect((await s.dispatch({ verb: 'describe', viewId: 'table', slot: 'title', record: { text: 'Measurements', author: { kind: 'human', by: 'sanjay' } }, cause })).ok).toBe(true);
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual(untouched);
    expect(Object.keys(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual(['ok', 'missing', 'target']);
  });

  it('a derived-column act on the lineage AND a silent clause: both in `reached`, in branch order — the act first because it landed first', async () => {
    // the scatter DRAWS `dense`, a column no definition declares — an act makes it
    const s = buildDashboard(exoplanets({ encodings: [...exoplanets().encodings!, DRAWS_DENSE] })).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const made = await s.dispatch({ verb: 'analyze', analysisId: 'dense', def: DENSE, cause });
    expect(made.ok).toBe(true);
    const silent = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    // neither is an anchor candidate (the act made a column, the clause filtered
    // nothing), so the picture is the definition's — and both are named. The order
    // is the BRANCH's (root → cursor), not the order `shapingCommits` lists roles in:
    // the clause is collected first there, and the act landed first here.
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual({
      ok: false,
      missing: 'declared-in-def',
      target: { kind: 'chart', viewId: 'scatter' },
      reached: [
        { id: actId(made), kind: 'derived-column' },
        { id: id(silent), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radii', reason: NO_RADII } },
      ],
    });
  });

  it('one act that made TWO columns the chart draws is ONE row in `reached` — one row per commit, as in `why()`', async () => {
    // a layout act lands `x` AND `y` in one commit (`../analysis/layout.ts`), and a
    // scatter over the nodes draws both — `shapingCommits` names the act once per column
    const s = buildDashboard(makeNetworkDef(undefined, {
      relations: NETWORK_RELATIONS,
      analyses: { map: { builtin: 'layout', algo: 'stress', table: 'nodes', edges: 'edges', seed: 5, iterations: 6 } },
      actors: { positions: { actor: 'user', label: 'The positions' } },
      encodings: [{ viewId: 'positions', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'x', y: 'y' } }],
    })).createSession();
    const made = await s.declareAnalysis('map', { cause });
    expect(made.materialized).toEqual(['x', 'y']);
    expect(s.why({ kind: 'chart', viewId: 'positions' })).toEqual({
      ok: false,
      missing: 'declared-in-def',
      target: { kind: 'chart', viewId: 'positions' },
      reached: [{ id: made.commit!.id, kind: 'derived-column' }],
    });
  });

  it('an act on a branch this cursor LEFT is not in `reached` — the same admission `why()` gives a related commit', async () => {
    const s = buildDashboard(exoplanets({ encodings: [...exoplanets().encodings!, DRAWS_DENSE] })).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    // a harmless prose act, so there is a real commit to fork from (a session's own root has no id)
    const rootCommit = await s.dispatch({ verb: 'describe', viewId: 'table', slot: 'title', record: { text: 'Measurements', author: { kind: 'human', by: 'sanjay' } }, cause });
    const root = id(rootCommit);
    // MAIN branch: the act that computes `dense` — the one act in this session that ever made that name
    const made = await s.dispatch({ verb: 'analyze', analysisId: 'dense', def: DENSE, cause });
    expect(made.ok).toBe(true);
    // here the act IS on the lineage, and it is the only thing that reached the chart
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual({
      ok: false,
      missing: 'declared-in-def',
      target: { kind: 'chart', viewId: 'scatter' },
      reached: [{ id: actId(made), kind: 'derived-column' }],
    });
    // a SIBLING branch off the root: the chart still draws `dense` (the def binds it), so
    // `shapingCommits` names the act — but it is not on this lineage, and a miss may not
    // credit an act this picture never saw any more than `why()` may
    expect(s.seek(root)).toEqual({ ok: true, cursor: root });
    expect((await s.dispatch({ verb: 'fork', fromCommitId: root, cause })).ok).toBe(true);
    const silent = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    expect(silent.ok).toBe(true);
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toEqual({
      ok: false,
      missing: 'declared-in-def',
      target: { kind: 'chart', viewId: 'scatter' },
      reached: [{ id: id(silent), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'radii', reason: NO_RADII } }],
    });
    // …and the act WAS named on this branch — a judgeable clause makes the answer an
    // `ok` one, where `why()` discloses the same act as `off-branch`. The miss above
    // omitted it for the same reason, not because nothing named it.
    const real = await s.dispatch({ verb: 'select', viewId: 'table', field: 'planet', value: 'Kepler-22b', cause });
    const res = s.why({ kind: 'chart', viewId: 'scatter' });
    expect(res.ok && res.viz.commitId).toBe(id(real));
    expect(res.ok && res.dropped).toEqual([{ id: actId(made), kind: 'derived-column', reason: 'off-branch' }]);
  });

  it('a table that declares NO columns: the definition says nothing, so neither does the answer', async () => {
    // the shared fixture's `data` table declares no `columns` — the judge reads what the engine LANDED instead
    // (`session.ts` · `tableReachAt`, `./landedColumns.session.test.ts`), `category` landed, and every row is
    // byte-identical to the answer given before the marker existed
    const s = buildDashboard(makeDashboardDef()).createSession();
    const older = await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause });
    const newest = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const res = s.why({ kind: 'chart', viewId: 'scatter' });
    expect(res.ok && res.commits).toEqual([
      { tier: 'viz', id: id(newest), kind: 'declaring', response: 'filter' },
      { tier: 'viz', id: id(older), kind: 'reaching-clause', response: 'filter' },
    ]);
  });

  it('a column an ACT computed is not absent: the def-only reading would have marked a clause that filtered plenty', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    // `dense` is nowhere in the definition — it exists because this act made it, on this branch
    const made = await s.dispatch({ verb: 'analyze', analysisId: 'dense', def: { builtin: 'derive', table: 'measurements', name: 'dense', column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'mass' }, { col: 'radius' }] } } }, cause });
    expect(made.ok).toBe(true);
    const pick = await s.dispatch({ verb: 'select', viewId: 'table', field: 'dense', value: 3.79, cause });
    expect(pick.ok).toBe(true);
    // it reached the scatter and judged its rows, so it is credited plainly — no mark.
    // A judgement read from the definition ALONE would have called `dense` absent
    // (`tableReachAt` is why it does not): a false mark is worse than no mark.
    expect(rows(s.why({ kind: 'chart', viewId: 'scatter' }))).toEqual([[id(pick), 'declaring', 'filter']]);
  });

  it('an AIM that misses is still refused upstream — narrowing never became an excuse for a wrong mapping', () => {
    // packet N's law, untouched: a `mapping` naming a column the target declares it lacks is
    // an author error at the DOOR, not a clause to mark quietly at read time
    expect(validateDashboardDef(exoplanets({ links: [{ source: HIST, kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'radii', to: 'bogus' }] }] }))).toEqual([
      'links[0]: table "measurements" has no column "bogus" — the link from hist~agg maps radii → bogus. Name a column the table has, or write response: \'none\'',
    ]);
  });

  /**
   * A REVIEW FINDING, fixed here (`tableReachAt`, `../session/session.ts`): the
   * DEFAULT declaration in `def.analyses` is a fallback, not the only truth.
   * `declareAnalysis(id, { def })` may register a session-local decl for the
   * SAME id (`registerAnalysis` → `this.localAnalyses`, which `this.analysis()`
   * prefers over the runtime's) — and the table it actually mints is what
   * `derivedTablesAt()` records, never written back into the static def. Reading
   * the static def alone judged a column that genuinely exists as `absent`: the
   * exact false mark this whole packet exists to prevent, one level down from
   * the three cases the design law names.
   */
  it('a MINTED table whose ACTUAL analysis outran the static declaration: the live record wins, never the stale one', async () => {
    const A = layerAddress('histA', 'agg');
    const B = layerAddress('histB', 'agg');
    const twoViews: DashboardDef = {
      ...exoplanets(),
      actors: { scatter: { actor: 'user', label: 'S' }, table: { actor: 'user', label: 'T' }, histA: { actor: 'user', label: 'A' }, histB: { actor: 'user', label: 'B' } },
      encodings: [
        { viewId: 'histA', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'agg', table: 'radii_per_planet', chartKind: 'bar', channels: ['x', 'y'], initial: { y: 'radii' } }] },
        { viewId: 'histB', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'agg', table: 'radii_per_planet', chartKind: 'bar', channels: ['x', 'y'], initial: { y: 'radii' } }] },
      ],
    };
    const s = buildDashboard(twoViews).createSession();
    // the STATIC decl mints ['planet', 'radii'] — this OVERRIDE also lands `massTotal`
    const MASS_TOTAL: Measure = { as: 'massTotal', expr: { op: 'sum', args: [{ col: 'mass' }] } };
    await s.declareAnalysis('radiiPerPlanet', { cause, def: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII, MASS_TOTAL] } });
    // `massTotal` REALLY exists on the live `radii_per_planet` — the select succeeds
    const real = await s.dispatch({ verb: 'select', viewId: B, field: 'massTotal', value: 17.5, cause });
    expect(real.ok).toBe(true);
    // and reaching histA, it must be credited plainly — NOT marked `narrowed` against a stale definition
    expect(rows(s.why({ kind: 'chart', viewId: A }))).toEqual([[id(real), 'declaring', 'filter']]);
  });

  it('a SIBLING branch that never ran the override still judges from the static declaration alone — no cross-branch leakage', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    // a harmless prose act, so there is a real commit to fork from — a session's
    // OWN root has no id to seek back to, and prose carries no clause, so it
    // shapes nothing for either branch's `why({kind:'chart'})` below
    const rootCommit = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'Radii', author: { kind: 'human', by: 'sanjay' } }, cause });
    expect(rootCommit.ok).toBe(true);
    const root = id(rootCommit);
    const MASS_TOTAL: Measure = { as: 'massTotal', expr: { op: 'sum', args: [{ col: 'mass' }] } };
    // the MAIN branch runs the override — `radii_per_planet` really has `massTotal` here
    await s.declareAnalysis('radiiPerPlanet', { cause, def: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII, MASS_TOTAL] } });
    expect(s.seek(root)).toEqual({ ok: true, cursor: root });
    // a SIBLING branch off the root: `declareAnalysis` never ran here, so
    // `radii_per_planet` was never minted on this lineage — `derivedTablesAt()`
    // has nothing to override with, and `tableReachAt` must fall back to the
    // def's own STATIC reading (['planet', 'radii']), exactly as it did before
    // this packet touched `tableReachAt` at all
    expect((await s.dispatch({ verb: 'fork', fromCommitId: root, cause })).ok).toBe(true);
    const silentOnSibling = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    expect(silentOnSibling.ok).toBe(true);
    expect(s.why({ kind: 'chart', viewId: HIST })).toEqual({
      ok: false,
      missing: 'declared-in-def',
      target: { kind: 'chart', viewId: HIST },
      // the miss names the clause that reached it — marked against the STATIC reading, as this branch judges
      reached: [{ id: id(silentOnSibling), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'mass', reason: NO_MASS } }],
    });
  });
});
