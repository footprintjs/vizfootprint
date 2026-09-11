/**
 * `compile` AGAINST THE TREE IT REPLACED — the proof, not the claim.
 *
 * `walk.ts` used to walk the tree fresh on every row (op lookup by name, `wants`
 * re-judged per node, a fresh closure per lazy arm per row). `compile` decides
 * all of that ONCE and hands back a closure tree; `evaluate`/`evaluateRow` are
 * now thin doors over a plan remembered per tree (`planned`, a `WeakMap<Expr,
 * Compiled>`). Two things could make that wrong in a way no existing test would
 * catch, because every existing test only ever built ONE fresh tree per case:
 *
 *   1. A SHARED sub-expression object — the same `Expr` referenced twice in one
 *      tree, or reachable through a lazy arm that could re-enter a strict
 *      ancestor's own per-node cells buffer while that buffer is still being
 *      filled.
 *   2. A `WeakMap` keyed by object IDENTITY — safe only if nothing mutates an
 *      `Expr` in place after it was first evaluated.
 *
 * `referenceEvaluate` below is the OLD `evaluate` — `git show
 * HEAD:src/derive/walk.ts` before `compile` existed — copied in verbatim as an
 * independent oracle: it re-walks the tree from scratch on every call, so it
 * cannot share this file's bug even if `compile` had one. It reads the SAME
 * `./ops.js` table `compile` does (untouched by the compile packet), so a
 * divergence between the two can only be the walk, never the vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { epochDayOf, isoOfMoment } from './dates.js';
import { opOf, wantAt, type ArgWant, type Op } from './ops.js';
import { compile, evaluate, readerFor } from './index.js';
import type { Cell, CellReader, Expr, GroupAnswer } from './index.js';
import { silenceOfDecl, type TableSilence } from '../data/silence.js';
import type { Row } from '../data/types.js';

/** `report_state` governs `cases` — the bench's own shape (`bench/derive/rows.ts` · `ABSENCE`), so a random row's silent states actually GATE something instead of sitting inert in the row. */
const GOVERNED: TableSilence = silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown', 'not-configured'], governs: ['cases'] });
const readGoverned = (row: Row): CellReader => readerFor(row, GOVERNED);

// ── the oracle: the walker exactly as it read before `compile` existed ──────

function referenceAsCell(value: unknown): Cell {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return isoOfMoment(value);
  return null;
}

function referenceHoldsWant(cell: Cell, want: ArgWant): boolean {
  if (want === 'number') return typeof cell === 'number';
  if (want === 'string' || want === 'unit' || want === 'target') return typeof cell === 'string';
  if (want === 'boolean') return typeof cell === 'boolean';
  if (want === 'date') return typeof cell === 'string' && epochDayOf(cell) !== null;
  if (want === 'ordered') return typeof cell !== 'boolean';
  return true;
}

function referenceCellsFor(op: Op, args: readonly Expr[], read: CellReader, group: GroupAnswer | undefined): Cell[] | null {
  const cells: Cell[] = [];
  let shared: string | null = null;
  for (let at = 0; at < args.length; at += 1) {
    const cell = referenceEvaluate(args[at]!, read, group);
    if (cell === null) return null;
    const want = wantAt(op, at, args.length);
    if (!referenceHoldsWant(cell, want)) return null;
    if (want === 'same' || want === 'ordered') {
      if (shared === null) shared = typeof cell;
      else if (shared !== typeof cell) return null;
    }
    cells.push(cell);
  }
  return cells;
}

/** The pre-`compile` `evaluate`, byte-for-byte in behaviour: no plan, no cache, the tree read fresh every call. */
function referenceEvaluate(expr: Expr, read: CellReader, group?: GroupAnswer): Cell {
  if (expr.col !== undefined) return referenceAsCell(read(expr.col));
  if (expr.lit !== undefined) return expr.lit;
  const op = opOf(expr.op)!;
  if (op.reduces === true) return group === undefined ? null : referenceAsCell(group(expr));
  if (!op.strict) return referenceAsCell(op.of(expr.args.map((arg) => () => referenceEvaluate(arg, read, group))));
  const cells = referenceCellsFor(op, expr.args, read, group);
  return cells === null ? null : referenceAsCell(op.of(cells, expr.calendar));
}

// ── a tiny seeded PRNG, so a failure is reproducible without a fixed fixture list ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── rows that reach absent, silent, wrong-typed and unknown-state cells ─────

const CASES_POOL: readonly unknown[] = [12, 0, -7, 2.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, 'seven', '12', null, undefined, true, new Date('2026-01-04T00:00:00Z'), new Date(Number.NaN)];
const POPULATION_POOL: readonly unknown[] = [1_000, 0, -50, 'a lot', null, undefined, 3.5];
const STATE_POOL: readonly (string | undefined)[] = ['present', 'unavailable', 'unknown', 'not-configured', undefined];

/** One random row, wide enough to exercise every arm of every bench tree — including the ones a seeded demo table never reaches. */
function randomRow(rnd: () => number): Row {
  const pick = <T>(pool: readonly T[]): T => pool[Math.floor(rnd() * pool.length)]!;
  const row: Row = { cases: pick(CASES_POOL), population: pick(POPULATION_POOL) };
  const state = pick(STATE_POOL);
  if (state !== undefined) row['report_state'] = state;
  return row;
}

const col = (name: string): Expr => ({ col: name });
const lit = (value: number | string | boolean | null): Expr => ({ lit: value });

/** The bench's own three (`bench/derive/measure.ts` · `EXPRESSIONS`), read here so the two never drift apart in silence. */
const READ: Expr = col('cases');
const RATIO: Expr = { op: 'div', args: [col('cases'), col('population')] };
const TREE6: Expr = {
  op: 'case',
  args: [
    { op: 'gt', args: [{ op: 'div', args: [col('cases'), col('population')] }, lit(0.001)] },
    lit('high'),
    { op: 'cast', args: [{ op: 'round', args: [{ op: 'coalesce', args: [col('cases'), lit(0)] }] }, lit('string')] },
  ],
};

/** A fourth tree: the SAME `Expr` object referenced twice as one strict node's own two arguments. */
const HALF: Expr = { op: 'div', args: [col('cases'), lit(2)] };
const SHARED_SUBEXPRESSION: Expr = { op: 'add', args: [HALF, HALF] };

/**
 * THE WORST CASE the review asked for: a STRICT node (`mul`) whose own first
 * argument is `INNER`, and whose second argument is a LAZY node (`coalesce`)
 * whose arm is that SAME `INNER` object — so if `compile` ever shared one
 * cells buffer across two occurrences of one `Expr`, the lazy arm firing INSIDE
 * `mul`'s fill loop would be the place it corrupted the other's read.
 */
const INNER: Expr = { op: 'add', args: [col('cases'), col('population')] };
const REENTRANT: Expr = { op: 'mul', args: [INNER, { op: 'coalesce', args: [INNER, lit(0)] }] };

const TREES: readonly { readonly name: string; readonly expr: Expr }[] = [
  { name: 'read', expr: READ },
  { name: 'ratio', expr: RATIO },
  { name: 'tree6', expr: TREE6 },
  { name: 'shared sub-expression (same object, two positions)', expr: SHARED_SUBEXPRESSION },
  { name: 'reentrant: a lazy arm inside a strict node holds that node’s own sub-expression object', expr: REENTRANT },
];

describe('compile agrees with the pre-compile walker, over random rows', () => {
  it('answers exactly what the uncached, no-plan reference walk answers — 1,000 rows × 5 trees, including a shared and a reentrant one', () => {
    const rnd = mulberry32(20260911);
    const rows = Array.from({ length: 1_000 }, () => randomRow(rnd));
    let checked = 0;
    for (const { name, expr } of TREES) {
      for (const row of rows) {
        const read = readGoverned(row);
        const got = evaluate(expr, read);
        const want = referenceEvaluate(expr, read);
        expect(got, `${name} · ${JSON.stringify(row)}`).toEqual(want);
        checked += 1;
      }
    }
    expect(checked).toBe(1_000 * TREES.length);
  });

  it('a shared sub-expression object answers the SAME as the identical tree deep-cloned — aliasing changes nothing, because compile never caches a sub-node by identity', () => {
    const rnd = mulberry32(7);
    const rows = Array.from({ length: 200 }, () => randomRow(rnd));
    const cloned = structuredClone(SHARED_SUBEXPRESSION); // no object is shared with the original any more
    const aliased = compile(SHARED_SUBEXPRESSION);
    const unaliased = compile(cloned);
    for (const row of rows) {
      const read = readGoverned(row);
      expect(aliased(read)).toEqual(unaliased(read));
    }
  });

  it('the reentrant tree answers the same aliased or deep-cloned too — the buffer a strict node fills is never the one a lazy arm re-enters', () => {
    const rnd = mulberry32(11);
    const rows = Array.from({ length: 200 }, () => randomRow(rnd));
    const cloned = structuredClone(REENTRANT);
    const aliased = compile(REENTRANT);
    const unaliased = compile(cloned);
    for (const row of rows) {
      const read = readGoverned(row);
      const got = aliased(read);
      expect(got).toEqual(unaliased(read));
      expect(got, JSON.stringify(row)).toEqual(referenceEvaluate(REENTRANT, read));
    }
  });
});

// ── the WeakMap plan: identity-keyed, and the law that makes that safe ──────

describe('the plan is keyed by the tree’s OBJECT IDENTITY — safe exactly as long as a tree is never mutated after it is first evaluated', () => {
  it('is untouched by which object a STRUCTURALLY EQUAL tree is — two different objects, two independent plans, same answer', () => {
    const row: Row = { cases: 40, population: 1_000 };
    const a: Expr = { op: 'div', args: [col('cases'), col('population')] };
    const b: Expr = { op: 'div', args: [col('cases'), col('population')] };
    expect(a).not.toBe(b);
    expect(evaluate(a, readerFor(row))).toBe(evaluate(b, readerFor(row)));
  });

  it('PINNED, not fixed: mutating an Expr IN PLACE after its first evaluate() keeps answering the plan made for the tree it was FIRST seen as — this is the documented law (walk.ts · `planned`), not a bug, and no production caller reaches this door with a mutable tree (`compile()` is called fresh, per stage run, everywhere the walker actually lands a column)', () => {
    // A caller MUST NOT do this — every field of Expr is `readonly` precisely so nobody does — but
    // the plan's safety rests on that convention, not a runtime freeze, so this pins what happens
    // when it is broken anyway: the compiled tree, not the current bytes, wins.
    const mutable = { op: 'div', args: [col('cases'), col('population')] } as { op: string; args: Expr[] };
    const row: Row = { cases: 40, population: 1_000 };
    const first = evaluate(mutable as unknown as Expr, readerFor(row));
    expect(first).toBe(0.04);
    (mutable as { op: string }).op = 'mul';
    const second = evaluate(mutable as unknown as Expr, readerFor(row));
    // Still `div`'s answer — the SAME object identity served the FIRST plan, exactly as `planned`'s
    // own comment says it will ("nothing in this grammar edits a tree after it is declared").
    expect(second).toBe(first);
    expect(second).not.toBe(40 * 1_000);
  });
});

// ── the 2am practitioner: a thrown error should still name its node ─────────

describe('a compiled node carries its op in `.name` — every fold in ops.ts is an object-literal arrow, so `op.of.name` is always "of"', () => {
  it('names a leaf by what it reads, and an op node by the op — a stack trace through a compiled tree still says which node', () => {
    expect(compile(col('cases')).name).toBe('col:cases');
    expect(compile(lit(1)).name).toBe('lit');
    expect(compile(RATIO).name).toBe('div');
    expect(compile({ op: 'coalesce', args: [col('cases'), lit(0)] }).name).toBe('coalesce');
    expect(compile({ op: 'sum', args: [col('cases')] }).name).toBe('reduce:sum');
  });
});
