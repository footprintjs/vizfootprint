/**
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP-0-WASM — THE INSTRUMENT. ONE CLOCK, TWO ENGINES, ONE PROCESS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The law this bench rests on: the memory engine and the in-browser (DuckDB)
 * engine are measured by the SAME `timed` on the SAME rows in the SAME process,
 * so the only difference between two numbers is the engine that answered.
 * A number produced any other way — two runs, two machines, two row sets — is
 * not a comparison, and `chooseEngine`'s thresholds may not be set from it.
 *
 * It is its own module, and not the bottom of `bench-entry.ts`, for the reason
 * `bench/layout/measure.ts` gives: an instrument nobody can hold up to a known
 * quantity is an instrument nobody has checked. `wasm.test.ts` holds this one up
 * to a deliberate 40 ms block before any arm of the bench is believed.
 *
 * First customers: `bench-entry.ts` (every arm) and `wasm.test.ts` (the controls).
 */
import { stats } from '../step0/gen.js';
import type { EvaluateOptions, PredicateClause } from '../../src/data/types.js';

// ── The data: what one measurement IS. ───────────────────────────────────

/** The two engines this bench compares. `server` is not one of them: it is a stub, and a stub has no cost to measure. */
export type BenchEngine = 'memory' | 'wasm';

/**
 * One measurement: one engine, one arm, one size.
 *
 * WHY `arm` and not a free-text name: the table puts the two engines SIDE BY
 * SIDE, and it can only do that if both of them measured something under the
 * same key. An arm one engine cannot run is an absent cell, said out loud.
 */
export interface Measure {
  readonly engine: BenchEngine;
  readonly arm: string;
  readonly size: string;
  readonly rows: number;
  readonly median: number;
  readonly p95: number;
  /**
   * The slowest sample. WHY it is kept beside `p95`: with `n` in the single
   * digits a p95 IS the max (the percentile lands on the last sample), so
   * printing it under a percentile's name dresses one observation up as a
   * distribution. {@link spreadOf} decides which name a reader is shown.
   */
  readonly max: number;
  readonly min: number;
  readonly n: number;
  /** The warm-ups this arm actually discarded — a load arm carries its own budget, so the run-wide default is not it. */
  readonly warmup: number;
  readonly note?: string;
}

/**
 * The second number a cell shows, and what to CALL it: the max under 20
 * samples, the p95 above it.
 *
 * WHY 20: a p95 needs at least twenty samples before the 95th percentile is
 * a different observation from the largest one. Below that the honest label
 * for the number is "the worst we saw".
 */
export function spreadOf(measure: Pick<Measure, 'n' | 'p95' | 'max'>): { readonly label: 'max' | 'p95'; readonly value: number } {
  return measure.n < 20 ? { label: 'max', value: measure.max } : { label: 'p95', value: measure.p95 };
}

/** What one arm is asked for. `reps`/`warmup` override the run's defaults — a load at 1,000,000 rows cannot be asked eleven times. */
export interface Ask {
  readonly engine: BenchEngine;
  readonly arm: string;
  readonly size: string;
  readonly rows: number;
  readonly reps?: number;
  readonly warmup?: number;
  readonly note?: string;
}

export interface Harness {
  readonly results: readonly Measure[];
  timed(ask: Ask, fn: () => unknown | Promise<unknown>): Promise<Measure>;
}

// ── The two smallest tools. ──────────────────────────────────────────────

/**
 * A garbage collection between samples, when node was started with --expose-gc.
 *
 * WHY: the previous arm's million row objects are not this arm's cost, and a
 * collection that happens to land inside a measured call is the difference
 * between a 2 ms number and a 40 ms one. A browser does not grant this
 * courtesy — which is a caveat the README carries, not a reason to skip it here.
 */
export function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) g();
}

/** A deliberate block of `ms` milliseconds of real work. The positive control's known quantity, and nothing else uses it. */
export function spin(ms: number): number {
  const until = performance.now() + ms;
  let n = 0;
  while (performance.now() < until) n += 1;
  return n;
}

// ── The clock. ───────────────────────────────────────────────────────────

/**
 * The harness: `timed` around one call, warm-ups discarded, median and spread kept.
 *
 * @param defaults how many measured repetitions and warm-ups an arm gets unless
 *   it asks for its own.
 * @param say where the running commentary goes (stderr in a run, nowhere in a test).
 */
export function createHarness(defaults: { readonly reps: number; readonly warmup: number }, say: (line: string) => void = () => {}): Harness {
  const results: Measure[] = [];
  return {
    results,
    async timed(ask: Ask, fn: () => unknown | Promise<unknown>): Promise<Measure> {
      const reps = ask.reps ?? defaults.reps;
      const warmup = ask.warmup ?? defaults.warmup;
      for (let i = 0; i < warmup; i++) await fn();
      const samples: number[] = [];
      for (let i = 0; i < reps; i++) {
        gc();
        const t0 = performance.now();
        await fn();
        samples.push(performance.now() - t0);
      }
      const measure: Measure = {
        engine: ask.engine,
        arm: ask.arm,
        size: ask.size,
        rows: ask.rows,
        ...stats(samples),
        max: Math.max(...samples),
        warmup,
        ...(ask.note ? { note: ask.note } : {}),
      };
      results.push(measure);
      const spread = spreadOf(measure);
      say(
        `  ${ask.size.padEnd(6)} ${ask.engine.padEnd(6)} ${ask.arm.padEnd(52)} median ${measure.median.toFixed(2).padStart(10)} ms  ` +
          `${spread.label} ${spread.value.toFixed(2).padStart(10)} ms  (n=${String(measure.n)}, warm-up ${String(measure.warmup)})`,
      );
      return measure;
    },
  };
}

// ── The contract: the sizes, the arms, and the exact question each asks. ─

/**
 * The three sizes, with each one's repetition budget.
 *
 * WHY three and not two: a threshold placed BETWEEN two measured points is a
 * guess wearing a number's clothes. 90,300 is the CDC cell shape, 1,000,000 is
 * the ceiling `bench/step0` used, and 300,000 exists because the first run of
 * this bench found the memory engine winning at the small end and DuckDB winning
 * everything at the large one — so the crossing is in there, and a router may
 * only be set from a size that was actually measured.
 *
 * WHY the load carries its own budget: it opens a FRESH database per repetition,
 * and serialising 1,000,000 rows seven times is minutes, not seconds. Every
 * measurement records its own `n`, so a reader never has to guess which applied.
 */
export const SIZES = {
  '90k': { rows: 90_300, reps: 7, loadReps: 3, loadWarmup: 1 },
  '300k': { rows: 300_000, reps: 5, loadReps: 3, loadWarmup: 1 },
  '1M': { rows: 1_000_000, reps: 3, loadReps: 2, loadWarmup: 0 },
} as const;

export type Size = keyof typeof SIZES;

/** The sizes in the order the bench runs them and the table prints them: smallest first. */
export const SIZE_ORDER: readonly Size[] = Object.keys(SIZES) as Size[];

// ── The contract: the arms, and the exact question each one asks. ────────

/**
 * The five arms, by name.
 *
 * WHY the names are a constant and not literals at the call sites: the table
 * pairs the two engines by this key, and `wasm.test.ts` asks the SAME questions
 * of the live engines as its own control. A typo would silently become a
 * one-engine row with an em dash beside it.
 */
export const ARMS = {
  load: 'construct / load the table',
  count: 'COUNT — point AND interval',
  window: 'rows, limit 100 — point AND interval',
  sorted: 'rows, ORDER BY cases DESC, limit 100 — repeat asks',
  sortedFirst: 'rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table',
} as const;

/** The window each arm asks for, as `EvaluateOptions` — one object, so neither engine is asked a different question. */
export const WINDOWS = {
  count: { mode: 'count' },
  window: { mode: 'rows', limit: 100 },
  sorted: { mode: 'rows', sort: [{ field: 'cases', dir: 'desc' }], limit: 100 },
} as const satisfies Record<string, EvaluateOptions>;

/**
 * The clauses every arm filters with: one point (a disease) and one interval
 * (a range of weeks) — the pair a real gesture makes, and the pair `bench/step0`
 * measured the memory engine with, so the two benches speak about one shape.
 *
 * WHY the values go through JSON: a clause arrives off the wire as a fresh
 * string, not as a pointer into the generator's own arrays, and a string a
 * comparison can shortcut by identity is not the string a session compares.
 */
export function benchClauses(picked: { readonly disease: string; readonly from: string; readonly to: string }): {
  readonly point: PredicateClause;
  readonly interval: PredicateClause;
  readonly and: readonly PredicateClause[];
} {
  const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const point: PredicateClause = { kind: 'point', field: 'disease', value: wire(picked.disease) };
  const interval: PredicateClause = { kind: 'interval', field: 't', value: [wire(picked.from), wire(picked.to)] };
  return { point, interval, and: [point, interval] };
}
