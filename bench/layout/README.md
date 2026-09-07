# bench/layout — measure before the layout exists

The stress layout writes `x` and `y` onto the nodes table as ordinary derived
columns, at an act's slot, so a replay rebuilds the same positions from bytes
alone. Two numbers decide whether that is a good idea, and neither may be
guessed:

1. **How much does it cost?** Adjacency, exact all-pairs, and the SGD
   iterations, at 1,000 and 10,000 nodes.
2. **What is the CAP?** Exact all-pairs is `n × n`. Above some node count it
   stops being reasonable and the analysis must refuse in a sentence naming the
   number. **This bench is where that number comes from.** Until it has run,
   no cap, no millisecond and no stress value belongs in a README, a commit
   message or a refusal sentence.

This folder was written **before** `src/analysis/layout.ts` — the acceptance
first, the harness second, the implementation third. Nothing here writes to
`src/`, and nothing in `src/` may import from here.

    npm run bench:layout            # writes layout-results.json + layout-table.md
    npx vitest run bench/layout/layout.test.ts

## About the numbers on this page

There are no layout numbers yet, and there will not be until
`src/analysis/layout.ts` exists and `npm run bench:layout` has run against it.

The figures quoted below come from a **rehearsal**: the harness driven end to
end at 200 and 400 nodes against a throwaway stub that lived in a scratchpad and
was deleted, with its cap deliberately set to 300. They are here for one reason
— to show what a working instrument reads, including the ratio of **1.00×** the
bench gave that stub's crude layout. Do not quote them as the layout's cost, its
quality or its cap. The only numbers that may ever be quoted for those are the
ones in a generated `layout-table.md`.

## The laws, in order

### 1 · A dead instrument reports "no cost" in the same voice as a fast one

So every report opens with **positive controls**, and the acceptance test
asserts the same two facts:

- **The clock.** A deliberate 40 ms block must read back as ~40 ms. Without
  this, a phase printing `0.00 ms` is indistinguishable from a phase nobody
  measured.
- **The stress metric.** On a *k×k* grid the BFS distance IS the Manhattan
  distance, so the grid coordinates are a good embedding — known without any
  layout code. `stressOf(grid coordinates)` must therefore score far below
  `stressOf(scrambled)`. The rehearsal measured **37×** on a 12×12 grid.

`controls.live: false` in the results voids every number under it, and the
generated table says so in place of the tables.

Example — the control that would have caught a rubber-stamp. A deliberately
crude circle layout, run through the whole harness, scored:

| nodes | placed mean stress | scrambled mean stress | ratio |
|---:|---:|---:|---:|
| 200 | 0.303955 | 0.303096 | **1.00×** |

A ratio of 1 is the bench saying *the iterations bought nothing*. That is the
reading a working bench must be able to produce.

### 2 · The instrument shares no code with the thing it measures

`measure.ts` carries its own adjacency, its own BFS, its own all-pairs and its
own stress metric. When the implementation's numbers agree with the bench's,
they agree because two independent implementations agree — not because one
function was called twice. The report prints `agreesWithBench` per size.

Example: `adjacency.used` (from `src`) and `benchUsed` (from `measure.ts`) are
both reported, and the table's last column reads `NO — the two adjacencies
disagree` when they part company.

### 3 · The bench's all-pairs has NO cap, because it is what justifies the cap

A bench that inherited the layout's cap could never measure the size that
proves it. So phase 2 is measured **twice** per size: once with `measure.ts`'s
cap-free `allPairsOf`, once with the real `distancesOf` — which may refuse, and
the refusal is itself a result.

Example, from the rehearsal (cap deliberately set to 300):

| nodes | all-pairs (bench) | all-pairs (`distancesOf`) |
|---:|---:|---:|
| 200 | 0.594 ms | 0.686 ms |
| 400 | 2.318 ms | REFUSED |

`- 400 nodes: exact all-pairs is capped at 300 nodes; this graph has 400`

The same trick feeds `place` the bench's distance matrix, so the 10,000-node
iteration cost is measurable on a day when `distancesOf` refuses there.

### 4 · The data is seeded, so a number can be produced again

`gen.ts` builds nodes and edges from one `mulberry32` stream. Same seed, same
rows, byte for byte, on any machine. The bench carries its own copy of the PRNG
rather than importing `src/fdr/rng.ts`, so a change in the library cannot move
the bench's data out from under a published number (the `bench/step0/gen.ts`
precedent).

Example: `synthesizeGraph({ ...DEFAULT_SHAPE, nodes: 400 }, 42)` twice gives
identical `JSON.stringify(edges)`; seed `43` does not. The acceptance asserts
all three.

The graph is deliberately not one clean blob — a spanning tree guarantees a
giant component, chords thicken the GIANT to mean degree 6, and a fringe of
pairs and isolates exercises the disconnected rule (`d = maxFinite + 1`). Read
`meta.avgDegree` with that in mind: it is `2E/V` over ALL nodes, fringe
included, so at `giantShare` 0.97 a target of 6 over the giant reports about
5.84 over the whole table — two denominators, one name. A layout only
ever measured on a connected graph has not been measured on the graphs people
actually hand it.

### 5 · The acceptance is written first, and arms itself

`layout.test.ts` has two parts. **Part A** (the instruments) runs today and must
be green today. **Part B** (the layout) is skipped while
`src/analysis/layout.ts` is absent and arms itself the moment that file lands —
the probe reads the real path through `contract.ts`, so it cannot rot into a
permanent skip. While it sleeps, one test prints `PENDING: …` naming exactly
what is missing, because a silent skip is how a bench-first acceptance becomes a
bench nobody ever armed.

Example — what Part B holds the implementation to:

- the same seed and the same rows give **byte-identical** positions, and a
  different seed gives a different layout;
- the placed layout beats the scrambled baseline by at least **3×** on the
  bench's own metric;
- `distancesOf` refuses above `LAYOUT_NODE_CAP` in a sentence quoting both the
  cap and the offending size, **before** anything `n × n` is allocated;
- a node given a finite `x0`/`y0` and `anchored` keeps its exact position (the
  mental map, Misue 1995);
- edge rows whose endpoint is not a node are **counted**, never silently used;
- the disconnected rule holds: the largest distance in the matrix is exactly
  `maxFinite + 1`.

## What is measured, and in what units

**Time** is milliseconds of wall clock from `performance.now()`.
**Memory** is bytes from `process.memoryUsage()` (`rss` and `heapUsed`).
**Stress** is dimensionless: the weighted mean squared residual
`Σ w (α·r − d)² / counted` with `w = d⁻²`, `r` the Euclidean distance, `d` the
graph distance, and `α` the optimal uniform scale — so a layout drawn in a
different unit is not punished for its units. Without `α`, "draw it in a smaller
box" would beat "get the shape right".

| section | what it answers |
|---|---|
| 0 · controls | clock read; grid-vs-scramble ratio; `live` |
| 1 · the phases | adjacency / all-pairs (bench and real) / place, median + p95, and ms per iteration |
| 2 · what the cap costs | `n × n × 2` bytes for the matrix, max sampled RSS / array buffers / heap, the graph diameter, disconnected pairs (ordered cells) |
| 3 · quality | placed vs scrambled mean stress, the ratio, pairs counted and skipped (no finite distance OR no finite position) |
| 4 · the graph | edge rows, giant component, used and dropped endpoints, whether the two adjacencies agree |
| 5 · one analysis run | the flowchart + commit + column write on top of the phases — one cold call, judged `ok` before its clock is quoted |

Stress is folded over a seeded **sample** of BFS sources (64 by default) — at
10,000 nodes the full pair set is 50 million pairs, and the sample is stated in
the output (`stressSources`, `counted`, `skipped`) rather than implied.
Disconnected pairs are **skipped and counted**, following the fold's
`{ total, counted, skipped }` shape; the substitution rule belongs to the
layout, and an instrument that JUDGES must not copy it. The bench's own
all-pairs (§4 of `measure.ts`) does copy it, on purpose and for the opposite
reason: that matrix is the layout's INPUT, not the bench's verdict, and an
oracle handing `place` a different rule would be timing a different algorithm.

A reading that counted NOTHING reports `NaN`, never 0 — 0 is the score of a
flawless embedding, and an unmeasured layout must not wear it. The same rule
governs the clock: `stats` refuses an empty sample rather than minting a median
of 0, and a plan that cannot be timed (`reps` 0, a stray comma, a typo) is
refused by `planOf` before an arm runs.

**Memory, read carefully.** The distance matrix is a `Uint16Array`, and V8
accounts a typed array's backing store outside the JS heap — so `heapUsed` is
structurally blind to the one allocation the cap exists to bound. The
array-buffer column is what `matrixBytes` may be compared against; RSS is the
other honest column. Every sampled byte column is the largest of four readings
taken BETWEEN phases, not a peak over the run — nothing samples inside a phase.
Sizes print in **MiB** (the divisor is 2²⁰), so the numbers agree with the byte
formula printed beside them.

## The contract the bench requires

`contract.ts` is the one file that names the seam. `src/analysis/layout.ts` must
export:

| export | what it is |
|---|---|
| `adjacencyOf(nodes, edges, {key, from, to})` | phase 1 — the undirected graph, with `total` / `used` / `dropped` counters |
| `distancesOf(adjacency)` | phase 2 — exact all-pairs by unweighted BFS; refuses above the cap |
| `place({distances, seed, iterations, x0?, y0?, anchored?})` | phase 3 — the seeded SGD stress iterations |
| `LAYOUT_NODE_CAP` | the node ceiling the refusal sentence quotes |
| `layoutAnalysis(options)` | the builtin factory, for the one end-to-end run |

The phases are required *separately from the analysis* because the cap is a cap
on all-pairs and the analysis will refuse above it — only cap-free primitives
can be measured at the size that decides the cap. If packet 3 lands these under
different names, `contract.ts` is the file that changes, one line per name.

The end-to-end analysis arm calls the contract as declared —
`run(rows, { related: { edges } })`, the related rows on the SECOND argument —
and judges `result.ok` before it quotes the clock. A one-argument call would
read no edges and time the layout of 1,000 unconnected nodes; a resolved call is
not a run either, since a pre-run honesty gate resolves in about no time. It
never reports a number it did not get.

## Where the code lives

| file | one job |
|---|---|
| `gen.ts` | the seeded synthetic graph, and the grid whose good layout is known |
| `measure.ts` | the instruments: clock, BFS, adjacency, cap-free all-pairs, stress, the scramble baseline |
| `contract.ts` | what `src/analysis/layout.ts` must export; the landed-yet probe; the one PENDING sentence |
| `layout-entry.ts` | the measurements; prints one JSON object |
| `table.mjs` | results object in, markdown report out |
| `run.mjs` | refuse-if-not-landed, check the contract's exports, bundle, spawn, write `layout-results.json` + `layout-table.md` |
| `table.test.ts` | the renderer's acceptance: one live results object, one full of refusals and voids |
| `layout.test.ts` | the acceptance: part A today, part B the day the layout lands |

## Knobs

| variable | default | what it changes |
|---|---|---|
| `LAYOUT_BENCH_PLAN` | `1000:3:30,10000:1:30` | `nodes:reps:iterations` per arm |
| `LAYOUT_BENCH_SEED` | `42` | the graph seed and the layout seed |
| `LAYOUT_BENCH_SOURCES` | `64` | BFS sources the stress metric samples |

Every one of these is judged: a plan part that is not three whole numbers is
refused in a sentence that quotes it. Exit codes: **2** the layout has not
landed (or does not export what `contract.ts` names), **3** the run finished but
a control did not fire — both artefacts are written first so the failure stays
debuggable, and the non-zero status stops a chained caller from publishing a
report whose instruments were dead.

The big arm runs once on purpose: SGD stress is O(n²) per iteration, so 10,000
nodes is 50 million terms per pass. One repetition of the real thing beats three
repetitions of something smaller pretending to be it. One warm-up call is
discarded per phase.

Node only — `bench/x4` is the browser harness. Never edits `src/`.
