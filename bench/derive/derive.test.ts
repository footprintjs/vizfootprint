/**
 * DERIVE BENCH ACCEPTANCE — WRITTEN BEFORE THE ARMS ARE BELIEVED.
 * (`bench/step0-wasm/wasm.test.ts` set the precedent.)
 *
 * The law it follows: no cost number reaches a README or a commit message until
 * a checked-in bench produced it — and a bench whose floor computes a DIFFERENT
 * answer than the walk is a fast answer to a different question, not a floor.
 *
 * TWO PARTS:
 *
 *   PART A — THE INSTRUMENTS. Runs in the repo's normal gate, always. The
 *   clock against a deliberate block; the harness keeping exactly its
 *   repetitions; the renderer SEEING a walk three times its floor; the judge
 *   accepting every tree in the contract; and — the one that matters most —
 *   every floor agreeing with the walker cell for cell on rows chosen to reach
 *   every arm of every tree, including the arms the seeded table never reaches.
 *
 *   PART B — THE REPORT. Skipped while `results.json` is absent, armed the
 *   moment a run writes one: the controls say the instruments were alive, every
 *   size and expression in the contract ran through all four arms, and every
 *   measurement carries real samples.
 *
 * Nothing here writes to `src/`, and nothing here is large: the big sizes live
 * in `run.mjs`, which is a report, not a gate.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { judgeDerivedColumn } from '../../src/derive/judge.js';
import { rowsOver, valuesOf } from '../../src/derive/groups.js';
import { evaluateRow } from '../../src/derive/walk.js';
import type { Row } from '../../src/data/types.js';
import { FLOOR_OVER_COLUMNS, FLOOR_OVER_READER } from './floors.js';
import { ARMS, EXPRESSIONS, EXPR_ORDER, SIZE_ORDER, createHarness, nodesOf, spin, type Measure } from './measure.js';
import { ABSENCE, COLUMNS, benchSilence, benchTable, columnarRowsOf, type BenchTable } from './rows.js';

// @ts-expect-error -- the renderer is plain .mjs on purpose: run.mjs imports it without a build step
import { tableOf } from './table.mjs';

const RESULTS = fileURLToPath(new URL('./results.json', import.meta.url));

/** A table from hand rows, in the bench's own columnar shape. */
function tableOfRows(rows: readonly Row[]): BenchTable {
  const columns: Record<string, unknown[]> = {};
  for (const { name } of COLUMNS) columns[name] = rows.map((row) => row[name]);
  return { rows, columns, count: rows.length };
}

/**
 * Rows chosen to reach every arm: a present row above and below the `case`
 * threshold, a present zero, a NEGATIVE present value (the sign-preserving
 * round), a silent row CARRYING a zero (the gate must turn it absent — the
 * whole second half of the absence law), a `null` population (strict `div`),
 * a zero population (`Infinity` is absent), text where a number was declared,
 * a `Date` (the arithmetic edge's ISO reading) and an `unknown` state.
 */
const EDGE_ROWS: readonly Row[] = [
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 150, population: 1_000, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 1, population: 1_000_000, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 0, population: 1_000, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: -2.5, population: 1_000_000, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 0, population: 1_000, report_state: 'unavailable' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: null, population: 1_000, report_state: 'not-configured' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 3, population: null, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 3, population: 0, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 'seven', population: 1_000, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: new Date('2026-01-04T00:00:00Z'), population: 1_000, report_state: 'present' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 4, population: 1_000, report_state: 'unknown' },
  { disease: 'A', jurisdiction: 'J1', kind: 'state', cases: 4, population: 1_000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// PART A — the instruments. Positive controls. These must pass TODAY.
// ─────────────────────────────────────────────────────────────────────────────

describe('derive bench · part A · the instruments are alive', () => {
  it('positive control: the clock reads a deliberate 40ms block as ~40ms, and reads no work as far less', () => {
    const harness = createHarness({ reps: 3, warmup: 1 });
    const blocked = harness.timed({ arm: 'control', expr: 'read', size: 'control', rows: 0 }, () => spin(40));
    expect(blocked.best).toBeGreaterThanOrEqual(20);
    expect(blocked.best).toBeLessThan(2_000);
    expect(blocked.median).toBeGreaterThanOrEqual(blocked.best);
    expect(blocked.max).toBeGreaterThanOrEqual(blocked.median);
    const idle = harness.timed({ arm: 'control', expr: 'read', size: 'control', rows: 0 }, () => 0);
    expect(idle.best).toBeLessThan(blocked.best);
  });

  it('the harness discards its warm-ups and keeps exactly its repetitions — a sample count is not a call count', () => {
    const harness = createHarness({ reps: 5, warmup: 2 });
    let calls = 0;
    const m = harness.timed({ arm: ARMS.walkColumnar, expr: 'ratio', size: '100k', rows: 100_000, note: 'x' }, () => {
      calls += 1;
    });
    expect(calls).toBe(7);
    expect(m.n).toBe(5);
    expect(harness.results).toHaveLength(1);
    expect(harness.results[0]).toMatchObject({ arm: ARMS.walkColumnar, expr: 'ratio', size: '100k', rows: 100_000, warmup: 2, note: 'x' });
  });

  it('the contract: the judge accepts every expression, and the deep one is six op nodes with a case, a coalesce and a cast', () => {
    for (const expr of EXPR_ORDER) {
      const verdict = judgeDerivedColumn(EXPRESSIONS[expr], 'cells', COLUMNS);
      expect(verdict.ok, expr).toBe(true);
    }
    expect(nodesOf(EXPRESSIONS.read.expr)).toEqual({ ops: 0, leaves: 1 });
    expect(nodesOf(EXPRESSIONS.ratio.expr)).toEqual({ ops: 1, leaves: 2 });
    expect(nodesOf(EXPRESSIONS.tree6.expr)).toEqual({ ops: 6, leaves: 7 });
    expect(JSON.stringify(EXPRESSIONS.tree6.expr)).toMatch(/"op":"case"/);
    expect(JSON.stringify(EXPRESSIONS.tree6.expr)).toMatch(/"op":"coalesce"/);
    expect(JSON.stringify(EXPRESSIONS.tree6.expr)).toMatch(/"op":"cast"/);
    // the absence declaration governs `cases` and only `cases`: a bare read of `population` is never gated
    expect(ABSENCE.governs).toEqual(['cases']);
    expect(benchSilence().silenceFor('population')).toBeUndefined();
    expect(benchSilence().silenceFor('cases')?.state).toBe('report_state');
  });

  it('positive control: every floor agrees with the walker cell for cell on rows that reach every arm — the floor is the same question', () => {
    const table = tableOfRows(EDGE_ROWS);
    const columnar = columnarRowsOf(table);
    const silence = benchSilence();
    for (const expr of EXPR_ORDER) {
      const decl = EXPRESSIONS[expr];
      const walked = EDGE_ROWS.map((row) => evaluateRow(decl.expr, row, silence));
      expect(valuesOf(decl, columnar), `${expr} · the columnar door`).toEqual(walked);
      expect(valuesOf(decl, rowsOver(EDGE_ROWS, silence)), `${expr} · the rowsOver door`).toEqual(walked);
      expect(
        EDGE_ROWS.map((_, at) => FLOOR_OVER_READER[expr](columnar.at(at))),
        `${expr} · the floor over the reader`,
      ).toEqual(walked);
      expect(
        EDGE_ROWS.map((_, at) => FLOOR_OVER_COLUMNS[expr](table.columns, at)),
        `${expr} · the floor over raw columns`,
      ).toEqual(walked);
    }
    // …and the rows DID reach the arms: the deep tree answered 'high', a rounded string, and absent
    const deep = EDGE_ROWS.map((row) => evaluateRow(EXPRESSIONS.tree6.expr, row, silence));
    expect(deep).toEqual(['high', '1', '0', '-3', null, null, null, null, null, null, null, null]);
    // the silent row carrying a zero is ABSENT through every path — the gate, not the value, decided
    expect(evaluateRow(EXPRESSIONS.read.expr, EDGE_ROWS[4]!, silence)).toBeNull();
    expect(FLOOR_OVER_COLUMNS.read(table.columns, 4)).toBeNull();
  });

  it('the seeded table has the real silence mix, and the four paths agree on it', () => {
    const table = benchTable(6_020);
    const columnar = columnarRowsOf(table);
    const present = table.rows.filter((row) => row['report_state'] === 'present').length / table.count;
    expect(present).toBeGreaterThan(0.45);
    expect(present).toBeLessThan(0.65);
    expect(table.rows.every((row) => row['report_state'] === 'present' || row['cases'] === null)).toBe(true);
    for (const expr of EXPR_ORDER) {
      const walked = valuesOf(EXPRESSIONS[expr], columnar);
      expect(walked.filter((c) => c !== null).length / table.count, expr).toBeCloseTo(present, 5);
      expect(table.rows.map((_, at) => FLOOR_OVER_COLUMNS[expr](table.columns, at)), expr).toEqual(walked);
    }
  });

  it('positive control: the renderer SEES a walk three times its floor, and says so in the ratio column', () => {
    const at = (arm: string, best: number): Measure => ({ arm, expr: 'tree6', size: '100k', rows: 100_000, best, median: best, max: best, p95: best, n: 3, warmup: 1 });
    const table = tableOf({
      node: 'v22',
      platform: 'test',
      generatedAt: 'now',
      head: 'abc1234',
      reps: { '100k': 3 },
      gcExposed: true,
      controls: {
        clock: { askedMs: 40, readMs: 41.2, live: true },
        judged: [{ expr: 'tree6', ok: true, type: 'string', ops: 6, leaves: 7 }],
        agreement: [{ size: '100k', expr: 'tree6', mismatches: 0, present: 0.55, agree: true }],
      },
      results: [at(ARMS.walkColumnar, 30), at(ARMS.walkRows, 45), at(ARMS.floorReader, 10), at(ARMS.floorRaw, 5)],
    }) as string;
    expect(table).toContain('abc1234');
    expect(table).toContain('| clock — a deliberate block | 40 ms | 41.2 ms | YES |');
    expect(table).toContain('6 op nodes, 7 leaves');
    expect(table).toContain('| `tree6` | **30.0** · 30.0 / 30.0 | **45.0** · 45.0 / 45.0 | **10.0** · 10.0 / 10.0 | **5.00** · 5.00 / 5.00 | 3.00× | 6.00× | 300 ns |');
    // an absent arm is an em dash, never a zero
    const partial = tableOf({ node: 'v22', platform: 'test', generatedAt: 'now', reps: {}, gcExposed: false, controls: { clock: { askedMs: 40, readMs: 1, live: false } }, results: [at(ARMS.walkColumnar, 30)] }) as string;
    expect(partial).toContain('| `tree6` | **30.0** · 30.0 / 30.0 | — | — | — | — | — | 300 ns |');
    expect(partial).toContain('NOT exposed');
    expect(partial).toContain('| clock — a deliberate block | 40 ms | 1.0 ms | NO |');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — the report. Skipped until a run writes one; armed the moment it does.
// ─────────────────────────────────────────────────────────────────────────────

interface Report {
  readonly controls: { readonly clock: { readonly live: boolean }; readonly judged: { readonly ok: boolean }[]; readonly agreement: { readonly agree: boolean }[] };
  readonly results: Measure[];
}

describe.skipIf(!existsSync(RESULTS))('derive bench · part B · the report a run wrote', () => {
  const json: Report = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Report) : { controls: { clock: { live: false }, judged: [], agreement: [] }, results: [] };

  it('the controls say the instruments were alive when these numbers were taken', () => {
    expect(json.controls.clock.live).toBe(true);
    expect(json.controls.judged.length).toBe(EXPR_ORDER.length);
    expect(json.controls.judged.every((j) => j.ok)).toBe(true);
    expect(json.controls.agreement.length).toBe(SIZE_ORDER.length * EXPR_ORDER.length);
    expect(json.controls.agreement.every((a) => a.agree)).toBe(true);
  });

  it('every size and expression in the contract ran through all four arms, and every measurement carries real samples', () => {
    expect([...new Set(json.results.map((r) => r.size))]).toEqual([...SIZE_ORDER]);
    for (const size of SIZE_ORDER) {
      for (const expr of EXPR_ORDER) {
        const arms = json.results.filter((r) => r.size === size && r.expr === expr).map((r) => r.arm);
        expect([...arms].sort(), `${size} · ${expr}`).toEqual(Object.values(ARMS).sort());
      }
    }
    for (const r of json.results) {
      expect(r.n, `${r.arm} ${r.size} ${r.expr}`).toBeGreaterThan(0);
      expect(r.best, `${r.arm} ${r.size} ${r.expr}`).toBeGreaterThan(0);
      expect(r.median).toBeGreaterThanOrEqual(r.best);
      expect(r.max).toBeGreaterThanOrEqual(r.median);
    }
  });
});
