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

**6. The second number is the MAX, not a p95, until there are 20 samples.**
*Example:* at `reps: 3` a 95th percentile lands on the largest sample — the same
number, wearing a distribution's name. `spreadOf()` (`measure.ts`) picks the
label from `n`, the run log prints it, and the table prints it per cell; each
arm also records the warm-ups it actually discarded, because the load arms carry
their own budget (0–1) and the run-wide default was never true for them.

## The two arms that were named and deferred — read this before their numbers

**7. A moving brush is the one arm no cache can answer.** The memory engine's
sort permutations are cached per SORT SPEC (`memoryProvider.ts` · `permutationFor`),
never per clause; DuckDB keeps no result cache across statements. So an interval
whose bounds move — the crossfilter's real gesture — is judged from the rows on
every ask, in both engines, and that is what `brush` measures: `brushSequence()`
(`measure.ts`) takes `benchClauses()`'s interval as ask 0 and slides it one week
per ask for `BRUSH_ASKS` = 20 asks, the point clause held still so the match
count stays 3,080 across the sweep (law 4). It is reported twice on purpose:
`brush` is the TOTAL of one sweep as one timed call (the gesture's cost);
`brushAsk` times each ask of one further sweep as its own sample — n = 20, which
is exactly where law 6 lets the spread be called a p95 — because a per-ask
median is not a total divided by twenty. *Example (2026-09-11):* at 90,300 rows
the whole sweep is 60 ms in memory and 44 ms in DuckDB, and one ask of it is
3.0 / 3.5 ms — within noise of the `window` arm (3.0 / 3.8 ms), which is the
point: a brush is twenty fresh windows, and neither engine has a shortcut for the
twenty-first, so the `window` row already says what one ask costs and the sweep
row says what the gesture costs. One thing the two rows disagree about, and it is
the INSTRUMENT'S: DuckDB's asks inside the sweep average 2.2 ms at 90k (3.9 at
300k, 8.2 at 1M) while its per-ask sample — taken, like every sample, right
after a `gc()` — is 3.5 (5.4, 9.5). A full collection costs DuckDB's next
statement about a millisecond that a stream of statements never pays; the memory
engine shows no such gap. Read the sweep for the gesture, the per-ask row for
the cold single ask, and never divide one by twenty to get the other.

**8. A wide projection is where the wire is paid for.** `rows, limit 100` on a
table of thirty columns — `widen()` (`measure.ts`) adds four of each of six
generated families to the bench's six columns, named for the type DuckDB's
`DESCRIBE` gives them through the shipped rows port, MEASURED and not assumed:
`int_N` BIGINT, `dec_N` DOUBLE, `date_N` DATE, `ts_N` TIMESTAMP, `str_N` VARCHAR,
`bool_N` BOOLEAN. Two of the brief's six were not what the port lands, and both
are findings, not fixes: a fractional JSON number is a **DOUBLE, never a
DECIMAL** (`castDecimalToDouble` never fires on this path), and a
`Date#toISOString()` value — `2025-03-04T10:20:30.000Z` — lands as **VARCHAR**,
not TIMESTAMP (`read_json_auto` types `…T10:20:30Z` and `… 10:20:30.123` as
TIMESTAMP, and the millisecond-plus-`Z` form as text; the CSV reader types that
same form TIMESTAMP WITH TIME ZONE), so the bench's instants are written at
second precision to have a TIMESTAMP on the wire at all. The wide arm's own ratio
is printed under each size — `wide ÷ window`, per engine — because that is the
number the arm exists for: the price of twenty-four more columns, everything
else held equal. The memory engine hands a row back BY REFERENCE
(`memoryProvider.ts` · `rowAt`, no projection), so its width cost is the
predicate scan over a heavier heap, not the rows; DuckDB converts every cell of
every returned row (`wasmProvider.ts` · `withoutRowOrder` for the dates,
`castBigIntToDouble` for the integers) and also runs its COUNT statement over
the wider table. *Example (2026-09-11):* `wide ÷ window` is memory 1.32× /
1.58× / 2.04× and DuckDB 1.56× / 1.33× / — at 90k / 300k / 1M — so past 90k the
MEMORY engine is the one that pays more for width: its scan walks thirty-column
objects (a heavier heap, and construction sites that have now seen two shapes —
law 9), while DuckDB's column store scans the same two columns whatever the
width and pays only the hundred rows' conversion, about 1.5–2 ms.

**9. The wide table is the LAST shape the process learns.** The wide arms run
as a second pass after every six-column arm at every size — not inside each
size — because the memory engine's construction and fold sites
(`memoryProvider.ts` · `toRowStore`, `fold.ts` · `foldOnce`) are shared by every
table one process builds, and once V8's inline caches there have seen a second
row SHAPE they stay polymorphic. Measured 2026-09-11 with the wide table built
inside the 90k pass: the 300k and 1M memory LOAD arms came back **+52% and
+53%** (33 ms against 22 ms; 111 ms against 78 ms) against the same code with
the wide arm removed, on the same machine in the same hour. A six-column number
may not carry a thirty-column table's JIT history. The consequence is also a
finding: a dashboard that builds two tables of different shapes in one page pays
the same polymorphism on the second one, and this bench's wide memory numbers
are taken in exactly that state.

**10. The rows port has a ceiling, and the wide arm found it.** At 1,000,000
rows × 30 columns the wasm cell is a recorded ceiling, in the backend's words:
`Invalid string length`. `sqlConnectionOver.load` (`duckdbConnection.ts`)
serialises `{ kind: 'rows' }` as ONE `JSON.stringify` of the whole table, and V8
caps a string at 2²⁹ − 24 characters (≈ 512 MiB); a wide row is ~620 bytes of
JSON, so a million of them are ~593 MiB and the port throws before DuckDB sees
a byte. The six-column table (~130 MiB) never met it. Two things follow, and
neither is this packet's to change: `{ kind: 'csv' }` registers its text as-is
and would not hit it; and `chooseEngine` routes any table past 300,000 rows to
this very port, so a wide row-object table that `auto` sends to wasm cannot be
landed there today — the threshold question that raises is written down in
`src/data/README.md` and left for its own packet.

## The files

- `measure.ts` — the instrument: `createHarness().timed()` (warm-ups discarded,
  median + spread over the repetitions, `gc()` between samples), `spin()` for the
  positive control, and the CONTRACT both the bench and its acceptance test read:
  `ARMS` (the arm names the table pairs engines by — the five it shipped with,
  plus `brush`, `brushAsk` and `wide`), `WINDOWS` (the exact `EvaluateOptions`
  each arm asks), `benchClauses()` (one point + one interval, values off the
  wire), `brushSequence()` (that interval sliding one week per ask, `BRUSH_ASKS`
  times) and `widen()` (the same rows at `WIDE_COLUMNS` = 30, `WIDE_FAMILIES`
  naming what DuckDB calls each generated family).
- `bench-entry.ts` — the arms. Bundled by esbuild, run with `--expose-gc`.
- `run.mjs` — bundle + spawn + `wasm-results.json` + `wasm-table.md`.
- `table.mjs` — the renderer, its own module so it can be checked in a second.
  It pairs the wide arm with the window arm BY NAME, read off the report's own
  `arms` (the `ARMS` contract as the bench wrote it — a plain `.mjs` cannot
  import `measure.ts`, and a copied literal would silently stop matching), and
  prints every recorded ceiling in the backend's words above the sizes.
- `wasm.test.ts` — the acceptance test, **written before the arms**: part A holds
  every instrument up to a known quantity (and runs in the repo's normal gate,
  opening one small real DuckDB); part B is skipped until a run writes
  `wasm-results.json` and arms itself the moment one does. Both parts know the
  two later arms: part A holds `brushSequence` to a sweep that keeps its match
  count and `widen` to a table whose cells mean the same thing out of both
  engines (and whose `DESCRIBE` says the wire types `WIDE_FAMILIES` claims);
  part B accepts a wasm cell's absence only beside a ceiling in `failures[]`
  that covers it — a base landing that failed covers every arm, a wide landing
  that failed covers the wide arm alone.

## Sizes and repetitions

Three sizes, because a threshold placed BETWEEN two measured points is a guess
wearing a number's clothes: **90,300** (the CDC cell shape), **300,000** and
**1,000,000**. `measure.ts`'s `SIZES` is the contract — rows, read repetitions
(7 / 5 / 3) and the load's own budget (3 / 3 / 2 repetitions, 1 / 1 / 0 warm-ups).
The brush's per-ask arm is the one exception to the read budget: its samples are
the 20 asks of one sweep (n = 20, no warm-up — the sweep arm before it is the
warm-up), so that its spread is a real p95.
Any of them can be overridden per size: `STEP0W_REPS_90K`, `STEP0W_REPS_300K`,
`STEP0W_REPS_1M`, and `STEP0W_REPS_LOAD_<SIZE>` for the load. Two warm-ups are
discarded per arm otherwise. The load arm has its own budget because it opens a
**fresh database per repetition** — serialising 1,000,000 rows seven times is
minutes, not seconds. Every measurement records its own `n`.

## The re-run of 2026-09-11, and what moved

The five original arms were re-run four times on 2026-09-11 (same node, same
machine — an Apple M5 Pro — with other work on the box: 1-minute load averages of
2.3 to 7.9 across the runs, against an unrecorded load on 2026-09-10). Against
the checked-in 2026-09-10 report, with "within noise" meaning the two
`[min, spread]` ranges overlap: **13 of 27 cells reproduced and 14 moved, every
one of them slower**, by 3–27% in the run kept here (the quietest, load 2.3 at
its start) — the DuckDB `window` arm at every size (+27 / +20 / +15%), the
memory `sorted` arm at 300k and 1M (+17 / +18%), `sortedFirst` at every size
(+5 / +15 / +14%), and shifts of 3–10% in DuckDB's load, count and sorted cells
and the 1M memory count. **The same cells
moved by the same amounts when the 2026-09-10 code was run unchanged in the
same hour** (that control is how law 9 was found), so this is the machine's
day, not the bench's code — and it is why the report carries the load average
in this section rather than a claim that the numbers are the same. The memory
`load` arm, which law 9's ordering protects, reproduced at every size
(6.46 / 21.5 / 74.9 ms against 6.45 / 21.7 / 72.7).

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
