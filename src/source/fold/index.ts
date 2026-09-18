/**
 * vizfootprint/source/fold — a computation declares WHERE it may attach.
 *
 * The folder barrel. It carries the port, the three positions, the declaration
 * door, residency (derived, never asked for), the pure driver and the
 * conformance check that falsifies a monotone claim. See ./README.md for the
 * law and an example of each position.
 */
export { FOLD_POSITIONS } from './types.js';
export type { FoldPosition, ResourceFold, DeclaredFold, FoldAnswer, FoldAnswerObserver, Residency, FoldRun, FoldEnd, FoldTap, FoldRejection } from './types.js';
export { declareFolds, residencyOf } from './declare.js';
export { foldOver, answersOf, reportAnswer } from './run.js';
export type { FoldOutcome } from './run.js';
export { falsifyMonotone } from './conformance.js';
export type { MonotoneCheck, MonotoneVerdict } from './conformance.js';
