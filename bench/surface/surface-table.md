node v22.16.0 · darwin arm64 · 2026-09-11T15:29:55.904Z

**Unit: UTF-8 bytes.** Tokens NOT counted (not requested — run with --tokens to count real tokens).

### 1 · menu — the fixed cost paid every turn

Whole menu: **21,830 bytes**, 9 tools. Byte-stability: **HOLDS** — byte-identical across all three shapes and across a session that acted — the documented claim holds

| tool | shape | bytes | of which description | of which schema |
|---|---|---:|---:|---:|
| `viz.whats_here` | any (shape-independent) | 2,516 | 1,483 | 978 |
| `viz.dispatch` | any (shape-independent) | 12,077 | 3,055 | 8,969 |
| `viz.declare_analysis` | any (shape-independent) | 645 | 312 | 272 |
| `viz.why` | any (shape-independent) | 1,274 | 883 | 343 |
| `viz.fork` | any (shape-independent) | 799 | 469 | 281 |
| `viz.bookmark` | any (shape-independent) | 518 | 200 | 265 |
| `viz.paths` | any (shape-independent) | 1,926 | 1,038 | 838 |
| `viz.compare` | any (shape-independent) | 612 | 320 | 240 |
| `viz.propose_chart` | any (shape-independent) | 1,453 | 857 | 538 |
| **total** | any (shape-independent) | **21,830** | | |

### 2 · whats_here — the per-call answer

| shape | views | table cols | link edges | analyses | prose slots | whats_here bytes | × the menu |
|---|---:|---:|---:|---:|---:|---:|---:|
| small | 3 | 8 | 12 | 2 | 1 | 10,043 | 0.46× |
| realistic | 9 | 30 | 132 | 6 | 3 | 49,055 | 2.25× |
| large | 20 | 80 | 674 | 12 | 5 | 194,742 | 8.92× |

### 3 · composition — where the answer's bytes go

| key | small bytes (share) | realistic bytes (share) | large bytes (share) |
|---|---:|---:|---:|
| `links` | 2,114 (21.05%) | 20,519 (41.83%) | 100,799 (51.76%) |
| `views` | 2,447 (24.37%) | 19,522 (39.8%) | 78,951 (40.54%) |
| `parts` | 2,830 (28.18%) | 2,830 (5.77%) | 2,830 (1.45%) |
| `columns` | 597 (5.94%) | 2,181 (4.45%) | 5,781 (2.97%) |
| `dashboard` | 39 (0.39%) | 633 (1.29%) | 633 (0.33%) |
| `offers` | 233 (2.32%) | 616 (1.26%) | 1,343 (0.69%) |
| `analyses` | 213 (2.12%) | 599 (1.22%) | 1,182 (0.61%) |
| `effectiveEncodings` | 191 (1.9%) | 483 (0.98%) | 1,016 (0.52%) |
| `encodings` | 182 (1.81%) | 474 (0.97%) | 1,007 (0.52%) |
| `rules` | 315 (3.14%) | 315 (0.64%) | 315 (0.16%) |
| `tables` | 117 (1.16%) | 118 (0.24%) | 119 (0.06%) |
| `time` | 97 (0.97%) | 97 (0.2%) | 97 (0.05%) |
| `fdr` | 94 (0.94%) | 94 (0.19%) | 94 (0.05%) |
| `basis` | 81 (0.81%) | 81 (0.17%) | 81 (0.04%) |
| `paths` | 79 (0.79%) | 79 (0.16%) | 79 (0.04%) |
| `encodingPolicy` | 63 (0.63%) | 63 (0.13%) | 63 (0.03%) |
| `engines` | 27 (0.27%) | 27 (0.06%) | 27 (0.01%) |
| `keys` | 24 (0.24%) | 24 (0.05%) | 24 (0.01%) |
| `clearedSelections` | 22 (0.22%) | 22 (0.04%) | 22 (0.01%) |
| `selectedRowCount` | 22 (0.22%) | 22 (0.04%) | 23 (0.01%) |
| `defaultTable` | 21 (0.21%) | 21 (0.04%) | 21 (0.01%) |
| `activeSelections` | 21 (0.21%) | 21 (0.04%) | 21 (0.01%) |
| `asOf` | 19 (0.19%) | 19 (0.04%) | 19 (0.01%) |
| `currentView` | 18 (0.18%) | 18 (0.04%) | 18 (0.01%) |
| `journalTotal` | 16 (0.16%) | 16 (0.03%) | 16 (0.01%) |
| `bookmarks` | 14 (0.14%) | 14 (0.03%) | 14 (0.01%) |
| `relations` | 14 (0.14%) | 14 (0.03%) | 14 (0.01%) |
| `filters` | 12 (0.12%) | 12 (0.02%) | 12 (0.01%) |
| `sources` | 12 (0.12%) | 12 (0.02%) | 12 (0.01%) |
| `journal` | 12 (0.12%) | 12 (0.02%) | 12 (0.01%) |
| `layouts` | 12 (0.12%) | 12 (0.02%) | 12 (0.01%) |
| `charts` | 11 (0.11%) | 11 (0.02%) | 11 (0.01%) |
| `notes` | 10 (0.1%) | 10 (0.02%) | 10 (0.01%) |
| `saved` | 10 (0.1%) | 10 (0.02%) | 10 (0.01%) |
| `ok` | 9 (0.09%) | 9 (0.02%) | 9 (0%) |
| `gaps` | 8 (0.08%) | 8 (0.02%) | 8 (0%) |
| **total** | **10,043** | **49,055** | **194,742** |

Split checks out: unattributed residual (braces + commas beyond what the split counts) = small 0, realistic 0, large 0.

#### 3b · inside `views` and `links` — the two keys that carry the answer

| container | sub-key | small bytes (share of that container) | realistic bytes (share of that container) | large bytes (share of that container) |
|---|---|---:|---:|---:|
| `views` | `prose` | 1,093 (44.81%) | 12,645 (64.8%) | 51,375 (65.08%) |
| `views` | `accepts` | 482 (19.76%) | 3,317 (17%) | 19,731 (24.99%) |
| `views` | `effective` | 120 (4.92%) | 1,366 (7%) | 2,993 (3.79%) |
| `views` | `encodings` | 172 (7.05%) | 459 (2.35%) | 981 (1.24%) |
| `views` | `does` | 144 (5.9%) | 443 (2.27%) | 993 (1.26%) |
| `views` | `selectionKinds` | 108 (4.43%) | 304 (1.56%) | 667 (0.84%) |
| `views` | `viewId` | 54 (2.21%) | 173 (0.89%) | 393 (0.5%) |
| `views` | `label` | 48 (1.97%) | 155 (0.79%) | 363 (0.46%) |
| `views` | `canProbe` | 45 (1.85%) | 135 (0.69%) | 300 (0.38%) |
| `views` | `mounted` | 45 (1.85%) | 135 (0.69%) | 300 (0.38%) |
| `views` | `actor` | 43 (1.76%) | 129 (0.66%) | 286 (0.36%) |
| `views` | `proposals` | 42 (1.72%) | 126 (0.65%) | 280 (0.35%) |
| `links` | `edges` | 1,710 (81.2%) | 19,414 (94.65%) | 98,400 (97.63%) |
| `links` | `views` | 369 (17.52%) | 1,070 (5.22%) | 2,364 (2.35%) |
| `links` | `default` | 23 (1.09%) | 23 (0.11%) | 23 (0.02%) |

### 4 · churn — one ordinary act, then the same question again

| shape | act | before bytes | after bytes | unchanged (deep) | unchanged (top-level keys) | biggest changed key |
|---|---|---:|---:|---:|---:|---|
| small (3v/8c/12e) | select (point value on a bar) | 10,043 | 10,310 | 97.45% | 94.21% | `analyses` (213 B) |
| small (3v/8c/12e) | filter (interval on a scatter) | 10,043 | 10,308 | 97.45% | 94.21% | `analyses` (213 B) |
| small (3v/8c/12e) | reencode (rebind one channel) | 10,043 | 10,173 | 97.43% | 68.8% | `views` (2,447 B) |
| realistic (9v/30c/132e) | select (point value on a bar) | 49,055 | 49,318 | 99.27% | 98.03% | `analyses` (599 B) |
| realistic (9v/30c/132e) | filter (interval on a scatter) | 49,055 | 49,316 | 99.27% | 98.03% | `analyses` (599 B) |
| realistic (9v/30c/132e) | reencode (rebind one channel) | 49,055 | 49,176 | 99.5% | 57.61% | `views` (19,522 B) |
| large (20v/80c/674e) | select (point value on a bar) | 194,742 | 194,999 | 99.73% | 99.2% | `analyses` (1,182 B) |
| large (20v/80c/674e) | filter (interval on a scatter) | 194,742 | 194,984 | 99.73% | 99.2% | `analyses` (1,182 B) |
| large (20v/80c/674e) | reencode (rebind one channel) | 194,742 | 194,908 | 99.76% | 58.26% | `views` (78,951 B) |

#### 4b · since — the same position, asked for as a delta

| shape | act | full answer | `since` answer | share of the full | parts omitted (unchanged) | served |
|---|---|---:|---:|---:|---:|---|
| small (3v/8c/12e) | select (point value on a bar) | 10,310 | 2,161 | 20.96% | 27 of 34 | delta |
| small (3v/8c/12e) | filter (interval on a scatter) | 10,308 | 2,159 | 20.94% | 27 of 34 | delta |
| small (3v/8c/12e) | reencode (rebind one channel) | 10,173 | 3,141 | 30.88% | 28 of 34 | delta |
| realistic (9v/30c/132e) | select (point value on a bar) | 49,318 | 2,543 | 5.16% | 27 of 34 | delta |
| realistic (9v/30c/132e) | filter (interval on a scatter) | 49,316 | 2,541 | 5.15% | 27 of 34 | delta |
| realistic (9v/30c/132e) | reencode (rebind one channel) | 49,176 | 5,107 | 10.39% | 28 of 34 | delta |
| large (20v/80c/674e) | select (point value on a bar) | 194,999 | 3,121 | 1.6% | 27 of 34 | delta |
| large (20v/80c/674e) | filter (interval on a scatter) | 194,984 | 3,106 | 1.59% | 27 of 34 | delta |
| large (20v/80c/674e) | reencode (rebind one channel) | 194,908 | 8,669 | 4.45% | 28 of 34 | delta |

### 5 · floor — the smallest answer that still supports a first correct act

| shape | full answer | floor (strict) | floor share | floor (shared column list) | shared share | verbs alone |
|---|---:|---:|---:|---:|---:|---:|
| small (3 views · 8 cols · 12 edges · 2 analyses · 1 prose slots) | 10,043 | 587 | 5.84% | 437 | 4.35% | 98 |
| realistic (9 views · 30 cols · 132 edges · 6 analyses · 3 prose slots) | 49,055 | 3,056 | 6.23% | 1,048 | 2.14% | 98 |
| large (20 views · 80 cols · 674 edges · 12 analyses · 5 prose slots) | 194,742 | 14,620 | 7.51% | 2,251 | 1.16% | 98 |

### 6 · tokens

Tokens were **not counted**: not requested — run with --tokens to count real tokens. Every number above is bytes. Do not convert.

