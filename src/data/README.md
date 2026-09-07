# data — the rows, the engine, and one walk over them

The query port (`DataProvider`: tables, columns, `evaluate(table, clause | clause[] | null)`, `materializeColumn`) is OUR shape; the memory engine answers it today, and the wasm and server engines are typed stubs that render the same SQL descriptor. A clause list is its AND, so the whole live selection is one question.

## The two engines this version does not run

Three engines are named; one answers. `memoryProvider` runs. `wasmProvider` and `serverProvider` are typed stubs — declared so the port's shape is honest before the backends exist — and a stub answers **only its declared table list**: every read of a column or a row is refused. `stubEngines.ts` is the one place that says so, so the build door and the read door say it in the same words instead of each inventing its own:

```ts
await wasmProvider().columns('cases');
// { ok: false, engine: 'wasm', operation: 'columns', reason: 'not-implemented',
//   detail: 'the "wasm" engine answers no query in this version — it is a typed stub: it names
//            its declared tables and answers nothing else. Declare engine "memory" to run "cases"
//            in this process, or bring the engine yourself: pass
//            { providers: { "cases": yourProvider } } to the builder you already call' }
```

Two laws sit inside that sentence. **A refusal points at what to do instead** — "no DuckDB-WASM connector is wired yet" names our build order, where the person reading it is holding a table that answers nothing. And **one wording, every door**: `buildDashboard` quotes these exact words as a build note the moment a def routes a table here, and `lint()` throws them ([`../def/README.md`](../def/README.md)), so nobody learns the same fact twice, differently. Change the words in `stubEngines.ts` and every door moves together; write them anywhere else and they drift.

`tables()` is the one thing a stub still answers honestly — the DECLARED list is real information, and an empty array would be a lie of a different kind, which is why the sentence itself says so rather than claiming the table is wholly dark. A sorted window keeps its own REASON (`unsupported-sort`, the law every engine keeps) and quotes the same sentence for its detail, because "ask for this window without a sort" pointed a caller at a second refusal. The one refusal here that is *not* the shared sentence is `serverProvider.materializeColumn`: it is refused by the declared capability (`canMaterialize: false`), not by our build order, because a real Coordinator behind that provider would refuse a write-back too — and the remedy never names a builder, because which door an author must call is a fact about the whole def (a remote source forces `buildDashboardAsync`), not about the table being refused.

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

One duplicate is still open and is named rather than hidden: `probeClause` in `src/session/wire.ts` is the library's own internal twin of this reading (point/interval/match), and the `rec.kind === 'cell' ? {…} : probeClause(…)` ternaries in `src/session/session.ts` restate the cell lift. They are unchanged, and folding them into `clauseFromWire` is a session-side decision, not a data-side one.

## One gesture on a node: the `neighbourhood` clause

One gesture on a node selects the ties INSIDE its ego set: a row of the edges table is kept when BOTH endpoint columns name a node in the walked set — the INDUCED ego subgraph, which is the edge set the network chart brightens for that same gesture, and what a depth-1 ego filter returns in Cytoscape, Gephi and Bloom. "Either endpoint" would reach one edge-hop further, keeping a neighbour's tie to a stranger the seed never touches, and a gesture's rows must be the ones its own highlight promised.

It is a kind of its own, with its own arm in every reader, for the reason the `cell` above is one: ONE gesture lands ONE commit, over a value (the walk) recorded whole. Two composed clauses would be two acts and two records of half a question.

```ts
import { clauseFromWire, matchesClause, resolvePredicateSQL } from 'vizfootprint/data';

const clause = { kind: 'neighbourhood', fields: ['from', 'to'], ids: ['Zika', 'Lyme', 'Mumps'] } as const;
resolvePredicateSQL(clause);   // `(("from" IN ('Zika', 'Lyme', 'Mumps')) AND ("to" IN ('Zika', 'Lyme', 'Mumps')))`
edges.filter((row) => matchesClause(row, clause));                    // every tie INSIDE the walked set

// read back off a landed commit — the walked ids ride inside the value, the endpoint pair in `fields`
clauseFromWire('neighbourhood', 'from ↔ to', record.value, record.fields);
```

**The answer is recorded with its question.** The wire value is `{ seed, derivation, hops, ids }` (or `null` to clear): the ids are the ANSWER a walk produced, and the seed, the derivation (`'ego'` — one hop out) and the hop count are the QUESTION that produced them. A record carrying only the seed would have to re-walk to be read, and a read at a cursor must answer about THAT cursor — the rows a later act may have changed. The clause tier keeps only the `ids`, exactly as a match keeps only its `values`; the rest is provenance, never predicate. `clauseFields` answers both endpoint columns, `neighbourhoodFieldLabel(['from','to'])` mints the display-only `"from ↔ to"` for the slots that expect one field name (`×` is the cell's; `↔` says "one edge", whose both ends the predicate asks about), and `renameClauseFields` rewrites both columns and never the ids — those are node keys, not column names.

**The question has a door of its own.** `clauseFromWire` yields the PREDICATE (the ids), because that is all a row filter needs; `neighbourhoodValueFromWire(record.value)` yields the recorded QUESTION beside it — `{ seed, derivation, hops, ids }`, or `null` for a body carrying no walked list. Every slot is answered in ONE place: an absent seed reads as `null` (UNNAMED, never a node key), an unreadable derivation as this version's own `'ego'`, an unreadable hop count as `1`; a derivation another build minted rides through verbatim, because a body still selects by its recorded ids. A chip, a commit-log line and a chart that highlights the seed all read it here rather than writing the three defaults again.

**The two-column kinds are data, not a fork.** `PAIR_CLAUSE_KINDS` (`['cell', 'neighbourhood']`) is the one array literal, with `isPairKind(kind)` for the slots that ask about a KIND before a clause exists — a wire triple's arm, a saved condition, a `CommitInput` the log judges — and `isPairClause(clause)` for the narrowed question over a built one. `clauseFields` reads it too, so the third pair kind lands in one place.

**An empty walked set keeps nothing, and says so.** `(FALSE)` in the honest SQL, the real `literal(false)`'s bare `FALSE` in the engine's byte — the same always-false an empty match keep-list already renders, and never "no filter": clearing is `clause === null`, one spelling. The ids go through the real `isIn` and not the point factory's null-safe `isInDistinct`, because a walk MATERIALIZED them — a `null` that reached the list renders as the literal `NULL` the engine itself would render rather than being quietly rewritten into an `IS NULL`. The in-process filter keeps the same law: `IN (NULL)` is never true, so a nullish id is dropped from the membership set and a row with a missing endpoint is kept by no walk — the two readings of one clause answer alike.

## Two descriptors, two jobs: the honest SQL and the engine's byte

`resolvePredicateSQL` is the SQL an engine could execute, and on two shapes — a half-open pair and a string pair — it deliberately says something Mosaic does not (`("amount" >= 150)` where Mosaic says `("amount" BETWEEN 150 AND NULL)`). `mosaicDescriptorSQL(kind, field, value)` beside it is the other job: the exact `String(clause.predicate)` real Mosaic renders, oddities included, measured on `@uwdata/mosaic-core@0.28.1` and pinned in `predicate.test.ts` against the real factories for every kind × shape. It exists because `CommitRecord.predicateSQL` is the one persisted engine-derived byte, and the built-in selection port (`src/selection`) must write the same byte the Mosaic adapter writes. Neither renderer may drift toward the other; `engineInvariant.test.ts` carries both shapes and asserts both answers by name.

```ts
import { mosaicDescriptorSQL, resolvePredicateSQL } from 'vizfootprint/data';

mosaicDescriptorSQL('interval', 'amount', [150, null]);                                  // '("amount" BETWEEN 150 AND NULL)'  — the log's byte
resolvePredicateSQL({ kind: 'interval', field: 'amount', value: [150, null] });           // '("amount" >= 150)'                — the SQL an engine runs
mosaicDescriptorSQL('cell', ['price', 'category'], [[10, 20], undefined as never]);     // throws TypeError — a shape the real builders refuse
mosaicDescriptorSQL('point', 'pValue', { id: 'a1', table: 'data' });                    // '("pValue" IN ([object Object]))' — Mosaic's coercion, kept; resolvePredicateSQL refuses the same object
```

Values are clause-tier (a point's `undefined` clears, its `null` is IS NULL — apply `pointValueFromWire` first); a cleared clause renders the same `"null"` `isClearedSQL` recognises.

## One pass, many recorders

Every question a table is asked is a **recorder** that watches one walk over the rows and collects as it goes — the footprintjs law, collect during traversal, never post-process:

```ts
const { n, price, byKey } = foldOnce(rows, { n: rowCount(), price: extent('price'), byKey: keyedIndex('id') });
```

Bring the questions you need, like d3's modules, though not with d3's names where the meaning differs: `rowCount` (every row), `total` (a column's finite numbers, with how many rows were skipped), `extent`, `distinct` (by value identity), `groupCount` (by `String(value)`), `numbers` (a column as the analyses' input, with how many rows were not numbers), `columnar` (the column layout), `columnTypes` (the named columns' types by the one `TypeTally` rule the engine also runs; no names = discover every column), `keyedIndex` (the delta's index, by `String(key)`). A recorder is a fresh instance per fold — one instance under two keys is refused, since it would step twice — and `result()` is pure over what it saw and may be read again. A recorder that throws aborts the fold: an answer built on a walk that broke is not an answer (a fold fails fast, unlike a footprintjs observer, which never aborts a run). The engine builds a store and its types in one walk, the refresh's delta indexes each side in one, and every analysis takes its columns from one.

## Describe a table before there is a dashboard

The only way to learn what a column IS — its type, what it holds, how many different things it holds — used to be to build a dashboard and ask the provider. That is a strange price for a question that comes BEFORE a dashboard exists: an authoring wizard's first step is *here is a file, tell me what is in it*, and it has nothing to declare yet.

`describeTable(input, options?)` is that step's raw material, and nothing more — pure, no dashboard, no session, one walk:

```ts
describeTable('disease,cases\nLyme,12\nZika,3\n');
// { rows: 2, columns: [
//   { name: 'disease', type: 'string', sample: ['Lyme', 'Zika'], distinct: 2, distinctCapped: false },
//   { name: 'cases',   type: 'number', sample: [12, 3], distinct: 2, distinctCapped: false, extent: [3, 12] } ] }
```

It takes CSV text or rows and **composes what is already here**: `parseCSVTyped` turns text into typed rows, and `columnTypes`, `distinct` and `extent` answer every column's question in one `foldOnce` — a fourth recorder, local to this door, spans a date column, since `extent` reads numbers. The type is the `TypeTally` rule, which is **the same rule the memory engine runs** (`inferType`): a column described as a number is a column the built dashboard will also call a number. There is no second sniffer.

Four things it says plainly rather than guessing at: the column set is the CSV's header, or the first row's keys (the engine's own homogeneous-rows rule); `sample` is the first few DISTINCT values, so a column of one repeated value does not look like five; `distinct` counts null and undefined together as one absence, the fold's rule; and the count is **capped** (`distinctCap`, default 1000) with `distinctCapped` saying so, because "1000" that might mean 90,000 is a number nobody should read as the truth. `extent` is present for a `number` or `date` column that carried one — a column of nothing but `NaN` is still a number column, and honestly has no span.

What a person does with the answer is DECLARE on top of it — `{ type, role, scale, label }`, which is the def's own `ColumnDecl`. Nothing here guesses a role: a description is what the data says, a declaration is what the person says, and this library never lets the first stand in for the second. `whatFits` (src/encoding) takes both together.

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

`src/data/derivedColumns.ts` is the ONE owner of that spelling. Nothing else may compose a physical name, and — the part that matters — **nothing may ever PARSE one**. A CSV could arrive tomorrow with a column genuinely named `risk@s7`; whether a name is derived is answered by the registry, which knows what it wrote, never by looking for the marker in the string. (A source column that happens to be spelled like a slot is caught by the same judge as rule 1, which checks the slot against the declared set too.) The one thing the grammar DOES refuse is an ACT whose id carries the marker: `derivedColumnName('x', 'a@b')` throws, because `x@a` at commit `b` would otherwise be the same slot as `x` at commit `a@b` — two acts' columns as one array. A session mints `s<n>`, but a replayed log may bring any id, so `writeColumns` asks `canNameSlot(commitId)` first and files a `guard-failed` gap instead of writing.

The registry is **dashboard-scoped**, beside the bookmark, saved-picture and commit-id stores, because the table store is: two sessions on one `buildDashboard` write into one provider. Were it per-session, session B would read session A's `risk@s7` as an ordinary declared column — the same leak one level along.

When one name is computed twice on the SAME path, the later act wins: a re-run **supersedes**, it does not shadow. The demo relies on this — a button and an agent turn both declare the clustering — and the column stays visible and singular, reading the newer numbers, while seeking back to the earlier commit still reads the earlier ones.

### 3. Visibility is what falls out of resolution, not a second mechanism beside it

`Session.effectiveColumnsOf` used to filter the column list against a parallel set of "names materialized somewhere". That second mechanism was the defect: it scoped the NAME while the store scoped nothing. It is now a thin projection over the same resolution rule 2 uses — one source of truth for what a column means at a position.

A store column the registry does not know is declared, and is visible on every branch: the map does not move with the walker. A derived column resolved at the cursor is visible under its logical name. A derived column resolved nowhere on this path is simply absent — so a `select` on it is an honest `needs-column`, and `overview().columns` omits it, for the same reason and by the same code.

And the ROWS answer about the same cursor the columns do. A sibling branch's slot is physically in the shared table store, so a row door that passed through "everything else" would hand a consumer `risk@s2` as a column — this library's own grammar, with another branch's values inside, for a consumer to ignore or parse. `renameRowSlots(row, back, slots)` is given the table's whole physical set: what the cursor resolves is renamed, every other slot is DROPPED, and declared data is untouched.

`Session.ask` is the one door from a clause to an engine: fields, sort keys and the column projection go in translated, and rows come back wearing the names the caller asked for. A table no analysis has ever written a column into takes an untouched path — no map, no rewrite, no per-row allocation — which is every table on every dashboard until an analysis lands one (the fast path asks the table's PHYSICAL set, not the cursor's: a cursor standing off every branch still has slots to drop). The `sql` descriptor deliberately keeps the physical spelling: it records the column the engine actually read, and that name IS the act that produced it.

A **refresh** replaces a table's whole provider, so the slots its derived columns lived in are gone. The registry for that table is dropped with it — otherwise the session would keep resolving a name the store no longer has — and the refresh reports what was lost by the name a person knows (`risk`), never by the slot it lived in (`risk@s7`).

### Retention: versions are kept, and what that costs

**Every version is kept.** A derived column is evidence — it is the output of an act that is on the trace, and this library never rewinds state. Dropping a superseded version would mean a commit you can still seek to, whose column you can still see named in the log, that can no longer answer what it held; that is a hole in the trace, arriving quietly at whatever moment a garbage-collector chose.

The cost, measured on the real provider rather than estimated (100k rows, ten versions, `--expose-gc`, heap delta per version):

| column | columnar layout | row-major layout |
|---|---|---|
| int (a 4-bin cluster id) | 860 KB per version — 8.8 bytes/row | 1173 KB per version — 12.0 bytes/row |
| string (a bucket label) | 3204 KB per version — 32.8 bytes/row | 3516 KB per version — 36.0 bytes/row |

So on a 100k-row table, re-running one int-producing analysis ten times costs about **9 MB**, and the registry itself is four small strings per version. That is the price of being able to seek to any of those ten moments and read what it actually held. At a row count where it stops being the right trade — a million rows and a habit of re-running — the fix is a retention policy with a commit behind it (an act that drops versions and says so), not a silent collector; nothing here should start discarding evidence on its own.

### The rows an analysis is handed are a COPY

One paragraph, and it belongs here because it is the same law from the other side. A derived column is written INTO the store; the rows an analysis reads come OUT of it, and both directions are governed by [`../detach/README.md`](../detach/README.md): **a reader never holds the object the system is still using.**

An analysis is a reader whose input does not stay in its hands. It goes on to footprintjs as a run input, and footprintjs COMMITS what it is given — which freezes it. So handing an analysis the provider's own row objects froze the table, and the next act that materialized a column into a row-layout store found the rows unextensible:

```
analysis "f" ran, but writing column "twice" back into table "data" threw:
  Cannot add property twice@s2, object is not extensible
```

A group-by, then any analysis that writes a column, and the column was gone under an `effect-failed` gap. The copy is therefore taken at `resolveAnalysisInput` — **the one place rows leave the engine for an analysis** — and not inside the analysis that happened to expose it. A fix in `groupByAnalysis` would have made one analysis safe and left the door open for the next one somebody writes; here, every analysis is safe by construction, including one that does not exist yet, and none of them has to know. The copy is one fresh row object per row, shallow: the failure was a write to the row itself, and the CELLS stay borrowed values the analyses only read.

### What the port owes

**Nothing new.** `DataProvider` is unchanged: `materializeColumn(table, name, values)` still lands one column under the name it is given. The versioning is entirely the session's business — it passes a name that happens to be unique per act — so the memory engine stayed dumb and the wasm and server stubs owe no new behaviour. That is deliberate: the port is the MAP's surface, and which columns belong to the trace is not something a query engine should have to know.

One consequence worth stating plainly: the judge lives in the session, so **a caller that reaches past it and calls `provider.materializeColumn` directly can still overwrite a source column.** That is a caller writing into the store outside any act — there is no trace for it to be consistent with, and the column it lands is, correctly, indistinguishable from declared data afterwards. The session is the thing that judges; going around the session goes around the judge.
