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
  FindOptions,
  FindResult,
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
  RelandOptions,
  RelandResult,
  Row,
  SortSpec,
  WalkAsk,
} from './types.js';
export { PAIR_CLAUSE_KINDS, badFindReason, cellFieldLabel, clauseFields, clauseList, isPairClause, isPairKind, isRejection, neighbourhoodFieldLabel, reject } from './types.js';

export { literalToSQL, matchesClause, resolvePredicateSQL, isClearedSQL, mosaicDescriptorSQL } from './predicate.js';
// The TEXT FORM of a cell — one owner, below every door that reads it: the
// export writes it into a field, a copy puts it on the clipboard, and a FIND
// matches a person's typing against it. `vizfootprint/session` re-exports it
// under the same name (it lived there first).
export { cellString } from './cellText.js';

// The window AROUND the WHERE: one pure statement builder, no engine — the
// columns, the order, the cap and the source-order column a window asks for,
// rendered once so two engines cannot disagree about what the same
// `EvaluateOptions` mean. `quoteIdent` is the one quoting rule both share.
export { windowSQL, ROW_ORDER_COLUMN, WindowRefusal } from './sqlWindow.js';
export type { WindowRefusalReason, WindowTableFacts } from './sqlWindow.js';
// …and the same builder's answer to "where is the next match in THIS order?":
// two statements from ONE renderer of the order, so the position a find hands
// back is the offset the window opens at.
export { findSQL, FIND_ORDINAL_COLUMN, FIND_POSITION_COLUMN } from './sqlWindow.js';
export type { FindStatements } from './sqlWindow.js';
// A refresh is computed where the rows live: the delta every engine owes
// (`deltaByKey` is the memory engine's strategy; `vizfootprint/source` still
// names it), and the statements the SQL engine asks it with — rendered once,
// pinned byte for byte, no row leaving the database.
export { deltaByKey, DELTA_SAMPLE } from './delta.js';
export type { RefreshDelta } from './delta.js';
export { relandSQL, emptyStagingSQL, dropStagingSQL, stagingTableOf, RELAND_KEY_COLUMN } from './sqlReland.js';
export type { RelandColumns, RelandDeltaStatements, RelandStatements } from './sqlReland.js';
export { quoteIdent } from './predicate.js';

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

// SILENCE BELONGS TO A COLUMN: the port every reader of absence asks, its two adapters and its two
// tests. One reading per table, answered per column — the declaration stays the def's shape.
export { readsValueTestOf, SILENCE_ARITHMETICS, silenceOfDecl, silenceOfNothing, silenceTestOf } from './silence.js';
export type { ColumnSilence, TableSilence } from './silence.js';

// A table whose state columns and value columns disagree is refused at the data door, once — this is the sentence.
export { absenceContradictionOf } from './absenceContradiction.js';

// Derived columns — the trace's columns, versioned by the act that made them.
export { DerivedColumnStore, canNameSlot, derivedColumnName, renameClauseFields, renameRowSlots, resolveDerived } from './derivedColumns.js';
export type { DerivedColumn } from './derivedColumns.js';

// Derived tables — an aggregate is an ACT, not a view: computed once over the rows visible at its
// cursor and landed in its own slot (a later selection does not recompute it; a new act does), under
// the same slot grammar as the columns; its relation back to the parent is minted, never typed.
export { DerivedTableStore, derivedTableName, mintDerivedTable } from './derivedTables.js';
export type { DerivedTable, DerivedTableAct } from './derivedTables.js';

// Landed columns — what the engine landed for a table, learned once (at build, and again at each
// re-land), kept beside the table's version, read by every judge that must answer synchronously.
// Not a cache: written only by the acts that land rows, never consulted by a read that must see the engine live.
export { LandedColumns } from './landedColumns.js';
export type { LandedEntry } from './landedColumns.js';

export { memoryProvider, SORT_CACHE_PER_TABLE } from './memoryProvider.js';
export type { Layout, MemoryProviderOptions, RowsInput } from './memoryProvider.js';

export { wasmProvider, wasmConnectionRefusal } from './wasmProvider.js';
export type { WasmProviderOptions } from './wasmProvider.js';

// The port a SQL backend is reached through — and the ONE statement that gives a
// loaded table its source-order column. `wasmProvider` sees this and never DuckDB.
export { canLoad, loadTableSQL } from './sqlConnection.js';
export type { LoadingConnection, SqlConnection, SqlLoader, TableData } from './sqlConnection.js';

// …and the one implementation of it. Exported as a FACTORY of an opener: importing
// this barrel must never be the act that fetches a WASM bundle — only calling the
// opener the factory returns is (`duckdbConnection.ts` holds the dynamic import).
// It opens in EITHER host — a browser's Worker or node's blocking bundle — and
// which one is judged when the opener is called, by `duckdbHostOf`.
// A self-hosting page hands the browser arm its own `bundles` (`DuckDBBundles`) in
// place of the CDN's map; rows reach the engine as typed CSV and a def's CSV is typed by the same law (`landing.ts`),
// so no landing fetches anything — the reader is statically linked. What reaches it is BYTES, chunk-encoded
// (`TypedBytes`): the landing has no string ceiling, only the engine's memory.
export { browserBundlesOf, duckdbConnection, duckdbHostOf, hostFactsOf, landingOf, nodeBundles, nodeConnectionOver, nodeLoggerOf, nodeModuleOf, rowOf, rowsOf, sqlConnectionOver, NO_DUCKDB_HOST } from './duckdbConnection.js';
export type {
  DuckDBBundle,
  DuckDBBundles,
  DuckDBConnectionOptions,
  DuckDBDatabase,
  DuckDBHandle,
  DuckDBHost,
  DuckDBNodeBindings,
  DuckDBNodeBundle,
  DuckDBNodeBundles,
  DuckDBNodeConnection,
  DuckDBNodeModule,
  DuckDBResult,
  FileResolver,
  HostFacts,
  HostGlobals,
  Landing,
} from './duckdbConnection.js';
export { csvLandingOf, csvReaderSQL, landedColumnsOf, landedTypeOf, rowsLandingOf, rowsReaderSQL, NO_CSV_HEADER, NO_ROWS_TO_LAND, NULL_TOKEN } from './landing.js';
export type { LandedColumn, LandedType, TypedBytes } from './landing.js';

export { serverProvider } from './serverProvider.js';
export type { ServerProviderOptions } from './serverProvider.js';

// The engine this version names and does not run — and the one sentence the
// build door (`buildDashboard`/`lint()`) and the read door (the providers' typed
// rejections) both say so in.
export { STUB_ENGINES, isStubEngine, stubEngineRefusal, stubEngineRemedy, stubEngineSentence } from './stubEngines.js';
export type { StubEngine } from './stubEngines.js';

export {
  chooseEngine,
  defaultEnginePolicy,
  DEFAULT_ENGINE_THRESHOLDS,
  /**
   * @deprecated The name these thresholds had while they were an unmeasured
   * placeholder (Q12). `bench/step0-wasm` measured the row axis, so the name
   * stopped being true: import {@link DEFAULT_ENGINE_THRESHOLDS}. Kept for ONE
   * release so a consumer pinned to the old name still resolves.
   */
  DEFAULT_ENGINE_THRESHOLDS as PLACEHOLDER_ENGINE_THRESHOLDS,
} from './chooseEngine.js';
export type { ChooseEngineOptions, DatasetStats, EnginePolicy, EngineThresholds } from './chooseEngine.js';

// One pass, many recorders — bring the questions you need; the rows are walked once.
export { foldOnce, rowCount, total, extent, distinct, groupCount, numbers, columnar, columnTypes, keyedIndex, TypeTally } from './fold.js';
export type { RowRecorder, Recorders, FoldResult } from './fold.js';
