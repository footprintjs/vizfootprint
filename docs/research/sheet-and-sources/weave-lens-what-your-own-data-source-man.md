## Weave lens — what your own Data Source Manager teaches the 2026 data-computation layer

Everything below was read from the two repositories (Weave `master`, WeaveJS `develop` — the WeaveJS README says the TS core lives in `WeaveTeam/WeaveJS/WeaveTSJS`, the app in `WeaveApp`; https://raw.githubusercontent.com/WeaveTeam/WeaveJS/master/README.md) and from the local study (/Users/sanjay/github/footprintjs/vizfootprint/docs/research/weave-study.md). Paths are cited as `Weave:` (github.com/WeaveTeam/Weave, master) or `WeaveJS:` (github.com/WeaveTeam/WeaveJS, develop).

### 1. The spine: a column is a reference, resolved lazily

Weave never stores columns in a chart. It stores a **column reference** = (which data source, which metadata object). The interface is two methods: `getDataSource()` and `getColumnMetadata()` (`Weave: WeaveAPI/src/weave/api/data/IColumnReference.as`; `WeaveJS: WeaveTSJS/src/weavejs/api/data/IColumnReference.ts`). The runtime object that holds one is `ReferencedColumn`, whose session state is exactly two declared fields — `dataSourceName` (a string) and `metadata` (an object) — and whose `getInternalColumn()` re-resolves only when its trigger counter changed, through `AttributeColumnCache.getColumn(dataSource, metadata)` (`WeaveJS: WeaveTSJS/src/weavejs/data/column/ReferencedColumn.ts` lines 76–81, 133–145). The cache keys on the data source plus `Weave.stringify(metadata)` and evicts on dispose (`WeaveJS: WeaveTSJS/src/weavejs/data/AttributeColumnCache.ts` lines 42–69). If the named source does not exist the reference falls back to `GlobalColumnDataSource` (the "Equations / Generated columns" pseudo-source) instead of crashing (`ReferencedColumn.ts` 63–65; `WeaveTSJS/src/weavejs/data/hierarchy/GlobalColumnDataSource.ts` 72–77).

A data source is likewise tiny: `hierarchyRefresh`, `getHierarchyRoot()`, `findHierarchyNode(metadata)`, `getAttributeColumn(metadata)` (`Weave: WeaveAPI/src/weave/api/data/IDataSource.as`); WeaveJS adds `isLocal` and `getLabel()` (`WeaveJS: WeaveTSJS/src/weavejs/api/data/IDataSource.ts`). `AbstractDataSource` hands back a `ProxyColumn` immediately, marks it pending until the source initialises, then calls the per-source `requestColumnFromSource` (`WeaveJS: WeaveTSJS/src/weavejs/data/source/AbstractDataSource.ts` 178–212). A column that cannot be loaded is `ProxyColumn.dataUnavailable(message)`, which sets the column's *title* to "(Data unavailable: …)" (`WeaveTSJS/src/weavejs/data/column/ProxyColumn.ts` 140–158) — the failure is visible, but it is a string, not a typed reason.

"Everything is a column" extends to transforms: `GroupedDataTransform` *is* a data source with declared `groupByColumn`, `dataColumns`, `aggregationModes` and its own hierarchy root (`WeaveJS: WeaveTSJS/src/weavejs/data/source/GroupedDataTransform.ts` 40–125), so a chart bound to a transform sees an ordinary column.

### 2. The attribute hierarchy (the tree)

A tree node is five methods: `equals`, `getLabel`, `isBranch`, `hasChildBranches`, `getChildren` (`Weave: WeaveAPI/src/weave/api/data/IWeaveTreeNode.as`). `ColumnTreeNode` carries `dataSource`, `data` (the metadata), and `idFields` — the fields that define identity, so equality is a partial comparison and `findPathToNode` can locate a saved reference after a refresh (`WeaveJS: WeaveTSJS/src/weavejs/data/hierarchy/ColumnTreeNode.ts` 63–170). `WeaveRootDataTreeNode` is the "Data Sources" root: one branch per connected source plus the generated-columns branch (`WeaveTSJS/src/weavejs/data/hierarchy/WeaveRootDataTreeNode.ts` 31–50). Bulk operations walk this tree: `getAllColumnReferenceDescendants(source)` (`WeaveTSJS/src/weavejs/data/hierarchy/HierarchyUtils.ts` 87–103).

### 3. What the CSV source declared

`CSVDataSource` session state: `csvData` (rows inline), `url` (a file), `delimiter`, `keyType`, `keyColumn`/`keyColName`, `metadata` (per-column overrides), `label` (`WeaveJS: WeaveTSJS/src/weavejs/data/source/CSVDataSource.ts` 79–103; `Weave: WeaveData/src/weave/data/DataSources/CSVDataSource.as` 71–123). When a url is loaded, `csvData` is cleared and vice versa (CSVDataSource.ts 157–161). Column metadata is generated per id: `{title, keyType, dataType, csvColumnIndex|csvColumn}` plus overrides (329–348). The data type is guessed when the column is first requested — numbers, then dates, else strings — and cached (565–596; the rule is `DataSourceUtils.guessDataType`, `WeaveTSJS/src/weavejs/data/DataSourceUtils.ts` 38–49). Keys are `(keyType, localName)`, with `keysAreUnique` exposed for the editor's warning (229).

### 4. How the Data Source Manager UI worked

**Weave (Flex).** A draggable panel "Manage data sources" split left/right (`Weave: WeaveUI/src/weave/editors/managers/DataSourceManager.mxml`). Left: a "New data source..." menu button fed by `DataMenu.getDynamicItems`, a "Select a data source:" list; each row has a busy spinner and a per-row menu — *Edit session state*, *Refresh* (or *Restore this data source* for a `CachedDataSource`), *Delete* (lines 28–80). Refresh was `hierarchyRefresh.triggerCallbacks()` plus, per the code comment, a "TEMPORARY SOLUTION … force creating a new copy" of the source (57–65). Right: two tabs. **Browse** = a hierarchy explorer, a "Create a visualization..." menu that takes up to 10 selected columns and seeds a new tool (240–286), and a two-column *key | value* grid for the selected column with "Selected column has N records" / "Loading data..." (112–166). **Configure** = the source's editor, a "Refresh hierarchy after apply" checkbox, *Apply changes* / *Cancel*, and a "Discard unsaved changes?" confirm; pending changes are detected by diffing the editor against session state (294–297, 432–441). Adding a source is a separate "Add new data source" panel that instantiates the editor class registered for the type and calls `createDataSource()` (`WeaveUI/src/weave/editors/managers/AddDataSourcePanel.mxml` 68–116; the contract is `Weave: WeaveAPI/src/weave/api/ui/IDataSourceEditor.as`). The CSV editor's fields: Source Name*, Source URL + *Open file*, tabs **Table** (an *editable* grid of the rows) | **Text**, Delimiter combobox, *Append file*, *Edit metadata*, Key Column (prompt "auto-generated"), Key Type*, "* = required"; the name is locked after creation (`WeaveUI/src/weave/editors/CSVDataSourceEditor.mxml` 52–101, 206–216).

**WeaveJS (React).** Left sidebar "Connected data sources": each row shows a file icon ("Does not use remote resources.") or a globe ("Uses remote resources.") from `isLocal`, the label, a refresh icon and a delete icon; below it "Add more data sources" lists every registered source type with an editor (beta ones flagged) (`WeaveJS: WeaveApp/src/weaveapp/editor/manager/DataSourceManager.tsx` 130–146, 228–261; registry in `WeaveApp/src/weaveapp/menu/DataMenu.tsx` 92–133). With no source selected the right pane is a drop zone — "Drag and drop a data file to create a datasource", accepting `.csv,.geojson,.json,.txt,.tsv,.xls,.shp,.dbf`, with a "File Import Error" log for rejected files (184–222). With a source selected, `DataSourceEditor` renders **Configure** (a two-column label/field table) above **Preview**: a folder tree of the hierarchy on the left (`hideLeaves`) and a real `TableTool` on the right showing the selected branch's columns with the key column on (`WeaveApp/src/weaveapp/editor/DataSourceEditor.tsx` 134–166, 212–227, 269–277). The CSV editor's Configure fields: Location (a file selector with an extension warning), Label, Key column (combobox, "Auto-generated keys" first, red "not unique" warning), Key namespace ("used to link tables using matching key columns"), and an "Edit Column Metadata..." popup (`WeaveApp/src/weaveapp/editor/CSVDataSourceEditor.tsx` 109–184).

**Attribute Selector.** The one generic picker for ~40 tools. Flex: a "Parameter to modify:" toggle bar over the tool's selectable-attribute names, a hierarchy explorer, *Select all* / *Add selected*, and a column list (`Weave: WeaveUI/src/weave/ui/AttributeSelectorPanel.mxml` 27–47, 201–246). React: a button bar, a `HierarchyExplorer` that is a two-pane file browser (folders left with `hideLeaves`, columns right with `hideBranches`), click sets a single column via `setColumnReference`, double-click / *Add Selected* appends `ReferencedColumn`s to a hash map (`WeaveJS: WeaveApp/src/weaveapp/ui/AttributeSelector.tsx` 124–175, 218–250; `WeaveApp/src/weaveapp/ui/HierarchyExplorer.tsx` 78–114).

**The sheet (TableTool).** Declared state: `columns` (a hash map of column references), `sortFieldIndex`, `sortInDescendingOrder`, widths/heights, `panelTitle`; the row set is `filteredKeySet` bound by path to `defaultSubsetKeyFilter`, selection and hover bound to `defaultSelectionKeySet` / `defaultProbeKeySet` (`WeaveJS: WeaveApp/src/weaveapp/tool/TableTool.tsx` 67–102). A row is a key; a cell is `column.getValueFromKey(key, String)` (287–297); "Show Key Column" adds a `KeyColumn` (114–134). Export CSV walks every `ReferencedColumn` in the session and filters by the subset (`DataMenu.tsx` 170–188).

### 5. Declared vs code — and what was missing

Declared (session state, hence undo/save/share): every source field above, every column reference, transform settings, table columns/sort/widths, and even which key sets a table binds to. Code: parsing, type guessing, hierarchy generation, the resolution cache, `CachedDataSource` freezing (a remote source becomes `{type, state}`; `WeaveTSJS/src/weavejs/data/source/CachedDataSource.ts` 36–49; serialised as `[dataSourceName, metadataHash, metadata, keys, data]`, `AttributeColumnCache.ts` 104–155).

Not declared anywhere: *when* rows were read, *what version* they were, *why* a refresh changed anything (refresh = rebuild a copy, no delta), or a typed reason for failure (`dataUnavailable` is a title string; `url.error` goes to `console.error`, CSVDataSource.ts 115–116). The study's headline finding is the same gap one level up: `KeySet` computed `keysAdded/keysRemoved` and discarded them at persistence (weave-study.md, "The headline symmetry"). vizfootprint already closes exactly these: `SourceSnapshot {rows, version, retrievedAt}`, the closed `SOURCE_REFUSALS` vocabulary, `deltaByKey`, and a version stamp on every commit (/Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts lines 59–115; src/source/README.md "A row key, a conditional read…").

### 6. What a 2026 rebuild should keep (layer 1 — data, and the tab-1/tab-2 UI)

1. **Column references as the spine**: `{table, column}` (+ a declared `key`) stored in the def and in every commit, resolved lazily against the current source version; never a copied array. Add a `columnMetadata`-style open object (title, dataType, keyType, aggregation, dateFormat — `WeaveTSJS/src/weavejs/api/data/ColumnMetadata.ts` 25–37) so a reference survives a reordered CSV.
2. **A hierarchy with path-finding**: a "Data Sources" root → source → table → column tree with `idFields`-style partial identity, so a saved reference is found again after refresh.
3. **Two-pane layout, both generations**: source list on the left with local/remote badge, per-row refresh and delete; on the right Configure above Preview, Preview = a real sheet component, not a screenshot of one.
4. **Empty state = drop zone**; **key column + key namespace as first-class fields** with a uniqueness warning; **"Auto-generated keys"** as the explicit default; the key namespace is how tables link.
5. **Generic attribute picker** driven by each chart's declared slots (a two-method interface), never per-chart pickers.
6. **Transforms are sources** (group-by/aggregate appears in the tree like a file does) — this is exactly the planned view-query port's `groupBy/reduce`, so make the Data Source tab list a *derived* table beside raw ones.
7. **Cached/frozen sources** with a "Restore" action — your commit log's version stamp gives this for free if the sheet can pin a table to a version.
8. **Time-sliced column loading with a progress fraction** (`ColumnDataTask.iterate(stopTime)`, `WeaveTSJS/src/weavejs/data/column/ColumnDataTask.ts` 64–99) — the scheduler seam, unchanged in principle.

What changes: every field on tab 1 is a `SourceDecl` (format/via/at/options/key/grain/absence) and every edit is a commit with a cause; the Preview shows `version` and `retrievedAt`; refresh shows the delta; failures render as the typed refusal (not a title string); type detection is the one `TypeTally` rule rather than first-request guessing; and DuckDB is one engine adapter behind the same tree, not a different tab. The editable inline grid from the Flex CSV editor (Table tab) is the honest precedent for tab 2 being *editable* for inline tables while declared-source tables stay read-only.

[unverified] I did not run either codebase; the Weave wiki/user docs were not fetched (a search returned only third-party summaries), so UI descriptions come from the component source, not screenshots.

FACTS
[
 {
  "fact": "A Weave column reference is two methods, getDataSource() and getColumnMetadata(); a column is identified by (data source, metadata object), not by index.",
  "source": "https://github.com/WeaveTeam/Weave/blob/master/WeaveAPI/src/weave/api/data/IColumnReference.as; https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/api/data/IColumnReference.ts"
 },
 {
  "fact": "ReferencedColumn's session state is dataSourceName (LinkableString) + metadata (LinkableVariable); it re-resolves lazily only when its triggerCounter changed, via AttributeColumnCache.getColumn.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/column/ReferencedColumn.ts (lines 76-81, 133-145)"
 },
 {
  "fact": "AttributeColumnCache keys resolved columns by data source + Weave.stringify(metadata) and evicts on dispose; convertToCachedDataSources serialises non-local sources as [dataSourceName, metadataHash, metadata, keys, data].",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/AttributeColumnCache.ts (lines 42-69, 104-155)"
 },
 {
  "fact": "IDataSource is four members: hierarchyRefresh, getHierarchyRoot(), findHierarchyNode(metadata), getAttributeColumn(metadata); WeaveJS adds isLocal and getLabel().",
  "source": "https://github.com/WeaveTeam/Weave/blob/master/WeaveAPI/src/weave/api/data/IDataSource.as; https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/api/data/IDataSource.ts"
 },
 {
  "fact": "AbstractDataSource returns a ProxyColumn immediately, keeps it pending until initialize, then calls requestColumnFromSource; ProxyColumn.dataUnavailable(message) reports failure by overriding the column title with '(Data unavailable: \u2026)'.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/source/AbstractDataSource.ts (178-212); https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/column/ProxyColumn.ts (140-158)"
 },
 {
  "fact": "A hierarchy node is equals/getLabel/isBranch/hasChildBranches/getChildren; ColumnTreeNode adds dataSource, data (metadata) and idFields for partial-identity equality and findPathToNode.",
  "source": "https://github.com/WeaveTeam/Weave/blob/master/WeaveAPI/src/weave/api/data/IWeaveTreeNode.as; https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/hierarchy/ColumnTreeNode.ts (63-170)"
 },
 {
  "fact": "WeaveRootDataTreeNode is the 'Data Sources' root: one branch per IDataSource plus a Generated-columns/Equations pseudo-source; ReferencedColumn falls back to that pseudo-source when the named source is missing.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/hierarchy/WeaveRootDataTreeNode.ts (31-50); GlobalColumnDataSource.ts (72-77); ReferencedColumn.ts (63-65)"
 },
 {
  "fact": "CSVDataSource declares csvData, url, delimiter, keyType, keyColumn/keyColName, metadata, label; loading a url clears csvData and vice versa; column data type is guessed at first request (number, then date, else string) and cached.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/source/CSVDataSource.ts (79-103, 157-161, 329-348, 565-596); https://github.com/WeaveTeam/Weave/blob/master/WeaveData/src/weave/data/DataSources/CSVDataSource.as (71-123)"
 },
 {
  "fact": "The Weave AS data source list is: Annotation, CKAN, CSV, Cached, CensusApi/Census, DBF, FRED, GeoJSON, GraphML, HealthIndicators, Socrata, Transposed, WFS, WeaveAnalyst, WeaveDataSource, XLS.",
  "source": "https://github.com/WeaveTeam/Weave/tree/master/WeaveData/src/weave/data/DataSources"
 },
 {
  "fact": "The Flex DataSourceManager panel ('Manage data sources') has a left list with per-row menu (Edit session state / Refresh or Restore / Delete) plus busy indicator, and right tabs Browse (explorer + 'Create a visualization...' for up to 10 columns + key|value preview grid with 'Selected column has N records') and Configure (editor, 'Refresh hierarchy after apply', Apply changes / Cancel, discard confirm).",
  "source": "https://github.com/WeaveTeam/Weave/blob/master/WeaveUI/src/weave/editors/managers/DataSourceManager.mxml (28-80, 104-183, 240-286, 294-297, 432-441)"
 },
 {
  "fact": "Refresh in the Flex manager triggers hierarchyRefresh and then, per the in-code comment, a 'TEMPORARY SOLUTION' that force-creates a new copy of the source (requestObjectCopy); there is no delta.",
  "source": "https://github.com/WeaveTeam/Weave/blob/master/WeaveUI/src/weave/editors/managers/DataSourceManager.mxml (55-66); WeaveJS DataSourceManager.tsx (91-104)"
 },
 {
  "fact": "AddDataSourcePanel instantiates the editor class registered for the chosen source type and calls IDataSourceEditor.createDataSource(); the CSV editor fields are Source Name*, Source URL + Open file, tabs Table (editable grid) | Text, Delimiter, Append file, Edit metadata, Key Column (auto-generated prompt), Key Type*; the name is locked after creation.",
  "source": "https://github.com/WeaveTeam/Weave/blob/master/WeaveUI/src/weave/editors/managers/AddDataSourcePanel.mxml (68-116); WeaveAPI/src/weave/api/ui/IDataSourceEditor.as; WeaveUI/src/weave/editors/CSVDataSourceEditor.mxml (52-101, 206-216)"
 },
 {
  "fact": "The WeaveJS DataSourceManager sidebar lists 'Connected data sources' with a file/globe icon from isLocal, refresh and delete icons, then 'Add more data sources' from a type\u2192editor registry; the empty state is a drop zone accepting .csv,.geojson,.json,.txt,.tsv,.xls,.shp,.dbf with a 'File Import Error' log.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveApp/src/weaveapp/editor/manager/DataSourceManager.tsx (130-146, 184-222, 228-261); WeaveApp/src/weaveapp/menu/DataMenu.tsx (92-133)"
 },
 {
  "fact": "WeaveJS DataSourceEditor renders Configure (label/field table) above Preview, where Preview is a folder tree (hideLeaves) beside a live TableTool showing the selected branch's columns with the key column on.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveApp/src/weaveapp/editor/DataSourceEditor.tsx (134-166, 212-227, 269-277)"
 },
 {
  "fact": "WeaveJS CSV editor Configure fields: Location (file selector with extension warning), Label, Key column combobox ('Auto-generated keys' first, red not-unique warning), Key namespace ('used to link tables using matching key columns'), 'Edit Column Metadata...' popup.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveApp/src/weaveapp/editor/CSVDataSourceEditor.tsx (109-184)"
 },
 {
  "fact": "The attribute selector is one generic picker over a tool's declared selectable attributes: a button bar of slot names, a two-pane HierarchyExplorer (folders left, columns right), click sets one column via setColumnReference, double-click/Add Selected appends ReferencedColumns to a hash map.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveApp/src/weaveapp/ui/AttributeSelector.tsx (124-175, 218-250); WeaveApp/src/weaveapp/ui/HierarchyExplorer.tsx (78-114); https://github.com/WeaveTeam/Weave/blob/master/WeaveUI/src/weave/ui/AttributeSelectorPanel.mxml (27-47, 201-246)"
 },
 {
  "fact": "TableTool declares columns (hash map of column refs), sortFieldIndex, sortInDescendingOrder, widths, panelTitle; rows are keys from filteredKeySet bound by path to defaultSubsetKeyFilter, selection/probe bound to defaultSelectionKeySet/defaultProbeKeySet; a cell is column.getValueFromKey(key, String); 'Show Key Column' adds a KeyColumn.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveApp/src/weaveapp/tool/TableTool.tsx (67-102, 114-134, 287-297)"
 },
 {
  "fact": "GroupedDataTransform is itself a data source with declared groupByColumn, dataColumns, aggregationModes and its own hierarchy root, so transforms appear in the tree like files.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/source/GroupedDataTransform.ts (40-125)"
 },
 {
  "fact": "CachedDataSource freezes a remote source as {type, state}; WebSocketDataSource is a live source declaring url, keyType, keyProperty, keepLast.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/source/CachedDataSource.ts (36-49); WebSocketDataSource.ts (55-58)"
 },
 {
  "fact": "Column ingestion is a time-sliced task: ColumnDataTask.iterate(stopTime) returns a 0..1 fraction, scheduled at TASK_PRIORITY_HIGH with the label 'Processing N records'.",
  "source": "https://github.com/WeaveTeam/WeaveJS/blob/develop/WeaveTSJS/src/weavejs/data/column/ColumnDataTask.ts (64-99)"
 },
 {
  "fact": "Weave computed keysAdded/keysRemoved on every KeySet mutation and discarded them at the persistence boundary; undo/redo re-diffed full session state \u2014 the gap vizfootprint's commit log closes by construction.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/docs/research/weave-study.md ('The headline symmetry', \u00a71, \u00a72)"
 },
 {
  "fact": "vizfootprint already declares SourceSnapshot {rows, version, retrievedAt}, a closed SOURCE_REFUSALS vocabulary, deltaByKey on refresh, and a data-version stamp on every commit.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts (59-115); /Users/sanjay/github/footprintjs/vizfootprint/src/source/README.md"
 }
]

LESSONS
- Store a column as a reference {table, column} plus open metadata (title, dataType, keyType, aggregation, dateFormat), resolved lazily against the current source version — never a copied array (IColumnReference / ReferencedColumn / ColumnMetadata).
- Give every table a declared key column and a key namespace, offer 'Auto-generated keys' as the explicit default, and warn in the editor when the key is not unique (CSVDataSourceEditor.tsx keysAreUnique).
- Model the Data Source tab as a tree: Data Sources → source → table → column, where a node carries idFields so a saved reference can be found again after a refresh (ColumnTreeNode.findPathToNode).
- Lay out tab 1 as Weave did in both generations: a source list on the left with a local/remote badge and per-row refresh and delete, and Configure above Preview on the right, where Preview is the real sheet component.
- Make the empty state of tab 1 a drop zone with a closed list of accepted extensions and a typed 'File Import Error' rather than a silent no-op (DataSourceManager.tsx Dropzone).
- List derived tables (group-by / reduce from the view-query port) in the same tree as raw sources, because a transform that is a source composes with every chart for free (GroupedDataTransform extends AbstractDataSource).
- Show provenance in the Preview — version, retrievedAt, row count — and render a refresh as a delta by the declared key, since Weave's refresh was 'force a new copy' with no delta (DataSourceManager.mxml TEMPORARY SOLUTION comment).
- Surface a failed column as a typed refusal from SOURCE_REFUSALS in the cell and the tree, not as a '(Data unavailable)' title string (ProxyColumn.dataUnavailable).
- Drive every chart's column picker from its declared slots through one generic attribute selector with a two-pane folder/column browser (AttributeSelector.tsx + HierarchyExplorer.tsx).
- Declare the sheet's own state — columns (as references), sort field and direction, widths, the row-set and selection it binds to — as data so it rides the commit log like Weave's TableTool rode session state.
- Let inline tables be editable in the sheet (the Flex CSV editor's editable Table tab) while declared-source tables stay read-only with a version pin and a Restore action (CachedDataSource).
- Load and type columns in time-sliced steps that return a 0..1 fraction so the Preview can show 'Processing N records' — the same contract as the planned scheduler seam (ColumnDataTask.iterate).
- Type columns by the one TypeTally rule at ingest rather than Weave's guess-at-first-request, so the type a caption quotes is the type the engine ran (DataSourceUtils.guessDataType vs cachedDataTypes).