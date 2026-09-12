/**
 * VIA BENCH — WHAT A CLAUSE'S TRAVEL COSTS, AND WHAT THE SET WEIGHS ON THE WIRE.
 *
 * A clause that reaches a view whose table lacks its column travels a declared
 * relation as a semi-join computed by the source's engine (`src/session/README.md`,
 * "A clause travels a relation"): one projection of the near column under the
 * clause, per near column, at dispatch. Two questions before any ceiling is
 * even discussed, and this bench answers both with numbers rather than guesses:
 *
 *   (a) the SET's size on the wire — `JSON.stringify(activeSelections[i].travelled).length`,
 *       the bytes `whats_here` and the adapter carry per travelled consumer;
 *   (b) the DISPATCH's added latency — the same gesture on the same rows with
 *       the relation declared (the clause travels) and with none (the default
 *       edge is declined by the reach law, nothing travels), on both engines.
 *
 * Two shapes: the exoplanet desk's size (20,598 planets citing 2,000
 * references, uniform keys — synthetic, seeded) and `bench/step0`'s 1,000,000-row
 * CDC cell table beside a 70-row places table whose key is named differently
 * from the cells' column, so a disease pick must TRAVEL to reach it. Both
 * engines are opened the way a session opens them (`buildDashboard` with
 * `engine: 'wasm'` and the shipped `duckdbConnection` opener), and both are
 * measured by `bench/step0-wasm`'s one clock (`createHarness`), so the ratio
 * between two cells is a fact about the engines.
 *
 * The laws are `bench/step0-wasm/README.md`'s: one instrument; the controls
 * first (a dead clock is a fast one); a failure is a measurement, recorded in
 * words; the spread is the MAX under 20 samples. NO ceiling is implemented
 * here or anywhere — `README.md` beside this file states the honest alternative
 * and lets the number decide it.
 */
import { buildDashboard, layerAddress } from '../../src/def/index.js';
import type { BuildDashboardOptions, DashboardDef } from '../../src/def/index.js';
import type { Cause } from '../../src/cause/index.js';
import type { Row } from '../../src/data/index.js';
import { canLoad } from '../../src/data/index.js';
import { duckdbConnection } from '../../src/data/duckdbConnection.js';
import { FALLBACK_SHAPE, mulberry32, synthesize } from '../step0/gen.js';
import { createHarness, spin, type BenchEngine, type Measure } from '../step0-wasm/measure.js';

const say = (line: string): void => void process.stderr.write(`${line}\n`);
const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'bench' };
const reps = (name: string, fallback: number): number => Number(process.env[name] ?? fallback);
/** The repetition budgets — overridable, so a quick look and a quoted number are two different runs on purpose. */
const BUDGET = { exo: { reps: reps('VIA_REPS_EXO', 7), warmup: 1 }, cells: { reps: reps('VIA_REPS_1M', 3), warmup: 1 } };
const harness = createHarness({ reps: BUDGET.exo.reps, warmup: BUDGET.exo.warmup }, say);

/** One wire measurement: the travelled set for one consumer as `whats_here` carries it. */
interface Wire {
  readonly engine: BenchEngine;
  readonly size: string;
  readonly arm: string;
  /** How many far values the set holds. */
  readonly values: number;
  /** `JSON.stringify(travelled).length` — every travelled consumer of the one selection, which here is one. */
  readonly bytes: number;
}
interface Failure {
  readonly engine: BenchEngine;
  readonly size: string;
  readonly arm: string;
  readonly cause: string;
}
const wire: Wire[] = [];
const failures: Failure[] = [];
const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ── The exoplanet shape: planets cite references, uniformly. ─────────────

const EXO_ROWS = 20_598;
const EXO_REFS = 2_000;
const PLANETS = layerAddress('mass_radius', 'planets');
const YEARS = layerAddress('by_year', 'references');

/** `EXO_ROWS` planets, each citing one of `EXO_REFS` references drawn uniformly (seeded), beside a numeric radius for a brush. */
function exoRows(): { readonly planets: Row[]; readonly references: Row[] } {
  const rnd = mulberry32(7);
  const planets: Row[] = new Array(EXO_ROWS);
  for (let i = 0; i < EXO_ROWS; i++) planets[i] = { pl_name: `p${i}`, radius_ref: `ref-${Math.floor(rnd() * EXO_REFS)}`, pl_rade: Math.round(rnd() * 2000) / 100 };
  const references: Row[] = new Array(EXO_REFS);
  for (let i = 0; i < EXO_REFS; i++) references[i] = { ref: `ref-${i}`, year: 1995 + Math.floor(rnd() * 30) };
  return { planets, references };
}

/** The desk: a scatter layer over `planets`, a year chart layer over `references`; `related` declares the relation or not. */
function exoDef(rows: ReturnType<typeof exoRows>, engine: 'memory' | 'wasm', related: boolean): DashboardDef {
  return {
    meta: { title: 'exoplanets (bench)' },
    data: {
      planets: { rows: rows.planets, key: 'pl_name', engine, columns: { pl_name: { role: 'identifier' }, radius_ref: { role: 'dimension' }, pl_rade: { role: 'measure' } } },
      references: { rows: rows.references, key: 'ref', columns: { ref: { role: 'identifier' }, year: { role: 'measure' } } },
    },
    actors: { mass_radius: { actor: 'user', label: 'Mass–radius' }, by_year: { actor: 'user', label: 'Discoveries by year' } },
    encodings: [
      { viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'pl_rade' } }] },
      { viewId: 'by_year', chartKind: 'bar', channels: ['x', 'y'], layers: [{ layerId: 'references', table: 'references', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'year' } }] },
    ],
    ...(related ? { relations: [{ from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' }, label: 'where the composite took its accepted radius from' }] } : {}),
    defaultTable: 'planets',
  } as DashboardDef;
}

// ── The 1M shape: cells name a jurisdiction, places carry it under another name. ──

const CELLS_ROWS = 1_000_000;
const CELLS = layerAddress('grid', 'cells');
const PLACES = layerAddress('map', 'places');

/** `bench/step0`'s CDC cells beside a places table keyed by `code` — the jurisdiction under a name the cells do not carry, so a disease pick must travel. */
function cellsDef(cells: Row[], places: Row[], engine: 'memory' | 'wasm', related: boolean): DashboardDef {
  return {
    meta: { title: 'cells (bench)' },
    data: {
      cells: { rows: cells, engine, columns: { disease: { role: 'dimension' }, jurisdiction: { role: 'dimension' }, kind: { role: 'dimension' }, t: { role: 'dimension' }, cases: { role: 'measure' }, report_state: { role: 'dimension' } } },
      places: { rows: places, key: 'code', columns: { code: { role: 'identifier' }, name: { role: 'dimension' } } },
    },
    actors: { grid: { actor: 'user', label: 'Cells' }, map: { actor: 'user', label: 'Map' } },
    encodings: [
      { viewId: 'grid', chartKind: 'heatmap', channels: ['x', 'y'], layers: [{ layerId: 'cells', table: 'cells', chartKind: 'heatmap', channels: ['x', 'y'], initial: { x: 't', y: 'disease' } }] },
      { viewId: 'map', chartKind: 'bar', channels: ['x'], layers: [{ layerId: 'places', table: 'places', chartKind: 'bar', channels: ['x'], initial: { x: 'name' } }] },
    ],
    ...(related ? { relations: [{ from: { table: 'cells', column: 'jurisdiction' }, to: { table: 'places', column: 'code' } }] } : {}),
    defaultTable: 'cells',
  } as DashboardDef;
}

// ── The engines, opened the way a session opens them. ────────────────────

/** The build options an engine needs: the wasm engine lands its rows lazily through the shipped opener, the memory engine needs nothing. */
async function optionsFor(engine: BenchEngine): Promise<BuildDashboardOptions> {
  if (engine === 'memory') return {};
  const connection = await duckdbConnection()();
  if (!canLoad(connection)) throw new Error('the shipped opener answered a connection that cannot land a table');
  return { openSqlConnection: async () => connection };
}

/** The travelled set the overview carries for the ONE live selection — `undefined` when nothing travelled (the control). */
async function travelledOf(s: ReturnType<ReturnType<typeof buildDashboard>['createSession']>): Promise<{ readonly values: number; readonly bytes: number } | undefined> {
  const o = await s.overview();
  const t = o.activeSelections[0]?.travelled;
  if (t === undefined) return undefined;
  const values = Object.values(t).reduce((n, at) => n + at.clause.values.length, 0);
  return { values, bytes: JSON.stringify(t).length };
}

// ── Section 0: the controls. ─────────────────────────────────────────────

const clock = await harness.timed({ engine: 'memory', arm: 'control: 40 ms block', size: '—', rows: 0, reps: 3, warmup: 0 }, () => spin(40));
say(`control: the clock read a deliberate 40 ms block as ${clock.median.toFixed(1)} ms (median)`);

// ── The exoplanet desk, both engines. ────────────────────────────────────

const exo = exoRows();
for (const engine of ['memory', 'wasm'] as const) {
  const size = `${EXO_ROWS.toLocaleString('en-US')} planets`;
  try {
    const opts = await optionsFor(engine);
    for (const related of [false, true]) {
      const dash = buildDashboard(exoDef(exo, engine, related), opts);
      for (const k of related ? [1, 100, 1_000, 10_000] : [100]) {
        const arm = related ? `dispatch, travels (${k.toLocaleString('en-US')} planets picked)` : `dispatch, no relation (100 planets picked)`;
        const values = Array.from({ length: k }, (_, i) => `p${i}`);
        // a fresh session per arm: the log's growth is not the gesture's cost
        const s = dash.createSession();
        // the first read pays the lazy wasm landing — a warm-up, never a sample (`warmup: 1`)
        await harness.timed({ engine, arm, size, rows: EXO_ROWS, ...BUDGET.exo }, async () => {
          const r = await s.dispatch({ verb: 'select', viewId: PLANETS, field: 'pl_name', values, cause });
          if (!r.ok) throw new Error(JSON.stringify(r.rejection));
        });
        const w = await travelledOf(s);
        if (related && w === undefined) throw new Error(`${arm}: nothing travelled`);
        if (!related && w !== undefined) throw new Error(`${arm}: the control travelled`);
        if (w !== undefined) wire.push({ engine, size, arm, ...w });
        if (w !== undefined) say(`${engine} · ${arm}: ${w.values} far values, ${w.bytes.toLocaleString('en-US')} bytes on the wire`);
      }
      // a BRUSH over every planet: the widest set this desk can make — the whole reference list
      if (related) {
        const s = dash.createSession();
        const arm = 'dispatch, travels (brush over every planet)';
        await harness.timed({ engine, arm, size, rows: EXO_ROWS, ...BUDGET.exo }, async () => {
          const r = await s.dispatch({ verb: 'filter', viewId: PLANETS, field: 'pl_rade', range: [0, 20], cause });
          if (!r.ok) throw new Error(JSON.stringify(r.rejection));
        });
        const w = await travelledOf(s);
        if (w === undefined) throw new Error(`${arm}: nothing travelled`);
        wire.push({ engine, size, arm, ...w });
        say(`${engine} · ${arm}: ${w.values} far values, ${w.bytes.toLocaleString('en-US')} bytes on the wire`);
      }
    }
    if (engine === 'wasm') await (opts.openSqlConnection === undefined ? undefined : (await opts.openSqlConnection()).close?.());
  } catch (error) {
    failures.push({ engine, size, arm: 'the exoplanet desk', cause: causeOf(error) });
    say(`${engine} · the exoplanet desk: FAILED — ${causeOf(error)}`);
  }
}

// ── The 1M cells, both engines. ──────────────────────────────────────────

const synthetic = synthesize(CELLS_ROWS, FALLBACK_SHAPE);
const places: Row[] = synthetic.jurisdictions.map((name, i) => ({ code: name, name: `place ${i}` }));
const disease = synthetic.diseases[0]!;
for (const engine of ['memory', 'wasm'] as const) {
  const size = `${CELLS_ROWS.toLocaleString('en-US')} cells`;
  try {
    const opts = await optionsFor(engine);
    for (const related of [false, true]) {
      const dash = buildDashboard(cellsDef(synthetic.rows, places, engine, related), opts);
      const s = dash.createSession();
      const arm = related ? 'dispatch, travels (one disease picked)' : 'dispatch, no relation (one disease picked)';
      await harness.timed({ engine, arm, size, rows: CELLS_ROWS, ...BUDGET.cells }, async () => {
        const r = await s.dispatch({ verb: 'select', viewId: CELLS, field: 'disease', value: disease, cause });
        if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      });
      const w = await travelledOf(s);
      if (related && w === undefined) throw new Error(`${arm}: nothing travelled`);
      if (w !== undefined) wire.push({ engine, size, arm, ...w });
      if (w !== undefined) say(`${engine} · ${arm}: ${w.values} far values, ${w.bytes.toLocaleString('en-US')} bytes on the wire`);
    }
    if (engine === 'wasm') await (opts.openSqlConnection === undefined ? undefined : (await opts.openSqlConnection()).close?.());
  } catch (error) {
    failures.push({ engine, size, arm: 'the 1M cells', cause: causeOf(error) });
    say(`${engine} · the 1M cells: FAILED — ${causeOf(error)}`);
  }
}

const out: { readonly node: string; readonly measures: readonly Measure[]; readonly wire: readonly Wire[]; readonly failures: readonly Failure[]; readonly shapes: Record<string, unknown> } = {
  node: process.version,
  measures: harness.results,
  wire,
  failures,
  shapes: { exo: { planets: EXO_ROWS, references: EXO_REFS, consumer: YEARS }, cells: { rows: CELLS_ROWS, places: places.length, consumer: PLACES } },
};
process.stdout.write(JSON.stringify(out));
