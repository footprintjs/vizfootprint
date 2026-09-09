/**
 * vizfootprint/analysis (L3) — declared analyses executed as footprintjs
 * flowcharts, whose outputs extend the data space through existing rails (R11).
 *
 * The four output CHANNELS (columns / geometry / scalar / table) are closed —
 * validated by the C3 mini-spike (`spikes/l3-channels/`) before that half was
 * frozen.
 *
 * What an analysis READS grew after that spike: `AnalysisDef.reads` names the
 * tables it reads BESIDE the one it runs over, a declared relation is the
 * permission (judged at the door), and `toRunInput(input, related)` receives
 * their rows — `NO_RELATED_ROWS` when it named none. See ./README.md.
 */

export { defineAnalysis, validateAnalysisDef, AnalysisDefError } from './defineAnalysis.js';
export {
  formulaAnalysis,
  parseFormula,
  evaluateFormula,
  formulaColumnProblems,
  FormulaError,
  FORMULA_FUNCTIONS,
  type FormulaNode,
  type FormulaParse,
  type FormulaOptions,
  type FormulaColumnType,
} from './formula.js';
export {
  clusteringAnalysis,
  correlationAnalysis,
  regressionAnalysis,
  groupByAnalysis,
  normalApproxPValue,
  REGRESSION_MIN_POINTS,
  type DataRow,
} from './builtins.js';
export {
  layoutAnalysis,
  adjacencyOf,
  distancesOf,
  place,
  LayoutError,
  LAYOUT_ALGORITHMS,
  LAYOUT_NODE_CAP,
  LAYOUT_DEFAULT_ITERATIONS,
  LAYOUT_DEFAULT_SEED,
  DEFAULT_GRAPH_COLUMNS,
  type LayoutAlgorithm,
  type LayoutOptions,
  type LayoutAdjacency,
  type LayoutDistances,
  type PlaceOptions,
  type PlacedPositions,
  type GraphColumns,
} from './layout.js';
export {
  bringOverAnalysis,
  bringOverColumns,
  bringOverProblems,
  broughtColumnName,
  broughtColumnNames,
  BringOverError,
  COUNTS_SUFFIX,
  type BringOverJoin,
  type BringOverCounts,
  type BringOverOptions,
  type BringOverWork,
  type BroughtColumns,
} from './bringOver.js';
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
  UnavailableResult,
  OutputColumnType,
  AnalysisResult,
  HonestyDecl,
  InputBinding,
  InputRole,
  TestDecl,
  TestContext,
  ReadContext,
  AnalysisDef,
  AnalysisModule,
  // the two halves of one shape, read together
  RelatedRows,
  AnalysisRunInput,
  AnalysisRunResult,
  RunAnalysisOptions,
  HypothesisSink,
} from './types.js';
// `NO_RELATED_ROWS` is the empty `RelatedRows`: the def named no table to read
// beside its own. It never means "a named table came back empty" — a table that
// could not be read stops the whole act.
export { ANALYSIS_KINDS, INPUT_ROLES, NO_RELATED_ROWS, OUTPUT_CHANNELS } from './types.js';
