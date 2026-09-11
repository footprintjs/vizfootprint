/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DERIVE BENCH — WHAT ONE DERIVED COLUMN COSTS PER ROW, AND HOW FAR FROM THE FLOOR.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `src/derive/walk.ts` · `evaluate` used to walk the expression TREE on every
 * row: each node looked its op up by name, re-judged the op's `wants` against
 * the argument cells, and a lazy op built a fresh closure per arm per row. All
 * of that is a property of the tree, not of the row. This bench said what it
 * cost BEFORE any of it was compiled away, and says what it costs after —
 * measured, on the real door, against a floor
 * (`feedback_measure_before_claiming`; `bench/step0-wasm` is the template).
 *
 * FOUR ARMS per expression per size (`measure.ts` · `ARMS`): the walk through
 * the columnar door `deriveAnalysis` builds (THE production path), the walk
 * through the `rowsOver` door, and two hand-written floors — over the same
 * reader, and over the raw columns.
 *
 * THREE EXPRESSIONS of rising depth (`measure.ts` · `EXPRESSIONS`) and TWO
 * SIZES (100,000 and 1,000,000 rows). Every number is the wall time of ONE
 * `valuesOf` — the whole column — `performance.now()` around it, warm-ups
 * discarded, best / median / max over the repetitions, `gc()` between samples.
 *
 * THE CONTROLS COME FIRST: the clock against a deliberate block; the judge
 * accepting every tree (a walk assumes a judged tree); and, per size and
 * expression, all four paths answering the SAME cell on EVERY row, with a
 * present share strictly between 0 and 1 — a path that answered absent
 * everywhere would post the best time in every arm.
 */
import { judgeDerivedColumn } from '../../src/derive/judge.js';
import { rowsOver, valuesOf, type Rows } from '../../src/derive/groups.js';
import type { Cell } from '../../src/derive/types.js';
import { stats } from '../step0/gen.js';
import { FLOOR_OVER_COLUMNS, FLOOR_OVER_READER } from './floors.js';
import { ARMS, EXPRESSIONS, EXPR_ORDER, SIZES, SIZE_ORDER, createHarness, gc, nodesOf, spin, type ExprName, type Size } from './measure.js';
import { COLUMNS, benchSilence, benchTable, columnarRowsOf, type BenchTable } from './rows.js';

// ── budgets ──────────────────────────────────────────────────────────────

/** One size's budget, the contract's numbers unless the environment says otherwise (`DERIVE_REPS_100K`, `DERIVE_REPS_1M`). */
function budgetOf(size: Size): { readonly reps: number; readonly warmup: number } {
  const base = SIZES[size];
  return { reps: Number(process.env[`DERIVE_REPS_${size.toUpperCase()}`] ?? base.reps), warmup: base.warmup };
}

const REPS = Object.fromEntries(SIZE_ORDER.map((size) => [size, budgetOf(size).reps]));
const say = (line: string): void => void process.stderr.write(`${line}\n`);
const harness = createHarness({ reps: SIZES['100k'].reps, warmup: SIZES['100k'].warmup }, say);

// ── the controls ──────────────────────────────────────────────────────────

/** Per size and expression: did the four paths answer the same cell on every row, and did they answer anything at all? */
interface Agreement {
  readonly size: Size;
  readonly expr: ExprName;
  readonly mismatches: number;
  readonly present: number;
  readonly agree: boolean;
}

/** The judge's word on each tree, and its counted size — so "6-node" is a fact the report carries. */
interface Judged {
  readonly expr: ExprName;
  readonly ok: boolean;
  readonly type: string;
  readonly ops: number;
  readonly leaves: number;
}

const agreement: Agreement[] = [];
const judged: Judged[] = EXPR_ORDER.map((expr) => {
  const verdict = judgeDerivedColumn(EXPRESSIONS[expr], 'cells', COLUMNS);
  const nodes = nodesOf(EXPRESSIONS[expr].expr);
  return { expr, ok: verdict.ok, type: verdict.ok ? verdict.type : verdict.problem, ...nodes };
});

/** How many cells differ between two answers, `===` — cells are never NaN, so identity is the walker's own equality. */
function mismatchesOf(one: readonly Cell[], other: readonly Cell[]): number {
  if (one.length !== other.length) return Math.max(one.length, other.length);
  let n = 0;
  for (let at = 0; at < one.length; at += 1) if (one[at] !== other[at]) n += 1;
  return n;
}

// ── the four paths ────────────────────────────────────────────────────────

/** The floor over the reader, as a whole column: the same loop `valuesOf` runs, with the closure where the tree was. */
function floorReaderColumn(expr: ExprName, rows: Rows): Cell[] {
  const floor = FLOOR_OVER_READER[expr];
  const out: Cell[] = [];
  for (let at = 0; at < rows.count; at += 1) out.push(floor(rows.at(at)));
  return out;
}

/** The floor over the raw columns, as a whole column. */
function floorRawColumn(expr: ExprName, table: BenchTable): Cell[] {
  const floor = FLOOR_OVER_COLUMNS[expr];
  const out: Cell[] = [];
  for (let at = 0; at < table.count; at += 1) out.push(floor(table.columns, at));
  return out;
}

// ── one size ──────────────────────────────────────────────────────────────

function runSize(size: Size, table: BenchTable): void {
  const n = table.count;
  const { reps, warmup } = budgetOf(size);
  const columnar = columnarRowsOf(table);
  const silence = benchSilence();
  say(`\n== ${size}: ${n.toLocaleString('en-US')} rows ==`);

  for (const expr of EXPR_ORDER) {
    const decl = EXPRESSIONS[expr];
    // 1. the control: four answers, one column. Or nothing below means anything.
    const answers = [valuesOf(decl, columnar), valuesOf(decl, rowsOver(table.rows, silence)), floorReaderColumn(expr, columnar), floorRawColumn(expr, table)];
    const mismatches = answers.slice(1).reduce((worst, other) => Math.max(worst, mismatchesOf(answers[0]!, other)), 0);
    const present = answers[0]!.filter((cell) => cell !== null).length / n;
    const agree = mismatches === 0 && present > 0 && present < 1;
    agreement.push({ size, expr, mismatches, present, agree });
    say(`  control ${expr}: ${mismatches === 0 ? 'all four paths agree' : `${String(mismatches)} CELLS DIFFER`} on ${n.toLocaleString('en-US')} rows · present share ${present.toFixed(3)} — ${agree ? 'ok' : 'VOID'}`);
    gc();

    // 2. the arms. The same column, four ways.
    harness.timed({ arm: ARMS.walkColumnar, expr, size, rows: n, reps, warmup, note: 'valuesOf over ONE reader on a moving index — what deriveAnalysis runs' }, () => valuesOf(decl, columnar));
    harness.timed({ arm: ARMS.walkRows, expr, size, rows: n, reps, warmup, note: 'valuesOf over rowsOver(rows): the row-object door, one reader over a moving row' }, () => valuesOf(decl, rowsOver(table.rows, silence)));
    harness.timed({ arm: ARMS.floorReader, expr, size, rows: n, reps, warmup, note: 'the hand-written closure, reading through the same gated reader' }, () => floorReaderColumn(expr, columnar));
    harness.timed({ arm: ARMS.floorRaw, expr, size, rows: n, reps, warmup, note: 'the hand-written closure over the column arrays, the gate inline' }, () => floorRawColumn(expr, table));
    gc();
  }
}

// ── main ──────────────────────────────────────────────────────────────────

const gcExposed = typeof (globalThis as { gc?: unknown }).gc === 'function';
say(`node ${process.version} · ${process.platform} ${process.arch} · reps ${JSON.stringify(REPS)} · gc ${gcExposed ? 'exposed' : 'NOT exposed'}`);

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
for (const j of judged) say(`control: the judge ${j.ok ? 'accepts' : 'REFUSES'} ${j.expr} (${String(j.ops)} op nodes, ${String(j.leaves)} leaves) — ${j.type}`);

for (const size of SIZE_ORDER) {
  runSize(size, benchTable(SIZES[size].rows));
  gc();
}

process.stdout.write(
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      generatedAt: new Date().toISOString(),
      reps: REPS,
      sizes: SIZES,
      gcExposed,
      expressions: Object.fromEntries(EXPR_ORDER.map((expr) => [expr, EXPRESSIONS[expr].expr])),
      controls: { clock, judged, agreement },
      results: harness.results,
    },
    null,
    1,
  ),
);
