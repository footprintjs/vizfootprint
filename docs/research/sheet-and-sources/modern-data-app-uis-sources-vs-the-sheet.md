# Modern data-app UIs: sources vs the sheet, and how declared transforms are shown

Lens: modern data apps. Layer named throughout: **layer 1 (data)** unless stated. Weave/WeaveJS is your own lineage; nothing below is prior art to it, only neighbours.

## 1. What each product treats as THE UNIT

| Product | Unit | Sources shown as | Computed column declared as | Provenance visible |
|---|---|---|---|---|
| Observable Framework | a **file** (data loader `data.csv.js`) + a **query block** | front-matter `sql: {name: path}` per page | JS/SQL code, not a column | cache newer-than-loader |
| Hex / Deepnote | a **cell** that yields a named dataframe | SQL cell picks a connection | code cell | rename propagates downstream (Hex) |
| Mode | a **query** → Dataset | schema browser (left) | "calculated fields" in Fields tab | Details pane: last run, schedule, dependents |
| Count | a **cell = compiled CTE** | connection | SQL cell | automatic DAG arrows |
| Rill | a **file** (source YAML, model SQL) | file tree | model SQL | right-panel column profile |
| Evidence | a **query** in markdown | `sources/` folder | SQL | query viewer |
| Malloy Composer | a **query** built from a model | model file path | pick dims/measures | generated Malloy code shown |
| Lightdash | a **dbt model** | dbt project sync | YAML meta | lineage (upstream/downstream) |
| Datawrapper | a **step** (4 steps) | Upload step | none | orange-triangle edited cells |
| Flourish | a **column binding** (letter) | Data tab sheet | none | `column_names` preserved |
| RAWGraphs | a **dimension chip** | load step | none | none |
| Airtable / Notion | a **field/property** (column) + views | one table per base | formula field | none |
| Grist | a **column** with one formula | tables | formula column (Python) | `=` indicator |
| Rows / Equals | a **table** fed by an integration/query | integrations pane | spreadsheet formulas | schedule/refresh |
| Quadratic | a **code cell** that spills into the grid | SQL connections | code | cell's origin code stays visible |

## 2. Product notes (what I fetched)

**Observable Framework.** A data loader is a script with a double extension, `data.csv.js`: first extension = output format, second = language; a page calls `FileAttachment("quakes.csv")` and if the file is missing Framework runs `quakes.csv.js`; output is cached in `.observablehq/cache` and stays valid while it is newer than the loader script; loaders run only when referenced (https://gordonsmith.github.io/framework/loaders — mirror; observablehq.com returned 429). Per-page SQL: front matter `sql: {gaia: ./lib/gaia-sample.parquet}` registers a file as a named table; a ```sql block with `id` binds results (an Arrow table) to a variable, hidden unless `display` (https://raw.githubusercontent.com/observablehq/framework/main/docs/sql.md). `Inputs.table` gives fixed headers, lazy row rendering, click-to-sort, checkbox row selection, type-based formatting (numbers right-aligned, dates ISO), `columns/header/format/width` options; no column stats (https://gordonsmith.github.io/framework/inputs/table).

**Hex.** SQL cells return a named variable; "Renaming a result automatically updates all downstream references"; Dataframe mode (full) vs Query mode (1k-row preview, for >100k rows); downstream SQL references an upstream result by its name and Hex inserts the upstream SQL as a CTE (https://learn.hex.tech/docs/explore-data/cells/sql-cells/sql-cells-introduction). Table display: a "Data source" dropdown picks the dataframe; optional datatype icons in headers; per-type filter operators; totals row "calculated over the entire results set, not just what's currently visible"; conditional formatting rules (https://learn.hex.tech/docs/explore-data/cells/visualization-cells/table-display-cells).

**Deepnote.** SQL block → Pandas DataFrame in a named variable; DataFrame SQL uses DuckDB to query dataframes and CSV/Excel files; Query preview mode keeps 100 rows and enables chaining; results show "column descriptors, categorical breakdowns, and numeric summary statistics" (https://deepnote.com/docs/sql-cells). The data table sorts/renames/hides/reorders columns, lists applied filters above the table, shows a "Preview" badge for partial data, and "the manipulations we cover here don't modify underlying data" (https://deepnote.com/docs/data-tables).

**Mode.** SQL editor: schema browser left (tables, column types, 100-row sample), editor centre, results below with Data / Fields (metadata, calculated fields) / Source ("the raw and rendered SQL that was executed at the time of the run") tabs (https://mode.com/help/articles/querying-data/). Datasets are reusable query results; the dataset view has Data, Fields (types, descriptions), Source (SQL), and a Details pane with last-run timestamp, schedules, and which reports depend on it (https://mode.com/help/articles/datasets/).

**Count.** "each cell in Count is one or more compiled CTEs"; referencing another cell's name creates an arrow automatically (automatic DAG); "any given cell contains the SQL for all cells upstream in the DAG" (https://learn.count.co/data-exploration-and-problem-solving/sql-cells). Python cells execute in DAG order, with a `cells` variable holding other cells' results [from search snippets, not fetched: https://learn.count.co/data-exploration-and-problem-solving/python-cells].

**Rill.** Models are SQL files (DuckDB SQL by default) referencing sources and each other; the model UI previews the first 150 rows and a right panel shows total row/column counts, dropped rows/columns, and per-column distinct counts plus numeric min/max/median; `-- @materialize: true` marks a model for materialisation; models feed metrics views then dashboards (https://docs.rilldata.com/developers/build/models/models-101). The source viewer uses virtualised tables rendering only the viewport (https://docs.rilldata.com/notes/0.8). Source YAML syntax and null-% columns: [unverified] (connect page 404).

**Evidence.** `sources/` folder with `connection.yaml` and `.sql` files; queries embedded in markdown; chaining via `${other_query}`; a built-in query viewer (https://github.com/evidence-dev/evidence). Evidence Studio: connections → import tables → schedule sync; "reports query the cached data" (https://docs.evidence.dev/core-concepts/data-sources/).

**Malloy Composer.** Point at Malloy model files; pick dimensions, measures, filters; the app generates the Malloy code and shows it alongside results; runs against BigQuery/Postgres/DuckDB or fully in-browser (WASM) on CSV/Parquet (https://github.com/malloydata/malloy-composer).

**Lightdash.** dbt models become explorable tables; dimensions and metrics come from YAML metadata; models across repos "can reference each other via `ref()` and joins" (https://docs.lightdash.com/references/dbt-projects); "define metrics, dimensions, joins, descriptions, caching, and access rules in one governed layer" (https://github.com/lightdash/lightdash). Exact column-level `meta:` syntax and the lineage panel: [unverified] (metrics page timed out).

**Datawrapper.** Step 2 "Check & describe": types auto-detected with a 10% error tolerance, dates checked first, then numbers, else text; text black/left, numbers blue/right, dates green/centre; type changed per column from a sidebar dropdown (https://www.datawrapper.de/academy/data-column-types). Cell edits by double-click; each edited cell gets a small orange triangle; a "Revert changes" button restores the upload; no computed columns (https://www.datawrapper.de/academy/change-or-correct-data).

**Flourish.** Data tab = a sheet plus a right-hand panel of column bindings; each column has a type icon (number/text/date) the user can click to override; "Auto set columns" binds columns to template roles (https://flourish.studio/blog/announcing-data-typing/). Templates declare bindings in `template.yml` (`key`, `name`, `dataset`, `type`, `column: Data::A`); the dataset passed to the template carries `column_names` preserving the user's headers (https://developers.flourish.studio/sdk/getting-started/working-with-data/).

**RAWGraphs.** Load by paste/upload/URL/SPARQL; JSON needs a chosen nesting level; all processing in-browser (https://www.rawgraphs.io/learning/how-to-load-and-format-your-data-for-rawgraphs). Mapping: dimensions are green draggable chips; each chart variable shows grey icons for accepted types, red asterisk if required; an incompatible drop turns red; Size/Color/Labels get an aggregation dropdown (https://www.rawgraphs.io/learning/how-to-map-the-dimensions-of-your-data-with-the-chart-variables).

**Airtable / Notion.** A view is a lens on one table: filter, sort, group, hide/reorder fields, colour; collaborative/personal/locked views (https://support.airtable.com/docs/getting-started-with-airtable-views). Formula fields: one formula per field computed for every record, read-only, referencing fields by name (`{Regular Price}`) (https://support.airtable.com/docs/formula-field-reference). Notion: properties are columns, multiple views over one database (https://www.notion.com/help/intro-to-databases); a formula property is one formula for all pages, read-only, with a live preview for the current row (https://www.notion.com/help/formulas).

**Grist.** "a single formula applies to a whole column"; `$Quantity * $Unit_Price`; Python; three column behaviours: data columns, formula columns (read-only), trigger formulas (compute only on new record / update); formula columns show an equals-sign indicator (https://support.getgrist.com/formulas/). Types: Text, Numeric, Integer, Toggle, Date, DateTime, Reference, Reference List, Choice, Choice List, Attachment, each with per-column formatting (https://support.getgrist.com/col-types/).

**Rows.** Tables are the unit; integrations pull from APIs, databases, warehouses (https://rows.com/docs). **Quadratic.** Python/JS/SQL/formula cells; output spills into the grid at the cell; multi-row references become DataFrames; "A cell's origin code remains accessible" (https://docs.quadratichq.com/). **Equals.** Connected sources sync into tables in the sheet; formulas on top; scheduled refresh (https://equals.com/ — marketing page; docs.equals.com timed out).

## 3. Ranking: five most relevant to a column-oriented, provenance-first sheet

1. **Grist** — the only product whose unit IS the column: one declared formula per column, three declared column behaviours (data / formula / trigger), and a visible marker distinguishing computed from entered. This is exactly "declare what must be explained" applied to columns (https://support.getgrist.com/formulas/).
2. **Rill** — sources and models are declared files, and the sheet-side UI puts a column profile panel beside a bounded preview (row/column counts, dropped rows, distinct, min/max/median): the same facts your foldOnce recorders already produce (https://docs.rilldata.com/developers/build/models/models-101).
3. **Mode Datasets** — the best provenance pane in the set: Source tab shows the SQL "as executed at the time of the run", Details shows last run, schedule, and dependents. That is your `Overview.sources {version, retrievedAt}` plus a reverse-dependency list (https://mode.com/help/articles/datasets/, https://mode.com/help/articles/querying-data/).
4. **Count** — lineage derived from references, not drawn by hand; every cell is a CTE and "contains the SQL for all cells upstream" — a why() that reaches back through stages (https://learn.count.co/data-exploration-and-problem-solving/sql-cells).
5. **Datawrapper** — a declared, tolerant type rule (90%), type shown by colour/alignment in the header, per-column override, and edited cells marked with a triangle plus Revert: cheap, honest edit-provenance in a two-tab flow (https://www.datawrapper.de/academy/data-column-types, https://www.datawrapper.de/academy/change-or-correct-data).

Runners-up: Observable (loader-as-file with a version = cache-newer-than-loader; per-page `sql:` table declarations), Flourish (bindings by column letter with `column_names` preserved — the chart-layer contract), Hex (totals over the whole set, not the visible rows; rename propagates).

## 4. Verdict on the two-tab ask

Two tabs match the strongest pattern in the field (Datawrapper's steps, Rill's sources→models, Flourish's data tab + bindings). The one thing none of them does, and the sheet should: make the computed column a **declared record** (Grist) whose header stats come from **one fold** (Rill) and whose edits are **commits with a cause** (Datawrapper's triangle, but derived from the log rather than a flag).

FACTS
[
 {
  "fact": "Observable Framework data loader = script with double extension (data.csv.js: output format + language); FileAttachment on a missing file runs the matching loader; output cached in .observablehq/cache and valid while newer than the loader; loaders run only when referenced.",
  "source": "https://gordonsmith.github.io/framework/loaders"
 },
 {
  "fact": "Observable Framework front matter `sql: {gaia: ./lib/gaia-sample.parquet}` registers a file as a named table; ```sql blocks with `id` bind an Arrow table to a variable, hidden unless `display`; Inputs.table renders it.",
  "source": "https://raw.githubusercontent.com/observablehq/framework/main/docs/sql.md"
 },
 {
  "fact": "Inputs.table: fixed headers, lazy row rendering, click-to-sort, checkbox selection, type-based formatting and alignment (numbers right), options columns/header/format/width/rows; no column statistics.",
  "source": "https://gordonsmith.github.io/framework/inputs/table"
 },
 {
  "fact": "Hex SQL cells return a named variable; renaming updates all downstream references; Dataframe mode vs Query mode (1k-row preview); downstream SQL references an upstream result by name and Hex inserts it as a CTE.",
  "source": "https://learn.hex.tech/docs/explore-data/cells/sql-cells/sql-cells-introduction"
 },
 {
  "fact": "Hex Table display: 'Data source' dropdown picks the dataframe; optional datatype icons in headers; per-type filters; totals computed over the entire result set, not the visible rows; conditional formatting rules.",
  "source": "https://learn.hex.tech/docs/explore-data/cells/visualization-cells/table-display-cells"
 },
 {
  "fact": "Deepnote SQL blocks save results to a named Pandas DataFrame; DataFrame SQL via DuckDB queries dataframes and CSV/Excel; Query preview mode keeps 100 rows and allows chaining; results show column descriptors, categorical breakdowns, numeric summary stats.",
  "source": "https://deepnote.com/docs/sql-cells"
 },
 {
  "fact": "Deepnote data table: sort, rename, hide, reorder columns; applied filters listed above the table; 'Preview' badge for partial data; manipulations do not modify underlying data.",
  "source": "https://deepnote.com/docs/data-tables"
 },
 {
  "fact": "Mode SQL editor: schema browser (tables, column types, 100-row sample) left, editor centre, results with Data / Fields (metadata, calculated fields) / Source (raw and rendered SQL as executed at run time) tabs.",
  "source": "https://mode.com/help/articles/querying-data/"
 },
 {
  "fact": "Mode Datasets: reusable query results with Data, Fields (types, descriptions), Source (SQL) tabs and a Details pane showing last run, schedules, and dependent reports; scheduled refresh notifies reports.",
  "source": "https://mode.com/help/articles/datasets/"
 },
 {
  "fact": "Count: each cell is one or more compiled CTEs; referencing another cell creates an automatic DAG arrow; any cell contains the SQL for all upstream cells.",
  "source": "https://learn.count.co/data-exploration-and-problem-solving/sql-cells"
 },
 {
  "fact": "Rill models are SQL files (DuckDB SQL default) referencing sources/models; UI previews first 150 rows and a right panel shows row/column counts, dropped rows/columns, per-column distinct counts and min/max/median; `-- @materialize: true`; models feed metrics views then dashboards.",
  "source": "https://docs.rilldata.com/developers/build/models/models-101"
 },
 {
  "fact": "Rill 0.8 added a source viewer with virtualised preview tables and faster column profiling.",
  "source": "https://docs.rilldata.com/notes/0.8"
 },
 {
  "fact": "Evidence: sources/ folder with connection.yaml + .sql files; SQL embedded in markdown pages; query chaining via ${other_query}; built-in query viewer.",
  "source": "https://github.com/evidence-dev/evidence"
 },
 {
  "fact": "Evidence Studio: create connections, import tables as sources, schedule sync; reports query the cached data.",
  "source": "https://docs.evidence.dev/core-concepts/data-sources/"
 },
 {
  "fact": "Malloy Composer: point at Malloy model files, pick dimensions/measures/filters, the generated Malloy code is shown with results; runs on BigQuery/Postgres/DuckDB or in-browser WASM on CSV/Parquet.",
  "source": "https://github.com/malloydata/malloy-composer"
 },
 {
  "fact": "Lightdash: dbt models become explorable tables with dimensions/metrics from YAML metadata; models across repos can reference each other via ref() and joins.",
  "source": "https://docs.lightdash.com/references/dbt-projects"
 },
 {
  "fact": "Lightdash defines metrics, dimensions, joins, descriptions, caching, and access rules in one governed layer (dbt project or standalone Lightdash YAML).",
  "source": "https://github.com/lightdash/lightdash"
 },
 {
  "fact": "Datawrapper Check & describe: types auto-detected with 10% error tolerance, dates first then numbers else text; text black/left, numbers blue/right, dates green/centre; type overridden per column in the sidebar.",
  "source": "https://www.datawrapper.de/academy/data-column-types"
 },
 {
  "fact": "Datawrapper step 2: cells edited by double-click; edited cells marked with a small orange triangle; 'Revert changes' restores the upload; no computed columns.",
  "source": "https://www.datawrapper.de/academy/change-or-correct-data"
 },
 {
  "fact": "Flourish Data tab: sheet plus right-hand column bindings; each column shows a type icon (number/text/date) the user can click to override; 'Auto set columns' binds columns to template roles.",
  "source": "https://flourish.studio/blog/announcing-data-typing/"
 },
 {
  "fact": "Flourish templates declare bindings in template.yml (key, name, dataset, type, column: Data::A); the dataset handed to the template carries column_names preserving the user's headers.",
  "source": "https://developers.flourish.studio/sdk/getting-started/working-with-data/"
 },
 {
  "fact": "RAWGraphs loads via paste/upload/URL/SPARQL; JSON requires choosing a nesting level; all processing in the browser.",
  "source": "https://www.rawgraphs.io/learning/how-to-load-and-format-your-data-for-rawgraphs"
 },
 {
  "fact": "RAWGraphs mapping: dimensions are draggable green chips; chart variables show accepted-type icons and a red asterisk if required; incompatible drops turn red; Size/Color/Labels get an aggregation dropdown.",
  "source": "https://www.rawgraphs.io/learning/how-to-map-the-dimensions-of-your-data-with-the-chart-variables"
 },
 {
  "fact": "Airtable views: many views per table, each with its own filter/sort/group/hidden fields/colour; collaborative, personal, locked.",
  "source": "https://support.airtable.com/docs/getting-started-with-airtable-views"
 },
 {
  "fact": "Airtable formula fields: one formula per field computed for every record, read-only, referencing fields by name ({Regular Price}).",
  "source": "https://support.airtable.com/docs/formula-field-reference"
 },
 {
  "fact": "Notion: properties are columns; multiple views over one database with independent filters/sorts/grouping.",
  "source": "https://www.notion.com/help/intro-to-databases"
 },
 {
  "fact": "Notion formula property: one formula for all pages, read-only, live preview for the current row in the editor.",
  "source": "https://www.notion.com/help/formulas"
 },
 {
  "fact": "Grist: one formula applies to a whole column ($Quantity * $Unit_Price, Python); data columns vs formula columns (read-only) vs trigger formulas; formula columns show an equals-sign indicator.",
  "source": "https://support.getgrist.com/formulas/"
 },
 {
  "fact": "Grist column types: Text, Numeric, Integer, Toggle, Date, DateTime, Reference, Reference List, Choice, Choice List, Attachment, each with per-column formatting.",
  "source": "https://support.getgrist.com/col-types/"
 },
 {
  "fact": "Rows: tables are the unit; integrations pull data from APIs, databases, warehouses into tables.",
  "source": "https://rows.com/docs"
 },
 {
  "fact": "Quadratic: Python/JS/SQL/formula cells whose output spills into the grid at the cell; multi-row references become DataFrames; a cell's origin code remains accessible.",
  "source": "https://docs.quadratichq.com/"
 },
 {
  "fact": "Equals: connected sources sync into tables in the sheet with formulas on top and scheduled refresh (marketing page; docs.equals.com timed out).",
  "source": "https://equals.com/"
 }
]

LESSONS
- Make the Data Source tab a list of declared records, one per table, each showing format, via, version, retrievedAt, rowCount and any refusal — the file-as-source pattern of Observable loaders and Rill models, with Mode's Details pane as the display shape (https://gordonsmith.github.io/framework/loaders, https://mode.com/help/articles/datasets/).
- A computed column is one declared formula per column, never per cell, and it is read-only in the sheet (Grist, Airtable, Notion formulas: https://support.getgrist.com/formulas/, https://support.airtable.com/docs/formula-field-reference).
- Give every column a declared KIND — source, derived, or materialised — and show it in the header, as Grist shows an equals-sign on formula columns; this is what makes materialisedLost explainable (https://support.getgrist.com/formulas/).
- Put the foldOnce recorder outputs (rowCount, distinct, extent, columnTypes) in the column header or a side profile panel, as Rill's model panel does with row/column counts, dropped rows, distinct and min/max/median (https://docs.rilldata.com/developers/build/models/models-101).
- Header stats must come from the engine's one query over the whole table, not from the rendered slice — Hex computes totals over the entire result set, not the visible rows (https://learn.hex.tech/docs/explore-data/cells/visualization-cells/table-display-cells).
- Show the TypeTally rule and its tolerance in the UI and let a per-column override be a declared act (a reencode/describe commit), as Datawrapper shows its 90% rule and a sidebar type dropdown (https://www.datawrapper.de/academy/data-column-types).
- Mark a cell or column whose value differs from the source with a derived marker and a revert path — Datawrapper's orange triangle and 'Revert changes' — but derive the marker from the commit log rather than a flag (https://www.datawrapper.de/academy/change-or-correct-data).
- Derived columns reference source columns by name and why() draws the lineage edges from those references at declaration time, the way Count builds its DAG from cell references and Hex propagates renames downstream (https://learn.count.co/data-exploration-and-problem-solving/sql-cells, https://learn.hex.tech/docs/explore-data/cells/sql-cells/sql-cells-introduction).
- Show the sheet as a bounded preview with a visible 'preview' badge while stats and counts stay full — Deepnote's Preview badge, Hex's 1k-row Query mode, Rill's 150-row preview (https://deepnote.com/docs/data-tables, https://docs.rilldata.com/developers/build/models/models-101).
- Treat filters, sorts and hidden columns on the sheet as views (select/filter/reencode commits) that never mutate the declared table, as Airtable and Notion views and Deepnote's non-mutating table do (https://support.airtable.com/docs/getting-started-with-airtable-views, https://deepnote.com/docs/data-tables).
- Let the chart layer bind to sheet columns by declared name and carry the original header along, as Flourish's template.yml bindings and column_names do, so renames and derived columns flow to layer 3 without re-mapping (https://developers.flourish.studio/sdk/getting-started/working-with-data/).
- Keep two tabs and make the sheet the second step of a visible spine, because the strongest products in the set (Datawrapper's four steps, Rill's sources → models, Flourish's Data tab + bindings) all separate 'where it came from' from 'what it looks like' (https://www.datawrapper.de/academy/data-column-types, https://flourish.studio/blog/announcing-data-typing/).
- Show a per-table Source panel that reproduces the declaration exactly as it was when the version was fetched, as Mode's Source tab shows the SQL 'as executed at the time of the run' (https://mode.com/help/articles/querying-data/).
- Record which sheet columns and charts depend on each declared source so refresh and deltaByKey can say who is affected, the reverse-dependency list Mode's Details pane shows (https://mode.com/help/articles/datasets/).