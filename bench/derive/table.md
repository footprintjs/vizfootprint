node v22.16.0 · darwin arm64 · 2026-09-11T21:53:45.994Z · 67720c6+dirty

**Units.** every cell is the wall time of ONE whole column (`valuesOf`, every row) in ms: **best** · median / max over the repetitions, `performance.now()` around it, warm-ups discarded. The best is the headline (the sample with the least of anything else charged to it); the median and the max are the noise.
Repetitions {"100k":7,"1M":5} · gc between samples EXPOSED.

### 0 · controls — is the instrument alive?

| control | asked | read | live |
|---|---:|---:|---|
| clock — a deliberate block | 40 ms | 40.0 ms | YES |
| the judge accepts `read` (0 op nodes, 1 leaves) | ok | number | YES |
| the judge accepts `ratio` (1 op nodes, 2 leaves) | ok | number | YES |
| the judge accepts `tree6` (6 op nodes, 7 leaves) | ok | string | YES |
| four paths, one answer — 100k `read` | 0 cells differ, 0 < present < 1 | 0 differ · present 0.548 | YES |
| four paths, one answer — 100k `ratio` | 0 cells differ, 0 < present < 1 | 0 differ · present 0.548 | YES |
| four paths, one answer — 100k `tree6` | 0 cells differ, 0 < present < 1 | 0 differ · present 0.548 | YES |
| four paths, one answer — 1M `read` | 0 cells differ, 0 < present < 1 | 0 differ · present 0.550 | YES |
| four paths, one answer — 1M `ratio` | 0 cells differ, 0 < present < 1 | 0 differ · present 0.550 | YES |
| four paths, one answer — 1M `tree6` | 0 cells differ, 0 < present < 1 | 0 differ · present 0.550 | YES |

### 1 · 100k — 100,000 rows

| expression | walk · columnar door | walk · rowsOver door | floor · over the reader | floor · over raw columns | walk ÷ floor(reader) | walk ÷ floor(raw) | walk, per row |
|---|---:|---:|---:|---:|---:|---:|---:|
| `read` | **2.21** · 2.26 / 2.31 | **2.34** · 2.39 / 2.53 | **1.66** · 1.69 / 1.82 | **0.75** · 0.78 / 0.79 | 1.33× | 2.95× | 22 ns |
| `ratio` | **4.87** · 4.90 / 4.96 | **4.97** · 5.02 / 5.16 | **2.42** · 2.46 / 2.65 | **1.28** · 1.30 / 1.37 | 2.01× | 3.81× | 49 ns |
| `tree6` | **11.1** · 11.3 / 11.4 | **11.1** · 11.1 / 11.6 | **2.69** · 2.75 / 2.84 | **1.50** · 1.53 / 1.57 | 4.14× | 7.41× | 111 ns |

### 2 · 1M — 1,000,000 rows

| expression | walk · columnar door | walk · rowsOver door | floor · over the reader | floor · over raw columns | walk ÷ floor(reader) | walk ÷ floor(raw) | walk, per row |
|---|---:|---:|---:|---:|---:|---:|---:|
| `read` | **31.7** · 32.2 / 34.2 | **31.5** · 31.8 / 32.5 | **22.8** · 23.2 / 23.4 | **15.2** · 15.3 / 16.2 | 1.39× | 2.09× | 32 ns |
| `ratio` | **58.5** · 58.9 / 59.0 | **56.7** · 56.8 / 57.5 | **33.5** · 33.7 / 33.9 | **21.9** · 21.9 / 22.1 | 1.75× | 2.67× | 58 ns |
| `tree6` | **115** · 116 / 116 | **111** · 111 / 112 | **32.4** · 32.6 / 33.2 | **20.7** · 21.1 / 21.5 | 3.55× | 5.58× | 115 ns |

