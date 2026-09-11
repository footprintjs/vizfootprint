/**
 * DERIVE BENCH — THE FLOORS. The three trees, hand-written as JS closures.
 *
 * A POSITIVE CONTROL for the walk: the same answer, computed the way a person
 * would write it in a `.map` — no tree, no op lookup, no closure per arm — so
 * a reader sees how far today's walk is from the floor nothing can beat. Two
 * floors per tree, because the gap has two halves and the brief's compile can
 * only close one of them:
 *
 *   - **over the reader** ({@link FLOOR_OVER_READER}): reads through the SAME
 *     gated `CellReader` the columnar walk reads through. A compiled closure
 *     tree keeps that reader (the per-column silence gates stay), so this is
 *     the most it could reach.
 *   - **over raw columns** ({@link FLOOR_OVER_COLUMNS}): reads the column arrays
 *     directly with the absence gate inline — the whole distance.
 *
 * The law each floor keeps is the walker's, by hand: the arithmetic edge
 * (`walk.ts` · `asCell` — a non-finite number, an invalid `Date`, any other
 * object is absent), strictness (any absent input makes the result absent, and
 * the walk stops at the FIRST absent argument, so the floor reads no further
 * either), and the lazy ops' arm order. `derive.test.ts` pins every floor to
 * the walker on rows chosen to reach every arm — including a silent row
 * carrying a `0`, which the gate must turn to absent. A floor that computed
 * something else would be a fast answer to a different question.
 *
 * WHY each column is read ONCE per row here even where the tree names it twice
 * (`tree6` reads `cases` under `div` and again under `coalesce`): that is what
 * a hand-written closure does, and the floor is the floor. A compiled tree
 * keeps the tree's reads; the README says so where the numbers are quoted.
 */
import type { Cell, CellReader } from '../../src/derive/types.js';
import { isoOfMoment } from '../../src/derive/dates.js';
import { PRESENT } from '../../src/derive/walk.js';
import type { ExprName } from './measure.js';

/** The arithmetic edge, by hand — `walk.ts` · `asCell`, which is module-private on purpose. */
function cellOf(value: unknown): Cell {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return isoOfMoment(value);
  return null;
}

/** `div(cases, population)` once `cases` is known to be a number: strict on `population`, and a non-finite quotient is absent. */
function ratioOf(cases: number, population: Cell): Cell {
  if (typeof population !== 'number') return null;
  const q = cases / population;
  return Number.isFinite(q) ? q : null;
}

/**
 * `case(gt(div(cases, population), 0.001), 'high', cast(round(coalesce(cases, 0)), 'string'))`
 * once `cases` is known to be a number (any other `cases` makes the condition
 * absent, and an absent condition is an absent answer — nobody knows which arm
 * the row is in).
 *
 * The rest by hand: `coalesce` takes the first arm that is there, which is
 * `cases` itself here; `round` is `ops.ts`'s sign-preserving one; `cast` to a
 * string is `String(...)` of anything but a string (`ops.ts` · `castOf`).
 */
function tree6Of(cases: number, population: Cell): Cell {
  const q = ratioOf(cases, population);
  if (typeof q !== 'number') return null;
  if (0.001 < q) return 'high';
  const rounded = Math.sign(cases) * Math.round(Math.abs(cases));
  return Number.isFinite(rounded) ? String(rounded) : null;
}

/** One hand-written closure per expression, over a reader. */
export type FloorOverReader = (read: CellReader) => Cell;

/** The three trees over the SAME `CellReader` the columnar walk reads through. */
export const FLOOR_OVER_READER: Readonly<Record<ExprName, FloorOverReader>> = Object.freeze({
  read: (read) => cellOf(read('cases')),
  ratio: (read) => {
    const cases = cellOf(read('cases'));
    return typeof cases === 'number' ? ratioOf(cases, cellOf(read('population'))) : null;
  },
  tree6: (read) => {
    const cases = cellOf(read('cases'));
    return typeof cases === 'number' ? tree6Of(cases, cellOf(read('population'))) : null;
  },
});

/** One hand-written closure per expression, over the raw column arrays at one index. */
export type FloorOverColumns = (columns: Readonly<Record<string, readonly unknown[]>>, at: number) => Cell;

/** `cases` at one index, the absence gate inline: read only where `report_state` says `present` (`rows.ts` · `ABSENCE`, `arithmetic: 'present-only'`). */
function casesAt(columns: Readonly<Record<string, readonly unknown[]>>, at: number): Cell {
  return columns['report_state']![at] === PRESENT ? cellOf(columns['cases']![at]) : null;
}

/** The three trees over the raw column arrays; `population` is governed by nothing and is a bare read. */
export const FLOOR_OVER_COLUMNS: Readonly<Record<ExprName, FloorOverColumns>> = Object.freeze({
  read: (columns, at) => casesAt(columns, at),
  ratio: (columns, at) => {
    const cases = casesAt(columns, at);
    return typeof cases === 'number' ? ratioOf(cases, cellOf(columns['population']![at])) : null;
  },
  tree6: (columns, at) => {
    const cases = casesAt(columns, at);
    return typeof cases === 'number' ? tree6Of(cases, cellOf(columns['population']![at])) : null;
  },
});
