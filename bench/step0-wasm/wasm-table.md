node v22.16.0 · darwin arm64 · 2026-09-12T02:47:24.360Z

**Units.** every cell is the wall time of ONE call: median / spread in ms, `performance.now()` around it — the spread is the MAX for an arm with fewer than 20 samples (a p95 there is the largest sample under another name) and the p95 above that.
Repetitions {"90k":7,"300k":5,"1M":3} · warm-up discarded, per arm: construct / load the table = 0/1 · COUNT — point AND interval = 2 · rows, limit 100 — point AND interval = 2 · rows, ORDER BY cases DESC, limit 100 — repeat asks = 2 · rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart = 2 · rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) = 0 · rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table = 0/1 · rows, limit 100 — point AND interval, ALL 30 columns of the wide table = 2 · gc between samples EXPOSED.

### 0 · controls — is the instrument alive?

| control | asked | read | live |
|---|---:|---:|---|
| clock — a deliberate block | 40 ms | 40.0 ms | YES |
| both engines counted the same rows — 90k point AND interval | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 300k point AND interval | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 1M point AND interval | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 90k point AND interval, wide (30 columns) | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 300k point AND interval, wide (30 columns) | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 1M point AND interval, wide (30 columns) | memory = wasm | 3,080 vs 3,080 | YES |
| wide table — what DuckDB says its 30 columns are | DESCRIBE | VARCHAR ×17 · BIGINT ×5 · DOUBLE ×4 · BOOLEAN ×4 | — |

### 1 · 90k — 90,300 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 6.04 / 6.22 | 296 / 296 | 49.0× |
| COUNT — point AND interval | 4.11 / 6.57 | 1.79 / 2.30 | 0.44× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 3.02 / 4.07 | 3.81 / 3.99 | 1.26× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 6.00 / 6.99 | 3.79 / 4.11 | 0.63× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 58.3 / 59.3 | 43.0 / 44.0 | 0.74× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 2.96 / 4.10 | 3.36 / 3.60 | 1.14× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 32.9 / 33.5 | — | — |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 3.81 / 5.36 | 5.13 / 5.69 | 1.35× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.26× · wasm 1.35×*

### 2 · 300k — 300,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 21.1 / 21.9 | 418 / 603 | 19.8× |
| COUNT — point AND interval | 9.72 / 10.8 | 2.96 / 3.03 | 0.30× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 9.88 / 11.1 | 5.11 / 5.47 | 0.52× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 23.9 / 24.6 | 6.46 / 8.99 | 0.27× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 193 / 196 | 73.9 / 74.5 | 0.38× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 9.83 / 11.0 | 4.93 / 5.02 | 0.50× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 123 / 125 | — | — |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 14.3 / 18.3 | 6.71 / 7.37 | 0.47× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.45× · wasm 1.31×*

### 3 · 1M — 1,000,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 72.1 / 74.9 | 879 / 905 | 12.2× |
| COUNT — point AND interval | 32.1 / 33.6 | 7.18 / 7.21 | 0.22× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 32.3 / 33.0 | 9.31 / 9.39 | 0.29× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 95.7 / 96.4 | 14.9 / 15.0 | 0.16× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 636 / 637 | 155 / 156 | 0.24× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 32.0 / 34.0 | 9.31 / 9.46 | 0.29× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 514 / 560 | — | — |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 59.6 / 68.8 | 11.2 / 11.5 | 0.19× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.84× · wasm 1.21×*

