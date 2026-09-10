# bench/step0-wasm — the two engines on one instrument

`bench/step0` measured the memory engine alone. This bench puts the **in-browser
engine** (DuckDB-WASM, opened in node — `src/data/duckdbConnection.ts`) beside it
on the **same rows**, through the **same `evaluate` calls**, under the **same
clock**, in **one process** — so the ratio between two cells is a fact about the
engines, not about two runs on two machines.

    npm run bench:step0-wasm            # writes wasm-results.json + wasm-table.md here
    node bench/step0-wasm/run.mjs /tmp   # …or the report anywhere else

It answers Q12 (`docs/RESEARCH_STATE.md`): *"auto-engine thresholds (rows/bytes
for memory→wasm→server) — measure with an X4-style bench, don't guess."*
`src/data/chooseEngine.ts` quotes this table and nothing else.

## The laws

**1. One instrument, or it is not a comparison.** Both engines are measured by
the same `timed` in `measure.ts`, on rows built once per size, in one process.
*Example:* the `COUNT` cell for 90k is `memoryProvider(rows).evaluate(and, {mode:'count'})`
and `wasmProvider({connection}).evaluate(and, {mode:'count'})` — the same
`WINDOWS.count` object handed to both, so neither engine can be asked an easier
question than the other.

**2. The controls come before the numbers.** A dead clock reports "no cost" in
exactly the voice of a fast implementation, and an engine that answered zero rows
posts the best time in every arm. So section 0 of the table is the clock read
against a deliberate 40 ms block, and the two engines' row counts for the bench
clause. *Example:* `both engines counted the same rows — 1M point AND interval |
3,080 vs 3,080 | YES`. If either says NO, every number under it is void.

**3. A failure is a measurement.** An engine that cannot land a size is recorded
as a ceiling with the backend's own words, in `failures[]`, and its cells are
absent from the table — never a crash, never a zero. *Example:* while the bundle
was being written outside the repo, the wasm half recorded
`Cannot find package '@duckdb/duckdb-wasm'` at every size and the memory half
still reported — which is how that packaging bug was found (`run.mjs` now keeps
the bundle in this folder for exactly that reason).

**4. The match count is constant across sizes, the table is not.**
`../step0/gen.ts` scales rows on the DISEASE axis, so the bench clause keeps
3,080 rows at 90,300, at 300,000 and at 1,000,000. *Example:* the 1M `COUNT` cell
is the cost of *finding* the same 3,080 rows in a table eleven times larger —
which is the only way a row-count threshold can be read across sizes at all.

**5. An arm one engine does not have is an em dash with a sentence.** *Example:*
`FIRST ask on a fresh table` exists only for the memory engine, whose sort
permutation is cached per spec; DuckDB keeps no permutation, so its every ask is
a first ask and the row above it already says what a first ask costs.

## The files

- `measure.ts` — the instrument: `createHarness().timed()` (warm-ups discarded,
  median + spread over the repetitions, `gc()` between samples), `spin()` for the
  positive control, and the CONTRACT both the bench and its acceptance test read:
  `ARMS` (the five arm names the table pairs engines by), `WINDOWS` (the exact
  `EvaluateOptions` each arm asks) and `benchClauses()` (one point + one interval,
  values off the wire).
- `bench-entry.ts` — the arms. Bundled by esbuild, run with `--expose-gc`.
- `run.mjs` — bundle + spawn + `wasm-results.json` + `wasm-table.md`.
- `table.mjs` — the renderer, its own module so it can be checked in a second.
- `wasm.test.ts` — the acceptance test, **written before the arms**: part A holds
  every instrument up to a known quantity (and runs in the repo's normal gate,
  opening one small real DuckDB); part B is skipped until a run writes
  `wasm-results.json` and arms itself the moment one does.

**6. The second number is the MAX, not a p95, until there are 20 samples.**
*Example:* at `reps: 3` a 95th percentile lands on the largest sample — the same
number, wearing a distribution's name. `spreadOf()` (`measure.ts`) picks the
label from `n`, the run log prints it, and the table prints it per cell; each
arm also records the warm-ups it actually discarded, because the load arms carry
their own budget (0–1) and the run-wide default was never true for them.

## Sizes and repetitions

Three sizes, because a threshold placed BETWEEN two measured points is a guess
wearing a number's clothes: **90,300** (the CDC cell shape), **300,000** and
**1,000,000**. `measure.ts`'s `SIZES` is the contract — rows, read repetitions
(7 / 5 / 3) and the load's own budget (3 / 3 / 2 repetitions, 1 / 1 / 0 warm-ups).
Any of them can be overridden per size: `STEP0W_REPS_90K`, `STEP0W_REPS_300K`,
`STEP0W_REPS_1M`, and `STEP0W_REPS_LOAD_<SIZE>` for the load. Two warm-ups are
discarded per arm otherwise. The load arm has its own budget because it opens a
**fresh database per repetition** — serialising 1,000,000 rows seven times is
minutes, not seconds. Every measurement records its own `n`.

## What it does not measure

- **A browser.** These numbers are node's blocking DuckDB-WASM bundle and node's
  JS engine. A browser pays a bundle download, has no `--expose-gc`, and runs the
  async bundle over a Worker. Read the ratios, not the absolute milliseconds.
- **The real CDC snapshot.** `gen.ts`'s rows are calibrated to its shape
  (70 jurisdictions, 86 weeks, the real `report_state` mix); this bench compares
  two engines on one row set, and `bench/step0` is where synthetic-vs-real was
  checked for the memory engine.
- **Memory.** Neither engine's footprint is sampled here. A row-count threshold
  set from these numbers is a LATENCY threshold; the byte thresholds in
  `chooseEngine` remain unmeasured and say so.
