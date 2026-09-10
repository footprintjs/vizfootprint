node v22.16.0 · darwin arm64 · 2026-09-10T07:19:58.678Z

**Units.** every cell is the wall time of ONE call: median / spread in ms, `performance.now()` around it — the spread is the p95 — this run predates the max being recorded, and at these sample counts a p95 IS the largest sample, under another name.
Repetitions {"90k":7,"300k":5,"1M":3} · warm-up per arm not recorded (a results file written before it was) · gc between samples EXPOSED.

### 0 · controls — is the instrument alive?

| control | asked | read | live |
|---|---:|---:|---|
| clock — a deliberate block | 40 ms | 40.0 ms | YES |
| both engines counted the same rows — 90k point AND interval | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 300k point AND interval | memory = wasm | 3,080 vs 3,080 | YES |
| both engines counted the same rows — 1M point AND interval | memory = wasm | 3,080 vs 3,080 | YES |

### 1 · 90k — 90,300 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 6.45 / 11.4 | 345 / 361 | 53.5× |
| COUNT — point AND interval | 4.13 / 7.87 | 1.73 / 2.26 | 0.42× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 3.01 / 4.07 | 2.95 / 3.10 | 0.98× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 6.92 / 7.19 | 3.70 / 3.87 | 0.54× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 33.0 / 33.3 | — | — |

### 2 · 300k — 300,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 21.7 / 21.8 | 507 / 611 | 23.3× |
| COUNT — point AND interval | 9.58 / 10.7 | 2.94 / 3.03 | 0.31× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 9.80 / 11.2 | 4.42 / 4.50 | 0.45× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 24.1 / 25.9 | 6.20 / 6.33 | 0.26× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 125 / 125 | — | — |

### 3 · 1M — 1,000,000 rows

| arm | memory median / spread | wasm (DuckDB) median / spread | wasm ÷ memory |
|---|---:|---:|---:|
| construct / load the table <br/>*memoryProvider(rows, { layout: "row" }): every row cloned + a columnTypes fold* | 72.7 / 75.9 | 935 / 940 | 12.9× |
| COUNT — point AND interval | 32.3 / 33.3 | 7.08 / 7.28 | 0.22× |
| rows, limit 100 — point AND interval <br/>*two statements: the window, then a COUNT of the whole selection* | 32.2 / 33.2 | 8.62 / 9.12 | 0.27× |
| rows, ORDER BY cases DESC, limit 100 — repeat asks <br/>*the permutation is cached per sort spec — this is the second ask onwards* | 97.5 / 101 | 14.8 / 14.8 | 0.15× |
| rows, ORDER BY cases DESC, limit 100 — FIRST ask on a fresh table <br/>*a fresh provider each rep, so the sort is paid for: this cell INCLUDES the construction above it. DuckDB has no such cell — it keeps no permutation, so its every ask is a first ask* | 517 / 581 | — | — |

