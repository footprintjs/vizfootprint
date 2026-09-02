# Excel / Google Sheets lens: what a column-first Data Source + Sheet should borrow, and what it must refuse

Layers named: everything below is **Layer 1 (data)** and **Layer 2 (smart / computation)**; the why() and staleness points touch **Layer 5 (agent)** only where noted.

## 1. Excel is already three products stacked, and the user's two tabs map onto the seam between them

**Power Query ("Get & Transform") is the Data Source tab Excel already has.** It has four phases — connect, transform, combine, load — and its editor keeps an *Applied Steps* pane that "keeps track of everything you do with the data by recording and labelling each transformation, or step"; every step can be edited or removed later (https://support.microsoft.com/en-us/office/about-power-query-in-excel-7104fbee-9e62-4cb9-a02e-5bfb1a6c536a). A query is loaded to a table, a PivotTable, the Data Model, or kept as "connection only"; the same page notes queries refresh to pick up external changes and that the M language is exposed in an Advanced Editor (same URL).

The **Queries & Connections pane** is the concrete UI of a source list: hovering a query shows a peek with "row count, last refresh date, location, and load status" (or "Connection Only"); the context menu offers Edit, Delete, Rename, Refresh, Load To, Duplicate ("with the same name ... appended by (2)"), Reference ("a new query that uses the steps of a previous query"), Merge/Append, Move to Group, Properties; the list is sorted by last-modified (https://support.microsoft.com/en-us/office/manage-queries-power-query-76f93a6d-37d9-46b5-bc40-d5f2162401f5). That peek is nearly one-for-one with vizfootprint's `Overview.sources {version, retrievedAt, rowCount}` (/Users/sanjay/github/footprintjs/vizfootprint/src/source/README.md).

**Tables are the closest Excel gets to a declared column.** An Excel Table has a header row with filtering, banded rows, a total row, structured references, and calculated columns where a formula "is instantly applied to all other cells in that table column" (https://support.microsoft.com/en-us/office/overview-of-excel-tables-7ab0bb7d-3a9e-4b56-a3c9-6c94334e492c). Structured references are `Table[Column]` with `[#Headers] [#Data] [#Totals] [#All]` and `[@]` for "just the cells in the same row as the formula"; renaming a column updates every reference (https://support.microsoft.com/en-us/office/using-structured-references-with-excel-tables-f5ed2452-2337-4f71-bed3-c8ae6d2b276e). A calculated column fills the whole column "above as well as below the cell where you entered the formula" and extends to new rows; editing one cell pops an AutoCorrect button with "Overwrite all cells in this column" or "Undo Calculated Column" (https://support.microsoft.com/en-us/office/use-calculated-columns-in-an-excel-table-873fbac6-7110-4300-8f6f-aafa2ea11ce8). When one cell differs, Excel flags an "inconsistent calculated column formula" and offers "Restore to Calculated Column Formula" or "Ignore Error" (https://support.microsoft.com/en-US/Excel/inconsistent-calculated-column-formula). **This is the trap in miniature: Excel lets a column be a declaration and then lets any one cell silently un-declare it.** A column-first library should not have an "Ignore Error" — a column is a formula or it is data, never a mixture.

**The Data Model (Power Pivot) is where Excel already separates two kinds of computed thing.** A workbook holds "only one Data Model"; tables relate by a primary key one-to-many; rows cannot be typed in (https://support.microsoft.com/en-us/office/create-a-data-model-in-excel-87e7a54c-87dc-488e-9410-5c75dbcb0f7b). A *calculated column* has its DAX formula "automatically applied to the entire column", is computed per row when entered and recomputed "when the underlying data is refreshed", and is stored in the model; it costs more because "the result for a calculated column is always calculated for each row ... whereas a measure is only calculated for the cells that are used" (https://support.microsoft.com/en-us/office/calculated-columns-in-power-pivot-a0eb7167-33fc-4ade-a23f-fb9217c193af). A *measure* is a named aggregation whose result "always change[s] in response to selections on rows, columns, and filters"; explicit measures are reusable across pivots, implicit ones are auto-generated per dragged field (https://support.microsoft.com/en-gb/office/measures-in-power-pivot-86484821-a324-4da3-803b-82fd2e5033f4). This column-vs-measure split is exactly the split the planned view-query port needs: `columns` (per-row, materialised, refreshed) vs `groupBy + reduce` (per-selection, computed at query time).

## 2. The cell-level tools, and which ones survive when the unit is a column

- **Show Formulas** (Ctrl+`) swaps every cell's result for its formula so you can "easily find cells that contain formulas or check for errors"; Excel for the web cannot do it (https://support.microsoft.com/en-us/excel/show-and-print-formulas). In a column sheet this becomes a *header* affordance: the column header shows its declaration; there is nothing per-cell to show.
- **Trace Precedents / Dependents** draws arrows ("Blue arrows show cells with no errors. Red arrows show cells that cause errors"), one level per click, black arrow to a sheet icon for cross-sheet, and cannot trace PivotTables, named constants, or closed workbooks (https://support.microsoft.com/en-us/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507). This is Excel's why(), and its blind spots are instructive: anything computed outside the formula grid is invisible. vizfootprint's why() already reaches sources and commits; the ruling that the memory engine's execution is a footprintjs flowchart (ruling 12, from the brief) means a column's precedents can reach *stages*, which Excel's arrows never can.
- **Dynamic arrays / spill**: the formula lives only in the top-left cell, other cells show it "ghosted", `#` references the whole spill, a blocked range gives `#SPILL!`, and "Spilled array formulas are not supported in Excel tables themselves" (https://support.microsoft.com/en-us/excel/dynamic-array-formulas-and-spilled-array-behavior). Spill is Excel admitting that a result is a *column*, then fighting its own Table object over it. A column-first sheet has no spill problem: every declared column *is* a spill range with a name.
- **LAMBDA**: `=LAMBDA([p1, ...,] calculation)`, up to 253 parameters, tested in a cell first, then named in Name Manager so it is "available throughout the workbook"; errors `#VALUE!`/`#CALC!`/`#NUM!` for arity, uncalled lambda, and runaway recursion (https://support.microsoft.com/en-us/excel/functions/lambda-function). The lesson is the *naming* step, not the lambda: a computation becomes a reusable, explainable thing only once it has a name in a registry.
- **Linked Data Types** turn a cell into "a connection to an online data source", expose fields as `=A2.Population`, offer an Insert Data button to extract fields as new columns, refresh per type or via Refresh All, and show a "Powered by" attribution on the card (https://support.microsoft.com/en-us/office/excel-data-types-stocks-and-geography-61a33056-9935-484f-8ac8-f1a89e210877). This is a *record* type with provenance — the closest Excel affordance to vizfootprint's per-table `SourceInfo` and to the GeoJSON `as: 'one-row'` table (src/source/README.md).

## 3. Google Sheets: the column-first design that already ships

**Connected Sheets** is the most direct precedent for "Data Source tab + Sheet". The connection is read-only ("You can't change BigQuery data from within Google Sheets") and refreshes manually or on a schedule (https://support.google.com/docs/answer/9702507). From a connected sheet you make an *Extract* of "up to 500k rows or 10MB", a pivot of "up to 100k results", charts, and *calculated columns* that apply "a calculation to all rows" using column names; column stats sit under the header dropdown; the data source lives "at the bottom" of the spreadsheet; scheduled refresh runs as the schedule's creator and pauses if others edit the source (https://support.google.com/docs/answer/9703214?hl=en). Note the shape: **the sheet's cells are never the source of truth; every artefact (extract, pivot, calculated column) is a declared query over the source with a visible limit and a refresh button.** That is the user's two-tab model, already accepted by spreadsheet users.

**=QUERY()** is Sheets' in-cell view-query: `QUERY(data, query, [headers])`, columns named `A` or `Col1`, a column's type decided by the majority of its values (https://support.google.com/docs/answer/3093343). Its language fixes clause order "select, where, group by, pivot, order by, limit, offset, label, format, options", has exactly five aggregates (avg, count, max, min, sum), and requires that "every column listed in the select clause must either be listed in the group by clause, or be wrapped by an aggregation function" (https://developers.google.com/chart/interactive/docs/querylanguage). The planned view-query port {table, filter[], columns, limit, groupBy, reduce count|sum|min|max|mean} is a near-subset of this grammar — a conformance test can be written by translating each port query to QUERY syntax and comparing on the same rows.

## 4. What the research says

Hermans, Pinzger and van Deursen treat spreadsheets as software and adapt Fowler's smells: inter-worksheet smells Inappropriate Intimacy, Feature Envy, Middle Man, Shotgun Surgery, visualised as dataflow diagrams and evaluated on real industrial spreadsheets (https://www.aau.at/wp-content/uploads/2019/11/Hermans2012-worksheetsmells.pdf). Their formula-level smells are Multiple Operations, Multiple References, Conditional Complexity, Long Calculation Chain, Duplicated Formulas, shown on a risk map; users found Multiple References and Duplicated Formulas most relevant, and smells "correlate with defect-prone cells" (https://www.aau.at/wp-content/uploads/2019/11/Hermans2012-formulasmells.pdf). Observation: **Duplicated Formulas cannot exist in a column-first sheet** (one declaration per column), and Long Calculation Chain becomes a *visible* chain of declared columns rather than a hidden one — the smell turns into a lint the library can compute from declarations alone.

Panko's taxonomy splits errors into mechanical, logic and omission, with a lifecycle and a culpability dimension; the 2008 revision admits "the omission category ... has proven to be too narrow" (https://arxiv.org/abs/0809.3613). Powell, Baker and Lawson's review reports Panko's cell error rates of roughly 1–5% and that 88–94% of audited spreadsheets contain at least one error, and that inspection catches only a fraction (http://mba.tuck.dartmouth.edu/spreadsheet/product_pubs_files/literature.pdf). Their later study found "errors in 0.8% to 1.8% of all formula cells" and that many have no quantitative impact while some "have substantial impacts on key aspects" (https://arxiv.org/abs/0801.0715). The point for a column library: per-cell error rates are the disease of the *cell* as unit; a column declaration has one place to be wrong, and vizfootprint's absence vocabulary already types the omission class Panko found too narrow (src/def/encoding.def.test.ts).

## 5. Column-oriented: what is gained and what is lost

Gained: one declaration per column (no inconsistent-cell flag, no duplicated formulas); why() at the column/header level with no per-cell arrows; measures vs columns as a first-class split; refresh semantics attach to the source, not to cells; limits are declared (Extract 500k, pivot 100k) rather than discovered as `#SPILL!`.

Lost, and Excel users will notice: (a) **the scratch cell** — typing a one-off number next to the data; Power Pivot already forbids typing rows (Data Model page above) and users accept it *inside the Data tab* but not in "the sheet"; (b) **row-local exceptions** — Excel's "Ignore Error" path; refuse it, but give a declared alternative (an annotate verb on a row key, which the session log already has); (c) **spill-anywhere** — the ability to drop a formula result into any free rectangle; the replacement is "add a column" or "add a measure", and the UI must make that one click.

## 6. Carry-over vs traps (for a library whose unit is a declared column)

Carry over: Applied Steps as a visible, editable ordered list of steps; the Queries pane peek (rows, last refreshed, load status, errors); "Reference" = a new table that reuses another's steps; "connection only" as a state; structured references by name; calculated columns that extend to new rows; measure vs column; LAMBDA's name-then-reuse; Data Types' "Powered by" attribution; Connected Sheets' bottom-of-sheet data-source chip with a Refresh button and visible limits; QUERY's group-by rule.

Traps: per-cell formulas and per-cell exceptions; `#SPILL!` and the Table-vs-spill conflict; implicit measures (auto-generated aggregations with no declaration — "declare what must be explained" forbids them); Trace Precedents that stop at pivots and closed workbooks (why() must not stop at the engine boundary); refresh that silently replaces (Excel) rather than reporting a delta — vizfootprint's `deltaByKey` and `materialisedLost` are already stronger (src/source/README.md); type-by-majority in QUERY versus vizfootprint's one TypeTally rule (from the brief).

## 7. How Excel users expect the two tabs to behave

**Data tab** (they have seen Get Data / Queries & Connections / Connected Sheets): a list of named sources; each row shows kind, where it points, row count, last refreshed, status/error; actions Refresh, Edit steps, Duplicate, Reference, Load-to, Properties; a preview grid of the first N rows; a place for the row key and relationships (Data Model diagram). They expect editing here to be *declaring*, not typing values.

**Sheet tab**: a grid with a filterable header row, column-typed, banded; typing a formula once fills the column; a totals/measure row; column stats in the header menu; a way to see the formula of a column (Show Formulas) and its precedents (Trace); a Refresh chip at the bottom when the sheet is backed by a source (Connected Sheets). They will try to type into a cell within thirty seconds — the refusal must be a sentence with a next action ("this column is computed by …; add a column or annotate row 12"), never a silent no-op.

[unverified] Exact current Connected Sheets preview row count was not stated on the fetched pages; only the extract (500k / 10MB) and pivot (100k) limits were.

FACTS
[
 {
  "fact": "Power Query has four phases (connect, transform, combine, load) and an Applied Steps pane that records and labels each transformation step, which can be modified or removed.",
  "source": "https://support.microsoft.com/en-us/office/about-power-query-in-excel-7104fbee-9e62-4cb9-a02e-5bfb1a6c536a"
 },
 {
  "fact": "A query loads to a table, a PivotTable, the Data Model, or stays connection-only; custom transforms are written in M in the Advanced Editor.",
  "source": "https://support.microsoft.com/en-us/office/about-power-query-in-excel-7104fbee-9e62-4cb9-a02e-5bfb1a6c536a"
 },
 {
  "fact": "The Queries & Connections peek shows row count, last refresh date, location, and load status (or 'Connection Only'); context menu offers Edit, Delete, Rename, Refresh, Load To, Duplicate, Reference, Merge/Append, Move to Group, Properties; list sorted by last modified.",
  "source": "https://support.microsoft.com/en-us/office/manage-queries-power-query-76f93a6d-37d9-46b5-bc40-d5f2162401f5"
 },
 {
  "fact": "An Excel Table adds a filterable header row, banded rows, a total row, structured references, and calculated columns where one formula is instantly applied to the whole column.",
  "source": "https://support.microsoft.com/en-us/office/overview-of-excel-tables-7ab0bb7d-3a9e-4b56-a3c9-6c94334e492c"
 },
 {
  "fact": "Structured references use Table[Column] plus [#Headers] [#Data] [#Totals] [#All] and [@] for the same row; renaming a column updates all references automatically.",
  "source": "https://support.microsoft.com/en-us/office/using-structured-references-with-excel-tables-f5ed2452-2337-4f71-bed3-c8ae6d2b276e"
 },
 {
  "fact": "A calculated column fills all cells above and below the entered formula, extends to new rows, and edits offer 'Overwrite all cells in this column' or 'Undo Calculated Column'.",
  "source": "https://support.microsoft.com/en-us/office/use-calculated-columns-in-an-excel-table-873fbac6-7110-4300-8f6f-aafa2ea11ce8"
 },
 {
  "fact": "When one cell differs from its column formula Excel shows an inconsistent-formula indicator with 'Restore to Calculated Column Formula' or 'Ignore Error'.",
  "source": "https://support.microsoft.com/en-US/Excel/inconsistent-calculated-column-formula"
 },
 {
  "fact": "A workbook holds only one Data Model; tables relate one-to-many by primary key; rows cannot be typed into Power Pivot.",
  "source": "https://support.microsoft.com/en-us/office/create-a-data-model-in-excel-87e7a54c-87dc-488e-9410-5c75dbcb0f7b"
 },
 {
  "fact": "A Power Pivot calculated column is computed for every row when entered and on refresh and stored in the model; a measure is calculated only for the cells used in the PivotTable.",
  "source": "https://support.microsoft.com/en-us/office/calculated-columns-in-power-pivot-a0eb7167-33fc-4ade-a23f-fb9217c193af"
 },
 {
  "fact": "Measures live in the VALUES area and change with row/column/filter selections; implicit measures are auto-generated when a field is dragged, explicit ones are authored and reusable.",
  "source": "https://support.microsoft.com/en-gb/office/measures-in-power-pivot-86484821-a324-4da3-803b-82fd2e5033f4"
 },
 {
  "fact": "Show Formulas (Ctrl+`) displays formulas instead of results in every cell; Excel for the web only shows the formula in the formula bar.",
  "source": "https://support.microsoft.com/en-us/excel/show-and-print-formulas"
 },
 {
  "fact": "Trace Precedents/Dependents draw blue (ok) and red (error) arrows one level per click; they cannot trace PivotTables, named constants, or formulas in closed workbooks.",
  "source": "https://support.microsoft.com/en-us/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507"
 },
 {
  "fact": "A dynamic-array formula lives only in the top-left cell (others 'ghosted'), # references the spill range, blockage gives #SPILL!, and spilled array formulas are not supported inside Excel tables.",
  "source": "https://support.microsoft.com/en-us/excel/dynamic-array-formulas-and-spilled-array-behavior"
 },
 {
  "fact": "LAMBDA takes up to 253 parameters, is tested in a cell then named in Name Manager to become workbook-wide; errors are #VALUE!, #CALC!, #NUM!.",
  "source": "https://support.microsoft.com/en-us/excel/functions/lambda-function"
 },
 {
  "fact": "Linked Data Types make a cell a connection to an online source, expose fields as =A2.Population, extract fields as columns via Insert Data, refresh per type or Refresh All, and show a 'Powered by' attribution.",
  "source": "https://support.microsoft.com/en-us/office/excel-data-types-stocks-and-geography-61a33056-9935-484f-8ac8-f1a89e210877"
 },
 {
  "fact": "Connected Sheets is read-only toward BigQuery and refreshes manually or on a schedule.",
  "source": "https://support.google.com/docs/answer/9702507"
 },
 {
  "fact": "Connected Sheets extracts are limited to 500k rows or 10MB, pivots to 100k results; calculated columns apply a calculation to all rows by column name; column stats sit in the header menu; the data source appears at the bottom of the sheet; scheduled refresh runs as its creator and pauses if others edit the source.",
  "source": "https://support.google.com/docs/answer/9703214?hl=en"
 },
 {
  "fact": "QUERY(data, query, [headers]) names columns A/B or Col1, and a mixed column's type is decided by the majority of its values.",
  "source": "https://support.google.com/docs/answer/3093343"
 },
 {
  "fact": "The Visualization query language fixes clause order select/where/group by/pivot/order by/limit/offset/label/format/options, has aggregates avg/count/max/min/sum, and requires every selected column to be grouped or aggregated.",
  "source": "https://developers.google.com/chart/interactive/docs/querylanguage"
 },
 {
  "fact": "Hermans et al. define inter-worksheet smells Inappropriate Intimacy, Feature Envy, Middle Man, Shotgun Surgery and visualise them with dataflow diagrams on industrial spreadsheets.",
  "source": "https://www.aau.at/wp-content/uploads/2019/11/Hermans2012-worksheetsmells.pdf"
 },
 {
  "fact": "Hermans et al. define formula smells Multiple Operations, Multiple References, Conditional Complexity, Long Calculation Chain, Duplicated Formulas; users found Multiple References and Duplicated Formulas most relevant.",
  "source": "https://www.aau.at/wp-content/uploads/2019/11/Hermans2012-formulasmells.pdf"
 },
 {
  "fact": "Panko's taxonomy uses mechanical/logic/omission with lifecycle and culpability dimensions; the 2008 revision says the omission category proved too narrow.",
  "source": "https://arxiv.org/abs/0809.3613"
 },
 {
  "fact": "Reviewed audits report about 1\u20135% of cells in error and 88\u201394% of spreadsheets containing at least one error, with inspection catching only a fraction.",
  "source": "http://mba.tuck.dartmouth.edu/spreadsheet/product_pubs_files/literature.pdf"
 },
 {
  "fact": "Powell, Lawson and Baker found errors in 0.8% to 1.8% of formula cells, many with no quantitative impact but some with substantial impact.",
  "source": "https://arxiv.org/abs/0801.0715"
 },
 {
  "fact": "vizfootprint already exposes per-table SourceInfo (format, via, locator, version, retrievedAt, row count), deltaByKey on refresh, materialisedLost, and typed refusals.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/src/source/README.md"
 }
]

LESSONS
- Model the Data Source tab on the Queries & Connections peek: every source row shows kind, locator, row count, last refreshed, status or typed refusal — vizfootprint's Overview.sources already carries these fields.
- Show a table's steps as an ordered, editable Applied Steps list on the Data Source tab; a derived table is a 'Reference' that reuses another's steps rather than a copy.
- Make 'connection only' (declared, not loaded) a first-class source state so a source can exist before any sheet reads it.
- A declared column is one formula for all rows that extends to new rows; never offer Excel's per-cell 'Ignore Error' exception — a cell edit is refused with a sentence naming 'add a column' or 'annotate this row'.
- Split computed things into per-row columns (materialised, refreshed with the source) and measures (named aggregations evaluated per selection), mirroring Power Pivot's calculated column vs measure and the port's columns vs groupBy+reduce.
- Forbid implicit measures: a dragged field must not silently become a SUM; the aggregation is declared data because someone will ask why.
- Show Formulas becomes a header-level toggle that reveals each column's declaration; there is nothing per cell to show.
- why() for a column must not stop where Trace Precedents stops (pivots, closed workbooks): with ruling 12 it should reach the engine's stages and the source version.
- Every declared column is a named spill range, so the sheet has no #SPILL! and no Table-vs-spill conflict; new results are added as columns or measures, one click each.
- Borrow LAMBDA's name-then-reuse step: a computation becomes explainable only once it has a name in a registry the Data Source tab lists.
- Put a Connected-Sheets-style chip at the bottom of the Sheet when it is source-backed: source name, version, last refreshed, Refresh button, and the declared limits (rows/cells) in plain words.
- Declare limits as data (like extract 500k rows / pivot 100k results) and refuse over-limit queries with a typed reason instead of truncating silently.
- Use the QUERY language's rule — every selected column is grouped or aggregated — as the validation rule and a conformance test for the view-query port.
- Decide a column's type by one stated rule (TypeTally) and show it in the header; do not copy QUERY's silent majority vote.
- Turn Hermans's Long Calculation Chain and Multiple References smells into lintData() checks computed from column declarations, since Duplicated Formulas cannot occur when a column is declared once.
- Keep the omission class typed: the absence vocabulary already names what Panko found too narrow, so a blank is never an unlabeled hole.