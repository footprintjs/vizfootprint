# Provenance-aware spreadsheets: what the research settled

Layer named: this brief is about **layer 1 (data)** with two spill-overs — **layer 2 (smart)** for AI-proposed columns and **layer 5 (agent)** for branching history. The Data Source tab the user described is the same shape as the source panel in his own Weave/WeaveJS lineage; the closest academic twin is Gneiss's "source pane" (below).

## 1. Steps beat formulas; the table beats the code

- **Wrangler (Kandel, Paepcke, Hellerstein, Heer, CHI 2011).** Every edit becomes a step in a visible *transformation history*; each step is a short editable English sentence ("Delete rows where Year contains …"), with a live preview drawn *in place* on the table (deleted rows red, new columns shown beside old). Users can toggle steps off, edit a step's parameters, annotate a step with a rationale, and export the script to rerun on new data; a broken downstream step turns red with an error message ([wrangler.pdf](http://vis.stanford.edu/files/2011-Wrangler-CHI.pdf), "Transformation History" and "Natural Language Descriptions" sections). Study: 12 analysts, three tasks (extract text, fill missing, reshape), max 30 rows × 4 columns; **median Wrangler time was over twice as fast as Excel in every task**, F(1,54)=23.65, p<0.001, and the speed-up held for Excel novices and experts alike (same PDF, "Comparative Evaluation"). Users rated previews 4.8/5 and suggestions 4.3/5 vs direct editing 2.5/5. Non-programmers "relied almost entirely on the previews" ("I just look at the picture"); programmers read the sentences. Users "turned to manual parameterization only as a last resort," and both tools failed when the user "lacked a conceptual model of the transform" (reshape task).
- **Nardi & Miller (INTERACT 1990).** The grid, not the formula, is what users think with: "the tabular format provides a simple but powerful framework onto which users map their problems"; users "described awkward pencil and paper procedures for tracing cell dependencies" because logic is scattered across cells ([miramontes.com](https://www.miramontes.com/writing/spreadsheet-eup/)). Hermans et al. cite the same finding: users find tracing a long calculation chain tedious ([Hermans 2015 PDF](https://www.aau.at/wp-content/uploads/2019/11/Hermans2015-smells.pdf)).
- **Blackwell, Burnett, Peyton Jones (ICFP 2003).** Design with Cognitive Dimensions and Attention Investment; spreadsheets win because of immediate recalculation and no forced abstraction; "hidden dependencies" and "premature commitment" are the named enemies ([icfp03 PDF](https://web.engr.oregonstate.edu/~burnett/Reprints/icfp03.excelFunctions.pdf)).

**Column vs cell formulas.** No fetched paper ran a head-to-head. The evidence points the same way indirectly: Hermans found *Duplicated Formulas* (the same formula copied down a column) in 10.8% of EUSES spreadsheets and *Long Calculation Chain* in 9.0%, and notes these two smells are "not immediately visible" when you click a cell ([Hermans 2015](https://www.aau.at/wp-content/uploads/2019/11/Hermans2015-smells.pdf), Table 2). A column-level formula removes the duplication smell by construction. Gneiss binds a whole column to one JSON field and reserves the column for it ([Gneiss JVLC PDF](https://www.cs.cmu.edu/~NatProg/papers/JVLC-gneiss-final.pdf), §5.1). Treat "column formulas > cell formulas" as strongly supported by mechanism, not by a controlled study [unverified as a direct comparison].

## 2. Data sources declared in a pane, with per-cell metadata

- **Gneiss (Chang & Myers, UIST 2014; JVLC 2016).** Left "source pane" where you paste a REST URL; the raw JSON shows there; you drag a field onto a column; the column "becomes reserved to only show those data"; right-click any cell → "view source" jumps back to the raw record; sorting/filtering rules on a column are re-applied whenever the source changes; nested data shown as nested cells; two-way flow (a cell value can be a query parameter) ([JVLC PDF](https://www.cs.cmu.edu/~NatProg/papers/JVLC-gneiss-final.pdf)). Study: three groups of 6 (spreadsheet users in Gneiss, in Excel, and professional programmers coding); Gneiss users finished "on average almost twice as fast as using Microsoft Excel, and even outperformed professional programmers … in most tasks" (same PDF, §1 and §7). The CHI 2015 streaming paper adds: "each cell automatically records metadata of its" retrieval time, usable in sorting, filtering and formulas; a blue label shows last-updated time next to the stream checkbox ([Gneiss-CHI15 PDF](https://www.cs.cmu.edu/~shihpinc/pdf/Gneiss-CHI15.pdf)).

## 3. Spreadsheet edits as recorded steps, with typed doubt

- **Vizier (Brachmann, Spoth, Kennedy, Glavic, Müller, Castelo, Bautista, Freire; CIDR 2020).** A spreadsheet view sits over a versioned notebook. "For each user interaction with the spreadsheet, a corresponding Vizual cell is created," and the notebook "collapses all such operations into a single Vizual cell that stores a script" ([CIDR PDF](https://odin.cse.buffalo.edu/papers/2019/CIDR-Vizier.pdf), §2 Spreadsheet View). Every edit is a new notebook version; editing an old version "creates a branch"; every version has a URL. **Caveats**: "an annotation attached to one or more cells or rows … consisting of (i) a human-readable description of a shortcut, error, or concern … and (ii) a reference to the workflow cell where the caveat was attached"; caveats propagate by fine-grained provenance where possible (SQL) and coarse-grained otherwise, are highlighted in the spreadsheet view, and summarized in an error view (§1.2). The SIGMOD 2019 demo adds that Lens outputs are "heuristic, so Vizier documents" them and violations "will not halt the workflow" ([SIGMOD demo PDF](https://www.cs.uic.edu/~bglavic/dbgroup/assets/pdfpubls/BB19.pdf)). No user-study numbers in either paper.
- **DQProv Explorer (Bors, Gschwandtner, Miksch, IEEE CG&A 2019).** Records the wrangling process as a provenance graph (nodes = data states, edges = operations, with row/column-level descriptions), plus a *quality-flow* view showing how quality metrics changed step by step, and an issue-distribution view. Motivation: transformation histories "are often not available outside of the system" and lack context "if these wrangling operations led to the desired outcome" ([Bors PDF](https://www.cvast.tuwien.ac.at/sites/default/files/2019-09/CG&ASI-2019-04-0039.R2_Bors.pdf)). Evaluation was formative only: 4 interviews + a 6-person focus group of CS undergraduates (§4.2).
- **Provenance for Interactive Visualizations (Psallidas & Wu, HILDA 2018).** Brushing, linking, drill-down and tooltips are all provenance queries over a relational workflow; their engine keeps "sub-100ms interaction times on a 123.5M row flight dataset" ([arXiv 1805.02622](https://arxiv.org/pdf/1805.02622)). This is the argument that a data layer with lineage *is* the interaction grammar's engine.
- **Excel Trace Precedents.** Blue arrows to inputs, red arrows to error sources, black dashed arrow to a sheet icon for off-sheet references; click repeatedly for the next level; cannot trace charts, PivotTables, or closed workbooks ([Microsoft support](https://support.microsoft.com/en-us/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507)). It answers "which cells" but never "which step" or "why".

## 4. What readers actually do

- **Srinivasa Ragavan, Sarkar, Gordon (CHI 2021).** Think-aloud with 15 people reading others' spreadsheets at work, coded at 20-second granularity: ~40% of comprehension time went to seeking information not on screen; about half felt overwhelmed; 12 of 15 went back to the author ([PDF](https://advait.org/files/ragavan_2021_spreadsheet_comprehension.pdf); [MSR page](https://www.microsoft.com/en-us/research/publication/spreadsheet-comprehension-guesswork-giving-up-and-going-back-to-the-author/)). Information is "hidden away from plain sight … or under-the-hood (e.g., data validation rules)"; authors put documentation bottom-right or in emails; "including intermediate results of computations in the grid might be helpful for debugging a formula, but add to clutter" (§7).
- **Hermans & Murphy-Hill (ICSE 2015), Enron corpus.** 16,189 unique spreadsheets; ~75% use only the top 15 functions; 6% of spreadsheet emails mention "error"/"fault" ([felienne.com](https://www.felienne.com/archives/3634)). The oft-quoted "24% of formula spreadsheets contain an Excel error" surfaced only in a search snippet [unverified].
- **Formula smells (Hermans, Pinzger, van Deursen, EMSE 2015).** 42.7% of EUSES spreadsheets have at least one smell at the 70% threshold; in the 10-user Robeco case study, all participants "needed time to explain" their smelliest formula and said "what was this…"; 8 of 10 had never considered a future reader ([PDF](https://www.aau.at/wp-content/uploads/2019/11/Hermans2015-smells.pdf), §9–10).
- **Error detection (Purser & O'Donnell).** 13 professionals vs 34 students: professionals corrected 72% of seeded errors, students 58%; a strong correlation between the percentage of cells inspected and errors found ([arXiv 0802.3479](https://arxiv.org/pdf/0802.3479)).

## 5. AI-proposed columns: proposal → inspect → accept, with a basis

- **Data Formulator (Wang, Thompson, Lee; VIS 2023).** Click "+ derive" on a concept card, type a sentence (avg 7.28 words, 1.62 attempts); the AI returns ~1.94 candidates, each shown as **generated code + a table of example values**; the user picks one in a dialog; a reshaped concept stays "unknown" until the user fills an example table. Study: 10 participants, 6 tasks, ~20 min total; all but one found the code display helpful, 7 found the example table useful; the first task drew the most hints (7) because changing a derived column's type was hard ([arXiv 2309.10094](https://arxiv.org/html/2309.10094)).
- **Data Formulator 2 (Wang, Lee, Drucker, Marshall, Gao; 2024).** A **data thread**: each node = data table + chart + the instruction that produced it; branch from any node. Verification artifacts: code view, data view, AI-written explanation. Study: 8 participants, 16 charts; people caught wrong transforms **most often from the chart looking wrong**, not from code; experts read code, business users read explanations; trust was built as a "chain" — check the early simple steps, assume later ones; "if it is something I missed altogether, I will just cancel the whole thing and start from scratch" ([arXiv 2408.16119](https://arxiv.org/html/2408.16119)).
- **SheetCopilot (Li et al., NeurIPS 2023).** LLM drives a sheet via "atomic actions" in a state machine with validate → revise → act; **44.3% of 221 tasks fully correct** on one try (Exec@1 87.3%, Pass@1 44.3%; VBA baseline Pass@1 16.3%) ([arXiv 2305.19308](https://arxiv.org/abs/2305.19308); [PDF Table 1](https://arxiv.org/pdf/2305.19308)). Roughly half of AI sheet actions are wrong: acceptance must be a human step.
- **SpreadsheetLLM (Dong et al., 2024).** Raw cell-by-cell encoding does not fit LLM windows; SheetCompressor gives 25× compression and 78.9% F1 on table detection ([arXiv 2407.09025](https://arxiv.org/abs/2407.09025)). Lesson: hand an agent a declared schema and a sample, not the grid.

## 6. History display

- **Heer, Mackinlay, Stolte, Agrawala (VIS 2008), Graphical Histories.** Linear "comic strip" of thumbnails or branching tree; thumbnails ~120px square give ~80% recognition; branching needs a tree ([heer2008 local PDF](/private/tmp/claude-501/-Users-sanjay-github-footprintjs-footPrint/12ff6525-4579-4cfc-9414-1c182be6dc99/scratchpad/papers/heer2008.txt)). **Trrack (Cutler, Gadhave, Lex, VIS 2020)** is the reusable web library for the same tree, noting Lyra and Data Illustrator lacked provenance ([local trrack2020](/private/tmp/claude-501/-Users-sanjay-github-footprintjs-footPrint/12ff6525-4579-4cfc-9414-1c182be6dc99/scratchpad/papers/trrack2020.txt)).
- **Data Illustrator (Liu et al., CHI 2018)** keeps a Data Table Panel that doubles as an inspector; 13 designers; pain points were hidden controls and confusing order with position ([local PDF text](/private/tmp/claude-501/-Users-sanjay-github-footprintjs-footPrint/12ff6525-4579-4cfc-9414-1c182be6dc99/scratchpad/papers/data-illustrator.txt)). Lyra 2 data-pane details were not fetched [unverified]. "Quilt" spreadsheet provenance: not found [unverified].

## What is settled
1. Users understand a **list of steps in English with an in-place preview** better than formulas; previews rated far above editing (Wrangler).
2. **Every gesture becomes a recorded step**, collapsed for reading, branchable, addressable by URL (Vizier; Data Formulator 2).
3. **Doubt is data**: a caveat = text + the step that caused it, propagated and highlighted (Vizier); a refusal that does not halt (Lenses).
4. **Provenance must leave the tool** with the data, or readers spend 40% of their time hunting and go back to the author (Bors; Ragavan).
5. **AI columns are proposals**: show code + example rows + explanation; the user accepts; the chart is the first error detector; ~half of raw AI sheet actions fail (Data Formulator 1/2; SheetCopilot).

FACTS
[
 {
  "fact": "Wrangler records every transform as an editable English sentence in a history viewer; steps can be toggled, edited, annotated with rationale, and exported as a script; broken downstream steps are highlighted red.",
  "source": "http://vis.stanford.edu/files/2011-Wrangler-CHI.pdf"
 },
 {
  "fact": "Wrangler study: 12 analysts, 3 tasks; median completion over twice as fast as Excel in all tasks (F(1,54)=23.65, p<0.001); previews rated 4.8/5, suggestions 4.3/5, direct editing 2.5/5; non-programmers relied almost entirely on previews.",
  "source": "http://vis.stanford.edu/files/2011-Wrangler-CHI.pdf"
 },
 {
  "fact": "Wrangler previews are drawn in place on the source table (deleted rows in red, new columns beside old) rather than in a separate table; users turned to manual parameterization only as a last resort.",
  "source": "http://vis.stanford.edu/files/2011-Wrangler-CHI.pdf"
 },
 {
  "fact": "Nardi & Miller: the tabular grid is the primary framework users map problems onto; users described awkward pencil-and-paper procedures for tracing cell dependencies.",
  "source": "https://www.miramontes.com/writing/spreadsheet-eup/"
 },
 {
  "fact": "Gneiss: a left source pane holds a REST URL and raw JSON; dragging a field reserves a whole column for it; right-click 'view source' returns to the raw record; column sort/filter rules re-run when the source changes; two-way data flow.",
  "source": "https://www.cs.cmu.edu/~NatProg/papers/JVLC-gneiss-final.pdf"
 },
 {
  "fact": "Gneiss lab study: three groups of 6; Gneiss spreadsheet users finished data-analysis tasks on average almost twice as fast as Excel users and outperformed professional programmers writing JavaScript/Python in most tasks.",
  "source": "https://www.cs.cmu.edu/~NatProg/papers/JVLC-gneiss-final.pdf"
 },
 {
  "fact": "Gneiss streaming model: each streamed cell automatically records the time its data was retrieved, usable in sorting, filtering and formulas; last-updated time shown as a label beside the stream checkbox.",
  "source": "https://www.cs.cmu.edu/~shihpinc/pdf/Gneiss-CHI15.pdf"
 },
 {
  "fact": "Vizier: for each user interaction with the spreadsheet a corresponding Vizual cell is created, and the notebook collapses successive edits into a single Vizual cell holding a script; each edit is a new version; editing an old version creates a branch; every version has a URL.",
  "source": "https://odin.cse.buffalo.edu/papers/2019/CIDR-Vizier.pdf"
 },
 {
  "fact": "Vizier caveat = annotation on cells/rows with (i) a human-readable description of a shortcut, error, or concern and (ii) a reference to the workflow cell where it was attached; propagated via fine-grained provenance when available, coarse-grained otherwise; highlighted in the spreadsheet view and summarized in an error view.",
  "source": "https://odin.cse.buffalo.edu/papers/2019/CIDR-Vizier.pdf"
 },
 {
  "fact": "Vizier Lenses: outputs are heuristic and documented as such; constraint violations are reported in an error summary but do not halt the workflow.",
  "source": "https://www.cs.uic.edu/~bglavic/dbgroup/assets/pdfpubls/BB19.pdf"
 },
 {
  "fact": "DQProv Explorer captures wrangling as a provenance graph (states as nodes, operations as edges, row/column-level descriptions) plus a quality-flow view of metrics per step; formative evaluation only (4 interviews + 6-person focus group of CS undergraduates).",
  "source": "https://www.cvast.tuwien.ac.at/sites/default/files/2019-09/CG&ASI-2019-04-0039.R2_Bors.pdf"
 },
 {
  "fact": "Psallidas & Wu: brushing, linking, drill-down and tooltips are expressible as provenance queries; their engine keeps sub-100ms interactions on a 123.5M-row dataset.",
  "source": "https://arxiv.org/pdf/1805.02622"
 },
 {
  "fact": "Excel Trace Precedents/Dependents: blue arrows for inputs, red for error sources, black dashed arrow to a sheet icon for other-sheet references; repeat click for next level; cannot trace charts, PivotTables, named constants, or closed workbooks.",
  "source": "https://support.microsoft.com/en-us/office/display-the-relationships-between-formulas-and-cells-a59bef2b-3701-46bf-8ff1-d3518771d507"
 },
 {
  "fact": "Spreadsheet comprehension study (15 users, 20-second coding): ~40% of time spent seeking information not on screen; about half felt overwhelmed; 12 of 15 went back to the author; information hidden under-the-hood (e.g., validation rules) and documentation placed bottom-right or in emails.",
  "source": "https://advait.org/files/ragavan_2021_spreadsheet_comprehension.pdf"
 },
 {
  "fact": "Hermans formula smells: 42.7% of EUSES spreadsheets have at least one smell at the 70% threshold; Duplicated Formulas 10.8%, Long Calculation Chain 9.0%; these two are not visible when clicking a cell; in a 10-user industrial study all needed time to explain their smelliest formula and 8 had never considered a future reader.",
  "source": "https://www.aau.at/wp-content/uploads/2019/11/Hermans2015-smells.pdf"
 },
 {
  "fact": "Enron corpus: 16,189 unique spreadsheets; ~75% use only the top 15 functions (134 functions total); 6% of spreadsheet emails mention error/fault.",
  "source": "https://www.felienne.com/archives/3634"
 },
 {
  "fact": "End-user error detection: 13 professionals corrected 72% of seeded errors vs 58% for 34 students; strong correlation between percentage of cells inspected and errors corrected.",
  "source": "https://arxiv.org/pdf/0802.3479"
 },
 {
  "fact": "Data Formulator: '+ derive' on a concept card; NL prompt (avg 7.28 words, 1.62 attempts) yields ~1.94 candidates shown as generated code plus example-value table; user confirms one; 10-participant study, ~20 min; all but one found code display helpful, 7 found the example table useful; most hints on changing a derived column's data type.",
  "source": "https://arxiv.org/html/2309.10094"
 },
 {
  "fact": "Data Formulator 2: data thread nodes = data table + chart + instruction; branch from any node; verification via code view, data view, and AI explanation; 8 participants, 16 charts; errors most often noticed from a wrong-looking chart; experts read code, business users read explanations; trust built as a chain from early simple steps.",
  "source": "https://arxiv.org/html/2408.16119"
 },
 {
  "fact": "SheetCopilot: atomic actions + state-machine planning (propose, validate/revise, act); 44.3% of 221 tasks fully correct in one generation (Exec@1 87.3%, Pass@1 44.3%; VBA baseline Pass@1 16.3%).",
  "source": "https://arxiv.org/pdf/2305.19308"
 },
 {
  "fact": "SpreadsheetLLM: naive cell-by-cell serialization exceeds LLM token limits; SheetCompressor achieves 25x compression and 78.9% F1 on table detection.",
  "source": "https://arxiv.org/abs/2407.09025"
 },
 {
  "fact": "Blackwell, Burnett, Peyton Jones: design functions in Excel with Cognitive Dimensions (hidden dependencies, premature commitment, abstraction gradient) and Attention Investment; spreadsheets succeed through immediate recalculation and no forced abstraction.",
  "source": "https://web.engr.oregonstate.edu/~burnett/Reprints/icfp03.excelFunctions.pdf"
 },
 {
  "fact": "Graphical Histories: linear comic-strip thumbnails or branching trees; ~120px thumbnails give ~80% recognition; branching histories need a node-link tree.",
  "source": "/private/tmp/claude-501/-Users-sanjay-github-footprintjs-footPrint/12ff6525-4579-4cfc-9414-1c182be6dc99/scratchpad/papers/heer2008.txt"
 },
 {
  "fact": "Data Illustrator: 13 designers; a Data Table Panel doubles as inspector; pain points were hidden position controls and confusing shape order with position.",
  "source": "/private/tmp/claude-501/-Users-sanjay-github-footprintjs-footPrint/12ff6525-4579-4cfc-9414-1c182be6dc99/scratchpad/papers/data-illustrator.txt"
 },
 {
  "fact": "[unverified] '24% of Enron spreadsheets with formulas contain an Excel error' appeared only in a search snippet, not in a fetched primary source.",
  "source": "web search snippet (dblp/ResearchGate listing), not the ICSE 2015 PDF"
 },
 {
  "fact": "[unverified] No fetched paper ran a controlled column-formula vs cell-formula comparison; Lyra 2 data-pane details and any 'Quilt' spreadsheet-provenance work were not fetched.",
  "source": "gap noted during this research"
 }
]

LESSONS
- Make the Sheet tab a list of steps first and a grid second: every gesture (sort, filter, derive, rename, refresh) is a commit shown as a short editable English sentence with an in-place preview, because Wrangler users were 2x faster and rated previews 4.8/5 vs 2.5/5 for editing.
- A formula belongs to a column, never a cell: reserve the column for its source or its derivation (Gneiss) so Hermans's invisible Duplicated-Formula and Long-Chain smells cannot exist.
- Put the Data Source tab on the left like Gneiss's source pane and your own Weave source panel: show the raw declared source, let 'view source' on any cell jump back to its record, and re-run column rules on refresh.
- Stamp each table (and, if cheap, each cell) with the version and retrievedAt it was true of, as Gneiss stamps retrieval time on streamed cells, and let filters and sorts use that stamp.
- Treat a refusal or a heuristic guess as a Vizier caveat: a declared record with a human-readable reason plus the step that caused it, propagated to derived columns and highlighted in the grid, never a silent blank or a halted run.
- Collapse rapid edits into one readable step for the reader (Vizier's collapsed Vizual cell) while keeping every commit individually addressable and branchable for why() and time travel.
- Export provenance with the data (Bors), because readers spend ~40% of their time hunting for what is not on screen and 12 of 15 went back to the author (Ragavan).
- Hold an AI-derived column as a proposal card showing the code, a few example rows, and a plain-language explanation; the column joins the sheet only when a person accepts, and the commit records requestedBy agent plus the accepted basis (Data Formulator 1/2).
- Expect roughly half of agent sheet actions to be wrong (SheetCopilot 44.3%), so validate every proposed step against the declared schema before it runs and keep the chart visible, since users catch bad transforms from the chart first.
- Give the agent the declared source schema, column types, and a sample, not the raw grid, because cell-by-cell serialization blows token budgets (SpreadsheetLLM).
- Keep intermediate columns available but hidden by default with a one-click reveal, since intermediates help debugging but clutter reading (Ragavan).
- Show why() as a step trail rather than Excel-style arrows: arrows name cells but cannot say which step or which source version produced a value, and they stop at charts and closed sources.
- Offer a branching history as a thumbnail tree (Heer 2008, Trrack) so a user can revise an earlier step or start a fresh branch, matching the two recovery styles seen in Data Formulator 2.