/**
 * DERIVE — the closed grammar of a derived column.
 *
 * A declaration ({@link ./types.ts}), an op table ({@link ./ops.ts}) over a
 * calendar ({@link ./dates.ts}), a judge ({@link ./judge.ts}), a walker over
 * one row ({@link ./walk.ts}), a fold over a group of them
 * ({@link ./groups.ts}), a sentence ({@link ./words.ts}) and the act that lands
 * one ({@link ./analysis.ts}). Read {@link ./README.md} first: it carries the
 * laws with an example each.
 *
 * This barrel is the folder's door, and TWO edges leave through it:
 * `../def/builtinAnalyses.ts` takes the factory (`deriveAnalysis`, the
 * `derive` record's one act), and `../def/index.ts` republishes `OPS_VERSION`
 * plus the declaration types onto the package's published `./def` entry — so
 * those names are PUBLIC, and renaming one is a breaking change. The grammar
 * RUNS as one act, never op by op; what leaves as names is only what a def
 * author must be able to write down. Everything else on this door serves the
 * folder's own tests.
 */

export type { Calendar, Cell, CellReader, ColExpr, DeriveJudgement, DeriveKind, DeriveType, DerivedColumnDecl, Expr, ExprJudgement, LitExpr, Literal, Measure, OpExpr, Over } from './types.js';
export { OPS_VERSION } from './types.js';

export type { ArgWant, Arm, Fold, LazyFold, Op, OpCategory, OpName, Reduce, Tally, YieldRule } from './ops.js';
export { CALENDARS, CAST_TARGETS, DATE_UNITS, OP_NAMES, opOf, REDUCER_OPS, RESERVED_OPS, wantAt } from './ops.js';

export type { DateUnit } from './dates.js';
export { addOf, daysInMonth, dayOf, diffOf, epochDayOf, isoOf, isoOfMoment, partsOf, truncOf, weekdayOf, weekOf, weekStartOf } from './dates.js';

export { judgeDerivedColumn, judgeExpr, MAX_TREE_DEPTH, MAX_TREE_NODES } from './judge.js';

export type { GroupAnswer } from './walk.js';
// `evaluateRow` and `readerFor` keep the absence law's SECOND half (the table's declared absence
// column); `evaluate` keeps only the law the reader it was handed already keeps.
export { evaluate, evaluateRow, PRESENT, readerFor } from './walk.js';

export { wordsFor } from './words.js';

export type { DeriveOptions } from './analysis.js';
// `deriveWords` is the whole declaration's sentence under the landing door's name; `wordsFor` is a fragment for one tree.
export { deriveAnalysis, deriveWords } from './analysis.js';

// The GROUP fold's second door: one row per group — what an aggregate table is made of.
export type { GroupRow, Rows } from './groups.js';
export { groupRowsOf, rowsOver, valuesOf } from './groups.js';

// THE AGGREGATE — the derive act's twin: a derived TABLE of one row per group, landed through `analyze`.
export type { AggregateOptions } from './aggregate.js';
export { aggregateAnalysis, aggregateWords } from './aggregate.js';
