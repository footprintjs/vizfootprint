/**
 * THE SENTENCE — a tree, said out loud.
 *
 * The law: **the words come from the op table, so the sentence cannot drift
 * from what ran.** Every op's why-fragment is a field of the same row that
 * carries its fold — one row, one meaning, one phrasing — which is what makes
 * this safe to put in a caption. A second hand-written description somewhere
 * else would be a sentence that agrees with the numbers only until somebody
 * edits one of them.
 *
 * ```ts
 * wordsFor({ op: 'mul', args: [{ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, { lit: 100000 }] });
 * // '(cases divided by population) times 100000'
 *
 * wordsFor({ op: 'week', args: [{ col: 'report_date' }], calendar: 'mmwr' });
 * // 'the week of report_date on the mmwr calendar'
 * ```
 *
 * Two rules beyond the table, both about being read rather than parsed:
 *
 *   - a nested op is wrapped in parentheses, so `add` under `div` cannot be
 *     read as the other grouping;
 *   - a written-down WORD (a date unit, a cast target) is said bare — `the
 *     start of the month containing report_date`, not `the "month"`.
 *
 * ## Judge first
 *
 * The sentence says a tree the judge has already accepted, exactly as the
 * walker walks one ({@link ./walk.ts}). A tree that was never judged is not
 * this door's shape — an op the table does not have has no row to take the
 * words from — so a caller holding unjudged bytes judges them first
 * (`judgeExpr` / `judgeDerivedColumn`) and quotes the refusal, not a sentence.
 *
 * The first customer is the why-of-a-column panel; the same fragments are what
 * a caption quotes.
 */

import { opOf, wantAt } from './ops.js';
import type { DerivedColumn, Expr, Literal, Over } from './types.js';

/**
 * A literal as a sentence says it: strings quoted, an absence named rather than
 * shown as an empty space.
 *
 * WHY `JSON.stringify` and not a hand-built quote: the judge writes the same
 * value that way in its refusals, and a string holding a quote or a newline
 * must still have a beginning and an end a reader can find.
 */
function literalWords(value: Literal): string {
  if (value === null) return 'absent';
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function phraseOf(expr: Expr, top: boolean): string {
  if (expr.col !== undefined) return expr.col;
  if (expr.lit !== undefined) return literalWords(expr.lit);
  const op = opOf(expr.op)!;
  const args = expr.args.map((arg, at) => {
    const want = wantAt(op, at, expr.args.length);
    // WHY the node's shape decides and not the want alone: the judge refuses a non-literal in a
    // written-down position, so only an unjudged tree reaches here with one — and a sentence that
    // names the node is honest where the word "undefined" is not.
    const written = want === 'unit' || want === 'target';
    return written && arg.lit !== undefined ? String(arg.lit) : phraseOf(arg, false);
  });
  const said = op.words(args);
  // Calendars are data, so the calendar is part of the sentence — a week that does not say which calendar counted it says nothing.
  const whole = expr.calendar === undefined ? said : `${said} on the ${expr.calendar} calendar`;
  return top ? whole : `(${whole})`;
}

/** The tree as one sentence fragment, in the words the op table owns. */
export function wordsFor(expr: Expr): string {
  return phraseOf(expr, true);
}

/**
 * The group, said out loud — the half of an aggregate a number alone never
 * shows.
 *
 * Both clauses are load-bearing. Which rows went together is the difference
 * between a share of a disease's total and a share of the table's; which rows
 * were COUNTED is the difference between a total and a double-counted one, on
 * a table like the demo's that holds its own roll-ups as ordinary rows. A
 * caption that printed the first and swallowed the second would be the exact
 * silent disagreement this grammar exists to stop.
 */
function groupWords(over: Over): string {
  const rows = over.groupBy.length === 0 ? 'over the whole table' : `over each ${over.groupBy.join(' and ')}`;
  return over.where === undefined ? rows : `${rows}, counting only rows where ${wordsFor(over.where)}`;
}

/**
 * The whole declaration as one sentence — the tree, and the rows its reducers
 * ran over.
 *
 * The group clause is set off by a comma. WHY: the top-level node is not
 * parenthesised, so glued on with a space the clause reads as a modifier of
 * whatever noun the tree ended on — `"low" over each disease` on a `case`, or
 * `population over each disease` on a share — when it governs the reducers.
 *
 * ```ts
 * wordsForColumn({
 *   ops: 1,
 *   kind: 'row',
 *   expr: { op: 'div', args: [{ col: 'cases' }, { op: 'sum', args: [{ col: 'cases' }] }] },
 *   over: { groupBy: ['disease'], where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] } },
 * });
 * // 'cases divided by (the total of cases), over each disease, counting only rows where kind is "state"'
 * ```
 */
export function wordsForColumn(column: DerivedColumn): string {
  const said = wordsFor(column.expr);
  return column.over === undefined ? said : `${said}, ${groupWords(column.over)}`;
}
