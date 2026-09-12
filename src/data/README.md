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

**Whoever opened it closes it.** A connection this provider was HANDED (`connection`) is never closed by it, and neither is one an `open` function it was given opened — the party that passed the opener owns the release, because only that party knows whether another provider is still reading the same database. For a def that party is the build, and it surfaces the act as `Dashboard.close()`: it closes the connection the build itself opened and leaves a host's own `openSqlConnection` result alone. Each table's `DESCRIBE` is also remembered for the life of a provider; the one re-landing it knows about is its own `replaceRows` (below), which forgets and re-reads the schema itself — a table re-landed under the same connection BEHIND the provider needs a new build, not a second read.

**It opens in EITHER host, and which one is judged when the opener is called.** `duckdbConnection()` opens `AsyncDuckDB` over a `Worker` in a browser, and under node it opens the bundle DuckDB-WASM ships for node — the BLOCKING bindings (`dist/duckdb-node-blocking.cjs`): no worker, the `.wasm` read off disk. `duckdbHostOf` reads two facts (is there a `Worker`; is there a `process.getBuiltinModule`, i.e. node ≥ 22.3/20.16) and an environment that is neither is refused in a sentence — `NO_DUCKDB_HOST` — before anything is imported. A caller who knows better says so: `duckdbConnection({ host: 'node' })` names the host as an ASSERTION and skips the judgement, which is what a jsdom suite needs (jsdom defines a `Worker`, so the judgement would send it to the CDN arm). Two details are load-bearing: the node specifier lives in a `const` no bundler can resolve statically, because that bundle is CJS-only while the package's `./blocking` entry names an `.mjs` it does not ship — a browser build of an app that merely imports this seam fails on it, which this repo's own demo bundles caught. And because node can open the real thing, the D24 invariant is proven against a REAL DuckDB: `engineInvariant.test.ts`'s FOURTH layout lands the same four rows in it and asks every logged commit — point, interval, cleared, cell, neighbourhood — for `sql`, `count` and rows, against the memory engine's answers, plus a sorted window and a second page.

**One fetch happens in BOTH hosts, and it is not the bundle.** Landing `rows` goes through `read_json_auto`, and this DuckDB bundle autoloads its `json` extension from the vendor's extension repository the first time it is asked — one request off the origin, in the browser and under node alike. The browser proof (`ui/gallery/wasm.smoke.test.ts`, real Chromium) pins it as exactly one request and names it. A CSV landing needs nothing: its reader is statically linked, and the same proof's CSV table added zero requests. What follows, said plainly: an offline or CSP-restricted page can land CSV on this engine and cannot land `rows` today; and with the repository unreachable, a `rows` landing under node did not return within two minutes in one observed run. The remedy is a library decision not yet taken — land `rows` as CSV (null and empty-string fidelity must be handled), or self-host the extension and point the repository at it — and until it is, this paragraph is the truth. The same proof found no seam for a self-hosted BUNDLE map either: the browser opener reads the CDN's map, and a site that must self-host needs an option for its own.

## A refresh is computed where the rows live

**The law: a refresh is one act with one answer, and the engine that holds the rows computes it.** The answer is `RefreshDelta` (`delta.ts`) — counts and samples, never the rows: `{ keyed, key, added, updated, removed, sample: { added, updated, removed }, unkeyed }` with a declared row key, `{ keyed: false, replaced }` without one (and `keyAbsent` when the key named no column of the new rows). The port is `DataProvider.replaceRows(table, rows, { key }) → RelandResult | rejection`, with `capabilities.canReland` declaring it the way `canFind` declares a find — absent means no, and a caller refuses in words rather than filling the gap in JavaScript. The provider stays the **same object** across the act: nothing that holds a reference to it goes stale, and every cache it kept over the old rows is dropped by the act itself.

```ts
const answer = await provider.replaceRows!('cases', newRows, { key: 'id' });
// { ok: true,
//   delta: { keyed: true, key: 'id', added: 1, updated: 1, removed: 1, sample: { added: ['4'], updated: ['2'], removed: ['3'] }, unkeyed: 0 },
//   columns: [{ name: 'id', type: 'number' }, …] }   // the schema AFTER the replace
```

**Two strategies, one answer.** The memory engine's `replaceRows` is `deltaByKey` over its own rows and the new ones — the diff it always ran, moved behind the port — then the store swapped in place (same layout) and the sort-permutation cache dropped: a permutation checks a row COUNT, so a refresh that keeps the count and changes the values would otherwise serve a sorted window in yesterday's order. The wasm engine's is SQL (`sqlReland.ts`): the new rows are landed as a staging table (`__reland_<table>`, through the connection's own `load`, so it carries `__row`), ONE statement answers the five numbers over two CTEs holding each side's first row per key (`CAST(key AS VARCHAR)` for `deltaByKey`'s String() identity; `ROW_NUMBER() OVER (PARTITION BY … ORDER BY "__row")` kept where it is 1 for "first occurrence wins"; `COUNT(*) − COUNT(first rows)` per side for `unkeyed`), three `LIMIT 20` statements answer the samples in each table's own source order, then `CREATE OR REPLACE TABLE t AS SELECT * FROM staging` (atomic, and it COPIES `__row` — a fresh `row_number()` over a scan would number an order DuckDB never promised), the staging table is dropped and the schema re-DESCRIBEd. No row leaves the database. `engineInvariant.test.ts` holds the two to one answer: the same rows before and after through both engines give the same delta, counts and samples — keyed and unkeyed, with a repeated key and a null key in the room, a column added and one dropped, an empty new version — and a sorted window after the replace reads the same rows in the same order on both.

**What "different" means, in both — ONE answer, not two.** The old row is compared over the columns the NEW rows carry: a column the old rows had and the new do not (one an analysis materialised, or one the source dropped) is stripped before the compare and reported by the caller as lost — never read as "every row updated"; a column the new rows ADD, or a shared column whose SEMANTIC type moved (`1` becoming `'1'`, or the other way), is a change to every row that carries it — the memory engine's per-cell compare (`delta.ts`'s `same`) cannot say otherwise, and the SQL says `TRUE` for it, never a text-cast comparison that could read `1` and `'1'` as equal (a value that changed type HAS changed). Zero new rows keep the key: the memory engine reads a schema off its rows and would otherwise strip the key from every old row and report a table that was emptied as "nothing removed, every row unkeyed"; the wasm engine lands an empty copy of the old table (`emptyStagingSQL`) because `read_json_auto` over `[]` infers a phantom `json` column. Both engines compare PER COLUMN, not by round-tripping the whole row through JSON: an object's key order is not a data fact, so a row whose keys merely arrived in a different order reads as unchanged on both (`engineInvariant.test.ts` pins the agreement, keyed and unkeyed, with a key order shuffled and a type moved).

**Refused, with the reason — and a refusal always means nothing moved.** A wasm table is never rebuilt as a memory table on refresh — "just build a `memoryProvider` here" would silently change which engine answers, and `dashboard.engines` said wasm. A connection that answers queries only cannot re-land (`no-backend-connection`, the same sentence the build's own landing uses); a table this engine did not load has no `__row` to order first rows by (`unknown-column`, the words `find` refuses it in); a landing or a statement the backend refuses BEFORE the replace leaves the old rows exactly where they were and drops the staging table first. Once the `CREATE OR REPLACE TABLE` itself has run, the rows HAVE moved — a refusal past that point would be a lie (`RefreshOutcome`'s law: "why nothing moved"), so a drop or a re-DESCRIBE that fails there is cleanup-only: it answers `ok` from the staging table's own schema (read a moment before the replace) and leaks a `__reland_<table>` table the next reland's own `CREATE OR REPLACE` on that name overwrites harmlessly. The stub engines declare nothing, and the refresh door refuses them in its general sentence: *runs on the E engine, which cannot re-land rows — close() and build again*.

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

**Two more arms, measured 2026-09-11** on the same bench (`bench/step0-wasm`, laws 7–10 of its README), the same instrument, the same rows — **node v22.16.0 · darwin arm64, an Apple M5 Pro with other work on the box (1-minute load 2.3 at the run's start); median of 7 / 5 / 3 repetitions at 90,300 / 300,000 / 1,000,000 rows, the spread being the max, and the p95 where n = 20**. A **moving brush** — the bench interval sliding one week per ask, 20 asks, the point clause held still so every ask keeps 3,080 matches, the one arm no cache can answer in either engine (the memory engine caches sort permutations per spec, never a clause's matches; DuckDB keeps no result cache) — costs, per ask, **3.0 / 3.5 ms** in memory / DuckDB at 90,300 rows, **10.0 / 5.4 ms** at 300,000 and **33.7 / 9.5 ms** at 1,000,000 (the p95s 4.2 / 3.7, 11.3 / 5.5, 35.0 / 9.7), and the whole 20-ask sweep as one gesture **60 / 44 ms, 194 / 78 ms, 660 / 164 ms**: a brush is twenty fresh windows, and at every size one ask of it costs what the `window` row above already says. A **wide projection** — `rows, limit 100` over the same rows carrying 30 columns (four each of BIGINT, DOUBLE, DATE, TIMESTAMP, VARCHAR, BOOLEAN beside the six above, DuckDB converting every cell on the wire, the memory engine handing rows back by reference) — costs **3.95 / 5.83 ms** at 90,300 and **16.1 / 7.01 ms** at 300,000, that is **wide ÷ window = 1.32× / 1.56×** and **1.58× / 1.33×** (memory / DuckDB); at 1,000,000 the memory engine answers in **68.2 ms (2.04×)** and the DuckDB cell is a **ceiling, not a number**: the rows port serialises `{ kind: 'rows' }` as one `JSON.stringify` and V8 refuses a string past 2²⁹ − 24 characters (~512 MiB; a million 30-column rows are ~593 MiB), so DuckDB is never handed a byte (`Invalid string length`, `sqlConnectionOver.load` in `duckdbConnection.ts`; a `{ kind: 'csv' }` landing registers its text as-is and would pass). Two things this does NOT do. It does not move `maxMemoryRows`: the two arms rank the engines exactly as the five did — at and above 300,000 rows DuckDB wins the brush and the wide window as it wins every other read, at 90,300 the memory engine's per-ask brush is 3.0 ms and its wide window 3.95 ms, both inside an interaction budget and both bought without DuckDB's 381 ms start — so 300,000 is still the largest measured size the memory engine wins at, and a threshold that moves changes which engine `auto` picks for every dashboard, which is its own packet. And it does not settle the question the ceiling raises, which is written down instead: `auto` routes a table past 300,000 rows to the wasm engine, whose rows port cannot land a 1,000,000 × 30 row-object table at all — a BYTES fact about the landing, not a rows fact about the read, and the shape `maxWasmBytes` (still `Infinity` below) exists to carry once it is measured rather than guessed. The five arms above were re-run first: 13 of 27 cells reproduced within their spread and 14 came back 3–27% slower (DuckDB's `window` at every size, the memory `sorted` and first-sort cells at 300,000 and 1,000,000 most of all) — and the 2026-09-10 code run unchanged in the same hour moved the same cells by the same amounts, so the drift is the day's machine, not the bench, and the table above keeps the quieter day's numbers with this sentence beside it.

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

One gesture on a node selects the ties INSIDE the set it walked to: a row of the edges table is kept when BOTH endpoint columns name a node in that set — the INDUCED subgraph, which is the edge set the network chart brightens for that same gesture, and what a depth-1 ego filter returns in Cytoscape, Gephi and Bloom. "Either endpoint" would reach one edge-hop further, keeping a neighbour's tie to a stranger the seed never touches, and a gesture's rows must be the ones its own highlight promised.

It is a kind of its own, with its own arm in every reader, for the reason the `cell` above is one: ONE gesture lands ONE commit, over a value (the walk) recorded whole. Two composed clauses would be two acts and two records of half a question.

```ts
import { clauseFromWire, matchesClause, resolvePredicateSQL } from 'vizfootprint/data';

const clause = { kind: 'neighbourhood', fields: ['from', 'to'], ids: ['Zika', 'Lyme', 'Mumps'] } as const;
resolvePredicateSQL(clause);   // `(("from" IN ('Zika', 'Lyme', 'Mumps')) AND ("to" IN ('Zika', 'Lyme', 'Mumps')))`
edges.filter((row) => matchesClause(row, clause));                    // every tie INSIDE the walked set

// read back off a landed commit — the walked ids ride inside the value, the endpoint pair in `fields`
clauseFromWire('neighbourhood', 'from ↔ to', record.value, record.fields);
```

**The answer is recorded with its question.** The wire value is `{ seed, derivation, hops, to?, ids }` (or `null` to clear): the ids are the ANSWER a walk produced, and the seed, the derivation and the hop count are the QUESTION that produced them. A record carrying only the seed would have to re-walk to be read, and a read at a cursor must answer about THAT cursor — the rows a later act may have changed. The clause tier keeps only the `ids`, exactly as a match keeps only its `values`; the rest is provenance, never predicate. `clauseFields` answers both endpoint columns, `neighbourhoodFieldLabel(['from','to'])` mints the display-only `"from ↔ to"` for the slots that expect one field name (`×` is the cell's; `↔` says "one edge", whose both ends the predicate asks about), and `renameClauseFields` rewrites both columns and never the ids — those are node keys, not column names.

**Three derivations, one value shape.** `derivation` says WHICH walk (all UNDIRECTED — either end joins; a directed walk is not offered), and `hops` says HOW FAR IT WENT — which means a different thing in each:

| `derivation` | `ids` | `hops` | `to` |
|---|---|---|---|
| `'ego'` | the seed first, then by distance, then row order | the distance ASKED (1 or 2) | — |
| `'path'` | the nodes IN ORDER, seed → `to` (a shortest path; unreachable: just `[seed, to]`) | the path's length in EDGES, `0` for the trivial path, **`null` when no path exists** | the far end it ran to |
| `'component'` | the seed first, then by distance, then row order | the FARTHEST node's distance (`0` for a node no edge names) | — |

```ts
{ seed: 'flu', derivation: 'ego', hops: 2, ids: ['flu', 'cold', 'strep'] }                     // two hops out
{ seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] }       // how flu reaches strep
{ seed: 'flu', derivation: 'path', hops: null, to: 'measles', ids: ['flu', 'measles'] }        // nothing joins them, said honestly
{ seed: 'strep', derivation: 'component', hops: 2, ids: ['strep', 'cold', 'flu'] }             // everything it can reach
```

`hops: null` is an ANSWER, not an absence, so a consumer that formats a distance keeps an honest else for it; the predicate is the `ids` either way (two nodes and no tie between them is exactly the picture of "no path"). Being the ids either way is also what makes every walk's picture the INDUCED subgraph over its own set, chords included: a tie between two members of an ego set or a component is inside the set and is kept, while a shortest path has no chord to keep (an edge between two of its non-adjacent nodes would be a shorter path). `to` is present only for `'path'`, so an `'ego'` body is byte-identical to the one that shipped before the other two walks existed.

**The question has a door of its own.** `clauseFromWire` yields the PREDICATE (the ids), because that is all a row filter needs; `neighbourhoodValueFromWire(record.value)` yields the recorded QUESTION beside it — `{ seed, derivation, hops, to?, ids }`, or `null` for a body carrying no walked list. Every slot is answered in ONE place: an absent seed reads as `null` (UNNAMED, never a node key), an unreadable derivation as this version's own `'ego'`, an unreadable hop count as `1` — while a `hops` of `null` and a `to` the body carries ride through untouched, because those are recorded answers and not gaps. A derivation another build minted rides through verbatim too, because a body still selects by its recorded ids. A chip, a commit-log line and a chart that highlights the seed all read it here rather than writing the defaults again.

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

## A find is a READ, and it is a TEXT question

`find(table, clauses, { text, columns, sort, from, direction })` answers ONE question: **where is the next match, in THIS order?**

**A find is a read.** It moves where a person STANDS in one fixed order — exactly as a scroll does — and nothing lands: no commit, no clause, no staged anything. The rows are the same before and after, which is what makes it safe to press repeatedly. It is deliberately **not** an agent tool: an agent that wants fewer rows FILTERS (an act, with a cause, on the log); a person looking for a cell wants their table left exactly as it is.

**It is on the PORT because only an engine can answer it.** "The position of the next match in this order" cannot be answered without walking the table — so a consumer that tried would be re-doing the engine's job at the consumer's cost, over rows it does not have. It is therefore ONE optional question on `DataProvider`, and the option is the honesty:

```ts
provider.capabilities.canFind === true && provider.find !== undefined
// absent ⇒ the engine cannot answer it, and the caller refuses IN WORDS:
//   "the server engine cannot find — filter instead"   (the session's `findInView`)
```

The memory engine answers over the same sort permutation a window walks; the wasm engine answers in SQL; the stub engines declare nothing and are refused. Nobody silently scans rows on their behalf.

**The match is a case-insensitive SUBSTRING over the TEXT FORM of a cell.** The text form has ONE owner, `cellText.ts`'s `cellString` — the same function the export writes into a CSV field and the sheet's Ctrl+C puts on the clipboard, which is why it lives in `data/` (below both) and is re-exported by `vizfootprint/session` under the name it had there first. The needle is not trimmed (a space is a character a person may be looking for); a search that is ENTIRELY whitespace is refused instead.

```ts
const answer = await provider.find('cases', clause, { text: 'lyme', columns: ['disease'], from: 0, direction: 'forward' });
// → { sql: '("state" IN (\'TX\'))', matches: 812, position: 5, ordinal: 1, index: 4193, row: { … } }
//    matches  = how many rows in the WHOLE view hold it   ("match 1 of 812")
//    position = 0-based in the view — the `offset` a window opens at to show that row
//    index    = its source-order index, what a positional row identity is made of
```

Two shapes, kept apart by the type: a HIT carries `ordinal`, `index` and `row`; a MISS is `{ sql, matches, position: null }` and carries none of them, so a caller cannot mint a row identity out of a match that was not found. **A miss with `matches > 0` is the honest end of a walk** — no match THAT WAY, and some the other way. Nothing wraps: the caller decides to ask again from the other end, and can say so ("wrapped to the top").

**A non-text column's text form is the ENGINE'S OWN.** `columns` says where to LOOK (not what to answer with — the row comes back whole), and a number column is searchable as its digits. The two engines are pinned to AGREE on **strings and integers** (`src/data/engineInvariant.test.ts`, on the 300,000-row fixture, sorted and unsorted, forward and backward, filtered and not). They are documented to DIVERGE on floats and timestamps, and that is named rather than papered over: `3` is `"3"` in JS and `"3.0"` in DuckDB for a `DOUBLE`, and a timestamp is an ISO instant here (`2024-01-02T00:00:00.000Z`) and a SQL timestamp there (`2024-01-02 00:00:00`). Closing that would mean rendering a formatter into every ILIKE — a cost every find would pay for a match nobody types.

**And case-insensitivity is not ONE rule, in one measured place.** JS `toLowerCase()` is full Unicode and a few of its folds **change length**; DuckDB's `ILIKE` folds one code point to one. The pairs that would break first do not — `Ä`/`ä` folds in both engines, `ß`/`SS` folds in neither — but `İ` (U+0130, the Turkish dotted capital I) lowercases in JS to `i` + U+0307, a combining dot, and in DuckDB to a plain `i`:

```ts
// a table holding one row 'İstanbul' and one row 'plain'
await find(t, null, { text: 'istanbul', columns: ['t'], from: 0, direction: 'forward' });
//   wasm   → matches: 1   (İ folded to i, so the needle lines up)
//   memory → matches: 0   ('i̇stanbul' has a combining dot between the i and the s)
await find(t, null, { text: 'İ', columns: ['t'], from: 0, direction: 'forward' });
//   wasm   → matches: 2   (the needle folded to a plain 'i', which 'plain' holds too)
//   memory → matches: 1
```

Both numbers are PINNED (`engineInvariant.test.ts`, "agrees about every case pair EXCEPT a fold that changes length"), so an engine that closes the gap fails the test and this paragraph is corrected with it. Closing it deliberately would mean shipping a full case-folding table into the ILIKE, or refusing the needle — a cost every find would pay for one letter.

**The SQL is two statements from one builder** (`findSQL`, beside `windowSQL`), and the builder owns the ORDER BY so a position cannot mean two things:

```sql
-- the hit: at most one row, and everything a reader is owed about it
WITH __view AS (SELECT (ROW_NUMBER() OVER (ORDER BY "disease" ASC NULLS LAST, "__row" ASC)) - 1 AS __pos, * FROM "cases" WHERE ("state" IN ('TX'))),
     __found AS (SELECT (ROW_NUMBER() OVER (ORDER BY __pos ASC)) AS __ordinal, * FROM __view WHERE (CAST("disease" AS VARCHAR) ILIKE '%lyme%' ESCAPE '\'))
SELECT * FROM __found WHERE __pos >= 0 ORDER BY __pos ASC LIMIT 1
-- the count: the same view, the same tests, no window function to pay for
SELECT COUNT(*) AS n FROM "cases" WHERE ("state" IN ('TX')) AND (CAST("disease" AS VARCHAR) ILIKE '%lyme%' ESCAPE '\')
```

Why TWO: the hit statement answers no row at all at the end of a walk, and that is exactly when `matches` still has to be honest — a count riding inside the hit row would vanish with it. Why the source-order key is UNCONDITIONAL here while `windowSQL` may leave an order off: a position IS a page boundary, so a find on a table this engine did not load (no `__row`) has no honest position at all and is refused in the same words `indices: true` is refused in on the same table. And `%`, `_` and `\` in the needle are escaped with a named `ESCAPE`, so a person searching for `50%` does not match every row.

**One malformed-find judgement, one set of words** (`badFindReason`, beside the type it judges — the memory engine calls it, `findSQL` calls it and throws the sentence as a `WindowRefusal` its provider converts):

| the ask | `reason` | the sentence |
|---|---|---|
| `text` empty once trimmed | `bad-find` | `a find needs something to look for — the text was empty` |
| `from` negative or fractional | `bad-find` | `from must be a whole number at or above zero (got -1)` |
| `direction` neither way | `bad-find` | `direction must be "forward" or "backward" (got "sideways")` |
| `columns` empty | `bad-find` | `a find needs at least one column to look in` |
| a column the table lacks | `unknown-column` | `table "cases" has no column "nope" to look in` |
| an engine that cannot sort | `unsupported-sort` | (`evaluate`'s own sentence, from `serverProvider`) |

`direction` is judged at RUNTIME even though the type pins it: this port is reached across an HTTP door, and a word the compiler never saw must be refused rather than read as "backward".

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
absenceContradictionOf(rows, silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown'] }), ['cases'], 'data["cells"]');
// 'data["cells"].rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both,
//  so carry null in cases where the row reports nothing (7 more rows do the same)'
```

The one thing that moves that line is the DECLARATION: `AbsenceDecl.carries` names the states that hold a number anyway, and a state named there is not a silence, so its number is not a contradiction. EIA's hourly grid is the case it exists for — a `replaced` demand figure is the number the agency published beside the one the authority filed, and an `estimated` one is EIA's own figure for an hour nobody filed; both ARE figures, and a check that refused them would refuse the honest table. Default NONE, so every declaration written before the key existed is judged byte for byte as it was. It moves this check and nothing else: the walker still reads exactly `present` unless the entry ALSO says `arithmetic: 'carried'`, because "the source put a number here" and "the arithmetic may add it" are two different questions and only the source can answer the first ([`../derive/README.md`](../derive/README.md), "A carried number is not a default"). The def door refuses a `carries` that names a word the vocabulary never declared (a typo would silence-proof a column), `present` (not a silence to begin with) or `unknown` (the word for a silence the source could not tell apart — it cannot also have carried the value):

```ts
const demand = { field: 'demand_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] };
absenceContradictionOf([{ authority: 'CISO', demand: 24_000, demand_state: 'replaced' }], silenceOfDecl(demand), ['demand'], 'data["hourly"]');   // undefined
absenceContradictionOf([{ authority: 'CISO', demand: 24_000, demand_state: 'unavailable' }], silenceOfDecl(demand), ['demand'], 'data["hourly"]');
// 'data["hourly"].rows[0]: demand_state says "unavailable" — no value — and demand holds 24000; a table cannot
//  say both, so carry null in demand where the row reports nothing'
```

## Silence belongs to a COLUMN — the port every reader asks

> **`ColumnSilence` answers, for ONE column: which column carries its state, what vocabulary that column speaks, which word of it means *reported* and which means *could not tell*, which of those states carry a number, and whether the arithmetic reads them. `TableSilence` answers it per column, and is total.**

`AbsenceDecl` used to speak for the ROW, and the exoplanet demo found the cost: a `measurements` row carries a radius, a mass and a period, each with its own silence — measured, a published bound, or never taken — and 43 planets have a mass and no radius. Read row-wise, that honest table contradicts itself (`radius_state` says `not-measured` on a row where `pl_orbper` holds 88) and the library's own validator correctly refused it. The question was wrong, not the answer.

`silence.ts` is the port (OUR shape), and two adapters map onto it:

```ts
// a BARE declaration means what it always meant: one state column speaks for every OTHER column
silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable', 'unknown'] });
// a LIST means each entry speaks for the columns it names
const measurements = silenceOfDecl([
  { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
  { field: 'mass_state',   states: ['present', 'not-measured', 'unknown'],                                          governs: ['pl_masse'] },
]);
measurements.silenceFor('pl_rade')?.state;  // 'radius_state'
measurements.silenceFor('pl_masse')?.state; // 'mass_state'
measurements.silenceFor('radius_state');    // undefined — a state column speaks for itself
silenceOfNothing().silenceFor('anything');  // undefined — the null object, so nothing below branches
```

Every reader asks the port and is written once: the arithmetic and the group fold (`../derive/`), the contradiction check beside it, the encoding plane's facets (each state column gets role `absence` with the words IT speaks), the derive and aggregate acts, `describeTable`, and the adapter's frame door. Two tests read a `ColumnSilence`, and they are two because they answer two questions — `silenceTestOf` asks *did the source report anything* (the contradiction check's), and `readsValueTestOf` asks *does the arithmetic read the cell* (the walker's, and the one `arithmetic` moves).

**The two anchor words are the definition's, and the port carries them.** `ColumnSilence.present` is the word a row uses to say the source reported a value and `ColumnSilence.unknown` the word for a silence it could not tell apart — the definition's own (`AbsenceDecl.present` / `.unknown`, [`../def/README.md`](../def/README.md)), or the library's `present` / `unknown` when it named none. The adapter fills them ONCE (`silenceOfDecl`, the J precedent: no optional keys on the port), both tests compare to `silence.present` and never to a constant, and a definition naming neither reads byte-identically to before. So a source whose word is `final` is read as `final`, and in that vocabulary the library's `present` is just another word nobody declared — a silence:

```ts
const own = silenceOfDecl({ field: 'demand_state', present: 'final', unknown: 'unclear', states: ['final', 'estimated', 'unclear'], carries: ['estimated'] });
own.silenceFor('demand');                       // { state: 'demand_state', states: [...], present: 'final', unknown: 'unclear', carries: ['estimated'], arithmetic: 'present-only' }
silenceTestOf(own.silenceFor('demand')!)('final');       // false — reported
silenceTestOf(own.silenceFor('demand')!)('estimated');   // false — carries a figure
silenceTestOf(own.silenceFor('demand')!)('present');     // true  — undeclared here, so a silence
readsValueTestOf(own.silenceFor('demand')!)('final');    // true  — present-only reads exactly the definition's word
```

The def door holds the list to **one column, one owner**: an entry must name what it `governs` (two entries each claiming "every other column" are two answers to one question), no two entries may govern the same column, `governs` may not name a column the table does not declare or the entry's own state column, and an empty list is refused. The port's own resolution order — a state column first, then the first entry naming the column, then the entry that names none — exists only so it is TOTAL, and every overlap that would make that order visible is already a sentence ([`../def/README.md`](../def/README.md)).

## Where the code lives

| file | one job |
|---|---|
| `silence.ts` | THE PORT for absence: `ColumnSilence` / `TableSilence`, the two adapters (`silenceOfDecl`, `silenceOfNothing`) and the two tests every reader shares (`silenceTestOf`, `readsValueTestOf`) |
| `derivedColumns.ts` | the ONE slot grammar (`slotNameOf`, its marker, `canNameSlot`), the column store, `resolveDerived` (generic: columns AND tables), the two renamers |
| `derivedTables.ts` | the table store keyed by parent, `mintDerivedTable` (slot, key, relation — minted, never typed), the generational `clear` |
| `absenceContradiction.ts` | the one sentence for a table whose state columns and value columns disagree — judged per governed column, against the port |
| `describeTable.ts` | what is in a table before there is a dashboard — and, given a vocabulary, whether it keeps its word |
| `fold.ts` | one pass, many recorders |
| `cellText.ts` | the TEXT FORM of a cell (`cellString`) — one owner, below every door that reads it: the export writes it into a field, a copy puts it on a clipboard, a FIND matches against it |
| `predicate.ts` / `clauseFromWire.ts` | the clause shape this folder evaluates, and the one translation from a commit's wire triple |
| `sqlWindow.ts` | the window AROUND the `WHERE` — one pure statement builder (projection, `ORDER BY` with its null placement and its `__row` tie-break, the `__row`-only order a paged unsorted window gets, `LIMIT`/`OFFSET`, the `__row` source-order column), the two statements a FIND runs (`findSQL` — the same order, rendered once, plus the ILIKE tests and their escaping), and the ONE way either is refused |
| `delta.ts` / `sqlReland.ts` | the answer a reland owes (`RefreshDelta`, and `deltaByKey` — the memory engine's strategy; `vizfootprint/source` still names both), and the statements the wasm engine asks it with (`relandSQL`: the two first-row-per-key CTEs, the five counts, the three samples, the atomic replace that copies `__row`, the drop; `emptyStagingSQL` for zero rows) — pinned byte for byte |
| `memoryProvider.ts` / `wasmProvider.ts` / `serverProvider.ts` / `stubEngines.ts` | the engine that answers in this process, the engine that answers over a SQL connection (its tables' bytes are landed by `../def/wasmBackend.ts`), the one that names its tables and refuses the rest, and the sentence it refuses in |
| `sqlConnection.ts` | the port a SQL backend is reached through (`query`, `close`), the loader shape (`load` — rows or CSV text), and `loadTableSQL`: the ONE statement that gives a loaded table its `__row` source order |
| `duckdbConnection.ts` | the only module that names `@duckdb/duckdb-wasm` (an optional peer, pinned by a test, imported dynamically — [`../../PACKAGING.md`](../../PACKAGING.md) Law 3), and it names it inside the opener — the Arrow-to-rows adapter, the file-registering loader, the host judgement, and the one query config (`READ_CONFIG`) both hosts open with |
| `sqlConnection.coverage.helpers.ts` | not shipped code: the two FAKE backends both SQL-engine suites are judged against — the canned one (`wasmProvider.test.ts` asserts the statements) and the tiny one that answers only what was landed in it (`../def/wasmEngine.def.test.ts` asserts the wiring) |
