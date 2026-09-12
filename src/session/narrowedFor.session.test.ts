/**
 * A CLAUSE THAT FILTERED NOTHING SAYS SO WHERE IT WAS SENT — the overview's
 * `SelectionInfo.narrowedFor` (`session.ts` · `reachedBySource`).
 *
 * The law: the session states, once and per consumer, where a live clause
 * filtered nothing; the wire carries it whole; a renderer's fold picks its
 * consumer's entry; the chip says it. No tier infers it from rows or columns,
 * and no consumer resolves a name for itself. The judgement is the SAME one
 * `why({ kind: 'chart' })` makes (`narrowedByDef`, `./clausesReaching.ts`) —
 * never a second one — so every case pinned here is also cross-checked
 * against `why()` or the read door where the two can be asked the same thing.
 *
 * Six paths, named in the packet: (a) the demo's shape, (b) a LAYER consumer
 * keyed by its address, (c) a layer SOURCE, (d) a cleared-`leave` source,
 * (e) an aimed mapping, (f) judged everywhere → the key is absent.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { Measure } from '../derive/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import { unjudgeableWords } from './clausesReaching.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

// ── (a) the demo's shape: two DECLARED tables, a brush over one reaching a sheet over the other ──

const PLANETS = [
  { planet: 'Kepler-22b', discovered: 2011 },
  { planet: 'TRAPPIST-1e', discovered: 2017 },
];
const MEASUREMENTS = [
  { id: 'm1', planet: 'Kepler-22b', radii: 2.4 },
  { id: 'm2', planet: 'Kepler-22b', radii: 2.1 },
  { id: 'm3', planet: 'TRAPPIST-1e', radii: 0.9 },
];
const BINS = layerAddress('radius', 'bins');

/**
 * `planets` is the default table (the sheet reads it); `measurements` is a
 * second declared table that carries `radii`. The `radius` view draws a
 * histogram layer over `measurements`, so a brush there names `radii` — and the
 * crossfilter default carries it to `planets_sheet` on the shared `planet`
 * column, where the table it reads has no `radii` to judge it by.
 */
function twoTables(extra: Partial<DashboardDef> = {}): DashboardDef {
  return {
    meta: { title: 'planets' },
    data: {
      planets: { rows: [...PLANETS], key: 'planet', columns: { planet: { role: 'dimension' }, discovered: { role: 'measure' } } },
      measurements: { rows: [...MEASUREMENTS], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radii: { role: 'measure' } } },
    },
    actors: { radius: { actor: 'user', label: 'Radius' }, planets_sheet: { actor: 'user', label: 'Planets' } },
    encodings: [{ viewId: 'radius', chartKind: 'histogram', channels: ['x'], layers: [{ layerId: 'bins', table: 'measurements', chartKind: 'histogram', channels: ['x'], initial: { x: 'radii' } }] }],
    defaultTable: 'planets',
    ...extra,
  } as DashboardDef;
}

const NO_RADII_ON_PLANETS = unjudgeableWords('planets', 'radii');

describe("(a) the demo's shape — a brush reaching a sheet whose table lacks the column", () => {
  it('the overview row for the brush names the sheet, the column, the one sentence, and the sheet\'s declared label', async () => {
    const s = buildDashboard(twoTables()).createSession();
    const brush = await s.dispatch({ verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], cause });
    expect(brush.ok).toBe(true);
    const o = await s.overview();
    // the row is the brush as it always was, plus ONE key: where it filtered nothing, by consumer
    expect(o.activeSelections).toEqual([
      {
        viewId: BINS,
        field: 'radii',
        kind: 'interval',
        value: [1, 5],
        commitId: id(brush),
        narrowedFor: { planets_sheet: { column: 'radii', reason: NO_RADII_ON_PLANETS, label: 'Planets' } },
      },
    ]);
    // the sentence is the one owner's, byte for byte
    expect(o.activeSelections[0]!.narrowedFor!['planets_sheet']!.reason).toBe('table "planets" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows');
    // the frame view `radius` is NOT a consumer of its own layer's brush (a frame's layers are one place, `../links/materialize.ts`), so it is not a key
    expect(Object.keys(o.activeSelections[0]!.narrowedFor!)).toEqual(['planets_sheet']);
    // …and it is the SAME judgement the read door makes at the sheet, in the same words
    const q = await s.viewQuery({ viewId: 'planets_sheet' });
    expect(q.ok && q.clauses).toEqual([{ from: BINS, fromLabel: 'Radius', response: 'filter', clause: { kind: 'interval', field: 'radii', value: [1, 5] }, narrowed: { column: 'radii', reason: NO_RADII_ON_PLANETS } }]);
    expect(q.ok && q.count).toBe(PLANETS.length); // it filtered nothing there
  });

  it('a consumer with NO declared label has no `label` key — the address is its name (omit, never invent)', async () => {
    const s = buildDashboard(twoTables({ actors: { radius: { actor: 'user' }, planets_sheet: { actor: 'user' } } })).createSession();
    await s.dispatch({ verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], cause });
    const row = (await s.overview()).activeSelections[0]!;
    expect(row.narrowedFor).toEqual({ planets_sheet: { column: 'radii', reason: NO_RADII_ON_PLANETS } });
    expect('label' in row.narrowedFor!['planets_sheet']!).toBe(false);
  });

  it('`filters` (the basis shape) is untouched by the key — it is the same fact as a list, for reading', async () => {
    const s = buildDashboard(twoTables()).createSession();
    await s.dispatch({ verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], cause });
    const o = await s.overview();
    expect(JSON.stringify(o.filters)).not.toContain('narrowedFor');
  });
});

// ── (b)/(c)/(d)/(e-agree): the why.narrowed fixture — a minted table beside a declared one ──

const ROWS = [
  { id: 'm1', planet: 'Kepler-22b', radius: 2.4, mass: 9.1 },
  { id: 'm2', planet: 'Kepler-22b', radius: 2.1, mass: 8.4 },
  { id: 'm3', planet: 'TRAPPIST-1e', radius: 0.9, mass: 0.7 },
];
const RADII: Measure = { as: 'radii', expr: { op: 'sum', args: [{ col: 'radius' }] } };
const MASS_TOTAL: Measure = { as: 'massTotal', expr: { op: 'sum', args: [{ col: 'mass' }] } };
const HIST = layerAddress('hist', 'agg');

/** `./why.narrowed.test.ts`'s shape: two views over `measurements` (declared), one layer over the minted `radii_per_planet`. */
function exoplanets(extra: Partial<DashboardDef> = {}, layerLabel?: string): DashboardDef {
  return {
    meta: { title: 'radii' },
    data: {
      measurements: { rows: [...ROWS], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' }, mass: { role: 'measure' } } },
    },
    actors: { scatter: { actor: 'user', label: 'The scatter' }, table: { actor: 'user', label: 'The table' }, hist: { actor: 'user', label: 'The histogram' } },
    analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII] } },
    encodings: [
      {
        viewId: 'hist',
        chartKind: 'bar',
        channels: ['x', 'y'],
        layers: [{ layerId: 'agg', table: 'radii_per_planet', chartKind: 'bar', channels: ['x', 'y'], initial: { y: 'radii' }, ...(layerLabel !== undefined ? { label: layerLabel } : {}) }],
      },
    ],
    defaultTable: 'measurements',
    ...extra,
  } as DashboardDef;
}

const NO_MASS = unjudgeableWords('radii_per_planet', 'mass');
const NO_RADII = unjudgeableWords('measurements', 'radii');

describe('(b) a LAYER consumer is keyed by its address, named by the layer', () => {
  it('the layer\'s own declared label, under `view~layer`', async () => {
    const s = buildDashboard(exoplanets({}, 'Radii per planet')).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const pick = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    const row = (await s.overview()).activeSelections[0]!;
    // STALE COMMENT FIXED (the frame is its layers, ../def/README.md "Layers" law 6a): `hist` has one
    // layer and no view-level `initial`, so it is a FRAME — no edge reaches its bare address at all,
    // never mind judged (`clausesFor('hist')` is `[]`). `table` genuinely reads `measurements`, which
    // has `mass` — judged, so not a key. Either way only the layer over the minted table is one.
    expect(row.narrowedFor).toEqual({ [HIST]: { column: 'mass', reason: NO_MASS, label: 'Radii per planet' } });
    // the same judgement `why()` makes for that layer — one law, asked twice
    const why = s.why({ kind: 'chart', viewId: HIST });
    expect(why).toEqual({ ok: false, missing: 'declared-in-def', target: { kind: 'chart', viewId: HIST }, reached: [{ id: id(pick), kind: 'reaching-clause', response: 'filter', narrowed: { column: 'mass', reason: NO_MASS } }] });
  });

  it('a layer that declares no label answers with its VIEW\'s label — `fromLabel`\'s order, by the one resolver', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    expect((await s.overview()).activeSelections[0]!.narrowedFor).toEqual({ [HIST]: { column: 'mass', reason: NO_MASS, label: 'The histogram' } });
  });

  it('…and neither label declared: no `label` key, never a view label glued onto a layerId', async () => {
    const s = buildDashboard(exoplanets({ actors: { scatter: { actor: 'user' }, table: { actor: 'user' }, hist: { actor: 'user' } } })).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    expect((await s.overview()).activeSelections[0]!.narrowedFor).toEqual({ [HIST]: { column: 'mass', reason: NO_MASS } });
  });
});

describe('(c) the SOURCE is a layer address — its row carries every consumer it filtered nothing on', () => {
  it('a brush on the minted-table layer reaches both views over the declared table, and both are keys with their labels', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const silent = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    const o = await s.overview();
    expect(o.activeSelections).toEqual([
      {
        viewId: HIST,
        field: 'radii',
        kind: 'point',
        value: 4.5,
        commitId: id(silent),
        narrowedFor: {
          scatter: { column: 'radii', reason: NO_RADII, label: 'The scatter' },
          table: { column: 'radii', reason: NO_RADII, label: 'The table' },
        },
      },
    ]);
    // the read door at each consumer says the same
    for (const viewId of ['scatter', 'table']) {
      const q = await s.viewQuery({ viewId });
      expect(q.ok && q.clauses.find((c) => c.from === HIST)?.narrowed, viewId).toEqual({ column: 'radii', reason: NO_RADII });
    }
  });

  it('a second, judgeable clause beside it carries NO key — the key is per row, and a row that filtered somewhere everywhere has none', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    await s.dispatch({ verb: 'select', viewId: 'table', field: 'planet', value: 'Kepler-22b', cause });
    const rows = (await s.overview()).activeSelections;
    expect(rows.map((r) => [r.viewId, 'narrowedFor' in r])).toEqual([
      [HIST, true],
      ['table', false], // `planet` is a column of `measurements` AND of the minted table (its group column) — judged everywhere
    ]);
  });
});

describe('(d) a cleared source an edge still keeps in force (`onClear: leave`) carries the key on `clearedSelections`', () => {
  it('the remembered clause reaches the `leave` consumer and filters nothing there; the `showAll` consumer forgot it and is no key', async () => {
    // the declared edge keeps the brush in force on the scatter after a clear; the default edge to `table` forgets it
    const s = buildDashboard(exoplanets({ links: [{ source: HIST, kind: 'point', target: 'scatter', response: 'filter', onClear: 'leave' }] })).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    const cleared = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: null, cause });
    const o = await s.overview();
    expect(o.activeSelections).toEqual([]);
    expect(o.clearedSelections).toEqual([
      { viewId: HIST, field: 'radii', kind: 'point', value: 4.5, clearedBy: id(cleared), narrowedFor: { scatter: { column: 'radii', reason: NO_RADII, label: 'The scatter' } } },
    ]);
    // the read door at the scatter still lists the remembered clause, narrowed — the same fact
    const q = await s.viewQuery({ viewId: 'scatter' });
    expect(q.ok && q.clauses).toEqual([{ from: HIST, fromLabel: 'The histogram', response: 'filter', clause: { kind: 'point', field: 'radii', value: 4.5 }, narrowed: { column: 'radii', reason: NO_RADII } }]);
  });

  it('a cleared source whose edges all say `showAll` (the default) reaches nobody — no key on its cleared row', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: 4.5, cause });
    const cleared = await s.dispatch({ verb: 'select', viewId: HIST, field: 'radii', value: null, cause });
    expect((await s.overview()).clearedSelections).toEqual([{ viewId: HIST, field: 'radii', kind: 'point', value: 4.5, clearedBy: id(cleared) }]);
  });
});

/**
 * (e) AN AIM THAT MISSED. The read door REFUSES a clause narrowed on a column
 * an edge's mapping named by hand (`session.ts` · `viewClauses`, "AN AIM THAT
 * MISSED IS NOT AN ACCIDENT"); the overview has no refusal to give — it is a
 * projection — and reports exactly what `narrowedByDef` says, the way `why()`
 * does. Two cases, and they differ for one reason: who knows the table's
 * columns.
 */
describe('(e) an aimed mapping — the read door refuses; the overview reports what the definition can say', () => {
  it('columns the definition never declared: the read door refuses by name (the engine knows the table), the overview says NOTHING (the definition does not)', async () => {
    // `dashboard.fixture.ts`'s `data` table states no `columns`, which is the one shape an aim can miss at read time
    // at all — a declared column list is refused at the def door / the `link` door before any clause is sent
    // (`./why.narrowed.test.ts`, "an AIM that misses is still refused upstream"; `./reach.session.test.ts`, "review fix")
    const s = buildDashboard(makeDashboardDef()).createSession();
    expect((await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'category', to: 'kind' }], cause })).ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    // the read door: refused, naming the link — a refusal only a READ can give
    expect(await s.viewQuery({ viewId: 'scatter' })).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-column', rejected: 'table "data" has no column "kind" — the link from bar maps category → kind' });
    // the overview: `narrowedByDef` answers `undeclared` for a table with no declared columns, so no entry — omit,
    // never invent. The two DIFFER here, and honestly: the projection cannot state what the definition does not
    // hold, and `why()` gives the same silence for the same reason
    const row = (await s.overview()).activeSelections[0]!;
    expect('narrowedFor' in row).toBe(false);
    expect(s.why({ kind: 'chart', viewId: 'scatter' })).toMatchObject({ ok: true });
  });

  it('a column the definition KNOWS is missing (the live minted table outran the static declaration): both name it — the overview marks, the read door refuses', async () => {
    // statically, `radii_per_planet` declares `massTotal`, so the def door accepts a mapping onto it…
    const statically = exoplanets({
      analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII, MASS_TOTAL] } },
      links: [{ source: 'scatter', kind: 'point', target: HIST, response: 'filter', mapping: [{ from: 'mass', to: 'massTotal' }] }],
    });
    const s = buildDashboard(statically).createSession();
    // …but the analysis that actually RUNS mints only `radii`: the live record wins (`tableReachAt`), so `massTotal` is absent
    await s.declareAnalysis('radiiPerPlanet', { cause, def: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII] } });
    await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'mass', value: 9.1, cause });
    expect(s.clausesFor(HIST)).toMatchObject([{ from: 'scatter', clause: { field: 'massTotal' }, mappedFields: [{ from: 'mass', to: 'massTotal' }] }]);
    // the overview MARKS it, in `narrowedByDef`'s words — the same column the refusal below names
    const row = (await s.overview()).activeSelections[0]!;
    expect(row.narrowedFor).toEqual({ [HIST]: { column: 'massTotal', reason: unjudgeableWords('radii_per_planet', 'massTotal'), label: 'The histogram' } });
    // the read door REFUSES it, as an aim that missed — one fact, the register each door has: a projection marks, a read refuses
    expect(await s.viewQuery({ viewId: HIST })).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-column', rejected: 'table "radii_per_planet" has no column "massTotal" — the link from scatter maps mass → massTotal' });
  });
});

describe('(f) judged everywhere → the key is ABSENT, and the overview is byte-identical to before the key existed', () => {
  it('a clause every consumer can judge puts no key on its row — not even `narrowedFor: undefined`', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const o = await s.overview();
    expect(o.activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', commitId: id(pick) }]);
    expect(Object.keys(o.activeSelections[0]!)).toEqual(['viewId', 'field', 'kind', 'value', 'commitId']);
    expect(JSON.stringify(o)).not.toContain('narrowedFor');
  });

  it('a declared-columns dashboard whose clauses all land: the same — the walk ran and found nothing to say', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    // `planet` is a column of `measurements` AND the minted table's group column — judgeable at every consumer
    await s.dispatch({ verb: 'select', viewId: 'table', field: 'planet', value: 'Kepler-22b', cause });
    const o = await s.overview();
    expect(JSON.stringify(o.activeSelections)).not.toContain('narrowedFor');
    expect(JSON.stringify(o.clearedSelections)).toBe('[]');
  });
});

// ── review finding (FIRST TARGET): an ORDINARY miss on a bare `rows` table (no `columns` declared) ──

/**
 * `table`'s only column list is what the ENGINE reads off its rows — the def
 * states none, which is exactly `tableReachOf`'s `undeclared` gap. `main`
 * carries the brushed column; `table`'s layer does not, and no `mapping` is
 * involved (an ordinary miss, not an aimed one) — so this is the case the
 * LANDED REGISTRY closes: the engine's own column list, read once at build
 * and at each re-land (`runtime.landedColumns`) and folded into
 * `tableReachAt()` itself, so `reachedBySource` and the read door judge this
 * ordinary miss from the SAME list with no engine call of its own (this used
 * to be a second reading, `readableColumns`, taken here alone — see
 * `session.ts` · `reachedBySource`'s own WHY for the fold that replaced it).
 */
function bareRowsBeside(): DashboardDef {
  return {
    meta: { title: 'bare rows' },
    data: {
      main: { rows: [{ id: 'm1', planet: 'X', radius: 2.4 }], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' } } },
      sheet: { rows: [{ planet: 'X', name: 'row' }], key: 'planet' }, // no `columns` at all — `undeclared` to the def
    },
    actors: { main: { actor: 'user', label: 'Main' }, table: { actor: 'user', label: 'Table' } },
    encodings: [
      { viewId: 'main', chartKind: 'histogram', channels: ['x'], initial: { x: 'radius' } },
      { viewId: 'table', chartKind: 'bar', channels: ['x'], layers: [{ layerId: 'sheet', table: 'sheet', chartKind: 'bar', channels: ['x'], initial: { x: 'name' } }] },
    ],
    defaultTable: 'main',
  } as DashboardDef;
}

const SHEET_LAYER = layerAddress('table', 'sheet');
const NO_RADIUS_ON_SHEET = unjudgeableWords('sheet', 'radius');

describe('(g) a bare `rows` table with NO declared `columns`: an ordinary miss agrees with the read door', () => {
  it('the overview marks it from the SAME build the read door already narrowed on — no engine call the overview did not already pay for', async () => {
    const s = buildDashboard(bareRowsBeside()).createSession();
    const brush = await s.dispatch({ verb: 'filter', viewId: 'main', field: 'radius', range: [1, 5], cause });
    const o = await s.overview();
    expect(o.activeSelections).toEqual([
      { viewId: 'main', field: 'radius', kind: 'interval', value: [1, 5], commitId: id(brush), narrowedFor: { [SHEET_LAYER]: { column: 'radius', reason: NO_RADIUS_ON_SHEET, label: 'Table' } } },
    ]);
    const q = await s.viewQuery({ viewId: SHEET_LAYER });
    expect(q.ok && q.clauses).toEqual([{ from: 'main', fromLabel: 'Main', response: 'filter', clause: { kind: 'interval', field: 'radius', value: [1, 5] }, narrowed: { column: 'radius', reason: NO_RADIUS_ON_SHEET } }]);
    expect(q.ok && q.count).toBe(1); // it filtered nothing there — same as the overview's own claim
  });

  it('an AIMED miss on the same kind of table stays unmarked here too (the read door refuses it by name instead — untouched by this fallback)', async () => {
    // `bar` (bare `data` table, `dashboard.fixture.ts`) mapped onto a column named by hand that nothing declares or carries
    const s = buildDashboard(makeDashboardDef()).createSession();
    await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', mapping: [{ from: 'category', to: 'nonexistent' }], cause });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const row = (await s.overview()).activeSelections[0]!;
    expect('narrowedFor' in row).toBe(false); // an author's aim, not an ordinary miss — the landed registry finds it too, but the mapped-aim exemption still applies
    expect(await s.viewQuery({ viewId: 'scatter' })).toMatchObject({ ok: false, reason: 'engine', engineReason: 'unknown-column' });
  });
});
