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

export { vizAsTools } from './vizAsTools.js';
export type { VizTool, VizToolResult, VizToolsPort, VizToolsOptions } from './vizAsTools.js';

// Re-export the declare + connect halves so `vizfootprint/agent` is the one L5 entry.
export { buildDashboard, validateDashboardDef, DashboardDefError, DISPATCH_VERBS, DEFAULT_INTENTS, dispatchVerbs } from '../def/index.js';
export type {
  Dashboard,
  BuildDashboardOptions,
  DashboardDef,
  DataSourceDef,
  CapabilityDecl,
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
  AnalysisCommit,
  Checkpoint,
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
  WhyTarget,
  WhyResult,
  CrossTierSlice,
  CrossTierMiss,
  WhyTargetMiss,
  TierCommit,
  AgentEventFrame,
} from '../session/index.js';
