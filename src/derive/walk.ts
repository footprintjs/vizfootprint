/**
 * THE WALKER — one row through one tree, and the absence law it keeps.
 *
 * ## The absence law, stated once
 *
 * **A cell is ABSENT when it is `null`, or when the state column GOVERNING
 * that column says the row is not `present`.** Two sources, not one — and the
 * second is the whole reason this law needed writing down. A row whose
 * `report_state` says `unavailable` carries `cases = 0`, and that zero is a
 * REPORTED NOTHING, not a measured zero: `cases / population` must be absent on
 * that row, never `0`. A dashboard that draws the zero is not drawing the data.
 *
 * *Governing* is the whole of the second source: silence belongs to a COLUMN,
 * not to the row (`../data/silence.ts` · `TableSilence`). A `measurements` table
 * declares one state column per measured quantity, and a row whose radius was
 * never taken still reports its mass and its period. The walker asks the port
 * per column and never per row.
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
 * engine may hold a second opinion. The ONE thing a definition may choose is
 * per column and is not this law: `arithmetic: 'carried'` on an absence entry
 * says the states that entry declared as carrying a number are read as that
 * number. The default is `'present-only'` — exactly `present` — because a
 * global switch would silently move every total ever computed here, and a
 * dashboard that wants published estimates inside its sums must SAY so where a
 * reader can see it (`./README.md`, "A carried number is not a default").
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
 * That check is the STRICT path's, per position ({@link compileStrict}). The four
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
 * ## Planned once per tree
 *
 * The tree is COMPILED before the first row ({@link compile}): the op behind
 * each name, what each strict position wants, which positions must agree, and
 * the thunks a lazy op hands its fold are all properties of the tree, and are
 * decided once. A row pays the reads and the ops. `bench/derive` is the
 * measurement that earned this — the six-op tree at 1,000,000 rows went from
 * 284 ms to 115 ms — and `../derive/README.md` quotes it.
 *
 * The first customers are the column verb's per-row evaluation and the
 * conformance fixture; a columnar engine walks the same tree through the same
 * {@link CellReader}, which is why the reader is a parameter and not a row.
 */

import { readsValueTestOf, silenceOfNothing, type TableSilence } from '../data/silence.js';
import type { Row } from '../data/types.js';
import { ABSENCE_PRESENT } from '../def/types.js';
import { epochDayOf, isoOfMoment } from './dates.js';
import { opOf, wantAt, type ArgWant, type Arm, type Op } from './ops.js';
import type { Calendar, Cell, CellReader, Expr, OpExpr } from './types.js';

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
 * The DEFAULT word for "the thing reported; here it is".
 *
 * The vocabulary belongs to the def (`AbsenceDecl.states`, whose canonical list
 * is `ABSENCE_STATES`), and since the anchors became the definition's so does
 * the word itself (`AbsenceDecl.present`). The walker never compares to this
 * constant: it reads the definition's word through the port
 * (`readsValueTestOf` over `ColumnSilence.present`, `../data/silence.ts`).
 * This export is the default that port fills in when a definition named none
 * — kept as a public name, and a test pins it to the def's. The arithmetic
 * REQUIRES a vocabulary to be able to say its word: a table whose states
 * cannot would read as absent in every cell of every row, so the def door
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

/** One want's test, over a present cell — what {@link holderOf} answers, and what a fold binds before its row loop. */
export type Holds = (cell: Cell) => boolean;

const isNumber: Holds = (cell) => typeof cell === 'number';
const isText: Holds = (cell) => typeof cell === 'string';
const isBoolean: Holds = (cell) => typeof cell === 'boolean';
const isDay: Holds = (cell) => typeof cell === 'string' && epochDayOf(cell) !== null;
/** `ordered` accepts anything with an order; `any` and `same` accept any present value. */
const hasOrder: Holds = (cell) => typeof cell !== 'boolean';
const anything: Holds = () => true;

/**
 * THE ONE TABLE of what each want accepts — read through {@link holderOf} by a
 * compiled strict position and by a reducer's per-row skip alike, so the two
 * cannot hold two opinions about one kind.
 */
const HOLDS: Readonly<Record<ArgWant, Holds>> = Object.freeze({
  number: isNumber,
  string: isText,
  unit: isText,
  target: isText,
  boolean: isBoolean,
  date: isDay,
  ordered: hasOrder,
  any: anything,
  same: anything,
});

/**
 * Is a present value the kind the position wanted? — the test, chosen ONCE for
 * a position, so the per-row work is the test itself and never the choosing
 * of it. {@link compile} binds one into every strict position; a reducer's
 * fold (`./groups.ts`) binds one before its row loop.
 *
 * Read from the same `wants` the judge read, so the check a person was refused
 * by is the check their data is held to. `date` is where "non-ISO date text is
 * absent" is enforced: `2026/01/04` in a date position makes the row absent
 * rather than a date some engines would read and others would not. A group
 * fold that judged its rows by a second rule would let a `sum` add something a
 * row walk would have called absent — which is why there is one table and one
 * door to it.
 */
export function holderOf(want: ArgWant): Holds {
  return HOLDS[want];
}

// ── the walk: planned once per tree ──────────────────────────────────────────

/**
 * A tree compiled: what one row comes to, read through the reader, with the
 * group answering the reducer nodes. The same signature {@link evaluate} has
 * after its first argument — a compiled tree IS the walk with the tree already
 * decided.
 */
export type Compiled = (read: CellReader, group?: GroupAnswer) => Cell;

/**
 * Names a compiled closure after the op or leaf it came from — nothing a row
 * pays for, since it runs once at PLAN time, not per row.
 *
 * Every op fold in `./ops.ts` is written as an object-literal arrow, so its own
 * `.name` is `"of"` regardless of which op it is (`{ div: { of: (c) => ... }
 * }` infers the PROPERTY's name, `of`, not the op's) — and every node this
 * file compiles to is itself an anonymous arrow, so an uncaught throw from a
 * fold walked a stack of `<anonymous>` frames a person at 2am could not point
 * at a node in the tree. This is the cheap half of the fix: a stack trace
 * names the op. (It is not the whole fix — see "Judge first" above: every op
 * in the table is written to be TOTAL over a judged tree and never throws, so
 * this is for the day that law has a bug in it, not the ordinary row.)
 */
function named(fn: Compiled, name: string): Compiled {
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  return fn;
}

/**
 * A STRICT node, compiled: each argument's want and whether it must agree with
 * its siblings are decided here, once; the row pays the arguments and the fold.
 *
 * The cells array is ONE per node, refilled per row, because a strict fold
 * reads it and returns a cell — none keeps it (`./ops.ts` is a closed table),
 * so a fresh array per row would be an allocation for nobody.
 */
function compileStrict(name: string, op: Op & { readonly strict: true }, args: readonly Compiled[], calendar: Calendar | undefined): Compiled {
  const count = args.length;
  const wants = args.map((_, at) => wantAt(op, at, count));
  const holds = wants.map(holderOf);
  // The judge made the DECLARED types agree; this makes the values agree, for the row where the data did not keep the declaration's word.
  const agrees = wants.map((want) => want === 'same' || want === 'ordered');
  const cells: Cell[] = args.map(() => null);
  const fold = op.of;
  return named((read, group) => {
    let shared: string | null = null;
    for (let at = 0; at < count; at += 1) {
      const cell = args[at]!(read, group);
      if (cell === null || !holds[at]!(cell)) return null;
      if (agrees[at]) {
        if (shared === null) shared = typeof cell;
        else if (shared !== typeof cell) return null;
      }
      cells[at] = cell;
    }
    return asCell(fold(cells, calendar));
  }, name);
}

/**
 * A LAZY node, compiled — one of the four that see absence. Its arms are
 * UNEVALUATED thunks by law (`case` must not run the arm it did not pick;
 * `coalesce` must stop at the first value there is), and they are built ONCE:
 * each thunk reads the row from a slot this closure sets before the fold runs,
 * so a row costs no closures. A tree is a tree — no node is its own arm — and
 * a reader is a reader (`CellReader` answers a cell, it does not walk), so the
 * slot is never overwritten while a fold is reading it.
 *
 * WHY no holderOf here: the arms are unevaluated, and a `same` position agrees
 * with the OTHER arms — the ones a lazy op must not run. See "Judge first"
 * above for the limit this leaves.
 */
function compileLazy(name: string, op: Op & { readonly strict: false }, args: readonly Compiled[]): Compiled {
  // Definitely assigned before any arm can run: the closure below sets both before it calls the fold.
  let read!: CellReader;
  let group: GroupAnswer | undefined;
  const arms: Arm[] = args.map((arg) => () => arg(read, group));
  const fold = op.of;
  return named((atRead, atGroup) => {
    read = atRead;
    group = atGroup;
    return asCell(fold(arms));
  }, name);
}

/**
 * One tree into one closure tree, ONCE — the plan the walker makes per tree
 * rather than per row.
 *
 * Everything that is a property of the TREE is decided here: the op behind
 * each name, what each strict position wants, which positions must agree, the
 * thunks a lazy op hands its fold. What is left for the row is the reads and
 * the ops themselves ({@link compileStrict}, {@link compileLazy}). A reducer
 * node reads no row: it asks the group, by its own node, and is absent under
 * no group — the same silence {@link evaluate} always kept.
 *
 * COMPILING ASSUMES A JUDGED TREE. The judge (`./judge.ts` ·
 * `judgeDerivedColumn`) is untouched by this and is not re-run here: an op
 * name the grammar does not know is a tree the judge never accepted, and this
 * throws on it the way the walk always did (`opOf(...)!`), when the tree is
 * planned rather than at its first row.
 *
 * ```ts
 * const rate = compile({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] });
 * for (const row of rows) out.push(rate((c) => row[c]));
 * ```
 */
export function compile(expr: Expr): Compiled {
  if (expr.col !== undefined) {
    const column = expr.col;
    return named((read) => asCell(read(column)), `col:${column}`);
  }
  if (expr.lit !== undefined) {
    const literal = expr.lit;
    return named(() => literal, 'lit');
  }
  const op = opOf(expr.op)!;
  if (op.reduces === true) return named((_read, group) => (group === undefined ? null : asCell(group(expr))), `reduce:${expr.op}`);
  const args = expr.args.map(compile);
  return op.strict ? compileStrict(expr.op, op, args, expr.calendar) : compileLazy(expr.op, op, args);
}

/**
 * The closure tree of a tree, remembered BY THE TREE — so the two one-row
 * doors below pay the plan once and a lookup per row, never a plan per row.
 *
 * Keyed by identity, which is safe because a tree is declared data with
 * `readonly` in every position: nothing in this grammar edits a tree after it
 * is declared, and a caller holding a tree the judge accepted holds the very
 * object this remembers. The hot loops (`./groups.ts`) do not come through
 * here — they compile once before the loop and hold the closure themselves.
 */
const planned = new WeakMap<Expr, Compiled>();

function plannedOf(expr: Expr): Compiled {
  let compiled = planned.get(expr);
  if (compiled === undefined) {
    compiled = compile(expr);
    planned.set(expr, compiled);
  }
  return compiled;
}

/**
 * One row through the tree, reached only through the reader.
 *
 * ```ts
 * evaluate({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, (c) => row[c]);
 * ```
 *
 * A thin door over {@link compile}: the tree is planned once and remembered,
 * so every answer this ever gave is now a compiled answer — the tests behind
 * it are the proof the two agree. A REDUCER node does not read this row — it
 * reads the group this row is in, and `group` is where that answer comes from
 * ({@link ./groups.ts}). Without one a reducer is absent: a tree that asks what
 * a group came to, walked with no group under it, has no answer, and inventing
 * one would be inventing a number. The judge refuses that declaration long
 * before this, so the silence here is the door being total rather than a path
 * a column can take.
 */
export function evaluate(expr: Expr, read: CellReader, group?: GroupAnswer): Cell {
  return plannedOf(expr)(read, group);
}

// ── where a cell comes from ──────────────────────────────────────────────────

/**
 * What one governed column's gate is: the state column to ask, and the test
 * that says whether the arithmetic reads the cell.
 *
 * Built ONCE per column and remembered, because the closure below is called
 * per column per row and the test is the same one every time.
 */
interface ColumnGate {
  readonly state: string;
  readonly readsValue: (state: unknown) => boolean;
}

/**
 * A reader that keeps the absence law's second half, over any reader beneath it.
 *
 * A column whose governing state column does not say `present` reads as absent
 * — but only the columns THAT entry governs, because silence belongs to a
 * column and not to the row (`../data/silence.ts`). A state column itself, and
 * any column no entry governs, read as they are, so that
 * `eq(report_state, "unavailable")` and `isAbsent(cases)` both stay honest on
 * the same row. A row whose state is missing, or is any of the vocabulary's
 * other words, is not `present`: `unknown` means the source could not tell the
 * two silences apart, and a tool that read it as "here it is" would be
 * inventing the answer the source refused to give.
 *
 * THE ONE DIAL, and it is per column: an entry declaring
 * `arithmetic: 'carried'` also reads the states it named in `carries`, so a
 * published bound lands in the sum. The default is `'present-only'` — exactly
 * `present`, the law every total this library has ever computed — and it is not
 * global for that reason (`./README.md` states the law). A carried state whose
 * cell holds no number still reads absent: the gate opens and {@link cellOf}
 * judges the cell it finds.
 */
export function readerOver(read: CellReader, silence: TableSilence = silenceOfNothing()): CellReader {
  // A table that declares no silence adds no work at all — the reader beneath is the reader.
  if (silence.stateColumns.length === 0) return read;
  const gates = new Map<string, ColumnGate | undefined>();
  const gateFor = (column: string): ColumnGate | undefined => {
    if (gates.has(column)) return gates.get(column);
    const governing = silence.silenceFor(column);
    const gate = governing === undefined ? undefined : { state: governing.state, readsValue: readsValueTestOf(governing) };
    gates.set(column, gate);
    return gate;
  };
  return (column) => {
    const gate = gateFor(column);
    return gate === undefined || gate.readsValue(read(gate.state)) ? read(column) : null;
  };
}

/**
 * The same law over one ROW — the door a caller holding rows wants.
 *
 * WHY it is spelled through {@link readerOver} and not beside it: the columnar
 * walk (`./analysis.ts`, one closure over a moving index) and the row door must
 * keep ONE absence law, and a second copy would agree with this one until the
 * day somebody edited one of them.
 */
export function readerFor(row: Row, silence?: TableSilence): CellReader {
  return readerOver((column) => row[column], silence);
}

/** One ROW through the tree, absence law and all — the shortest door there is, and a thin one over {@link compile} like {@link evaluate}. */
export function evaluateRow(expr: Expr, row: Row, silence?: TableSilence): Cell {
  return plannedOf(expr)(readerFor(row, silence));
}
