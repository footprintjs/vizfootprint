/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DERIVE BENCH — THE INSTRUMENT, AND THE CONTRACT. ONE CLOCK, FOUR PATHS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The question: what does ONE derived column cost per row through the walker
 * (`src/derive/walk.ts` · `evaluate`), and how far is that from the floor —
 * the same tree hand-written as a JS closure, which nothing can beat.
 *
 * The law this bench rests on is `bench/step0-wasm`'s: every path is measured
 * by the SAME `timed` on the SAME rows in the SAME process, so the only
 * difference between two cells is the path that answered. And a number the
 * README quotes is a number this bench produced — never a rounder claim
 * (`feedback_measure_before_claiming`).
 *
 * Its own module, and not the bottom of `bench-entry.ts`, so `derive.test.ts`
 * can hold every instrument up to a known quantity before an arm is believed.
 */
import type { DerivedColumnDecl, Expr } from '../../src/derive/types.js';
import { stats } from '../step0/gen.js';

// ── The data: what one measurement IS. ───────────────────────────────────

/**
 * One measurement: one path, one expression, one size.
 *
 * `best` is the headline — the brief asks for best-of-N — and `median`/`max`
 * are the noise stated beside it. WHY best and not median: the cost of a walk
 * is a property of the code, and the fastest sample is the one with the least
 * of anything else (a collection, a page fault) charged to it; the spread says
 * how much the machine added.
 */
export interface Measure {
  readonly arm: string;
  readonly expr: string;
  readonly size: string;
  readonly rows: number;
  readonly best: number;
  readonly median: number;
  readonly max: number;
  readonly p95: number;
  readonly n: number;
  readonly warmup: number;
  readonly note?: string;
}

/** What one arm is asked for. `reps`/`warmup` override the run's defaults. */
export interface Ask {
  readonly arm: string;
  readonly expr: string;
  readonly size: string;
  readonly rows: number;
  readonly reps?: number;
  readonly warmup?: number;
  readonly note?: string;
}

export interface Harness {
  readonly results: readonly Measure[];
  timed(ask: Ask, fn: () => unknown): Measure;
}

// ── The two smallest tools. ──────────────────────────────────────────────

/** A garbage collection between samples, when node was started with --expose-gc — the previous arm's million cells are not this arm's cost. */
export function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) g();
}

/** A deliberate block of `ms` milliseconds of real work. The clock's known quantity, and nothing else uses it. */
export function spin(ms: number): number {
  const until = performance.now() + ms;
  let n = 0;
  while (performance.now() < until) n += 1;
  return n;
}

// ── The clock. ───────────────────────────────────────────────────────────

/**
 * The harness: `timed` around one call, warm-ups discarded, best / median / max kept.
 *
 * Synchronous on purpose: every path here is a plain loop over rows, and an
 * `await` between samples would let the event loop run something else inside
 * the measured window.
 */
export function createHarness(defaults: { readonly reps: number; readonly warmup: number }, say: (line: string) => void = () => {}): Harness {
  const results: Measure[] = [];
  return {
    results,
    timed(ask, fn) {
      const reps = ask.reps ?? defaults.reps;
      const warmup = ask.warmup ?? defaults.warmup;
      for (let i = 0; i < warmup; i++) fn();
      const samples: number[] = [];
      for (let i = 0; i < reps; i++) {
        gc();
        const t0 = performance.now();
        fn();
        samples.push(performance.now() - t0);
      }
      const { median, p95, min, n } = stats(samples);
      const measure: Measure = {
        arm: ask.arm,
        expr: ask.expr,
        size: ask.size,
        rows: ask.rows,
        best: min,
        median,
        max: Math.max(...samples),
        p95,
        n,
        warmup,
        ...(ask.note ? { note: ask.note } : {}),
      };
      results.push(measure);
      say(
        `  ${ask.size.padEnd(5)} ${ask.expr.padEnd(6)} ${ask.arm.padEnd(30)} best ${measure.best.toFixed(2).padStart(9)} ms  median ${measure.median.toFixed(2).padStart(9)} ms  max ${measure.max.toFixed(2).padStart(9)} ms  (n=${String(n)}, warm-up ${String(warmup)})`,
      );
      return measure;
    },
  };
}

// ── The contract: sizes, expressions, arms. ──────────────────────────────

/**
 * The two sizes, each with its repetition budget.
 *
 * 100,000 is the demo's order (the CDC cell shape is 90,300) and 1,000,000 is
 * the ceiling every bench in this folder uses. The brief's threshold is read
 * at 1M — a per-row cost that only shows at the small size is a warm-up
 * artefact, not a walk.
 */
export const SIZES = {
  '100k': { rows: 100_000, reps: 7, warmup: 2 },
  '1M': { rows: 1_000_000, reps: 5, warmup: 1 },
} as const;

export type Size = keyof typeof SIZES;

/** The sizes in the order the bench runs them and the table prints them: smallest first. */
export const SIZE_ORDER: readonly Size[] = Object.keys(SIZES) as Size[];

/**
 * The three expressions, of rising depth — the brief's three, as DECLARATIONS
 * so the bench walks them through the door a def's column takes
 * (`valuesOf`, `src/derive/groups.ts`) and the judge can be asked about each.
 *
 * - `read`  — a bare column read: the reader's cost, and nothing above it.
 * - `ratio` — `div(cases, population)`: one strict op over a governed read and a bare one.
 * - `tree6` — six op nodes (a `case` over a `gt` over a `div`; a `cast` over a
 *   `round` over a `coalesce`), seven leaves: the lazy ops build a closure per
 *   arm per row in today's walk, and this is where that shows if it shows.
 */
export const EXPRESSIONS = {
  read: { ops: 1, kind: 'row', expr: { col: 'cases' } },
  ratio: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { col: 'population' }] } },
  tree6: {
    ops: 1,
    kind: 'row',
    expr: {
      op: 'case',
      args: [
        { op: 'gt', args: [{ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, { lit: 0.001 }] },
        { lit: 'high' },
        { op: 'cast', args: [{ op: 'round', args: [{ op: 'coalesce', args: [{ col: 'cases' }, { lit: 0 }] }] }, { lit: 'string' }] },
      ],
    },
  },
} as const satisfies Record<string, DerivedColumnDecl>;

export type ExprName = keyof typeof EXPRESSIONS;

/** The expressions in the order they are run and printed: shallowest first. */
export const EXPR_ORDER: readonly ExprName[] = Object.keys(EXPRESSIONS) as ExprName[];

/** How many nodes a tree has, op nodes and leaves — printed beside each expression so "6-node" is a counted fact. */
export function nodesOf(expr: Expr): { readonly ops: number; readonly leaves: number } {
  if (expr.op === undefined) return { ops: 0, leaves: 1 };
  let ops = 1;
  let leaves = 0;
  for (const arg of expr.args) {
    const under = nodesOf(arg);
    ops += under.ops;
    leaves += under.leaves;
  }
  return { ops, leaves };
}

/**
 * The four arms, by name.
 *
 * WHY a constant: the table pairs the walk against the floors by this key, and
 * `derive.test.ts` asks the same arms of the same paths as its own control.
 */
export const ARMS = {
  /** `valuesOf(decl, rows)` over the Rows shape `deriveAnalysis` builds: one reader over a moving index. THE production door. */
  walkColumnar: 'walk · columnar door',
  /** `valuesOf(decl, rowsOver(rows, silence))`: the row-object door, one `readerFor` per row. */
  walkRows: 'walk · rowsOver door',
  /** The hand-written closure over the SAME reader the columnar walk reads through — the most a compiled tree could reach, since the reader stays. */
  floorReader: 'floor · closure over the reader',
  /** The hand-written closure over the raw column arrays, the absence gate inline — the floor nothing can beat. */
  floorRaw: 'floor · closure over raw columns',
} as const;

export type ArmName = keyof typeof ARMS;
