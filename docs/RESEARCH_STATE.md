# RESEARCH_STATE — canonical (persisted 2026-07-09; supersedes any reconstruction)
## Decisions D1-D23 (evidence in SPEC.md + spike reports)
D1 Mosaic extension, no fork [GROUNDED+VERIFIED] · D3 online FDR only (QUDE DOI 10.1145/3035918.3064019) ·
D4 two-plane default · D6 one pkg, subpaths L0-L6 · D7 sibling of hcifootprint · D9 API grammar
buildDashboard→createSession→dispatch · D10 def = mosaic-spec superset + VL vocab · D12 skills on sparse
surfaces only · D13 dual intent · D14 gap taxonomy · D17 CommitRecord wire · D18 bespoke L1 log (Trrack
fallback) · D19 LORD++ user-facing · D20 CorrelationEnvelope + 3 in-family patches (SHIPPED at source:
af 9524460, fp fba2886, viz e6470ec) · D21 R15 measured (0 long tasks / 0.00ms TBT / 1 commit per gesture) ·
D23 fp+af pushed; releases unnamed.
## Hypotheses
H1 SUPPORTED×2 (BH-peek .195 vs α .05; LORD++ .0029) · H2 SUPPORTED-at-source · H3 SUPPORTED ·
H4 SUPPORTED · H5 partial (machine-shaped slice proven; full minimal-set contract = L6 gate) · H6 OPEN — L5 built the
readiness-disclosure SEAM (whats_here analyses[].ready/blockedBy from column types + selection, src/session/session.ts overview(); D12 guards+skills framing); the A/B power experiment stays a later bench.
## CANONICAL open questions (authoritative — reconcile SPEC §10 to THESE)
Q3 = cite QUDE by DOI (venue-year label discrepancy; cosmetic).
Q4 = upstream two-slot cause to hcifootprint's one-slot Principal (atom/types.ts:33), later hcifootprint major.
Q6 = is the 7-verb dispatch vocabulary complete vs the DashboardQA task suite? PARTIAL VERDICT (P3-L5): all 7 verbs
{select,filter,annotate,navigate,analyze,fork,checkpoint} are WIRED and a scripted no-LLM agent completes a
5-step task (filter→cluster→filter-by-cluster→declare correlation→read ledger) through dispatch/tools alone with
ZERO gaps (src/agent/vizAsTools.test.ts). Necessity evidence: select/filter/analyze/fork/checkpoint each exercised
by an acceptance test; annotate/navigate proven wired but NOT load-bearing in the task suite (optional-interaction,
no analytical consumer yet) — flagged as the two soft verbs. Completeness vs a full DashboardQA battery stays OPEN
until benchmarked (gap distribution = the signal; a task that can't be expressed files a needs-* gap).
**Q6 FIRST COMPLETENESS EVIDENCE (UI-0, 2026-07-10, orchestrator-adjudicated ruling):** the 7-verb set was
INCOMPLETE, not merely unbenchmarked — changing a view's visual encoding (e.g. scatter `x: price → rating`) is a
STATE-CHANGING TRANSITION (must land a cause-tagged commit, replay deterministically, and restore under
time-travel seek), which none of the 7 verbs covered. Added `reencode` as the 8th verb (`src/def/types.ts`
`DispatchVerb`; `mandatory-analytical`, same class as select/filter/fork/checkpoint). Lands via the same
synthetic-viewId commit pattern `doAnnotate`/`declareAnalysis` already use (`encoding:${viewId}`, `field`=channel,
`value`=target field — no `src/log` wire-union change); the session fold carries per-view channel→field state
(`overview().views[].encodings` + the flattened `overview().encodings[viewId]` + a sync `session.viewEncodings(viewId)`
read API), branch-scoped and seek-restorable exactly like `activeFilters` (`src/session/session.ts` `rebuildFold`).
A view's valid channel vocabulary is an explicit per-view declaration (`DashboardDef.encodings: ViewEncodingDecl[]`
— chart kind is informational/echoed, `channels` is the validated list; R14 — never guess a vocabulary for an
undeclared chart kind, mirrors D12 "skills on sparse surfaces": no encoding surface declared ⇒ honest
`guard-failed`, not silent allow). This is DIRECT completeness evidence, not a benchmark result: the 7-verb set was
proven insufficient BY CONSTRUCTION (an authoring-op class was missing outright, discovered by the orchestrator's
own ruling, not by running a task battery). The DashboardQA benchmark question stays OPEN for the remaining 8-verb
set. 13 new tests (`src/session/session.test.ts`, `src/session/timeTravel.test.ts`, `src/agent/vizAsTools.test.ts`,
`src/def/buildDashboard.test.ts`), tsc clean.
Q8 = does echoed interaction-intent leak app content into the instruction channel? RESOLVED-NO (P3-L5,
src/agent/vizAsTools.test.ts): tool DESCRIPTORS are authored constants (no runtime interpolation); a category
literally named "IGNORE PREVIOUS INSTRUCTIONS…" and an identical cause.intent round-trip as inert DATA
(commit.value / activeSelections[].value / cause.intent) and never appear in any descriptor or column-facet field.
whats_here discloses column NAMES+types, never VALUES.
Q9 = RESOLVED (e3ce924): RegisteredSource extends MosaicClient genuinely (base class inert without coordinator — MosaicClient.js:20-233 no-op defaults; instanceof satisfied). One deliberate cast remains in bench/x4 (benchmarks raw Mosaic, out of layer).
Q10 = RESOLVED (P3-L4, viz gamma.ts:26-77 / gamma.q10.test.ts): ship 0.0722 (Ramdas et al. 2017 Sec. 3.1) as default — horizon-independent, the more conservative of the two published constants; onlineFDR's 0.07720838 (~6.94% looser at every j≤100, measured) stays available not-default via {gamma: lordGammaOnlineFDR} — conservative-vs-calibrated power tradeoff, not a validity one.
Q11 = the one unreproduced test flake (suspect: 10k-sim FDR tests at 5s default timeout — codify testTimeout 30000 at L4).
D24 [GROUNDED] Engine strategies: ONE coordination model (typed clauses), THREE execution engines behind the
def's data seam — memory (in-JS predicates over arrays/CSV; X4-proven: bench/x4/runner.mjs:46-50 ran mosaic-core
with DuckDB stubbed) | wasm (DuckDB-WASM in-browser; loadCSV/loadObjects/loadParquet, mosaic-sql index.js:34) |
server (connector) | auto. INVARIANT: engine never changes commit semantics — cross-engine replay byte-identical
(acceptance test at L5/data-provider packet). Keysets stay eliminated as coordination; the VizAdapter small-data
insight lives as the memory ENGINE.
Q12 [OPEN] auto-engine thresholds (rows/bytes for memory→wasm→server) — measure with an X4-style bench, don't guess.
## Orchestrator adjudications of SPEC §11 conflicts
C1 ACCEPT rename JoinRecord→CorrelationEnvelope. C2 ACCEPT: L6 must prove a SECOND target kind before claiming
why(target) generality. C3 ACCEPT: L3 greenfield/highest-risk — packet starts with a mini-spike validating the
four AnalysisOutput channels before API freeze. C4 ACCEPT: L6 adopts AgentRunOptions.correlationId; tool-args
workaround retires. C5 ACCEPT: R15 claim scoped to main-thread blocking only (bench stubs DuckDB).
D25 [SHIPPED P3-L5] L5 agent surface: buildDashboard(def) [DashboardDef = mosaic-spec superset, R12-firewalled] →
createSession() → dispatch(action,{as}) [the single R4 entry, 7 verbs] + declareAnalysis [lands the AnalysisCommit,
steps L4, materializes columns R11] + gaps() [D14 taxonomy] + why() [typed L6 stub]. vizAsTools(session) [fixed
6-tool Mode B port] + mcpServer(session) [vizfootprint/mcp; @modelcontextprotocol/sdk optional peer, subpath-isolated
like hcifootprint]. src/def, src/session, src/agent, src/mcp; +38 tests (278 total), tsc clean. SPEC §7-signature
refinements flagged in §7 (declareAnalysis runs+lands not just registers; gaps() is a method; analyses accept L3
built-in MODULES not just raw defs; why is an L5 stub).
## WAVE COMPLETE 2026-07-09 — L0-L6 ALL SHIPPED, orchestrator-verified at 308/308
H5 SUPPORTED (ecaa0b8): why(target) minimal-set contract proven for TWO target kinds (column + hypothesis),
decoys excluded incl. active-but-unused selects; x3 retired into src/why; machine-shaped slices.
C4 CLOSED 2026-07-09 (DEP-BUMP packet, src/why commit after ecaa0b8): af 7.4.0 (npm-live) wires the
correlationId path — `run({correlationId})` → `AgentRunOptions.correlationId` (source 9524460,
`node_modules/agentfootprint/dist/esm/core/Agent.d.ts:51`) is folded into the run context
(`Agent.js:639,645`) and forwarded onto every emitted `EventMeta.correlationId`
(`bridge/eventMeta.js:39`); `sanctioned-path.test.ts` now asserts the SANCTIONED field is populated
end-to-end (no manual stamping), keeping a typed `no-agent-frame` miss test for a correlationId that
never ran (fallback stays honest). fp 9.11.0 (npm-live) ships `RuntimeSnapshot.runId: string`
(source fba2886, `node_modules/footprintjs/dist/esm/lib/runner/ExecutionRuntime.d.ts:39`) →
`flags.kernelRunIdAvailable=true` when present, `result.kernel.runId` populated; `x3.test.ts` adds
the disambiguation proof (two independent kernel runs share colliding `runtimeStageId` strings but
carry different `runId`s) and `why.test.ts` keeps a runId-absent fallback test (older/duck-typed
kernel snapshot → honest `runId:null`/`kernelRunIdAvailable:false`, never a crash).
NEW Q14 (from DEMO-2): sanctioned read-back of materialized column VALUES through the session (demo recomputes
locally to render) — L5 addendum candidate.
Demo: LIVE :5180, real tool-port agent + gaps panel (b13af40). Repo local-only, head ecaa0b8 — push/publish = owner's word.
## TIME-TRAVEL SHIPPED (6764dcc + b2c05ff, 334/334 verified): branch-on-act ruling honored — seek = read-only
cursor + pure fold; act-from-past = atomic sibling branch (fork verb COMPLETED: old doFork moved _head and lost
the tip — fixed to cursor semantics); named checkpoints (R12-validated); branch-scoped column visibility AT THE
FOLD (cluster_id on branch A honestly needs-column on sibling B; provider persists physically — documented seam);
ledger NEVER rewinds (cursorTests vs global monotone wealth — the two-truths display, verbatim honesty line).
Dashboard :5181 has the time bar + git-graph branch map + checkpoints; analyst reaches seek/checkpoint via tools.
NOT mirrored to :5180 (out of packet boundary — candidate follow-up).
## D26 [SHIPPED BR-1] Named branching: `src/branches` + session paths (packet said "D25" — that id was already
taken by the P3-L5 entry above; shipped as D26 to keep this record unique)
Git-style NAMED refs over the append-only log, as a PURE subpath `src/branches` — imports ONLY `src/log` (boundary
pinned by a structural test in branches.test.ts), usable against a raw CommitRecord[]. Refs `{name → tip}` + HEAD
live BESIDE the log, never in it (commits stay frozen; R8 untouched; refs are the one thing allowed to move).
Rules: act-at-tip ADVANCES the ref; act-while-detached (seek/fork travel BY ID → detached, git parity; switchPath
travels BY NAME → attached) AUTO-CREATES a cause-slugged counter-unique ref — the old anonymous branch-on-act, NOW
NAMED. Every create/advance/switch/rename lands in a frozen ref-event JOURNAL (lightweight events, never commits;
logical ts) — even branch bookkeeping is auditable. `deriveBranches(records)` names every lane of a legacy
anonymous log deterministically (first leaf lane = 'main'; siblings slug from their divergence commit; same input
→ same names). `commonAncestor` = loop-safe LCA, missing-id honest. `foldDiff(tipA,tipB)` = the structured state
diff FROM THE LOG ALONE, last-wins per key (selection=(viewId) · encoding=(viewId,channel) · analysis=(id);
annotations inert; a cleared interval DROPS the key), deterministically ordered, deliberately NO row counts at
this layer. `planBringOver`/`planUndo` = plan-don't-execute `{recipe, conflicts[]}`: a conflict = the same key
touched on the target path since the LCA, NAMED by the overriding commit id — the plan stays executable; undo
restores the key's value at the commit's PARENT (absent → clear recipe; a clear-encoding resolves to the view's
declared initial at the session); analysis undo is honestly not-undoable (the FDR ledger never refunds),
annotation inert. NO NEW VERBS: the session executes plans through the ONE dispatch entry; the landed cause
carries the minimal L0 extension `replayedFrom`/`revertOf` (+`conflicts` when any) — three new allowlisted
inert-data keys (src/cause), structuredClone + JSON round-trip proven. Session surface (plain names):
`paths()` / `switchPath` / `renamePath` / `newPathAt` / `compare` (foldDiff enriched with per-side ROW COUNTS via
the data provider; honest null when the backend can't count) / `bringOver` / `undo`; `overview().paths` =
{current, detachedAt, list, events}; the synthetic-viewId prefixes are now SINGLE-SOURCED from branches/fold
(session imports them — the two fold layers cannot drift). Tools: the fixed Mode B set grew 6→8 (`viz.paths`
list|switch|rename|new — mutations route through the session methods; `viz.compare` read-only structured diff);
`whats_here` discloses current path + list; mcpServer parity pinned by a real in-memory MCP Client test.
ROOT-CAUSE FIX shaken out by the acceptance tests: `doReencode` registered the shared `encoding:${viewId}` source
with actor-DEPENDENT meta → the second actor's reencode (or any cross-actor undo/bring-over) threw
SourceRegistryError; the source now carries the view's declared meta (stable identity, same as doProbe) — WHO
acted stays in the cause; regression pinned. Existing tests: only the two fixed-tool-list assertions changed
(6→8); zero coverage deleted. Gate: 1086 tests at 100/100/100/100; all four typechecks clean.

## D27 [DOCS DOC-1] Weave study + renderer-protocol panel verdict canonicalized as repo docs
`docs/research/weave-study.md` (six angles: session-state core, keys/selection-at-scale, scheduler,
geometry/LOD, feature inventory, Adapter abstraction — every finding file:line-cited against the real Weave/
WeaveJS/Adapter clones, not paraphrased). Headline: Weave's `KeySet` computes `keysAdded`/`keysRemoved` on every
mutation and then DISCARDS them, re-diffing full materialized state forever after (`KeySet.as:89-119`,
`SessionManager.as:1527-1535`) — the exact weakness vizfootprint's append-only commit log already fixes by
construction (a `CommitRecord` IS the durable delta). The converse gap is real too: vizfootprint has none of
Weave's 15 years of scale engineering (interning, priority-tiered time-sliced scheduling, importance-driven
LOD, KD-tree hit-testing) — captured as a W1-W3 mini-lib roadmap, **PROPOSED only, nothing built**: W1 `keys/`
(interning + delta-as-log-entry KeySet), W2 `schedule/` (adopt footprintjs sibling-repo `observer-queue`
interfaces — `FlushDriver` armed-once batcher w/ injectable `schedule` pump seam + `flushBudgetMs` budget
[`flushDriver.ts:68,72,125`], `ring.ts` bounded ring w/ counted overflow `'drop-oldest'|'sample'|'block'`
[`ring.ts:43,47-54`] — rather than re-deriving them, then layer Weave's priority tiers + `iterativeTask(deadline)
=> progress` contract + version-stamp self-abort on top), W3 `lod/`+`hittest/` (data-area-per-pixel LOD contract
+ shared render/hit-test spatial index). `docs/proposals/renderer-protocol.md` supersedes the original
"bring-any-chart" pitch with the 5-lens adversarial panel's verdict (practitioner/academic/skeptic/economist/
historian + contradiction-map synthesis): 7-point table — **MODIFY** Renderer Contract (protocol version + LSP-
style capability handshake at mount; clause-addressable selection `{clauses, resolve, selfClauseId}` replacing
the flat keep-predicate — Mosaic-style, arXiv:2507.19690; 4th outbound verb for view-state/pan-zoom-navigate,
independently derived by 2 lenses from Yi et al. IEEE TVCG 2007; transform-ownership rule — host owns bin/
aggregate/decimate, renderer-side transforms rejected/gap-ledgered — the panel's collective blind spot) ·
**CUT to one** bridge package (`@vizfootprint/vega-lite` only; FINOS Perspective PR #1174 deleted its Highcharts+
Hypergrid bridges and retreated to first-party d3fc — the closest real precedent, reversed) · **MODIFY**
conformance kit to internal-CI-only, version-stamped, auto-expiring into a typed `certification-lapsed` gap (no
public badge until a 2nd non-author implementer exists — CNCF certified an already-competitive market, didn't
create one) · capability declarations **survive intact** (+ `canPanZoom`/`canRearrange`) · **MODIFY (gate)**
agent-proposed VL specs through the LORD++ ledger (schema-valid → capability-check → hypothesis → render; DracoGPT
arXiv:2408.06845 19.1% valid-VL rate is why) · host-owned scale machinery **survives** + the transform-ownership
rule · first-party reference charts **survive intact**. Revised adoption thesis: meet agents at VL (provenance-
gated, since Databricks already ships ungated governed-VL), meet analysts via a 10-minute provenance on-ramp
(VisTrails died on this exact blocker despite a decade of polish) — bridges are an internal architecture win, NOT
the growth engine. Go/no-go gate before ever green-lighting bridge #2: measure hours/quarter to keep the VL
bridge conformant across one VL major, on THIS team, before spending on breadth. Both docs cross-reference each
other (renderer-protocol.md's historian own-history evidence = weave-study.md §6, the repo owner's own 2016
"Adapter" project — abandoned generalized bring-any-chart bridge, read for its hub-and-spoke/echo-guard mechanism
and its honestly-documented unfinished parts). DOCS-ONLY packet — no src/ or ui/ touched; RP-1 (ui/) ran in
parallel, separately re-verified.

## D28 [SHIPPED RP-3] Ledger-gated agent-authored charts (`session.proposeChart` + the 9th tool)
The renderer-wave capstone: an LLM agent PROPOSES a chart at runtime as a Vega-Lite spec, but ONLY through a
governed pipeline (renderer-protocol.md §5 / D27), never trust-and-render — each stage failing to a TYPED honest
gap, never a silent drop:
  schema-valid → capability-check (no host-owned transforms, no unsupported composition) → registered as a
  HYPOTHESIS in the LORD++ ledger BEFORE it renders → registered as a session view under `chart:${id}` with
  agent-authored provenance in the cause.
**Dependency-direction decision (the packet's architectural call): bridge → core.** The pure spec-shape RULE
lives in the CORE library at `src/renderer/specShapeGate.ts` (`analyzeSpecShape`/`gateChartSpec`) — runtime-free,
NO `vega-lite` import (a spec is an opaque `Record<string,unknown>`), so the published library gates an agent's
proposed chart with ZERO charting dependency installed. The Vega-Lite bridge CONSUMES that detection
(`bridges/vega-lite/src/specGate.ts` calls `analyzeSpecShape` for its composition/transform/mark facts, wording
its own bridge-v1 issue strings) so the rule is single-sourced and cannot drift; the RENDER stays a bridge/UI
concern. Core → bridge or core → vega-lite would invert the package graph and drag Vega-Lite into the library's
install closure — rejected. **`proposeChart` is a standalone session method, NOT a 9th dispatch verb** — the
8-verb dispatch set stays closed (Q6), and `declareAnalysis` is the precedent (a governed pipeline that
gate→run→lands a commit→steps the FDR ledger). **The honest hypothesis shape (`ChartHypothesis`):** a chart is an
inferential claim wired into the SAME LORD++ ledger, but it carries NO computed statistic — it is an UNTESTED
visual claim entered at `p = 1.0` (the null-est value), so it COSTS multiplicity budget (an agent cannot fish
through charts for free) yet can NEVER be a discovery (`reject` always false at p=1; `tested:false`,
`pValueUsed:1`). Alpha is spent ONLY on a fully-passing proposal — a rejected proposal never registers a
hypothesis and never advances the FDR wealth (the "alpha spent only on real claims" rule, mirroring degenerate
analyses). The p=1 hypothesis lands as a `pValue` commit under `chart:${id}` so `hypothesisRecordsFromLog`
re-derives it on replay; the spec rides as a JSON string in a `__chart__` commit (round-trips structuredClone +
JSON). `chart:${id}` is a new single-sourced synthetic prefix (`CHART_VIEW_PREFIX` in `src/branches/fold`),
INERT in the crossfilter fold like an annotation. **Gap kinds added (D14 extension):** `chart-invalid-spec` |
`chart-transforms-not-owned` | `chart-unsupported-composition` | `chart-hypothesis-rejected` (the last for a claim
over columns absent from the table, an empty-encoding claim, or a duplicate id) — the agent reads the reason back
and repairs. **Surface:** `overview()/whats_here` lists agent charts + ledger status (token-lean — never the
spec); `session.charts()` is the host's render source (with specs). **The 9th tool** `propose_chart {id, spec,
rationale}` (`src/agent/vizAsTools.ts`) routes to `proposeChart`; MCP parity is automatic (the fixed tool list
grew 8→9, no `tools/list_changed`). **UI:** the ui adapter threads `SessionViewState.charts` from both sources;
the gallery + demo-agent render each agent chart as a real cockpit cell via the SAME RP-2 vega-lite bridge +
`bindRenderer` (receiving crossfilter — its marks dim under every other view's selection; own-brush display-only
in v1 since chart:${id} is fold-inert), a rejected proposal shows its reason in the Gaps panel, and the CommitLog
badges the chart commits agent-authored. Demo-agent system prompt teaches propose_chart; a "Propose a chart of
price vs rating colored by category" chip drives it live. Gate: **1502 tests at 100/100/100/100**; all five
typechecks clean; gallery + demo-agent browser smokes green (real Chromium: the agent chart renders + crossfilters
+ the reject gap). SHAs: core+bridge 0e5fdf3, ui+demo 9880b2b.

## D29 [DOCS DOC-2] `src/cause/` + `src/log/` + `src/branches/` named + documented as the "foottrail core"
Naming decision: the tree-based intent log at vizfootprint's heart is a standalone core pattern distinct from
footprintjs — footprintjs records executions of a pre-drawn plan (a run is linear, its log is an array);
foottrail records explorations with no pre-drawn plan (going back and acting again forks the record, so its log
is a tree). Future package name **foottrail** (npm-verified free, incl. `foottrail-js` and `@foottrail/core`, as
of 2026-07-16). The two logs stay connected without merging, via the first-class `correlationId` field resolved
at the `why()` tier (`src/why/why.ts:31`) — a join, never a merge. Documented in `docs/foottrail.md`: the pattern,
file:line pointers into `src/cause/cause.ts`, `src/log/log.ts`, `src/branches/{refs,derive,walk,slug,fold,plans}.ts`,
the import-purity structural test (`src/branches/branches.test.ts:57-69`), what it gives any app, and an honest
callout that `refs/derive/walk/slug` are genuinely payload-agnostic today while `fold/plans` are a Mosaic-shaped
worked example a second consumer would re-derive rather than import as-is. **Extraction rule** (same discipline as
the D27 renderer-conformance-badge verdict — no 2nd non-author implementer, no badge): foottrail ships as a
package only when a second real consumer exists, not when it merely could be reused. Candidate second consumers
named (neither built): hcifootprint branchable sessions, gameFootprint replay trees. DOCS-ONLY packet — no src/
or ui/ touched; README.md got a short "The foottrail core" section pointing at the doc.

## D30 [SHIPPED HM-1] the compound `cell` commit + VizHeatmap — one gesture, two fields, ONE commit (the C3 ruling)
A heatmap cell click selects on TWO fields with one gesture ("price 100–150 AND category Formal"). **Ruling: one
gesture = one commit — never two correlationId-linked commits.** The emission/commit vocabulary gains a third kind:
`cell` — `{kind:'cell', fields:[fx,fy]}` with the two-sided value pair (each side an interval `[lo,hi]`, half-open
allowed, or a point value; `null` clears the whole cell) riding the log's existing singular `value` slot; the
commit's predicate is the AND of both sides, composed from the REAL Mosaic side factories + mosaic-sql's `and()`
(now a declared direct dependency); `CommitRecord.field` carries the display-only joint label (`cellFieldLabel`,
"price × category") while the authoritative pair rides the new `CommitRecord.fields`. **The fold key stays
`selection:${viewId}`** (last-wins per view) — branching / compare / time-travel / bringOver / undo untouched by
construction, VERIFIED with targeted tests (fold-key pin in `src/branches/branches.test.ts` "TARGETED"; session
seek/branch-on-act/compare/undo suite in `src/session/cellSelect.test.ts`; undo-with-nothing-prior clears
KIND-FAITHFULLY via a cleared-cell recipe — the joint label is not a column, so a flattened interval-clear would
trip the column guard). Wire-format sweep (every replica in lockstep, the CLAUDE-map lesson): src/data
(`CellClause`/`CellSide`/`clauseFields`; `matchesClause` AND arm DELEGATES to the point/interval arms — half-open +
ISO-string discipline reused verbatim; `resolvePredicateSQL` cell arm byte-identical to the log's composed
descriptor, pinned vs the installed package; memoryProvider probes/validates BOTH columns) · src/mosaic
(`CellEncoding` emission arm; excess-key rejection still holds by construction) · src/log (commit refuses a
pair-less cell; replay copies the pair; JSON round-trip pinned) · src/branches (cleared-cell deletes the key;
fingerprints carry the pair; plans re-land the COMPOUND) · src/session (the `select` verb gains the cell form —
the vocabulary STAYS at 8 verbs; guards: needs-view / declared-capability / same-field / reserved-both-sides /
needs-column-both-sides / needs-backend-data) · vizAsTools+MCP (the agent cell-selects via `dispatch
{fields, values}`; fire-time validation reuses the filter-range bound rules; MCP schema+result parity pinned) ·
ui (protocol 1.0→**1.1**: `EmissionKind` gains 'cell'; `clausePredicate` cell arm parity-pinned vs `matchesClause`;
`selfSelectedCell`; CommitLog says "price 100 – 150 and category = Formal", compare says "price between 100 and
150 and category is Formal") · capabilities (a view/renderer DECLARES 'cell' — `CapabilityDecl.encodings` +
`RendererCapabilities.emissionKinds`; the five classic charts, VizTable, and the VL bridge honestly do NOT, pinned;
the conformance kit gains the **cell arm**: a declaring renderer drives `cellGesture` and must land exactly ONE
compound commit with an addressable cell clause — hostile arms pinned). **VizHeatmap** (PRIM-1 primitives tier,
zero forked internals): host-computed 2-D cells (ONE `equalWidthBins` fixes x edges; `recountBins` per category
under crossfilter), the shared `rampStep` sequential ramp (`--vzf-seq-*`; VizMap refactored onto the now-public
primitive), zero-count cells wear the honest `--vzf-map-empty` neutral, keyboard-first cells, both axes re-encode
(x numeric/date, y category/numeric), adaptive row-label gutter (squeezed cockpit cells truncate honestly — full
names stay on tooltips/aria). v1 scope numeric/date × category is chart GEOMETRY only — the wire already carries
any side mix, so numeric×numeric needs zero wire change. Gallery: the heatmap is the 8th cockpit cell; the smoke
proves LIVE in real Chromium: one click = badge +1 exactly, BOTH constraints crossfilter (readout drops, scatter
dims), plain-words compound in the commit log, click-again releases both, zero scroll / zero console errors;
screenshots refreshed once (gallery-heatmap{,-dark,-crossfiltered}.png). demo-agent untouched (typechecks clean).
Gate: **1750 tests at 100/100/100/100**; all five typechecks clean. SHAs: core 275f9ba, agent cef1dd8, ui
39fbc93, gallery c504985, plus the D-record commit (those four say "D29" in their subjects/comments; the number
was already taken by foottrail above, so the decision tag is D30 — the D-record commit renames every in-code
reference).

## D31 [SHIPPED TL-1] the trail lifecycle — archive / restore / discard-from-here / adopt-path (never erase the record, erase the VIEW)
A branching analysis history accumulates dead ends, and every existing verb only ever ADDS. TL-1 gives the trail a
lifecycle without ever taking a step back out of the log. **The principle: never erase the record — erase the VIEW.
Refs move and hide; commits are forever, and the statistics remember.**

`src/branches` (the foottrail core, D29) gains three ref-events — `archive` / `restore` / `discard` — each carrying
the ACTOR that asked for it (`by`), because hiding or rewinding a line of work has an author, unlike the mechanical
create/advance bookkeeping. `BranchRefs.archive(name, by)` hides a ref from the default listing while KEEPING its
name and tip (`tipOf` still answers, so compare/why keep working on it); `restore` is the exact inverse;
`discardTo(name, commitId, keepAs, by)` moves a ref BACK and parks the abandoned future under a fresh,
immediately-archived ref in ONE journal transaction (create → archive → discard → attach), fully validated before
the first event is written so a rejection leaves the journal untouched. `branches({includeArchived})` and
`RefState.archived` expose the hidden set.

**The HEAD rule (the load-bearing design decision):** HEAD may never ride an archived ref. Archiving the path HEAD
is on DETACHES HEAD at that path's tip — you keep standing exactly where you were, but on no named path, so the next
act auto-creates a fresh named ref (the existing branch-on-act rule) instead of quietly re-advancing something you
just hid. Generalized after adversarial review into **the frozen-ref rule** (ONE rule, three refusals): an archived
ref is frozen where it was left, so every way of TOUCHING a ref refuses it — `switchTo`, `rename` (both: "restore it
first"), `discardTo` — and tip-extension SKIPS archived refs for the same reason. Archiving the LAST visible path is
a typed gap (nothing left to stand on). Two structural invariants fall out and are pinned by tests that walk a full
archive→rename→restore→rename→re-create→archive→act→discard sequence: **`_archived ⊆ _branches`** (never a stale
hidden name) and **HEAD is never on an archived ref**.

**Review fixes (post-ship, same packet).** (1) CONFIRMED BUG: `rename` moved the name in `_branches` and never
touched `_archived`, so renaming an archived path RESURRECTED it (visible, switchable, no `restore` event) and left
the old name stale in `_archived` — which made the next ref born under that name secretly archived, invisible in
`paths()`, with HEAD riding it; that also made the session's `discardTo` v8-ignore justification FALSE. Reachable
from session/tool/MCP/`/api/paths`. Fixed by the rename refusal above (nothing else deletes from `_branches`, so the
refusal is what makes the invariants total); the v8-ignore is true again and now cites them by name. Pinned at all
four surfaces. (2) `adoptPath`'s loop called `executePlan` unguarded — a replay runs REAL third-party code (an
analysis stage, a mounted adapter's `applyClause`) and a throw aborted the run, losing the per-step report and
turning the UI's `void view.adoptPath(...).then(...)` into an unhandled rejection with no toast. Now a throw is an
honest skip (`replaying this step threw: <message>`) + a typed gap, and the loop carries on. (3) The BranchMap
disables "Discard from here…" WITH the reason when the lane you stand on is itself archived (it was enabled and only
refused downstream). (4) `validateDashboardDef` now rejects a host view id in a reserved namespace
(`chart:`/`encoding:`/`analysis:`/`annotation:`/`layout:`, single-sourced from `src/branches/fold`) — such a view
would be inert in the fold, invisible to `compare`, and silently skipped by adopt. (5) Two-truths now pinned after a
DISCARD (not just archive), and `compare()` pinned against a commit strictly INSIDE a parked segment.

`src/session` grows four plain-named methods. `archivePath` / `restorePath` are thin, cursor-preserving wrappers
(hiding is a change of view, not of position). `discardFromHere({at, as})` picks the path to rewind: the one HEAD
rides when `at` is on it, else — while detached (the natural "step back, then discard" flow) — the single visible
path continuing past `at`; a commit on someone else's line ("only your own future is discardable"), a fork point
with two futures, and the tip you already stand on are all typed gaps. `adoptPath(name)` is MERGE BY REPLAY: every
step since the common ancestor is re-planned and re-landed IN ORDER through ordinary `dispatch` as a normal
`replayedFrom` commit — no new verbs, the existing planBringOver pipeline. Two rulings inside it: (1) every plan is
measured against where the adopt STARTED, so a conflict means "your path already touched this since the fork", never
"an earlier step of this same replay did"; (2) an agent-authored chart is honestly SKIPPED — a chart is *proposed*
through its governed pipeline, so replaying its commit would be a forgery. The per-step report is
`{commitId, applied, recipe?, landedAs?, conflicts, skippedReason?}` plus `{applied, skipped, conflicts}` counts. A
replayed analysis genuinely RE-RUNS and spends its own alpha (results are never copied across paths); degenerate on
the new path, it lands nothing and spends nothing. The source path is left untouched — archiving it is the user's
call. `paths({includeArchived})` lists the hidden rows flagged (`archived?: true`, present only when hidden, so a
plain listing keeps its old shape) and `overview().paths.archived` is the COUNT, keeping whats_here token-lean.

**Honesty invariants, each tested explicitly:** archive and discard never change global FDR wealth, the test count,
the discoveries, or a single ledger row (`expect(after.wealth).toBe(before.wealth)`); the two-truths ledger still
counts an ARCHIVED branch's tests globally while the cursor-local count stays honest; `branches()` (the DAG leaf
list) still sees both lineages — only the NAME was hidden; `compare()` and `why()` still accept an archived path and
its commit ids; a restore round-trips the full listing byte-identically; the FOLD-PROOF — after a discard the old
tip still folds byte-identically via `foldStateAt` and one restore brings its name back; and every lifecycle event
lands in the ref journal with its actor while the commit count is unchanged (bookkeeping is NEVER a commit).

Agent surface: the FIXED tool array is byte-identical across the whole lifecycle (Mode B, asserted); only the
`paths` schema's action enum grows (archive | restore | discard | adopt) plus `includeArchived` on list. The
descriptions teach the rule in authored constants, never runtime data (Q8), and every hiding action's RESULT carries
the new exported `HIDDEN_NOT_ERASED` = **"Hidden, not erased — the statistics remember."** — the same sentence the
UI shows a human, pinned byte-for-byte by a parity test. MCP parity asserted over a real in-memory client.

UI: `state.paths.archivedList` (the documented `/api/state` extension — a server serializes
`paths({includeArchived:true})` there); four adapter actions on the ONE `/api/paths` endpoint, three
fire-and-reconcile (a refusal shows up as a typed gap) and `adoptPath` reading its answer back through
`summarizeAdopt`, which never reports success for a refusal. `<PathsModal>` gets a per-row Archive with an inline
confirm and a "show archived (n)" reveal of greyed rows with Restore; new `<DiscardModal>` (the confirm, stating the
line verbatim) and `<AdoptToast>` (counts + "Why skipped?"); `<BranchMap>` hides archived lane LABELS by default
(the steps are always drawn) and gains "Discard from here…" (own-path only, never at the end — it only ASKS) and
"Adopt this path" on another path's tip, both disabled WITH the reason. Present mode omits the lifecycle handlers.

Found in the LIVE run and fixed: a discard parks the abandoned future under an auto-named ref, and the ForkToast was
announcing that as "Forked a new path" — the `discard` event names its `kept` path, so those creates no longer toast.

demo-agent: `/api/paths` takes the four actions (human-badged `user`), `/api/state` carries `archivedList`, the
analyst prompt learns step 7b (the actions + "read whats_here's fdr back afterward and you will see the same
numbers"), and one new chip — *"Clean up my dead ends — archive everything but this path."* **LIVE-VERIFIED with the
real key** on :5181: one real turn archived both dead ends and the model stated the rule in its own words ("Hidden,
not erased: both branches remain in the log… The statistics are untouched — FDR still shows 1 test, 0 discoveries,
same wealth as before"), with `{tests:1, wealth:0.0237488693390893, discoveries:0}` identical before and after, plus
a human discard-from-here round trip (restored), 5 records still in the log, zero console errors.

Gallery: four scenes prove it visually, including the ledger LINE asserted byte-identical across an archive and
across the whole discard round trip (the alpha-unchanged invariant where a person can read it) and the node count
unchanged when a lane is hidden (the fold-proof on screen). Screenshots refreshed once (gallery-archived-paths,
-archived-lanes, -discard-confirm, -adopt-toast). Gate: **1901 tests at 100/100/100/100**; all five typechecks clean.
SHAs: branches 6fe5809, session 5f13969, agent 9a7fc3b, ui b4f2be1, demo-agent b91cf08, gallery 07efdef, D-record
4e5bc15; review fixes b1422e3 (rename), 14301d3 (adopt throw-guard), 0d7579a (two-truths + parked compare), 00ade51
(BranchMap reason), bae5651 (reserved view ids).

## D32 [SHIPPED F3] the long-form series contract — `{t, entity, metric, value}` in, rows + declared encodings out

The F3 commitment ("a chart surface that consumes series with **no bespoke chart API**") is discharged by making a
long-form series a first-class *input* to the surface that already exists, not by adding a ninth chart. The renderer
contract already speaks rows + declared encodings (`ui/src/contract/types.ts` `RenderState.rows` / `.encodings`), so
`src/def/series.ts` is a converter and three declarations — zero engine, zero new verb, zero new commit kind.

**The surface** (all from `vizfootprint/def`): `SeriesPoint {t, entity, metric, value}` — `t` an ISO-8601 string
(lexicographic == chronological, the rule `<VizLine>` and `src/data`'s string interval predicate already ride);
`seriesToRows(points, {grain?}) -> SeriesSource {rows, encodings, entities, metrics, grain?, caption, skipped}`;
`seriesDataSource(source) -> DataSourceDef` (the `def.data[table]` slot); `seriesEncodingDecl(viewId, {facet?}) ->
ViewEncodingDecl` (the `'series'` view kind); `seriesCaption(grain) -> string | null`. Alignment with `LinePoint
{date, value, series}` is exact — `t`→date, `entity`→series — so `metric` is the one genuinely new field.

**The facet-vs-filter ruling: NEITHER is baked in, and that is the point.** `ViewEncodingDecl`'s grammar is
channel→**field name** (a `reencode` commit carries `field` = the channel, `value` = the target *field*). "Show only
the metric named `p95_latency`" pins a channel to a **value**, which that grammar cannot express — encoding it there
would give `initial` a second, value-carrying meaning, a breaking change to a grammar the session fold, `compare`
and `adoptPath` all read. So the `'series'` kind DECLARES `facet` in its channel vocabulary (`['x','y','color',
'facet']`, R14: declared, never guessed) but leaves it UNBOUND at the fold's root, and the two readings are reached
through verbs the session already has: **facet** = `reencode('facet' -> 'metric')`; **filter to one metric** =
`select` on the `metric` column (a plain point clause in `activeFilters`). Both are therefore already cause-tagged,
branch-scoped, replayable and seek-restorable, for free. `seriesEncodingDecl(viewId, {facet: true})` seeds the
faceted state at the root for a view that should start that way — the same state, without the commit.

Corollary: `SeriesSource.encodings` is **data-independent**. A two-metric series binds no facet channel either —
switching a view decision on "we happen to see two metrics" would be the converter inferring, which is exactly the
sin the grain rule below forbids. Cardinality is reported as a fact (`metrics`, `entities`, first-seen order) and
the view decides.

**Grain is stated, never inferred** — a row array cannot reveal that it was downsampled (100 daily means and 100 raw
readings are byte-identical in shape). `DataSourceDef.grain?: SeriesGrain {bucket?, reducer?, collapsedFrom?, note?}`
carries what the CALLER states (the triage contract's `grain`) as inert source metadata — it never touches a clause,
a commit or a query — R12-validated at the def boundary (exhaustive key set, strings echoed verbatim, one
non-negative finite count, nothing executable) and rendered by `seriesCaption` as one line under the chart. No stated
grain ⇒ `caption === null`: silence, never an invented "hourly mean". Malformed points (not an object, blank
`t`/`entity`/`metric`, non-finite `value`) are skipped and COUNTED (`SeriesSource.skipped`), the discipline
`<VizLine>` already applies to an unparseable date — a tool result is untrusted input and its bad entries surface
rather than vanish.

Gate: **1931 tests at 100/100/100/100** (30 new in `src/def/series.test.ts`, up from 1901); `npm run typecheck`
clean. Red-proved by in-place mutation and byte-identical restore, two rounds: (A) converter drops the canonical
encodings + caption inverted; (B) the `'series'` kind stops declaring `facet` and the R12 firewall stops validating
`grain` — round B failed exactly the 6 tests that name those behaviours and nothing else.

## Next
P3 packets per SPEC §12, order L1→L6; L1-L5 SHIPPED, L6 (why) remaining. Every packet = R#s + pre-written acceptance
tests + boundary + diff/test-output artifacts; orchestrator re-runs all tests. Fresh-chat rehydration: read THIS file + SPEC.md.
