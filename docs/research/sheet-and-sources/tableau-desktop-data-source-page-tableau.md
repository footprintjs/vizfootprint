# Tableau Desktop Data Source page + Tableau Prep as prior art for "Data Source | Sheet"

Scope: Tableau's own help pages only, all fetched 2026-09-02. Where a page did not say something, I say so. Layer names refer to the user's six-layer canon (1 data … 6 story); Tableau's Data Source page sits almost entirely in layer 1 with a thin slice of layer 2.

## 1. The Data Source page — what the analyst sees

Tableau's own summary: the page "generally consists of four main areas: left pane, canvas, data grid, and metadata or semantics grid" (https://help.tableau.com/current/pro/desktop/en-us/environment_datasource_page.htm).

- **Left pane (connections).** "The left pane of the data source page shows details about your data" — for files the filename and worksheets, for databases server, schema, tables; it is also where a second connection is added for cross-database joins (same URL). This is the "declare where the data lives" column; nothing is computed there.
- **Canvas.** Opens on the *logical* layer; "Double-click a table in the logical layer to go to the physical layer, where you add joins and unions between tables" (same URL). Logical tables are drawn as boxes; relationships "are displayed as flexible noodles between logical tables" while joins use Venn diagrams (https://help.tableau.com/current/pro/desktop/en-us/datasource_relationships_learnmorepage.htm).
- **Data grid.** "The data grid shows the first 1,000 rows of the data contained in the Tableau data source" and "allows for semantic modifications … such as sorting or hiding fields, renaming fields, creating calculations, and adding aliases" (environment_datasource_page.htm). So the preview IS the editing surface: column headers carry a drop-down for rename/hide/type/alias/split/pivot.
- **Metadata grid.** "The metadata grid shows the fields in your data source as rows, allowing you to analyze the semantics and carry out tasks like renaming fields or hiding multiple fields" (same URL); it shows the data type, the Tableau field name and the remote (source) field name, and supports rename, hide, type change, geographic role, alias and "reset name" (https://help.tableau.com/current/pro/desktop/en-us/howto_connect.htm). Tableau's own guidance is to use it "if you are working with a particularly large data source … hide multiple fields at once or quickly rename or reset fields" (search summary of howto_connect.htm, https://help.tableau.com/current/pro/desktop/en-us/howto_connect.htm) [wording from search snippet; page fetched confirms tasks].
- **Handoff.** The page is reached "after initial connection, or select the Data Source tab from anywhere in the workbook"; from there "navigate to sheets by selecting appropriate tabs" (environment_datasource_page.htm). There is no explicit "go" button in the doc; the tab strip is the handoff — the same two-tab shape the user asked for.

## 2. Declared vs computed, area by area

**Connections and tables: declared.** File/server/table names are typed by the analyst. Custom SQL is also declared ("The query must be a single SELECT statement") but collapses into ONE box: "the custom SQL query table appears in the logical layer of the canvas" and "Using custom SQL can affect performance of a workbook" because Tableau wraps it in its own SELECT to inject WHERE/GROUP BY (https://help.tableau.com/current/pro/desktop/en-us/customsql.htm).

**Relationships: declared fields, computed joins.** "A relationship describes how two independent, logical tables relate to each other, but does not merge the tables together"; at analysis time "Tableau automatically selects what join types should be used based on the current fields in use in the viz" (https://help.tableau.com/current/pro/desktop/en-us/datasource_datamodel_faq.htm). "Logical tables remain distinct (normalized), not merged in the data source"; physical tables "are merged into a single, flat table that defines the logical table"; "Tableau will aggregate measures before performing joins, avoiding the problem of unnecessary duplication" (https://help.tableau.com/current/pro/desktop/en-us/datasource_datamodel.htm). Tableau "first attempts to create the relationship based on existing key constraints and matching field names" — i.e. the matching fields are *inferred then shown for confirmation* (datasource_relationships_learnmorepage.htm).

**Performance Options: a declared belief with a stated blast radius.** Cardinality "Select Many if the field values aren't unique, or you don't know"; referential integrity "Select Some Records Match if some values in the field don't have a match". Defaults when Tableau cannot detect: "Cardinality: Many-to-Many" and "Referential integrity: Some Records Match". Wrong choice of One "can result in duplicate aggregate values being shown in the view"; wrong All Records Match "may see inconsistent results … (unmatched values removed or missing in view)" (https://help.tableau.com/current/pro/desktop/en-us/datasource_relationships_perfoptions.htm). This is the clearest example in Tableau of "a declaration that changes answers, not just speed".

**Field types and names: computed, then overridable.** "Tableau uses a collection of commonly used patterns to detect and transform your data" — names containing Code/ID/Key become dimensions, Year/Month/Quarter/Day become date dimensions, underscores are turned into spaces; "Tableau never changes your underlying data"; undo via "Reset name" on the Data Source page (https://help.tableau.com/current/pro/desktop/en-gb/data_clean_adm.htm). Roles/types: Tableau assigns data type and dimension/measure automatically; users convert them (https://help.tableau.com/current/pro/desktop/en-us/datafields_typesandroles.htm). Renames are display-only: "Renaming a field doesn't change the name of the field in the underlying data source, only what appears in Tableau", with a "small circular arrow" to restore (https://help.tableau.com/current/pro/desktop/en-us/datafields_dwfeatures.htm).

**Live vs extract: declared mode.** "A data extract is a subset of information that is saved separately from the original dataset"; created from the top-right "Extract > Edit"; storage as Logical Tables (default; supports extract filters, aggregation, Top N) or Physical Tables; rows: all, sample, or top N; full vs incremental refresh, incremental requiring "All Rows" (https://help.tableau.com/current/pro/desktop/en-us/extracting_data.htm).

**Filters: declared, and ordered by a published pipeline.** Data source filters are added via "Add in the Filters section in the upper-right corner of the page"; they can be pervasive ("carries through to all related tables") or per-table; they are hidden from consumers of a published source (https://help.tableau.com/current/pro/desktop/en-us/filtering_datasource.htm). The order of operations is Extract filters → Data source filters → Context filters → Sets → Dimension filters → Measure filters → Table calculations, and "those filters always execute in the order established by the order of operations" (https://help.tableau.com/current/pro/desktop/en-us/order_of_operations.htm).

**Calculated fields: declared formula, computed values.** Analysis > Create Calculated Field opens the Calculation Editor with a name box, a formula box and a function list ("syntax, a description, and an example … Double-click a function in the list to add it"); after OK, "The new calculated field is added to Data pane as a measure because it returns a number. An equal sign (=) appears next to the data type icon"; editing later re-renders "automatically. You do not need to re-add the updated calculated field" (https://help.tableau.com/current/pro/desktop/en-us/calculations_calculatedfields_create.htm). The editor has "Sheets Affected" to see which sheets use the field (https://help.tableau.com/current/pro/desktop//en-us/calculations_calculatedfields_tips.htm).

**Split and pivot: sugar over calculated fields / a reshape.** "The results of the split are standard calculated fields that can be edited or deleted like any other calculated field"; up to ten new fields depending on connector, SQL Server only four; custom splits are always strings (https://help.tableau.com/current/pro/desktop/en-us/split.htm). Pivot works only on "Microsoft Excel, text file, Google Sheets, and .pdf data sources" and creates "Pivot field names" and "Pivot field values"; removing an original column yields "null values … in the pivot fields" (https://help.tableau.com/current/pro/desktop/en-us/pivot.htm).

**Data Interpreter: a computed guess with a human-readable receipt.** A checkbox ("select the Use Data Interpreter check box"); it detects "titles, notes, footers, empty cells" and sub-tables; the review is an Excel copy with a colour-coded Key tab; unavailable with "more than 2000 columns" or "more than 3000 rows and more than 150 columns"; Excel/CSV/PDF/Google Sheets only (https://help.tableau.com/current/pro/desktop/en-us/data_interpreter.htm).

## 3. Tableau Prep — the flow is a recorded log

Prep has four coordinated areas: Flow pane ("A visual representation of your operation steps"), Profile pane ("A summary of each field in your data sample. See the shape of your data and quickly find outliers and null values"), Data grid ("The row level detail"), and Changes pane (https://help.tableau.com/current/prep/en-us/prep_about.htm). Profile cards bin values: "By default, Tableau Prep groups numerical, date, and date & time values in a field into buckets"; clicking a value highlights "all the related values in the other fields … in blue"; a "Sampled" badge says "this is a subset of your data set" (https://help.tableau.com/current/prep/en-us/prep_explore.htm).

The Changes pane is the closest thing in Tableau to a commit log: "annotations are added to the corresponding step in the Flow pane and an entry is added in the Changes pane to track your actions"; you can "edit or remove your changes, drag changes up or down to change the order in which they're applied and add a description"; in reshaping steps "the order that the change is applied shows either before or after the reshaping action" (https://help.tableau.com/current/prep/en-us/prep_clean.htm). Descriptions per change exist since 2019.1.1 (https://help.tableau.com/current/prep/en-us/prep_build_flow.htm). Note what it lacks: no author, no timestamp, no "why" — an entry records the act, not the cause.

## 4. Provenance: can you ask WHY a field has its values?

Partly. **Describe** on a field shows "data role, data type, domain, aggregation, calculation formula" (https://help.tableau.com/current/pro/desktop/en-us/inspectdata_describe.htm) — so a calculated field's formula is inspectable, and the metadata grid keeps the remote name next to the Tableau name. Neither page documents field-to-field dependencies. That job is pushed up to Tableau Catalog lineage, where selecting a field "filters to show only downstream assets that depend on the field (or column) or upstream inputs"; but "Catalog doesn't support showing column information for tables that it only knows about through custom SQL", cubes show nothing, and "Lineage data for flows won't show if the flow includes parameter values" (https://help.tableau.com/current/online/en-us/dm_lineage.htm). So the moment a declaration becomes code (custom SQL, parameters), provenance dies — a direct confirmation of the user's "declare what must be explained" law.

## 5. What fails at scale

- The Desktop preview is hard-capped at 1,000 rows (environment_datasource_page.htm) — the grid is a window, never the table.
- Prep works on a sample: Automatic loads "equal to or less than 393,216" rows, Specify "less than 1 million", Maximum "equal to or less than 1,048,576"; methods Quick Select (default, "as the rows are returned as quickly as possible"), Random, Stratified; "The number of rows you choose has an effect on performance" (https://help.tableau.com/current/prep/en-us/prep_configure_dastaset.htm). Full data only on run: "When you run the flow, all of your data (not just the data sample you might be working with) is run through your flow steps" (https://help.tableau.com/current/prep/en-us/prep_conductor_run_flow.htm). Consequence: what you saw in the profile may not be what the run produces.
- Data Interpreter refuses beyond 2000 columns or 3000 rows × 150 columns (data_interpreter.htm).
- Relationships are unsupported on cubes, stored procedures, Splunk, JSON, SAP HANA OLAP (datasource_datamodel_faq.htm); pivot only on file connectors (pivot.htm); split count is connector-dependent (split.htm) — capability gaps are documented in prose, not typed.
- Extracts exist precisely because live is slow: "Interacting with views that utilize extract data sources results in better performance" (extracting_data.htm).

## 6. Reading for vizfootprint (layer 1, with layer-2/4 hooks)

Tableau's Data Source page is a good shape to copy: connections left, a table canvas, a capped preview grid that is also the editor, a metadata (columns-as-rows) view, a mode switch, filters in a corner, a tab strip to the sheet. What vizfootprint already has and Tableau lacks: typed refusals (`SOURCE_REFUSALS`, /Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts:107), a version stamp per table, a delta by declared key (/Users/sanjay/github/footprintjs/vizfootprint/src/source/delta.ts:36), and a fold that never post-processes (/Users/sanjay/github/footprintjs/vizfootprint/src/data/fold.ts:33). What Tableau has that the plan should absorb: the Performance Options idea (a declaration that changes answers must say so), the Changes pane as a visible, reorderable log (upgrade it to commits with a cause), the "Sampled" badge and the sample/full distinction, and "reset name" (every inferred value keeps its source value beside it). Your own Weave lineage (data sources declared first, then sheets) is the same two-step; Tableau is the mass-market confirmation, not the origin.

FACTS
[
 {
  "fact": "Tableau's Data Source page has four areas: left pane, canvas, data grid, metadata (semantics) grid; the data grid shows the first 1,000 rows and is the place for rename/hide/sort/alias/calculation edits.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/environment_datasource_page.htm"
 },
 {
  "fact": "The canvas opens on the logical layer; double-clicking a logical table opens the physical layer where joins and unions are added.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/environment_datasource_page.htm"
 },
 {
  "fact": "The metadata grid lists fields as rows with data type, Tableau field name and remote field name; supports rename, hide (many at once), change type, geographic role, alias, reset name.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/howto_connect.htm"
 },
 {
  "fact": "Relationships do not merge tables; join types are chosen automatically at query time based on fields in the viz; measures are aggregated before joins.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/datasource_datamodel.htm and https://help.tableau.com/current/pro/desktop/en-us/datasource_datamodel_faq.htm"
 },
 {
  "fact": "Relationships are drawn as noodles (joins as Venn diagrams); Tableau infers matching fields from key constraints and matching names, then the analyst confirms.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/datasource_relationships_learnmorepage.htm"
 },
 {
  "fact": "Performance Options declare cardinality (One/Many) and referential integrity (Some/All Records Match); defaults are Many-to-Many and Some Records Match; a wrong declaration yields duplicate aggregates or dropped unmatched rows.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/datasource_relationships_perfoptions.htm"
 },
 {
  "fact": "Tableau auto-detects types/roles from name patterns (ID/Code/Key, Year/Month\u2026) and rewrites names (underscores to spaces); it never changes underlying data; 'Reset name' undoes it.",
  "source": "https://help.tableau.com/current/pro/desktop/en-gb/data_clean_adm.htm"
 },
 {
  "fact": "Renaming a field changes only what appears in Tableau, with a circular-arrow control to restore the source name; fields can be hidden and shown via 'Show Hidden Fields'.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/datafields_dwfeatures.htm"
 },
 {
  "fact": "An extract is a subset saved separately; created from the Extract > Edit control on the Data Source page; storage Logical Tables (default) or Physical Tables; rows all/sample/top N; full or incremental refresh (incremental needs All Rows).",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/extracting_data.htm"
 },
 {
  "fact": "Data source filters are added via 'Add' in the Filters section top-right; pervasive or per-table; hidden from consumers of a published source.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/filtering_datasource.htm"
 },
 {
  "fact": "Order of operations: Extract filters \u2192 Data source filters \u2192 Context filters \u2192 Sets \u2192 Dimension filters \u2192 Measure filters \u2192 Table calculations; filters always execute in that order.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/order_of_operations.htm"
 },
 {
  "fact": "Calculated field dialog = name, formula box, function list with syntax/description/example; the field appears in the Data pane with an '=' beside its type icon; edits propagate automatically.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/calculations_calculatedfields_create.htm"
 },
 {
  "fact": "The calculation editor offers 'Sheets Affected' to show which sheets use the field; fields can be dragged from the Data pane into the editor.",
  "source": "https://help.tableau.com/current/pro/desktop//en-us/calculations_calculatedfields_tips.htm"
 },
 {
  "fact": "Split results are standard calculated fields; up to ten new fields depending on connector, SQL Server four; custom splits are always strings.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/split.htm"
 },
 {
  "fact": "Pivot (columns to rows) works only on Excel, text, Google Sheets, PDF; creates 'Pivot field names' and 'Pivot field values'; removing an original column yields nulls in the pivot fields.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/pivot.htm"
 },
 {
  "fact": "Data Interpreter is a checkbox; detects titles/notes/footers/empty cells and sub-tables; review is an Excel copy with a colour Key; unavailable over 2000 columns or over 3000 rows with over 150 columns; Excel/CSV/PDF/Google Sheets only.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/data_interpreter.htm"
 },
 {
  "fact": "Custom SQL must be a single SELECT, appears as one logical table, and can slow workbooks because Tableau wraps it in its own SELECT; parameters can replace only literal values.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/customsql.htm"
 },
 {
  "fact": "Describe on a field shows data role, data type, domain, aggregation and calculation formula; Describe Sheet shows workbook, data source, fields and layout; neither page documents field dependencies.",
  "source": "https://help.tableau.com/current/pro/desktop/en-us/inspectdata_describe.htm"
 },
 {
  "fact": "Tableau Catalog lineage filters upstream/downstream by field; it cannot show columns known only through custom SQL, shows nothing for cubes, and shows no flow lineage when the flow has parameter values.",
  "source": "https://help.tableau.com/current/online/en-us/dm_lineage.htm"
 },
 {
  "fact": "Tableau Prep has Flow pane, Profile pane (per-field summary over the sample), Data grid (row detail) and Changes pane.",
  "source": "https://help.tableau.com/current/prep/en-us/prep_about.htm"
 },
 {
  "fact": "Prep bins numeric/date values into buckets in profile cards; clicking a value highlights related values in blue across fields; a 'Sampled' badge marks a subset.",
  "source": "https://help.tableau.com/current/prep/en-us/prep_explore.htm"
 },
 {
  "fact": "Every cleaning act adds an annotation on the flow step and an entry in the Changes pane; entries can be edited, removed, reordered by drag, and given a description; in reshaping steps the entry shows whether it applies before or after the reshape.",
  "source": "https://help.tableau.com/current/prep/en-us/prep_clean.htm"
 },
 {
  "fact": "Prep samples input data: Automatic \u2264 393,216 rows, Specify < 1,000,000, Maximum \u2264 1,048,576; methods Quick Select (default), Random, Stratified; row count affects performance.",
  "source": "https://help.tableau.com/current/prep/en-us/prep_configure_dastaset.htm"
 },
 {
  "fact": "Running a flow pushes all data, not the sample, through the steps.",
  "source": "https://help.tableau.com/current/prep/en-us/prep_conductor_run_flow.htm"
 },
 {
  "fact": "vizfootprint already has a closed refusal vocabulary, a per-table version, deltaByKey and a single-pass fold with TypeTally.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts:107, /Users/sanjay/github/footprintjs/vizfootprint/src/source/delta.ts:36, /Users/sanjay/github/footprintjs/vizfootprint/src/data/fold.ts:33 and :156, /Users/sanjay/github/footprintjs/vizfootprint/src/source/README.md"
 }
]

LESSONS
- Copy Tableau's four-area layout for the Data Source tab (connections left, table canvas, capped preview grid that is also the editor, columns-as-rows metadata view) and keep the sheet handoff a plain tab strip.
- Cap the preview grid at a declared window (Tableau: 1,000 rows) and label it as a window, never as the table, so the Sheet tab never implies it holds all rows.
- Store every inferred column fact (type from TypeTally, display name) beside its source value with a one-click 'reset', as Tableau's 'Reset name' and remote-field-name column do.
- A declaration that changes answers, not just speed (Tableau's cardinality / referential-integrity Performance Options), must be declared data with its default and its failure mode written next to it — a candidate for the declared row key and grain.
- Field renames and aliases are display-layer records over an unchanged source column; keep the source name in the record so why() can reach the original.
- Make the Prep-style Changes pane the visible face of the commit log, but stamp each entry with requestedBy/intent/time — Tableau records the act and not the cause.
- Show a 'Sampled' badge and the sample/full distinction whenever a fold ran over fewer rows than the table holds, since Tableau's own scale answer is sample-while-editing, full-on-run.
- Type capability gaps (which formats support pivot/split, which carriers are live) as refusals in the closed vocabulary, where Tableau documents them as prose per connector.
- Treat free-text escape hatches (custom SQL, parameters) as the point where provenance dies, so the view-query port should stay declarative and refuse a code clause rather than accept one silently.
- Model data-source filters as ordered declared verbs with a published order of operations, matching Tableau's extract → data source → context → dimension → measure pipeline so an analyst can predict which filter ran first.
- Expose the Data Interpreter idea as a computed guess plus a human-readable receipt (Tableau writes an annotated copy with a colour key) rather than a silent header rewrite.
- Split and pivot should be sugar over declared derived columns (Tableau: 'standard calculated fields'), so they are edited, removed and explained by the same path as any formula.
- Give every calculated column a 'used by' view (Tableau's Sheets Affected) derived from the links data, not maintained by hand.