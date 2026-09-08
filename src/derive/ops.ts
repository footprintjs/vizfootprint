/**
 * THE OP TABLE — every op this grammar has, as one row each.
 *
 * A row carries six things, and it carries them as DATA so that no two readers
 * of an op can ever disagree about it:
 *
 *   1. **the arity in numbers** (`least`, `most`, `odd`) — what the judge checks
 *   2. **the arity in words** (`takes`) — what a refusal says, so neither has to
 *      be derived from the other (the shipped formula table's own law, and the
 *      reason its sentences read like sentences)
 *   3. **what kind of argument goes where** (`wants`, `repeat`) — read by the
 *      judge at declaration AND by the walker at every row, for every STRICT
 *      position and for the conditions of `if`/`case`, so the check a person
 *      was refused by is the check the data is held to. A lazy row's value
 *      arms are the exception, and {@link LazyFold} says why.
 *   4. **the result-type rule** (`yields`) — which is what makes a derived
 *      column's type COMPUTED at declaration rather than tallied from values
 *      afterwards, so a column of nothing but absences still knows what it is
 *   5. **the fold owner** (`of`) — the per-row step, and the only code in the
 *      library that knows what `mod` means
 *   6. **the words owner** (`words`) — the why-sentence fragment, so the
 *      sentence cannot drift from what ran
 *
 * The law: **the table is the vocabulary, and there is nothing beside it.** No
 * expression string, no function, no raw SQL or JS. Every tool that admits an
 * escape hatch admits that provenance dies at the escape hatch; this one has
 * none, and a name that is not a row here is refused with a sentence.
 *
 * ## Pinned semantics — the answers, not the engine's answers
 *
 * Named beside their rows below, because an op whose answer moves with the
 * engine is not one answer:
 *
 *   - `round` goes half AWAY FROM ZERO (`0.5` → `1`, `-0.5` → `-1`). DuckDB's
 *     half-to-even is a different answer and must be wrapped, never inherited.
 *   - `mod`'s sign follows the DIVIDEND (`-7 mod 3` → `-1`) — SQL's and
 *     JavaScript's `%`. Excel and Sheets `MOD` follow the DIVISOR and answer
 *     `2` there.
 *   - `div` is always float — `7 / 2` is `3.5`, never `3`.
 *   - strings compare by CODE UNIT. No collation, no locale; `lower`/`upper`
 *     are the Unicode default case mappings (never the locale-sensitive ones).
 *   - a date is an ISO string and non-ISO date text is absent ({@link ./dates.ts}).
 *   - a REDUCER skips the rows it cannot read, and an EMPTY tally answers `0`
 *     for `count` and `distinct` and ABSENT for the other four — the total of
 *     nothing is not zero, and neither is the average of nothing.
 *   - `min`/`max` over a group that held two KINDS answer absent: a group
 *     nobody can put in one order has no smallest, and the answer must not
 *     depend on which kind arrived first.
 *
 * Where an engine cannot match a pinned answer the op is REFUSED on that
 * engine, never approximated — a wrong number that looks right is worse than a
 * refusal that says which op and which engine.
 *
 * The first customers are {@link ./judge.ts}, {@link ./walk.ts} and
 * {@link ./words.ts} — three walks over one table.
 */

import { addOf, CALENDARS, DATE_UNITS, diffOf, epochDayOf, isoOf, partsOf, truncOf, weekdayOf, weekOf, type DateUnit } from './dates.js';
import type { Calendar, Cell, DeriveType } from './types.js';

// ── the shapes a row can declare ─────────────────────────────────────────────

/** Which family an op belongs to. Documentation only: nothing in the library reads it, and the unknown-op refusal lists `OP_NAMES` flat. */
export type OpCategory = 'arithmetic' | 'compare' | 'logic' | 'conditional' | 'number' | 'string' | 'date' | 'cast' | 'reducer';

/**
 * What one argument position may hold.
 *
 * `same` and `ordered` are an AGREEMENT: every position wanting either must
 * settle on ONE type, and `ordered` adds that the type must be one you can put
 * in an order (a boolean has no order, so `lt(a, b)` over booleans is refused
 * rather than quietly reading `false < true`). `unit` and `target` are literal
 * WORDS — a date unit or a cast target written down, never computed, because a
 * column whose unit came from a cell is a column whose meaning changes per row.
 */
export type ArgWant = DeriveType | 'any' | 'same' | 'ordered' | 'unit' | 'target';

/** How the result's type is worked out: a fixed type, the type its `same`/`ordered` arguments agreed on, or the target word `cast` was given. */
export type YieldRule = DeriveType | 'args' | 'target';

/** The per-row step of a STRICT op. Every cell is present and already the kind the row wanted. */
export type Fold = (cells: readonly Cell[], calendar: Calendar | undefined) => Cell;

/** One argument of a non-strict op, not yet evaluated. */
export type Arm = () => Cell;

/**
 * The per-row step of an op that SEES absence — it gets the arguments
 * unevaluated and decides for itself.
 *
 * Its arms are NOT held to `wants`: an arm that was never run cannot be
 * checked, and a value arm wanting `same` agrees with the OTHER arms, which a
 * lazy op must not run. So each lazy fold owns whatever check it depends on —
 * `if`/`case` check their own CONDITION — and a value arm returns whatever the
 * row held, which can be a kind the judge's computed type did not expect on a
 * row whose data did not keep its declaration's word.
 */
export type LazyFold = (arms: readonly Arm[]) => Cell;

/**
 * What one reducer has seen of one group so far.
 *
 * ONE shape for all six, because a reducer's whole state is: how many values it
 * has taken, what they add up to, the best one so far, whether the best was
 * ever compared across kinds, and — for `distinct` alone, made only when that
 * op asks for it — which ones it has already met.
 */
export interface Tally {
  /** How many PRESENT values this tally TOOK. `0` is what makes an empty group answerable; a value a reducer skipped is not counted. */
  n: number;
  total: number;
  best: Cell;
  /** `min`/`max` only: a value of another KIND arrived, so the group has no one order and no best. */
  mixed: boolean;
  seen: Set<Cell> | null;
}

/**
 * The fold of a REDUCER — many rows, one answer, broadcast back to every row of
 * the group.
 *
 * Absence never reaches `step`: a row whose value is absent, or is not the kind
 * the position wanted, is SKIPPED. That is not an exception to the absence law
 * but the other side of it — the law is about the arguments of one row, and a
 * reducer's rows are not its arguments. It is also what makes `sum(if(cond, x,
 * null))` the honest SUMIF: the rows the condition did not pick add nothing,
 * rather than adding a zero nobody measured.
 *
 * What an EMPTY tally comes to is pinned per row and stated beside it: `count`
 * and `distinct` answer `0` (counting nothing is honestly none), and the other
 * four answer ABSENT (the average of nothing is not zero, and neither is the
 * total of nothing).
 */
export interface Reduce {
  /** A fresh, empty tally for one group. */
  readonly start: () => Tally;
  /** One PRESENT value into it. */
  readonly step: (tally: Tally, cell: Cell) => void;
  /** What the tally comes to. */
  readonly done: (tally: Tally) => Cell;
}

interface OpCommon {
  readonly category: OpCategory;
  /** Fewest arguments. */
  readonly least: number;
  /** Most arguments; `Number.POSITIVE_INFINITY` for a variadic op. */
  readonly most: number;
  /** The arity as a REFUSAL says it, in words. */
  readonly takes: string;
  /** `case` only: the arguments are condition/value pairs plus a fallback, so there must be an odd number of them. */
  readonly odd?: true;
  /** What each position wants. With `repeat: 'last'` the final entry covers every further position; with `'cycle'` the list repeats, and a final odd argument takes the last entry. */
  readonly wants: readonly ArgWant[];
  readonly repeat: 'last' | 'cycle';
  readonly yields: YieldRule;
  /** `always`: the node MUST name a calendar. `when-week`: it must, and only, when the unit is `week`. Absent: naming one is refused. */
  readonly calendar?: 'always' | 'when-week';
  /** The why-sentence fragment, given its arguments already in words. */
  readonly words: (args: readonly string[]) => string;
}

/**
 * One op, in one of three shapes: it folds its arguments for one row
 * (`strict: true`), it SEES their absence for one row (`strict: false`), or it
 * folds many ROWS into one answer (`reduces: true`).
 *
 * `strict` is the absence law made into data ({@link ./walk.ts}); `reduces` is
 * the group law ({@link ./groups.ts}). Both are read, never guessed — a walker
 * that inferred which kind an op was would be a second opinion about the table.
 */
export type Op =
  | (OpCommon & { readonly reduces?: undefined; readonly strict: true; readonly of: Fold })
  | (OpCommon & { readonly reduces?: undefined; readonly strict: false; readonly of: LazyFold })
  | (OpCommon & { readonly reduces: true; readonly strict?: undefined; readonly of: Reduce });

// ── reading a cell the fold knows the kind of ────────────────────────────────

const num = (cells: readonly Cell[], at: number): number => cells[at] as number;
const str = (cells: readonly Cell[], at: number): string => cells[at] as string;
const bool = (cells: readonly Cell[], at: number): boolean => cells[at] as boolean;
/** A date argument as a day number. The `date` want already proved it parses, so there is no second opinion here. */
const day = (cells: readonly Cell[], at: number): number => epochDayOf(str(cells, at))!;
const unit = (cells: readonly Cell[], at: number): DateUnit => str(cells, at) as DateUnit;

/**
 * Is the first value before the second? The ONE place an order lives.
 *
 * Strings compare by code unit — no collation and no locale, so the answer is
 * the same on every machine that will ever replay this column. ISO dates
 * compare chronologically under exactly that rule, which is why a date is
 * stored as an ISO string in the first place. Both sides are one kind by the
 * time they reach here: the row walk agrees its `ordered` arguments, and the
 * `min`/`max` tallies refuse to compare across kinds.
 */
function isBefore(left: Cell, right: Cell): boolean {
  return typeof left === 'string' ? left < (right as string) : (left as number) < (right as number);
}

/** The least of a row's ordered arguments, through the one order. */
function leastOf(cells: readonly Cell[]): Cell {
  let best = cells[0]!;
  for (let at = 1; at < cells.length; at += 1) if (isBefore(cells[at]!, best)) best = cells[at]!;
  return best;
}

/** The greatest of a row's ordered arguments, through the one order. */
function mostOf(cells: readonly Cell[]): Cell {
  let best = cells[0]!;
  for (let at = 1; at < cells.length; at += 1) if (isBefore(best, cells[at]!)) best = cells[at]!;
  return best;
}

/** Decimal notation, and only that — what a person reading the column would call a number. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A string that is entirely a number, or absent. `cast(to number)` is a
 * reading, never a salvage: `"12 cases"` is not 12. WHY the shape is judged
 * before `Number` reads it: `Number("0x1A")` is 26 and `Number("0b11")` is 3,
 * and `0x1A` is not 26 to anyone reading the column — base-prefixed text is
 * absent, never its value.
 */
function numberOf(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

// ── the six reducers, as tallies ─────────────────────────────────────────────

const tally = (): Tally => ({ n: 0, total: 0, best: null, mixed: false, seen: null });

/**
 * A value into a `min`/`max` tally, or the mark that the group cannot be
 * ordered.
 *
 * WHY: the row walk makes a row's `ordered` arguments one kind
 * ({@link ./walk.ts}, `cellsFor`), and a group is held to the same law — a
 * group holding `"N/A"` and `5` has no smallest, and letting one win would
 * make the answer depend on which arrived first.
 */
function orderedStep(t: Tally, cell: Cell, better: (candidate: Cell, best: Cell) => boolean): void {
  if (t.n > 0 && typeof cell !== typeof t.best) {
    t.mixed = true;
    return;
  }
  if (t.n === 0 || better(cell, t.best)) t.best = cell;
  t.n += 1;
}

/** PINNED: counting nothing is honestly NONE — this and `different` are the two reducers whose empty answer is `0`. */
const counting: Reduce = { start: tally, step: (t) => void (t.n += 1), done: (t) => t.n };
/** PINNED: the total of nothing is ABSENT, never `0` — a silence is not a zero, and a SUMIF that picked no row must say so. */
const summing: Reduce = {
  start: tally,
  step: (t, cell) => {
    t.n += 1;
    t.total += cell as number;
  },
  done: (t) => (t.n === 0 ? null : t.total),
};
/** PINNED: the average of nothing is absent. Its step is `summing`'s, spelled once — a mean that counted differently from its own sum would be two answers. */
const averaging: Reduce = { start: tally, step: summing.step, done: (t) => (t.n === 0 ? null : t.total / t.n) };
/** PINNED: the smallest of nothing is absent, and so is the smallest of a group that held two kinds. */
const smallest: Reduce = { start: tally, step: (t, cell) => orderedStep(t, cell, isBefore), done: (t) => (t.mixed ? null : t.best) };
const largest: Reduce = { start: tally, step: (t, cell) => orderedStep(t, cell, (candidate, best) => isBefore(best, candidate)), done: (t) => (t.mixed ? null : t.best) };
/** PINNED: distinct by VALUE, and a `Set` of primitives is exactly that — the same code-unit equality `eq` keeps. Its set is made only when a value arrives. */
const different: Reduce = {
  start: tally,
  step: (t, cell) => {
    t.n += 1;
    (t.seen ??= new Set<Cell>()).add(cell);
  },
  done: (t) => (t.seen === null ? 0 : t.seen.size),
};

// ── the table ────────────────────────────────────────────────────────────────

/** The three types `cast` can be asked for, in the order a refusal lists them. */
export const CAST_TARGETS = Object.freeze(['number', 'string', 'date'] as const);

const ONE = 'one argument';
const TWO = 'two arguments';
const THREE = 'three arguments';
const TWO_UP = 'two or more arguments';
const MANY = Number.POSITIVE_INFINITY;

/**
 * Every op, by name. Adding one is adding a ROW — the judge, the walker and the
 * sentence writer all read it and none of them needs an edit — plus the one
 * edit outside the table: a new row grows the vocabulary, so `OPS_VERSION`
 * (`./types.ts`) moves with it, or a record written against the new row would
 * claim to be the old vocabulary.
 */
const OPS = Object.freeze({
  // ── arithmetic ──
  add: { category: 'arithmetic', least: 2, most: 2, takes: TWO, wants: ['number', 'number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} plus ${a[1]}`, strict: true, of: (c) => num(c, 0) + num(c, 1) },
  sub: { category: 'arithmetic', least: 2, most: 2, takes: TWO, wants: ['number', 'number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} minus ${a[1]}`, strict: true, of: (c) => num(c, 0) - num(c, 1) },
  mul: { category: 'arithmetic', least: 2, most: 2, takes: TWO, wants: ['number', 'number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} times ${a[1]}`, strict: true, of: (c) => num(c, 0) * num(c, 1) },
  // PINNED: always float, and a division by zero is absent — the walker turns the infinity into the silence it really is.
  div: { category: 'arithmetic', least: 2, most: 2, takes: TWO, wants: ['number', 'number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} divided by ${a[1]}`, strict: true, of: (c) => num(c, 0) / num(c, 1) },
  // PINNED: the sign follows the DIVIDEND — SQL's and JavaScript's `%`. Excel and Sheets MOD follow the DIVISOR: MOD(-7, 3) is 2 there and -1 here.
  mod: { category: 'arithmetic', least: 2, most: 2, takes: TWO, wants: ['number', 'number'], repeat: 'last', yields: 'number', words: (a) => `the remainder of ${a[0]} divided by ${a[1]}`, strict: true, of: (c) => num(c, 0) % num(c, 1) },

  // ── compare ──
  eq: { category: 'compare', least: 2, most: 2, takes: TWO, wants: ['same', 'same'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is ${a[1]}`, strict: true, of: (c) => c[0] === c[1] },
  ne: { category: 'compare', least: 2, most: 2, takes: TWO, wants: ['same', 'same'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is not ${a[1]}`, strict: true, of: (c) => c[0] !== c[1] },
  lt: { category: 'compare', least: 2, most: 2, takes: TWO, wants: ['ordered', 'ordered'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is less than ${a[1]}`, strict: true, of: (c) => isBefore(c[0]!, c[1]!) },
  lte: { category: 'compare', least: 2, most: 2, takes: TWO, wants: ['ordered', 'ordered'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is at most ${a[1]}`, strict: true, of: (c) => !isBefore(c[1]!, c[0]!) },
  gt: { category: 'compare', least: 2, most: 2, takes: TWO, wants: ['ordered', 'ordered'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is more than ${a[1]}`, strict: true, of: (c) => isBefore(c[1]!, c[0]!) },
  gte: { category: 'compare', least: 2, most: 2, takes: TWO, wants: ['ordered', 'ordered'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is at least ${a[1]}`, strict: true, of: (c) => !isBefore(c[0]!, c[1]!) },
  // PINNED: both ends included — "between 1 and 10" includes 1 and 10, the way a person reading the sentence expects.
  between: { category: 'compare', least: 3, most: 3, takes: THREE, wants: ['ordered', 'ordered', 'ordered'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is between ${a[1]} and ${a[2]}`, strict: true, of: (c) => !isBefore(c[0]!, c[1]!) && !isBefore(c[2]!, c[0]!) },

  // ── logic ──
  // STRICT, deliberately unlike SQL: `and(absent, false)` is absent, not false. One absence law, no three-valued exception.
  and: { category: 'logic', least: 2, most: MANY, takes: TWO_UP, wants: ['boolean'], repeat: 'last', yields: 'boolean', words: (a) => a.join(' and '), strict: true, of: (c) => c.every((v) => v === true) },
  or: { category: 'logic', least: 2, most: MANY, takes: TWO_UP, wants: ['boolean'], repeat: 'last', yields: 'boolean', words: (a) => a.join(' or '), strict: true, of: (c) => c.some((v) => v === true) },
  not: { category: 'logic', least: 1, most: 1, takes: ONE, wants: ['boolean'], repeat: 'last', yields: 'boolean', words: (a) => `not ${a[0]}`, strict: true, of: (c) => !bool(c, 0) },

  // ── conditional and absence: the four that SEE absence ──
  if: {
    category: 'conditional', least: 3, most: 3, takes: THREE, wants: ['boolean', 'same', 'same'], repeat: 'last', yields: 'args',
    words: (a) => `${a[1]} when ${a[0]}, otherwise ${a[2]}`,
    strict: false,
    of: (arms) => {
      const test = arms[0]!();
      // An absent condition is not `false`: nobody knows which arm this row belongs in.
      if (typeof test !== 'boolean') return null;
      return test ? arms[1]!() : arms[2]!();
    },
  },
  case: {
    category: 'conditional', least: 3, most: MANY, odd: true, takes: 'a condition, its value, any further condition/value pairs, and one final fallback', wants: ['boolean', 'same'], repeat: 'cycle', yields: 'args',
    words: (a) => casePhrase(a),
    strict: false,
    of: (arms) => {
      for (let at = 0; at + 1 < arms.length; at += 2) {
        const test = arms[at]!();
        if (typeof test !== 'boolean') return null;
        if (test) return arms[at + 1]!();
      }
      return arms[arms.length - 1]!();
    },
  },
  coalesce: {
    category: 'conditional', least: 2, most: MANY, takes: TWO_UP, wants: ['same'], repeat: 'last', yields: 'args',
    words: (a) => `the first of ${a.join(', ')} that is there`,
    strict: false,
    of: (arms) => {
      for (const arm of arms) {
        const value = arm();
        if (value !== null) return value;
      }
      return null;
    },
  },
  isAbsent: { category: 'conditional', least: 1, most: 1, takes: ONE, wants: ['any'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is absent`, strict: false, of: (arms) => arms[0]!() === null },

  // ── number ──
  // PINNED: half AWAY FROM ZERO. `Math.round` alone rounds half UP, so -0.5 would be -0 rather than -1.
  round: { category: 'number', least: 1, most: 1, takes: ONE, wants: ['number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} rounded`, strict: true, of: (c) => Math.sign(num(c, 0)) * Math.round(Math.abs(num(c, 0))) },
  abs: { category: 'number', least: 1, most: 1, takes: ONE, wants: ['number'], repeat: 'last', yields: 'number', words: (a) => `the size of ${a[0]}`, strict: true, of: (c) => Math.abs(num(c, 0)) },
  floor: { category: 'number', least: 1, most: 1, takes: ONE, wants: ['number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} rounded down`, strict: true, of: (c) => Math.floor(num(c, 0)) },
  ceil: { category: 'number', least: 1, most: 1, takes: ONE, wants: ['number'], repeat: 'last', yields: 'number', words: (a) => `${a[0]} rounded up`, strict: true, of: (c) => Math.ceil(num(c, 0)) },
  // The row-wise pair takes anything ORDERED, the way `min`/`max` do — the earlier of two dates is a date — and folds through the one order, never `Math.min` (which would also spread a long list onto the call stack).
  rowMin: { category: 'number', least: 2, most: MANY, takes: TWO_UP, wants: ['ordered'], repeat: 'last', yields: 'args', words: (a) => `the smallest of ${a.join(', ')}`, strict: true, of: leastOf },
  rowMax: { category: 'number', least: 2, most: MANY, takes: TWO_UP, wants: ['ordered'], repeat: 'last', yields: 'args', words: (a) => `the largest of ${a.join(', ')}`, strict: true, of: mostOf },

  // ── string ──
  concat: { category: 'string', least: 2, most: MANY, takes: TWO_UP, wants: ['string'], repeat: 'last', yields: 'string', words: (a) => a.join(' followed by '), strict: true, of: (c) => c.join('') },
  // PINNED: the Unicode default case mappings, never the locale-sensitive ones — a column must not change with the machine that read it.
  lower: { category: 'string', least: 1, most: 1, takes: ONE, wants: ['string'], repeat: 'last', yields: 'string', words: (a) => `${a[0]} in lower case`, strict: true, of: (c) => str(c, 0).toLowerCase() },
  upper: { category: 'string', least: 1, most: 1, takes: ONE, wants: ['string'], repeat: 'last', yields: 'string', words: (a) => `${a[0]} in upper case`, strict: true, of: (c) => str(c, 0).toUpperCase() },
  trim: { category: 'string', least: 1, most: 1, takes: ONE, wants: ['string'], repeat: 'last', yields: 'string', words: (a) => `${a[0]} without its surrounding spaces`, strict: true, of: (c) => str(c, 0).trim() },
  // PINNED: code units, the same count `length` reports everywhere else in JavaScript.
  length: { category: 'string', least: 1, most: 1, takes: ONE, wants: ['string'], repeat: 'last', yields: 'number', words: (a) => `the length of ${a[0]}`, strict: true, of: (c) => str(c, 0).length },
  contains: { category: 'string', least: 2, most: 2, takes: TWO, wants: ['string', 'string'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} contains ${a[1]}`, strict: true, of: (c) => str(c, 0).includes(str(c, 1)) },
  startsWith: { category: 'string', least: 2, most: 2, takes: TWO, wants: ['string', 'string'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} starts with ${a[1]}`, strict: true, of: (c) => str(c, 0).startsWith(str(c, 1)) },
  endsWith: { category: 'string', least: 2, most: 2, takes: TWO, wants: ['string', 'string'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} ends with ${a[1]}`, strict: true, of: (c) => str(c, 0).endsWith(str(c, 1)) },
  // Scanned in place: a written-down list is read once per row and must not be copied once per row.
  in: { category: 'string', least: 2, most: MANY, takes: TWO_UP, wants: ['same'], repeat: 'last', yields: 'boolean', words: (a) => `${a[0]} is one of ${a.slice(1).join(', ')}`, strict: true, of: isOneOf },
  // PINNED: a column holds ONE value, so a split answers with one PIECE — counted from 1, and absent when there is no such piece.
  split: { category: 'string', least: 3, most: 3, takes: THREE, wants: ['string', 'string', 'number'], repeat: 'last', yields: 'string', words: (a) => `piece ${a[2]} of ${a[0]}, split on ${a[1]}`, strict: true, of: (c) => str(c, 0).split(str(c, 1))[num(c, 2) - 1] ?? null },
  // PINNED: the start counts from 1, the way a person counts characters; a start before the first, or a negative length, is absent.
  substring: {
    category: 'string', least: 3, most: 3, takes: THREE, wants: ['string', 'number', 'number'], repeat: 'last', yields: 'string',
    words: (a) => `${a[2]} characters of ${a[0]} from character ${a[1]}`,
    strict: true,
    of: (c) => {
      const from = num(c, 1);
      const many = num(c, 2);
      if (from < 1 || many < 0) return null;
      return str(c, 0).slice(from - 1, from - 1 + many);
    },
  },
  // PINNED: EVERY occurrence, not the first — and replacing nothing changes nothing, the way SUBSTITUTE answers; JavaScript's replaceAll would insert between every character.
  replace: { category: 'string', least: 3, most: 3, takes: THREE, wants: ['string', 'string', 'string'], repeat: 'last', yields: 'string', words: (a) => `${a[0]} with ${a[1]} replaced by ${a[2]}`, strict: true, of: (c) => (str(c, 1).length === 0 ? str(c, 0) : str(c, 0).replaceAll(str(c, 1), str(c, 2))) },

  // ── date ──
  year: { category: 'date', least: 1, most: 1, takes: ONE, wants: ['date'], repeat: 'last', yields: 'number', words: (a) => `the year of ${a[0]}`, strict: true, of: (c) => partsOf(day(c, 0)).year },
  month: { category: 'date', least: 1, most: 1, takes: ONE, wants: ['date'], repeat: 'last', yields: 'number', words: (a) => `the month of ${a[0]}`, strict: true, of: (c) => partsOf(day(c, 0)).month },
  week: { category: 'date', least: 1, most: 1, takes: ONE, wants: ['date'], repeat: 'last', yields: 'number', calendar: 'always', words: (a) => `the week of ${a[0]}`, strict: true, of: (c, calendar) => weekOf(day(c, 0), calendar!) },
  dayOfWeek: { category: 'date', least: 1, most: 1, takes: ONE, wants: ['date'], repeat: 'last', yields: 'number', calendar: 'always', words: (a) => `the weekday of ${a[0]}`, strict: true, of: (c, calendar) => weekdayOf(day(c, 0), calendar!) },
  dateDiff: { category: 'date', least: 3, most: 3, takes: THREE, wants: ['date', 'date', 'unit'], repeat: 'last', yields: 'number', words: (a) => `the whole ${a[2]}s from ${a[0]} to ${a[1]}`, strict: true, of: (c) => diffOf(day(c, 0), day(c, 1), unit(c, 2)) },
  dateAdd: {
    category: 'date', least: 3, most: 3, takes: THREE, wants: ['date', 'number', 'unit'], repeat: 'last', yields: 'date',
    words: (a) => `${a[1]} ${a[2]}s after ${a[0]}`,
    strict: true,
    of: (c) => {
      const to = addOf(day(c, 0), num(c, 1), unit(c, 2));
      return to === null ? null : isoOf(to);
    },
  },
  dateTrunc: { category: 'date', least: 2, most: 2, takes: TWO, wants: ['date', 'unit'], repeat: 'last', yields: 'date', calendar: 'when-week', words: (a) => `the start of the ${a[1]} containing ${a[0]}`, strict: true, of: (c, calendar) => isoOf(truncOf(day(c, 0), unit(c, 1), calendar)) },

  // ── cast ──
  cast: {
    category: 'cast', least: 2, most: 2, takes: TWO, wants: ['any', 'target'], repeat: 'last', yields: 'target',
    words: (a) => `${a[0]} read as a ${a[1]}`,
    strict: true,
    of: (c) => castOf(c[0]!, str(c, 1)),
  },

  // ── reducers: the six that fold ROWS, and the only ops that need a group ──
  // Each takes ONE argument, and that argument is an ordinary ROW tree — which
  // is what makes `sum(if(kind is "state", cases, absent))` the honest SUMIF.
  count: { category: 'reducer', least: 1, most: 1, takes: ONE, wants: ['any'], repeat: 'last', yields: 'number', words: (a) => `how many rows have ${a[0]}`, reduces: true, of: counting },
  sum: { category: 'reducer', least: 1, most: 1, takes: ONE, wants: ['number'], repeat: 'last', yields: 'number', words: (a) => `the total of ${a[0]}`, reduces: true, of: summing },
  mean: { category: 'reducer', least: 1, most: 1, takes: ONE, wants: ['number'], repeat: 'last', yields: 'number', words: (a) => `the average of ${a[0]}`, reduces: true, of: averaging },
  min: { category: 'reducer', least: 1, most: 1, takes: ONE, wants: ['ordered'], repeat: 'last', yields: 'args', words: (a) => `the smallest ${a[0]}`, reduces: true, of: smallest },
  max: { category: 'reducer', least: 1, most: 1, takes: ONE, wants: ['ordered'], repeat: 'last', yields: 'args', words: (a) => `the largest ${a[0]}`, reduces: true, of: largest },
  distinct: { category: 'reducer', least: 1, most: 1, takes: ONE, wants: ['any'], repeat: 'last', yields: 'number', words: (a) => `how many different ${a[0]} there are`, reduces: true, of: different },
}) satisfies Readonly<Record<string, Op>>;

/** The name of one op of {@link OPS}. */
export type OpName = keyof typeof OPS;

/** Every op name, in the order the table declares them — and the order a refusal lists them. */
export const OP_NAMES: readonly OpName[] = Object.freeze(Object.keys(OPS) as OpName[]);

/**
 * The op of a name, or `undefined` when the grammar has no such op.
 *
 * WHY an own-key test: the table is a plain object, and a bare index would
 * answer `Object.prototype.toString` for the name `toString` — a function
 * wearing the type of an op.
 */
export function opOf(name: string): Op | undefined {
  return Object.hasOwn(OPS, name) ? (OPS as Readonly<Record<string, Op | undefined>>)[name] : undefined;
}

// ── the folds that needed a name ─────────────────────────────────────────────

/** `in`: is the first cell one of the rest? Scanned in place — cells are never NaN, so `===` is the same equality `includes` keeps. */
function isOneOf(cells: readonly Cell[]): boolean {
  for (let at = 1; at < cells.length; at += 1) if (cells[at] === cells[0]) return true;
  return false;
}

/** `case`, in words: each pair as "value when condition", and the last argument as the fallback. */
function casePhrase(args: readonly string[]): string {
  const arms: string[] = [];
  for (let at = 0; at + 1 < args.length; at += 2) arms.push(`${args[at + 1]!} when ${args[at]!}`);
  return `${arms.join(', ')}, otherwise ${args[args.length - 1]!}`;
}

/**
 * `cast`, whose target is the literal word it was given.
 *
 * PINNED: `cast(to date)` answers with an ISO STRING and never a `Date` — a
 * `Date` is a moment in a time zone, and a column is bytes a log can carry.
 * Text that is not an ISO date is absent, never a guess.
 */
function castOf(value: Cell, target: string): Cell {
  if (target === 'number') {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return numberOf(value as string);
  }
  if (target === 'string') return typeof value === 'string' ? value : String(value);
  if (typeof value !== 'string') return null;
  const at = epochDayOf(value);
  return at === null ? null : isoOf(at);
}

// ── what one argument position wants ─────────────────────────────────────────

/**
 * The want at one position, given how many arguments there are.
 *
 * `repeat: 'last'` is the ordinary rule — the final entry covers every further
 * position, which is what makes a variadic op's table row two words long.
 * `'cycle'` exists for `case` alone: its arguments alternate condition, value,
 * condition, value, and the FINAL one is the fallback, which takes the last
 * entry rather than continuing the cycle.
 */
export function wantAt(op: Op, at: number, count: number): ArgWant {
  const last = op.wants.length - 1;
  if (op.repeat === 'cycle') return at === count - 1 ? op.wants[last]! : op.wants[at % op.wants.length]!;
  return op.wants[Math.min(at, last)]!;
}

// ── the names this grammar knows and will not take ───────────────────────────

/**
 * Names that are NOT ops here, and the reason each one is not — so a person who
 * writes the obvious thing is told which door owns it rather than that the word
 * is unknown.
 *
 * Three names, three different reasons, and none of them is "not yet". Two can
 * never become ops: a clock cannot be replayed. `lookup` is not a missing op
 * but an op that would DUPLICATE an act — reaching a second table is
 * `bringOver`, across a declared relation, and a node that carried its own
 * `{ table, key, value }` would be naming a join nobody declared, which is the
 * one thing the relation exists to prevent (`../def/README.md`, law 6). The
 * sentence names the door so the refusal is a direction and not a wall.
 *
 * WHY a null prototype: the judge reads this table by name, and a plain object
 * would answer native code for `toString` — a refusal quoting a function body
 * at a person, under the wrong door.
 */
export const RESERVED_OPS: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    lookup:
      'a lookup reads a SECOND table, and only a declared relation may permit that — declare the relation and bring the column over (the bringOver act), then read it here by its name',
    today: 'a column whose value depends on when it ran cannot be replayed, so this grammar has no clock',
    now: 'a column whose value depends on when it ran cannot be replayed, so this grammar has no clock',
  }),
);

/** The calendars and date units, re-exported here because the op table is where a judge looks them up. */
export { CALENDARS, DATE_UNITS };
