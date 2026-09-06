/**
 * vizfootprint/selection — the selection PORT: our clause, our source
 * identity, the built-in engine-free port, and the chart emission contract.
 *
 * Why a door of its own (PACKAGING.md, Law 3): everything here is dependency-
 * free. The Mosaic ENGINE lives behind `vizfootprint/mosaic`, the adapter door
 * and the only importer of the optional `@uwdata/*` peers — a consumer that
 * only ever needs a clause type or the built-in port must never load them.
 */
export { builtinSelection } from './builtinSelection.js';
export { RegisteredSource, SelectionPortError, SourceRegistry, SourceRegistryError, isRejection, reject } from './types.js';
export type {
  ActorMeta,
  CauseClause,
  CauseClauseKind,
  CauseClauseSpec,
  CauseMetadata,
  NativeSelection,
  SelectionCapabilities,
  SelectionEngine,
  SelectionListener,
  SelectionOperation,
  SelectionPort,
  SelectionRejection,
  SelectionRejectionReason,
} from './types.js';
export { causeClauseFromEmission, causeClauseSpecFromEmission } from './emission.js';
export type {
  CellEncoding,
  ChartEmission,
  ChartEncoding,
  EmissionContext,
  IntervalEncoding,
  MatchEncoding,
  PointEncoding,
} from './emission.js';
