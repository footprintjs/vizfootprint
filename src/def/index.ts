/**
 * vizfootprint/def (L5, the declarative half) — `buildDashboard(def)` and the
 * `DashboardDef` schema (a Mosaic-spec superset, D10). Validated by an R12
 * firewall; offline, no API key.
 */

export { buildDashboard } from './buildDashboard.js';
export type { Dashboard, BuildDashboardOptions } from './buildDashboard.js';
export { validateDashboardDef, DashboardDefError, dispatchVerbs } from './validate.js';
export {
  DISPATCH_VERBS,
  DEFAULT_INTENTS,
  ABSENCE_STATES,
  ABSENCE_UNKNOWN,
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
  RegisteredAnalysis,
  ViewDecl,
  FdrStepper,
} from './types.js';
