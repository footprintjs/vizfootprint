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
  RenderEncodings,
  // protocol 1.2: one layer of a frame — exported in the SAME change as the field that carries it
  RenderLayer,
  SelectionClauseView,
  RenderSelection,
  RenderState,
  MountedRenderer,
  Renderer,
  ContractGapKind,
  ContractGap,
} from './types.js';

// The layer ADDRESS (`viewId~layerId`) is minted by the library, and the marker has
// exactly one owner there (`vizfootprint/def`'s layerAddress.ts). A host that
// keys `HostHandshake.layers`, reads a commit's viewId, or finds a layer's own
// clause in `RenderSelection.clauses` needs the split and the join — so they
// ship from this barrel too, re-exported, never respelled (README, "the
// derivation helpers ship in a set").
export { LAYER_MARKER, layerAddress, splitLayerAddress, holdsLayerMarker } from 'vizfootprint/def';
export type { LayerAddressParts } from 'vizfootprint/def';

export {
  clausePredicate,
  emptySelection,
  selectionForView,
  // the rule `keepPredicate` folds by, exported so a host reading one clause by hand narrows by the SAME rule
  filtersHere,
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
export type { BindOptions, BindResult, BoundRenderer, NavigateOutcome, UpdateOutcome, LayerBindings } from './bind.js';

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
  // protocol 1.2: the first first-party renderer that layers — exported in the SAME change as the chart it wraps
  networkRenderer,
  // the ceiling THIS RENDERER refuses past — a size judgement about one SVG
  // frame, not a protocol limit and not the chart's: `<VizNetwork>` draws
  // whatever it is handed (renderers.tsx, "a ceiling, not a capability")
  NETWORK_NODE_CEILING,
  NETWORK_EDGE_CEILING,
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
  NetworkRendererOptions,
} from './renderers.js';

export { runConformance } from './conformance.js';
export type { ConformancePlan, ConformanceLayersPlan, ConformanceReport, ConformanceStep, ConformanceStepName } from './conformance.js';
