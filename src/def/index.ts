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
} from './types.js';
export type {
  DashboardDef,
  DataSourceDef,
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
