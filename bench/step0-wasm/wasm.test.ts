/**
 * STEP-0-WASM BENCH ACCEPTANCE — WRITTEN FIRST, before the arms exist.
 * (`bench/layout/layout.test.ts` set this precedent; `bench/x4/x4.test.ts`
 * before it.)
 *
 * The law it follows: no cost or ceiling number reaches a README, a threshold or
 * a commit message until a checked-in bench produced it. This file is the other
 * half of that law — it says what the bench must PROVE, so no number can be
 * quietly weakened later into whatever the implementation happens to do.
 *
 * TWO PARTS, and the split is the point:
 *
 *   PART A — THE INSTRUMENTS. Runs today, always, and must be green today.
 *   These are the positive controls: a clock that reads a deliberate 40 ms block
 *   as ~40 ms, a harness that discards its warm-ups and keeps its repetitions, a
 *   renderer that can see one engine being three times the other, and — the one
 *   that matters most — the two ENGINES answering the same clause with the same
 *   count over the same rows. A dead instrument reports "no difference" and "no
 *   cost" in exactly the same voice as a fast implementation, and an engine that
 *   answered zero rows posts the best time in every arm of the table.
 *
 *   PART B — THE REPORT. Skipped while `wasm-results.json` is absent, and it
 *   ARMS ITSELF the moment a run writes one: every arm the contract names must
 *   carry a measurement for both engines (or say in a note why it cannot), every
 *   sample count must be positive, and the controls must say the instruments
 *   were alive when those numbers were taken.
 *
 * Nothing here writes to `src/`. It opens ONE small DuckDB (a few thousand rows,
 * a few hundred milliseconds) — the big sizes live in `run.mjs`, which is a
 * report, not a gate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARMS, SIZE_ORDER, WINDOWS, benchClauses, createHarness, spin, type Measure } from './measure.js';
import { FALLBACK_SHAPE, synthesize } from '../step0/gen.js';
import { memoryProvider } from '../../src/data/memoryProvider.js';
import { wasmProvider } from '../../src/data/wasmProvider.js';
import { duckdbConnection } from '../../src/data/duckdbConnection.js';
import { canLoad, isRejection, type DataProvider } from '../../src/data/index.js';

// @ts-expect-error -- the renderer is plain .mjs on purpose: run.mjs imports it without a build step
import { tableOf } from './table.mjs';

const RESULTS = fileURLToPath(new URL('./wasm-results.json', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// PART A — the instruments. Positive controls. These must pass TODAY.
// ─────────────────────────────────────────────────────────────────────────────

describe('step0-wasm bench · part A · the instruments are alive', () => {
  it('positive control: the clock reads a deliberate 40ms block as ~40ms, and reads no work as far less', async () => {
    const harness = createHarness({ reps: 3, warmup: 1 });
    const blocked = await harness.timed({ engine: 'memory', arm: 'control', size: 'control', rows: 0 }, () => spin(40));
    expect(blocked.median).toBeGreaterThanOrEqual(20);
    expect(blocked.median).toBeLessThan(2_000);
    const idle = await harness.timed({ engine: 'memory', arm: 'control', size: 'control', rows: 0 }, () => 0);
    expect(idle.median).toBeLessThan(blocked.median);
  });

  it('the harness discards its warm-ups and keeps exactly its repetitions — a sample count is not a call count', async () => {
    const harness = createHarness({ reps: 5, warmup: 2 });
    let calls = 0;
    const m = await harness.timed({ engine: 'wasm', arm: ARMS.count, size: '90k', rows: 90_300 }, () => {
      calls += 1;
    });
    expect(calls).toBe(7); // 2 warm-ups + 5 measured
    expect(m.n).toBe(5);
    expect(harness.results).toHaveLength(1);
    expect(harness.results[0]).toMatchObject({ engine: 'wasm', arm: ARMS.count, size: '90k', rows: 90_300 });
  });

  it('positive control: the renderer SEES one engine being three times the other, and says so in the ratio column', () => {
    const at = (engine: 'memory' | 'wasm', median: number): Measure => ({ engine, arm: ARMS.count, size: '90k', rows: 90_300, median, p95: median, max: median, min: median, n: 3, warmup: 1 });
    const table = tableOf({
      node: 'v22',
      platform: 'test',
      generatedAt: 'now',
      reps: { '90k': 3 },
      warmup: 1,
      gcExposed: true,
      controls: { clock: { askedMs: 40, readMs: 40.1, live: true }, agreement: [{ size: '90k', clause: 'AND', memory: 5_766, wasm: 5_766, agree: true }] },
      results: [at('memory', 2), at('wasm', 6)],
    }) as string;
    expect(table).toContain('3.00×');
    expect(table).toContain('| 2.00 / 2.00 | 6.00 / 6.00 |');
    expect(table).toContain('5,766 vs 5,766 | YES');
  });

  it('…and an arm only one engine can run is an em dash, never a zero — a zero is a time, an em dash is an absence', () => {
    const table = tableOf({
      node: 'v22',
      platform: 'test',
      generatedAt: 'now',
      reps: {},
      warmup: 1,
      gcExposed: false,
      controls: { clock: { askedMs: 40, readMs: 0, live: false }, agreement: [{ size: '90k', clause: 'AND', memory: 5_766, wasm: 0, agree: false }] },
      results: [{ engine: 'memory', arm: ARMS.sortedFirst, size: '90k', rows: 90_300, median: 9, p95: 9, max: 9, min: 9, n: 3, warmup: 0, note: 'DuckDB keeps no permutation' }],
    }) as string;
    expect(table).toContain('| 9.00 / 9.00 | — | — |');
    // …and a dead clock or a disagreement is printed as loudly as it deserves
    expect(table).toContain('| 40 ms | 0.0 ms | NO |');
    expect(table).toContain('every number below is void');
    expect(table).toContain('NOT exposed');
  });

  it('the generator repeats on a seed — so both engines really are measured on the same rows', () => {
    const a = synthesize(2_000, FALLBACK_SHAPE);
    const b = synthesize(2_000, FALLBACK_SHAPE);
    expect(a.rows).toHaveLength(2_000);
    expect(JSON.stringify(a.rows.slice(0, 50))).toBe(JSON.stringify(b.rows.slice(0, 50)));
  });

  it('POSITIVE CONTROL OF THE COMPARISON: over the same rows, both engines answer every bench clause with the same count', async () => {
    // The control the whole table rests on. An engine that answered zero rows —
    // a table that never landed, a WHERE that meant something else in SQL — would
    // post the best number in every arm, and nothing else in this bench would notice.
    // 20,000 rows, not 2,000: `gen.ts` scales the DISEASE axis, and one disease
    // is 70 jurisdictions × 86 weeks = 6,020 rows — so a smaller table has ONE
    // disease in it and the point clause would match every row. This control
    // caught exactly that, which is what a control is for.
    const { rows, diseases, weeks } = synthesize(20_000, FALLBACK_SHAPE);
    const clauses = benchClauses({ disease: diseases[0]!, from: weeks[Math.floor(weeks.length * 0.25)]!, to: weeks[Math.floor(weeks.length * 0.75)]! });

    const connection = await duckdbConnection()();
    if (!canLoad(connection)) throw new Error('the shipped opener answered a connection that cannot land a table');
    await connection.load('data', { kind: 'rows', rows });
    const wasm: DataProvider = wasmProvider({ sources: ['data'], connection });
    const memory: DataProvider = memoryProvider(rows, { layout: 'row' });

    try {
      for (const [label, clause] of [
        ['point', clauses.point],
        ['interval', clauses.interval],
        ['AND', clauses.and],
      ] as const) {
        const [overSQL, inMemory] = await Promise.all([wasm.evaluate('data', clause, WINDOWS.count), memory.evaluate('data', clause, WINDOWS.count)]);
        if (isRejection(overSQL) || isRejection(inMemory)) throw new Error(`${label}: an engine refused — ${JSON.stringify({ overSQL, inMemory })}`);
        expect(overSQL.count, `${label} count`).toBe(inMemory.count);
        expect(overSQL.count, `${label} matched nothing — a bench arm over an empty answer measures nothing`).toBeGreaterThan(0);
        expect(overSQL.count, `${label} matched everything — a filter that keeps the whole table is not a filter`).toBeLessThan(rows.length);
        expect(overSQL.sql).toBe(inMemory.sql);
      }

      // …and the two windowed arms answer the same rows, in the same order where an order was asked for
      const [liveWindow, foldWindow] = await Promise.all([wasm.evaluate('data', clauses.and, WINDOWS.window), memory.evaluate('data', clauses.and, WINDOWS.window)]);
      if (isRejection(liveWindow) || isRejection(foldWindow)) throw new Error('a windowed arm was refused');
      expect(liveWindow.rows).toHaveLength(foldWindow.rows!.length);
      const [liveSorted, foldSorted] = await Promise.all([wasm.evaluate('data', clauses.and, WINDOWS.sorted), memory.evaluate('data', clauses.and, WINDOWS.sorted)]);
      if (isRejection(liveSorted) || isRejection(foldSorted)) throw new Error('a sorted arm was refused');
      // the sort key, in order, from both engines — DuckDB answers a count as bigint, so the key is read as a number
      const keysOf = (rs: readonly Record<string, unknown>[]): number[] => rs.map((r) => Number(r['cases']));
      expect(keysOf(liveSorted.rows!)).toEqual(keysOf(foldSorted.rows!));
    } finally {
      await connection.close?.();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — the report. Skipped until a run writes one; armed the moment it does.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!existsSync(RESULTS))('step0-wasm bench · part B · the report a run wrote', () => {
  const json = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as { controls: { clock: { live: boolean }; agreement: { agree: boolean }[] }; results: Measure[] }) : { controls: { clock: { live: false }, agreement: [] }, results: [] };

  it('the controls say the instruments were alive when these numbers were taken', () => {
    expect(json.controls.clock.live).toBe(true);
    expect(json.controls.agreement.length).toBeGreaterThan(0);
    expect(json.controls.agreement.every((a) => a.agree)).toBe(true);
  });

  it('every size in the contract ran, and every measurement carries real samples', () => {
    expect([...new Set(json.results.map((r) => r.size))]).toEqual([...SIZE_ORDER]);
    for (const r of json.results) {
      expect(r.n, `${r.engine} ${r.size} ${r.arm}`).toBeGreaterThan(0);
      expect(r.median, `${r.engine} ${r.size} ${r.arm}`).toBeGreaterThan(0);
      expect(r.p95).toBeGreaterThanOrEqual(r.median);
    }
  });

  it('every arm the contract names was measured for BOTH engines — except the one only the memory engine has, which says so', () => {
    for (const size of SIZE_ORDER) {
      for (const arm of [ARMS.load, ARMS.count, ARMS.window, ARMS.sorted]) {
        const engines = json.results.filter((r) => r.size === size && r.arm === arm).map((r) => r.engine);
        expect([...engines].sort(), `${size} · ${arm}`).toEqual(['memory', 'wasm']);
      }
      const first = json.results.filter((r) => r.size === size && r.arm === ARMS.sortedFirst);
      expect(first.map((r) => r.engine)).toEqual(['memory']);
      expect(first[0]?.note ?? '').toMatch(/permutation|fresh/);
    }
  });
});
