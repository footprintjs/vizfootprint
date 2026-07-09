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
## Next
P3 packets per SPEC §12, order L1→L6; L1-L5 SHIPPED, L6 (why) remaining. Every packet = R#s + pre-written acceptance
tests + boundary + diff/test-output artifacts; orchestrator re-runs all tests. Fresh-chat rehydration: read THIS file + SPEC.md.
