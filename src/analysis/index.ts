/**
 * vizfootprint/analysis (L3) — declared analyses executed as footprintjs
 * flowcharts, whose outputs extend the data space through existing rails (R11).
 *
 * The four output channels (columns / geometry / scalar / table) were validated
 * by the C3 mini-spike before this API was frozen (`spikes/l3-channels/`).
 */

export { defineAnalysis, validateAnalysisDef, AnalysisDefError } from './defineAnalysis.js';
export {
  clusteringAnalysis,
  correlationAnalysis,
  regressionAnalysis,
  groupByAnalysis,
  normalApproxPValue,
  REGRESSION_MIN_POINTS,
  type DataRow,
} from './builtins.js';
export { mean, pearson, ols, quantileBins } from './stats.js';
export type {
  AnalysisKind,
  AnalysisOutput,
  ColumnsOutput,
  GeometryOutput,
  ScalarOutput,
  TableOutput,
  OutputChannel,
  DegenerateResult,
  AnalysisResult,
  HonestyDecl,
  InputBinding,
  TestDecl,
  TestContext,
  ReadContext,
  AnalysisDef,
  AnalysisModule,
  AnalysisRunResult,
  RunAnalysisOptions,
  HypothesisSink,
} from './types.js';
export { OUTPUT_CHANNELS } from './types.js';
