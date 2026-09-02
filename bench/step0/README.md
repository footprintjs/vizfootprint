# bench/step0 — measure before building

Step 0 of the data-computation layer plan: how much do the memory engine
(`src/data/memoryProvider.ts`), `foldOnce` (`src/data/fold.ts`), a
virtual-sheet page fetch and the demo's per-poll JS folds cost at 90,300 and
1,000,000 rows, on this machine, under plain Node.

    STEP0_SNAPSHOT=../vizfootprint-demo/data/nndss/snapshot.csv node bench/step0/run.mjs [outDir]

Writes `step0-results.json` and `step0-table.md` (median / p95 per size).
`STEP0_SNAPSHOT` adds the real 90k arm (the demo's ETL); without it the
synthetic arms run alone. `STEP0_REPS_90K` / `STEP0_REPS_1M` set repetitions
(defaults 11 / 5; 3 warm-ups discarded).

- `gen.ts` — seeded synthetic cells (disease, jurisdiction, kind, t, cases,
  report_state), calibrated to the real snapshot's shape; row count scales on
  the disease axis so per-clause match counts stay constant across sizes.
- `bench-entry.ts` — the measurements (construct, evaluate, fold, gesture,
  page, demo-tick). Bundled by esbuild like bench/x4, run with `--expose-gc`.
- `run.mjs` — bundle + spawn + table.

Node only — bench/x4 is the browser harness. Never edits `src/`.
