# data — the rows, the engine, and one walk over them

The query port (`DataProvider`: tables, columns, `evaluate(table, clause | clause[] | null)`, `materializeColumn`) is OUR shape; the memory engine answers it today, and the wasm and server engines are typed stubs that render the same SQL descriptor. A clause list is its AND, so the whole live selection is one question.

## Reading a commit: ONE translation, two evaluators

A `PredicateClause` is the shape this folder EVALUATES. It is not the shape a commit CARRIES. A commit carries a flat wire triple — `{kind, field, value}` (plus `fields` for a cell) — and the two disagree in three places: a `match`'s list and polarity ride INSIDE `value`, where the clause keeps `values`/`exclude` as siblings; a `cell`'s `field` is a display label (`"price × category"`), never a column, and the authoritative pair rides `fields`; and "cleared" has four spellings on the wire against exactly one here (`clause === null`, no filter).

So reading a triple is a real translation with real rules, and the library used to keep it to itself — which meant every consumer holding a commit wrote the rules again. `clauseFromWire(kind, field, value, fields?)` is that reading, exported through `vizfootprint/data`, and `cellSideClause(field, side)` is its other half (an array side is an interval, anything else a point) for a consumer that needs the two sides apart:

```ts
import { clauseFromWire, matchesClause } from 'vizfootprint/data';

const c = session.log.records.at(-1)!;                        // a landed commit
rows.filter((row) => matchesClause(row, clauseFromWire(c.kind, c.field, c.value, c.fields)));
```

It is **total**, and CLEARED is its only fallback: nothing throws, and a value the wire's declared shape does not cover (a match body with no list, an interval or cell value that is not a two-element pair, a cell whose `fields` never arrived) keeps every row rather than narrowing on a value nobody can interpret.

**Two evaluators are fine; two translations are not.** `matchesClause` interprets a clause per row. `ui/src/contract/selection.ts` COMPILES the same clause once and closes over the answer, because its predicate runs per row per frame over a 90k-row table. Those can only differ in speed — but two readings of a triple can differ about what a commit MEANS, silently, and the answer on screen would be the one nobody tested. The compiler therefore calls `clauseFromWire` and its test is a *delegation check*, not a parity pin: compiled must equal interpreted over the same translation.

**Did the two readings agree before they were merged?** Measured, not assumed: the old ui mirror and today's `clauseFromWire` were run against each other over every kind × field × value × field-pair × row — 9,730 comparisons inside the wire's declared shape, and **zero disagreements**. There was no live bug to find; what there was, was a rule kept in step by hand.

Outside that shape the two differ in exactly four ways, all on values no commit can carry, and in every one the old answer was a throw or a guess: an interval whose value was not iterable (a bare number) THREW; an interval whose value was a string was destructured into two characters and read as lexicographic bounds; a match whose body was not an object THREW on `.values`; a cell whose value was not a pair was indexed into for its sides. All four now read as CLEARED, and the function never throws.

One duplicate is still open and is named rather than hidden: `probeClause` in `src/session/session.ts` is the library's own internal twin of this reading (point/interval/match), and the three `rec.kind === 'cell' ? {…} : probeClause(…)` ternaries beside it restate the cell lift. They are unchanged, and folding them into `clauseFromWire` is a session-side decision, not a data-side one.

## One pass, many recorders

Every question a table is asked is a **recorder** that watches one walk over the rows and collects as it goes — the footprintjs law, collect during traversal, never post-process:

```ts
const { n, price, byKey } = foldOnce(rows, { n: rowCount(), price: extent('price'), byKey: keyedIndex('id') });
```

Bring the questions you need, like d3's modules, though not with d3's names where the meaning differs: `rowCount` (every row), `total` (a column's finite numbers, with how many rows were skipped), `extent`, `distinct` (by value identity), `groupCount` (by `String(value)`), `numbers` (a column as the analyses' input, with how many rows were not numbers), `columnar` (the column layout), `columnTypes` (the named columns' types by the one `TypeTally` rule the engine also runs; no names = discover every column), `keyedIndex` (the delta's index, by `String(key)`). A recorder is a fresh instance per fold — one instance under two keys is refused, since it would step twice — and `result()` is pure over what it saw and may be read again. A recorder that throws aborts the fold: an answer built on a walk that broke is not an answer (a fold fails fast, unlike a footprintjs observer, which never aborts a run). The engine builds a store and its types in one walk, the refresh's delta indexes each side in one, and every analysis takes its columns from one.

Not a recorder: bins — `bins.ts` recounts NEW values into fixed edges, one walk of its own — and the group-by chart's count-and-sum, likewise one walk.

## The sheet's window (`sort`, `offset`, `indices`)

`evaluate(table, clauses, { sort, offset, limit, indices })` is the one call a sheet window makes. `sort` is a list of `{ field, dir, absent }` keys; the memory engine builds ONE permutation per (table, sort spec) — an `Int32Array` sorted in place — and keeps the most recently used few per table (`sortCache`, default `SORT_CACHE_PER_TABLE` = 8; 4 bytes per row per kept sort), rebuilt when the row count moved and dropped when a column is materialised; a window walks the permutation with the predicate, so a brush never rebuilds the sort. The order is total: numbers, then dates, then booleans, then everything by its text, then what cannot say itself — ranks never mix, so `2`, `10` and `"100"` cannot loop; ties keep source order; absent values (null, undefined, NaN, an invalid date) sit together at one end, last unless `absent: 'first'`. `offset` skips matching rows and comes back as `start` (clamped to `count`); every match is counted but only the window's rows are collected; `indices: true` returns each row's source-order index, which the session turns into a positional row id (`<version>#<index>`) when the table declares no key. A malformed window is refused (`bad-window`) and a sort by a missing column is refused (`unknown-column`) in both modes; an engine without `capabilities.canSort` refuses a sort (`unsupported-sort`, enforced in every engine) rather than answering in source order. The session's `viewQuery` / `clausesFor` (src/session) sit above this: whose eyes, which clauses reach, the row identity, and a default window of `VIEW_QUERY_DEFAULT_LIMIT` rows.

## A derived column belongs to the act that made it

Source columns are the MAP: declared, still, there before anyone looked, and not the trace's to edit. A **derived** column — an analysis's `as: 'columns'` output, landed through `materializeColumn` — is the TRACE: it exists only because an act created it, at a position, on a branch.

For a while this folder stored the second kind in the first kind's slot. `materializeColumn` wrote one array per column NAME into the shared table store, and there is exactly one slot per name for the whole dashboard. The session, meanwhile, scoped a derived column's VISIBILITY per branch. So the name was isolated and the bytes were not, and both of the failures that produced were silent — the dashboard went on explaining itself, in this library's own provenance, about numbers that were not the ones it named:

```ts
// ① two branches, one name
const a = await s.declareAnalysis('riskByPrice');   // risk = [0,0,1,1,2,2,3,3]
s.seek(rootId);
await s.declareAnalysis('riskByRating');            // risk = [0,0,0,0,1,1,1,1]
s.seek(a.commit.id);                                // back to A
await s.viewQuery({ columns: ['id', 'risk'] });     // [0,0,0,0,1,1,1,1]  ← B's numbers,
                                                    //   visible on A, attributed to A's commit
// ② a computed column with a source column's name
await s.declareAnalysis('scoreAsPrice');            // out column: "price"
await s.viewQuery({ columns: ['id', 'price'] });    // [0,0,0,0,0]  — the real prices, gone
dash.createSession();                               // and gone for every other session too,
                                                    //   permanently, with no commit recording it
```

Three rules close them. They are one idea seen from three sides: **a derived column gets a slot per ACT, never a slot per name.**

### 1. A derived column may never take a declared column's name

A refusal, not a merge, and judged before a single value moves — the all-or-nothing law in [`../session/README.md`](../session/README.md). The gap is an ordinary `guard-failed`, the code the sibling refusal in the same loop already uses; no new code was needed for it:

```ts
const out = await s.declareAnalysis('scoreAsPrice');   // its out column is "price"

out.commit;         // defined — the analysis RAN; the refusal is about the WRITE
out.materialized;   // []  — and it honestly claims nothing landed
out.gap;
// { code: 'guard-failed', op: 'declareAnalysis', target: 'price',
//   detail: 'analysis "scoreAsPrice" would write column "price" over the declared
//            source column "price" of table "data" — a computed column may not
//            take a source column's name' }

await s.viewQuery({ columns: ['id', 'price'] });   // 50, 53, 56, 59, 62 — untouched
```

Why a refusal rather than a rename or a merge: source data is the one thing on a dashboard that no act produced, so there is no commit that could honestly describe changing it. A merge would be a change to what the dashboard is showing with nothing on the trace behind it — the exact thing [`../detach/README.md`](../detach/README.md) exists to make impossible. And the blast radius is not the branch or the session: the table store is dashboard-scoped, so the write destroys real values for every session on that dashboard, for as long as it lives.

The judge needs to know which names are the map's. **Every store column the derived registry does not know is declared** — which is also why re-running an analysis is never a collision with itself: its own earlier output lives in a registered slot, never under the bare name. If an engine cannot list its columns at all, the write is refused with `needs-backend-data` rather than attempted, because "I don't know what I'd be overwriting" is not a licence to overwrite.

### 2. A derived column is versioned by the act that created it

It is written into the store under a name that carries its commit — `risk@s7` — and a read of `risk` resolves to whichever act is on the cursor's branch path. Two branches' `risk` are two different arrays, and seeking gives the right one:

```ts
s.seek(a.commit.id);
await s.viewQuery({ columns: ['id', 'risk'] });   // [0,0,1,1,2,2,3,3]  — A's own
s.seek(b.commit.id);
await s.viewQuery({ columns: ['id', 'risk'] });   // [0,0,0,0,1,1,1,1]  — B's own
```

`src/data/derivedColumns.ts` is the ONE owner of that spelling. Nothing else may compose a physical name, and — the part that matters — **nothing may ever PARSE one**. A CSV could arrive tomorrow with a column genuinely named `risk@s7`; whether a name is derived is answered by the registry, which knows what it wrote, never by looking for the marker in the string. (A source column that happens to be spelled like a slot is caught by the same judge as rule 1, which checks the slot against the declared set too.)

The registry is **dashboard-scoped**, beside the bookmark, saved-picture and commit-id stores, because the table store is: two sessions on one `buildDashboard` write into one provider. Were it per-session, session B would read session A's `risk@s7` as an ordinary declared column — the same leak one level along.

When one name is computed twice on the SAME path, the later act wins: a re-run **supersedes**, it does not shadow. The demo relies on this — a button and an agent turn both declare the clustering — and the column stays visible and singular, reading the newer numbers, while seeking back to the earlier commit still reads the earlier ones.

### 3. Visibility is what falls out of resolution, not a second mechanism beside it

`Session.effectiveColumnsOf` used to filter the column list against a parallel set of "names materialized somewhere". That second mechanism was the defect: it scoped the NAME while the store scoped nothing. It is now a thin projection over the same resolution rule 2 uses — one source of truth for what a column means at a position.

A store column the registry does not know is declared, and is visible on every branch: the map does not move with the walker. A derived column resolved at the cursor is visible under its logical name. A derived column resolved nowhere on this path is simply absent — so a `select` on it is an honest `needs-column`, and `overview().columns` omits it, for the same reason and by the same code.

`Session.ask` is the one door from a clause to an engine: fields, sort keys and the column projection go in translated, and rows come back wearing the names the caller asked for. A table with no derived column resolved at the cursor takes an untouched path — no map, no rewrite, no per-row allocation — which is every table on every dashboard until an analysis lands a column. The `sql` descriptor deliberately keeps the physical spelling: it records the column the engine actually read, and that name IS the act that produced it.

A **refresh** replaces a table's whole provider, so the slots its derived columns lived in are gone. The registry for that table is dropped with it — otherwise the session would keep resolving a name the store no longer has — and the refresh reports what was lost by the name a person knows (`risk`), never by the slot it lived in (`risk@s7`).

### Retention: versions are kept, and what that costs

**Every version is kept.** A derived column is evidence — it is the output of an act that is on the trace, and this library never rewinds state. Dropping a superseded version would mean a commit you can still seek to, whose column you can still see named in the log, that can no longer answer what it held; that is a hole in the trace, arriving quietly at whatever moment a garbage-collector chose.

The cost, measured on the real provider rather than estimated (100k rows, ten versions, `--expose-gc`, heap delta per version):

| column | columnar layout | row-major layout |
|---|---|---|
| int (a 4-bin cluster id) | 860 KB per version — 8.8 bytes/row | 1173 KB per version — 12.0 bytes/row |
| string (a bucket label) | 3204 KB per version — 32.8 bytes/row | 3516 KB per version — 36.0 bytes/row |

So on a 100k-row table, re-running one int-producing analysis ten times costs about **9 MB**, and the registry itself is four small strings per version. That is the price of being able to seek to any of those ten moments and read what it actually held. At a row count where it stops being the right trade — a million rows and a habit of re-running — the fix is a retention policy with a commit behind it (an act that drops versions and says so), not a silent collector; nothing here should start discarding evidence on its own.

### What the port owes

**Nothing new.** `DataProvider` is unchanged: `materializeColumn(table, name, values)` still lands one column under the name it is given. The versioning is entirely the session's business — it passes a name that happens to be unique per act — so the memory engine stayed dumb and the wasm and server stubs owe no new behaviour. That is deliberate: the port is the MAP's surface, and which columns belong to the trace is not something a query engine should have to know.

One consequence worth stating plainly: the judge lives in the session, so **a caller that reaches past it and calls `provider.materializeColumn` directly can still overwrite a source column.** That is a caller writing into the store outside any act — there is no trace for it to be consistent with, and the column it lands is, correctly, indistinguishable from declared data afterwards. The session is the thing that judges; going around the session goes around the judge.
