/**
 * vizfootprint/def (L5, the declarative half) — `buildDashboard(def)` and the
 * `DashboardDef` schema (a Mosaic-spec superset, D10). Validated by an R12
 * firewall; offline, no API key.
 */

export { buildDashboard, buildDashboardAsync } from './buildDashboard.js';
export type { Dashboard, BuildDashboardOptions, BuildDashboardAsyncOptions, RefreshOutcome, RefreshResult, RefreshRecord } from './buildDashboard.js';
export { validateDashboardDef, parseDashboardDef, DashboardDefError, dispatchVerbs } from './validate.js';
export type { ParsedDashboardDef } from './validate.js';
// An analysis named as DATA — the third form of `AnalysisSlot`, and the key
// that makes a whole def JSON-serialisable. See ./README.md.
export { BUILTIN_ANALYSES, BuiltinAnalysisError, isBuiltinRecord, validateBuiltinAnalysis, buildBuiltinAnalysis } from './builtinAnalyses.js';
export type { BuiltinAnalysisDecl, BuiltinAnalysisName, GroupByDecl, CorrelationDecl, RegressionDecl, ClusteringDecl, FormulaDecl, LayoutDecl, BringOverDecl, BuiltinAnalysisContext } from './builtinAnalyses.js';
export {
  DISPATCH_VERBS,
  DEFAULT_INTENTS,
  ABSENCE_STATES,
  ABSENCE_UNKNOWN,
  MAGNITUDE_CHANNELS,
  RELATION_KINDS,
} from './types.js';
// Relations between tables — validated in `./relations.ts`, laws in ./README.md ("Relations").
export { validateRelations, relationEdgeId, joinsTables, relationsFrom, judgeAnalysisReads, neighbourhoodEndpoints } from './relations.js';
// Layers — a view over more than one table; `viewId~layerId` is the address an act on a layer lands under,
// and `./layerAddress.ts` is the ONE owner of the marker (laws in ./README.md "Layers").
export { LAYER_MARKER, layerAddress, splitLayerAddress, holdsLayerMarker } from './layerAddress.js';
export type { LayerAddressParts } from './layerAddress.js';
export { validateLayers, layerSurfaceOf, layerSurfacesOf } from './layers.js';
export type { LayerSurface } from './layers.js';
// The long-form series contract (F3): `{t, entity, metric, value}` in, rows +
// declared encodings out — no bespoke chart API. See `./series.ts`.
export {
  seriesToRows,
  seriesDataSource,
  seriesEncodingDecl,
  seriesCaption,
  SERIES_FIELDS,
  SERIES_CHART_KIND,
  SERIES_CHANNELS,
  SERIES_ENCODINGS,
} from './series.js';
export type { SeriesPoint, SeriesSource, SeriesToRowsOptions } from './series.js';
export type {
  DashboardDef,
  DataSourceDef,
  SeriesGrain,
  AbsenceDecl,
  CapabilityDecl,
  ViewEncodingDecl,
  LayerDecl,
  FdrDecl,
  AgentDecl,
  IntentDecl,
  IntentClass,
  AnalysisSlot,
  DispatchVerb,
  DashboardRuntime,
  EncodingRuntime,
  RegisteredAnalysis,
  ViewDecl, GrainDecl,
  RelationEnd, RelationDecl, RelationEdge, RelationKind,
  FdrStepper,
} from './types.js';

// Layer 4 — the link graph (owned by src/links; re-exported here beside the def that declares it).
export { EMISSION_KINDS, ENCODING_KIND, LINK_KINDS, LINK_RESPONSES, ENCODING_RESPONSES, responsesFor, LINK_ON_CLEAR, LINK_DEFAULTS, edgeId, impliedKinds, voiceOf, materializeLinks, defaultChannelPairs, applyLinkOverrides, edgesInto, edgesFrom, validateLinks, linksToMermaid } from '../links/index.js';
export type { EmissionKind, LinkKind, ChannelPair, LinkResponse, LinkOnClear, LinkDefault, FieldMapping, LinkDecl, LinkEdge, LinkView, LinkGraph } from '../links/index.js';


// The encoding plane (owned by src/encoding; re-exported here beside the def that declares its rule set).
export {
  CATEGORY_CHANNELS,
  CHANNEL_CLASSES,
  RULE_KINDS,
  RULE_SCOPES,
  COLUMN_ROLES,
  COLUMN_SCALES,
  DEFAULT_CHANNEL_REQUIREMENTS,
  CHART_REQUIREMENTS,
  KINDS_NOT_PROPOSED,
  requirementFor,
  chartKindsOf,
  channelsOf,
  SENTENCES,
  resolveFacets,
  BUILTIN_RULES,
  validateBindings,
  refuses,
  fitsFor,
  whatFits,
  acceptsOf,
  RANKING_POLICY,
  CHANNEL_NAMES,
  DEFAULT_RANKING_REASON,
  placeIn,
  policyRecommender,
  proposeCharts,
  proposableKinds,
  OFFER_SENTENCES,
  PROPOSAL_LIMIT,
  PROPOSAL_CANDIDATES,
  PROPOSAL_BINDINGS,
  lintEncodings,
  pageBindings,
  formatProblem,
  describeRules,
  discreteCoercer,
  BUILTIN_COERCERS,
  // the reading rule (matrix or node-link) rides the same door as the offer that
  // consumes it — a consumer reading `ChartProposals.reading` needs the rules
  // and the thresholds beside it, or it re-derives them
  GRAPH_READING_RULES,
  DEFAULT_GRAPH_READING,
  CHART_KIND_FOR_READING,
  DENSE_AT,
  BIG_AT,
  densityOf,
  graphReadingFor,
} from '../encoding/index.js';
export type {
  ChannelClass,
  ChannelRequirement,
  ChannelRequirements,
  RuleScope,
  NeverOnRule,
  NeverTogetherRule,
  OnlyWithRule,
  BusinessRule,
  EncodingPolicy,
  EncodingRules,
  EncodingProblem,
  Coercer,
  Explainer,
  Fit,
  Recommender,
  EncodingPorts,
  EncodingSurface,
  Bindings,
  ColumnDecl,
  FitColumn,
  WhatFitsInput,
  RankingRule,
  Placement,
  ChartProposal,
  ChartProposals,
  ProposalKind,
  ProposeChartsInput,
  RuleLine,
  GraphFact,
  GraphQuestion,
  GraphReading,
  GraphReadingKind,
  GraphReadingRule,
} from '../encoding/index.js';

// The data-source layer (owned by src/source; the file carrier is its own module, src/source/file.ts).
export { SOURCE_FORMATS, SOURCE_VIAS, SOURCE_REFUSALS, CAPABILITY_REFUSALS, SourceRefusal, isSourceRefusal, isUnchanged, deltaByKey, decodeRows, inlineSource, inlineVersion, openSource } from '../source/index.js';
export type { SourceFormat, SourceVia, SourceRefusalReason, SourceUnchanged, RefreshDelta, SourceDecl, SourceCapabilities, SnapshotOptions, SourceSnapshot, SourceHandle, SourceAdapter, SourceInfo, SourceRejection } from '../source/index.js';
export type { RestorableSaved, RestorableBookmark, RestoreResult, SavedClause, SavedSelection, SavedStore, Bookmark, BookmarkStore, CommitIdStore } from './types.js';

// The builtin online-FDR stepper (owned by `../fdr`, which is a barrel and not a
// door). It belongs HERE because this is the DECLARING half: `FdrDecl` above is
// the declaration, `FdrStepper` is the contract it names, and this is the
// implementation that satisfies it — you choose a stepper when you declare a
// dashboard. Observing what it produced (`FdrStep`) is `../session`'s half. See
// PACKAGING.md, Law 1.
//
// Its sibling `createAlphaInvesting` and the option/state types stay unexported:
// Law 2 — a symbol earns a barrel when an importer asks, and none has.
export { createLordPlusPlus } from '../fdr/index.js';
