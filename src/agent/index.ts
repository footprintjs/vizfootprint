/**
 * vizfootprint/agent (L5) — the agent-driving surface. The three-beat grammar,
 * family-symmetric with hcifootprint (`buildNavigationGraph → createSession →
 * skillsAsTools`): **declare → connect → serve**.
 *
 *   buildDashboard(def)          → Dashboard          // declare (offline, no API key)
 *     .createSession(opts?)      → InteractionSession  // connect (one live session)
 *   vizAsTools(session)          → VizToolsPort         // serve (fixed Mode B tools)
 *
 * The MCP server (`mcpServer`) lives behind the `vizfootprint/mcp` subpath
 * (`../mcp`) — the ONLY place the optional `@modelcontextprotocol/sdk` peer is
 * imported — so this entry stays SDK-free.
 */

export { vizAsTools, HIDDEN_NOT_ERASED } from './vizAsTools.js';
export type {
  VizTool,
  VizToolResult,
  VizToolsPort,
  VizToolsOptions,
  // the ACTS, typed: what a consumer reads a field off instead of guessing at a bag
  VizDispatchResult,
  VizDispatchOk,
  VizDispatchRefusal,
  VizAnalysisResult,
  VizProposeChartResult,
  VizPortRefusal,
} from './vizAsTools.js';
export { whatLanded } from './landed.js';
export type { VizLanded } from './landed.js';

// Re-export the declare + connect halves so `vizfootprint/agent` is the one L5 entry.
export { buildDashboard, validateDashboardDef, DashboardDefError, DISPATCH_VERBS, DEFAULT_INTENTS, dispatchVerbs } from '../def/index.js';
export type {
  Dashboard,
  BuildDashboardOptions,
  DashboardDef,
  DataSourceDef,
  CapabilityDecl,
  // the emission kinds a view may declare — the ONE spelling behind both `CapabilityDecl.encodings` and `AdapterCapabilities.encodings`
  EmissionKind,
  ViewEncodingDecl,
  FdrDecl,
  AgentDecl,
  IntentDecl,
  IntentClass,
  AnalysisSlot,
  DispatchVerb,
} from '../def/index.js';

export { createInteractionSession, GapLedger } from '../session/index.js';
export type {
  InteractionSession,
  DispatchAction,
  DispatchResult,
  FilterRange,
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
  ViewInfo,
  SelectionInfo,
  AnalysisReadiness,
  FdrSummary,
  ColumnFacet,
  // BR-1 named paths + TL-1 the trail lifecycle
  PathInfo,
  PathsListOptions,
  PathsState,
  ArchivePathResult,
  RestorePathResult,
  DiscardResult,
  AdoptStep,
  AdoptPathResult,
  WhyTarget,
  WhyResult,
  CrossTierSlice,
  CrossTierMiss,
  DroppedRef,
  WhyTargetMiss,
  TierCommit,
  AgentEventFrame,
  // RP-3 agent-authored charts
  ProposeChartInput,
  ProposeChartResult,
  ChartHypothesis,
  ChartView,
  ChartInfo,
} from '../session/index.js';
