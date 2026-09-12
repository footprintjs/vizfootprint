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
 *   carry a measurement for both engines (or say in a note why it cannot, or
 *   carry a recorded ceiling in `failures[]` for the engine that could not),
 *   every sample count must be positive, and the controls must say the
 *   instruments were alive when those numbers were taken.
 *
 *   The two arms added after the bench shipped — the moving brush and the wide
 *   projection — join both parts the same way: part A holds `brushSequence`
 *   and `widen` up to the live engines (the sweep keeps its match count, the
 *   wide table's cells mean the same thing out of both engines, and DuckDB's
 *   `DESCRIBE` says the wire types the wide arm claims to convert), part B
 *   reads them off the report by the SAME `ARMS` names the bench wrote.
 *
 * Nothing here writes to `src/`. It opens ONE small DuckDB (a few thousand rows,
 * a few hundred milliseconds) — the big sizes live in `run.mjs`, which is a
 * report, not a gate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARMS, BRUSH_ASKS, SIZE_ORDER, WIDE_COLUMNS, WIDE_FAMILIES, WIDE_GENERATED, WIDE_TABLE, WINDOWS, benchClauses, brushSequence, createHarness, spin, widen, type Measure } from './measure.js';
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

  it('positive control: the renderer pairs the wide arm with the window arm BY NAME and prints each engine\'s own ratio, the wire types, and a ceiling in the backend\'s words', () => {
    const at = (engine: 'memory' | 'wasm', arm: string, median: number): Measure => ({ engine, arm, size: '90k', rows: 90_300, median, p95: median, max: median, min: median, n: 3, warmup: 2 });
    const table = tableOf({
      node: 'v22',
      platform: 'test',
      generatedAt: 'now',
      reps: { '90k': 3 },
      warmup: 2,
      gcExposed: true,
      arms: ARMS,
      controls: {
        clock: { askedMs: 40, readMs: 40.1, live: true },
        agreement: [],
        wide: { columns: 4, types: { a: 'BIGINT', b: 'DOUBLE', c: 'DATE', d: 'BIGINT' } },
      },
      failures: [{ engine: 'wasm', size: '1M', stage: 'wide: land 30 columns through the rows port', cause: 'Invalid string length' }],
      results: [at('memory', ARMS.window, 2), at('wasm', ARMS.window, 4), at('memory', ARMS.wide, 3), at('wasm', ARMS.wide, 16)],
    }) as string;
    expect(table).toContain('memory 1.50× · wasm 4.00×');
    expect(table).toContain('| DESCRIBE | BIGINT ×2 · DOUBLE ×1 · DATE ×1 | — |');
    expect(table).toContain('| wide: land 30 columns through the rows port | wasm | 1M | Invalid string length |');
    // …and a report written before the wide arm existed prints neither line, rather than an empty ratio
    const before = tableOf({ node: 'v22', platform: 'test', generatedAt: 'now', reps: {}, warmup: 2, gcExposed: true, controls: { clock: { askedMs: 40, readMs: 40.1, live: true }, agreement: [] }, results: [at('memory', ARMS.window, 2)] }) as string;
    expect(before).not.toContain('wide ÷ window');
    expect(before).not.toContain('DESCRIBE');
  });

  it('the brush is the bench interval sliding one week per ask: twenty asks, the point clause held still, the first ask the bench clause itself — and a sweep past the span is refused, never clamped', () => {
    const { diseases, weeks } = synthesize(20_000, FALLBACK_SHAPE);
    const picked = { disease: diseases[0]!, from: weeks[Math.floor(weeks.length * 0.25)]!, to: weeks[Math.floor(weeks.length * 0.75)]! };
    const sweep = brushSequence(picked, weeks);
    expect(sweep).toHaveLength(BRUSH_ASKS);
    expect(sweep[0]).toEqual(benchClauses(picked).and);
    const intervalOf = (and: readonly unknown[]): readonly string[] => (and[1] as { value: readonly string[] }).value;
    for (let k = 1; k < sweep.length; k++) {
      expect(sweep[k]![0], `ask ${String(k)} keeps the point clause`).toEqual(sweep[0]![0]);
      const [from, to] = intervalOf(sweep[k]!);
      const [prevFrom, prevTo] = intervalOf(sweep[k - 1]!);
      expect(weeks.indexOf(from!), `ask ${String(k)} starts one week later`).toBe(weeks.indexOf(prevFrom!) + 1);
      expect(weeks.indexOf(to!), `ask ${String(k)} ends one week later`).toBe(weeks.indexOf(prevTo!) + 1);
    }
    expect(new Set(sweep.map((and) => JSON.stringify(and))).size).toBe(BRUSH_ASKS); // no ask repeats another: no cache could answer one
    expect(() => brushSequence({ ...picked, to: weeks[weeks.length - 1]! }, weeks)).toThrow(/must fit the span/);
    expect(() => brushSequence({ ...picked, from: '1999-01-01' }, weeks)).toThrow(/not made of the table's weeks/);
  });

  it('the wide table is the same rows, thirty columns wide, the same bytes on every call — four of each generated family beside the six the bench has', () => {
    const { rows } = synthesize(2_000, FALLBACK_SHAPE);
    const wide = widen(rows);
    expect(wide).toHaveLength(rows.length);
    expect(Object.keys(wide[0]!)).toHaveLength(WIDE_COLUMNS);
    expect(Object.keys(wide[0]!)).toEqual([...Object.keys(rows[0]!), ...WIDE_GENERATED]);
    expect(WIDE_GENERATED).toHaveLength(WIDE_COLUMNS - Object.keys(rows[0]!).length);
    for (const family of Object.keys(WIDE_FAMILIES)) expect(WIDE_GENERATED.filter((name) => name.startsWith(`${family}_`))).toHaveLength(4);
    // the six original cells ride untouched, and a second widening is the same table
    for (const key of Object.keys(rows[7]!)) expect(wide[7]![key]).toBe(rows[7]![key]);
    expect(JSON.stringify(widen(rows).slice(0, 50))).toBe(JSON.stringify(wide.slice(0, 50)));
    // the cells are what the families promise
    expect(typeof wide[0]!['int_1']).toBe('number');
    expect(Number.isInteger(wide[0]!['int_1'])).toBe(true);
    expect(typeof wide[0]!['dec_1']).toBe('number');
    expect(wide.some((r) => !Number.isInteger(r['dec_1']))).toBe(true);
    expect(wide[0]!['date_1']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(wide[0]!['ts_1']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(typeof wide[0]!['str_1']).toBe('string');
    expect(typeof wide[0]!['bool_1']).toBe('boolean');
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

      // THE BRUSH keeps its match count across the whole sweep, in both engines
      // (law 4): the disease is held still and the interval keeps its width, so
      // an ask's cost is a fresh judgement over the rows, never a wider answer.
      const sweep = brushSequence({ disease: diseases[0]!, from: weeks[Math.floor(weeks.length * 0.25)]!, to: weeks[Math.floor(weeks.length * 0.75)]! }, weeks);
      for (const k of [0, Math.floor(BRUSH_ASKS / 2), BRUSH_ASKS - 1]) {
        const [overSQL, inMemory] = await Promise.all([wasm.evaluate('data', sweep[k]!, WINDOWS.window), memory.evaluate('data', sweep[k]!, WINDOWS.window)]);
        if (isRejection(overSQL) || isRejection(inMemory)) throw new Error(`brush ask ${String(k)}: an engine refused`);
        expect(overSQL.count, `brush ask ${String(k)} count`).toBe(inMemory.count);
        expect(overSQL.count, `brush ask ${String(k)} keeps the bench clause's match count`).toBe(foldWindow.count);
        expect(overSQL.rows).toHaveLength(foldWindow.rows!.length);
      }

      // THE WIDE TABLE, landed beside the six-column one through the same port:
      // DuckDB's own words for its columns are the wire types the wide arm claims
      // to convert, both engines count the same rows in it, and the same window's
      // first row means the same thing out of both — a BIGINT back as a number, a
      // day and an instant back as the very strings the memory engine holds.
      const wideRows = widen(rows);
      await connection.load(WIDE_TABLE, { kind: 'rows', rows: wideRows });
      const described = (await connection.query(`DESCRIBE "${WIDE_TABLE}"`)).filter((row) => row['column_name'] !== '__row');
      expect(described).toHaveLength(WIDE_COLUMNS);
      for (const name of WIDE_GENERATED) {
        const family = name.slice(0, name.indexOf('_')) as keyof typeof WIDE_FAMILIES;
        const sqlType = String(described.find((row) => row['column_name'] === name)?.['column_type']);
        expect(sqlType, `${name} lands as ${WIDE_FAMILIES[family]}`).toMatch(new RegExp(`^${WIDE_FAMILIES[family]}`));
      }
      const wideWasm: DataProvider = wasmProvider({ sources: [WIDE_TABLE], connection });
      const wideMemory: DataProvider = memoryProvider(wideRows, { layout: 'row', tableName: WIDE_TABLE });
      const [wideOverSQL, wideInMemory] = await Promise.all([wideWasm.evaluate(WIDE_TABLE, clauses.and, WINDOWS.window), wideMemory.evaluate(WIDE_TABLE, clauses.and, WINDOWS.window)]);
      if (isRejection(wideOverSQL) || isRejection(wideInMemory)) throw new Error('the wide window was refused');
      expect(wideOverSQL.count).toBe(wideInMemory.count);
      expect(wideOverSQL.count, 'the wide table keeps the bench clause\'s match count — it is the same rows').toBe(foldWindow.count);
      expect(wideOverSQL.rows).toHaveLength(wideInMemory.rows!.length);
      const [liveFirst, foldFirst] = [wideOverSQL.rows![0]!, wideInMemory.rows![0]!];
      expect(Object.keys(liveFirst)).toHaveLength(WIDE_COLUMNS);
      expect(Object.keys(foldFirst)).toHaveLength(WIDE_COLUMNS);
      for (const family of ['int', 'dec', 'str', 'bool', 'date', 'ts'] as const) expect(liveFirst[`${family}_1`], `${family}_1 reads the same out of both engines`).toBe(foldFirst[`${family}_1`]);
      expect(typeof liveFirst['int_1'], 'a BIGINT comes back as a number, never a bigint').toBe('number');
      // the instant is a VARCHAR on the wire (a string was landed), so it comes back as the SAME text — not merely the same instant
      expect(typeof liveFirst['ts_1'], 'an ISO instant comes back as text').toBe('string');
      expect(liveFirst['ts_1'], 'the same spelling, whichever engine answered').toBe(foldFirst['ts_1']);
    } finally {
      await connection.close?.();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — the report. Skipped until a run writes one; armed the moment it does.
// ─────────────────────────────────────────────────────────────────────────────

/** The report's shape, as far as part B reads it. `failures`, `arms` and `controls.wide` are absent from a report written before the two later arms existed. */
interface Report {
  readonly controls: { readonly clock: { readonly live: boolean }; readonly agreement: readonly { readonly agree: boolean }[]; readonly wide?: { readonly columns: number } };
  readonly failures?: readonly { readonly engine: string; readonly size: string; readonly stage: string; readonly cause: string }[];
  readonly arms?: Readonly<Record<string, string>>;
  readonly results: readonly Measure[];
}

describe.skipIf(!existsSync(RESULTS))('step0-wasm bench · part B · the report a run wrote', () => {
  const json: Report = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as Report) : { controls: { clock: { live: false }, agreement: [] }, results: [] };
  const failures = json.failures ?? [];

  /**
   * Whether a recorded ceiling explains an engine's absence from an arm at a
   * size: a landing that failed (`open + load`) explains every arm; a wide
   * landing that failed explains the wide arm alone. Nothing else does — an
   * absence with no ceiling beside it is a hole in the report.
   */
  const ceilingCovers = (engine: string, size: string, arm: string): boolean =>
    failures.some((f) => f.engine === engine && f.size === size && (f.stage === 'open + load' || (arm === ARMS.wide && f.stage.startsWith(WIDE_TABLE))));

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

  it('every arm the contract names was measured for BOTH engines — except the one only the memory engine has, which says so, and a cell whose ceiling is recorded in the backend\'s words', () => {
    for (const size of SIZE_ORDER) {
      for (const arm of [ARMS.load, ARMS.count, ARMS.window, ARMS.sorted, ARMS.brush, ARMS.brushAsk, ARMS.wide]) {
        const engines = json.results.filter((r) => r.size === size && r.arm === arm).map((r) => r.engine);
        expect(engines, `${size} · ${arm} · the memory engine has no ceiling`).toContain('memory');
        if (!engines.includes('wasm')) expect(ceilingCovers('wasm', size, arm), `${size} · ${arm} · wasm is absent with no ceiling recorded`).toBe(true);
      }
      const first = json.results.filter((r) => r.size === size && r.arm === ARMS.sortedFirst);
      expect(first.map((r) => r.engine)).toEqual(['memory']);
      expect(first[0]?.note ?? '').toMatch(/permutation|fresh/);
    }
  });

  it('the moving brush: the sweep arm is a total and the per-ask arm has exactly the sweep\'s asks as its samples — so its spread is a p95 and not a max', () => {
    for (const r of json.results.filter((m) => m.arm === ARMS.brushAsk)) {
      expect(r.n, `${r.engine} ${r.size}`).toBe(BRUSH_ASKS);
      expect(r.warmup, `${r.engine} ${r.size} · the sweep arm is the warm-up`).toBe(0);
    }
    for (const r of json.results.filter((m) => m.arm === ARMS.brush)) expect(r.note ?? '').toMatch(/TOTAL/);
    // the twenty asks of one sweep cost about what one twentieth of the sweep costs — the two arms measured one gesture
    for (const size of SIZE_ORDER) {
      for (const engine of ['memory', 'wasm'] as const) {
        const sweep = json.results.find((m) => m.arm === ARMS.brush && m.size === size && m.engine === engine);
        const ask = json.results.find((m) => m.arm === ARMS.brushAsk && m.size === size && m.engine === engine);
        if (!sweep || !ask) continue;
        expect(ask.median * BRUSH_ASKS, `${engine} ${size} · per-ask × asks against the sweep`).toBeGreaterThan(sweep.median / 3);
        expect(ask.median * BRUSH_ASKS, `${engine} ${size} · per-ask × asks against the sweep`).toBeLessThan(sweep.median * 3);
      }
    }
  });

  it('the wide projection: the report names the arms it paired and says what DuckDB called the thirty columns', () => {
    expect(json.arms).toEqual(ARMS);
    const wideOverSQL = json.results.filter((m) => m.arm === ARMS.wide && m.engine === 'wasm');
    if (wideOverSQL.length > 0) expect(json.controls.wide?.columns).toBe(WIDE_COLUMNS);
    for (const size of SIZE_ORDER) {
      // the wide table is the same rows, so its control row counts the same matches as the six-column one
      const wideControl = json.controls.agreement.find((a) => (a as { size?: string; clause?: string }).size === size && (a as { clause?: string }).clause?.includes(WIDE_TABLE));
      const baseControl = json.controls.agreement.find((a) => (a as { size?: string; clause?: string }).size === size && !(a as { clause?: string }).clause?.includes(WIDE_TABLE));
      if (wideControl && baseControl) expect((wideControl as { memory?: number }).memory).toBe((baseControl as { memory?: number }).memory);
    }
  });
});
