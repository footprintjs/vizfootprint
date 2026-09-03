/**
 * The Sheet: a read-only, virtualized grid over a data session, with its two
 * adapters and the block cache they share. The PUBLIC surface (what
 * `vizfootprint-ui` re-exports) is `<Sheet>`, the two adapters, the cache
 * factory and the types; the pure helpers below are exported for the tests and
 * for a host building its own renderer over the same port. See ./README.md.
 */
export { Sheet, canvasMetrics, cellText, nextSort, rowAtScroll, scrollForRow, statusWords, POSITIONAL_REFUSAL, SHEET_BORDERS, SHEET_CANVAS_MAX, SHEET_ROW_HEIGHT, SHEET_STATUS_HEIGHT } from './Sheet.js';
export type { SheetMetrics, SheetProps } from './Sheet.js';
export { sessionSheetData, threwSentence } from './sessionSheetData.js';
export type { SessionSheetOptions, SheetSessionLike } from './sessionSheetData.js';
export { httpSheetData, isViewQueryResult, windowQuery } from './httpSheetData.js';
export type { FetchLike, HttpSheetOptions } from './httpSheetData.js';
export { blockKey, blockRange, createBlockCache, questionKey, sliceWindow, splitBlocks, SHEET_BLOCK_ROWS, SHEET_MAX_BLOCKS } from './blockCache.js';
export type { BlockCache, BlockCacheOptions, BlockKeyParts, RangeFetch, SheetBlock, SheetEntry } from './blockCache.js';
export type { SheetCapabilities, SheetColumn, SheetData, SheetRefusal, SheetWindow, SheetWindowRequest } from './types.js';
