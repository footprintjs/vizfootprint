# Power BI as prior art for a two-tab, column-oriented, provenance-first sheet

Lens: Power BI Desktop's Power Query Editor (Applied Steps, M, dependencies, profiling), its Table and Model views, DAX calculated columns vs measures, incremental refresh, and Import vs DirectQuery. Layer named throughout: this is LAYER 1 (data) and LAYER 2 (smart) work. Where Weave appears, it is the user's own lineage, not external prior art.

## 1. What Power BI actually puts on screen

Power BI Desktop has three views chosen by icons on the left edge: Report, Table ("see the data in your report in data model format, where you can add measures, create new columns"), and Model (relationships) (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-query-overview). The Power Query Editor is a separate window opened with Transform data; it has a ribbon, a Queries pane on the left, a data preview in the centre, and a Query Settings pane on the right listing the query's properties and applied steps (https://learn.microsoft.com/en-us/power-query/power-query-ui, https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-query-overview). A status bar shows execution time, row and column counts, and view toggles (https://learn.microsoft.com/en-us/power-query/power-query-ui).

Table view is explicitly "after it has been loaded into the model", and "the Table view icon isn't visible if all data sources are based on DirectQuery" (https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-view). For DirectQuery tables it shows a message that they can't be shown (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-storage-mode). So Power BI already splits "declare and shape sources" (Power Query) from "look at the loaded sheet" (Table view) — the user's two tabs exist there, but as two windows rather than two tabs of one grid.

## 2. What the Applied Steps log gives an analyst

Every transform is recorded: "Every transformation that is applied to your query is saved as a step in the Applied steps section"; "Selecting any step displays the results of that particular step" (https://learn.microsoft.com/en-us/power-query/power-query-ui, https://learn.microsoft.com/en-us/power-query/applied-steps). Right-clicking a step offers Edit settings, Rename, Delete, Delete until end, Insert step after, Move before/after, Extract previous (split the prefix into a new query), and Properties (name + description) (https://learn.microsoft.com/en-us/power-query/applied-steps). "All query steps are carried out in the order they appear in the Applied Steps pane", and "the underlying data isn't changed" — the editor only shapes a view (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-query-overview).

Underneath, each query is one M `let ... in` expression; the step names in the pane are the M identifiers (quoted as `#"Kept top rows"` when they contain spaces), and renaming a step renames the identifier (https://learn.microsoft.com/en-us/power-query/query-folding-basics). M's evaluation model "is modeled after the evaluation model commonly found in spreadsheets, where the order of calculations can be determined based on dependencies"; let expressions are lazy (https://learn.microsoft.com/en-us/powerquery-m/evaluation-model). Docs describe the M script as "a recipe" (https://learn.microsoft.com/en-us/power-query/query-folding-basics).

This is the closest shipped thing to "every column a declared computation with a commit": a linear, named, replayable log where clicking an entry re-materialises that state. Why-ability is real but shallow: you can see WHAT step produced the table, and (via settings) its parameters, but not which columns it read.

## 3. Where the step log breaks

**Step names are auto-generated and carry no cause.** A rename shows up as "Renamed columns"; "Typically, no description is added when the step is created" (https://learn.microsoft.com/en-us/power-query/applied-steps). Desktop shows only delete, name, description, settings; the step icon and folding indicator exist only Online (same page). The step "label" (its type) is separate from its name and cannot be changed (same page).

**Dependencies are by name, positional, and hidden.** Each step references the previous one by identifier, so deleting or inserting mid-list needs a warning dialog (https://learn.microsoft.com/en-us/power-query/applied-steps). When the source changes shape you get "The column 'Column' of the table wasn't found" — an Expression.Error at step level that blocks the whole load (https://learn.microsoft.com/en-us/power-query/dealing-with-errors). Cross-query dependencies are worse: "When a query references a second query, it's as though the steps in the second query are combined with, and run before, the steps in the first query" — Query1 referenced by three queries "is executed three times" (https://learn.microsoft.com/en-us/power-bi/guidance/power-query-referenced-queries). The Query Dependencies view shows that diagram at QUERY level (illustrated on that page); the richer diagram view with per-step icons, lines for dependencies, and highlight-related-queries "is only available in Power Query Online" (https://learn.microsoft.com/en-us/power-query/diagram-view). Nothing shows COLUMN-level lineage. The Desktop View-tab location of Query Dependencies is [unverified] (search snippet only).

**Stepping back is not a true replay.** On refresh the evaluator runs the final step and then, in the background, "sequentially runs n-1 steps, n-2 steps"; "some caching happens ... it means that you don't always get correct step comparison information because of later evaluations pulling on cached data" (https://learn.microsoft.com/en-us/power-query/query-diagnostics).

**The formula bar / Advanced Editor is the truth; the UI is a projection.** "The Advanced Editor lets you see the code that Power Query Editor is creating with each step" and you can edit it directly (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-query-overview). A step gets a settings dialog only when the engine recognises its shape: an Added custom step "changed its behavior ... to a Multiplication experience because the formula ... only multiplies the values from two columns" (https://learn.microsoft.com/en-us/power-query/add-custom-column). In Desktop the Custom column dialog has no data-type field, so the type must be set as a separate later step (same page).

**Profiling and typing are sampled.** Column quality (Valid/Error/Empty/Unknown/Unexpected error), distribution (distinct vs unique), and profile run "over the first 1,000 rows" unless you click the status-bar message to switch to the entire data set (https://learn.microsoft.com/en-us/power-query/data-profiling-tools). For CSV/Excel, type detection inspects "the first 200 rows" and silently adds two steps, Promote column headers and Changed type; the Any type is what a column has with no explicit definition (https://learn.microsoft.com/en-us/power-query/data-types). Type conversion failures do not stop the load: "A cell-level error doesn't prevent the query from loading, but displays error values as Error in the cell", with Remove/Replace/Keep errors — "Keep errors" is offered as an auditing tool (https://learn.microsoft.com/en-us/power-query/dealing-with-errors).

**Folding (pushdown) is visible only Online, and depends on order.** "A step folds when Power Query translates its transformations into a data source query"; the indicator shows whether "the query as a whole, up to that point, folds"; states are Folding, Not folding, Might fold, Opaque, Unknown; CSV and Excel never fold (https://learn.microsoft.com/en-us/power-query/step-folding-indicators, https://learn.microsoft.com/en-us/power-query/query-folding-basics). The Query plan (Online) draws folded nodes labelled "remote" versus local nodes labelled "Full scan"/"Streaming", and "View details" shows the native SQL (https://learn.microsoft.com/en-us/power-query/query-plan). Desktop's substitute is Query Diagnostics: Diagnose Step, an Id of activity.evaluation, a Data Source Query column, exclusive duration, and a note that many emitted queries only feed profiling or filter dropdowns (https://learn.microsoft.com/en-us/power-query/query-diagnostics).

## 4. The WHERE choice: Import vs DirectQuery, and incremental refresh

Storage mode is a per-table property seen in Model view > Properties > Advanced; "You can change a DirectQuery table to an Import or Dual table. After you set this property, you can't set the mode back to DirectQuery" (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-storage-mode). DirectQuery: "No data is imported at load time. Each visual triggers one or more queries"; any intermediate result over 1,000,000 rows fails; transformations "must condense into a single native query"; calculated columns are limited to row-level foldable expressions; the docs say "Use import by default" (https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-directquery-about).

Incremental refresh is declared, not coded: two reserved parameters RangeStart/RangeEnd, hand-written Table.SelectRows filters (the standard filter UI cannot be used), then a policy (archive N years, refresh N days, optional Detect data changes on an audit column). If the filter does not fold, "the query mashup engine might compensate and apply the filter locally, which requires retrieving all rows ... effectively defeating the purpose", and Desktop shows a warning it cannot verify folding for non-SQL sources (https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview). Once published, the model "can't download ... back" to Desktop (same page).

## 5. DAX calculated columns vs measures: declared where, shown how, computed when

Both are declared in the same formula bar from Report, Table, or Model view (New column / New measure). A calculated column "calculates a result for every row in the table" and is "recalculated ... when the underlying data is refreshed"; in Import mode it is Materialized, in DirectQuery Unmaterialized (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-calculated-columns). It appears in the Fields list "with a special icon showing its values are the result of a formula" (same page). A measure's "calculated results ... change as you interact with your reports"; it shows "with a calculator icon", has a home table, and can be moved into display folders (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-measures). Dropping a numeric field on a visual creates an implicit measure (same page). Row context = "the current row"; filter context = "one or more filters applied in a calculation" (https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-quickstart-learn-dax-basics). Note the split: a Power Query custom column is a STEP with a cause in the log; a DAX calculated column is a MODEL property with no step and no log entry — two declaration surfaces for the same idea, and only one is replayable.

## 6. What the UI shape teaches for the two-tab sheet

The local library already has the pieces Power BI keeps in separate windows: ten typed refusals in `/Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts` (no-adapter ... no-pushdown) and per-table `{version, retrievedAt, rows, materialisedLost}` provenance in `/Users/sanjay/github/footprintjs/vizfootprint/src/def/buildDashboard.ts`. The lessons below say how to arrange them on two tabs so the step log is a real commit log rather than Power BI's positional one.


FACTS
[
 {
  "fact": "Power BI Desktop has three views (Report, Table, Model) chosen by icons on the left; Table view is where you 'add measures, create new columns, and manage relationships'.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-query-overview"
 },
 {
  "fact": "The Power Query Editor has five components: ribbon, Queries pane, current view (data preview), Query settings (name, steps, indicators), and a status bar with execution time, row/column counts, and view toggles.",
  "source": "https://learn.microsoft.com/en-us/power-query/power-query-ui"
 },
 {
  "fact": "Table view shows data 'after it has been loaded into the model' and its icon 'isn't visible if all data sources are based on DirectQuery'.",
  "source": "https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-view"
 },
 {
  "fact": "In Table view, DirectQuery tables display a message that they can't be shown; cached data is shown only for Import or Dual tables.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-storage-mode"
 },
 {
  "fact": "'Every transformation that is applied to your query is saved as a step in the Applied steps section'; selecting a step previews how the query resolves at that point.",
  "source": "https://learn.microsoft.com/en-us/power-query/power-query-ui"
 },
 {
  "fact": "Applied step parts: delete, icon (Online only), auto-assigned name, description (empty by default), settings, folding indicator (Online only); step label/type cannot be changed; menu offers Rename, Delete, Delete until end, Insert step after (with warning), Move before/after, Extract Previous, Properties.",
  "source": "https://learn.microsoft.com/en-us/power-query/applied-steps"
 },
 {
  "fact": "'All query steps are carried out in the order they appear in the Applied Steps pane'; 'the underlying data isn't changed', the editor shapes a view; the Advanced Editor shows and lets you edit the generated M code.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-query-overview"
 },
 {
  "fact": "Each query is one M script; the Applied steps names are M identifiers (quoted as #\"Kept top rows\" when needed); renaming a step renames the identifier; the M script is 'a recipe'; query folding translates supported steps into a data-source query and evaluates the rest in the Power Query engine; CSV and Excel do not fold.",
  "source": "https://learn.microsoft.com/en-us/power-query/query-folding-basics"
 },
 {
  "fact": "M's evaluation model is 'modeled after the evaluation model commonly found in spreadsheets, where the order of calculations can be determined based on dependencies'; let/list/record/table members are lazily evaluated.",
  "source": "https://learn.microsoft.com/en-us/powerquery-m/evaluation-model"
 },
 {
  "fact": "M is a functional, case-sensitive language similar to F#; a let expression names a set of values computed and used after 'in'.",
  "source": "https://learn.microsoft.com/en-us/powerquery-m/expressions-values-and-let-expression"
 },
 {
  "fact": "A referenced query's steps run 'combined with, and run before' each referencing query; Query1 referenced by three queries 'is executed three times'; Table.Buffer does not help across queries.",
  "source": "https://learn.microsoft.com/en-us/power-bi/guidance/power-query-referenced-queries"
 },
 {
  "fact": "Diagram view (Online only) shows queries as boxes, steps as icons with lines for dependencies, highlight related queries, direct/indirect referenced and dependent queries via dongles, step labels vs step names, compact view.",
  "source": "https://learn.microsoft.com/en-us/power-query/diagram-view"
 },
 {
  "fact": "Step-level errors block the whole load and show reason/message/detail (e.g. Expression.Error 'The column ... wasn't found'); cell-level errors do not block the load and show 'Error' in the cell; Remove/Replace/Keep errors exist, Keep errors is 'a good auditing tool'.",
  "source": "https://learn.microsoft.com/en-us/power-query/dealing-with-errors"
 },
 {
  "fact": "Data profiling (column quality: Valid/Error/Empty/Unknown/Unexpected error; distribution: distinct vs unique; profile) runs 'over the first 1,000 rows' by default; the status-bar message switches it to the entire data set.",
  "source": "https://learn.microsoft.com/en-us/power-query/data-profiling-tools"
 },
 {
  "fact": "For unstructured sources, type detection inspects 'the first 200 rows' and automatically adds 'Promote column headers' and 'Changed type' steps; the Any type marks a column with no explicit type; detection can be turned off globally or per file.",
  "source": "https://learn.microsoft.com/en-us/power-query/data-types"
 },
 {
  "fact": "The Custom column dialog has name, M formula, available-columns list, syntax check; it adds an 'Added custom' step; Desktop has no data-type field so the type is a later step; a formula that only multiplies two columns is re-recognised as a 'Multiplication' step experience.",
  "source": "https://learn.microsoft.com/en-us/power-query/add-custom-column"
 },
 {
  "fact": "Folding indicators (Online only) show whether 'the query as a whole, up to that point, folds'; states Folding, Not folding, Might fold, Opaque, Unknown; folding 'depends on both the order of steps and the transformations that apply'.",
  "source": "https://learn.microsoft.com/en-us/power-query/step-folding-indicators"
 },
 {
  "fact": "Query plan (Online only) opens from right-click a step > View Query plan; folded nodes are labelled 'remote', unfolded ones 'Full scan'/'Streaming'; View details shows the native SQL sent.",
  "source": "https://learn.microsoft.com/en-us/power-query/query-plan"
 },
 {
  "fact": "Query Diagnostics (Desktop, Tools tab) offers Diagnose Step and Start/Stop; records Id (activity.evaluation), Query, Step, Data Source Query, exclusive duration; stepping back uses cached results so 'you don't always get correct step comparison information'.",
  "source": "https://learn.microsoft.com/en-us/power-query/query-diagnostics"
 },
 {
  "fact": "Storage mode is a per-table property under Model view > Properties > Advanced; a DirectQuery table can become Import or Dual but 'you can't set the mode back to DirectQuery'; Dual tables share DirectQuery constraints.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-storage-mode"
 },
 {
  "fact": "DirectQuery: 'No data is imported at load time. Each visual triggers one or more queries'; any query returning more than 1,000,000 rows fails; transformations 'must condense into a single native query'; 'Use import by default'; visuals aren't always time-consistent.",
  "source": "https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-directquery-about"
 },
 {
  "fact": "Incremental refresh uses reserved parameters RangeStart/RangeEnd in hand-written filter steps plus a declared policy (archive period, refresh period, optional Detect data changes); if the filter does not fold the engine 'might compensate and apply the filter locally ... effectively defeating the purpose'; Desktop warns when it cannot verify folding; a published model cannot be downloaded back.",
  "source": "https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-overview"
 },
 {
  "fact": "A DAX calculated column 'calculates a result for every row', is recalculated on refresh, appears in the Fields list with a formula icon, is Materialized in Import and Unmaterialized in DirectQuery; it is created from Report, Table, or Model view and differs from a Power Query custom column, which is a query step.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-calculated-columns"
 },
 {
  "fact": "Measures' 'calculated results ... change as you interact with your reports'; they show with a calculator icon, have a home table and display folders; dragging a numeric field creates an implicit measure automatically.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-measures"
 },
 {
  "fact": "Row context is 'the current row'; filter context is 'one or more filters applied in a calculation that determines a result'; the formula bar checkmark validates and enters the measure into the model.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-quickstart-learn-dax-basics"
 },
 {
  "fact": "Model view shows tables, columns and relationships with cardinality and cross-filter arrows; more than 75 tables triggers a slowdown warning and a custom-layout suggestion.",
  "source": "https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-relationship-view"
 },
 {
  "fact": "The local library defines SOURCE_REFUSALS = ['no-adapter','malformed','unavailable','unauthorized','disconnected','timeout','cancelled','too-large','no-live','no-pushdown'] and CAPABILITY_REFUSALS { live: 'no-live', pushdown: 'no-pushdown' }.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/src/source/types.ts"
 },
 {
  "fact": "The local library records per-table provenance {format, via, version, retrievedAt, rows} and a refresh result {changed, from, to, delta (deltaByKey), materialisedLost}.",
  "source": "/Users/sanjay/github/footprintjs/vizfootprint/src/def/buildDashboard.ts"
 }
]

LESSONS
- Tab 1 (Data Source) should be one grid row per declared table showing format, via, at, key, grain, version, retrievedAt, rowCount and the current refusal (if any) — Power BI hides these across a Navigator dialog, the Queries pane, Model view Properties, and a status bar, and Table view simply disappears under DirectQuery (desktop-data-view; buildDashboard.ts; source/types.ts).
- Show the WHERE choice (memory | wasm | server, and live | snapshot) as a column on the Data Source tab with a typed refusal in the cell (no-live / no-pushdown) instead of Power BI's 'you can't set the mode back to DirectQuery' and its missing-icon behaviour (desktop-storage-mode; source/types.ts).
- Every column on Tab 2 must carry its declaration as data — source column, or a computation with its input columns named — because Power BI's step names ('Changed type', 'Renamed columns') and DAX calculated columns record no cause and no read set (applied-steps; desktop-calculated-columns).
- Put the step log beside the sheet as a commit list keyed by column, not by position: Power Query's log depends on 'the previous step by identifier', so inserting or deleting needs a warning dialog and a source rename becomes a whole-load Expression.Error (applied-steps; dealing-with-errors).
- Clicking a commit must re-materialise from the commit log (M3 replay), not from a cache, because Power Query admits stepping back 'doesn't always get correct step comparison information' due to cached later evaluations (query-diagnostics).
- Make one declaration surface for computed columns, in the sheet, declared with its cause — Power BI has two (Power Query custom column = a logged step; DAX calculated column = an unlogged model property), and only the first is replayable (add-custom-column; desktop-calculated-columns).
- Distinguish a per-row column from a context-dependent aggregate by a declared kind and an icon in the header, as Power BI does with the formula icon vs the calculator icon, and say WHEN each is computed (refresh vs gesture) (desktop-calculated-columns; desktop-measures).
- Column quality/distribution bars belong under each header on Tab 2 and must come from the ONE-PASS FOLD over all rows with the row basis stamped, since Power Query profiles 'the first 1,000 rows' by default and only a status-bar click widens it (data-profiling-tools; fold.ts).
- Column type must be a declared, visible fact with its basis, not a silent auto-step: Power Query infers from 'the first 200 rows' and inserts 'Changed type' automatically, leaving Any when undecided (data-types; TypeTally).
- Keep cell-level gaps as typed values in the cell (absence vocabulary) and offer 'keep gaps' as a filter, mirroring Power Query's non-blocking 'Error' cells and its 'Keep errors' auditing action, while table-level refusals stay a yellow banner that blocks nothing else (dealing-with-errors; source/types.ts).
- When the view-query port lands, show a per-step 'ran where' indicator (engine vs pushed to source) in the commit list — Power BI's folding indicators and Query plan are Online-only and Desktop users must trace queries by hand (step-folding-indicators; query-plan; query-diagnostics).
- Declare incremental refresh as data on the Data Source row (key, changed-since column, window) and refuse with no-pushdown when the source cannot filter, instead of Power BI's silent local fallback that 'defeats the purpose' plus a warning it cannot verify (incremental-refresh-overview; deltaByKey).
- Treat cross-table references (joins, group-by outputs used elsewhere) as commits with a declared basis so a shared upstream is computed once and shown once, unlike referenced queries that are 'executed three times' (power-query-referenced-queries).
- Give each commit a free-text description slot but never rely on it: Power Query offers one and 'typically, no description is added', so the machine-recorded cause (requestedBy, intent, inputs) must be sufficient on its own (applied-steps).
- Keep the formula bar as a projection of the declared computation with a syntax check, never as the source of truth — the Advanced Editor is Power BI's truth and its step settings only exist when the engine recognises the formula's shape (desktop-query-overview; add-custom-column).
- Column-level lineage on Tab 2 (why() on a column header) is the gap: Power BI's dependency diagrams stop at query level and the per-step diagram view is Online-only (diagram-view; power-query-referenced-queries).
- The status line for a long fold (silent <2000 ms, fraction + Cancel >10 s) should live in the same status bar that shows row/column counts and view toggles, as Power Query's status bar does (power-query-ui; scheduler seam).