# Browser grids at 90k–1M rows: what the field does, and the port vizfootprint should own

Layer named up front: the **sheet** is a layer-3 (chart) renderer over a **layer-1 (data)** port. The **Data Source tab** is layer 1's declaration surface; every act on either tab is a layer-5 commit. Nothing here touches layer 2's fold law except to reuse it for header summaries.

## 1. Rendering approach: DOM-virtualized vs canvas

Two camps, one shared trick — only the visible window exists.

- **AG Grid** is DOM-only: "only renders what you see", 10 buffer rows above and below (`rowBuffer`), no column buffer, and a hard safety cap of 500 rendered rows (`suppressMaxRenderedRowRestriction` to lift) — https://www.ag-grid.com/react-data-grid/dom-virtualisation/
- **Handsontable** is DOM with `viewportRowRenderingOffset` / `viewportColumnRenderingOffset`; its own advice is to pre-set `colWidths`/`rowHeights`, avoid the per-cell `cells` callback, batch updates, and paginate for "thousands of rows" — https://handsontable.com/docs/javascript-data-grid/performance/
- **react-data-grid** is DOM (CSS Grid layout), "columns and rows outside the viewport are not rendered", no dependencies, but requires React 19.2+ — https://github.com/adazzle/react-data-grid
- **regular-table** (FINOS graduated, Apache-2.0) renders a real `<table>` sticky inside a scroll box, zero dependencies, virtual in both axes — https://github.com/finos/regular-table
- **Glide Data Grid** is canvas: "Once you need to load/unload hundreds of DOM elements per frame nothing can save you"; claims millions of rows via lazy cells and native scrolling — https://github.com/glideapps/glide-data-grid
- **Univer** is a canvas spreadsheet engine (Apache-2.0 core, plugin-first, Pro is paid for collaboration/import-export/pivot/charts) — https://github.com/dream-num/univer
- **Perspective** is a C++ WASM streaming engine (Apache-2.0) with a memory64 build for in-browser datasets over 4 GB; its viewer has a virtual-scrolling grid and WebGL charts; the project now lives under `perspective-dev`, a member of the OpenJS Foundation — https://github.com/finos/perspective. Whether its datagrid plugin is built on regular-table is [unverified] (page 404'd).

Plain reading: at 90k rows **DOM virtualization is enough** (AG Grid's client-side model states 100k+ rows with ~40 rendered). Canvas wins only when you need thousands of cells repainting per frame (smooth scroll on dense wide tables) or millions of rows, and it costs you the accessibility tree (section 6). The bench at 90k (step 0 of the scheduler plan) decides this — not a library choice.

## 2. The data-access contract (the part a PORT must copy)

Every serious grid asks the data the same question — **give me a rectangle**:

- AG Grid Infinite Row Model (community): `IDatasource.getRows({ startRow, endRow, sortModel, filterModel, successCallback(rows, lastRow), failCallback })`; block cache `cacheBlockSize` default 100, `maxBlocksInCache`, `maxConcurrentDatasourceRequests` default 2, `infiniteInitialRowCount` default 1; explicitly no grouping, no client-side sort/filter, no select-all — https://www.ag-grid.com/react-data-grid/infinite-scrolling/
- AG Grid Server-Side Row Model (enterprise): `IServerSideDatasource.getRows(params)` with `params.request` (startRow, endRow, rowGroupCols, groupKeys, valueCols, pivotCols, pivotMode, filterModel, sortModel), `params.success({ rowData })`, `params.fail()`, optional `destroy()`; cacheBlockSize default 100 — https://www.ag-grid.com/react-data-grid/server-side-model-datasource/ and https://www.ag-grid.com/react-data-grid/server-side-model-api-reference/
- Row models: client-side and infinite are community; server-side and viewport are enterprise — https://www.ag-grid.com/react-data-grid/row-models/
- Glide: three required props `columns`, `getCellContent(cell: Item) => GridCell`, `rows: number`; `getCellsForSelection?: true | (selection: Rectangle) => CellArray | GetCellsThunk` (async thunk allowed; without it "copy will not work"); `onVisibleRegionChanged(range, tx, ty, extras)`; `onCellEdited`, `onCellsEdited` (batch), `onPaste(target, values) => boolean`; `freezeColumns: number`; `rowMarkers` — https://docs.grid.glideapps.com/api/dataeditor.md and https://github.com/glideapps/glide-data-grid/blob/main/packages/core/API.md
- regular-table: `setDataListener((x0, y0, x1, y1) => { num_rows, num_columns, data, row_headers?, column_headers?, metadata? })`, async-friendly — https://github.com/finos/regular-table
- TanStack Table is headless (you render), MIT, "virtualizable & server-side friendly", pairs with TanStack Virtual — https://github.com/TanStack/table ; TanStack Virtual: `useVirtualizer({ count, getScrollElement, estimateSize, overscan })`, `getVirtualItems()`, `getTotalSize()`, `measureElement`, both axes — https://tanstack.com/virtual/latest/docs/introduction

The invariant across all five: the grid never owns the rows; it owns a **window** (rows or a rectangle), a **total count** for the scrollbar, and a **cache of blocks**. Sort/filter travel *with* the request, so the source answers the whole question at once — exactly the "ONE query per gesture" law already in `memoryProvider.evaluate`.

## 3. Column header affordances: type badges, quality bars, distributions

The best reference is not a grid library but Power Query: under each header, **Column quality** (valid green / error red / empty grey / unknown dashed, with percentages), **Column distribution** (frequency bars sorted descending; hover shows distinct vs unique), and a **Column profile** pane below the preview with statistics and a value-distribution chart you can right-click to filter or group — https://learn.microsoft.com/en-us/power-query/data-profiling-tools. It profiles "the first 1,000 rows" by default and shows a status-bar message you click to switch to "entire data set" — same URL. Tableau's Data Source page shows "the first 1,000 rows" in its grid, plus a metadata grid with fields as rows for bulk rename/hide — https://help.tableau.com/current/pro/desktop/en-us/environment_datasource_page.htm. Power BI's Table view is post-load data with per-column sort/filter icons and right-click copy of cell/column/table — https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-view. Observable's data table cell (per-column header histograms) could not be fetched (HTTP 429) — [unverified].

AG Grid's default header has sort indicator, filter icon, column menu, tooltips, and allows fully custom header components; column menus themselves are enterprise — https://www.ag-grid.com/react-data-grid/column-headers/ and https://www.ag-grid.com/license-pricing/. Glide has `onHeaderMenuClick(col, screenPosition)` — API.md above.

vizfootprint already has what the header needs: `columnTypes` (TypeTally), `extent`, `distinct`, `groupCount`, `rowCount` recorders in one `foldOnce` walk (src/data/README.md), and an absence vocabulary per table (src/source/README.md). The quality bar = valid/absent/not-a-number counts the recorders already return; the distribution = `groupCount` top-k or `bins`. Power Query's "1,000-row sample with an honest switch" is a scheduler-tier concern and maps to the planned status line.

## 4. Summary rows, frozen columns

- AG Grid community: `pinnedTopRowData` / `pinnedBottomRowData` stay fixed while the body scrolls; typical use is grand totals — https://www.ag-grid.com/react-data-grid/row-pinning/. Group footers/grand totals via grouping are enterprise — license page above.
- react-data-grid: frozen columns at start and end, top/bottom summary rows, column spanning — https://github.com/adazzle/react-data-grid
- Glide: `freezeColumns: number` (left side only) — docs above.

## 5. Keyboard and accessibility

WAI-ARIA APG grid pattern: roles `grid`, `row`, `columnheader`, `rowheader`, `gridcell`; arrows move cell-to-cell; Home/End row ends; Ctrl+Home/End corners; PageUp/Down by an author-chosen row count; Shift+arrows extend selection; Ctrl+Space column, Shift+Space row, Ctrl+A all; Enter/F2 enter edit, Escape leaves; `aria-rowcount`/`aria-colcount` and `aria-rowindex`/`aria-colindex` are the sanctioned way to describe a virtualized grid; `aria-sort`, `aria-selected`, `aria-readonly` — https://www.w3.org/WAI/ARIA/apg/patterns/grid/

AG Grid follows exactly those roles and attributes, and admits the tension: "screen readers assume all elements of the grid are loaded", so it offers `ensureDomOrder`, `suppressRowVirtualisation`/`suppressColumnVirtualisation`, or pagination; it also says the server-side model "cannot announce row counts reliably" — https://www.ag-grid.com/react-data-grid/accessibility/. Glide's API doc has no accessibility statement; an experimental `disableAccessibilityTree` flag implies a synthetic tree exists — API.md and dataeditor.md above. react-data-grid claims keyboard accessibility and ARIA treegrid — repo above.

## 6. Copy/paste

- AG Grid: range/row/header copy is enterprise; community gets `enableCellTextSelection=true` (browser text selection) — https://www.ag-grid.com/react-data-grid/clipboard/
- Glide: Ctrl/Cmd+C/V with `getCellsForSelection` (async allowed) and `onPaste` splitting on tabs/newlines — API.md above.
- Platform: `navigator.clipboard.writeText` needs a secure context and transient user activation; reading needs the same plus a possible permission prompt; the older `copy`/`paste` events with `clipboardData` still work — https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API

Copy is therefore "on Ctrl+C, ask the source for the selected rectangle, write TSV" — and it is a **describe** act (a commit with a cause), not a UI side effect.

## 7. Licenses relevant to a zero-dep core + React ui

| Library | License | Notes |
|---|---|---|
| AG Grid Community | MIT; Enterprise $999/dev/yr; SSRM, pivot, range select, clipboard, column menus, sparklines, Excel export are enterprise | https://www.ag-grid.com/license-pricing/ |
| Glide Data Grid | MIT; peers lodash, marked, react-responsive-carousel; React 16–19 | https://github.com/glideapps/glide-data-grid |
| Perspective | Apache-2.0 | https://github.com/finos/perspective |
| regular-table | Apache-2.0, zero deps | https://github.com/finos/regular-table |
| TanStack Table / Virtual | MIT | https://raw.githubusercontent.com/TanStack/table/main/LICENSE , https://raw.githubusercontent.com/TanStack/virtual/main/LICENSE |
| react-data-grid | MIT | https://raw.githubusercontent.com/adazzle/react-data-grid/main/LICENSE |
| Handsontable | proprietary since 6.2.2 (Dec 2018); free only non-commercial; commercial license required for any commercial production | https://handsontable.com/docs/javascript-data-grid/software-license/ |
| Univer | Apache-2.0 core; Pro paid | https://github.com/dream-num/univer |

Handsontable is out. Univer is a whole spreadsheet product, too heavy as an adapter target for a sheet that is a *view of declared data*. The core must never import any of these; the ui package may take TanStack Virtual (MIT, tiny) or nothing.

## 8. Recommendation: a first-party minimal virtual grid PORT

**Port (core, zero-dep) — `SheetSource`** (name plain, one file `src/sheet/types.ts`, small README beside it):

- `capabilities: { sort, filter, edit, live, countKnown }` declared at open; a capability declared false names the typed refusal a caller gets (`no-sort`, `no-edit`, `count-unknown`) — same law as `SourceCapabilities`.
- `columns() → ColumnInfo[]` — name, type (TypeTally), and a `summary` object built by ONE `foldOnce` (`rowCount`, `extent`, `distinct`/`groupCount` top-k, absence counts), stamped with the data version. This is the header's quality bar and distribution.
- `count(question) → number` — the scrollbar's height; `question = { filter: clause[] | null, sort? }`.
- `rows(question, window: { start, end }, { signal }) → { rows, version }` — the rectangle contract every grid shares (AG Grid startRow/endRow, regular-table y0/y1, Glide's block cache). ONE query per window; sort and filter ride inside `question`, never applied in the grid.
- `cells(rect, { signal }) → CellArray` — for copy; async allowed (Glide's thunk).
- Every answer carries `version`, so a stale window is visible and the commit stamps it (`CommitRecord.data`).

**Memory adapter** = `memoryProvider.evaluate(table, clauses, { mode: 'rows' })` sliced to the window plus the fold summaries; later the same port is what the wasm (DuckDB) and server engines answer with `LIMIT/OFFSET` — one SQL owner, matching the planned view-query port. When the scheduler lands, `rows()` is a Step under its epoch and AbortSignal.

**Renderer (ui package) — `Sheet`**: DOM-virtualized with a ~150-line own virtualizer or TanStack Virtual; role=grid with `aria-rowcount`/`aria-rowindex` from `count()`; APG keys; sticky frozen leading columns (`freezeColumns: number`); one pinned summary row fed from `summary`; header = name, type badge, quality bar, distribution mini-bar, sort/filter icons whose clicks dispatch `select`/`filter`/`describe` commits; status line silent under 2 s per the scheduler plan; Ctrl+C = `cells()` → TSV → `navigator.clipboard.writeText` inside the key gesture. A block cache of 100-row blocks (AG Grid's default) with `maxBlocks` keeps 1M rows at a fixed memory.

**Adapters later** (one file per vendor, in ui): `agGridSource(sheetSource)` returns an `IDatasource` (community infinite model: getRows → `rows()`, successCallback(rows, lastRow)); `glideSource(sheetSource)` returns `{ rows, columns, getCellContent, getCellsForSelection, onVisibleRegionChanged }` over the same block cache; `perspectiveTable(sheetSource)` loads rows into a Perspective `Table` for pivots when the WASM engine axis is chosen. A **conformance test** runs one fixture through the memory adapter and every renderer adapter and asserts identical windows, counts and copy output.

**Data Source tab**: mirror Tableau's page — connections on the left, a 1,000-row preview grid below, fields-as-rows metadata view for bulk rename/hide — but every field on the form is a `SourceDecl` (format / via / at / options / key / absence) written to the def, and every "applied step" (Power Query's list) is already our commit log; profiling defaults to a bounded sample with the honest "based on top N rows — click for entire set" switch. No new law needed: declared ⇒ data; the sheet only reports.

**DIALs** (only where a real choice exists): renderer `dom | canvas` (canvas only after the 90k bench shows DOM failing), block size, profile sample size. Not a dial: the rectangle contract.


FACTS
[
 {
  "fact": "AG Grid renders only visible rows/columns (DOM virtualization), keeps a 10-row buffer via rowBuffer, no column buffer, and caps rendered rows at 500 unless suppressMaxRenderedRowRestriction is set.",
  "source": "https://www.ag-grid.com/react-data-grid/dom-virtualisation/"
 },
 {
  "fact": "AG Grid row models: client-side and infinite are community; server-side and viewport are enterprise; client-side handles 100k+ rows rendering ~40.",
  "source": "https://www.ag-grid.com/react-data-grid/row-models/"
 },
 {
  "fact": "AG Grid Infinite Row Model datasource: getRows({startRow,endRow,sortModel,filterModel,successCallback(rows,lastRow),failCallback}); cacheBlockSize default 100; maxConcurrentDatasourceRequests default 2; no grouping, no client-side sort/filter, no select-all.",
  "source": "https://www.ag-grid.com/react-data-grid/infinite-scrolling/"
 },
 {
  "fact": "AG Grid Server-Side Row Model datasource: IServerSideDatasource.getRows(params) with params.request, params.success({rowData}), params.fail(), optional destroy(); cacheBlockSize default 100.",
  "source": "https://www.ag-grid.com/react-data-grid/server-side-model-datasource/ ; https://www.ag-grid.com/react-data-grid/server-side-model-api-reference/"
 },
 {
  "fact": "AG Grid Community is MIT; Enterprise is $999 per developer per year; enterprise-only: row grouping, pivoting, tree data, set filters, range selection, clipboard, column/context menus, sparklines, Excel export, server-side row model features.",
  "source": "https://www.ag-grid.com/license-pricing/"
 },
 {
  "fact": "AG Grid clipboard copy of ranges/rows is enterprise; community only offers enableCellTextSelection for browser text selection.",
  "source": "https://www.ag-grid.com/react-data-grid/clipboard/"
 },
 {
  "fact": "AG Grid pinnedTopRowData / pinnedBottomRowData are community features; pinned rows stay fixed while the body scrolls; typical use is grand totals.",
  "source": "https://www.ag-grid.com/react-data-grid/row-pinning/"
 },
 {
  "fact": "AG Grid uses role=grid/treegrid, row, columnheader, gridcell, aria-rowcount/colcount, aria-rowindex/colindex, aria-sort; it admits screen readers assume all rows are loaded and offers ensureDomOrder, suppressRowVirtualisation, or pagination; server-side model cannot announce row counts reliably.",
  "source": "https://www.ag-grid.com/react-data-grid/accessibility/"
 },
 {
  "fact": "AG Grid default header has sort indicator, filter icon, column menu, tooltips, and supports fully custom header components.",
  "source": "https://www.ag-grid.com/react-data-grid/column-headers/"
 },
 {
  "fact": "Glide Data Grid is MIT, canvas-rendered, claims millions of rows via lazy cells; required props columns, getCellContent, rows; peer deps lodash, marked, react-responsive-carousel; React 16\u201319.",
  "source": "https://github.com/glideapps/glide-data-grid ; https://docs.grid.glideapps.com/"
 },
 {
  "fact": "Glide DataEditor: getCellContent(cell: Item) => GridCell; getCellsForSelection?: true | (selection: Rectangle) => CellArray | GetCellsThunk (async), without which copy does not work; onPaste(target, values) => boolean; onCellsEdited batch; freezeColumns: number; onVisibleRegionChanged(range, tx, ty, extras); onHeaderMenuClick(col, screenPosition); rowMarkers; keybindings include Ctrl+A, Shift+Space row, Ctrl+Space column, Ctrl+C/V.",
  "source": "https://docs.grid.glideapps.com/api/dataeditor.md ; https://github.com/glideapps/glide-data-grid/blob/main/packages/core/API.md"
 },
 {
  "fact": "Glide's API documentation contains no accessibility statement; an experimental disableAccessibilityTree flag exists.",
  "source": "https://docs.grid.glideapps.com/api/dataeditor.md"
 },
 {
  "fact": "Perspective is Apache-2.0, a C++ streaming query engine compiled to WebAssembly with a memory64 build for in-browser datasets over 4 GB; API has group_by, split_by, aggregates, filter, sort, ExprTK expressions; viewer element has a virtual-scrolling grid and WebGL charts; now under perspective-dev and OpenJS Foundation.",
  "source": "https://github.com/finos/perspective"
 },
 {
  "fact": "regular-table (FINOS graduated, Apache-2.0, zero deps) renders a sticky HTML table in a scroll box; data model is setDataListener((x0,y0,x1,y1) => {num_rows, num_columns, data, row_headers?, column_headers?, metadata?}).",
  "source": "https://github.com/finos/regular-table"
 },
 {
  "fact": "TanStack Table is MIT, headless, features sorting/filtering/grouping/selection/visibility/ordering/expansion, described as virtualizable and server-side friendly; TanStack Virtual is MIT with useVirtualizer({count, getScrollElement, estimateSize, overscan}), getVirtualItems(), getTotalSize(), measureElement, both axes.",
  "source": "https://github.com/TanStack/table ; https://raw.githubusercontent.com/TanStack/table/main/LICENSE ; https://tanstack.com/virtual/latest/docs/introduction ; https://raw.githubusercontent.com/TanStack/virtual/main/LICENSE"
 },
 {
  "fact": "Handsontable is DOM-rendered with viewportRowRenderingOffset/viewportColumnRenderingOffset; advises fixed colWidths/rowHeights, avoiding the cells callback, batching, pagination for thousands of rows.",
  "source": "https://handsontable.com/docs/javascript-data-grid/performance/"
 },
 {
  "fact": "Handsontable's last permissive (MIT) version was 6.2.2 (Dec 19, 2018); later versions are proprietary: free non-commercial only, commercial license required for commercial production; pricing via sales.",
  "source": "https://handsontable.com/docs/javascript-data-grid/software-license/"
 },
 {
  "fact": "Univer is Apache-2.0, canvas-rendered, plugin-first spreadsheet/doc/slides framework with a Facade API; Pro (paid) covers collaboration, import/export, printing, charts, pivot tables, sparklines.",
  "source": "https://github.com/dream-num/univer"
 },
 {
  "fact": "react-data-grid is MIT, DOM/CSS-Grid virtualized, no external dependencies, requires React 19.2+, supports frozen columns at start and end, top/bottom summary rows, copy/paste, drag-fill, keyboard navigation, ARIA treegrid.",
  "source": "https://github.com/adazzle/react-data-grid ; https://raw.githubusercontent.com/adazzle/react-data-grid/main/LICENSE"
 },
 {
  "fact": "WAI-ARIA APG grid pattern: roles grid/row/columnheader/rowheader/gridcell; arrows, Home/End, Ctrl+Home/End, PageUp/Down, Shift+arrows, Ctrl+Space column, Shift+Space row, Ctrl+A; Enter/F2 edit, Escape exit; aria-rowcount/colcount and aria-rowindex/colindex for virtualized grids; aria-sort, aria-selected, aria-readonly.",
  "source": "https://www.w3.org/WAI/ARIA/apg/patterns/grid/"
 },
 {
  "fact": "navigator.clipboard.writeText requires a secure context and transient user activation; readText additionally may prompt for permission; the copy/paste events with clipboardData remain the legacy path.",
  "source": "https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API"
 },
 {
  "fact": "Power Query profiling shows Column quality (valid/error/empty/unknown bars with percentages under the header), Column distribution (frequency bars, distinct vs unique on hover), Column profile pane (statistics + value distribution with right-click filter/group); default is the first 1,000 rows with a status-bar switch to the entire data set.",
  "source": "https://learn.microsoft.com/en-us/power-query/data-profiling-tools"
 },
 {
  "fact": "Power Query editor has a Queries pane, a data preview view, Applied steps recording every transform, and a status bar showing execution time, rows/columns and processing status.",
  "source": "https://learn.microsoft.com/en-us/power-query/power-query-ui"
 },
 {
  "fact": "Tableau's Data Source page has a left pane (connections, tables), a canvas (logical relationships, physical joins/unions), a data grid showing the first 1,000 rows with sort/hide/rename/aliases, and a metadata grid listing fields as rows.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/environment_datasource_page.htm"
 },
 {
  "fact": "Power BI Table view shows post-load rows with per-column sort/filter icons, a formula bar, a fields list, and right-click copy of cell/column/table (Ctrl+C); hidden if all sources are DirectQuery.",
  "source": "https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-view"
 },
 {
  "fact": "vizfootprint's data layer already has foldOnce recorders rowCount/total/extent/distinct/groupCount/numbers/columnar/columnTypes/keyedIndex, an absence vocabulary per table, SourceAdapter/SourceHandle with declared capabilities and typed refusals, and a version stamped on every commit.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/src/data/README.md ; /Users/sanjay/github/footprintjs/vizfootprint/src/source/README.md ; /Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts"
 },
 {
  "fact": "Observable's data table cell documentation could not be fetched (HTTP 429), and the perspective-viewer-datagrid package page returned 404.",
  "source": "https://observablehq.com/documentation/cells/data-table-cell ; https://github.com/perspective-dev/perspective/tree/master/packages/perspective-viewer-datagrid"
 }
]

LESSONS
- The port's data contract is a rectangle: rows(question, {start,end}) plus count(question), because AG Grid (startRow/endRow), regular-table (x0,y0,x1,y1) and Glide (getCellContent over a block cache) all reduce to it.
- Sort and filter ride inside the request, never inside the grid, matching AG Grid's sortModel/filterModel and vizfootprint's one-query-per-gesture law.
- Every answer from the port carries the data version so the sheet and its commits can say which bytes a window was true of (CommitRecord.data already stamps this).
- Column-header summaries (type badge, quality bar, distribution bars) come from ONE foldOnce walk stamped with the version, mirroring Power Query's quality/distribution bars without a second pass.
- Default profiling to a bounded sample with a visible 'based on top N rows — use the entire set' switch, as Power Query does, and route the full walk through the scheduler's status line.
- Declare capabilities (sort, filter, edit, live, countKnown) at open and turn each false one into a typed refusal, the same law SourceCapabilities already uses.
- A 100-row block cache with a maximum block count (AG Grid's defaults) keeps 1M rows at fixed memory in the sheet.
- Copy is cells(rect) to TSV via navigator.clipboard.writeText inside the Ctrl+C gesture (secure context + user activation required) and is recorded as a describe commit.
- Ship the first-party renderer as DOM-virtualized with APG roles and aria-rowcount/aria-rowindex; make canvas a renderer dial only if the 90k bench shows DOM failing, because canvas forfeits the accessibility tree.
- Frozen leading columns and one pinned summary row are table-stakes (react-data-grid, Glide freezeColumns, AG Grid pinnedBottomRowData) and belong in the first renderer.
- Adapters are thin: agGridSource returns a community IDatasource, glideSource returns {rows, columns, getCellContent, getCellsForSelection}, perspectiveTable loads rows into an Apache-2.0 Table; one conformance fixture asserts identical windows, counts and copy output across them.
- Never adopt Handsontable (proprietary since 6.2.2) and never let the core import any grid; only the ui package may take MIT TanStack Virtual or nothing.
- The Data Source tab mirrors Tableau's page (connections left, 1,000-row preview, fields-as-rows metadata) but every field on it writes a SourceDecl to the def, and Power Query's applied-steps list is already our commit log.