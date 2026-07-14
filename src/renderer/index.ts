/**
 * `vizfootprint/renderer` (RP-3 / D28) — the runtime-free renderer-protocol
 * core: the pure chart-spec shape gate the governed `proposeChart` pipeline
 * runs, and the Vega-Lite bridge consumes for its own shape checks. No charting
 * dependency — see `specShapeGate.ts` for the dependency-direction rationale.
 */
export {
  analyzeSpecShape,
  gateChartSpec,
  CHART_COMPOSITION_KEYS,
  CHART_TRANSFORM_OPS,
} from './specShapeGate.js';
export type {
  DetectedTransform,
  SpecShapeFacts,
  ChartGateReason,
  ChartShapeVerdict,
} from './specShapeGate.js';
