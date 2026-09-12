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
import { mulberry32, stats } from '../step0/gen.js';
import type { EvaluateOptions, PredicateClause, Row } from '../../src/data/types.js';

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
 * The arms, by name: the five the bench shipped with, and the two it named and
 * deferred — a moving brush (`brush` + `brushAsk`) and a wide projection (`wide`).
 *
 * WHY the names are a constant and not literals at the call sites: the table
 * pairs the two engines by this key, and `wasm.test.ts` asks the SAME questions
 * of the live engines as its own control. A typo would silently become a
 * one-engine row with an em dash beside it.
 *
 * WHY the brush is TWO names: a sweep is one gesture and one number (its
 * total), but the number a router reasons about is what ONE ask of it costs,
 * and a per-ask median is not a total divided by twenty. `brush` times the
 * whole sweep as one call; `brushAsk` times each ask of one sweep as its own
 * sample — {@link BRUSH_ASKS} samples, which is also the count at which
 * {@link spreadOf} may honestly call the spread a p95.
 */
export const ARMS = {
  load: 'construct / load the table',
  count: 'COUNT — point AND interval',
  window: 'rows, limit 100 — point AND interval',
  sorted: 'rows, ORDER BY cases DESC, limit 100 — repeat asks',
  sortedFirst: 'rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table',
  brush: 'rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart',
  brushAsk: 'rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks)',
  wide: 'rows, limit 100 — point AND interval, ALL 30 columns of the wide table',
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

// ── The contract: the moving brush. ──────────────────────────────────────

/** How many asks one sweep of the brush makes: the interval slides ONE week per ask, this many times. */
export const BRUSH_ASKS = 20;

/**
 * The brush: the bench interval, sliding one week per ask across the table's
 * span — {@link BRUSH_ASKS} clause pairs, each one week later than the last.
 *
 * WHY it is derived from {@link benchClauses} and not drawn fresh: the first
 * ask of the sweep IS the bench interval (`bench/step0` measured the memory
 * engine on that exact shape), so the two benches keep speaking about one
 * question. The point clause rides unchanged beside it: a brush moves ONE
 * clause while the rest of the gesture holds still, and holding the disease
 * fixed keeps the match count constant across the sweep — law 4 of the README —
 * so an ask's cost is the cost of a fresh judgement, never of a wider answer.
 *
 * WHY the sweep must FIT the span: an ask whose upper bound ran past the last
 * week would be clamped into a narrower interval, which is a different
 * question — so the sequence refuses, in words, rather than bending.
 *
 * WHY no cache can answer it, for either engine: the memory engine caches sort
 * PERMUTATIONS keyed by the sort spec (`memoryProvider.ts` · `permutationFor`),
 * never a clause's matches; DuckDB keeps no result cache across statements. So
 * every ask of the sweep is judged from the rows — which is exactly what a
 * real brush costs, and what no other arm of this bench measures.
 */
export function brushSequence(
  picked: { readonly disease: string; readonly from: string; readonly to: string },
  weeks: readonly string[],
  asks: number = BRUSH_ASKS,
): readonly (readonly PredicateClause[])[] {
  const from = weeks.indexOf(picked.from);
  const to = weeks.indexOf(picked.to);
  if (from < 0 || to < 0) throw new Error(`brushSequence: the bench interval [${picked.from}, ${picked.to}] is not made of the table's weeks`);
  if (to + asks > weeks.length) {
    throw new Error(
      `brushSequence: ${String(asks)} asks sliding from week ${String(to)} run past the table's ${String(weeks.length)} weeks — the sweep must fit the span, a clamped ask is a narrower question`,
    );
  }
  return Array.from({ length: asks }, (_, k) => benchClauses({ disease: picked.disease, from: weeks[from + k]!, to: weeks[to + k]! }).and);
}

// ── The contract: the wide table. ────────────────────────────────────────

/** The wide table's name in both engines. */
export const WIDE_TABLE = 'wide';

/** How many columns the wide table carries: the bench's six, plus four of each of the six generated families below. */
export const WIDE_COLUMNS = 30;

/**
 * The six generated column families, each named for the wire type DuckDB gives
 * it through the shipped rows port, MEASURED and not assumed. The port lands
 * rows as CSV with every column's type DECLARED from the rows' own tally
 * (`src/data/landing.ts`), so a family's wire type is the tally's word for
 * its JS values, not a sniffer's guess about their spelling:
 *
 *   int_N   BIGINT     an integer; `castBigIntToDouble` turns it back into a number on every read
 *   dec_N   DOUBLE     a fractional number. NOT a DECIMAL: a decimal column is declared DOUBLE,
 *                      so `castDecimalToDouble` never fires on this path
 *   date_N  VARCHAR    a day, `YYYY-MM-DD` — a STRING in JS, so a VARCHAR on the wire, read back
 *                      byte for byte; nothing is converted. (The JSON reader this port used to
 *                      write sniffed it into a DATE and converted epoch millis back to the day —
 *                      measured 2026-09-11, before and after.)
 *   ts_N    VARCHAR    an instant, `YYYY-MM-DDTHH:MM:SSZ` — the same: a string in, the same string
 *                      out. (The JSON reader typed THIS spelling a TIMESTAMP and `…:30.000Z` a
 *                      VARCHAR — the drift the declared types removed.)
 *   str_N   VARCHAR    a label from a small pool
 *   bool_N  BOOLEAN    a coin
 *
 * `wasm.test.ts` holds DuckDB's `DESCRIBE` to this list, so a reader of the
 * wide arm knows which conversions the number contains: BIGINT and BOOLEAN
 * cells are converted on the wire, DOUBLE and VARCHAR cells are copied.
 */
export const WIDE_FAMILIES = {
  int: 'BIGINT',
  dec: 'DOUBLE',
  date: 'VARCHAR',
  ts: 'VARCHAR',
  str: 'VARCHAR',
  bool: 'BOOLEAN',
} as const;

/** How many columns each family contributes: (30 − the bench's 6) ÷ 6 families. */
const PER_FAMILY = (WIDE_COLUMNS - 6) / Object.keys(WIDE_FAMILIES).length;

/** The generated column names, in the order a wide row carries them: family-major, so `int_1 … int_4, dec_1 …`. */
export const WIDE_GENERATED: readonly string[] = Object.keys(WIDE_FAMILIES).flatMap((family) => Array.from({ length: PER_FAMILY }, (_, i) => `${family}_${String(i + 1)}`));

/** A day of 2025 as `YYYY-MM-DD`, and an instant of it as `YYYY-MM-DDTHH:MM:SSZ`. */
const dayOf = (i: number): string => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const instantOf = (i: number): string => new Date(Date.UTC(2025, 0, 1) + i * 3_600_000).toISOString().replace('.000Z', 'Z');

/**
 * The wide table: the bench's rows, each carrying {@link WIDE_GENERATED} beside
 * its own six columns — the same rows, so the bench clause keeps its 3,080
 * matches, and only the width of what a window hands back changes.
 *
 * WHY the strings come from pools rather than one fresh string per cell: a
 * million rows of thirty columns must fit beside the six-column table in one
 * process, and a pooled label costs a row one pointer; the WIRE bytes DuckDB
 * converts are the same either way. Seeded (`mulberry32`, `../step0/gen.ts`),
 * so both engines are landed with the same cells.
 */
export function widen(rows: readonly Row[], seed = 7): Row[] {
  const rnd = mulberry32(seed);
  const days = Array.from({ length: 365 }, (_, i) => dayOf(i));
  const instants = Array.from({ length: 24 * 365 }, (_, i) => instantOf(i));
  const labels = Array.from({ length: 500 }, (_, i) => `Label ${String(i)}`);
  const pick = <T>(pool: readonly T[]): T => pool[Math.floor(rnd() * pool.length)]!;
  const cell = (family: keyof typeof WIDE_FAMILIES): unknown => {
    switch (family) {
      case 'int':
        return Math.floor(rnd() * 2_147_483_647);
      case 'dec':
        return Math.round(rnd() * 10_000_000) / 1000;
      case 'date':
        return pick(days);
      case 'ts':
        return pick(instants);
      case 'str':
        return pick(labels);
      case 'bool':
        return rnd() < 0.5;
    }
  };
  const families = WIDE_GENERATED.map((name) => name.slice(0, name.indexOf('_')) as keyof typeof WIDE_FAMILIES);
  return rows.map((row) => {
    const wide: Row = { ...row };
    for (let c = 0; c < WIDE_GENERATED.length; c++) wide[WIDE_GENERATED[c]!] = cell(families[c]!);
    return wide;
  });
}
