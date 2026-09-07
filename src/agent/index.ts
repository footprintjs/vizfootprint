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

// ── clause 5: the reader's control over how much of the answer they get ────────
// The parts table is POLICY AS DATA (a host may read or replace it); the two
// reason vocabularies and the apply door are what make a narrowed answer
// readable and a delta checkable rather than trusted.
export { SURFACE_PARTS, SURFACE_PART_NAMES, PART_SCOPES, PART_STABILITIES, CACHE_CLASSES, cacheClassOf } from './surfaceParts.js';
export type { SurfacePart, PartScope, PartStability, CacheClass } from './surfaceParts.js';
export { applySurfaceDelta, isListDelta, ENVELOPE_KEYS } from './narrow.js';
export type { Omission, OmissionReason, SinceDisclosure, ListDelta, ApplyResult } from './narrow.js';
export type { AnswerBasis } from './basis.js';

// Re-export the declare + connect halves so `vizfootprint/agent` is the one L5 entry.
export { buildDashboard, validateDashboardDef, parseDashboardDef, DashboardDefError, DISPATCH_VERBS, DEFAULT_INTENTS, dispatchVerbs } from '../def/index.js';
export type {
  Dashboard,
  BuildDashboardOptions,
  DashboardDef,
  DataSourceDef,
  // the edges between tables — a column pointing at another table's declared key; `RelationEdge` is one as the runtime holds it, `kind` written out
  RelationDecl,
  RelationEdge,
  RelationEnd,
  CapabilityDecl,
  // the emission kinds a view may declare — the ONE spelling behind both `CapabilityDecl.encodings` and `AdapterCapabilities.encodings`
  EmissionKind,
  ViewEncodingDecl,
  // one layer of a view over more than one table — `table` required; an act on it lands under `viewId~layerId`
  LayerDecl,
  FdrDecl,
  AgentDecl,
  IntentDecl,
  IntentClass,
  AnalysisSlot,
  // an analysis named as data — what lets a whole def be JSON
  BuiltinAnalysisDecl,
  ParsedDashboardDef,
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
  LayerInfo,
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
