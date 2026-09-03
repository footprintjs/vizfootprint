export { RENDERER_PROTOCOL_VERSION, protocolMajor, speaksSameMajor } from './types.js';
export type {
  ChartEmission,
  EmissionKind,
  RendererCapabilities,
  NavigateViewState,
  RendererCallbacks,
  HostHandshake,
  RendererHello,
  RenderRow,
  SelectionClauseView,
  RenderSelection,
  RenderState,
  MountedRenderer,
  Renderer,
  ContractGapKind,
  ContractGap,
} from './types.js';

export {
  clausePredicate,
  emptySelection,
  selectionForView,
  keepPredicate,
  selfSelectedValue,
  selfSelectedInterval,
  // the SET-1 sibling of the three above: without it a host building its own
  // chart could outline a point, an interval and a cell — but not a
  // multi-select, the one shape SET-1 added
  selfSelectedSet,
  selfSelectedCell,
  brightPredicate, navigateDomain } from './selection.js';
export type { SelfSelectedCell, SelfSelectedSet } from './selection.js';

export { bindRenderer } from './bind.js';
export type { BindOptions, BindResult, BoundRenderer, NavigateOutcome } from './bind.js';

export {
  reactRenderer,
  scatterRenderer,
  lineRenderer,
  barRenderer,
  mapRenderer,
  tableRenderer,
  histogramRenderer,
  heatmapRenderer,
  boxPlotRenderer,
} from './renderers.js';
export type {
  ReactRendererSpec,
  ScatterRendererOptions,
  LineRendererOptions,
  BarRendererOptions,
  MapRendererOptions,
  TableRendererOptions,
  HistogramRendererOptions,
  HeatmapRendererOptions,
  BoxPlotRendererOptions,
} from './renderers.js';

export { runConformance } from './conformance.js';
export type { ConformancePlan, ConformanceReport, ConformanceStep, ConformanceStepName } from './conformance.js';
