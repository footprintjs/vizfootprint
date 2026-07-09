/**
 * vizfootprint/session (L5, the live half) — `InteractionSession`, the container
 * that wires L1/L2/L3/L4/data into one live session driven by `dispatch` (R4).
 * A session is opened by `buildDashboard(def).createSession()` (see `../def`).
 */

export { createInteractionSession } from './session.js';
export type { InteractionSession } from './session.js';
export { GapLedger } from './gapLedger.js';
export type {
  DispatchAction,
  DispatchResult,
  AnalysisCommit,
  Checkpoint,
  GapRow,
  GapCode,
  GapOp,
  ViewAdapter,
  AdapterCapabilities,
  WhyNotImplemented,
  SessionOptions,
  DeclareAnalysisOptions,
  Overview,
  ViewInfo,
  SelectionInfo,
  AnalysisReadiness,
  FdrSummary,
  ColumnFacet,
} from './types.js';
