# data — the rows, the engine, and one walk over them

The query port (`DataProvider`: tables, columns, `evaluate(table, clause | clause[] | null)`, `materializeColumn`) is OUR shape; the memory engine answers it today, and the wasm and server engines are typed stubs that render the same SQL descriptor. A clause list is its AND, so the whole live selection is one question.

## One pass, many recorders

Every question a table is asked is a **recorder** that watches one walk over the rows and collects as it goes — the footprintjs law, collect during traversal, never post-process:

```ts
const { n, price, byKey } = foldOnce(rows, { n: rowCount(), price: extent('price'), byKey: keyedIndex('id') });
```

Bring the questions you need, like d3's modules, though not with d3's names where the meaning differs: `rowCount` (every row), `total` (a column's finite numbers, with how many rows were skipped), `extent`, `distinct` (by value identity), `groupCount` (by `String(value)`), `numbers` (a column as the analyses' input, with how many rows were not numbers), `columnar` (the column layout), `columnTypes` (the named columns' types by the one `TypeTally` rule the engine also runs; no names = discover every column), `keyedIndex` (the delta's index, by `String(key)`). A recorder is a fresh instance per fold — one instance under two keys is refused, since it would step twice — and `result()` is pure over what it saw and may be read again. A recorder that throws aborts the fold: an answer built on a walk that broke is not an answer (a fold fails fast, unlike a footprintjs observer, which never aborts a run). The engine builds a store and its types in one walk, the refresh's delta indexes each side in one, and every analysis takes its columns from one.

Not a recorder: bins — `bins.ts` recounts NEW values into fixed edges, one walk of its own — and the group-by chart's count-and-sum, likewise one walk.

## The sheet's window (`sort`, `offset`, `indices`)

`evaluate(table, clauses, { sort, offset, limit, indices })` is the one call a sheet window makes. `sort` is a list of `{ field, dir, absent }` keys; the memory engine builds ONE permutation per (table, sort spec) — an `Int32Array` sorted in place — and keeps the most recently used few per table (`sortCache`, default `SORT_CACHE_PER_TABLE` = 8; 4 bytes per row per kept sort), rebuilt when the row count moved and dropped when a column is materialised; a window walks the permutation with the predicate, so a brush never rebuilds the sort. The order is total: numbers, then dates, then booleans, then everything by its text, then what cannot say itself — ranks never mix, so `2`, `10` and `"100"` cannot loop; ties keep source order; absent values (null, undefined, NaN, an invalid date) sit together at one end, last unless `absent: 'first'`. `offset` skips matching rows and comes back as `start` (clamped to `count`); every match is counted but only the window's rows are collected; `indices: true` returns each row's source-order index, which the session turns into a positional row id (`<version>#<index>`) when the table declares no key. A malformed window is refused (`bad-window`) and a sort by a missing column is refused (`unknown-column`) in both modes; an engine without `capabilities.canSort` refuses a sort (`unsupported-sort`, enforced in every engine) rather than answering in source order. The session's `viewQuery` / `clausesFor` (src/session) sit above this: whose eyes, which clauses reach, the row identity, and a default window of `VIEW_QUERY_DEFAULT_LIMIT` rows.
