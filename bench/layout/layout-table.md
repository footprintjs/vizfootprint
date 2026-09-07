node v22.16.0 · darwin arm64 · 2026-09-07T07:48:26.376Z

**Units.** time = milliseconds (performance.now wall clock) · memory = bytes (process.memoryUsage; heapUsed EXCLUDES typed-array backing stores, which land in arrayBuffers) · stress = dimensionless weighted mean squared residual at the optimal scale, normalized by the counted pairs (0 is exact, 1 is every node on one point)
Seed 42 · stress sampled from 64 BFS sources · 1 warm-up call discarded per phase.

### 0 · controls — are the instruments alive?

| instrument | asked | read | live |
|---|---:|---:|---|
| clock (a deliberate block) | 40 ms | 40.016 ms | YES |
| stress metric — 12x12 grid (BFS distance == Manhattan distance, so the grid coordinates are a known-good embedding) | scrambled ≫ truth | 0.568866 vs 0.01533 = 37.11× | YES |

> Both controls fired. The numbers below are readable.

### 1 · the phases

| nodes | edges | reps × iterations | adjacency | all-pairs (bench) | all-pairs (`distancesOf`) | place | place / iteration |
|---:|---:|---|---:|---:|---:|---:|---:|
| 1,000 | 2,919 | 3 × 30 | 0.355 ms | 18.499 ms | 18.494 ms | 163.989 ms | 5.466 ms |
| 10,000 | 29,195 | 1 × 30 | 2.135 ms | 2,272.814 ms | REFUSED | 23,049.576 ms | 768.319 ms |

Medians; p95 is in `layout-results.json`. `distancesOf` REFUSED means the size is above the implementation’s cap — the bench’s own cap-free all-pairs is what makes that row measurable at all. CRASHED is not a refusal: it is a defect.
- 10,000 nodes: a stress layout needs exact all-pairs distances, which is one 10000 × 10000 matrix: this graph has 10000 nodes and the ceiling is 5000 — filter the nodes down, or lay the graph out in pieces

### 2 · what the cap costs — the memory the matrix needs

| nodes | distance matrix (`n × n × 2` bytes) | max sampled RSS | max sampled array buffers | max sampled heap | graph diameter (longest finite hop distance) | disconnected pairs (ordered cells) |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 1.9 MiB | 76.5 MiB | 13.4 MiB | 11.9 MiB | 7 | 59,052 |
| 10,000 | 190.7 MiB | 493.3 MiB | 381.9 MiB | 33.1 MiB | 9 | 5,909,510 |

Declared cap in `src/analysis/layout.ts`: **5,000 nodes**. The **distance matrix** and **max sampled RSS** columns are the evidence it has to answer to; the array-buffer column is where the matrix actually lives. Max sampled heap EXCLUDES typed-array backing stores, so the matrix does not appear in it, and every sampled column is the largest of four readings taken BETWEEN phases — not a peak over the run.

### 3 · quality — did the iterations do anything?

| nodes | placed mean stress | scrambled mean stress | ratio | pairs counted | pairs skipped (no finite distance or position) |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.185541 | 0.264836 | 1.43× | 59,111 | 4,825 |
| 10,000 | 0.185585 | 0.223866 | 1.21× | 611,038 | 28,898 |

Scored by `bench/layout/measure.ts`, which shares no code with the layout. A ratio at or below 1 means the iterations bought nothing.

### 4 · the graph the layout was handed, and what it made of it

| nodes | edge rows | giant component | used | rows dropped (unknown endpoint or self-loop) | bench agrees |
|---:|---:|---:|---:|---:|---|
| 1,000 | 2,919 | 970 | 2,919 | 0 | yes |
| 10,000 | 29,195 | 9,700 | 29,195 | 0 | yes |

### 5 · one whole analysis run

205.256 ms at 1,000 nodes over 2,919 edge rows — one cold call (no warm-up): the flowchart, the commit and the column write, on top of the phases above.

