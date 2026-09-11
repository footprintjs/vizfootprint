node v22.16.0 · darwin arm64 · 2026-09-11T23:34:39.044Z

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
| wide table — what DuckDB says its 30 columns are | DESCRIBE | VARCHAR ×8 · DATE ×5 · BIGINT ×5 · DOUBLE ×4 · TIMESTAMP ×4 · BOOLEAN ×4 | — |

| ceiling — an arm an engine could not run | engine | size | the backend said |
|---|---|---|---|
| wide: land 30 columns through the rows port | wasm | 1M | Invalid string length |

### 1 · 90k — 90,300 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 6.46 / 6.62 | 381 / 384 | 59.0× |
| COUNT — point AND interval | 4.20 / 6.94 | 1.87 / 2.19 | 0.45× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 2.99 / 4.16 | 3.75 / 4.83 | 1.25× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 6.59 / 7.65 | 4.02 / 4.22 | 0.61× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 60.4 / 62.2 | 43.5 / 46.0 | 0.72× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 3.03 / 4.24 | 3.47 / 3.74 | 1.15× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 34.7 / 35.5 | — | — |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 3.95 / 5.38 | 5.83 / 6.67 | 1.48× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.32× · wasm 1.56×*

### 2 · 300k — 300,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 21.5 / 22.3 | 553 / 639 | 25.7× |
| COUNT — point AND interval | 10.2 / 11.3 | 3.03 / 3.16 | 0.30× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 10.2 / 11.3 | 5.28 / 5.57 | 0.52× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 28.1 / 28.3 | 6.58 / 6.74 | 0.23× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 194 / 197 | 77.8 / 81.4 | 0.40× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 9.96 / 11.3 | 5.37 / 5.52 | 0.54× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 143 / 144 | — | — |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 16.1 / 19.5 | 7.01 / 7.40 | 0.44× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.58× · wasm 1.33×*

### 3 · 1M — 1,000,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 74.9 / 79.6 | 988 / 1032 | 13.2× |
| COUNT — point AND interval | 33.4 / 35.0 | 7.44 / 7.65 | 0.22× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 33.5 / 34.3 | 9.87 / 10.1 | 0.29× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 115 / 118 | 15.3 / 15.4 | 0.13× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 660 / 665 | 164 / 167 | 0.25× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 33.7 / 35.0 | 9.50 / 9.73 | 0.28× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 588 / 643 | — | — |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 68.2 / 73.6 | — | — |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 2.04× · wasm —*

