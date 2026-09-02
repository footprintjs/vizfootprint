# Step 0 — measure before building (data-computation layer)

**Machine:** Apple M5 Pro, 48 GiB, macOS 26.5.1, **Node v22.16.0** arm64; one process, gc between reps. `performance.now()` around one call; 3 warm-ups discarded; **11 reps at 90k, 5 at 1M**; p95 = nearest rank. Full table (41 rows × 3 sizes): `step0-table.md`; raw `step0-results.json`; bench `bench/step0/run.mjs`.

## Medians / p95, ms

"90k" = the demo's actual 90,300 ETL'd cells (13 columns, the real arm). "1M" = 6-column synthetic cells calibrated to the real shape. Row layout (what the demo runs) unless stated.

| measurement | 90k | 1M |
|---|---:|---:|
| construct row store · column store | 9.0 / 9.4 · 22.6 / 26.0 | 65 / 66 · 112 / 116 |
| evaluate point (6,020 match), count · rows | 2.0 / 2.6 · 2.1 / 2.6 | 24 / 24 · 24 / 24 |
| evaluate AND point+interval (3,080), count · rows | 3.1 / 3.8 · 3.1 / 3.8 | 33 / 34 · 34 / 34 |
| evaluate null (whole table), count · rows | 0.9 / 1.1 · 2.1 / 2.1 | 11 / 12 · 19 / 20 |
| evaluate null, rows, **column** layout | 16.1 / 16.4 | 102 / 103 |
| fold rowCount+extent+distinct+groupCount | 3.7 / 3.8 | 28 / 29 |
| fold columnar+columnTypes (all cols) | 22.8 / 23.6 | 110 / 111 |
| fold keyedIndex, unique id per row | 4.2 / 4.2 | 56 / 65 |
| **gesture = 1 evaluate(AND, rows) + 1 fold(4)** | **3.2 / 3.7** | **34 / 41** |
| **sheet page = filter + slice + 8 header stats (AND)** | **3.5 / 4.3** | **34 / 35** |
| demo tick, 18 App.tsx passes: no clause · 2 clauses | 8.6 / 8.8 · 8.5 / 9.1 | 86 / 86 · 88 / 88 |
| demo: coverageData (5 passes) · diseaseData · weekData | 3.5 · 0.8 · 0.7 | 31 · 8.5 · 8.3 |
| server /api/state per poll: evaluate(AND, count) | 3.0 / 3.7 | 34 / 36 |

A synthetic 90k arm (6 columns) ran too: construction 5.0 / 10.5, evaluate and folds within 1 ms of real, demo tick 16.7 (no clause) / 7.0 (two clauses). foldOnce rows/second: 4 recorders 24.5 M/s (90k) → 35 M/s (1M); columnar+types 4.0 → 9.1 M/s; keyedIndex unique 21.7 → 17.9 M/s; a bare walk 174 → 184 M/s.

## Verdict against the exit rule

*"If every gesture stays under 50 ms at 90k rows with one evaluate call and one fold, no scheduler is needed for the current dashboard."*

**At 90k it holds, 13× under the line.** One two-clause evaluate (rows) plus one four-recorder fold over the answer: **3.2 ms median, 3.7 ms p95** on the real cells. The demo's whole per-poll client work — all 18 App.tsx passes — is **8.6 ms**; the server's per-poll count is 3.0 ms. By these numbers no scheduler is needed for the current dashboard at 90k.

**Crosses 50 ms at 90k: nothing. Crosses 200 ms: nothing.** Over 16 ms at 90k: column-store construction (22.6), the 13-column columnar+types fold (22.8), column-layout whole-table materialization (16.1; the row layout the demo uses is 2.1), and the synthetic no-clause tick (16.7; real 8.6).

**At 1M the picture splits.** The engine call stays under 50 ms — point 24, AND 33–34, gesture 34 median but **41 p95**, 9 ms of headroom. **Crosses 50 ms at 1M:** row-store construction (65), unique-key keyedIndex (56 / 65), the demo's per-tick folds (86–88), column-layout whole-table rows (102), columnar+types fold (110), column-store construction (112). **Crosses 200 ms: nothing.** At 1M the 50 ms line breaks on the client re-fold pattern (18 passes per poll) and on whole-table materializations, not on one evaluate + one fold.

## A virtual SHEET page fetch

Filter + slice 100 rows + 8 header stats (rowCount, extent, total, 4× distinct, groupCount) over the filtered rows:

- **90k: 2.9 ms (point) / 3.5 ms (AND); p95 3.5 / 4.3.**
- **1M: 25 ms (point) / 34 ms (AND); p95 25 / 35.**

The filter is the whole cost: `matchingIndices` scans every row with no early exit, so count mode (2.9 ms) and rows + slice (3.0 ms) are within noise and `limit: 100` buys nothing measurable. The slice is 0.00 ms; header stats are 0.3–0.9 ms and scale with the match count, not the table. `evaluate` has `limit` but no `offset`: a page at offset 5,000 materializes all matches then slices — 3.0 ms at 90k, 33 ms at 1M, the same as offset 0.

## Assumptions

1. Node/V8, one process, no browser: React render, chart drawing, main-thread contention and the `/api/rows` JSON transfer are not in these numbers (bench/x4 is the browser harness; this is not). gc() ran between reps — a browser tab gets no such courtesy; p95s are optimistic on GC.
2. Synthetic rows: 6-column cells schema, seeded (mulberry32, 42), calibrated from the demo ETL's real shape — 70 jurisdictions (57 state / 9 region / 4 total), 86 ISO weeks, report_state present 97.8 % / not-configured 1.8 % / unavailable 0.4 % / withheld 0 / unknown 0. Row count scales along the **disease** axis (15 diseases at 90,300; 166 at 1M), so match counts are identical at both sizes — the table grows, the answer does not.
3. Clause values are JSON-round-tripped (fresh strings, as off the wire).
4. Real rows are 13 columns wide, hence ~2× the synthetic construction/columnar cost; where the two arms disagree at 90k the real arm is the demo's ground truth.
5. The demo tick replays App.tsx's folds as plain loops, `keep` = `every()` over closures (the ui's `keepPredicate` shape), every useMemo recomputing per poll; `trendData` and `diseaseHighlight` excluded. Two clauses = point on jurisdiction + interval on t.
6. A "long task" here is one call over 50 ms.
