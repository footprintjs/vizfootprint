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
 * FOUR ARMS, chosen because they are what a session actually does (`measure.ts`
 * names them): landing the table, a COUNT of a live selection, a filtered window
 * of 100 rows, and a SORTED window — the last because the memory engine's sort is
 * the known cliff (`bench/step0`: a permutation over every row, cached per spec)
 * and SQL is where a sort is supposed to live.
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
import { ARMS, SIZES, SIZE_ORDER, WINDOWS, benchClauses, createHarness, gc, spin, type BenchEngine, type Size } from './measure.js';

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

const failures: Failure[] = [];
const agreement: Agreement[] = [];
const say = (line: string): void => void process.stderr.write(`${line}\n`);
// Every arm names its own budget (`budgetOf`), so this default is only the floor a future arm would inherit.
const harness = createHarness({ reps: SIZES['90k'].reps, warmup: WARMUP }, say);
const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ── The two engines, each opened the way a session opens it. ─────────────

/** One DuckDB, landed with these rows — the whole cost a first read pays. */
async function openLoaded(rows: readonly Row[]): Promise<LoadingConnection> {
  const connection = await duckdbConnection()();
  if (!canLoad(connection)) throw new Error('the shipped opener answered a connection that cannot land a table');
  await connection.load('data', { kind: 'rows', rows: rows as readonly Record<string, unknown>[] });
  return connection;
}

/** How many rows a clause keeps, or a thrown sentence — a bench arm over a refusal measures nothing. */
async function countOf(provider: DataProvider, clause: readonly PredicateClause[]): Promise<number> {
  const answer = await provider.evaluate('data', clause, WINDOWS.count);
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

// ── One size. ────────────────────────────────────────────────────────────

async function runSize(size: Size, rows: Row[], picked: { disease: string; from: string; to: string }): Promise<void> {
  const n = rows.length;
  const { and } = benchClauses(picked);
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
        opened.push(await openLoaded(rows));
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

for (const size of SIZE_ORDER) {
  const synthetic = synthesize(SIZES[size].rows, FALLBACK_SHAPE);
  const weeks = synthetic.weeks;
  await runSize(size, synthetic.rows, {
    // the 4th disease, and the middle half of the weeks — `bench/step0`'s own pick, so the two benches filter the same shape
    disease: synthetic.diseases[Math.min(3, synthetic.diseases.length - 1)]!,
    from: weeks[Math.floor(weeks.length * 0.25)]!,
    to: weeks[Math.floor(weeks.length * 0.75)]!,
  });
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
      gcExposed,
      controls: { clock, agreement },
      failures,
      results: harness.results,
    },
    null,
    1,
  ),
);
