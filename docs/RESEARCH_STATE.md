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
H4 SUPPORTED · H5 partial (machine-shaped slice proven; full minimal-set contract = L6 gate) · H6 OPEN (L5 A/B).
## CANONICAL open questions (authoritative — reconcile SPEC §10 to THESE)
Q3 = cite QUDE by DOI (venue-year label discrepancy; cosmetic).
Q4 = upstream two-slot cause to hcifootprint's one-slot Principal (atom/types.ts:33), later hcifootprint major.
Q6 = is the 7-verb dispatch vocabulary complete vs the DashboardQA task suite? (validate in L5).
Q8 = does echoed interaction-intent leak app content into the instruction channel? (two-string firewall check, L5).
Q9 = RESOLVED (e3ce924): RegisteredSource extends MosaicClient genuinely (base class inert without coordinator — MosaicClient.js:20-233 no-op defaults; instanceof satisfied). One deliberate cast remains in bench/x4 (benchmarks raw Mosaic, out of layer).
Q10 = LORD++ γ-constant choice (0.0722 paper vs 0.07720838 onlineFDR vs finite-horizon) — document at L4 promotion.
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
## Next
P3 packets per SPEC §12, order L1→L6; every packet = R#s + pre-written acceptance tests + boundary +
diff/test-output artifacts; orchestrator re-runs all tests. Fresh-chat rehydration: read THIS file + SPEC.md.
