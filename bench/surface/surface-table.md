node v22.16.0 · darwin arm64 · 2026-09-03T22:23:44.270Z

**Unit: UTF-8 bytes.** Tokens NOT counted (not requested — run with --tokens to count real tokens).

### 1 · menu — the fixed cost paid every turn

Whole menu: **17,521 bytes**, 9 tools. Byte-stability: **HOLDS** — byte-identical across all three shapes and across a session that acted — the documented claim holds

| tool | shape | bytes | of which description | of which schema |
|---|---|---:|---:|---:|
| `viz.whats_here` | any (shape-independent) | 1,086 | 969 | 62 |
| `viz.dispatch` | any (shape-independent) | 9,873 | 2,526 | 7,294 |
| `viz.declare_analysis` | any (shape-independent) | 645 | 312 | 272 |
| `viz.why` | any (shape-independent) | 599 | 354 | 197 |
| `viz.fork` | any (shape-independent) | 799 | 469 | 281 |
| `viz.bookmark` | any (shape-independent) | 518 | 200 | 265 |
| `viz.paths` | any (shape-independent) | 1,926 | 1,038 | 838 |
| `viz.compare` | any (shape-independent) | 612 | 320 | 240 |
| `viz.propose_chart` | any (shape-independent) | 1,453 | 857 | 538 |
| **total** | any (shape-independent) | **17,521** | | |

### 2 · whats_here — the per-call answer

| shape | views | table cols | link edges | analyses | prose slots | whats_here bytes | × the menu |
|---|---:|---:|---:|---:|---:|---:|---:|
| small | 3 | 8 | 12 | 2 | 1 | 7,010 | 0.40× |
| realistic | 9 | 30 | 132 | 6 | 3 | 45,707 | 2.61× |
| large | 20 | 80 | 674 | 12 | 5 | 190,428 | 10.87× |

### 3 · composition — where the answer's bytes go

| key | small bytes (share) | realistic bytes (share) | large bytes (share) |
|---|---:|---:|---:|
| `links` | 2,069 (29.51%) | 20,384 (44.6%) | 100,499 (52.78%) |
| `views` | 2,420 (34.52%) | 19,270 (42.16%) | 77,898 (40.91%) |
| `columns` | 597 (8.52%) | 2,181 (4.77%) | 5,781 (3.04%) |
| `dashboard` | 39 (0.56%) | 633 (1.38%) | 633 (0.33%) |
| `offers` | 233 (3.32%) | 616 (1.35%) | 1,343 (0.71%) |
| `analyses` | 213 (3.04%) | 599 (1.31%) | 1,182 (0.62%) |
| `effectiveEncodings` | 191 (2.72%) | 483 (1.06%) | 1,016 (0.53%) |
| `encodings` | 182 (2.6%) | 474 (1.04%) | 1,007 (0.53%) |
| `rules` | 279 (3.98%) | 279 (0.61%) | 279 (0.15%) |
| `tables` | 117 (1.67%) | 118 (0.26%) | 119 (0.06%) |
| `time` | 97 (1.38%) | 97 (0.21%) | 97 (0.05%) |
| `fdr` | 94 (1.34%) | 94 (0.21%) | 94 (0.05%) |
| `paths` | 79 (1.13%) | 79 (0.17%) | 79 (0.04%) |
| `encodingPolicy` | 63 (0.9%) | 63 (0.14%) | 63 (0.03%) |
| `engines` | 27 (0.39%) | 27 (0.06%) | 27 (0.01%) |
| `keys` | 24 (0.34%) | 24 (0.05%) | 24 (0.01%) |
| `clearedSelections` | 22 (0.31%) | 22 (0.05%) | 22 (0.01%) |
| `offerId` | 22 (0.31%) | 22 (0.05%) | 22 (0.01%) |
| `selectedRowCount` | 22 (0.31%) | 22 (0.05%) | 23 (0.01%) |
| `defaultTable` | 21 (0.3%) | 21 (0.05%) | 21 (0.01%) |
| `activeSelections` | 21 (0.3%) | 21 (0.05%) | 21 (0.01%) |
| `currentView` | 18 (0.26%) | 18 (0.04%) | 18 (0.01%) |
| `journalTotal` | 16 (0.23%) | 16 (0.04%) | 16 (0.01%) |
| `bookmarks` | 14 (0.2%) | 14 (0.03%) | 14 (0.01%) |
| `filters` | 12 (0.17%) | 12 (0.03%) | 12 (0.01%) |
| `sources` | 12 (0.17%) | 12 (0.03%) | 12 (0.01%) |
| `journal` | 12 (0.17%) | 12 (0.03%) | 12 (0.01%) |
| `layouts` | 12 (0.17%) | 12 (0.03%) | 12 (0.01%) |
| `charts` | 11 (0.16%) | 11 (0.02%) | 11 (0.01%) |
| `notes` | 10 (0.14%) | 10 (0.02%) | 10 (0.01%) |
| `saved` | 10 (0.14%) | 10 (0.02%) | 10 (0.01%) |
| `ok` | 9 (0.13%) | 9 (0.02%) | 9 (0%) |
| `gaps` | 8 (0.11%) | 8 (0.02%) | 8 (0%) |
| **total** | **7,010** | **45,707** | **190,428** |

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
| small (3v/8c/12e) | select (point value on a bar) | 7,010 | 7,277 | 96.69% | 92.87% | `analyses` (213 B) |
| small (3v/8c/12e) | filter (interval on a scatter) | 7,010 | 7,275 | 96.69% | 92.87% | `analyses` (213 B) |
| small (3v/8c/12e) | reencode (rebind one channel) | 7,010 | 7,140 | 96.66% | 56.85% | `views` (2,420 B) |
| realistic (9v/30c/132e) | select (point value on a bar) | 45,707 | 45,970 | 99.27% | 98.06% | `analyses` (599 B) |
| realistic (9v/30c/132e) | filter (interval on a scatter) | 45,707 | 45,968 | 99.27% | 98.06% | `analyses` (599 B) |
| realistic (9v/30c/132e) | reencode (rebind one channel) | 45,707 | 45,828 | 99.51% | 55.24% | `views` (19,270 B) |
| large (20v/80c/674e) | select (point value on a bar) | 190,428 | 190,685 | 99.74% | 99.23% | `analyses` (1,182 B) |
| large (20v/80c/674e) | filter (interval on a scatter) | 190,428 | 190,670 | 99.74% | 99.23% | `analyses` (1,182 B) |
| large (20v/80c/674e) | reencode (rebind one channel) | 190,428 | 190,594 | 99.77% | 57.91% | `views` (77,898 B) |

### 5 · floor — the smallest answer that still supports a first correct act

| shape | full answer | floor (strict) | floor share | floor (shared column list) | shared share | verbs alone |
|---|---:|---:|---:|---:|---:|---:|
| small (3 views · 8 cols · 12 edges · 2 analyses · 1 prose slots) | 7,010 | 587 | 8.37% | 437 | 6.23% | 98 |
| realistic (9 views · 30 cols · 132 edges · 6 analyses · 3 prose slots) | 45,707 | 3,056 | 6.69% | 1,048 | 2.29% | 98 |
| large (20 views · 80 cols · 674 edges · 12 analyses · 5 prose slots) | 190,428 | 14,620 | 7.68% | 2,251 | 1.18% | 98 |

### 6 · tokens

Tokens were **not counted**: not requested — run with --tokens to count real tokens. Every number above is bytes. Do not convert.

