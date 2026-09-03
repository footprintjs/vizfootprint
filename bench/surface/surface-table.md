node v22.16.0 · darwin arm64 · 2026-09-03T20:18:20.381Z

**Unit: UTF-8 bytes.** Tokens NOT counted (not requested — run with --tokens to count real tokens).

### 1 · menu — the fixed cost paid every turn

Whole menu: **17,318 bytes**, 9 tools. Byte-stability: **HOLDS** — byte-identical across all three shapes and across a session that acted — the documented claim holds

| tool | shape | bytes | of which description | of which schema |
|---|---|---:|---:|---:|
| `viz.whats_here` | any (shape-independent) | 958 | 841 | 62 |
| `viz.dispatch` | any (shape-independent) | 9,798 | 2,526 | 7,219 |
| `viz.declare_analysis` | any (shape-independent) | 645 | 312 | 272 |
| `viz.why` | any (shape-independent) | 599 | 354 | 197 |
| `viz.fork` | any (shape-independent) | 799 | 469 | 281 |
| `viz.bookmark` | any (shape-independent) | 518 | 200 | 265 |
| `viz.paths` | any (shape-independent) | 1,926 | 1,038 | 838 |
| `viz.compare` | any (shape-independent) | 612 | 320 | 240 |
| `viz.propose_chart` | any (shape-independent) | 1,453 | 857 | 538 |
| **total** | any (shape-independent) | **17,318** | | |

### 2 · whats_here — the per-call answer

| shape | views | table cols | link edges | analyses | prose slots | whats_here bytes | × the menu |
|---|---:|---:|---:|---:|---:|---:|---:|
| small | 3 | 8 | 12 | 2 | 1 | 8,892 | 0.51× |
| realistic | 9 | 30 | 132 | 6 | 3 | 65,609 | 3.79× |
| large | 20 | 80 | 674 | 12 | 5 | 306,670 | 17.71× |

### 3 · composition — where the answer's bytes go

| key | small bytes (share) | realistic bytes (share) | large bytes (share) |
|---|---:|---:|---:|
| `views` | 4,187 (47.09%) | 38,827 (59.18%) | 193,358 (63.05%) |
| `links` | 2,069 (23.27%) | 20,384 (31.07%) | 100,499 (32.77%) |
| `columns` | 597 (6.71%) | 2,181 (3.32%) | 5,781 (1.89%) |
| `offers` | 371 (4.17%) | 984 (1.5%) | 2,148 (0.7%) |
| `dashboard` | 39 (0.44%) | 633 (0.96%) | 633 (0.21%) |
| `analyses` | 213 (2.4%) | 599 (0.91%) | 1,182 (0.39%) |
| `effectiveEncodings` | 191 (2.15%) | 483 (0.74%) | 1,016 (0.33%) |
| `encodings` | 182 (2.05%) | 474 (0.72%) | 1,007 (0.33%) |
| `rules` | 279 (3.14%) | 279 (0.43%) | 279 (0.09%) |
| `tables` | 117 (1.32%) | 118 (0.18%) | 119 (0.04%) |
| `time` | 97 (1.09%) | 97 (0.15%) | 97 (0.03%) |
| `fdr` | 94 (1.06%) | 94 (0.14%) | 94 (0.03%) |
| `paths` | 79 (0.89%) | 79 (0.12%) | 79 (0.03%) |
| `encodingPolicy` | 63 (0.71%) | 63 (0.1%) | 63 (0.02%) |
| `engines` | 27 (0.3%) | 27 (0.04%) | 27 (0.01%) |
| `keys` | 24 (0.27%) | 24 (0.04%) | 24 (0.01%) |
| `clearedSelections` | 22 (0.25%) | 22 (0.03%) | 22 (0.01%) |
| `selectedRowCount` | 22 (0.25%) | 22 (0.03%) | 23 (0.01%) |
| `defaultTable` | 21 (0.24%) | 21 (0.03%) | 21 (0.01%) |
| `activeSelections` | 21 (0.24%) | 21 (0.03%) | 21 (0.01%) |
| `currentView` | 18 (0.2%) | 18 (0.03%) | 18 (0.01%) |
| `journalTotal` | 16 (0.18%) | 16 (0.02%) | 16 (0.01%) |
| `bookmarks` | 14 (0.16%) | 14 (0.02%) | 14 (0%) |
| `filters` | 12 (0.13%) | 12 (0.02%) | 12 (0%) |
| `sources` | 12 (0.13%) | 12 (0.02%) | 12 (0%) |
| `journal` | 12 (0.13%) | 12 (0.02%) | 12 (0%) |
| `layouts` | 12 (0.13%) | 12 (0.02%) | 12 (0%) |
| `charts` | 11 (0.12%) | 11 (0.02%) | 11 (0%) |
| `notes` | 10 (0.11%) | 10 (0.02%) | 10 (0%) |
| `saved` | 10 (0.11%) | 10 (0.02%) | 10 (0%) |
| `ok` | 9 (0.1%) | 9 (0.01%) | 9 (0%) |
| `gaps` | 8 (0.09%) | 8 (0.01%) | 8 (0%) |
| **total** | **8,892** | **65,609** | **306,670** |

Split checks out: unattributed residual (braces + commas beyond what the split counts) = small 0, realistic 0, large 0.

#### 3b · inside `views` and `links` — the two keys that carry the answer

| container | sub-key | small bytes (share of that container) | realistic bytes (share of that container) | large bytes (share of that container) |
|---|---|---:|---:|---:|
| `views` | `columns` | 1,764 (42.21%) | 19,548 (50.36%) | 115,440 (59.71%) |
| `views` | `prose` | 1,093 (26.15%) | 12,645 (32.57%) | 51,375 (26.57%) |
| `views` | `accepts` | 455 (10.89%) | 3,065 (7.9%) | 18,678 (9.66%) |
| `views` | `effective` | 120 (2.87%) | 1,366 (3.52%) | 2,993 (1.55%) |
| `views` | `encodings` | 172 (4.12%) | 459 (1.18%) | 981 (0.51%) |
| `views` | `does` | 144 (3.45%) | 443 (1.14%) | 993 (0.51%) |
| `views` | `selectionKinds` | 108 (2.58%) | 304 (0.78%) | 667 (0.34%) |
| `views` | `viewId` | 54 (1.29%) | 173 (0.45%) | 393 (0.2%) |
| `views` | `label` | 48 (1.15%) | 155 (0.4%) | 363 (0.19%) |
| `views` | `canProbe` | 45 (1.08%) | 135 (0.35%) | 300 (0.16%) |
| `views` | `mounted` | 45 (1.08%) | 135 (0.35%) | 300 (0.16%) |
| `views` | `actor` | 43 (1.03%) | 129 (0.33%) | 286 (0.15%) |
| `views` | `proposals` | 42 (1.01%) | 126 (0.32%) | 280 (0.14%) |
| `links` | `edges` | 1,710 (82.97%) | 19,414 (95.28%) | 98,400 (97.92%) |
| `links` | `views` | 324 (15.72%) | 935 (4.59%) | 2,064 (2.05%) |
| `links` | `default` | 23 (1.12%) | 23 (0.11%) | 23 (0.02%) |

### 4 · churn — one ordinary act, then the same question again

| shape | act | before bytes | after bytes | unchanged (deep) | unchanged (top-level keys) | biggest changed key |
|---|---|---:|---:|---:|---:|---|
| small (3v/8c/12e) | select (point value on a bar) | 8,892 | 9,159 | 95.82% | 90.46% | `offers` (371 B) |
| small (3v/8c/12e) | filter (interval on a scatter) | 8,892 | 9,157 | 95.82% | 90.46% | `offers` (371 B) |
| small (3v/8c/12e) | reencode (rebind one channel) | 8,892 | 9,022 | 95.78% | 42.2% | `views` (4,187 B) |
| realistic (9v/30c/132e) | select (point value on a bar) | 65,609 | 65,872 | 98.87% | 97.18% | `offers` (984 B) |
| realistic (9v/30c/132e) | filter (interval on a scatter) | 65,609 | 65,870 | 98.87% | 97.18% | `offers` (984 B) |
| realistic (9v/30c/132e) | reencode (rebind one channel) | 65,609 | 65,730 | 99.04% | 37.54% | `views` (38,827 B) |
| large (20v/80c/674e) | select (point value on a bar) | 306,670 | 306,927 | 99.54% | 98.83% | `offers` (2,148 B) |
| large (20v/80c/674e) | filter (interval on a scatter) | 306,670 | 306,912 | 99.54% | 98.83% | `offers` (2,148 B) |
| large (20v/80c/674e) | reencode (rebind one channel) | 306,670 | 306,836 | 99.56% | 35.52% | `views` (193,358 B) |

### 5 · floor — the smallest answer that still supports a first correct act

| shape | full answer | floor (strict) | floor share | floor (shared column list) | shared share | verbs alone |
|---|---:|---:|---:|---:|---:|---:|
| small (3 views · 8 cols · 12 edges · 2 analyses · 1 prose slots) | 8,892 | 587 | 6.6% | 437 | 4.91% | 98 |
| realistic (9 views · 30 cols · 132 edges · 6 analyses · 3 prose slots) | 65,609 | 3,056 | 4.66% | 1,048 | 1.6% | 98 |
| large (20 views · 80 cols · 674 edges · 12 analyses · 5 prose slots) | 306,670 | 14,620 | 4.77% | 2,251 | 0.73% | 98 |

### 6 · tokens

Tokens were **not counted**: not requested — run with --tokens to count real tokens. Every number above is bytes. Do not convert.

