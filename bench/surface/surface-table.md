node v22.16.0 · darwin arm64 · 2026-09-09T22:51:45.898Z

**Unit: UTF-8 bytes.** Tokens NOT counted (not requested — run with --tokens to count real tokens).

### 1 · menu — the fixed cost paid every turn

Whole menu: **20,152 bytes**, 9 tools. Byte-stability: **HOLDS** — byte-identical across all three shapes and across a session that acted — the documented claim holds

| tool | shape | bytes | of which description | of which schema |
|---|---|---:|---:|---:|
| `viz.whats_here` | any (shape-independent) | 2,516 | 1,483 | 978 |
| `viz.dispatch` | any (shape-independent) | 11,074 | 2,971 | 8,050 |
| `viz.declare_analysis` | any (shape-independent) | 645 | 312 | 272 |
| `viz.why` | any (shape-independent) | 599 | 354 | 197 |
| `viz.fork` | any (shape-independent) | 799 | 469 | 281 |
| `viz.bookmark` | any (shape-independent) | 518 | 200 | 265 |
| `viz.paths` | any (shape-independent) | 1,926 | 1,038 | 838 |
| `viz.compare` | any (shape-independent) | 612 | 320 | 240 |
| `viz.propose_chart` | any (shape-independent) | 1,453 | 857 | 538 |
| **total** | any (shape-independent) | **20,152** | | |

### 2 · whats_here — the per-call answer

| shape | views | table cols | link edges | analyses | prose slots | whats_here bytes | × the menu |
|---|---:|---:|---:|---:|---:|---:|---:|
| small | 3 | 8 | 12 | 2 | 1 | 9,971 | 0.49× |
| realistic | 9 | 30 | 132 | 6 | 3 | 48,668 | 2.42× |
| large | 20 | 80 | 674 | 12 | 5 | 193,389 | 9.60× |

### 3 · composition — where the answer's bytes go

| key | small bytes (share) | realistic bytes (share) | large bytes (share) |
|---|---:|---:|---:|
| `links` | 2,069 (20.75%) | 20,384 (41.88%) | 100,499 (51.97%) |
| `views` | 2,420 (24.27%) | 19,270 (39.59%) | 77,898 (40.28%) |
| `parts` | 2,830 (28.38%) | 2,830 (5.81%) | 2,830 (1.46%) |
| `columns` | 597 (5.99%) | 2,181 (4.48%) | 5,781 (2.99%) |
| `dashboard` | 39 (0.39%) | 633 (1.3%) | 633 (0.33%) |
| `offers` | 233 (2.34%) | 616 (1.27%) | 1,343 (0.69%) |
| `analyses` | 213 (2.14%) | 599 (1.23%) | 1,182 (0.61%) |
| `effectiveEncodings` | 191 (1.92%) | 483 (0.99%) | 1,016 (0.53%) |
| `encodings` | 182 (1.83%) | 474 (0.97%) | 1,007 (0.52%) |
| `rules` | 315 (3.16%) | 315 (0.65%) | 315 (0.16%) |
| `tables` | 117 (1.17%) | 118 (0.24%) | 119 (0.06%) |
| `time` | 97 (0.97%) | 97 (0.2%) | 97 (0.05%) |
| `fdr` | 94 (0.94%) | 94 (0.19%) | 94 (0.05%) |
| `basis` | 81 (0.81%) | 81 (0.17%) | 81 (0.04%) |
| `paths` | 79 (0.79%) | 79 (0.16%) | 79 (0.04%) |
| `encodingPolicy` | 63 (0.63%) | 63 (0.13%) | 63 (0.03%) |
| `engines` | 27 (0.27%) | 27 (0.06%) | 27 (0.01%) |
| `keys` | 24 (0.24%) | 24 (0.05%) | 24 (0.01%) |
| `clearedSelections` | 22 (0.22%) | 22 (0.05%) | 22 (0.01%) |
| `selectedRowCount` | 22 (0.22%) | 22 (0.05%) | 23 (0.01%) |
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
| **total** | **9,971** | **48,668** | **193,389** |

Split checks out: unattributed residual (braces + commas beyond what the split counts) = small 0, realistic 0, large 0.

#### 3b · inside `views` and `links` — the two keys that carry the answer

| container | sub-key | small bytes (share of that container) | realistic bytes (share of that container) | large bytes (share of that container) |
|---|---|---:|---:|---:|
| `views` | `prose` | 1,093 (45.32%) | 12,645 (65.65%) | 51,375 (65.96%) |
| `views` | `accepts` | 455 (18.86%) | 3,065 (15.91%) | 18,678 (23.98%) |
| `views` | `effective` | 120 (4.98%) | 1,366 (7.09%) | 2,993 (3.84%) |
| `views` | `encodings` | 172 (7.13%) | 459 (2.38%) | 981 (1.26%) |
| `views` | `does` | 144 (5.97%) | 443 (2.3%) | 993 (1.27%) |
| `views` | `selectionKinds` | 108 (4.48%) | 304 (1.58%) | 667 (0.86%) |
| `views` | `viewId` | 54 (2.24%) | 173 (0.9%) | 393 (0.5%) |
| `views` | `label` | 48 (1.99%) | 155 (0.8%) | 363 (0.47%) |
| `views` | `canProbe` | 45 (1.87%) | 135 (0.7%) | 300 (0.39%) |
| `views` | `mounted` | 45 (1.87%) | 135 (0.7%) | 300 (0.39%) |
| `views` | `actor` | 43 (1.78%) | 129 (0.67%) | 286 (0.37%) |
| `views` | `proposals` | 42 (1.74%) | 126 (0.65%) | 280 (0.36%) |
| `links` | `edges` | 1,710 (82.97%) | 19,414 (95.28%) | 98,400 (97.92%) |
| `links` | `views` | 324 (15.72%) | 935 (4.59%) | 2,064 (2.05%) |
| `links` | `default` | 23 (1.12%) | 23 (0.11%) | 23 (0.02%) |

### 4 · churn — one ordinary act, then the same question again

| shape | act | before bytes | after bytes | unchanged (deep) | unchanged (top-level keys) | biggest changed key |
|---|---|---:|---:|---:|---:|---|
| small (3v/8c/12e) | select (point value on a bar) | 9,971 | 10,238 | 97.43% | 94.17% | `analyses` (213 B) |
| small (3v/8c/12e) | filter (interval on a scatter) | 9,971 | 10,236 | 97.43% | 94.17% | `analyses` (213 B) |
| small (3v/8c/12e) | reencode (rebind one channel) | 9,971 | 10,101 | 97.41% | 68.85% | `views` (2,420 B) |
| realistic (9v/30c/132e) | select (point value on a bar) | 48,668 | 48,931 | 99.27% | 98.01% | `analyses` (599 B) |
| realistic (9v/30c/132e) | filter (interval on a scatter) | 48,668 | 48,929 | 99.27% | 98.01% | `analyses` (599 B) |
| realistic (9v/30c/132e) | reencode (rebind one channel) | 48,668 | 48,789 | 99.49% | 57.8% | `views` (19,270 B) |
| large (20v/80c/674e) | select (point value on a bar) | 193,389 | 193,646 | 99.73% | 99.2% | `analyses` (1,182 B) |
| large (20v/80c/674e) | filter (interval on a scatter) | 193,389 | 193,631 | 99.73% | 99.2% | `analyses` (1,182 B) |
| large (20v/80c/674e) | reencode (rebind one channel) | 193,389 | 193,555 | 99.76% | 58.51% | `views` (77,898 B) |

#### 4b · since — the same position, asked for as a delta

| shape | act | full answer | `since` answer | share of the full | parts omitted (unchanged) | served |
|---|---|---:|---:|---:|---:|---|
| small (3v/8c/12e) | select (point value on a bar) | 10,238 | 2,161 | 21.11% | 27 of 34 | delta |
| small (3v/8c/12e) | filter (interval on a scatter) | 10,236 | 2,159 | 21.09% | 27 of 34 | delta |
| small (3v/8c/12e) | reencode (rebind one channel) | 10,101 | 3,141 | 31.1% | 28 of 34 | delta |
| realistic (9v/30c/132e) | select (point value on a bar) | 48,931 | 2,543 | 5.2% | 27 of 34 | delta |
| realistic (9v/30c/132e) | filter (interval on a scatter) | 48,929 | 2,541 | 5.19% | 27 of 34 | delta |
| realistic (9v/30c/132e) | reencode (rebind one channel) | 48,789 | 5,107 | 10.47% | 28 of 34 | delta |
| large (20v/80c/674e) | select (point value on a bar) | 193,646 | 3,121 | 1.61% | 27 of 34 | delta |
| large (20v/80c/674e) | filter (interval on a scatter) | 193,631 | 3,106 | 1.6% | 27 of 34 | delta |
| large (20v/80c/674e) | reencode (rebind one channel) | 193,555 | 8,669 | 4.48% | 28 of 34 | delta |

### 5 · floor — the smallest answer that still supports a first correct act

| shape | full answer | floor (strict) | floor share | floor (shared column list) | shared share | verbs alone |
|---|---:|---:|---:|---:|---:|---:|
| small (3 views · 8 cols · 12 edges · 2 analyses · 1 prose slots) | 9,971 | 587 | 5.89% | 437 | 4.38% | 98 |
| realistic (9 views · 30 cols · 132 edges · 6 analyses · 3 prose slots) | 48,668 | 3,056 | 6.28% | 1,048 | 2.15% | 98 |
| large (20 views · 80 cols · 674 edges · 12 analyses · 5 prose slots) | 193,389 | 14,620 | 7.56% | 2,251 | 1.16% | 98 |

### 6 · tokens

Tokens were **not counted**: not requested — run with --tokens to count real tokens. Every number above is bytes. Do not convert.

