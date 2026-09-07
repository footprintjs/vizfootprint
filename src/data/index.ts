/**
 * THE QUERY PORT IS OUR SHAPE — and one clause list is one question.
 *
 * `vizfootprint/data` is the door onto the rows: the `DataProvider` port
 * (tables, columns, `evaluate(table, clause | clause[] | null)`,
 * `materializeColumn`) and the three engines behind it, the ONE reading of the
 * flat wire triple a commit carries, and the folds that walk a table once.
 *
 * THE LAW IT FOLLOWS: one translation of a wire triple, never two — a second
 * reading can differ about what a commit MEANS, silently, and the answer on
 * screen would be the one nobody tested (see ./README.md).
 *
 * FIRST CUSTOMERS: the session's ask (`src/session`), the ui contract tier
 * (`ui/src/contract`, which COMPILES the clause this folder interprets), and
 * the analyses. `isRejection`/`reject` here are the DATA port's, not
 * `vizfootprint/selection`'s same-named pair — that door judges a selection.
 */
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
  NeighbourhoodClause,
  NeighbourhoodDerivation,
  NeighbourhoodValue,
  NeighbourhoodValueBody,
  PointClause,
  PredicateClause,
  RejectionReason,
  ResolvedEngine,
  Row,
  SortSpec,
} from './types.js';
export { PAIR_CLAUSE_KINDS, cellFieldLabel, clauseFields, isPairClause, isPairKind, isRejection, neighbourhoodFieldLabel, reject } from './types.js';

export { literalToSQL, matchesClause, resolvePredicateSQL, isClearedSQL, mosaicDescriptorSQL } from './predicate.js';

// The wire triple a commit carries, read as the clause it means — the one
// translation, so a consumer holding a commit never writes the rules again.
// `clauseFromWire` yields the PREDICATE; `cellSideClause` is its other half (an
// array side is an interval, anything else a point) for a consumer compiling a
// cell's two sides apart; `pointValueFromWire` is that same point reading —
// cleared vs IS NULL — for a door that mints a clause WITHOUT `clauseFromWire`
// (the selection judge, the Mosaic adapter); and `neighbourhoodValueFromWire`
// reads the slots the predicate does drop: the seed, derivation and hops a walk
// recorded.
export { cellSideClause, clauseFromWire, neighbourhoodValueFromWire, pointValueFromWire } from './clauseFromWire.js';
export type { WireClauseKind } from './clauseFromWire.js';

export { equalWidthBins, recountBins } from './bins.js';
export type { Bin, Bins, EqualWidthBinsOptions } from './bins.js';

export { boxSummary } from './boxSummary.js';
export type { BoxSummary, BoxSummaryOptions } from './boxSummary.js';

export { parseCSV, parseCSVTyped } from './csv.js';
export type { ParsedCSV, SniffedCSV } from './csv.js';

// What is in this table — one walk, no dashboard, no session.
export { describeTable, DESCRIBE_DISTINCT_CAP, DESCRIBE_SAMPLE } from './describeTable.js';
export type { ColumnDescription, DescribeTableOptions, TableDescription } from './describeTable.js';

// Derived columns — the trace's columns, versioned by the act that made them.
export { DerivedColumnStore, canNameSlot, derivedColumnName, renameClauseFields, renameRowSlots, resolveDerived } from './derivedColumns.js';
export type { DerivedColumn } from './derivedColumns.js';

export { memoryProvider, SORT_CACHE_PER_TABLE } from './memoryProvider.js';
export type { Layout, MemoryProviderOptions, RowsInput } from './memoryProvider.js';

export { wasmProvider } from './wasmProvider.js';
export type { WasmLoadSource, WasmProviderOptions } from './wasmProvider.js';

export { serverProvider } from './serverProvider.js';
export type { ServerProviderOptions } from './serverProvider.js';

// The two engines this version names and does not run — and the one sentence the
// build door (`buildDashboard`/`lint()`) and the read door (the providers' typed
// rejections) both say so in.
export { STUB_ENGINES, isStubEngine, stubEngineRefusal, stubEngineRemedy, stubEngineSentence } from './stubEngines.js';
export type { StubEngine } from './stubEngines.js';

export {
  chooseEngine,
  defaultEnginePolicy,
  PLACEHOLDER_ENGINE_THRESHOLDS,
} from './chooseEngine.js';
export type { ChooseEngineOptions, DatasetStats, EnginePolicy, EngineThresholds } from './chooseEngine.js';

// One pass, many recorders — bring the questions you need; the rows are walked once.
export { foldOnce, rowCount, total, extent, distinct, groupCount, numbers, columnar, columnTypes, keyedIndex, TypeTally } from './fold.js';
export type { RowRecorder, Recorders, FoldResult } from './fold.js';
