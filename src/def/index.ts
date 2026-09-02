/**
 * vizfootprint/def (L5, the declarative half) — `buildDashboard(def)` and the
 * `DashboardDef` schema (a Mosaic-spec superset, D10). Validated by an R12
 * firewall; offline, no API key.
 */

export { buildDashboard, buildDashboardAsync } from './buildDashboard.js';
export type { Dashboard, BuildDashboardOptions, BuildDashboardAsyncOptions } from './buildDashboard.js';
export { validateDashboardDef, DashboardDefError, dispatchVerbs } from './validate.js';
export {
  DISPATCH_VERBS,
  DEFAULT_INTENTS,
  ABSENCE_STATES,
  ABSENCE_UNKNOWN,
  MAGNITUDE_CHANNELS,
} from './types.js';
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
  requirementFor,
  SENTENCES,
  resolveFacets,
  BUILTIN_RULES,
  validateBindings,
  refuses,
  fitsFor,
  acceptsOf,
  lintEncodings,
  formatProblem,
  describeRules,
  discreteCoercer,
  BUILTIN_COERCERS,
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
  RuleLine,
} from '../encoding/index.js';

// The data-source layer (owned by src/source; the file carrier is its own module, src/source/file.ts).
export { SOURCE_FORMATS, SOURCE_VIAS, decodeRows, inlineSource, inlineVersion, openSource } from '../source/index.js';
export type { SourceFormat, SourceVia, SourceDecl, SourceCapabilities, SnapshotOptions, SourceSnapshot, SourceHandle, SourceAdapter, SourceInfo, SourceRejection } from '../source/index.js';
