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
  BranchInfo,
  TimeState,
  SeekResult,
  GapRow,
  GapCode,
  GapOp,
  ViewAdapter,
  AdapterCapabilities,
  SessionOptions,
  DeclareAnalysisOptions,
  Overview,
  ViewInfo,
  SelectionInfo,
  AnalysisReadiness,
  FdrSummary,
  ColumnFacet,
  // BR-1 named paths + plans
  PathInfo,
  PathsState,
  SwitchPathResult,
  RenamePathResult,
  NewPathResult,
  CompareSide,
  CompareResult,
  BringOverResult,
} from './types.js';

// L6 `why(target)` result types (promoted P3-L6; owned by `../why`).
export type {
  AgentEventFrame,
  CorrelationEnvelope,
  CrossTierMiss,
  CrossTierSlice,
  Tier,
  TierCommit,
  TierCommitKind,
  WhyFlags,
  WhyResult,
  WhyTarget,
  WhyTargetMiss,
} from '../why/index.js';
