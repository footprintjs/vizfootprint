export type {
  CellClause,
  CellSide,
  ColumnFacet,
  ColumnInfo,
  ColumnRole,
  ColumnScale,
  ColumnType,
  DataProvider,
  DataProviderCapabilities,
  DataProviderRejection,
  Engine,
  EvaluateOptions,
  EvaluateResult,
  IntervalBounds,
  IntervalClause,
  MatchClause,
  MatchValue,
  MatchValueBody,
  PointClause,
  PredicateClause,
  RejectionReason,
  ResolvedEngine,
  Row,
} from './types.js';
export { cellFieldLabel, clauseFields, isRejection, reject } from './types.js';

export { literalToSQL, matchesClause, resolvePredicateSQL, isClearedSQL } from './predicate.js';

export { equalWidthBins, recountBins } from './bins.js';
export type { Bin, Bins, EqualWidthBinsOptions } from './bins.js';

export { boxSummary } from './boxSummary.js';
export type { BoxSummary, BoxSummaryOptions } from './boxSummary.js';

export { parseCSV, parseCSVTyped } from './csv.js';
export type { ParsedCSV, SniffedCSV } from './csv.js';

export { memoryProvider } from './memoryProvider.js';
export type { Layout, MemoryProviderOptions, RowsInput } from './memoryProvider.js';

export { wasmProvider } from './wasmProvider.js';
export type { WasmLoadSource, WasmProviderOptions } from './wasmProvider.js';

export { serverProvider } from './serverProvider.js';
export type { ServerProviderOptions } from './serverProvider.js';

export {
  chooseEngine,
  defaultEnginePolicy,
  PLACEHOLDER_ENGINE_THRESHOLDS,
} from './chooseEngine.js';
export type { ChooseEngineOptions, DatasetStats, EnginePolicy, EngineThresholds } from './chooseEngine.js';

// One pass, many recorders — bring the questions you need; the rows are walked once.
export { foldOnce, rowCount, total, extent, distinct, groupCount, numbers, columnar, columnTypes, keyedIndex, TypeTally } from './fold.js';
export type { RowRecorder, Recorders, FoldResult } from './fold.js';
