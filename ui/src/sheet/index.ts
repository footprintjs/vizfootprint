/**
 * The Sheet: a read-only, virtualized grid over a data session, with its two
 * adapters and the block cache they share. The PUBLIC surface (what
 * `vizfootprint-ui` re-exports) is `<Sheet>`, `<AddColumn>`, `<AddAggregate>`, the two adapters,
 * the cache factory, the arrangement's two READERS — `sheetLayoutViewId` and
 * `sheetSortOf`, which a host lands a sort through and reads it back at the
 * cursor — and the types. The rest of the pure helpers below (the codec, the
 * scope builder, the words, the three constants) are exported for the tests and
 * for a host building its own renderer over the same port. See ./README.md.
 */
export { Sheet, canvasMetrics, cellText, nextSort, noSortWords, rowAtScroll, scrollForRow, statusWords, POSITIONAL_REFUSAL, SHEET_BORDERS, SHEET_CANVAS_MAX, SHEET_ENGINE_CANNOT_SORT, SHEET_ROW_HEIGHT, SHEET_STATUS_HEIGHT } from './Sheet.js';
export type { SheetMetrics, SheetProps } from './Sheet.js';
// the arrangement: a sheet's sort as an ACT, and the codec both sides of it share
export { sheetLayoutScope, sheetLayoutViewId, sheetSortOf, sortArrow, sortedByWords, sortFromLayoutValue, sortPhraseOf, sortToLayoutValue, sortWords, SHEET_LAYOUT_KIND, SHEET_LAYOUT_PREFIX, SHEET_SORT_PROP } from './arrangement.js';
export { AddColumn, ADD_COLUMN_HINT, ADD_COLUMN_NO_NUMBERS, ADD_COLUMN_PRESENTING } from './AddColumn.js';
export type { AddColumnOutcome, AddColumnProps } from './AddColumn.js';
// the same door one level out: a TABLE of one row per group, cut from the rows visible here
export { AddAggregate, ADD_AGGREGATE_HINT, ADD_AGGREGATE_NO_COLUMNS, ADD_AGGREGATE_PRESENTING, ADD_AGGREGATE_WHOLE_TABLE } from './AddAggregate.js';
export type { AddAggregateOutcome, AddAggregateProps } from './AddAggregate.js';
export { sessionSheetData, threwSentence } from './sessionSheetData.js';
export type { SessionSheetOptions, SheetSessionLike } from './sessionSheetData.js';
export { httpSheetData, isViewQueryResult, windowQuery } from './httpSheetData.js';
export type { FetchLike, HttpSheetOptions } from './httpSheetData.js';
export { blockKey, blockRange, createBlockCache, questionKey, sliceWindow, splitBlocks, SHEET_BLOCK_ROWS, SHEET_MAX_BLOCKS } from './blockCache.js';
export type { BlockCache, BlockCacheOptions, BlockKeyParts, RangeFetch, SheetBlock, SheetEntry } from './blockCache.js';
// …including the two the port SPEAKS but does not own: a renderer naming the type of a value this
// barrel just handed it should not have to reach past the port for the name (`./types.ts` re-exports them for that).
export type { SheetCapabilities, SheetColumn, SheetData, SheetRefusal, SheetWindow, SheetWindowRequest, SortSpec, ViewQueryRefusal } from './types.js';
