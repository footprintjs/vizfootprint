/**
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP-0-WASM — WHAT THE TWO ENGINES COST, ON ONE INSTRUMENT, IN ONE PROCESS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Q12 (docs/RESEARCH_STATE.md) is open: "auto-engine thresholds (rows/bytes for
 * memory->wasm->server) — measure with an X4-style bench, don't guess." This is
 * that measurement. `bench/step0` measured the memory engine alone; this one puts
 * the in-browser engine (DuckDB-WASM, opened in node — `src/data/duckdbConnection.ts`)
 * beside it on the SAME rows, through the SAME `evaluate` calls, under the same
 * clock, so the ratio between two cells is a fact about the engines and not about
 * two runs on two machines.
 *
 * THE ARMS, chosen because they are what a session actually does (`measure.ts`
 * names them): landing the table, a COUNT of a live selection, a filtered window
 * of 100 rows, a SORTED window — because the memory engine's sort is the known
 * cliff (`bench/step0`: a permutation over every row, cached per spec) and SQL is
 * where a sort is supposed to live — and the two that were named and deferred
 * when the bench shipped: a MOVING BRUSH (`brushSequence`: twenty interval asks,
 * one week apart, the one arm where no cache can answer for either engine —
 * timed as a whole sweep AND as its single asks) and a WIDE PROJECTION (`widen`:
 * the same rows carrying thirty columns, so DuckDB converts every cell of every
 * wire type on the way out while the memory engine hands back a row by
 * reference; it runs as a SECOND PASS after every six-column arm, in both
 * engines, and both take the same 100-row window from it — `wideArms` says why).
 *
 * THREE SIZES: 90,300 rows (the CDC cell shape `bench/step0/gen.ts` is calibrated
 * to), 300,000 and 1,000,000. Three and not two because a threshold placed
 * BETWEEN two measured points is a guess wearing a number's clothes — the middle
 * size exists so `chooseEngine`'s row threshold is a size that was RUN.
 *
 * Every number is the wall time of ONE call, `performance.now()` around it,
 * warm-ups discarded, median / p95 over the repetitions. `globalThis.gc()` runs
 * between samples when node was started with --expose-gc, so a collection the
 * previous sample earned is not charged to the next one.
 *
 * A FAILURE IS A MEASUREMENT. If an engine cannot land a size at all, that is
 * recorded as a ceiling with the backend's own words — not as a missing row and
 * never as a crash, because "DuckDB-WASM could not hold this" is exactly the
 * kind of fact `chooseEngine` exists to act on.
 */
import { memoryProvider } from '../../src/data/memoryProvider.js';
import { wasmProvider } from '../../src/data/wasmProvider.js';
import { duckdbConnection } from '../../src/data/duckdbConnection.js';
import { canLoad, isRejection } from '../../src/data/index.js';
import type { DataProvider, LoadingConnection, PredicateClause, Row } from '../../src/data/index.js';
import { FALLBACK_SHAPE, synthesize, stats } from '../step0/gen.js';
import { ARMS, BRUSH_ASKS, SIZES, SIZE_ORDER, WIDE_COLUMNS, WIDE_TABLE, WINDOWS, benchClauses, brushSequence, createHarness, gc, spin, widen, type BenchEngine, type Size } from './measure.js';

// ── The data: budgets, and the two ways an arm can end. ─────────────────

/** One size's budget, the contract's numbers unless the environment says otherwise. */
function budgetOf(size: Size): { readonly reps: number; readonly loadReps: number; readonly loadWarmup: number } {
  const base = SIZES[size];
  const key = size.toUpperCase();
  return {
    reps: Number(process.env[`STEP0W_REPS_${key}`] ?? base.reps),
    loadReps: Number(process.env[`STEP0W_REPS_LOAD_${key}`] ?? base.loadReps),
    loadWarmup: base.loadWarmup,
  };
}

const REPS = Object.fromEntries(SIZE_ORDER.map((size) => [size, budgetOf(size).reps]));
const WARMUP = 2;

/** An engine that could not do an arm at all, in the backend's own words. A ceiling, recorded. */
interface Failure {
  readonly engine: BenchEngine;
  readonly size: Size;
  readonly stage: string;
  readonly cause: string;
}

/** The control every arm below it depends on: the two engines counted the same rows. */
interface Agreement {
  readonly size: Size;
  readonly clause: string;
  readonly memory: number;
  readonly wasm: number;
  readonly agree: boolean;
}

/** What DuckDB's `DESCRIBE` said the wide table's columns ARE — the conversions the wide arm's number contains, recorded from the first size that landed it. */
interface WideWire {
  readonly columns: number;
  readonly types: Readonly<Record<string, string>>;
}

const failures: Failure[] = [];
const agreement: Agreement[] = [];
let wideWire: WideWire | null = null;
const say = (line: string): void => void process.stderr.write(`${line}\n`);
// Every arm names its own budget (`budgetOf`), so this default is only the floor a future arm would inherit.
const harness = createHarness({ reps: SIZES['90k'].reps, warmup: WARMUP }, say);
const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ── The two engines, each opened the way a session opens it. ─────────────

/** One DuckDB, landed with these rows under `table` — the whole cost a first read pays. A landing that throws closes what it opened first. */
async function openLoaded(table: string, rows: readonly Row[]): Promise<LoadingConnection> {
  const connection = await duckdbConnection()();
  if (!canLoad(connection)) throw new Error('the shipped opener answered a connection that cannot land a table');
  try {
    await connection.load(table, { kind: 'rows', rows: rows as readonly Record<string, unknown>[] });
  } catch (error) {
    await connection.close?.();
    throw error;
  }
  return connection;
}

/** How many rows a clause keeps, or a thrown sentence — a bench arm over a refusal measures nothing. */
async function countOf(provider: DataProvider, clause: readonly PredicateClause[], table = 'data'): Promise<number> {
  const answer = await provider.evaluate(table, clause, WINDOWS.count);
  if (isRejection(answer)) throw new Error(`the ${provider.engine} engine refused the bench clause: ${answer.detail}`);
  return answer.count;
}

/** The three read arms, asked of one engine. The SAME three calls, whichever engine answers. */
async function readArms(engine: BenchEngine, provider: DataProvider, size: Size, rows: number, and: readonly PredicateClause[]): Promise<void> {
  const { reps } = budgetOf(size);
  await harness.timed({ engine, arm: ARMS.count, size, rows, reps }, () => provider.evaluate('data', and, WINDOWS.count));
  await harness.timed(
    { engine, arm: ARMS.window, size, rows, reps, note: engine === 'wasm' ? 'two statements: the window, then a COUNT of the whole selection' : undefined },
    () => provider.evaluate('data', and, WINDOWS.window),
  );
  await harness.timed(
    { engine, arm: ARMS.sorted, size, rows, reps, note: engine === 'wasm' ? 'DuckDB keeps no permutation: every ask sorts' : 'the permutation is cached per sort spec — this is the second ask onwards' },
    () => provider.evaluate('data', and, WINDOWS.sorted),
  );
}

/**
 * The moving brush, asked of one engine: the whole sweep as ONE timed call, then
 * each ask of one more sweep as its own sample.
 *
 * WHY the per-ask arm takes no warm-up: the sweep arm just ran the same twenty
 * asks `reps + 2` times over, so the engine is as warm as it will get, and a
 * warm-up here would consume asks of the sequence — the cursor `k` walks the
 * sweep once, so the twenty samples ARE the twenty asks, in order.
 */
async function brushArms(engine: BenchEngine, provider: DataProvider, size: Size, rows: number, sweep: readonly (readonly PredicateClause[])[]): Promise<void> {
  const { reps } = budgetOf(size);
  const statements = engine === 'wasm' ? ' — two statements per ask: the window, then a COUNT of the selection' : '';
  await harness.timed(
    { engine, arm: ARMS.brush, size, rows, reps, note: `the TOTAL for ${String(sweep.length)} asks, the interval one week later each time; no cache answers any of them${statements}` },
    async () => {
      for (const and of sweep) await provider.evaluate('data', and, WINDOWS.window);
    },
  );
  let k = 0;
  await harness.timed(
    { engine, arm: ARMS.brushAsk, size, rows, reps: sweep.length, warmup: 0, note: `each ask of ONE sweep is one sample (n = ${String(sweep.length)}, so the spread is a p95); no warm-up — the sweep arm ran first${statements}` },
    () => provider.evaluate('data', sweep[k++]!, WINDOWS.window),
  );
}

/**
 * The wide projection: the same rows widened to {@link WIDE_COLUMNS} columns,
 * landed in BOTH engines (its own DuckDB, the way a dashboard whose table is
 * wide would open one), and the `window` arm's exact ask taken from it — so
 * `wide ÷ window`, per engine, is the price of the other twenty-four columns
 * and nothing else.
 *
 * WHY it runs as a SECOND PASS, after every six-column arm at every size, and
 * never inside `runSize`: the memory engine's construction and fold sites
 * (`memoryProvider.ts` · `toRowStore`, `fold.ts` · `foldOnce`) are shared by
 * every table this process builds, and once V8's inline caches there have seen
 * a second row SHAPE they stay polymorphic — measured 2026-09-11: with the wide
 * table built inside the 90k pass, the 300k and 1M memory LOAD arms came back
 * +52% and +53% (33 ms against 22 ms; 111 ms against 78 ms) against the same
 * code with the wide arm removed. A six-column number may not carry a
 * thirty-column table's JIT history, so the wide table is the LAST shape this
 * process learns. Its own memory numbers are therefore taken with those caches
 * already holding one shape — which is also what a dashboard with more than
 * one table pays.
 *
 * WHY the wide landing is NOT a timed arm: the load arm is the six-column
 * table's, and this packet measures reads; the landing's wall time goes to the
 * log, and a landing the port refuses is a ceiling in `failures[]` — which is
 * a measurement too (law 3), and at 1,000,000 rows it is the one this arm found.
 */
async function wideArms(size: Size, rows: readonly Row[], and: readonly PredicateClause[]): Promise<void> {
  const n = rows.length;
  let t0 = performance.now();
  const wideRows = widen(rows);
  say(`  wide: ${String(WIDE_COLUMNS)}-column rows generated in ${(performance.now() - t0).toFixed(0)} ms`);
  t0 = performance.now();
  const memory = memoryProvider(wideRows, { layout: 'row', tableName: WIDE_TABLE });
  say(`  wide: the memory engine constructed the ${String(WIDE_COLUMNS)}-column table in ${(performance.now() - t0).toFixed(0)} ms`);

  let live: LoadingConnection | null = null;
  let wasm: DataProvider | null = null;
  try {
    t0 = performance.now();
    live = await openLoaded(WIDE_TABLE, wideRows);
    say(`  wide: DuckDB opened and landed the ${String(WIDE_COLUMNS)}-column table in ${(performance.now() - t0).toFixed(0)} ms`);
    wasm = wasmProvider({ sources: [WIDE_TABLE], connection: live });
    wideWire ??= await describeWide(live);
  } catch (error) {
    failures.push({ engine: 'wasm', size, stage: `${WIDE_TABLE}: land ${String(WIDE_COLUMNS)} columns through the rows port`, cause: causeOf(error) });
    say(`  !! wasm could not land the ${String(WIDE_COLUMNS)}-column table at ${size}: ${causeOf(error)}`);
    wasm = null;
  }
  gc();

  // the control again, on THIS table: the same clause keeps the same rows in both engines, or the arm means nothing.
  if (wasm) {
    try {
      const [inMemory, overSQL] = [await countOf(memory, and, WIDE_TABLE), await countOf(wasm, and, WIDE_TABLE)];
      agreement.push({ size, clause: `point AND interval, ${WIDE_TABLE} (${String(WIDE_COLUMNS)} columns)`, memory: inMemory, wasm: overSQL, agree: inMemory === overSQL });
      say(`  control: ${inMemory.toLocaleString('en-US')} wide rows match in memory, ${overSQL.toLocaleString('en-US')} in DuckDB — ${inMemory === overSQL ? 'agree' : 'DISAGREE'}`);
    } catch (error) {
      failures.push({ engine: 'wasm', size, stage: `${WIDE_TABLE}: control count`, cause: causeOf(error) });
      wasm = null;
    }
  }

  const { reps } = budgetOf(size);
  await harness.timed(
    { engine: 'memory', arm: ARMS.wide, size, rows: n, reps, note: 'the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns' },
    () => memory.evaluate(WIDE_TABLE, and, WINDOWS.window),
  );
  if (wasm) {
    await harness.timed(
      { engine: 'wasm', arm: ARMS.wide, size, rows: n, reps, note: 'DuckDB converts every cell on the wire (BIGINT/DOUBLE → number, DATE/TIMESTAMP → ISO text) — two statements: the window, then a COUNT of the selection' },
      () => wasm.evaluate(WIDE_TABLE, and, WINDOWS.window),
    );
  }
  await live?.close?.();
}

/** DuckDB's own word for each wide column — read once, so the table can say which conversions the wide arm's number contains. */
async function describeWide(live: LoadingConnection): Promise<WideWire> {
  const described = await live.query(`DESCRIBE "${WIDE_TABLE}"`);
  const own = described.filter((row) => row['column_name'] !== '__row');
  return { columns: own.length, types: Object.fromEntries(own.map((row) => [String(row['column_name']), String(row['column_type'])])) };
}

// ── One size. ────────────────────────────────────────────────────────────

async function runSize(size: Size, rows: Row[], weeks: readonly string[], picked: { disease: string; from: string; to: string }): Promise<void> {
  const n = rows.length;
  const { and } = benchClauses(picked);
  const sweep = brushSequence(picked, weeks, BRUSH_ASKS);
  const { loadReps, loadWarmup } = budgetOf(size);
  say(`\n== ${size}: ${n.toLocaleString('en-US')} rows ==`);

  // 1. the memory engine: construction IS its load.
  let memory: DataProvider = memoryProvider(rows, { layout: 'row' });
  await harness.timed(
    { engine: 'memory', arm: ARMS.load, size, rows: n, reps: loadReps, warmup: loadWarmup, note: 'memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold' },
    () => {
      memory = memoryProvider(rows, { layout: 'row' });
    },
  );
  gc();

  // 2. the wasm engine: a fresh database per repetition, landed through the port a def's build uses.
  //    WHY each one is kept and closed AFTER the arm: closing inside the timed call
  //    would charge this arm for releasing the PREVIOUS repetition's database.
  const opened: LoadingConnection[] = [];
  let live: LoadingConnection | null = null;
  let wasm: DataProvider | null = null;
  try {
    await harness.timed(
      {
        engine: 'wasm',
        arm: ARMS.load,
        size,
        rows: n,
        reps: loadReps,
        warmup: loadWarmup,
        note: 'a fresh database per rep: instantiate the wasm module + registerFileText(rows as JSON) + CREATE TABLE AS SELECT … row_number()',
      },
      async () => {
        opened.push(await openLoaded('data', rows));
      },
    );
    live = opened.pop() ?? null;
    wasm = live === null ? null : wasmProvider({ sources: ['data'], connection: live });
  } catch (error) {
    // The ceiling, in the backend's own words. Every wasm arm at this size is
    // absent from the table on purpose, with this sentence beside it.
    failures.push({ engine: 'wasm', size, stage: 'open + load', cause: causeOf(error) });
    say(`  !! wasm could not land ${size}: ${causeOf(error)}`);
  }
  for (const spare of opened) await spare.close?.();
  opened.length = 0;
  gc();

  // 3. the control: the same clause, the same count, or nothing below this line means anything.
  if (wasm) {
    try {
      const [inMemory, overSQL] = [await countOf(memory, and), await countOf(wasm, and)];
      agreement.push({ size, clause: 'point AND interval', memory: inMemory, wasm: overSQL, agree: inMemory === overSQL });
      say(`  control: ${inMemory.toLocaleString('en-US')} rows match in memory, ${overSQL.toLocaleString('en-US')} in DuckDB — ${inMemory === overSQL ? 'agree' : 'DISAGREE'}`);
    } catch (error) {
      failures.push({ engine: 'wasm', size, stage: 'control count', cause: causeOf(error) });
      wasm = null;
    }
  }

  // 4. the read arms, both engines, same calls.
  await readArms('memory', memory, size, n, and);
  if (wasm) await readArms('wasm', wasm, size, n, and);

  // 4b. the moving brush, both engines, the same twenty asks.
  await brushArms('memory', memory, size, n, sweep);
  if (wasm) await brushArms('wasm', wasm, size, n, sweep);

  // 5. the arm only the memory engine has: the FIRST sorted ask, which pays for the permutation.
  await harness.timed(
    {
      engine: 'memory',
      arm: ARMS.sortedFirst,
      size,
      rows: n,
      reps: loadReps,
      warmup: loadWarmup,
      note: 'a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask',
    },
    async () => {
      const cold = memoryProvider(rows, { layout: 'row' });
      await cold.evaluate('data', and, WINDOWS.sorted);
    },
  );

  await live?.close?.();
  gc();
}

// ── main ─────────────────────────────────────────────────────────────────

const gcExposed = typeof (globalThis as { gc?: unknown }).gc === 'function';
say(`node ${process.version} · ${process.platform} ${process.arch} · reps ${JSON.stringify(REPS)} · warm-up ${String(WARMUP)} · gc ${gcExposed ? 'exposed' : 'NOT exposed'}`);

// The clock, held up to a known quantity before any arm is believed.
const clockRead = stats(
  [1, 2, 3].map(() => {
    const t0 = performance.now();
    spin(40);
    return performance.now() - t0;
  }),
).median;
const clock = { askedMs: 40, readMs: clockRead, live: clockRead >= 20 && clockRead < 2_000 };
say(`control: a deliberate 40 ms block reads ${clockRead.toFixed(1)} ms — ${clock.live ? 'the clock is alive' : 'THE CLOCK IS DEAD'}`);

/** `bench/step0`'s own pick — the 4th disease, and the middle half of the weeks — so the two benches filter the same shape. */
function pickOf(synthetic: { readonly diseases: readonly string[]; readonly weeks: readonly string[] }): { disease: string; from: string; to: string } {
  const weeks = synthetic.weeks;
  return {
    disease: synthetic.diseases[Math.min(3, synthetic.diseases.length - 1)]!,
    from: weeks[Math.floor(weeks.length * 0.25)]!,
    to: weeks[Math.floor(weeks.length * 0.75)]!,
  };
}

for (const size of SIZE_ORDER) {
  const synthetic = synthesize(SIZES[size].rows, FALLBACK_SHAPE);
  await runSize(size, synthetic.rows, synthetic.weeks, pickOf(synthetic));
  gc();
}

// The wide pass — the LAST shape this process learns (see `wideArms` for why). The rows are
// synthesised again rather than kept: the generator is seeded, so they are the same rows, and
// keeping a million six-column rows alive through the first pass would be a cost of its own.
say(`\n== the wide pass: the same rows, ${String(WIDE_COLUMNS)} columns, both engines ==`);
for (const size of SIZE_ORDER) {
  const synthetic = synthesize(SIZES[size].rows, FALLBACK_SHAPE);
  say(`-- ${size}: ${synthetic.rows.length.toLocaleString('en-US')} rows --`);
  await wideArms(size, synthetic.rows, benchClauses(pickOf(synthetic)).and);
  gc();
}

process.stdout.write(
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      generatedAt: new Date().toISOString(),
      shape: FALLBACK_SHAPE,
      reps: REPS,
      warmup: WARMUP,
      sizes: SIZES,
      // WHY the contract's arm names ride in the report: `table.mjs` pairs the wide arm with the window arm BY NAME, and it cannot import `measure.ts`.
      arms: ARMS,
      gcExposed,
      controls: { clock, agreement, ...(wideWire ? { wide: wideWire } : {}) },
      failures,
      results: harness.results,
    },
    null,
    1,
  ),
);
