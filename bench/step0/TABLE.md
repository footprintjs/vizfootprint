node v22.16.0 · darwin arm64 · shape {"kinds":[57,9,4],"weeks":86,"reportStates":{"present":0.9783388704318937,"not-configured":0.017674418604651163,"unavailable":0.003986710963455149,"withheld":0,"unknown":0}} · reps {"90k":11,"1M":5} · warm-up 3

| group | measurement | 90k-syn median / p95 (ms) | 90k-real median / p95 (ms) | 1M-syn median / p95 (ms) |
|---|---|---:|---:|---:|
| construct | memoryProvider layout=row (clone rows + columnTypes fold) | 4.95 / 6.04 | 8.95 / 9.43 | 64.9 / 65.8 |
| construct | memoryProvider layout=column (columnar + columnTypes fold) | 10.5 / 10.7 | 22.6 / 26.0 | 112 / 116 |
| evaluate | point disease · mode=count · layout=row | 1.12 / 4.54 | 2.02 / 2.59 | 23.7 / 24.4 |
| evaluate | point disease · mode=count · layout=column | 1.09 / 3.40 | 1.98 / 2.51 | 23.1 / 23.6 |
| evaluate | point disease · mode=rows · layout=row | 1.23 / 1.27 | 2.12 / 2.63 | 24.1 / 24.3 |
| evaluate | point disease · mode=rows · layout=column | 1.53 / 1.58 | 2.96 / 3.42 | 23.5 / 23.8 |
| evaluate | AND point disease + interval t · mode=count · layout=row | 2.93 / 3.78 | 3.09 / 3.75 | 33.4 / 34.1 |
| evaluate | AND point disease + interval t · mode=count · layout=column | 2.89 / 3.65 | 3.04 / 3.70 | 33.1 / 33.8 |
| evaluate | AND point disease + interval t · mode=rows · layout=row | 3.12 / 3.88 | 3.06 / 3.84 | 33.5 / 34.4 |
| evaluate | AND point disease + interval t · mode=rows · layout=column | 3.15 / 3.82 | 3.57 / 4.16 | 32.7 / 33.9 |
| evaluate | null (whole table) · mode=count · layout=row | 0.83 / 3.39 | 0.93 / 1.05 | 11.2 / 11.5 |
| evaluate | null (whole table) · mode=count · layout=column | 0.84 / 0.91 | 0.88 / 1.15 | 11.1 / 11.4 |
| evaluate | null (whole table) · mode=rows · layout=row | 1.97 / 2.02 | 2.05 / 2.10 | 18.8 / 19.8 |
| evaluate | null (whole table) · mode=rows · layout=column | 7.49 / 7.93 | 16.1 / 16.4 | 102 / 103 |
| fold | rowCount+extent(cases)+distinct(disease)+groupCount(report_state) | 2.92 / 3.02 | 3.68 / 3.75 | 28.4 / 28.6 |
| fold | columnar(all cols)+columnTypes(all cols) | 10.7 / 10.8 | 22.8 / 23.6 | 110 / 111 |
| fold | keyedIndex(jurisdiction) (repeated keys → mostly unkeyed) | 1.62 / 1.66 | 2.30 / 2.35 | 13.2 / 13.6 |
| fold | keyedIndex(id) (unique key per row → n Map inserts) | 4.06 / 4.10 | 4.16 / 4.19 | 55.8 / 64.7 |
| fold | rowCount only (walk + one no-op recorder = floor) | 0.53 / 0.60 | 0.52 / 0.57 | 5.44 / 5.69 |
| gesture | evaluate(AND, rows, layout=row) + foldOnce(4 recorders) over the answer | 3.29 / 3.40 | 3.24 / 3.68 | 34.2 / 40.9 |
| gesture | evaluate(point, rows, layout=row) + foldOnce(4 recorders) over the answer | 2.47 / 2.74 | 2.51 / 2.66 | 25.1 / 25.2 |
| page | point disease · filter only (mode=count) | 2.09 / 2.19 | 2.05 / 2.66 | 24.5 / 24.6 |
| page | point disease · evaluate(rows) all matches + slice(0,100) | 2.18 / 2.20 | 2.15 / 2.59 | 24.5 / 24.7 |
| page | point disease · evaluate(rows) all matches + slice(5000,5100) | 2.18 / 2.22 | 2.16 / 2.66 | 24.4 / 24.8 |
| page | point disease · evaluate(rows, limit=100) (filter + materialize 100) | 2.09 / 2.17 | 2.07 / 3.03 | 24.1 / 24.5 |
| page | point disease · evaluate(rows) + header stats (8 recorders) + slice(0,100) | 2.82 / 2.94 | 2.90 / 3.50 | 24.9 / 25.3 |
| page | point disease · slice(5000,5100) of an already-materialized answer | 0.00 / 0.01 | 0.00 / 0.00 | 0.00 / 0.00 |
| page | point disease · header stats (8 recorders) over the 6,020 matched rows | 0.75 / 1.16 | 0.92 / 0.98 | 0.52 / 0.86 |
| page | AND · filter only (mode=count) | 3.05 / 3.86 | 2.94 / 3.66 | 33.5 / 35.5 |
| page | AND · evaluate(rows) all matches + slice(0,100) | 3.09 / 3.83 | 3.00 / 4.03 | 33.0 / 35.0 |
| page | AND · evaluate(rows) all matches + slice(5000,5100) | 3.08 / 3.85 | 3.02 / 3.77 | 33.2 / 35.6 |
| page | AND · evaluate(rows, limit=100) (filter + materialize 100) | 3.01 / 3.84 | 3.00 / 3.72 | 33.6 / 35.2 |
| page | AND · evaluate(rows) + header stats (8 recorders) + slice(0,100) | 3.45 / 3.59 | 3.48 / 4.29 | 33.5 / 35.1 |
| page | AND · slice(5000,5100) of an already-materialized answer | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| page | AND · header stats (8 recorders) over the 3,080 matched rows | 0.38 / 0.48 | 0.43 / 0.53 | 0.29 / 0.46 |
| demo-tick | App.tsx folds, no live clause (18 passes: 5+1+3+1+1+1+1+1+4) | 16.7 / 17.2 | 8.63 / 8.80 | 86.3 / 86.4 |
| demo-tick | App.tsx folds, 2 live clauses (point + interval keep) | 7.03 / 15.3 | 8.54 / 9.10 | 87.5 / 88.1 |
| demo-tick | diseaseData alone: group-by-disease sum of cases (1 pass, 2-clause keep) | 0.58 / 1.92 | 0.79 / 0.93 | 8.49 / 8.97 |
| demo-tick | coverageData alone: group-by-report_state count (5 filter passes, 2-clause keep) | 3.26 / 3.30 | 3.49 / 3.56 | 31.0 / 31.3 |
| demo-tick | weekData alone: per-week sum over kept states (1 pass, 2-clause keep) | 0.59 / 1.76 | 0.74 / 0.77 | 8.29 / 8.33 |
| demo-tick | server /api/state per poll: evaluate(AND, count, layout=row) (session.selectedCount) | 3.07 / 4.97 | 2.98 / 3.70 | 34.1 / 36.4 |
