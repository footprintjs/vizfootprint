# bench/derive — what one derived column costs per row, and how far from the floor

`src/derive/walk.ts` takes one row through an expression tree. Before 
`compile` existed it walked the TREE on every row — an op lookup by name per
node, the op's `wants` re-judged against the argument cells per node, and a
fresh closure per arm per row for the four lazy ops. All of that is a property
of the tree, not of the row. This bench is the measurement that was taken
BEFORE any of it was compiled away, and the one that is re-run after, so the
README that quotes a speed-up quotes a number this folder produced
(`feedback_measure_before_claiming`; `bench/step0-wasm` is the template).

    npm run bench:derive              # writes results.json + table.md here
    node bench/derive/run.mjs /tmp    # …or the report anywhere else

## The laws

**1. The floor comes with the number.** A walk that is "fast" is fast relative
to something. Every expression here is also hand-written as a JS closure —
the way a person writes it in a `.map`, no tree — and measured on the same
rows under the same clock, so the table's last two columns say how far today
is from the floor nothing can beat. *Example:* at 1M rows the six-op tree
walked at 284 ms and its closure over the same reader ran in 35 ms: 8.15×,
which is the headroom that earned the compile (see "The decision").

**2. The floor is the same question.** A floor that computes a different
answer is a fast answer to a different question. `derive.test.ts` pins every
floor to the walker cell for cell on rows chosen to reach every arm — a
present row above and below the `case` threshold, a negative value (the
sign-preserving `round`), a silent row CARRYING a zero (the gate must turn it
absent), a `null` and a zero population, text where a number was declared, a
`Date`. And the bench itself refuses to print a size until all four paths agree
on every row of it with a present share strictly between 0 and 1 — a path that
answered absent everywhere posts the best time in every arm.

**3. Two floors, because the gap has two halves.** The walk reads through
`readerOver` — the absence law's reader, per-column gates decided once per
reader — and a compiled tree keeps that reader. So the floor **over the
reader** is the most a compile could reach, and the floor **over raw columns**
(the gate inline) is the whole distance. *Example:* `read` at 1M — a bare
column read, no tree at all — was 30.4 ms walked, 24.0 ms through the reader
by hand, 16.1 ms raw on the before run (`67720c6`): the reader is a third of a
bare read's cost, and no compile touches it.

**4. Best of N, with the noise stated.** Each cell is **best** · median / max.
The best is the sample with the least of anything else — a collection, a
page fault — charged to it, which is what a cost that is a property of the
code looks like; the median and the max beside it are what the machine added.
`gc()` runs between samples (`--expose-gc`); the run log prints every sample's
`n` and warm-up.

**5. The real door, not a toy.** Every walk arm calls `valuesOf` — the door
`deriveAnalysis` lands a column through (`src/derive/groups.ts`) — over the
Rows shape `deriveAnalysis` builds (one reader over a moving index) and over
`rowsOver(rows)`, the row-object door. A loop calling `evaluate` per row would
have measured a path no act takes.

**6. A number belongs to a commit.** `run.mjs` stamps `head` on the report
from a read-only `git rev-parse` (with `+dirty` when `src/derive` differs), so
a before and an after are never confused for two runs of one code.

## The files

- `measure.ts` — the instrument (`createHarness().timed()`: warm-ups
  discarded, best / median / max over the repetitions, `gc()` between
  samples; `spin()` for the clock's control) and the CONTRACT: `SIZES` (100k
  and 1M with their budgets), `EXPRESSIONS` (the three declarations),
  `ARMS` (the four path names the table pairs by), `nodesOf` (so "six op
  nodes" is a counted fact in the report).
- `rows.ts` — the table: seeded rows in the demo's `cells` shape with the real
  `report_state` mix, a `population` per jurisdiction (never zero), `cases`
  `null` on every silent row (the data door's own law), the absence
  declaration (`report_state` governs `cases` and nothing else, so `ratio`
  exercises a gated read AND a bare one), and `columnarRowsOf` — the Rows shape
  `deriveAnalysis` walks, copied here because it is built inline in a stage
  function there.
- `floors.ts` — the three trees by hand, over the reader and over the raw
  columns. Each column is read ONCE per row even where the tree names it
  twice (`tree6` reads `cases` under `div` and under `coalesce`) — a
  hand-written closure hoists, and the floor is the floor; a compiled tree
  keeps the tree's reads.
- `bench-entry.ts` — the controls and the arms. Bundled by esbuild, run with
  `--expose-gc`.
- `run.mjs` — bundle + spawn + `results.json` + `table.md`.
- `table.mjs` — the renderer, its own module so it can be checked in a second.
- `derive.test.ts` — the acceptance test: part A holds every instrument up to
  a known quantity and runs in the repo's normal gate; part B is skipped until
  a run writes `results.json` and arms itself the moment one does.

## The three expressions

| name | tree | op nodes / leaves |
|---|---|---:|
| `read` | `cases` | 0 / 1 |
| `ratio` | `div(cases, population)` | 1 / 2 |
| `tree6` | `case(gt(div(cases, population), 0.001), 'high', cast(round(coalesce(cases, 0)), 'string'))` | 6 / 7 |

The judge accepts all three (a control in the report says so per run);
`tree6` lands as a `string` column.

## The decision this bench forced

The brief (`aa-plan-brief`): compile the tree once into a closure tree ONLY if
the bench shows at least 20% to win at 1M on the six-op tree. It showed 8.15×
between the walk and the same tree by hand over the same reader — 88% of the
walk's time was the tree, not the row — so the compile shipped
(`src/derive/walk.ts` · `compile`; `src/derive/README.md` quotes the before
and after from this bench).

## What it does not measure

- **A browser.** Node's JS engine with `--expose-gc`. Read the ratios.
- **The grouped walk.** Every expression here is a row column; the two-pass
  fold (`groupRowsOf`, the `where` filter, the reducers' argument walks)
  compiles once per expression the same way, but its per-row cost is the
  tallies' and is not on this table.
- **Memory.** No footprint is sampled.
