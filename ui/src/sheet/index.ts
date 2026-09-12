/**
 * The Sheet: a read-only, virtualized grid over a data session, with its two
 * adapters and the block cache they share. The PUBLIC surface (what
 * `vizfootprint-ui` re-exports) is `<Sheet>`, `<AddColumn>`, `<AddAggregate>`, the two adapters,
 * the cache factory, the arrangement's READERS — `sheetLayoutViewId` and one
 * per prop (`sheetSortOf`, `sheetHiddenOf`, `sheetOrderOf`, `sheetFrozenOf`),
 * which a host lands an act through and reads back at the cursor — and the types. The rest of the pure helpers below (the codec, the
 * scope builder, the words, the three constants) are exported for the tests and
 * for a host building its own renderer over the same port. See ./README.md.
 */
export { Sheet, canvasMetrics, cellText, findFrom, findWords, narrowedSaid, travelledSaid, nextSort, noSortWords, rowAtScroll, scrollForRow, statusWords, POSITIONAL_REFUSAL, SHEET_ARRANGE_HEIGHT, SHEET_BORDERS, SHEET_CANNOT_FIND, SHEET_CANVAS_MAX, SHEET_COLUMN_WIDTH, SHEET_ENGINE_CANNOT_SORT, SHEET_FIND_HEIGHT, SHEET_ROW_HEIGHT, SHEET_STATUS_HEIGHT } from './Sheet.js';
export type { SheetMetrics, SheetProps } from './Sheet.js';
// the arrangement: a sheet's sort, hidden columns, order and frozen count as ACTS,
// the codec both sides of them share, the projection they make, and their words
export { arrangeColumns, arrangeItems, arrangementSaid, arrangementToLayoutValue, arrangementWords, frozenCount, frozenFromLayoutValue, frozenToLayoutValue, hiddenFromLayoutValue, hiddenToLayoutValue, orderFromLayoutValue, orderToLayoutValue, sheetArrangementOf, sheetFrozenOf, sheetHiddenOf, sheetLayoutScope, sheetLayoutViewId, sheetOrderOf, sheetSortOf, sortArrow, sortedByWords, sortFromLayoutValue, sortPhraseOf, sortToLayoutValue, sortWords, SHEET_FROZEN_PROP, SHEET_HIDDEN_PROP, SHEET_LAYOUT_KIND, SHEET_LAYOUT_PREFIX, SHEET_ORDER_PROP, SHEET_SORT_PROP } from './arrangement.js';
export type { ArrangeAt, ArrangedColumns, SheetArrangeItem, SheetArrangementProp, SheetArrangementValues, SheetLayoutFold } from './arrangement.js';
export { AddColumn, ADD_COLUMN_HINT, ADD_COLUMN_NO_NUMBERS, ADD_COLUMN_PRESENTING } from './AddColumn.js';
export type { AddColumnOutcome, AddColumnProps } from './AddColumn.js';
// the same door one level out: a TABLE of one row per group, cut from the rows visible here
export { AddAggregate, ADD_AGGREGATE_HINT, ADD_AGGREGATE_NO_COLUMNS, ADD_AGGREGATE_PRESENTING, ADD_AGGREGATE_WHOLE_TABLE } from './AddAggregate.js';
export type { AddAggregateOutcome, AddAggregateProps } from './AddAggregate.js';
// and the door that is NOT an act: copy and export are READS, so nothing lands on the log —
// what leaves carries its address instead (`src/session/README.md`, "Export is a read that carries its address")
export { ExportRows, downloadFiles, exportRowsCopied, exportRowsDelivered, exportRowsOffer, sheetAsk, EXPORT_ROWS_HINT, EXPORT_ROWS_PROBE, EXPORT_ROWS_READING } from './ExportRows.js';
export type { ExportFile, ExportRowsProps } from './ExportRows.js';
// the clipboard door itself: shared by the form above and the grid's Ctrl+C, so it belongs to neither
export { clipboardRefusal, writeClipboard, NO_CLIPBOARD } from './clipboard.js';
export { sessionSheetData, threwSentence } from './sessionSheetData.js';
export type { SessionSheetOptions, SheetSessionLike } from './sessionSheetData.js';
export { httpSheetData, findQueryBody, isFindInViewResult, isViewQueryResult, windowQuery, NO_FIND_DOOR } from './httpSheetData.js';
export type { FetchLike, HttpSheetOptions } from './httpSheetData.js';
export { blockKey, blockRange, createBlockCache, questionKey, sliceWindow, splitBlocks, SHEET_BLOCK_ROWS, SHEET_MAX_BLOCKS } from './blockCache.js';
export type { BlockCache, BlockCacheOptions, BlockKeyParts, RangeFetch, SheetBlock, SheetEntry } from './blockCache.js';
// …including the two the port SPEAKS but does not own: a renderer naming the type of a value this
// barrel just handed it should not have to reach past the port for the name (`./types.ts` re-exports them for that).
export type { SheetCapabilities, SheetColumn, SheetData, SheetFindAnswer, SheetFindRequest, SheetRefusal, SheetWindow, SheetWindowRequest, SortSpec, ViewQueryRefusal } from './types.js';
