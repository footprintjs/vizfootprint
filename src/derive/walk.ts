/**
 * THE WALKER — one row through one tree, and the absence law it keeps.
 *
 * ## The absence law, stated once
 *
 * **A cell is ABSENT when it is `null`, or when the table's declared absence
 * column says the row is not `present`.** Two sources, not one — and the second
 * is the whole reason this law needed writing down. A row whose `report_state`
 * says `unavailable` carries `cases = 0`, and that zero is a REPORTED NOTHING,
 * not a measured zero: `cases / population` must be absent on that row, never
 * `0`. A dashboard that draws the zero is not drawing the data.
 *
 * **Every op is strict: any absent input makes the result absent.** Division by
 * zero is absent, never `Infinity`. Text where a number was declared is absent.
 * Date text that is not ISO is absent. The ONLY ops that see absence are the
 * ones whose subject is absence — `isAbsent`, `coalesce`, and `if`/`case`,
 * whose absent CONDITION makes the whole thing absent because nobody knows
 * which arm this row belongs in. That is four rows of the op table, every one
 * of them saying `strict: false` in the table itself, so the exceptions are
 * data and a test can count them.
 *
 * This departs from SQL's three-valued `and`/`or` deliberately: `and(absent,
 * false)` is absent here, not `false`. One law, no exceptions per engine — an
 * engine that cannot answer this way wraps its own operator rather than lending
 * us its opinion.
 *
 * The absence law is **not a dial.** Nothing about it is configurable, and no
 * engine may hold a second opinion.
 *
 * ## Judge first
 *
 * The walker walks a tree the judge has already accepted, and it never
 * re-checks what the judge settled — the same division of labour the shipped
 * formula keeps between `parseFormula` and `evaluateWith`. What it DOES check
 * every row is the KIND of each value it actually finds, against the same
 * `wants` data the judge read: a column declared `number` that holds text on
 * one row makes that row absent rather than a fabricated answer. Declarations
 * describe; rows are what they are.
 *
 * That check is the STRICT path's, per position ({@link cellsFor}). The four
 * that see absence get their arms unevaluated, and an arm wanting `same` has
 * nothing to be compared against — `coalesce(cases, 0)` on a row where `cases`
 * holds text answers with the text, not the fallback, and `if`/`case` check
 * only their CONDITION (in the op table, where the fold is). What one row
 * cannot be told is which type its declaration agreed on; only the judge knows
 * that, and it is not threaded here. A caller that must have the judged type
 * hold in the bytes checks at the column door, where the values are written
 * with it.
 *
 * ## The one thing a row cannot answer
 *
 * A REDUCER node asks what a whole group came to, and no row knows that. It is
 * answered from beside the walk ({@link GroupAnswer}, filled in by
 * {@link ./groups.ts}) — which is what lets `cases / sum(cases)` be ONE tree
 * with one meaning, walked here, rather than two computations that agree until
 * somebody edits one of them. A reducer's SKIP rule lives there too, because it
 * is about rows and this file is about one row.
 *
 * The first customers are the column verb's per-row evaluation and the
 * conformance fixture; a columnar engine walks the same tree through the same
 * {@link CellReader}, which is why the reader is a parameter and not a row.
 */

import type { Row } from '../data/types.js';
import { ABSENCE_PRESENT, type AbsenceDecl } from '../def/types.js';
import { epochDayOf, isoOfMoment } from './dates.js';
import { opOf, wantAt, type ArgWant, type Op } from './ops.js';
import type { Cell, CellReader, Expr, OpExpr } from './types.js';

/**
 * What one reducer node came to for THIS row's group — the answer
 * {@link ./groups.ts} broadcasts back.
 *
 * Keyed by the NODE itself and not by a position, because `case` and
 * `coalesce` do not evaluate the arms they did not pick: a counter that
 * advanced as the walk went would number the same node differently on two rows.
 */
export type GroupAnswer = (node: OpExpr) => Cell;

/**
 * The one state that means "the thing reported; here it is".
 *
 * The vocabulary belongs to the def (`AbsenceDecl.states`, whose canonical list
 * is `ABSENCE_STATES`); this is the single word out of it that the arithmetic
 * has an opinion about, and a test pins the two together. The arithmetic
 * REQUIRES a vocabulary to be able to say it: a table whose states cannot say
 * `present` would read as absent in every cell of every row, so the def door
 * (`../def/validate.ts`) refuses such a vocabulary before it reaches here.
 */
export const PRESENT = ABSENCE_PRESENT;

// ── what a value is, once it is in the arithmetic ────────────────────────────

/**
 * A value as a cell, or the silence it really is: a non-finite number, an
 * invalid `Date`, any other object, `undefined` and `null` are all absent. A
 * valid `Date` becomes the ISO day this grammar means by a date — the engine
 * calls a column `date` only when it holds `Date` objects, and a column the
 * judge accepts must be one the walk can read ({@link isoOfMoment} says why).
 * The whole of the arithmetic-edge law, in one function.
 */
function asCell(value: unknown): Cell {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return isoOfMoment(value);
  return null;
}

/**
 * Is this present value the kind the position wanted?
 *
 * Read from the same `wants` the judge read, so the check a person was refused
 * by is the check their data is held to. `date` is where "non-ISO date text is
 * absent" is enforced: `2026/01/04` in a date position makes the row absent
 * rather than a date some engines would read and others would not.
 *
 * Exported for {@link ./groups.ts}, which asks it of a reducer's argument one
 * row at a time: a group fold that judged its rows by a second rule would let a
 * `sum` add something a row walk would have called absent.
 */
export function holdsWant(cell: Cell, want: ArgWant): boolean {
  if (want === 'number') return typeof cell === 'number';
  if (want === 'string' || want === 'unit' || want === 'target') return typeof cell === 'string';
  if (want === 'boolean') return typeof cell === 'boolean';
  if (want === 'date') return typeof cell === 'string' && epochDayOf(cell) !== null;
  // `ordered` accepts anything with an order; `any` and `same` accept any present value.
  if (want === 'ordered') return typeof cell !== 'boolean';
  return true;
}

// ── the walk ─────────────────────────────────────────────────────────────────

/** Evaluate the arguments of a STRICT op, or answer `null` the moment the row cannot carry them. */
function cellsFor(op: Op, args: readonly Expr[], read: CellReader, group: GroupAnswer | undefined): Cell[] | null {
  const cells: Cell[] = [];
  let shared: string | null = null;
  for (let at = 0; at < args.length; at += 1) {
    const cell = evaluate(args[at]!, read, group);
    if (cell === null) return null;
    const want = wantAt(op, at, args.length);
    if (!holdsWant(cell, want)) return null;
    if (want === 'same' || want === 'ordered') {
      // The judge made the DECLARED types agree; this makes the values agree, for the row where the data did not keep the declaration's word.
      if (shared === null) shared = typeof cell;
      else if (shared !== typeof cell) return null;
    }
    cells.push(cell);
  }
  return cells;
}

/**
 * One row through the tree, reached only through the reader.
 *
 * ```ts
 * evaluate({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, (c) => row[c]);
 * ```
 *
 * A REDUCER node does not read this row — it reads the group this row is in,
 * and `group` is where that answer comes from ({@link ./groups.ts}). Without
 * one a reducer is absent: a tree that asks what a group came to, walked with
 * no group under it, has no answer, and inventing one would be inventing a
 * number. The judge refuses that declaration long before this, so the silence
 * here is the door being total rather than a path a column can take.
 */
export function evaluate(expr: Expr, read: CellReader, group?: GroupAnswer): Cell {
  if (expr.col !== undefined) return asCell(read(expr.col));
  if (expr.lit !== undefined) return expr.lit;
  const op = opOf(expr.op)!;
  if (op.reduces === true) return group === undefined ? null : asCell(group(expr));
  // The four that see absence get their arguments UNEVALUATED: a `case` must not
  // run the arm it did not pick, and `coalesce` must stop at the first value there is.
  // WHY no holdsWant here: the arms are unevaluated by law, and a `same` position agrees
  // with the OTHER arms — the ones a lazy op must not run. See "Judge first" above for
  // the limit this leaves.
  if (!op.strict) return asCell(op.of(expr.args.map((arg) => () => evaluate(arg, read, group))));
  const cells = cellsFor(op, expr.args, read, group);
  return cells === null ? null : asCell(op.of(cells, expr.calendar));
}

// ── where a cell comes from ──────────────────────────────────────────────────

/**
 * A reader that keeps the absence law's second half, over any reader beneath it.
 *
 * A row the table's absence column does not call `present` reads as absent in
 * EVERY column — except that column itself, which speaks for itself, so that
 * `eq(report_state, "unavailable")` and `isAbsent(cases)` both stay honest on
 * the same row. A row whose state is missing, or is any of the vocabulary's
 * other words, is not `present`: `unknown` means the source could not tell the
 * two silences apart, and a tool that read it as "here it is" would be
 * inventing the answer the source refused to give.
 */
export function readerOver(read: CellReader, absence?: AbsenceDecl): CellReader {
  const field = absence?.field;
  if (field === undefined) return read;
  return (column) => (column === field || read(field) === PRESENT ? read(column) : null);
}

/**
 * The same law over one ROW — the door a caller holding rows wants.
 *
 * WHY it is spelled through {@link readerOver} and not beside it: the columnar
 * walk (`./analysis.ts`, one closure over a moving index) and the row door must
 * keep ONE absence law, and a second copy would agree with this one until the
 * day somebody edited one of them.
 */
export function readerFor(row: Row, absence?: AbsenceDecl): CellReader {
  return readerOver((column) => row[column], absence);
}

/** One ROW through the tree, absence law and all — the shortest door there is. */
export function evaluateRow(expr: Expr, row: Row, absence?: AbsenceDecl): Cell {
  return evaluate(expr, readerFor(row, absence));
}
