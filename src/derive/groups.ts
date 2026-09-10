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
 * An AGGREGATE table ({@link ./aggregate.ts}) is pass one stopping before pass
 * two: one row per group, carrying the group's key and what its reducers came
 * to, instead of the answer broadcast back onto every row. {@link groupRowsOf}
 * is that door — the same tallies and the same skip over the same rows reader;
 * what it does not do is walk the rows again, so each tree is answered ONCE per
 * group over a reader of that group's own KEY, where every column outside the
 * group is absent.
 *
 * ## The four rules that make an answer honest
 *
 *   - **A row whose group key has an absence is in no group.** Its aggregate is
 *     absent, and it is folded into nothing — a group named by a silence is not
 *     a group. (The absence law's second half reaches this through the reader,
 *     so a row whose key column is governed by a state column that does not say
 *     `present` is in no group either. Governed, not "the row": silence belongs
 *     to a column, so a row silent in its radius still groups by its period —
 *     `../data/silence.ts`.)
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
 *   - **An empty tally answers for itself** — `0` for `count` and
 *     `countDistinct`, ABSENT for `sum`, `mean`, `min` and `max`
 *     ({@link ./ops.ts}).
 *
 * The basis is the FULL table, always: a per-selection aggregate is a measure
 * (`ViewQuery.reduce`), not a column, and a column that moved with the live
 * selection would be a number nobody could replay. (An aggregate TABLE is cut
 * from the rows visible at its cursor — but that is the ACT's law, kept by the
 * session that hands the rows in; this fold sees rows and nothing else.)
 *
 * The first customers are {@link ./analysis.ts} and {@link ./aggregate.ts},
 * whose columnar walks hand in one reader with a moving index; a caller
 * holding rows hands in {@link rowsOver} instead. Both are the same evaluation.
 */

import type { TableSilence } from '../data/silence.js';
import type { Row } from '../data/types.js';
import { opOf, wantAt, type ArgWant, type Reduce, type Tally } from './ops.js';
import type { Cell, CellReader, ColExpr, DerivedColumnDecl, Expr, OpExpr, Over } from './types.js';
import { evaluate, holdsWant, readerFor, type GroupAnswer } from './walk.js';

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
 * `silence` is the table's READING of its own silences, per column
 * (`../data/silence.ts` · `silenceOfDecl` / `silenceOfNothing`) — the same one
 * the walker takes, so the group fold and the arithmetic cannot disagree about
 * which cells the source reported. Omitted, nothing is governed.
 *
 * ```ts
 * valuesOf(column, rowsOver(rows, silenceOfDecl(def.data.cells.absence)));
 * ```
 */
export function rowsOver(rows: readonly Row[], silence?: TableSilence): Rows {
  return { count: rows.length, at: (at) => readerFor(rows[at]!, silence) };
}

/**
 * One group, as {@link groupRowsOf} answers it: the key values in `groupBy`
 * order, and what each tree came to over the group, in the order the trees
 * were given.
 */
export interface GroupRow {
  readonly key: readonly Cell[];
  readonly values: readonly Cell[];
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

/**
 * One folding per reducer NODE across every tree handed in, by IDENTITY.
 *
 * WHY deduplicated: {@link answeringOf} keys a node's answer by the node, so a
 * node two trees share — the ordinary way two measures quote one total, and the
 * way a tree quotes one twice — would otherwise hold two tallies stepped over
 * every row, of which only the last is ever read. The answers agree, so the
 * duplicate costs a fold and never an answer: a `countDistinct` quoted three
 * times would hold three sets over a million rows.
 */
function foldingsFor(exprs: readonly Expr[]): Folding[] {
  const byNode = new Map<OpExpr, Folding>();
  for (const expr of exprs) {
    for (const node of reducersOf(expr)) {
      if (byNode.has(node)) continue;
      const op = opOf(node.op)!;
      byNode.set(node, { node, of: op.of as Reduce, arg: node.args[0]!, wants: wantAt(op, 0, node.args.length) });
    }
  }
  return [...byNode.values()];
}

// ── which group a row is in ──────────────────────────────────────────────────

/**
 * This row's group key — its grouping values, in order — or `null` when the
 * row is in no group. An empty `groupBy` gives every row the same (empty) key,
 * which is exactly what "the whole table" means, and needs no special case
 * anywhere below.
 */
function keyOf(groupBy: readonly ColExpr[], read: CellReader): Cell[] | null {
  const values: Cell[] = [];
  for (const column of groupBy) {
    // Read through the walker, so the absence law and the arithmetic edge are
    // the same here as in every other cell this column ever touches.
    const cell = evaluate(column, read);
    if (cell === null) return null;
    values.push(cell);
  }
  return values;
}

/** A key as the group map spells it. `JSON.stringify`, so two groups whose columns differ only in where a separator would have fallen stay two groups. */
const idOf = (key: readonly Cell[]): string => JSON.stringify(key);

/** Does this row go into its group's tallies? A `where` that is not plainly `true` — absent included — leaves it out. */
function foldsIn(where: Expr | undefined, read: CellReader): boolean {
  return where === undefined || evaluate(where, read) === true;
}

// ── the two passes ───────────────────────────────────────────────────────────

/** One group under the fold: the key that names it, and one tally per reducer. */
interface Group {
  readonly key: readonly Cell[];
  readonly tallies: Tally[];
}

/** One tally per reducer, fresh. */
function startedFor(foldings: readonly Folding[]): Tally[] {
  return foldings.map((folding) => folding.of.start());
}

/** PASS ONE: every row that is in a group and passes `where`, into that group's tallies. Groups in first-seen order. */
function tallyOver(rows: Rows, groupBy: readonly ColExpr[], where: Expr | undefined, foldings: readonly Folding[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (let at = 0; at < rows.count; at += 1) {
    const read = rows.at(at);
    const key = keyOf(groupBy, read);
    if (key === null || !foldsIn(where, read)) continue;
    const id = idOf(key);
    let group = groups.get(id);
    if (group === undefined) {
      group = { key, tallies: startedFor(foldings) };
      groups.set(id, group);
    }
    for (let which = 0; which < foldings.length; which += 1) {
      const folding = foldings[which]!;
      const cell = evaluate(folding.arg, read);
      // THE SKIP: absence and the wrong kind both add nothing — never a zero.
      if (cell !== null && holdsWant(cell, folding.wants)) folding.of.step(group.tallies[which]!, cell);
    }
  }
  return groups;
}

/**
 * The reducers' answers for ONE group at a time: `fill` reads a group's
 * tallies into one answers array, and `answer` reads a node's place in it.
 *
 * One array, refilled for each ROW's group in {@link broadcast} and once per
 * group in {@link groupRowsOf}, read through one closure — the same reason `at`
 * may hand back one reader. Keyed by the NODE and not a position, because a walk
 * does not reach the arms `case` and `coalesce` did not pick, and because a node
 * is what {@link foldingsFor} deduplicates the tallies by.
 */
function answeringOf(foldings: readonly Folding[]): { readonly answer: GroupAnswer; readonly fill: (tallies: readonly Tally[]) => void } {
  const place = new Map<OpExpr, number>(foldings.map((folding, which) => [folding.node, which]));
  const answers: Cell[] = foldings.map(() => null);
  return {
    answer: (node) => answers[place.get(node)!]!,
    fill: (tallies) => {
      for (let which = 0; which < foldings.length; which += 1) answers[which] = foldings[which]!.of.done(tallies[which]!);
    },
  };
}

/** PASS TWO: every row again, with its group's tallies answering the reducers. */
function broadcast(expr: Expr, rows: Rows, groupBy: readonly ColExpr[], foldings: readonly Folding[], groups: ReadonlyMap<string, Group>): Cell[] {
  const { answer, fill } = answeringOf(foldings);
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
    fill(groups.get(idOf(key))?.tallies ?? empty);
    values.push(evaluate(expr, read, answer));
  }
  return values;
}

/** The grouping columns as NODES, made once: a walk over a million rows may not mint a million of them, and reading them any other way would be a second reader. */
const groupNodesOf = (over: Over): readonly ColExpr[] => over.groupBy.map((col) => ({ col }));

// ── the doors ────────────────────────────────────────────────────────────────

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
export function valuesOf(column: DerivedColumnDecl, rows: Rows): Cell[] {
  const { expr, over } = column;
  if (over === undefined) {
    const values: Cell[] = [];
    for (let at = 0; at < rows.count; at += 1) values.push(evaluate(expr, rows.at(at)));
    return values;
  }
  const foldings = foldingsFor([expr]);
  const groupBy = groupNodesOf(over);
  return broadcast(expr, rows, groupBy, foldings, tallyOver(rows, groupBy, over.where, foldings));
}

/**
 * ONE ROW PER GROUP — pass one, stopping before the broadcast.
 *
 * Every tree is judged an aggregate (it holds a reducer and reads nothing
 * outside one but a grouping column), so it has exactly one answer per group,
 * and a reader over the group's own key is all the walk needs: a grouping
 * column read outside a reducer answers with the key, and a reducer answers
 * from the group's tally. Groups come out in first-seen row order, and a group
 * exists only when at least one of its rows folded in — a `where` that left a
 * group empty left it out, which is what "which rows go in" means for a table
 * whose rows ARE the groups.
 *
 * `groupBy: []` is the ONE exception, and it is the same rule read honestly: the
 * whole table is a group the DECLARATION names rather than one any value named,
 * so it exists whether or not a row reached it, and its reducers answer what an
 * empty tally comes to. `count` over a parent nothing folded into is one row
 * saying `0` — the grand total SQL, Malloy and dbt all answer — never no row.
 *
 * ```ts
 * groupRowsOf([{ op: 'sum', args: [{ col: 'cases' }] }], { groupBy: ['disease'] }, rowsOver(rows));
 * // [{ key: ['Lyme'], values: [19] }, { key: ['Zika'], values: [3] }]
 * ```
 */
export function groupRowsOf(exprs: readonly Expr[], over: Over, rows: Rows): GroupRow[] {
  const foldings = foldingsFor(exprs);
  const groupBy = groupNodesOf(over);
  const groups = tallyOver(rows, groupBy, over.where, foldings);
  // The whole table, seeded: named by the declaration and not by a value, it is a group no row has to
  // reach. This is `broadcast`'s own `?? empty`, kept where the rows ARE the groups.
  if (over.groupBy.length === 0 && groups.size === 0) groups.set(idOf([]), { key: [], tallies: startedFor(foldings) });
  const { answer, fill } = answeringOf(foldings);
  const out: GroupRow[] = [];
  for (const group of groups.values()) {
    const read: CellReader = (column) => {
      const at = over.groupBy.indexOf(column);
      // WHY absent for any other column: the judge let nothing else through outside a reducer, so a
      // read that reaches here is a tree the judge never saw — and the fold stays total over it.
      return at === -1 ? null : group.key[at];
    };
    fill(group.tallies);
    out.push({ key: group.key, values: exprs.map((expr) => evaluate(expr, read, answer)) });
  }
  return out;
}
