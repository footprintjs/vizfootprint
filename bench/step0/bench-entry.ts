/**
 * Step-0 measurement program — runs under plain Node (bundled by run.mjs).
 * MEASURE before building: memory engine construction, evaluate(), foldOnce,
 * a virtual-sheet page fetch, and the demo's per-poll JS folds — at 90,300
 * rows (synthetic AND the real NNDSS cells when readable) and 1,000,000 rows.
 *
 * Every number is the wall time of ONE call, `performance.now()` around it,
 * warm-up runs discarded, ≥5 measured repetitions → median / p95 (gen.ts).
 * `globalThis.gc()` runs between measurements when node was started with
 * --expose-gc, so GC from a previous arm is not charged to the next one
 * (a browser does not get that courtesy — see the report's assumptions).
 */
import { readFileSync } from 'node:fs';
import { memoryProvider } from '../../src/data/memoryProvider.js';
import { columnTypes, columnar, distinct, extent, foldOnce, groupCount, keyedIndex, rowCount, total } from '../../src/data/fold.js';
import type { DataProvider, PredicateClause, Row } from '../../src/data/types.js';
import { FALLBACK_SHAPE, stats, synthesize, type Shape } from './gen.js';

// ── harness ──────────────────────────────────────────────────────────────────

interface Measure {
  readonly group: string;
  readonly name: string;
  readonly size: string; // '90k-syn' | '90k-real' | '1M-syn'
  readonly rows: number;
  readonly median: number;
  readonly p95: number;
  readonly min: number;
  readonly n: number;
  readonly note?: string;
}

const results: Measure[] = [];
const gc = (): void => {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) g();
};

const REPS = { '90k': Number(process.env.STEP0_REPS_90K ?? 11), '1M': Number(process.env.STEP0_REPS_1M ?? 5) };
const WARMUP = 3;

async function timed(group: string, name: string, size: string, rows: number, reps: number, fn: () => unknown | Promise<unknown>, note?: string): Promise<Measure> {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    gc();
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  const m: Measure = { group, name, size, rows, ...stats(samples), ...(note ? { note } : {}) };
  results.push(m);
  process.stderr.write(`  ${size.padEnd(8)} ${group.padEnd(12)} ${name.padEnd(46)} median ${m.median.toFixed(2).padStart(9)} ms  p95 ${m.p95.toFixed(2).padStart(9)} ms\n`);
  return m;
}

/** A clause value as it arrives off the wire (a fresh string, not the generator's own pointer). */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── the real cells (calibration + the 90k-real arm) ──────────────────────────

interface RealData {
  readonly rows: Row[];
  readonly shape: Shape;
  readonly diseases: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly weeks: readonly string[];
}

async function loadReal(): Promise<RealData | null> {
  const path = process.env.STEP0_SNAPSHOT;
  if (!path) return null;
  try {
    const { nndssTables } = await import('../../../vizfootprint-demo/src/nndss/etl.js');
    const t = nndssTables(readFileSync(path, 'utf8'));
    const kinds = { state: 0, region: 0, total: 0 };
    for (const j of t.jurisdictions) kinds[j.kind]++;
    const total = t.cells.length;
    const reportStates = Object.fromEntries(Object.entries(t.counts).map(([k, v]) => [k, v / total]));
    return {
      rows: t.cells as unknown as Row[],
      shape: { kinds: [kinds.state, kinds.region, kinds.total], weeks: t.weeks.length, reportStates },
      diseases: t.diseases,
      jurisdictions: t.jurisdictions.map((j) => j.jurisdiction),
      weeks: t.weeks,
    };
  } catch (e) {
    process.stderr.write(`real snapshot not loaded (${e instanceof Error ? e.message : String(e)}) — synthetic only\n`);
    return null;
  }
}

// ── one arm = one table at one size ──────────────────────────────────────────

interface Arm {
  readonly size: string;
  readonly rows: Row[];
  readonly diseases: readonly string[];
  readonly jurisdictions: readonly string[];
  readonly weeks: readonly string[];
  readonly columns: readonly string[];
}

/** The demo's `keep` predicate shape: an every() over N closures, each a strict compare against a wire value. */
function keepOf(preds: readonly ((r: Row) => boolean)[]): (r: Row) => boolean {
  if (preds.length === 0) return () => true;
  return (r) => preds.every((p) => p(r));
}

async function runArm(arm: Arm): Promise<void> {
  const { size, rows } = arm;
  const n = rows.length;
  const reps = size.startsWith('1M') ? REPS['1M'] : REPS['90k'];
  process.stderr.write(`\n== ${size}: ${n.toLocaleString()} rows × ${arm.columns.length} columns ==\n`);

  // clauses, values off the wire (fresh strings)
  const disease = wire(arm.diseases[Math.min(3, arm.diseases.length - 1)]!);
  const wk = arm.weeks;
  const tLo = wire(wk[Math.floor(wk.length * 0.25)]!);
  const tHi = wire(wk[Math.floor(wk.length * 0.75)]!);
  const point: PredicateClause = { kind: 'point', field: 'disease', value: disease };
  const interval: PredicateClause = { kind: 'interval', field: 't', value: [tLo, tHi] };
  const and: PredicateClause[] = [point, interval];

  // 1. construction ──────────────────────────────────────────────────────────
  let rowProv: DataProvider = memoryProvider(rows, { layout: 'row' });
  let colProv: DataProvider = memoryProvider(rows, { layout: 'column' });
  await timed('construct', 'memoryProvider layout=row (clone rows + columnTypes fold)', size, n, reps, () => {
    rowProv = memoryProvider(rows, { layout: 'row' });
  });
  await timed('construct', 'memoryProvider layout=column (columnar + columnTypes fold)', size, n, reps, () => {
    colProv = memoryProvider(rows, { layout: 'column' });
  });

  // 2. evaluate ──────────────────────────────────────────────────────────────
  const clauses: [string, PredicateClause | PredicateClause[] | null][] = [
    ['point disease', point],
    ['AND point disease + interval t', and],
    ['null (whole table)', null],
  ];
  let lastCount = 0;
  for (const [label, clause] of clauses) {
    for (const mode of ['count', 'rows'] as const) {
      for (const [layout, prov] of [['row', rowProv], ['column', colProv]] as const) {
        const m = await timed('evaluate', `${label} · mode=${mode} · layout=${layout}`, size, n, reps, async () => {
          const r = await prov.evaluate('data', clause, { mode });
          if ('count' in r) lastCount = r.count;
        });
        void m;
      }
    }
    process.stderr.write(`     (${label}: ${lastCount.toLocaleString()} rows match)\n`);
  }

  // 3. foldOnce recorder sets over the raw rows ──────────────────────────────
  const names = arm.columns;
  await timed('fold', 'rowCount+extent(cases)+distinct(disease)+groupCount(report_state)', size, n, reps, () =>
    foldOnce(rows, { n: rowCount(), cases: extent('cases'), diseases: distinct('disease'), states: groupCount('report_state') }),
  );
  await timed('fold', 'columnar(all cols)+columnTypes(all cols)', size, n, reps, () => foldOnce(rows, { columns: columnar(names), types: columnTypes(names) }), `${names.length} columns`);
  await timed('fold', 'keyedIndex(jurisdiction) (repeated keys → mostly unkeyed)', size, n, reps, () => foldOnce(rows, { idx: keyedIndex('jurisdiction') }));
  // honest upper bound for keyedIndex: a unique key per row (a sheet's row id)
  const withId = rows.map((r, i) => ({ ...r, id: i }));
  await timed('fold', 'keyedIndex(id) (unique key per row → n Map inserts)', size, n, reps, () => foldOnce(withId, { idx: keyedIndex('id') }), 'rows carry an extra id column');
  await timed('fold', 'rowCount only (walk + one no-op recorder = floor)', size, n, reps, () => foldOnce(rows, { n: rowCount() }));

  // one gesture as the session does it: ONE evaluate (rows) + ONE fold over the answer
  await timed('gesture', 'evaluate(AND, rows, layout=row) + foldOnce(4 recorders) over the answer', size, n, reps, async () => {
    const r = await rowProv.evaluate('data', and, { mode: 'rows' });
    if ('rows' in r && r.rows) foldOnce(r.rows, { n: rowCount(), cases: extent('cases'), diseases: distinct('disease'), states: groupCount('report_state') });
  });
  await timed('gesture', 'evaluate(point, rows, layout=row) + foldOnce(4 recorders) over the answer', size, n, reps, async () => {
    const r = await rowProv.evaluate('data', point, { mode: 'rows' });
    if ('rows' in r && r.rows) foldOnce(r.rows, { n: rowCount(), cases: extent('cases'), diseases: distinct('disease'), states: groupCount('report_state') });
  });

  // 4. paging probe: a virtual sheet's page [offset, offset+100) after a filter ──
  const PAGE = 100;
  const headerStats = (rs: readonly Row[]) =>
    foldOnce(rs, {
      n: rowCount(),
      cases: extent('cases'),
      casesTotal: total('cases'),
      diseases: distinct('disease'),
      places: distinct('jurisdiction'),
      kinds: distinct('kind'),
      weeks: distinct('t'),
      states: groupCount('report_state'),
    });
  for (const [label, clause] of [['point disease', point], ['AND', and]] as const) {
    // (a) the filter alone
    await timed('page', `${label} · filter only (mode=count)`, size, n, reps, () => rowProv.evaluate('data', clause, { mode: 'count' }));
    // (b) today's path: all matching rows materialized, then slice in JS
    await timed('page', `${label} · evaluate(rows) all matches + slice(0,100)`, size, n, reps, async () => {
      const r = await rowProv.evaluate('data', clause, { mode: 'rows' });
      if ('rows' in r && r.rows) r.rows.slice(0, PAGE);
    });
    await timed('page', `${label} · evaluate(rows) all matches + slice(5000,5100)`, size, n, reps, async () => {
      const r = await rowProv.evaluate('data', clause, { mode: 'rows' });
      if ('rows' in r && r.rows) r.rows.slice(5000, 5000 + PAGE);
    });
    // (c) the cheapest the provider offers today: limit caps materialization (offset 0 only)
    await timed('page', `${label} · evaluate(rows, limit=100) (filter + materialize 100)`, size, n, reps, () => rowProv.evaluate('data', clause, { mode: 'rows', limit: PAGE }));
    // (d) header stats for 8 columns over the filtered rows (fold over the answer), plus the slice
    await timed('page', `${label} · evaluate(rows) + header stats (8 recorders) + slice(0,100)`, size, n, reps, async () => {
      const r = await rowProv.evaluate('data', clause, { mode: 'rows' });
      if ('rows' in r && r.rows) {
        headerStats(r.rows);
        r.rows.slice(0, PAGE);
      }
    });
    // the slice itself, isolated
    const once = await rowProv.evaluate('data', clause, { mode: 'rows' });
    const matched = 'rows' in once && once.rows ? once.rows : [];
    await timed('page', `${label} · slice(5000,5100) of an already-materialized answer`, size, n, reps, () => matched.slice(5000, 5000 + PAGE));
    await timed('page', `${label} · header stats (8 recorders) over the ${matched.length.toLocaleString()} matched rows`, size, n, reps, () => headerStats(matched));
  }

  // 5. the demo's per-poll JS work (App.tsx useMemo folds), plain loops ───────
  const demoTick = (keep: (r: Row) => boolean, sumKind: string, picked: string, latestWeek: string) => {
    const absenceStates = ['present', 'not-configured', 'unavailable', 'withheld', 'unknown'];
    // coverageData: 5 × filter().length
    const coverage = absenceStates.map((category) => ({ category, count: rows.filter((r) => r['report_state'] === category && keep(r)).length }));
    // diseaseData: group-by-disease sum of cases over one kind
    const sums = new Map<string, number>();
    for (const c of rows) {
      if (c['kind'] !== sumKind || c['cases'] === null || !keep(c)) continue;
      sums.set(c['disease'] as string, (sums.get(c['disease'] as string) ?? 0) + (c['cases'] as number));
    }
    // kindData: 3 × filter().length
    const kinds = ['state', 'region', 'total'].map((category) => ({ category, count: rows.filter((r) => r['kind'] === category && keep(r)).length }));
    // weekData: per-week sum over kept cells of one kind
    const byWeek = new Map<string, number>();
    for (const c of rows) {
      if (c['kind'] !== sumKind || c['cases'] === null || !keep(c)) continue;
      byWeek.set(c['t'] as string, (byWeek.get(c['t'] as string) ?? 0) + (c['cases'] as number));
    }
    const week = [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    // mapData: picked disease per state over kept weeks
    const map = new Map<string, number>();
    for (const c of rows) {
      if (c['kind'] !== 'state' || c['disease'] !== picked || c['cases'] === null || !keep(c)) continue;
      map.set(c['jurisdiction'] as string, (map.get(c['jurisdiction'] as string) ?? 0) + (c['cases'] as number));
    }
    // noShape: filter + map + Set
    const places = new Set(rows.filter((c) => c['kind'] === 'state').map((c) => c['jurisdiction']));
    // tableRows
    const table = rows.filter((c) => c['disease'] === picked && c['t'] === latestWeek);
    // keptCount
    const kept = rows.filter((r) => keep(r)).length;
    // silences: 4 × filter + grouping
    const silences = absenceStates
      .filter((s) => s !== 'present')
      .map((s) => {
        const inState = rows.filter((c) => c['report_state'] === s && c['t'] === latestWeek);
        const byArea = new Map<string, string[]>();
        for (const c of inState) byArea.set(c['jurisdiction'] as string, [...(byArea.get(c['jurisdiction'] as string) ?? []), c['disease'] as string]);
        return { state: s, total: inState.length, areas: [...byArea.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12) };
      });
    return { coverage, sums, kinds, week, map, places, table, kept, silences };
  };
  const latestWeek = wire(wk[wk.length - 1]!);
  const picked = disease;
  const noKeep = keepOf([]);
  const place = wire(arm.jurisdictions[5]!); // off the wire ONCE — a per-row JSON round-trip would be the bench's cost, not the demo's
  const twoKeep = keepOf([(r) => r['jurisdiction'] === place, (r) => typeof r['t'] === 'string' && r['t'] >= tLo && r['t'] <= tHi]);
  await timed('demo-tick', 'App.tsx folds, no live clause (18 passes: 5+1+3+1+1+1+1+1+4)', size, n, reps, () => demoTick(noKeep, 'state', picked, latestWeek));
  await timed('demo-tick', 'App.tsx folds, 2 live clauses (point + interval keep)', size, n, reps, () => demoTick(twoKeep, 'state', picked, latestWeek));
  // the three biggest folds, alone
  await timed('demo-tick', 'diseaseData alone: group-by-disease sum of cases (1 pass, 2-clause keep)', size, n, reps, () => {
    const sums = new Map<string, number>();
    for (const c of rows) {
      if (c['kind'] !== 'state' || c['cases'] === null || !twoKeep(c)) continue;
      sums.set(c['disease'] as string, (sums.get(c['disease'] as string) ?? 0) + (c['cases'] as number));
    }
    return sums;
  });
  await timed('demo-tick', 'coverageData alone: group-by-report_state count (5 filter passes, 2-clause keep)', size, n, reps, () =>
    ['present', 'not-configured', 'unavailable', 'withheld', 'unknown'].map((category) => rows.filter((r) => r['report_state'] === category && twoKeep(r)).length),
  );
  await timed('demo-tick', 'weekData alone: per-week sum over kept states (1 pass, 2-clause keep)', size, n, reps, () => {
    const byWeek = new Map<string, number>();
    for (const c of rows) {
      if (c['kind'] !== 'state' || c['cases'] === null || !twoKeep(c)) continue;
      byWeek.set(c['t'] as string, (byWeek.get(c['t'] as string) ?? 0) + (c['cases'] as number));
    }
    return byWeek;
  });
  // the server door: overview() = one evaluate(count) per poll (session.selectedCount), on the row layout
  await timed('demo-tick', 'server /api/state per poll: evaluate(AND, count, layout=row) (session.selectedCount)', size, n, reps, () => rowProv.evaluate('data', and, { mode: 'count' }));
}

// ── main ─────────────────────────────────────────────────────────────────────

const real = await loadReal();
const shape = real?.shape ?? FALLBACK_SHAPE;
const CELL_COLUMNS = ['disease', 'jurisdiction', 'kind', 't', 'cases', 'report_state'];

process.stderr.write(`node ${process.version} · shape ${JSON.stringify(shape)} · reps 90k=${REPS['90k']} 1M=${REPS['1M']} · warm-up ${WARMUP} · gc ${typeof (globalThis as { gc?: unknown }).gc === 'function' ? 'exposed' : 'NOT exposed'}\n`);

{
  const s = synthesize(90_300, shape);
  await runArm({ size: '90k-syn', rows: s.rows, diseases: s.diseases, jurisdictions: s.jurisdictions, weeks: s.weeks, columns: CELL_COLUMNS });
}
gc();
if (real) {
  const cols = Object.keys(real.rows[0]!);
  await runArm({ size: '90k-real', rows: real.rows, diseases: real.diseases, jurisdictions: real.jurisdictions, weeks: real.weeks, columns: cols });
}
gc();
{
  const s = synthesize(1_000_000, shape);
  await runArm({ size: '1M-syn', rows: s.rows, diseases: s.diseases, jurisdictions: s.jurisdictions, weeks: s.weeks, columns: CELL_COLUMNS });
}

process.stdout.write(JSON.stringify({ node: process.version, platform: `${process.platform} ${process.arch}`, shape, reps: REPS, warmup: WARMUP, results }, null, 1));
