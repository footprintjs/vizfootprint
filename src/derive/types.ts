/**
 * THE TREE — a derived column, written down.
 *
 * A derived column is a DECLARATION, never a program: three node forms, closed,
 * each of them plain JSON. There is no expression string here, no function, no
 * escape hatch — because every one of those is a place where provenance stops.
 * A tool that lets a person drop into SQL or JavaScript can say what a column
 * was called and never what it MEANT; the tree below can be read, judged,
 * replayed, put into a sentence and shown to somebody who was not there.
 *
 * The law it follows is the library's own: **a record is data.** The same rule
 * that makes a commit replayable from the log alone makes a column replayable
 * from its declaration alone — so what a column is must be spellable in the
 * bytes, and nothing about it may live only in a closure.
 *
 * The first customers are {@link ./judge.ts} (does this declaration say a legal
 * column, and what type is it), {@link ./walk.ts} (one row through it),
 * {@link ./groups.ts} (a group of rows through it) and {@link ./words.ts} (the
 * why-sentence), and they are four walks over ONE shape. A second TABLE is
 * still not spellable here and never will be: reaching one is an act of its
 * own (`../analysis/bringOver.ts`), because only a declared relation may permit
 * it — the judge says so by name.
 *
 * ```ts
 * // cases / population * 100000
 * const expr: Expr = {
 *   op: 'mul',
 *   args: [{ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, { lit: 100000 }],
 * };
 * ```
 */

import type { ColumnType } from '../data/types.js';
import type { OpName } from './ops.js';

// ── what a value can be ──────────────────────────────────────────────────────

/**
 * The four types a derived column can have.
 *
 * The engine's own vocabulary ({@link ColumnType}) minus `unknown`: a column
 * whose type nobody can name is not a column an expression may read, and the
 * judge refuses it in a sentence rather than computing a column of silences.
 * No refusal lists all four — a cast lists `CAST_TARGETS` and an ordering lists
 * the three ordered types, and neither holds `boolean`.
 */
export type DeriveType = Exclude<ColumnType, 'unknown'>;

/**
 * One value, at one row, of one column — or the absence that is not a value.
 *
 * A date is an ISO string here and everywhere below it: `cast(to date)` yields
 * an ISO string and never a `Date`, because a `Date` is a moment in a time zone
 * and a column is bytes a log can carry (see {@link ./dates.ts}).
 */
export type Cell = number | string | boolean | null;

/**
 * What a `{ lit }` node may hold.
 *
 * `null` is the literal absence, and it may only stand where a value could —
 * never in a position that wants a number, string, boolean or date. Its home is
 * the arm an `if` gives its other case, or the final fallback of a `case`:
 * `if(kind is "state", cases, null)` is what makes `sum` a SUMIF that skips a
 * row rather than adding a zero. It is what `coalesce` REPLACES, never an arm of
 * one — `coalesce(x, null)` says nothing that `x` did not.
 */
export type Literal = number | string | boolean | null;

/** Which calendar a week is counted on. Declared per node, never a setting — see {@link ./dates.ts}. */
export type Calendar = 'iso' | 'mmwr';

// ── the three node forms ─────────────────────────────────────────────────────

/**
 * Closed in the TYPE as well as in the judge: each node form names the other
 * forms' keys as `never`, so a node that says two of them — `{ col, op }`, the
 * shape a spread over an existing node produces — does not compile, and the
 * judge refuses the same node at the JSON door, where a type cannot reach.
 */
/** Read one column of the row. */
export interface ColExpr {
  readonly col: string;
  readonly lit?: never;
  readonly op?: never;
  readonly args?: never;
  readonly calendar?: never;
}

/** A constant, written down. */
export interface LitExpr {
  readonly lit: Literal;
  readonly col?: never;
  readonly op?: never;
  readonly args?: never;
  readonly calendar?: never;
}

/**
 * Apply one op of the table ({@link ./ops.ts}) to its arguments.
 *
 * `calendar` rides the NODE, which is the whole of the "calendars are data"
 * rule: a week number that does not say which calendar counted it agrees with
 * nothing, and disagrees silently. Only the ops whose answer depends on which
 * day a week starts may carry it, and for those the judge REQUIRES it.
 */
export interface OpExpr {
  readonly op: OpName;
  readonly args: readonly Expr[];
  readonly calendar?: Calendar;
  readonly col?: never;
  readonly lit?: never;
}

/** One node of a derived column. Inert data: the four walks named above read it, nothing executes it. */
export type Expr = ColExpr | LitExpr | OpExpr;

// ── the column ───────────────────────────────────────────────────────────────

/**
 * The op-vocabulary version this file's tree is written against.
 *
 * It rides every declaration, and a build reads only declarations written
 * against its OWN version: any other is refused BY NAME ({@link ./judge.ts} —
 * `this column is written against ops 2, and this build knows ops 1`) instead
 * of mis-reading a node it has never seen. WHY refused in both directions: a
 * vocabulary that grew is a vocabulary whose old nodes may have changed
 * meaning, and only a migration may say they did not. Adding a row to the op
 * table grows the vocabulary, so this number moves with it.
 */
export const OPS_VERSION = 1;

/**
 * What a derived column can be, as a word.
 *
 * `row` reads its own row; `aggregate` is the same on every row of its group.
 * The judge holds a declaration to the word it says, in both directions, so the
 * word is a FACT about the column and not a label somebody chose — that is
 * Malloy's dimension/measure split, and the reason a caption can quote it.
 * `window` needs an ordering as well as a group and is refused by name — a
 * refusal that says which step owns the thing is more use than one that says
 * the word is unknown. It is a word a person may WRITE, never one a declaration
 * may HOLD ({@link DerivedColumn.kind}).
 */
export type DeriveKind = 'row' | 'aggregate' | 'window';

/**
 * The rows a reducer runs over.
 *
 * `groupBy` names the columns whose values make the groups; the empty list is
 * how a declaration says THE WHOLE TABLE, so there is no implicit default and
 * no reducer that never said what it counted.
 *
 * `where` names which rows the reducer runs over — not which rows get a value.
 * The demo's own table is why: its `cells` hold state rows, region roll-ups and
 * a national total as ordinary rows, so `sum(cases)` over a disease
 * double-counts unless the declaration says `where kind is "state"`. Every row
 * still gets the answer for its group; the filter is about what went INTO it,
 * and the why-sentence prints it.
 *
 * The basis is always the FULL table, never the live selection: a per-selection
 * aggregate is a measure, not a column.
 */
export interface Over {
  /** The grouping columns. `[]` means the whole table, said out loud. */
  readonly groupBy: readonly string[];
  /** Which rows the reducers fold over. A row whose answer is not `true` — absent included — is left out. */
  readonly where?: Expr;
}

/** The declaration. Everything a person must be able to ask WHY about, and nothing else. */
export interface DerivedColumn {
  /** The op-vocabulary version — {@link OPS_VERSION} for anything this build writes. */
  readonly ops: number;
  /** `row` or `aggregate`, and the judge holds the tree to it. `window` is refused by name and so never held. */
  readonly kind: Exclude<DeriveKind, 'window'>;
  /** The tree. */
  readonly expr: Expr;
  /** The group, when the tree holds a reducer. Declared together with one, or with neither. */
  readonly over?: Over;
}

// ── the answers ──────────────────────────────────────────────────────────────

/**
 * What the judge answers about one tree: the type it computes and the columns
 * it reads, or the ONE sentence saying why it is not a column.
 *
 * The type is COMPUTED from the op table at declaration, never tallied from the
 * values afterwards — which is what lets a column of nothing but absences still
 * know it is a number.
 */
export type ExprJudgement =
  | { readonly ok: true; readonly expr: Expr; readonly type: DeriveType; readonly reads: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/** The same, for a whole declaration. */
export type DeriveJudgement =
  | { readonly ok: true; readonly column: DerivedColumn; readonly type: DeriveType; readonly reads: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/**
 * Where one cell's value comes from. The walker's ONLY way of reaching data.
 *
 * A reader and not a row, so there is one walker: the row door, a columnar walk
 * and whatever an engine hands over later are the same evaluation seen from
 * different sides, and none of them can hold a second opinion about what a
 * declaration means.
 */
export type CellReader = (column: string) => unknown;
