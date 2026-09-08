/**
 * THE GROUP — the rows a reducer runs over, and the answer broadcast back.
 *
 * A row column reads one row. A reducer reads MANY, and then every row of the
 * group carries what they came to: `cases / sum(cases)` is a share of a total,
 * and `cases - mean(cases)` is a deviation from a group's average. Tableau
 * calls that a level-of-detail expression and Malloy calls the two halves a
 * dimension and a measure; here it is one tree with a `over` beside it, so a
 * person asks WHY once and gets one sentence.
 *
 * ## The law: two passes, and the second one never re-decides
 *
 * Pass one folds the rows into tallies, one tally per reducer per group. Pass
 * two walks every row of the tree again with those tallies answering for the
 * reducer nodes. The passes read the SAME reader and the same `wants` the judge
 * read, so nothing here holds a second opinion about what the declaration
 * means.
 *
 * ## The four rules that make an answer honest
 *
 *   - **A row whose group key has an absence is in no group.** Its aggregate is
 *     absent, and it is folded into nothing — a group named by a silence is not
 *     a group. (The absence law's second half reaches this through the reader,
 *     so a row the table calls unavailable is in no group either.)
 *   - **`where` picks the rows the reducer folds, never the rows that get a
 *     value.** The demo's `cells` hold state rows AND region and national
 *     roll-ups, so a total over a disease double-counts unless the declaration
 *     says `where kind is "state"` — and the roll-up rows still get the answer
 *     for their disease.
 *   - **A reducer SKIPS what it cannot read** — an absent value, or one that is
 *     not the kind the position wanted. That is the other side of the absence
 *     law, not an exception to it: the law is about the arguments of one row,
 *     and a reducer's rows are not its arguments. It is what makes
 *     `sum(if(cond, x, absent))` the honest SUMIF.
 *   - **An empty tally answers for itself** — `0` for `count` and `distinct`,
 *     ABSENT for `sum`, `mean`, `min` and `max` ({@link ../derive/ops.ts}).
 *
 * The basis is the FULL table, always: a per-selection aggregate is a measure
 * (`ViewQuery.reduce`), not a column, and a column that moved with the live
 * selection would be a number nobody could replay.
 *
 * The first customer is {@link ./analysis.ts}, whose columnar walk hands in one
 * reader with a moving index; a caller holding rows hands in
 * {@link rowsOver} instead. Both are the same evaluation.
 */

import type { Row } from '../data/types.js';
import type { AbsenceDecl } from '../def/types.js';
import { opOf, wantAt, type ArgWant, type Reduce, type Tally } from './ops.js';
import type { Cell, CellReader, ColExpr, DerivedColumn, Expr, OpExpr } from './types.js';
import { evaluate, holdsWant, readerFor } from './walk.js';

// ── the table, as this walk needs it ─────────────────────────────────────────

/**
 * How many rows there are, and a reader pointed at one of them.
 *
 * `at` may answer the SAME reader every time — a walk over a million rows must
 * not allocate a million closures — which is why the cursor is the caller's and
 * not a row object handed over.
 */
export interface Rows {
  readonly count: number;
  readonly at: (at: number) => CellReader;
}

/**
 * A list of rows as {@link Rows}, keeping the absence law.
 *
 * ```ts
 * valuesOf(column, rowsOver(rows, absence));
 * ```
 */
export function rowsOver(rows: readonly Row[], absence?: AbsenceDecl): Rows {
  return { count: rows.length, at: (at) => readerFor(rows[at]!, absence) };
}

// ── the reducer nodes of a tree ──────────────────────────────────────────────

/**
 * Every reducer node in the tree, in first-seen order.
 *
 * A structural walk and not a walk of the evaluation, because `case` and
 * `coalesce` skip the arms they did not pick: the tallies must exist for every
 * reducer in the declaration, whether or not this row's arms reached it.
 */
export function reducersOf(expr: Expr, into: OpExpr[] = []): OpExpr[] {
  if (expr.op !== undefined) {
    if (opOf(expr.op)?.reduces === true) into.push(expr);
    for (const arg of expr.args) reducersOf(arg, into);
  }
  return into;
}

/** The fold of one reducer node — read once, so the walk below never looks an op up per row. */
interface Folding {
  readonly node: OpExpr;
  readonly of: Reduce;
  /** The one argument, and what its position wants — the same pair the judge read. */
  readonly arg: Expr;
  readonly wants: ArgWant;
}

function foldingsOf(expr: Expr): Folding[] {
  return reducersOf(expr).map((node) => {
    const op = opOf(node.op)!;
    return { node, of: op.of as Reduce, arg: node.args[0]!, wants: wantAt(op, 0, node.args.length) };
  });
}

// ── which group a row is in ──────────────────────────────────────────────────

/**
 * This row's group, as one key — or `null` when the row is in no group.
 *
 * `JSON.stringify` of the values, so two groups whose columns differ only in
 * where a separator would have fallen stay two groups. An empty `groupBy` gives
 * every row the same key, which is exactly what "the whole table" means, and
 * needs no special case anywhere below.
 */
function keyOf(groupBy: readonly ColExpr[], read: CellReader): string | null {
  const values: Cell[] = [];
  for (const column of groupBy) {
    // Read through the walker, so the absence law and the arithmetic edge are
    // the same here as in every other cell this column ever touches.
    const cell = evaluate(column, read);
    if (cell === null) return null;
    values.push(cell);
  }
  return JSON.stringify(values);
}

/** Does this row go into its group's tallies? A `where` that is not plainly `true` — absent included — leaves it out. */
function foldsIn(where: Expr | undefined, read: CellReader): boolean {
  return where === undefined || evaluate(where, read) === true;
}

// ── the two passes ───────────────────────────────────────────────────────────

/** One tally per reducer, fresh. */
function startedFor(foldings: readonly Folding[]): Tally[] {
  return foldings.map((folding) => folding.of.start());
}

/** PASS ONE: every row that is in a group and passes `where`, into that group's tallies. */
function tallyOver(rows: Rows, groupBy: readonly ColExpr[], where: Expr | undefined, foldings: readonly Folding[]): Map<string, Tally[]> {
  const groups = new Map<string, Tally[]>();
  for (let at = 0; at < rows.count; at += 1) {
    const read = rows.at(at);
    const key = keyOf(groupBy, read);
    if (key === null || !foldsIn(where, read)) continue;
    let tallies = groups.get(key);
    if (tallies === undefined) {
      tallies = startedFor(foldings);
      groups.set(key, tallies);
    }
    for (let which = 0; which < foldings.length; which += 1) {
      const folding = foldings[which]!;
      const cell = evaluate(folding.arg, read);
      // THE SKIP: absence and the wrong kind both add nothing — never a zero.
      if (cell !== null && holdsWant(cell, folding.wants)) folding.of.step(tallies[which]!, cell);
    }
  }
  return groups;
}

/**
 * PASS TWO: every row again, with its group's tallies answering the reducers.
 *
 * One answers array, refilled per row and read through one closure — the same
 * reason `at` may hand back one reader.
 */
function broadcast(expr: Expr, rows: Rows, groupBy: readonly ColExpr[], foldings: readonly Folding[], groups: ReadonlyMap<string, Tally[]>): Cell[] {
  const place = new Map<OpExpr, number>(foldings.map((folding, which) => [folding.node, which]));
  const answers: Cell[] = foldings.map(() => null);
  const answer = (node: OpExpr): Cell => answers[place.get(node)!]!;
  const empty = startedFor(foldings);
  const values: Cell[] = [];
  for (let at = 0; at < rows.count; at += 1) {
    const read = rows.at(at);
    const key = keyOf(groupBy, read);
    if (key === null) {
      // A row in no group has no group's answer, and every reducer above it is absent.
      values.push(evaluate(expr, read));
      continue;
    }
    // A group every one of whose rows `where` left out is EMPTY, not missing:
    // its reducers answer what an empty tally comes to, which they own.
    const tallies = groups.get(key) ?? empty;
    for (let which = 0; which < foldings.length; which += 1) answers[which] = foldings[which]!.of.done(tallies[which]!);
    values.push(evaluate(expr, read, answer));
  }
  return values;
}

// ── the door ─────────────────────────────────────────────────────────────────

/**
 * One column's values, in row order — grouped when the declaration names a
 * group, one plain walk when it does not.
 *
 * ONE door for both, so a caller never decides which walk a declaration needs:
 * the declaration says, and it says it in the one place a reader can check.
 *
 * ```ts
 * valuesOf(
 *   { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { op: 'sum', args: [{ col: 'cases' }] }] }, over: { groupBy: ['disease'] } },
 *   rowsOver(rows),
 * );
 * ```
 */
export function valuesOf(column: DerivedColumn, rows: Rows): Cell[] {
  const { expr, over } = column;
  if (over === undefined) {
    const values: Cell[] = [];
    for (let at = 0; at < rows.count; at += 1) values.push(evaluate(expr, rows.at(at)));
    return values;
  }
  const foldings = foldingsOf(expr);
  // The grouping columns as NODES, made once: a walk over a million rows may
  // not mint a million of them, and reading them any other way would be a
  // second reader.
  const groupBy: readonly ColExpr[] = over.groupBy.map((col) => ({ col }));
  return broadcast(expr, rows, groupBy, foldings, tallyOver(rows, groupBy, over.where, foldings));
}
