node v22.16.0 · darwin arm64 · 2026-09-12T04:00:18.389Z

**Units.** every cell is the wall time of ONE call: median / spread in ms, `performance.now()` around it — the spread is the MAX for an arm with fewer than 20 samples (a p95 there is the largest sample under another name) and the p95 above that.
Repetitions {"90k":7,"300k":5,"1M":3,"1.5M":3,"2M":3} · warm-up discarded, per arm: construct / load the table = 0/1 · COUNT — point AND interval = 2 · rows, limit 100 — point AND interval = 2 · rows, ORDER BY cases DESC, limit 100 — repeat asks = 2 · rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart = 2 · rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) = 0 · rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table = 0/1 · construct / land the wide table, ALL 30 columns — ONE landing per size (n = 1) = 0 · rows, limit 100 — point AND interval, ALL 30 columns of the wide table = 2 · gc between samples EXPOSED.

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
| both engines counted the same rows — 1.5M point AND interval, wide (30 columns) | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 2M point AND interval, wide (30 columns) | memory = wasm | 3,080 vs 3,080 | YES |
| wide table — what DuckDB says its 30 columns are | DESCRIBE | VARCHAR ×17 · BIGINT ×5 · DOUBLE ×4 · BOOLEAN ×4 | — |

### 1 · 90k — 90,300 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 6.25 / 6.53 | 328 / 329 | 52.5× |
| COUNT — point AND interval | 4.10 / 6.97 | 1.90 / 2.45 | 0.46× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 3.01 / 4.17 | 3.88 / 4.10 | 1.29× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 6.74 / 7.47 | 3.94 / 4.02 | 0.58× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 60.6 / 61.6 | 45.8 / 47.6 | 0.76× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 3.07 / 4.22 | 3.61 / 3.79 | 1.17× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 34.9 / 35.4 | — | — |
| construct / land the wide table, ALL 30 columns — ONE landing per size (n = 1) <br/>*memoryProvider(rows, { layout: "row" }) over 30 columns: every row cloned + a columnTypes fold — once (n = 1)* | 301 / 301 | 607 / 607 | 2.02× |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 4.09 / 5.78 | 5.50 / 5.87 | 1.34× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.36× · wasm 1.42×*

### 2 · 300k — 300,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 21.4 / 21.9 | 474 / 681 | 22.2× |
| COUNT — point AND interval | 10.1 / 11.4 | 3.10 / 3.15 | 0.31× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 10.0 / 11.4 | 5.37 / 5.45 | 0.54× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 28.7 / 29.3 | 6.63 / 7.09 | 0.23× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 203 / 204 | 77.8 / 77.9 | 0.38× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 10.3 / 11.4 | 5.28 / 6.41 | 0.51× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 142 / 145 | — | — |
| construct / land the wide table, ALL 30 columns — ONE landing per size (n = 1) <br/>*memoryProvider(rows, { layout: "row" }) over 30 columns: every row cloned + a columnTypes fold — once (n = 1)* | 1038 / 1038 | 1420 / 1420 | 1.37× |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 15.7 / 18.8 | 7.05 / 7.74 | 0.45× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 1.57× · wasm 1.31×*

### 3 · 1M — 1,000,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 75.2 / 77.8 | 967 / 974 | 12.9× |
| COUNT — point AND interval | 35.3 / 38.7 | 7.25 / 7.30 | 0.21× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 33.8 / 34.5 | 9.73 / 9.81 | 0.29× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 118 / 119 | 15.1 / 15.2 | 0.13× |
| rows, limit 100 — a MOVING brush: the whole sweep of 20 interval asks, one week apart <br/>*the TOTAL for 20 asks, the interval one week later each time; no cache answers any of them* | 664 / 664 | 171 / 172 | 0.26× |
| rows, limit 100 — a MOVING brush: ONE ask of the sweep (n = the 20 asks) <br/>*each ask of ONE sweep is one sample (n = 20, so the spread is a p95); no warm-up — the sweep arm ran first* | 33.8 / 35.3 | 9.66 / 10.2 | 0.29× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 595 / 648 | — | — |
| construct / land the wide table, ALL 30 columns — ONE landing per size (n = 1) <br/>*memoryProvider(rows, { layout: "row" }) over 30 columns: every row cloned + a columnTypes fold — once (n = 1)* | 3796 / 3796 | 4579 / 4579 | 1.21× |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 68.2 / 74.4 | 12.5 / 14.2 | 0.18× |

*wide ÷ window, per engine — the same clause and the same 100 rows, thirty columns against six: memory 2.02× · wasm 1.29×*

### 4 · 1.5M — 1,500,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / land the wide table, ALL 30 columns — ONE landing per size (n = 1) <br/>*memoryProvider(rows, { layout: "row" }) over 30 columns: every row cloned + a columnTypes fold — once (n = 1)* | 5977 / 5977 | 7334 / 7334 | 1.23× |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 118 / 146 | 15.4 / 15.7 | 0.13× |

### 5 · 2M — 2,000,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / land the wide table, ALL 30 columns — ONE landing per size (n = 1) <br/>*memoryProvider(rows, { layout: "row" }) over 30 columns: every row cloned + a columnTypes fold — once (n = 1)* | 8557 / 8557 | 10611 / 10611 | 1.24× |
| rows, limit 100 — point AND interval, ALL 30 columns of the wide table <br/>*the same 100 rows as the window arm, thirty columns wide: the memory engine hands each row back BY REFERENCE, so what it pays for the width is the predicate scan over heavier rows, not the rows it returns* | 182 / 199 | 18.1 / 18.3 | 0.10× |

