# data — the rows, the engine, and one walk over them

The query port (`DataProvider`: tables, columns, `evaluate(table, clause | clause[] | null)`, `materializeColumn`) is OUR shape; the memory engine answers it in this process, the wasm engine answers it out of DuckDB-WASM over a `SqlConnection`, and the server engine is a typed stub that renders the same SQL descriptor. A clause list is its AND, so the whole live selection is one question.

## The engine this version does not run

Three engines are named; two answer. `memoryProvider` runs in this process and `wasmProvider` runs over a SQL connection (below). `serverProvider` is a typed stub — declared so the port's shape is honest before a Mosaic Coordinator exists — and a stub answers **only its declared table list**: every read of a column or a row is refused. `stubEngines.ts` is the one place that says so, so the build door and the read door say it in the same words instead of each inventing its own:

```ts
await serverProvider({ tables: ['cases'] }).columns('cases');
// { ok: false, engine: 'server', operation: 'columns', reason: 'not-implemented',
//   detail: 'the "server" engine answers no query in this version — it is a typed stub: it names
//            its declared tables and answers nothing else. Declare engine "memory" to run "cases"
//            in this process, or bring the engine yourself: pass
//            { providers: { "cases": yourProvider } } to the builder you already call' }
```

Two laws sit inside that sentence. **A refusal points at what to do instead** — "no Coordinator is wired yet" names our build order, where the person reading it is holding a table that answers nothing. And **one wording, every door**: `buildDashboard` quotes these exact words as a build note the moment a def routes a table here, and `lint()` throws them ([`../def/README.md`](../def/README.md)), so nobody learns the same fact twice, differently. Change the words in `stubEngines.ts` and every door moves together; write them anywhere else and they drift.

`STUB_ENGINES` is that list, and it is DATA for exactly this reason: it shrank from two names to one the day the wasm engine started answering, and every door that judges "does this declaration route to something that runs?" shrank with it, in the same edit. A second hand-typed list would have gone on refusing a table that now runs.

`tables()` is the one thing a stub still answers honestly — the DECLARED list is real information, and an empty array would be a lie of a different kind, which is why the sentence itself says so rather than claiming the table is wholly dark. A sorted window keeps its own REASON (`unsupported-sort`, the law every engine keeps) and quotes the same sentence for its detail, because "ask for this window without a sort" pointed a caller at a second refusal. The one refusal here that is *not* the shared sentence is `serverProvider.materializeColumn`: it is refused by the declared capability (`canMaterialize: false`), not by our build order, because a real Coordinator behind that provider would refuse a write-back too — and the remedy never names a builder, because which door an author must call is a fact about the whole def (a remote source forces `buildDashboardAsync`), not about the table being refused.

## The wasm engine: a real SQL backend, opened only when something is asked

`wasmProvider` answers real queries out of DuckDB-WASM. Six laws hold it up, and each one is why a line of it looks the way it does.

**The door is the BUILD, because the build is what lands bytes.** A def declares the engine; `buildDashboardAsync` opens ONE connection, lands every wasm table's bytes in it, and hands back a dashboard that has already answered its first question. That is the path to write — the provider below is what it wires up for you.

```ts
const dash = await buildDashboardAsync(
  { meta: { title: 'cases' }, data: { cases: { csv, engine: 'wasm' } }, actors: { grid: { actor: 'user', label: 'Grid' } } },
  // omitted, this is `duckdbConnection()`: DuckDB-WASM in a browser, the node bundle under node
);
await dash.createSession().viewQuery({ table: 'cases', columns: ['week', 'disease'] }); // out of DuckDB
await dash.close();                  // whoever opened it closes it — see below
```

**Choosing an engine is not asking it something.** Construction is inert: no DuckDB import, no worker, no bundle fetch, no connection. The backend arrives through `SqlConnection` — either one already open, or an `open` function called at most ONCE, by the first read that needs it.

```ts
const provider = wasmProvider({
  sources: ['cases'],                // the tables this provider SERVES: names, nothing else
  open: duckdbConnection(),          // nothing has been imported or spawned yet
});
await provider.tables();             // ['cases'] — still nothing: this is a fact about the DECLARATION
await provider.evaluate('cases', { kind: 'point', field: 'disease', value: 'Lyme' }); // NOW it opens, once
```

**The bytes are landed by the BUILD, not by this provider.** `wasmProvider` is handed the NAMES of the tables it serves (`sources`) and a way to reach a backend; who puts the rows in that backend is the def door's job — [`../def/wasmBackend.ts`](../def/README.md) runs `loadTableSQL` for every wasm table in a def, through ONE connection, at most once. `buildDashboardAsync` does it before it returns the dashboard; `buildDashboard` cannot await, so the same landing happens on the first read and the build says so in a note. A table this provider was declared with but whose bytes never arrived is refused by the backend in the backend's own words (`no-backend-connection`), which is why the failure a reader meets always names a cause somebody can act on.

`duckdbConnection.ts` is the only module that names `@duckdb/duckdb-wasm`, and it names it inside the returned function — a static import anywhere in this tree would drag a WASM bundle into every build that merely mentions the data seam. An open that throws is remembered, not retried: every later read hears the same cause, and the fix is a new provider.

**A row's identity is read, never inferred.** DuckDB does not promise insertion order back, so a table this engine loads carries `__row` — 0-based, assigned by the same statement that reads the bytes (`loadTableSQL`). `evaluate` strips it from every row and answers it as `indices`; `columns()` never lists it, because a bookkeeping column offered as an encodable one would let a sheet draw the load order as if it were data.

**A value comes back as this library's own, not as DuckDB's wire type.** Two halves. The database is opened with `castBigIntToDouble` and `castDecimalToDouble` (`duckdbConnection.ts`, `READ_CONFIG`), because `read_json_auto`/`read_csv_auto` infer BIGINT for every integer column — unset, a def's `amount: 15` comes back as `15n` while `columns()` says `number`, `JSON.stringify` throws on it, and `equalWidthBins`/`boxSummary` read every value as ABSENT. And a `date`-typed column's epoch number is read back as the ISO string the memory engine holds — a DATE as the day (`'2026-04-05'`), a TIMESTAMP as the whole instant — using the type words that table's own `DESCRIBE` gave. Measured, not assumed: a TIME still arrives as a bigint of microseconds and an INTERVAL as DuckDB's own object, because this library has no value for either and does not invent one. `engineInvariant.test.ts` compares the two engines' rows RAW: the normalizer that used to sit there was hiding this bug.

**Every rendered order ends in the source-order column.** `ORDER BY "cases" DESC` over a tied column is not a total order, and two pages of one window are two statements: before the tie-break, page 2 of a 300,000-row window repeated rows page 1 had served and never served others at all. `sqlWindow.ts` appends `"__row" ASC` as the last key for a table this engine loaded (a table it did not load has no such column, and gets no such key) — which also makes the order the one the memory engine keeps, whose ties stay in source order.

**And an unsorted PAGE is served in source order.** The same reason with the sort taken away: a window that asked for no order is not a total order either — every row is tied with every other — and the sheet pages unsorted, so this is the default window, not an exotic one. `sqlWindow.ts` renders `ORDER BY "__row" ASC` as the *whole* order whenever a `LIMIT` or an `OFFSET` is present on a table this engine loaded. A full unpaged read stays unordered on purpose: with no window there is no boundary for a row to fall on the wrong side of, every matching row comes back exactly once whatever order the scan chose, and a reader that cares about position reads `__row` off the rows (`indices: true`) — sorting 300,000 rows to hand back all 300,000 of them would buy that reader nothing. What holds this down is an assertion on the rendered statement, not on the rows: with the clause removed, the 300,000-row paging test still passed on a scan that happened to come back in source order (`engineInvariant.test.ts`), which is the defect exactly — the order was never *promised*.

**The descriptor and the statement are different strings, on purpose.** `evaluate().sql` is `resolvePredicateSQL`'s output — byte-identical to what the memory engine returns for the same clause, which is what the commit log's `predicateSQL` rests on. What actually RUNS is that descriptor wrapped by `windowSQL`, plus a second `COUNT(*)` statement: `count` is how many rows MATCH, and counting the window's own rows would report its size as the size of the selection.

**Everything it cannot do says which word it is refused under.** A table nobody declared is `unknown-table` (quoting the list that WAS declared); a clause or sort key on a column the schema does not have is `unknown-column`, in the memory engine's exact words; a malformed window is `bad-window` before the backend is asked anything; no connection — or a backend that throws — is `no-backend-connection`, quoting the statement and the engine's own message. `materializeColumn` is refused by a declared capability (`canMaterialize: false`), so a caller can branch before calling.

**Whoever opened it closes it.** A connection this provider was HANDED (`connection`) is never closed by it, and neither is one an `open` function it was given opened — the party that passed the opener owns the release, because only that party knows whether another provider is still reading the same database. For a def that party is the build, and it surfaces the act as `Dashboard.close()`: it closes the connection the build itself opened and leaves a host's own `openSqlConnection` result alone. Each table's `DESCRIBE` is also remembered for the life of a provider, so a table re-landed under the same connection needs a new build, not a second read.

**It opens in EITHER host, and which one is judged when the opener is called.** `duckdbConnection()` opens `AsyncDuckDB` over a `Worker` in a browser, and under node it opens the bundle DuckDB-WASM ships for node — the BLOCKING bindings (`dist/duckdb-node-blocking.cjs`): no worker, no download, the `.wasm` read off disk. `duckdbHostOf` reads two facts (is there a `Worker`; is there a `process.getBuiltinModule`, i.e. node ≥ 22.3/20.16) and an environment that is neither is refused in a sentence — `NO_DUCKDB_HOST` — before anything is imported. A caller who knows better says so: `duckdbConnection({ host: 'node' })` names the host as an ASSERTION and skips the judgement, which is what a jsdom suite needs (jsdom defines a `Worker`, so the judgement would send it to the CDN arm). Two details are load-bearing: the node specifier lives in a `const` no bundler can resolve statically, because that bundle is CJS-only while the package's `./blocking` entry names an `.mjs` it does not ship — a browser build of an app that merely imports this seam fails on it, which this repo's own demo bundles caught. And because node can open the real thing, the D24 invariant is proven against a REAL DuckDB: `engineInvariant.test.ts`'s FOURTH layout lands the same four rows in it and asks every logged commit — point, interval, cleared, cell, neighbourhood — for `sql`, `count` and rows, against the memory engine's answers, plus a sorted window and a second page.

## What the two engines cost — measured, not guessed

`bench/step0-wasm` puts both engines on one clock, in one process, on the same rows. **node v22.16.0 · darwin arm64 · 2026-09-10** — median of 3–7 repetitions, 2 warm-ups discarded (0–1 for the load arms, which open a fresh database each time), `--expose-gc` between samples ([`wasm-table.md`](../../bench/step0-wasm/wasm-table.md) carries each arm's spread, its own warm-up count, and the controls):

| arm — memory / DuckDB-WASM | 90,300 rows | 300,000 rows | 1,000,000 rows |
|---|---:|---:|---:|
| construct or load the table | 6.45 / 345 ms | 21.7 / 507 ms | 72.7 / 935 ms |
| `COUNT` (point AND interval) | 4.13 / 1.73 ms | 9.58 / 2.94 ms | 32.3 / 7.08 ms |
| window, `limit 100` | 3.01 / 2.95 ms | 9.80 / 4.42 ms | 32.2 / 8.62 ms |
| sorted window, repeat asks | 6.92 / 3.70 ms | 24.1 / 6.20 ms | 97.5 / 14.8 ms |
| FIRST sorted ask, fresh table (memory only) | 33.0 ms | 125 ms | 517 ms |

Read it as a trade, because that is what it is: **DuckDB is faster on every read at every size** (0.15×–0.55× at and above 300,000 rows) and costs **345–935 ms once** to open and land the table. **Choosing it is buying reads with a startup.** At 90,300 and 300,000 rows the memory engine answers every steady-state read in 3–24 ms — inside an interaction budget — so its ~500 ms cheaper start is the better trade for a dashboard that opens, filters and closes. At 1,000,000 it is not: a sorted window is 97.5 ms and the first sorted ask 517 ms, against DuckDB's 14.8 ms.

So `chooseEngine`'s `DEFAULT_ENGINE_THRESHOLDS.maxMemoryRows` is **300,000** — the largest size the bench measured the memory engine winning at, and a measured size rather than a point interpolated between two others (the bench ran a third size for exactly this reason). `engine: 'auto'` now FOLLOWS that number instead of always answering `memory`, and the build note says which side of it the table fell on: `engine "auto" resolved to wasm (300,001 rows, against the measured row threshold in chooseEngine — declare an engine to choose otherwise)`.

What is still **unmeasured, and says so** rather than routing on a guess: no memory FOOTPRINT was sampled and the bench never found DuckDB's ceiling (it landed 1,000,000 rows without complaint), so `maxMemoryBytes`, `maxWasmRows` and `maxWasmBytes` are all `Infinity` — a threshold saying "no threshold" out loud. An invented byte cap would silently veto the one number that WAS measured (the policy ANDs the axes), and an invented row ceiling would send a table to `serverProvider`, which is a typed stub that answers nothing. A host that knows its own budget passes `thresholds`. These are also NODE numbers: a browser pays a bundle download, has no `--expose-gc`, and runs the async bundle over a Worker — read the ratios, not the absolute milliseconds.

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

It takes CSV text or rows and **composes what is already here**: `parseCSVTyped` turns text into typed rows, and `columnTypes` and `extent` answer every column's question in one `foldOnce` — two recorders local to this door span a date column (since `extent` reads numbers) and count a column's distinct values as a DESCRIPTION needs them (by value rather than by object identity, retained only to the cap). The type is the `TypeTally` rule, which is **the same rule the memory engine runs** (`inferType`): a column described as a number is a column the built dashboard will also call a number. There is no second sniffer.

Four things it says plainly rather than guessing at: the column set is the CSV's header **once each** (the parser collapses a repeated header cell into one row key, so a name kept twice would describe a key that is not there), or the first row's keys (the engine's own homogeneous-rows rule); `sample` is the first few DISTINCT values, so a column of one repeated value does not look like five; `distinct` counts null and undefined together as one absence, the fold's rule, and counts two equal DATES as one date — a description asks what a column holds, not which objects it holds; and the count is **capped** (`distinctCap`, default 1000) with `distinctCapped` saying so, because "1000" that might mean 90,000 is a number nobody should read as the truth. The cap bounds the WORK too: retention stops one past it, so a near-unique id column of a 500k-row file does not hold 500k values to report a capped 1000. `extent` is present for a `number` or `date` column that carried one — a column of nothing but `NaN` is still a number column, and honestly has no span.

What a person does with the answer is DECLARE on top of it — `{ type, role, scale, label }`, which is the def's own `ColumnDecl`. Nothing here guesses a role: a description is what the data says, a declaration is what the person says, and this library never lets the first stand in for the second. `whatFits` (src/encoding) takes both together.

Not a recorder: bins — `bins.ts` recounts NEW values into fixed edges, one walk of its own — and the group-by chart's count-and-sum, likewise one walk.

## The sheet's window (`sort`, `offset`, `indices`)

`evaluate(table, clauses, { sort, offset, limit, indices })` is the one call a sheet window makes. `sort` is a list of `{ field, dir, absent }` keys; the memory engine builds ONE permutation per (table, sort spec) — an `Int32Array` sorted in place — and keeps the most recently used few per table (`sortCache`, default `SORT_CACHE_PER_TABLE` = 8; 4 bytes per row per kept sort), rebuilt when the row count moved and dropped when a column is materialised; a window walks the permutation with the predicate, so a brush never rebuilds the sort. The order is total: numbers, then dates, then booleans, then everything by its text, then what cannot say itself — ranks never mix, so `2`, `10` and `"100"` cannot loop; ties keep source order; absent values (null, undefined, NaN, an invalid date) sit together at one end, last unless `absent: 'first'`. `offset` skips matching rows and comes back as `start` (clamped to `count`); every match is counted but only the window's rows are collected; `indices: true` returns each row's source-order index, which the session turns into a positional row id (`<version>#<index>`) when the table declares no key. A malformed window is refused (`bad-window`) and a sort or projection naming a missing column is refused (`unknown-column`) in both modes; an engine without `capabilities.canSort` refuses a sort (`unsupported-sort`, enforced in every engine) rather than answering in source order. The session's `viewQuery` / `clausesFor` (src/session) sit above this: whose eyes, which clauses reach, the row identity, and a default window of `VIEW_QUERY_DEFAULT_LIMIT` rows.

### One law for the projection and the sort

`columns` says which columns come BACK; `sort` says which rows come FIRST. They are different questions, and both engines answer them the same way — one law, because two engines that judge one `EvaluateOptions` differently is the bug this seam exists to prevent:

```ts
// LEGAL in both engines: order by a column the answer does not carry.
await provider.evaluate('cases', null, { columns: ['disease'], sort: [{ field: 'week', dir: 'desc' }] });
// → rows: [{ disease: 'Zika' }, { disease: 'Lyme' }]   (SQL orders by unprojected columns; so does the fold)

// REFUSED by both, before any statement runs or any window is walked:
await provider.evaluate('cases', null, { columns: ['disease', 'nope'] });
// → { ok: false, reason: 'unknown-column', detail: 'table "cases" has no column "nope" to return' }
```

One exception, and it is about what an engine can KNOW rather than about the law: the memory engine reads a row-major table's column names off its rows, so a table with ZERO rows knows none (`columns()` answers `[]` — an aggregate whose group set came out empty lands there) and its projection is answered, not refused. A SQL engine has a schema without rows, so the wasm door has no such exception.

The refusal is the half that used to be missing: the memory engine answered `{ nope: undefined }` — a column that does not exist, reported in the shape a real absent value has — and DuckDB answered a Binder Error the provider filed under `no-backend-connection`, reporting a typo as a missing database. `unsupported-sort` is now only what an engine that cannot sort AT ALL says (`serverProvider`).

## The window around the WHERE

`resolvePredicateSQL` says which ROWS. `windowSQL(table, whereFragment, options)` says which columns, in what order, and how many — one pure statement builder (no DuckDB, no connection, no `await`), so the SQL a window will run is pinned by a test before any engine runs it, and the in-browser engine and a server engine cannot drift about what the same `EvaluateOptions` mean.

```ts
windowSQL('cases', resolvePredicateSQL(clause), { columns: ['state', 'count'], sort: [{ field: 'count', dir: 'desc' }], limit: 25, offset: 50, indices: true }, { hasRowOrder: true });
// SELECT "state", "count", "__row" FROM "cases" WHERE ("state" IN ('TX'))
//   ORDER BY "count" DESC NULLS LAST, "__row" ASC LIMIT 25 OFFSET 50
```

Five things that statement says out loud. **`__row` as the last ORDER BY key** is the tie-break: a rendered order that is not TOTAL makes two pages of one window two different orders, so `windowSQL`'s fourth argument — a FACT about the table, read off its own `DESCRIBE`, never an option a reader passes — appends it for a table this engine loaded. **`__row`** is the source-order column: DuckDB does not promise insertion order — a filter, a hash join or a parallel scan may change row order between two runs of the SAME query — so "the 4th row" cannot be recovered after the fact, which is WHY the engine loads every table with an explicit 0-based row-order column and `indices: true` asks for it (`SELECT *` already carries it; naming it again would return two columns of that name). **`NULLS LAST`** is always spelled out, because `SortSpec` documents absent values as last unless asked otherwise while DuckDB's own default is the session setting `default_null_order` — implicit, the same spec could put absent values at the opposite end from the memory engine's total order. One exception is named and not closed: the memory engine counts `NaN` as ABSENT while DuckDB counts it as the largest number there is, and no `NULLS` clause can bridge that — closing it would mean rendering an `isnan(...)` key on every sorted window, for a value a chart cannot draw. **`count` mode** renders `SELECT COUNT(*) AS n FROM … [WHERE …]` and no `ORDER BY`/`LIMIT`/`OFFSET`: a count is one row, so a window would cap the ANSWER rather than the rows counted (`OFFSET 10` would report no count at all). And the **cleared descriptor** (`'null'`, `isClearedSQL`) renders no `WHERE` at all — `WHERE null` is not true in SQL, so DuckDB would answer zero rows and invert the meaning of an empty selection.

ONE refusal, thrown as a `WindowRefusal` carrying the data port's own reason code — a builder has no `ResolvedEngine` to name, so the provider that catches it converts one field (`reject(engine, 'evaluate', err.reason, err.message)`). A negative or fractional `limit`/`offset` is `bad-window`, in the same sentence `memoryProvider`'s `badWindowValue` already refuses in, and judged in BOTH modes so flipping to `count` cannot launder a bad number. That is the whole list: a sort key the projection drops used to be `unsupported-sort` here, and it is legal now (see the law above) — a pure builder judges the window's NUMBERS and nothing else.

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

## A derived TABLE belongs to the act that made it, exactly as a column does

An aggregate is an ACT and a DERIVED DATASET. It is computed once, over the rows visible at its cursor (the selection folded then), recorded as one cause-tagged commit whose record carries the parent table, the group columns, the measures and an optional filter — and the ROWS live in the store, recomputed on replay from the record, never serialised. A later selection does not recompute it; a new act does. `derivedTables.ts` is the column store's twin, and four laws hold it to the column's own.

### 1. One slot per act, under the one marker

A derived table is registered under a physical name that carries its commit, spelled by the SAME speller the column store owns (`slotNameOf`) — there is one marker, and nothing outside this folder spells a slot:

```ts
derivedTableName('by_disease', 's7');   // 'by_disease@s7' — the provider's physical table name
derivedTableName('t', 'a@b');           // throws: the slot for "t" could not be told apart from another act's
```

### 2. The relation back to the parent is MINTED, never typed

The group column IS the derived table's key, so `parent.groupCol → derived.groupCol` (many-to-one) keeps the IDENTITY law of `../def/relations.ts` — the target column is the target's own key. (That file's `validateRelations` judges DECLARED edges, and a derived table is never in `def.data`, which is why this edge is minted here and never validated there.) A table grouped by two columns is keyed by a tuple no single-column relation can point at, so it has no key and no relation, and says so — and a table cut from a parent of its OWN name keeps the key and mints no edge, because law 3 there refuses a table joined to itself:

```ts
mintDerivedTable({ name: 'by_disease', commitId: 's7', of: 'cells', groupBy: ['disease'], measures: [total] });
// { …, physical: 'by_disease@s7', key: 'disease',
//   relation: { from: { table: 'cells', column: 'disease' }, to: { table: 'by_disease', column: 'disease' }, kind: 'many-to-one' } }
mintDerivedTable({ name: 'by_disease_kind', commitId: 's8', of: 'cells', groupBy: ['disease', 'kind'], measures: [total] }).key;        // undefined
mintDerivedTable({ name: 'by_disease', commitId: 's9', of: 'by_disease', groupBy: ['disease'], measures: [total] }).relation;          // undefined (no self-join)
```

### 3. ONE resolution rule for columns and tables

`resolveDerived` is generic over the slot record: a table resolves at the cursor's branch path exactly as a column does, the later act wins on one path, and a table cut on a branch the cursor is not on has no answer. The store is keyed by PARENT (a refresh of the parent is what drops its tables) and served flat (`all()`), because a table's name is resolved dashboard-wide. `of` is a NAME, so two acts that cut one name share a parent entry and clearing either drops both names' children: over-dropping is the chosen side — a kept child would resolve `of` to a table whose version is gone — so the loss a refresh reports is a CEILING, not an exact list:

```ts
resolveDerived(store.all(), pathIds).get('by_disease');   // the DerivedTable at this cursor, or undefined
```

### 4. A refresh clears the generations, and answers what it dropped

A derived table can be a parent in turn (`of` is a logical name). Clearing a parent drops its tables AND the tables cut from those — a table whose parent is gone has nothing to be replayed from — and answers the dropped list oldest first, so the build can report the loss by the names a person knows and drop the providers by the slots it holds. The record carries the parent's `dataVersion` it was cut from, which is what lets a refresh call a surviving table stale rather than serving yesterday quietly.

```ts
store.clear('cells');   // [by_disease@s1, by_disease_totals@s3 (cut from by_disease), by_disease@s4]
```

## A table that contradicts itself is refused at the door, once

A declared absence column says, per row, whether the source reported a value. A row whose state is NOT `present` and whose VALUE column holds a number says two things at once, and no reader can keep both. The walker (`../derive/walk.ts`) already reads such a row as a silence; `absenceContradiction.ts` is what keeps that from being QUIET — the table is refused where it enters, in a sentence naming the row, the two columns and the fix. The silence test is the WALKER'S, not the declared vocabulary's: a word the vocabulary never declared (a case slip, a new collector word, an empty cell) blanks the row exactly as `unavailable` does, and judging only the declared list left those rows — the ones nothing else judges — unjudged. Two doors call it: `describeTable(input, { absence, values? })` (a file before there is a def; `refused` carries the sentence beside the description) and the def door (`../def/validate.ts`, inline rows whose declared measures are the values). Only value columns are judged — a numeric address on a silent row (`week_index`, a code) is not a value, and `describeTable` guesses every number column is one unless `values` names them. A declaration that names a column the table does not have is refused there too: a name that misses judges NOTHING, and would answer a contradicting table with a clean bill of health:

```ts
absenceContradictionOf(rows, { field: 'report_state', states: ['present', 'unavailable', 'unknown'] }, ['cases'], 'data["cells"]');
// 'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both,
//  so carry null in cases where the row reports nothing (7 more rows do the same)'
```

The one thing that moves that line is the DECLARATION: `AbsenceDecl.carries` names the states that hold a number anyway, and a state named there is not a silence, so its number is not a contradiction. EIA's hourly grid is the case it exists for — a `replaced` demand figure is the number the agency published beside the one the authority filed, and an `estimated` one is EIA's own figure for an hour nobody filed; both ARE figures, and a check that refused them would refuse the honest table. Default NONE, so every declaration written before the key existed is judged byte for byte as it was. It moves this check and nothing else: the walker still reads exactly `present`, because "the source put a number here" and "the arithmetic may add it" are two different questions and only the source can answer the first. The def door refuses a `carries` that names a word the vocabulary never declared (a typo would silence-proof a column), `present` (not a silence to begin with) or `unknown` (the word for a silence the source could not tell apart — it cannot also have carried the value):

```ts
const demand = { field: 'demand_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] };
absenceContradictionOf([{ authority: 'CISO', demand: 24_000, demand_state: 'replaced' }], demand, ['demand'], 'data["hourly"]');   // undefined
absenceContradictionOf([{ authority: 'CISO', demand: 24_000, demand_state: 'unavailable' }], demand, ['demand'], 'data["hourly"]');
// 'data["hourly"].rows[0]: demand_state says "unavailable" — no value — and demand holds 24000; a table cannot
//  say both, so carry null in demand where the row reports nothing'
```

## Where the code lives

| file | one job |
|---|---|
| `derivedColumns.ts` | the ONE slot grammar (`slotNameOf`, its marker, `canNameSlot`), the column store, `resolveDerived` (generic: columns AND tables), the two renamers |
| `derivedTables.ts` | the table store keyed by parent, `mintDerivedTable` (slot, key, relation — minted, never typed), the generational `clear` |
| `absenceContradiction.ts` | the one sentence for a table whose absence column and value columns disagree |
| `describeTable.ts` | what is in a table before there is a dashboard — and, given a vocabulary, whether it keeps its word |
| `fold.ts` | one pass, many recorders |
| `predicate.ts` / `clauseFromWire.ts` | the clause shape this folder evaluates, and the one translation from a commit's wire triple |
| `sqlWindow.ts` | the window AROUND the `WHERE` — one pure statement builder (projection, `ORDER BY` with its null placement and its `__row` tie-break, the `__row`-only order a paged unsorted window gets, `LIMIT`/`OFFSET`, the `__row` source-order column), and the ONE way a window is refused |
| `memoryProvider.ts` / `wasmProvider.ts` / `serverProvider.ts` / `stubEngines.ts` | the engine that answers in this process, the engine that answers over a SQL connection (its tables' bytes are landed by `../def/wasmBackend.ts`), the one that names its tables and refuses the rest, and the sentence it refuses in |
| `sqlConnection.ts` | the port a SQL backend is reached through (`query`, `close`), the loader shape (`load` — rows or CSV text), and `loadTableSQL`: the ONE statement that gives a loaded table its `__row` source order |
| `duckdbConnection.ts` | the only module that names `@duckdb/duckdb-wasm` (an optional peer, pinned by a test, imported dynamically — [`../../PACKAGING.md`](../../PACKAGING.md) Law 3), and it names it inside the opener — the Arrow-to-rows adapter, the file-registering loader, the host judgement, and the one query config (`READ_CONFIG`) both hosts open with |
| `sqlConnection.coverage.helpers.ts` | not shipped code: the two FAKE backends both SQL-engine suites are judged against — the canned one (`wasmProvider.test.ts` asserts the statements) and the tiny one that answers only what was landed in it (`../def/wasmEngine.def.test.ts` asserts the wiring) |
