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
} from './selection.js';

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
} from './renderers.js';
export type {
  ReactRendererSpec,
  ScatterRendererOptions,
  LineRendererOptions,
  BarRendererOptions,
  MapRendererOptions,
  TableRendererOptions,
  HistogramRendererOptions,
} from './renderers.js';

export { runConformance } from './conformance.js';
export type { ConformancePlan, ConformanceReport, ConformanceStep, ConformanceStepName } from './conformance.js';
