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
  FilterRange,
  CellValues,
  AnalysisCommit,
  BookmarkView,
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
  ReachingClause,
  ViewQuery,
  ViewQueryResult,
  ViewQueryRefusal,
  SaveSelectionSource,
  SaveSelectionResult,
  ApplySavedOptions,
  ApplySavedResult,
  BookmarkResult,
  ViewInfo,
  EffectiveEncoding,
  SelectionInfo,
  Offer,
  AnalysisReadiness,
  FdrSummary,
  ColumnFacet,
  // BR-1 named paths + plans
  PathInfo,
  PathsListOptions,
  PathsState,
  SwitchPathResult,
  RenamePathResult,
  NewPathResult,
  CompareSide,
  CompareResult,
  BringOverResult,
  // TL-1 the trail lifecycle
  ArchivePathResult,
  RestorePathResult,
  DiscardResult,
  AdoptStep,
  AdoptPathResult,
  // RP-3 agent-authored charts
  ProposeChartInput,
  ProposeChartResult,
  ChartHypothesis,
  ChartView,
  ChartInfo,
} from './types.js';

// L6 `why(target)` result types (promoted P3-L6; owned by `../why`).
export type {
  AgentEventFrame,
  CorrelationEnvelope,
  CrossTierMiss,
  CrossTierSlice,
  DroppedRef,
  Tier,
  TierCommit,
  TierCommitKind,
  WhyFlags,
  WhyResult,
  WhyTarget,
  WhyTargetMiss,
} from '../why/index.js';
// The online-FDR row a session produces as it walks (owned by `../fdr`, which is
// a barrel and not a door). It belongs HERE because `FdrSummary` above already
// is a list of them — `FdrSummary.ledger: readonly FdrStep[]` — so the fold and
// its row were reachable from one place and nameable from two. Observing FDR is
// this barrel's half; DECLARING it (`FdrDecl`, `FdrStepper`, and the builtin
// stepper `createLordPlusPlus`) is `../def`'s. See PACKAGING.md, Law 1.
export type { FdrStep } from '../fdr/index.js';
export { VIEW_QUERY_DEFAULT_LIMIT } from './session.js';
export type { RestorableSaved, RestorableBookmark, RestoreResult, SavedClause, SavedSelection, SavedStore, Bookmark, BookmarkStore } from '../def/types.js';
