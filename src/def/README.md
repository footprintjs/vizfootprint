# def — the declarative dashboard

`buildDashboard(def)` takes a `DashboardDef` — a Mosaic-spec superset — validates it against a strict allowlist, resolves each table's engine, promotes each declared analysis, and hands back a `Dashboard`. Everything the def states is inert data: a hostile string in a label or an analysis id is stored and echoed verbatim, never interpreted.

## An analysis can be named, not written

Read key by key, a `DashboardDef` is **data** — except two keys. `fdr.gamma` is an optional developer-authored sequence, and `analyses` used to be code in both of its forms: `AnalysisDef` requires `build` / `toRunInput` / `readOutput` functions, and `AnalysisModule` is *detected* by its `run` function. The built-in analyses are factories over plain options, but nothing resolved a NAME to one — so a definition could not name an analysis without someone writing TypeScript, and `JSON.parse(text)` could never produce one.

An analysis slot now takes a third form: a **record naming a builtin and its options**.

```ts
analyses: {
  byDisease: { builtin: 'groupBy',     by: 'disease', measure: 'cases' },
  linked:    { builtin: 'correlation', x: 'cases', y: 'ytd' },
  trend:     { builtin: 'regression',  x: 'cases', y: 'ytd', minPoints: 12 },
  bins:      { builtin: 'clustering',  column: 'cases', k: 4 },
  rate:      { builtin: 'formula',     expression: 'cases / population * 1000', name: 'rate' },
  map:       { builtin: 'layout',      algo: 'stress', table: 'nodes', edges: 'edges' },
  ends:      { builtin: 'bringOver',   table: 'edges', from: 'nodes', columns: ['x', 'y'] },
  per100k:   { builtin: 'derive',      table: 'cells', name: 'per100k',
               column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { col: 'population' }] } } },
  totals:    { builtin: 'aggregate',   table: 'cells', name: 'by_disease', ops: 1, groupBy: ['disease'],
               measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }] },
}
```

The record's keys **are** the factory's own options, so there is one vocabulary and no second one to keep in step. One option has no spelling: `correlationAnalysis`'s `pValue` judge is a function, so a declared correlation takes the built-in normal-approximation judge — a caller who wants their own is writing code, and passes the module.

| the builtin | what it is | what it must be given |
|---|---|---|
| `groupBy` | a summary as a new queryable table | `by`, `measure` |
| `correlation` | Pearson's r as a scalar, with its p-value | `x`, `y` |
| `regression` | an OLS line as a geometry layer | `x`, `y` |
| `clustering` | quantile bins as a new int column | `column`, `k` |
| `formula` | **an arithmetic expression over this table's number columns, as a new column** | `expression`, `name` |
| `layout` | **a seeded stress layout, as `x` and `y` columns on the nodes table** | `algo` |
| `bringOver` | **a related table's columns, fetched across the declared relations** | `table`, `from`, `columns` |
| `derive` | **a declared column: the closed op grammar, as a new column** | `name`, `column` |
| `rank` | a bounded ranking receipt over existing numeric observations | `schema`, `plan`, `operationId`, `resultRef` |
| `aggregate` | **a derived TABLE: one row per group, its measures the derive reducers** | `name`, `ops`, `groupBy`, `measures` |

`formula` is the one whose content is a sentence a PERSON typed rather than options a developer chose, so it is the one this door judges twice: the grammar reads `expression` here, at validation, and refuses a token it has no rule for by naming it and its position (`analyses["rate"].expression is not a formula: the formula has no rule for "%" at position 7`); the SESSION then judges the columns it names against the table it will read, before the act exists. The grammar, the five functions it knows and every refusal either judge makes are in [`../analysis/README.md`](../analysis/README.md).

`derive` is the same act said as a TREE rather than as a sentence, which is what lets it hold comparisons, conditionals, strings, dates and a calendar — none of which arithmetic text can spell. This door judges the declaration's SHAPE (`column must be a derived-column declaration — { ops, kind, expr }`); the session judges the tree against the table's own columns, and refuses in the derive taxonomy rather than the general one. Like `bringOver`, it names one thing it may not: its table's absence vocabulary is the def's (`data[<table>].absence`) and rides beside the record as context, because a record that could name its own would name one nobody declared. The absence vocabulary itself must be able to say `present` (and `unknown`): a table may use its own words for the silences, but the derived-column arithmetic reads exactly that one word to know a row reported a value, so `validateAbsence` refuses a vocabulary without it — `states: ['not catalogued', 'unknown']` would read as absent in every cell of every row. The grammar, its 51 ops, its pinned answers and every refusal are in [`../derive/README.md`](../derive/README.md).

### The absence vocabulary — and which of its words carry a number

One key of that vocabulary is not about the arithmetic at all. `carries` names which of the declared states hold a number ANYWAY, and EIA's hourly grid is the case it exists for: an `estimated` figure is EIA's own number for an hour nobody filed, and a `replaced` one is the number EIA published beside the number the authority filed. Both are figures. It is read by ONE thing — the contradiction check ([`../data/README.md`](../data/README.md)), which refuses a table whose silent row holds a number — so a state named there is not silent and its number is not a table saying two things at once. Default NONE: a def written before the key existed is judged byte for byte as it was. The walker is untouched and still reads exactly `present` unless the same entry says `arithmetic: 'carried'`, because "the source put a number here" and "the arithmetic may add it" are two different questions, and only the source can answer the first.

```ts
data: {
  hourly: {
    rows,
    absence: { field: 'demand_state', states: ['present', 'estimated', 'replaced', 'unavailable', 'unknown'], carries: ['estimated', 'replaced'] },
    columns: { demand: { role: 'measure' } },
  },
}
// { demand_state: 'replaced', demand: 24000 } is kept — the declaration says a replaced row carries its figure
// { demand_state: 'unavailable', demand: 24000 } is refused, in the data door's own sentence:
//   'data["hourly"].rows[0]: demand_state says "unavailable" — no value — and demand holds 24000; a table cannot
//    say both, so carry null in demand where the row reports nothing'
```

The door refuses a `carries` that names a word the vocabulary never declared (a typo would silence-proof a column), `present` (not a silence to begin with), or `unknown`:

```
data["hourly"].absence.carries may not name "unknown" — a source that could not tell which silence it saw did not carry the value either
```

### The two anchors are the definition's — `present` and `unknown` name its OWN words

> **The vocabulary is the definition's, both anchors included; the library's words are the default, never the requirement.**

Everything above reads two anchor words — the one that means *reported* and the one that means *could not tell* — and until this packet those two were the library's: a source whose own word is `final`, `measured`, `reported` or `presente` had to be rewritten in ETL to say `present`, which is the library putting its word in the data's mouth. Now a declaration names them (`present`, `unknown`), and every law that reads an anchor reads the definition's word: `states` must include them, `carries` may name neither, `arithmetic: 'present-only'` reads exactly the definition's `present`, and the contradiction check judges a row against it. The library's words (`ABSENCE_PRESENT` = `present`, `ABSENCE_UNKNOWN` = `unknown`) are what a definition means when it names neither — and such a definition is byte-identical to one written before the keys existed, every sentence included.

```ts
data: {
  hourly: {
    rows,
    absence: { field: 'demand_state', present: 'final', unknown: 'unclear', states: ['final', 'estimated', 'unclear'], carries: ['estimated'] },
    columns: { demand: { role: 'measure' } },
  },
}
// { demand_state: 'final',     demand: 24000 } reads 24000 — the source's own word for "reported"
// { demand_state: 'estimated', demand: 24000 } is a figure (carries), absent from the sum unless arithmetic: 'carried'
// { demand_state: 'unclear',   demand: 24000 } is refused: 'data["hourly"].rows[2]: demand_state says "unclear" — no value — and demand holds 24000; …'
// { demand_state: 'present',   demand: 24000 } is refused too — in THIS vocabulary `present` is a word nobody declared
```

The sentences quote the definition's words. Each anchor, if declared, is a non-empty string; the two may not be one word:

```
data["hourly"].absence.states must include "final" — the word a row uses to say the source reported a value; without it every cell of this table reads as absent
data["hourly"].absence.states must include "unclear" — a source that cannot tell which silence it saw needs a word for that
data["hourly"].absence.carries may not name "final" — that is the word for a row that reported its value, not for a silence that carries one
data["hourly"].absence.carries may not name "unclear" — a source that could not tell which silence it saw did not carry the value either
data["hourly"].absence.present, if declared, must be a non-empty string — this definition's own word for a row that reported a value ("present" when unstated)
data["hourly"].absence.present and data["hourly"].absence.unknown may not be the same word ("final") — a row that reported a value and a silence the source could not tell apart cannot share one
```

The port carries the words (`ColumnSilence.present` / `.unknown`, [`../data/README.md`](../data/README.md)); the adapter defaults them; every reader reads the port and none compares to the constants. The Sources tab and the feature card list `states` as declared and name no anchor of their own.

### Silence belongs to a COLUMN — `governs`, and one column one owner

> **`absence` is one entry, or a LIST of them. An entry with no `governs` speaks for every OTHER column of the table — what a bare declaration has always meant. In a list every entry names its own, because two entries each claiming "every other column" are two answers to one question.**

The exoplanet demo found this. A `measurements` row carries a radius, a mass and a period, each with its own silence — measured, a published bound, or never taken — and 43 planets have a mass and no radius. Read row-wise that table contradicts itself, and this door correctly refused it; the demo had to fall back to `role: 'absence'` per column plus a `where` on every act, which is honest but carries none of the fact into the declaration, so nothing downstream could enforce it. Now it does:

```ts
data: {
  measurements: {
    rows,
    absence: [
      { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
      { field: 'mass_state',   states: ['present', 'not-measured', 'unknown'],                                          governs: ['pl_masse'] },
      { field: 'period_state', states: ['present', 'not-measured', 'unknown'],                                          governs: ['pl_orbper'] },
    ],
    columns: { pl_rade: { role: 'measure' }, pl_masse: { role: 'measure' }, pl_orbper: { role: 'measure' } },
  },
}
// { radius_state: 'not-measured', pl_rade: null, mass_state: 'present', pl_masse: 6.4, period_state: 'present', pl_orbper: 88 }
// is ACCEPTED — the radius says nothing about the period, and each cell is judged by the column that governs it
```

Every state column earns role `absence` with the words IT speaks, so none may bind to a magnitude channel and each keeps its own vocabulary in the encoding plane. The list's rules are all the same rule — **one column, one owner** — and each is a sentence:

```
data["measurements"].absence[1].governs must name the value columns this state column speaks for — in a list every entry names its own, because two entries each speaking for "every other column" are two answers to one question
data["measurements"].absence: "pl_rade" is governed by both entry 0 ("radius_state") and entry 1 ("mass_state") — one column, one owner: a column whose silence has two answers has none
data["measurements"].absence[0].governs may not name "radius_state" — that is this entry's own state column, and a state column speaks for itself
data["measurements"].absence[0].governs names "pl_radee", which this table does not declare in columns — a state column can only speak for a column the table declares
data["measurements"].absence, if it is a list, must declare at least one entry — an empty list is a table saying it has an absence vocabulary and then naming none
```

### `arithmetic` — a carried number is not a default

> **The arithmetic reads exactly the definition's `present` word. A definition may opt ONE column in with `arithmetic: 'carried'` (default `'present-only'`), and nothing else moves.**

```ts
// present-only (the default): the published bound is a figure, and it is NOT in the sum
{ field: 'radius_state', states: [...], carries: ['upper-bound'], governs: ['pl_rade'] }
// carried: the same rows, and the bound is in the sum
{ field: 'radius_state', states: [...], carries: ['upper-bound'], governs: ['pl_rade'], arithmetic: 'carried' }
```

WHY it is per entry and never a global switch: a switch would silently move every total this library has ever computed, and nobody would see it move. The house law is **declare what must be explained ⇒ data** — a dashboard that wants published estimates inside its sums says so in the declaration, where a reader can see it, rather than inheriting a default nobody chose. The door refuses a third word:

```
data["hourly"].absence.arithmetic, if present, must be one of present-only|carried — "present-only" reads exactly "present" (the default, and every total this library has computed), "carried" also reads the states named in carries
```

The reading every consumer asks — which column governs which, what each speaks, and what the arithmetic does with it — is one port: `silenceOfDecl` / `TableSilence` ([`../data/README.md`](../data/README.md)).

`aggregate` is `derive`'s twin, and lands a TABLE beside the parent rather than a column on it: one row per group, cut from the rows visible at the cursor when the act was declared, its measures written in the same op grammar — `{ as, expr }`, each `expr` a reducer tree (`sum`, `mean`, `countDistinct`, …). This door judges the record's SHAPE: `groupBy` a list of distinct names, where `[]` is the whole table as one row, said out loud; `measures` a non-empty list under distinct names; `where`, if present, a node. The session judges every tree against the parent's own columns, in the derive taxonomy. Like `derive` it names no absence vocabulary, and like `bringOver` it names no relation: the group column becomes the derived table's key, and the relation back to the parent is MINTED from that by the session, never typed on the record ([`../data/README.md`](../data/README.md)). The rows never ride the record — a replay recomputes them from these bytes. The act, its three outcomes and its refusals are law 13 of [`../derive/README.md`](../derive/README.md).

```
analyses["totals"].groupBy must be an array of distinct, non-empty column names — [] means the whole table (the "aggregate" analysis needs it)
analyses["totals"].measures must be a non-empty array of measures — { as, expr }, each under its own name (the "aggregate" analysis needs it)
```

**And because a record is data, it can ride on the trace.** `registerAnalysisSlot` keeps the record it built beside the module (`RegisteredAnalysis.record`, absent for the other two forms), and a `declareAnalysis` commit carries it in its value slot — so a log holding record-declared analyses is enough to perform those acts again with nothing registered on the replaying session first. A module cannot ride, which is not a policy but a fact about functions. See [`../session/README.md`](../session/README.md), law 6.

**With this, a definition holding only builtin records is fully JSON-serialisable.** Every other key already was, so `JSON.parse(JSON.stringify(def))` round-trips such a def intact (`fdr.gamma`, if you declare one, is the remaining exception — and it is optional).

### Three forms, told apart by shape

| the slot has | it is | validated by |
|---|---|---|
| `run` | an `AnalysisModule` — already built | its own construction |
| `build` | a raw `AnalysisDef` | L3's `validateAnalysisDef`, re-run here |
| `builtin` | a builtin record | `validateBuiltinAnalysis` |
| none of those | refused | L3's refusal, which names every missing piece |

Shape, never a guess — and the def door and the registry route on the **same predicate** (`isBuiltinRecord`), so the shape that validates is the shape that gets constructed. A record is resolved to its factory in `register.ts`, at registration; nothing is constructed until it has been judged.

The **key is judged before the slot is**, and for every form alike: `analyses[""]: an analysis id must be a non-empty string`. The empty string is not a name, whoever wrote the slot — and refusing it at the door is what keeps the key-as-id rule below from ever injecting one.

### A record's name is the key it was declared under

```ts
analyses: { byDisease: { builtin: 'groupBy', by: 'disease', measure: 'cases' } }
// def.id === 'byDisease'  — not 'groupby:disease:cases'
```

The two forms differ in **who wrote them**, and that is what decides identity. A module carries its own id because a developer wrote it and may register it under any key. A record has no identity except the name a person declared it under — and that name is the one they will look for in `why`, in the FDR ledger and in a citation. A factory spelling like `groupby:disease:cases` leaking into provenance would be an implementation detail wearing a person's name badge, so a record with no `id` takes its key, and the hypothesis a declared `correlation` emits wears the declared name too.

An explicit `id` on a record still wins, and hand-written modules are untouched: `registerAnalysisSlot('slot', groupByAnalysis({…}))` still keeps `groupby:disease:cases`, exactly as before.

Every refusal is a sentence naming the analysis and the problem:

```
analyses["bins"].k must be a whole number of at least 1 (the "clustering" analysis needs it)
analyses["a"].pValue is not an option of the "correlation" analysis — it takes x, y, id, branchId
analyses["a"].builtin "kmeans" is not a builtin analysis — one of groupBy | correlation | regression | clustering | formula | layout | bringOver | derive | aggregate
analyses["rate"].expression is not a formula: the formula has no rule for "%" at position 7
analyses["map"].algo must name a layout algorithm — "stress" (the "layout" analysis needs it)
analyses["ends"].columns must be a non-empty array of distinct, non-empty column names (the "bringOver" analysis needs it)
```

`k: 0` is the one worth pointing at: `quantileBins` throws on it. Refusing it at declaration is the difference between a sentence and a stack trace.

`layout` and `bringOver` are the two that read a SECOND table. `layout` is `algo` and nothing else that it must be given — the table names, the key and endpoint columns, the seed, the passes and the two columns written all have defaults (`nodes` / `edges`, `id` / `source` / `target`, seed 1, 30 passes, `x` / `y`). `algo` is required although there is one algorithm today, because the act has to say what it did rather than leave a reader to infer it from whichever version of the library happened to run. The permission to read the edges is law 6 below: a declared relation between the two tables, or the act does not happen. What the layout computes, and why a position is data at all, is in [`../analysis/README.md`](../analysis/README.md).

`bringOver` is the one whose OUTPUT the relations decide. The record names the two tables and WHAT to fetch; which columns it produces is read off the declared relations pointing from `table` at `from` — `edges.source → nodes.id` and `edges.target → nodes.id` give `source_x`, `source_y`, `target_x`, `target_y`. There is deliberately no `joins` option: a record that could name its own join could name one nobody declared, and the relation would stop being the permission. Declare none and the act does not happen (`analysis "ends" brings x, y over from "nodes", but no declared relation points from "edges" at "nodes" — declare the relation first`). It is a general door, not a network feature: a sales table brings its customer's `region` over the same way. The counters it keeps, and the rest of its refusals, are in [`../analysis/README.md`](../analysis/README.md).

## The parse door

`validateDashboardDef(value)` does the judging and returns the sentences — but it hands back a `string[]` and leaves the caller holding an `unknown`. A caller that parsed JSON then asserted the type by hand, which is the exact moment the firewall stops meaning anything.

```ts
const parsed = parseDashboardDef(JSON.parse(text));
if (!parsed.ok) return refuse(parsed.problems);   // sentences
buildDashboard(parsed.def);                       // a DashboardDef, narrowed
```

It **calls** the validator; it never restates it, so the two cannot disagree. `buildDashboard(JSON.parse(text))` is still the direct path — this is for a caller that wants to hold a typed definition before building one.

## The engine a table runs on — and the one this version does not run

`data[t].engine` routes a table to a D24 engine: `memory` (in-JS predicates, always on), `wasm` (a real SQL engine — DuckDB-WASM behind the `SqlConnection` port, with this table's bytes landed in it), `server` (a typed stub — the port's shape with nothing behind it), or `auto`. **`auto` follows `chooseEngine`**, whose row threshold is MEASURED (`bench/step0-wasm`: 300,000 rows is the largest size at which the memory engine answered every read inside an interaction budget; at 1,000,000 its sorted window is 97.5 ms and its first sorted ask 517 ms against DuckDB's 14.8 ms). It used to resolve to memory whatever the stats said, because those thresholds were an unmeasured placeholder and a round number must not spawn a database for a table this process can answer in JS. It still NAMES what it picked and the count it picked on — `engine "auto" resolved to wasm (300,001 rows, against the measured row threshold in chooseEngine — declare an engine to choose otherwise)` — because a table that opens a database should never do it silently, and `availableEngines` still bounds the answer — and when that bound is what decided it, the note says THAT too (`; the measured threshold said wasm, which this build was not told is available — pass availableEngines: ["memory","wasm"] to allow it`), because `availableEngines` defaults to `['memory']` and the sentence would otherwise read as if the measurement had chosen memory. Declaring the engine is how a table overrides it.

### The wasm engine runs — and WHICH DOOR you called decides when its bytes land

The engine needs two things a def cannot carry: a connection, and the bytes in it. The connection comes from `openSqlConnection` (default: `duckdbConnection()`, imported dynamically — see [`../../PACKAGING.md`](../../PACKAGING.md)); the bytes are the table's own `rows` or `csv`, landed by [`./wasmBackend.ts`](./wasmBackend.ts). What differs between the doors is WHEN:

```ts
const def = { data: { cases: { rows, engine: 'wasm' } }, actors: { … } };

// the door that CAN await, does: the bytes are in the backend before the dashboard is returned
const live = await buildDashboardAsync(def);
live.engines;   // { cases: 'wasm' }
live.notes;     // [] — the engine ran, and its table is in it

// the sync door cannot await a load, so it says which read will pay for it
buildDashboard(def).notes;
// [ 'data["cases"]: the "wasm" engine holds this table lazily — a sync build cannot await a load,
//    so the SQL connection opens and its bytes land on the first read; build with
//    buildDashboardAsync to have them landed before the dashboard is returned' ]
```

ONE connection serves every wasm table in a build — two databases could not see each other's tables — it is opened at most once, and a def with no wasm table never opens one at all. A landing that FAILS is a build note *and* a `no-backend-connection` refusal on the first read of that table, never a throw past the door: a def with two wasm tables must not lose the one that landed because the other did not.

### Whoever opened it closes it

A wasm build holds something no other dashboard does: a database, with a worker or a WASM instance behind it. `Dashboard.close()` releases the one THIS BUILD opened, and nothing else — a connection a host handed over through `openSqlConnection` stays the host's, because the host may be reading it through five other things this build has never heard of. Close it when the last session that reads it is done; a read after it is refused by the engine's own words, never answered from a cache.

```ts
const mine = await buildDashboardAsync(def);            // the default opener: this build owns the database
await mine.close();                                     // …so this closes it — twice is a no-op, and it never throws

const theirs = await buildDashboardAsync(def, { openSqlConnection: () => myPool.connect() });
await theirs.close();                                   // opens nothing, closes nothing: not ours to release
```

A dashboard with no wasm table has nothing to close and says so by doing nothing — as does a sync-door build whose lazy wasm table nobody ever read, because nothing was opened. `refresh()` on a wasm table re-lands it in the same database (below); only a table on an engine that cannot re-land at all is refused, and its remedy is this pair of acts: close, then build again.

### A source table and the wasm engine

**A source table may declare `engine: 'wasm'`, and `buildDashboardAsync` is the door that honours it.** The old rule ("a source table is materialised in memory") was written when no other engine could answer; now the async door already holds the carrier's decoded rows, so it lands them in the SQL backend instead of an array. What it may NOT declare is an engine that cannot RECEIVE bytes — `server` (nothing behind it) or `auto` (a real fetch whose engine is not known until the bytes have been counted) — because that would fetch bytes nothing loads:

```ts
const def = { data: { cases: { source: { format: 'csv', via: 'http', at: url }, engine: 'wasm' } }, actors: { … } };

const dash = await buildDashboardAsync(def, { sources: [httpSource()] });
dash.engines;          // { cases: 'wasm' } — the rows the carrier decoded, landed in the backend
dash.sources['cases']; // …and the provenance it vouched for, kept as for any source table

buildDashboard(def);
// DashboardDefError: data["cases"] declares a source via http — build it with buildDashboardAsync
validateDashboardDef({ ...def, data: { cases: { source, engine: 'server' } } });
// [ 'data["cases"] sets engine "server" with a source; a source's rows are loaded into the engine
//    that reads them, so a source table declares "memory" (materialised in this process) or "wasm"
//    (landed in the SQL backend by buildDashboardAsync) — or no engine at all' ]
```

Two consequences, both said out loud rather than papered over. The SYNC door refuses an inline source beside `engine: 'wasm'` in a sentence (landing bytes is an await, whichever via carried them). And `refresh()` walks ONE path for every engine — open the source, take the snapshot, hand the rows to the engine that holds the table and let IT compute the delta (`DataProvider.replaceRows`; [`../data/README.md`](../data/README.md), "A refresh is computed where the rows live"). A memory table diffs its arrays in this process; a wasm table is re-landed IN its SQL backend and the delta is asked of SQL, so no row comes out of DuckDB to be diffed in JavaScript. The provider stays the same object, `dashboard.engines` stays true, and a session opened before the refresh reads the new rows on its next query.

```ts
const dash = await buildDashboardAsync({ ...def, data: { cases: { source, engine: 'wasm', key: 'week' } } }, { sources: [http] });
(await dash.refresh(['cases'])).tables['cases'];
// { changed: true, from: 'v1', to: 'v2', retrievedAt, rows: 3,
//   delta: { keyed: true, key: 'week', added: 1, updated: 1, removed: 1, sample: { added: ['4'], updated: ['2'], removed: ['3'] }, unkeyed: 0 },
//   derivedLost: ['by_disease'] }   // a table an aggregate cut from the v1 rows — the SESSION's bookkeeping, kept at the door
```

What stays at the door is the session's own bookkeeping, not the engine's: the derived-column registry is cleared and reported as `materialisedLost` by the names a person knows (on the wasm engine nothing was ever materialised — `canMaterialize: false` — so that list names only columns the new bytes themselves dropped), and the derived TABLES cut from the old version are dropped and reported as `derivedLost`. A refusal keeps its word `not-reloadable`, now for two facts the message tells apart: the table's engine has no `replaceRows` at all (a stub — *runs on the E engine, which cannot re-land rows — close() this dashboard and build again*, the remedy naming both acts because a second build over an unclosed one leaves the first database open), or its backend refused the act, quoted in the engine's own words with the old rows left exactly where they were. Never, on refresh, is a wasm table rebuilt as a memory one — that would silently change which engine answers.

**A declared engine is honoured, and never silent.** A table routed to the engine this version does NOT run still builds, every read of it is refused, and the BUILD says at the door exactly what the read will say — the same sentence, minted once by its owner ([`../data/stubEngines.ts`](../data/stubEngines.ts)) and quoted by both doors:

```ts
buildDashboard({ data: { cases: { rows, engine: 'server' } }, actors: { … } }).notes;
// [ 'data["cases"]: the "server" engine answers no query in this version — it is a typed stub:
//    it names its declared tables and answers nothing else. Declare engine "memory" to run
//    "cases" in this process, or bring the engine yourself: pass
//    { providers: { "cases": yourProvider } } to the builder you already call' ]
```

**Why a note and not a `parseDashboardDef` refusal.** Three reasons, and they are all the same reason: the def is not what is wrong.

1. `server` is a legal declaration of a real seam. What is missing is an engine in this VERSION — a fact about the build, not about the grammar, and the grammar door is where a def's own shape is judged.
2. **The same def RUNS when a host brings that engine.** `buildDashboard(def, { providers: { cases: yourProvider } })` answers the table from the host's own `DataProvider`; the validator never sees the options, so a refusal there would refuse a def that works. (That table then owes the *host* note — the def's routing was not built — and never the stub's.)
3. A stub engine is the one reachable way to exercise what a session does when an engine cannot serve: the typed `needs-backend-data` gap, with the act still standing ([`../session/README.md`](../session/README.md), law 1, rule 3). Refuse the declaration at the grammar door and that behaviour loses its only test path.

What refuses out loud instead, in the same words: `dashboard.notes` at build, `lint()` and `lintProse()` **throw** them (nothing to judge is not "nothing wrong"), and `lintData()` reports them per key and per relation. `lintFrames()` is the fourth and the only SYNCHRONOUS one — it reads the DEFINITION (how many layers a view stacks), never a column, and answers in ADVICE rather than refusals: `{ viewId, sentence }` rows off `frameLint`, because "five layers on one frame" is a judgement about what a reader can tell apart, not an error. It is a row of its own kind on purpose: an `EncodingProblem` names a channel, a field and a severity of refused/coerced, and a frame note has none of the three. `availableEngines` bounds one thing only — what `auto` may resolve to — and says so; it has never gated an explicit engine. Naming **no** engine (`[]`) is refused at the door in a sentence, because `[]` is not "unset": it reaches `chooseEngine` with nothing to pick and would abort the whole build with a `RangeError` for a guess that only appears in a note.

**A host provider is judged on the whole port.** `judgeProviders` reads back the two DATA members as well as the four methods: `engine` (what `dashboard.engines` reports) and `capabilities` (what the session reads before every sorted window — a provider that declares none leaves it dereferencing nothing at first query):

```ts
buildDashboard(def, { providers: { data: { engine: 'memory', tables, columns, evaluate, materializeColumn } } });
// DashboardDefError: providers["data"] declares no capabilities — a DataProvider says what it can do
//                    (canEvaluateSQL, canMaterialize, canSort), and the session reads it before every sorted window
```

And what a host provider ANSWERS is public too: a rejection may carry no `detail` (it is optional), so every lint door falls back to the typed `reason` rather than printing `undefined` where a sentence belongs.

### A landing is judged against the declaration — a document is never a table by accident

**A def that names columns for a table has said what that table is. Bytes that arrive carrying NONE of them are not a missing column — they are not this table**, and the door that landed them says so instead of building a dashboard over them (`./declaredTable.ts` · `notTheDeclaredTable`). The measured defect: a `csv` source pointed at a protein structure file built a 2,090-row table whose one column was named after the file's `HEADER` line, and nothing anywhere refused it. The carrier's half of the law — what the server SAID about the bytes — is in [`../source/README.md`](../source/README.md); this is the half the declaration can answer, and it is the only real evidence there is, because a decoder cannot tell a one-column CSV from a text file.

It follows the landing law this file already keeps ([`./wasmBackend.ts`](./wasmBackend.ts), law 3): **a failure is a sentence and a refused read, never a throw that loses the tables that did land.**

```ts
const def = { data: { cells: { source: { format: 'csv', via: 'http', at: url }, columns: { state: …, cases: …, /* nine of them */ } } }, actors: { … } };
const dash = await buildDashboardAsync(def, { sources: [httpSource()] });

dash.notes;
// [ 'data["cells"]: the csv source landed 2,090 rows and none of the columns this table declares —
//    declared "state", "disease", …, arrived "HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7              ".
//    A document is never a table by accident, so nothing vouches for these bytes: every read of "cells" is
//    refused in these words. Point the source at this table's own data, or declare the columns these bytes carry.' ]
dash.sources['cells'];                      // undefined — nothing vouches for bytes that are not the declared table
dash.engines['cells'];                      // 'memory' — the def's own routing is still reported
await session.viewQuery({ table: 'cells' }); // { ok: false, reason: 'engine', engineReason: 'unknown-table', rejected: <that sentence> }
(await dash.refresh(['cells'])).tables['cells'];
// { refused: true, reason: 'not-the-declared-table', message: 'data["cells"]: <that sentence>' }
```

The refusal is judged BEFORE the rows reach an engine, so no backend is opened for them and a refresh that meets a route which started answering another table leaves yesterday's rows exactly where they are. The read refuses through `unlandedProvider` — a provider this folder owns, because no engine could produce this verdict.

**Four things it deliberately does not judge**, each the same reason — refuse a contradiction, never ignorance:

| what arrives | the verdict | why |
|---|---|---|
| SOME of the declared columns | accepted, byte-identical | today's law: the read door narrows a clause over a column the table lacks (`../session/clausesReaching.ts` · `narrowedByDef`) and `learnLanded` records what actually arrived |
| a def that declares NO columns | accepted, byte-identical | nothing was said, so nothing is contradicted; the landed registry learns whatever came (`../data/landedColumns.ts`) |
| no columns at all (no rows) | accepted | a header-only CSV IS this table with nothing in it; "no columns" is this library not seeing them |
| an INLINE source | never judged | the payload is the def's own text, judged with the rest of the def — and `buildDashboard` refuses every non-inline source, so a rule that fired on inline bytes would make the two doors answer one def differently |

The arrived names are the engine's own rule for them and never a second copy (`../data/memoryProvider.ts` · `columnNamesOf`): a refusal that quoted names the engine disagrees with would be a refusal about a table nobody has.

## What fits, before a build

`whatFits` (the encoding plane's door, re-exported here beside `fitsFor`) answers "which column may sit on which channel" without building anything. `whatFits.def.test.ts` pins it against this door's own lint, column by column and channel by channel. See [`../encoding/README.md`](../encoding/README.md).

## Relations — the edges between tables

A def declares its tables as `data: Record<string, DataSourceDef>`, and each table may name its row identity (`key`). `relations` is the one place two tables are joined: an edge from a column of one table to the **key** of another. Relations are data on the MAP — the overview echoes them (`overview().relations`, the `relations` part of `whats_here`), and three things in the session act on them: an analysis may read across a declared edge and no other way (law 6), the `neighbourhood` selection kind walks a pair of them (law 7) rather than inferring a join from the rows, and a clause reaching a view whose table lacks its column TRAVELS the edge — a semi-join for a point, interval, match or cell clause; a walk by its recorded ids — the map writes the relation on the link edge (`../links/README.md`, `LinkEdge.via`) and the session folds it (`../session/README.md`, "A clause travels a relation").

```ts
data: {
  nodes: { source: …, key: 'disease', columns: { disease: { role: 'identifier' }, cases_total: { role: 'measure' } } },
  edges: { source: …, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
},
relations: [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' } },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'disease' }, label: 'the other end' },
],
```

Seven laws. The door does not judge them in this order: per end it first asks that the table is declared (law 3) and only then judges the column on it (law 2) or the key it points at (law 1); self-join and repeat (law 3) and `kind` / `label` (law 4) come last; law 5 is a runtime fact, not a door law.

1. **A relation points at an identity.** `to.column` must be the declared `data[to.table].key`. A table with no key has no identity to point at, and the sentence says what to declare first:
   ```
   relations[0].to "cells.disease" — declare data["cells"].key first; a relation points at an identity
   relations[0].to.column "cases_total" is not the key of "nodes" — the key is "disease"; a relation points at an identity
   ```
2. **The source column is judged where it can be.** When `data[from.table].columns` is declared, `from.column` must be one of them — the same conditional as `key`. A table that declares no columns is judged post-build by `dashboard.lintData()`, against the columns the engine lists, exactly as a key is:
   ```
   relations[0].from.column "ghost" is not a declared column of "edges"          ← the door
   relations[1].from.column "ghost" names no column of "cells" — the columns are disease, jurisdiction, cases   ← lintData
   ```
3. **Both tables are declared; no self-join in this version; an edge is declared once.** The edge is spelled `from.table.column → to.table.column` (`relationEdgeId`):
   ```
   relations[0].from.table "ghost" is not a declared data table — the tables are cells, nodes, edges
   relations[0] joins "nodes" to itself — not in this version
   relations[1] repeats the edge edges.source → nodes.disease
   ```
4. **`kind` is declared, never inferred, and defaults to `many-to-one`**; `label` is prose, inert. The runtime writes the default out (the materialized-links precedent) and types the result as `RelationEdge` (`kind` required), so a reader never re-derives it:
   ```ts
   (await session.overview()).relations[0].kind;   // 'many-to-one' — the def left it out
   ```
   ```
   relations[0].kind must be one of many-to-one|one-to-one
   relations[0].label must be a string
   ```
5. **Relations are data on the map.** `DashboardRuntime.relations` is frozen at build (`[]` when none); the overview and `whats_here` echo that object; the revision moves when an edge is added, because an edge is part of the declaration.
6. **A relation is a PERMISSION to read across.** An analysis may name tables it reads BESIDE the one it runs over (`AnalysisDef.reads`) — a layout on `nodes` needs `edges` — and `declareAnalysis` grants it only where a declared relation joins the two, in either direction. There is no other way to reach a second table, and the refusal is a sentence, filed as an ordinary `guard-failed` gap with nothing landed:
   ```ts
   defineAnalysis({ id: 'layout', kind: 'transform', produces: 'columns', inputs: [], reads: ['edges'], /* … */ });
   await session.declareAnalysis('layout', { table: 'nodes' });   // permitted by `edges.source → nodes.disease`
   ```
   ```
   analysis "layout" reads table "edges", which no declared relation joins to "nodes" — declare the relation first
   analysis "layout" reads table "ghost", which is not a declared data table — the tables are cells, nodes, edges
   analysis "layout" reads table "nodes", which is the table it already runs over — `reads` names the tables BESIDE it
   analysis "layout" runs over table "ndoes", which is not a declared data table — the tables are cells, nodes, edges
   ```
   The last two are the pair's own halves. A read of the analysis's OWN table gets its own sentence, because no relation may ever join a table to itself (law 3) and "declare the relation first" would be advice this door refuses; and the table the analysis RUNS OVER is judged first and alone, because a pair whose left side is not a table has no relation to declare, and blaming the read would quote a table that is perfectly good.
   The judge is `judgeAnalysisReads` (`./relations.ts`) — the pair is not known until the act names its table, which is why this law is enforced at the session door and not at this one. What the analysis then SEES is the session's to say: the related rows are read at the cursor, under that table's own clauses (`../session/README.md`).

7. **Two relations at ONE identity are an EDGE — and that is what a neighbourhood is walked over.** `neighbourhoodEndpoints(relations, table, column)` answers the pair of endpoint columns for the end a gesture named, in DECLARATION order, so a walk from either end lands the same bytes. An edges table pointing twice at one key is two relations, which is legal (neither joins a table to itself); anything else is refused in a sentence that quotes what is known:
   ```ts
   neighbourhoodEndpoints(relations, 'edges', 'target');   // { fields: ['source', 'target'] } — the order they were declared in
   ```
   ```
   table "cells" declares no relation, so "disease" is not an endpoint — a neighbourhood is walked over an edge, and an edge is two columns naming one identity
   "edges.weight" is not an endpoint — the endpoints of "edges" are source, target
   "edges" names "nodes.disease" through one column (source) — a neighbourhood walks an edge with exactly two ends
   "edges" names "nodes.disease" through 3 columns (source, target, via) — a neighbourhood walks an edge with exactly two ends
   ```
   The reader is directional the way law 6's `joinsTables` is not: a permission to READ across an edge runs both ways, but the two ENDS of one edge are columns of the same table, and only relations pointing at the same `(table, key)` are the same edge. What the walk then does with the pair — read the rows at the cursor, land ONE commit carrying the question and its answer — is the session's to say (`../session/README.md`, "One gesture on a node").

The shape sentences, for completeness: `relations, if present, must be an array of { from, to }` · `relations[i] must be an object { from, to, kind?, label? }` · `relations[i]: unknown key "x"` · `relations[i].from must be { table, column } with non-empty strings` · `relations[i].from: unknown key "x"` (an end is exactly those two keys, and an extra one is named, the way a relation's is). A table refused on its own line (`data["bad"] must be an object …`) is not refused again through a relation at either end; the empty table map is refused on its own line and no relation is judged against it.

## A table filled by an act — two doors for a computed table

A `data` entry with no `rows`, no `csv` and no `source` used to be refused — right for a table that will never have rows, wrong for a table whose rows come from a computation. `filledBy` is the fourth way rows arrive, and the only one with no carrier:

```ts
data: {
  nodes: { rows: NODES, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
  edges: { filledBy: 'buildEdges', columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
},
analyses: { buildEdges: /* any declared analysis whose channel is `table` */ },
relations: [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' }, label: 'one end of the tie' },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' }, label: 'the other end' },
],
```

> **A table may be declared with no carrier and filled by an act. Its columns, its key, its absence vocabulary, its grain and its relations are declared exactly like any other table's; the only thing it gets from the computation is rows. Until the act lands them it is unlanded, and a read of it is refused in the words the library already has. Nothing about it is inferred from the rows that arrive.**

**Its `columns` are REQUIRED**, and they are the only thing this door asks for that a carrier table may leave out. Three questions are deferred from this door to a post-build one exactly WHEN a table declares no columns — its `key`, a relation's `from.column` (law 2 above) and a binding on it (`dashboard.lint()`) — and all three are then judged against the columns the ENGINE lists. A table with no carrier has no rows to ask, so that door can never answer: requiring the declaration is what makes this one their single owner, and what makes the arrived-columns guard below real evidence.

That def is the whole edge-table capability: `edges` is related to `nodes` **twice**, once per endpoint, which is law 7's pair — so a clause on the nodes view travels into the computed table as a semi-join, a `neighbourhood` walked over the computed edges travels back to the nodes by identity, `viewQuery` reads it, and a click on one of its rows means something. None of that is new code; all of it follows from the table being DECLARED.

**The two relations are not used the same way, and this is the one thing to know before you declare them.** A clause travels **the first declared relation whose far column the table has** (`../session/README.md` · the semi-join) — *one* of them, not both. So selecting a node narrows `edges` to the rows where that node sits at **that one end**, and a row where it sits at the other end is filtered OUT rather than kept: pick `cold`, and `{ source: 'warm', target: 'cold' }` does not survive. Swap the two relations in the declaration and the same click answers differently. A `neighbourhood` is the opposite — it travels the **pair** together, in declaration order, which is why a walk over the edges reaches the nodes at both ends.

Declare first, therefore, the endpoint you want a selection to MEAN. If what you want is "every edge this node touches", that is one clause over two columns and this door does not spell it — say so where the reader is, and treat it as a gap rather than assuming the semi-join covers it.

**Two doors, two questions.** A derived table has another door, and it answers something else:

| | the act's table is | its relation to the parent is | reach for it when |
|---|---|---|---|
| `analyses: { agg: { builtin: 'aggregate', name: 'by_disease', groupBy: ['disease'], measures: […] } }` | **minted** — the library names it, keys it by the one group column and mints `cells.disease → by_disease.disease` from the grouping | **minted** | the table is a fold of one parent and nobody needs to name it: a summary you group, read and throw away |
| `data: { edges: { filledBy: 'buildEdges', columns, key } }` | **declared** — you name it, its columns, its key and its absence vocabulary | **declared**, in `relations`, judged at this door like every other | the table has a shape a person has to be able to name — more than one relation, a key that is not a group column, an absence vocabulary, a grain, a layer drawing it |

The aggregate's own declaration states the objection this door has to answer: *a record that could name its own relation could name one nobody declared.* It is correct, and `filledBy` does not weaken it — it answers it. The relation is not on the record. It is in the def, beside every other relation, judged by the same validator. What arrives from the act is rows and nothing else.

**Unlanded is a state, not an error.** Before the act runs the table has a provider that refuses every read in one sentence, and the sentence names the act, because the act is the repair:

```
"edges" declares no carrier — the act "buildEdges" fills it, and it has not landed on this path: every read of
  "edges" is refused in these words. Perform "buildEdges" to fill it — it takes the act's rows only if they
  carry the columns this table declares; its columns, its key and its relations are declared, and do not
  wait for it.
```

The repair is stated as what it is and not as a promise: an act whose answer carries none of this table's columns is refused at the landing (below), so "perform it and the rows arrive" would be a sentence that can be wrong.

The same sentence answers a read at a cursor the act's commit is not on — "on this path" is doing real work. A fill gets a **slot per act** (`../data/filledTables.ts`), like a derived column and a derived table, so two branches that filled one name keep their own rows; the declared name resolves to the slot on the branch whose act landed it, and to the refusing provider everywhere else.

And a table whose rows **landed and were withdrawn** says that instead, because it is a different history with a different repair:

```
"edges" declares no carrier — the act "buildEdges" filled it, and the rows it landed were withdrawn when
  "nodes" was refreshed: every read of "edges" is refused in these words. They were computed from data that
  no longer exists, so nothing serves them; perform "buildEdges" again to fill it from the data as it stands.
```

The def door's seven refusals, each naming both sides:

```
data["edges"] must set only one of rows, csv, source, filledBy
data["edges"].filledBy must be the id of a declared analysis — it is "42"
data["edges"].filledBy "buildEdges" — declare data["edges"].columns first; a table with no carrier has nothing but its declaration, and its columns are what its key, its relations and every binding on it are judged against
data["edges"].filledBy "ghost" is not a declared analysis — the analyses are buildEdges, summary
data["edges"].filledBy "pull" produces the columns channel, not a table — only a table-channel act can fill a table
data["edges"].filledBy "agg" is an aggregate — an aggregate mints the table it lands, with its own key and its own relation to its parent, so it never fills a declared one
data["other"].filledBy "buildEdges" already fills data["edges"] — an analysis fills at most one table
data["edges"] is filled by the act "buildEdges", and the aggregate "agg" mints a table of the same name — one name, one owner
data["edges"] sets engine "wasm" with filledBy; an act's rows are computed in this process, so an act-filled table declares "memory" — or no engine at all
```

The channel is read before anything is built, off the one spec table for a builtin record and off the def for a module or a raw `AnalysisDef` (`./actFilled.ts` · `channelOf`; the column is pinned to the factories by `builtinAnalyses.test.ts`). A slot this door cannot read says nothing here — it is already refused on its own line, and a second sentence about the same slot would be noise.

And the rest of the law, in the three places it shows up:

- **What arrives is judged.** The rows the act lands are measured against the declaration by the guard that already answers this for a carrier (`./declaredTable.ts` · `notTheDeclaredTable`): zero overlap is *not the declared table*, the rows are not landed, and the act files the sentence as its own gap. A partial mismatch is today's law, unchanged. Only the ROWS are judged, never the answer's `schema`: a `schema` is optional on a table answer, so judging it would give two acts landing byte-identical rows two different verdicts. The answer's own `name` is ignored for the same reason the rest is — the def says which table this act fills, and nothing about the table is inferred from what arrives. (Which is also what lets an analysis written for nobody in particular fill a table it has never heard of.)
- **A refresh does not move it.** `dashboard.refresh()` moves carriers, and there is none: `{ refused: true, reason: 'no-source', message: 'data["edges"] declares no source — the act "buildEdges" fills it, and an act is performed, never refreshed' }`. A refresh of its PARENT is different: the rows were computed from bytes that no longer exist, so they are dropped and reported (`RefreshOutcome.filledLost`, the twin of `derivedLost`) and the table is unlanded again, saying so at every read. **Every generation goes, whichever registry it lives in** — a fill of a fill, a fill of an aggregate, an aggregate cut from a fill — because the two stores are cleared as a FIXPOINT and not level by level (`./buildDashboard.ts` · `dropComputedFrom`; the three shapes are pinned in `../session/actFilledTable.test.ts`).
- **A replay rebuilds the rows, which were never in the log.** The commit carries the act and the table it read; the rows are recomputed from the declaration over the parent as it stands (`landsOutsideTheLog`). A recomputation that produces another channel refuses in the replay's existing words.

The Sources rows (`overview().tables`) say what is true of it and claim no carrier — no `via`, no `version`, no locator — and say the three things that are: `source: { computed: 'act', by: 'buildEdges', landed: true, at: 's7' }`. `landed` moves with the cursor, for the reason a derived row appears and disappears: a fill belongs to the branch whose act made it. `at` is the COMMIT that filled it, present exactly when it has landed — the row's dating fact, without which a reader could not tell which run landed the rows they are reading (a carrier arm dates itself with a version, and the minted row with `derived.at`).

## Layers — a view over more than one table

A view has no table of its own: the session gates every act on its single default table. A node-link is two marks on one frame — edges under nodes — and each reads a **different** table. `layers` on a view's encoding declares that: each layer names its table, its own encoding surface, and an act on a layer lands under the address `viewId~layerId`. A view that declares no layers is byte-identical to a view built before layers existed — no key appears anywhere.

```ts
data: {
  nodes: { rows: …, key: 'id', columns: { id: { role: 'identifier' }, size: { role: 'measure' }, group: { role: 'dimension' } } },
  edges: { rows: …, columns: { source: { role: 'dimension' }, target: { role: 'dimension' }, weight: { role: 'measure' } } },
},
actors: { net: { actor: 'user', label: 'Disease network' } },
encodings: [{
  viewId: 'net', chartKind: 'network', channels: ['x', 'y'],
  layers: [
    { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], initial: { size: 'size', color: 'group' }, label: 'Diseases' },
    { layerId: 'edges', table: 'edges', chartKind: 'line',  channels: ['x', 'y', 'size'], initial: { size: 'weight' } },
  ],
}],
defaultTable: 'nodes',
```

Six laws.

1. **The address is `viewId~layerId`, and `~` has one owner.** `layerAddress('net', 'edges')` → `'net~edges'`; `splitLayerAddress('net~edges')` → `{ viewId: 'net', layerId: 'edges' }`; a plain viewId splits to `{ viewId }` alone. The marker is spelled in `layerAddress.ts` and nowhere else — a test greps `src/` and `ui/src` for the literal and fails on any other file. The address reads as a viewId everywhere a viewId is accepted (the log, the fold, the tools); only the session's table guard and the overview split it.
2. **A marker in any id is refused.** The split is at the first marker, so a viewId, a layerId or a table name carrying one would name something it did not declare:
   ```
   actors["net~nodes"]: a view id "net~nodes" may not contain "~" — it is the layer marker
   data["a~b"]: a table name "a~b" may not contain "~" — it is the layer marker
   encodings[0].layers[0].layerId "a~b" may not contain "~" — it is the layer marker
   ```
3. **A layer names its table, and the table is DECLARED — as data, or as the act that mints it.** `table` is required (a layer exists to name one) and, unlike a view's default table, is never inferred. It may be a key of `data` **or** the `name` of a declared analysis that lands a table — an `aggregate` names the table it lands, the group columns that become its columns and the measures that follow them, so a minted table's name and whole column list are known at declaration time. A definition that declares the act has already declared the table; refusing the chart over it would be the door failing to read what the definition says. A table that is neither is refused in a sentence naming **both** sets:
   ```
   encodings[0].layers[0].table must be a non-empty string — a layer exists to name its table
   encodings[0].layers[0].table "ghost" is not a declared data table, and no declared analysis mints it — the tables are nodes, edges; the acts mint sizes_per_group
   encodings[0].layers[0].table "ghost" is not a declared data table, and no declared analysis mints it — the tables are nodes, edges; no act mints one
   ```
   ```ts
   analyses: { sizesPerGroup: { builtin: 'aggregate', table: 'nodes', name: 'sizes_per_group', ops: 1, groupBy: ['group'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'size' }] } }] } },
   encodings: [{ viewId: 'net', chartKind: 'bar', channels: ['x', 'y'], layers: [
     { layerId: 'bars', table: 'sizes_per_group', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'group', y: 'total' } },
   ] }],
   ```
   `mintedTables(def)` (`./builtinAnalyses.ts`) is the ONE owner of *which table names an act lands* — name → `{ analysisId, columns, key? }`, read off the declaration — so this law, the field law below and the probe door cannot disagree about the same definition. There is deliberately **no `{ computed: … }` source in `data`**: `DataSourceDef` is the carriers, a minted table has no carrier, and a table declared twice — once as a promise, once as the act that keeps it — would have two owners. The act is the owner. For the same reason a `relation` still names declared tables only: an aggregate MINTS its edge back to its parent from its key, and a declared one would be a second owner. `defaultTable` is also declared-only — it is the dashboard's ground, resolved to a provider at build, before any act can have landed.

   **When it exists is a different question, and the PROBE door answers it per cursor.** A minted table appears where its act landed, so a view drawing one is refused — while it is not here — as its own typed gap naming the act, in `viewQuery`'s voice:
   ```
   needs-act   view "bars~agg" draws "by_disease", which the act "byDisease" mints — it has not landed on this path
   ```
   That is the honest replacement for declaring such a view `canProbe: false`: the view keeps its voice, and the door says why it cannot speak yet. It is `needs-act` and not `guard-failed` because the repair is to perform the act, not to re-read the definition — and it comes back after a seek back past the act.
4. **A layerId is declared once within its view.** Two views may each have a `nodes` layer (`a~nodes`, `b~nodes` are different addresses); one view may not:
   ```
   encodings[0].layers[1].layerId "nodes" repeats within view "net"
   ```
5. **A layer's bindings are judged against ITS table.** The build door runs the encoding validator once per layer with the layer's table's declared columns — or, on a MINTED table, against the act's declared columns (`groupBy` in order, then the measures as they land), **typed** by law 5a below. `lint()` has no provider to ask for such a table and judges it when the act lands — a role declared on the nodes table refuses on the nodes layer and says nothing on the edges layer, where the def declares no such column; `dashboard.lint()` then judges each layer against the columns its own table's provider lists, under the layer address. The view-level `initial` is judged against the default table exactly as before:
   ```
   encodings[0].layers[0].initial.size: "id" is identifier — it cannot be the size of a point     ← the door
   { viewId: 'net~nodes', channel: 'size', field: 'weight', sentence: '"weight" is not a column of the table' }   ← lint()
   lint: the "edges" provider cannot list its columns — …                                          ← a layer's table that cannot answer
   ```
   The FACETS are the layer's table's; the PAGE is the whole dashboard. A `dashboard`-scope business rule (the default scope for `never-together`) means *anywhere on the page*, so it reads every view's bindings and every layer's, side by side — the boundary between a frame and its layers is not a hiding place. `boundElsewhere` compares field NAMES, so nothing about the two tables has to be unified for this to hold:
   ```ts
   encodingRules: { rules: [{ rule: 'never-together', columns: ['size', 'weight'] }] }
   // size on the nodes layer, weight on the edges layer of the SAME frame:
   encodings[0].layers[0].initial.size: "size" and "weight" never share the page
   encodings[0].layers[1].initial.size: "weight" and "size" never share the page
   ```
   It cuts both ways: an `only-with` companion bound on a SIBLING layer counts as present under `scope: 'dashboard'` and refuses nothing. A `scope: 'view'` rule still means this surface alone — a sibling layer is not "here".

5a. **A MINTED column has a TYPE, and the declaration already knows it.** `mintedTables(def)` (`./builtinAnalyses.ts` — the ONE owner) answers each minted column as `{ name, type }`, so the encoding door judges a minted column exactly as it judges a declared one and a channel that needs a number meets a minted string AT THE DOOR instead of when the act runs. Three rules, and nothing new is declared anywhere:

   - **A group column keeps the parent table's declared type.** `groupBy: ['disease']` over a `cells` table that declares `disease: { type: 'string' }` lands a minted `disease` that is a string — so a bar's magnitude bound to it earns `"disease" is string; the y channel of a bar needs a number`, the same sentence the declared column has always earned. **No new vocabulary:** a minted column's refusals ARE its type's refusals.
   - **A measure takes what its reducer yields.** `../derive/ops.ts` declares a `yields` per op. `count`, `countDistinct`, `sum` and `mean` yield a number, so `{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }` lands a number **whatever it totals** — even over a column the parent never typed. `min` and `max` yield `'args'` — the type of what they reduce — so `min` over a declared `date` lands a date, and `max` over a declared number lands a number.
   - **Where the parent did not say, the answer is `unknown`.** A group column the parent never typed, a `min`/`max` over such a column, a measure over a column the parent DERIVES (its type is its own act's answer, and it is not in `DataSourceDef.columns`), or any tree the reader cannot settle without running it — `{ op: 'if', … }` whose two arms disagree, say — is `unknown`. `unknown` keeps its present meaning at every door: **not judged**. It is the pre-existing escape hatch, deliberately still reachable, because a guess here would be worse than the gap it fills:
   ```
   groupBy: ['disease'], measures: [{ as: 'oldest', expr: { op: 'min', args: [{ col: 'murk' }] } }]   // `murk` declared with no type
   → minted: [{ name: 'disease', type: 'string' }, { name: 'oldest', type: 'unknown' }]
   → a bar's y bound to `oldest` is ACCEPTED — refused on evidence, never on ignorance
   ```
   THREE laws read these types, and each keeps its own existing sentence: the per-layer encoding validator above; law 11's logarithm (`transform "log" needs a number — layer "agg" binds y to "disease", a string`); and law 10's shared scale, where a minted number and a declared string on one axis now disagree out loud (`... but y is a number on "agg" and a string on "raw"`) instead of meeting at render time. What a minted column still has **no way to declare** is FACETS: no role, no scale, no label, no unit, because it has no `ColumnDecl` — a rule that needs one simply does not match it. A reader that wants only the names says so with `mintedColumnNames(table)`, a function over the one list rather than a second copy of it.
6. **The resolved layers are data on the view.** `ViewDecl.layers` is the declared list, frozen at build, present only when the def declared it; the session's `tableFor(address)` reads the layer's table off it, and the overview projects `views[].layers`.

6a. **THE FRAME IS ITS LAYERS — a layered view's own address is a node of the link graph only when it reads rows there.** A node of the link graph is a place that reads rows. A layered view's own address reads the default table only when the view binds something at its own level — a non-empty view-level `initial` (law 5: judged against the default table exactly as before). Otherwise the frame is its layers: the map lists the view as a FRAME (`LinkView.frame`, the layer addresses that read for it, in declaration order — never beside `table`), the default rule mints no edge into or out of it (`../links/materialize.ts` — and records nothing under `declined`, since a frame is not a refused edge, it is not a node that reads), and a declared edge naming it is refused at this door with the layer addresses to use. Nothing is inferred at read time: `clausesFor`, `why()` and `narrowedFor` follow the map for free, and a gesture landed AT a frame is refused by the session in words naming its layers (`../session/README.md`, "A clause a table cannot judge"), and so is a window read at its bare address (`viewQuery`/`findInView`, refusal code `frame`, the same sentence with "a window is read under one of them"). ONE owner of the question, asked by both twins that write a view's node: `layers.ts` · `readsOwnTable` (through `ownRowsOf`). WHY the node is LISTED and not dropped: the map says what a view IS — a reader of the graph still finds the view under its own id, with its readers beside it; a view missing from `views` would read as undeclared, a different and false sentence. Found on the real exoplanet desk: a scatter whose one layer reads `planets` and whose own surface binds nothing was a node over the default table `measurements` — a table that address never draws — so the crossfilter minted edges into it, the read narrowed them, and the chip said the chart read a table it never read.
   ```ts
   data: { measurements: { rows: …, key: 'id', columns: { id: …, planet: …, radii: … } }, planets: { rows: …, key: 'planet', columns: { planet: …, mass: …, radius: … } } },
   actors: { mass_radius: { actor: 'user', label: 'Mass vs radius' }, sheet: { actor: 'user', label: 'Measurements' } },
   encodings: [{ viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'],       // no view-level `initial`: the scatter binds nothing of its own
     layers: [{ layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'mass', y: 'radius' } }] }],
   defaultTable: 'measurements',
   // overview().links.views → [{ viewId: 'mass_radius', voice: [...], frame: ['mass_radius~planets'], channels: ['x', 'y'] }, { viewId: 'sheet', voice: [...], table: 'measurements' }, { viewId: 'mass_radius~planets', voice: [...], table: 'planets' }]
   // overview().links.edges → sheet ↔ mass_radius~planets only; no edge into or out of mass_radius, and no `declined` entry for it
   links: [{ source: 'sheet', kind: 'point', target: 'mass_radius', response: 'highlight' }]
   // links[0].target "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets
   // (…and `.source` in the same words when the frame is the source; a `link` dispatch at run time meets the same sentence as `link sheet:point→mass_radius.target …`)
   encodings: [{ viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'radii' }, layers: [ … ] }]
   // with a view-level `initial` the scatter reads `measurements` at its own address: `table: 'measurements'`, no `frame`, and the edges as before
   ```

6b. **A layer's declared bindings RIDE THE FOLD, under the layer's address.** The frame is its layers for the encoding plane too: the session's `reencode` fold is keyed by ADDRESS, and a layer's `initial` seeds it under `viewId~layerId` exactly as a view's does under the view's id — so the host that draws the layer reads its axes where every other binding is read, instead of carrying them as literals of its own. Nothing moves them afterwards (`reencode` at a layer is refused, and no commit is ever seeded for a declared binding), so a seek restores them by leaving them alone. Beside them the plane's verdicts are judged against the LAYER's table, and a frame carries none of its own — it draws no rows to be judged (`../session/README.md`, "The fold knows the layers' bindings").
   ```ts
   encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'],
     layers: [{ layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], initial: { size: 'size', color: 'group' } },
              { layerId: 'edges', table: 'edges', chartKind: 'line', channels: ['x', 'y', 'size'], initial: { size: 'weight' } }] }]
   // session.viewEncodings('net~edges')       → { size: 'weight' }        (and 'net' → {}: a frame binds nothing of its own)
   // overview().encodings                     → { net: {}, 'net~nodes': { size: 'size', color: 'group' }, 'net~edges': { size: 'weight' } }
   // overview().views[0].layers[1].fits.y     → [{ field: 'weight', ok: true }, { field: 'source', ok: false, because: '"source" is string; the y channel of a line needs a number' }, …]
   //                                            — the EDGES table's columns, judged on the edges layer's own channels; `views[0].fits` is absent (a frame)
   ```

6c. **A GRAIN IS DECLARED WHERE THE MARKS ARE — a frame declares none, and each of its layers declares its own at its address.** A grain is the group keys a node's MARKS stand for (`../links/README.md`, "Grain and fold"), so it belongs to the place that draws them: `grains[].viewId` may be a LAYER's address — an address is a viewId everywhere a viewId is accepted — one grain per address, and a view that binds at its own level draws marks of its own and keeps its view-level grain exactly as before. A FRAME draws nothing, so it declares nothing: a grain there is refused at this door with the addresses that DO draw, the same remedy law 6a gives an edge that named one. WHY not "a layer inherits its frame's grain": the network's `['disease']` describes the CIRCLES, and the ties layer's marks are ties — inheritance would invent a claim about the edges, and choosing one layer to hand it to would be arbitrary. Nothing is inferred at read time either: the grain rides the layer's own node of the link graph (`layers.ts` · `layerLinkViewOf`), `../links/grain.ts` · `crossesGrain` reads the nodes as it always did, and the feature card reads the same address (`features.ts` · `layerFeatureOf`). So a default edge from a map over jurisdictions into a nodes layer over diseases is written out with `fold: 'crossfilter'`, while one into the ties layer beside it — where nothing is declared — carries none (refuse on evidence, never on ignorance). Found on the real disease desk: the map used to state that crossing on `map:point→net`, and once law 6a made `net` a frame no edge touched it any more — so the crossing the picture really makes was stated nowhere.
   ```ts
   encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'],   // no view-level `initial`: `net` is a FRAME
     layers: [{ layerId: 'edges', table: 'edges', chartKind: 'network', channels: ['source', 'target'], … },
              { layerId: 'nodes', table: 'nodes', chartKind: 'network', channels: ['x', 'y', 'key'], … }] }],
   grains: [{ viewId: 'map', keys: ['jurisdiction'] },            // a bar per place — a view that draws its own marks, unchanged
            { viewId: 'net~edges', keys: ['source', 'target'] },  // one tie per pair of diseases
            { viewId: 'net~nodes', keys: ['disease'] }],          // one circle per disease
   // overview().links.views → { viewId: 'net', voice: [...], frame: ['net~edges', 'net~nodes'], channels: ['x', 'y'] }   — no `grain`: a frame declares none
   //                          { viewId: 'net~nodes', voice: [...], table: 'nodes', grain: ['disease'] }
   // overview().links.edges → `map:point→net~nodes` carries fold: 'crossfilter'; an edge from a view over ['disease'] into it carries none
   grains: [{ viewId: 'net', keys: ['disease'] }]
   // grains[0].viewId "net" is a frame that draws no marks of its own — declare the grain where the marks are: net~edges, net~nodes
   ```

### The frame — layers share their scales, and the frame owns them

A stack of layers is one picture only if it is read on one set of scales ("scales are common across layers" — Wickham). `frame` on the view's encoding says how, **per channel**, and says it in words: `{ mode: 'shared' | 'independent' }`, plus `domain: 'union'`, `basis: 'table' | 'rows'`, `guide: 'merged' | 'per-layer'` and `zero` on a shared one, and `transform: 'linear' | 'log'` and `zeroGuide` on either (laws 11 and 12 — neither a transform nor a zero guide is a resolution, and both are legal on a view with no layers at all). **No number can be typed into it.** The domains are folded from the rows by `frameDomains` (`vizfootprint/def` — the door that re-exports the encoding plane, PACKAGING.md, Law 1) at every update, so an axis can never disagree with the data under it, and a channel the frame does not name is `shared / union / table / merged` — the default that makes a stack one picture.

```ts
encodings: [{
  viewId: 'trend', chartKind: 'bar', channels: ['x', 'y'],
  layers: [
    { layerId: 'bars',  table: 'weekly', chartKind: 'bar',  channels: ['x', 'y'], initial: { x: 'week', y: 'cases' } },
    { layerId: 'trend', table: 'weekly', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'week', y: 'fitted' } },
  ],
  frame: {
    x: { mode: 'shared', basis: 'table' },            // SHARED, fixed: the axis does not move when a filter lands elsewhere
    y: { mode: 'shared', zero: true, guide: 'merged' }, // SHARED, one baseline, ONE axis drawn by the frame
    color: { mode: 'independent' },                    // INDEPENDENT: each layer legends its own categories
  },
}],
```

One example per mode, in one sentence each: **shared / basis `table`** — the union over the whole table's rows at the cursor, so a selection in another view repaints the marks and leaves the axis where it was (vgplot's `Fixed`); **shared / basis `rows`** — the union over just the rows this frame draws, so the axis breathes with every selection; **shared / guide `per-layer`** — one domain folded, each layer still drawing its own axis (two units, honestly labelled twice); **independent** — no domain at all, each layer on its own scale and its own guide.

Six more laws (7 through 12; the count had gone stale at "four", so it is spelled out).

7. **A frame declares resolution for LAYERS — and `mode` is the ONE key that needs them.** A transform is not a resolution, and the frame owns both: `mode` asks "do these layers share a scale", which is meaningless with one layer, while `transform` and `zero` ask what the AXIS IS, which a plain scatter needs exactly as much as a stack does. So the frame is legal on ANY view and the refusal narrows to the one key. An independent channel still has no domain, no basis and no zero policy to apply:
   ```
   encodings[0].frame.y.mode: view "net" has no layers, so there is nothing to resolve — drop "mode" and keep the axis keys
   encodings[0].frame.y: unknown key "logged" on an axis
   encodings[0].frame.y.mode must be "shared" or "independent"
   encodings[0].frame.y.domain, if present, must be "union" — a frame declares a fold, never numbers
   encodings[0].frame.color: unknown key "basis" on an independent channel
   encodings[0].frame.color.guide must be "per-layer" on an independent channel — there is no merged guide for scales that disagree
   ```
8. **A resolution names a channel the layers can bind.** The refusal spells the channels there are, so a typo is one read away from fixed:
   ```
   encodings[0].frame.z: unknown channel — the layers bind x, y, size, color
   ```
9. **A BAR MAY TAKE THE FIRST SCALE — the frame's LEFT edge, in declaration order — and nothing else zero-anchored may take a scale of its own at all.** The marks whose extent IS the quantity are read from one baseline: measured against a second axis, or off a cut one, a bar overstates a difference by exactly what was taken away. A line or a point encodes POSITION and may honestly zoom, which is why the law is about the marks and not about the channel — and why it holds for a `shared` channel drawn `per-layer` the identical reason it holds for `independent`: an axis of a layer's own, wherever the guide sends it, is a second scale. The `per-layer` half is gated on a SECOND layer: a lone bar under a per-layer guide draws its own ordinary axes (there is no second axis to refuse), which is why the same shape on a **one**-layer view is legal (law 7's `plain`, above).

   **The bar's promotion**, and its two edges: bars of a count on the left with a line of a rate on the right is the commonest two-scale figure there is, and it is honest in that ONE arrangement — the left axis is where a reader reads an extent from a baseline. So a `bar` layer may hold a y of its own when it is the FIRST layer declaring that channel; the SECOND scale, the right edge, stays a line's or a point's. Declaration order and not a `side` option, because the frame already hands its sides out in declaration order (`vizfootprint-ui/charts/VizFrame.tsx` · `layerGuides`) and a second knob would be a second owner. The promotion is the bar's alone: a **histogram** and a **boxplot** summarise a distribution on an axis of their own, neither reads as "this much, from zero" beside a second scale, and neither draws a y on a frame's edge in this version — so they keep the refusal they always had, word for word. One predicate owns which marks may do which (`mayTakeFirstScale`, `../encoding/frame.ts`) and one function owns the second-scale sentence (`firstScaleTakenRefusal`), because the frame that has to draw the figure refuses it in the SAME words (`vizfootprint-ui/contract/renderers.tsx` · `twoScalesRefusal`, law 2): a def the door accepts is never a frame the renderer refuses.
   ```
   encodings[0].frame.y: layer "counts" is a bar with a y of its own, but layer "means" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y
   encodings[0].frame.y: layer "counts" is a histogram — a histogram cannot take an independent y, its extent is read against one baseline
   encodings[0].frame.y: layer "counts" is a boxplot — a boxplot cannot take a per-layer y on a frame of more than one layer either, its extent is read against one baseline
   encodings[0].frame.y.zero is false but layer "counts" is a bar — its y is read from zero
   ```
   A bar's own magnitude channel that is NOT the frame's y — an independent `size`, an independent `x` — is no edge of anything (left and right are y edges), and keeps the original refusal too: *layer "counts" is a bar — a bar cannot take an independent x, its extent is read against one baseline*. The ZERO law stands whichever scale a bar takes: its own axis is anchored at zero even where the line's on the right is not, and `zero: false` beside it is still refused.

   ```ts
   // the classic figure, declared: bars of a count on the left, a line of a rate on the right
   layers: [
     { layerId: 'counts', table: 'weeks', chartKind: 'bar', channels: ['category', 'y'], initial: { category: 'week', y: 'count' } },
     { layerId: 'rate', table: 'weeks', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'week', y: 'rate' } },
   ],
   frame: { category: { mode: 'shared', guide: 'merged' }, x: { mode: 'shared', guide: 'merged' }, y: { mode: 'independent' } }
   // → the bars' count axis on the LEFT, from zero; the rate on the RIGHT; one band of weeks beneath,
   //   drawn once; and the frame's own sentence under the plot: the heights are not comparable across them.
   // Reverse the two layers and the door refuses it, in the sentence above.
   ```
   The zero half stops at the marks whose extent is read on a channel a layer BINDS (`zeroAnchorsChannel`, the one predicate the def door and the fold BOTH ask, so a refusal here and a domain there cannot disagree). A **histogram** is the exception it names: the channel a histogram layer binds is the axis its BINS sit on — a position — and its count axis is counted from the rows and never bound, so a histogram's bound channel is neither refused a `zero: false` nor anchored by default. Anchoring it would stretch an axis of ages from 30 down to 0 and leave a third of the plot empty; the count baseline stays at zero in the CHART that draws it.

   The zero DEFAULT has one owner (`zeroPolicyFor`): undeclared, the marks decide — a bar-like layer anchors the whole channel at zero and pulls the line above it down to the same baseline; a line/point stack takes the data's own union. It bites on the MAGNITUDE channel only: a bar drags no zero onto its own colour ramp. A `zero` on a channel that folds as a CATEGORY or a DATE is inert (the fold applies it to a quantitative union and nothing else) and is deliberately not refused: column types are the provider's, so the def door usually cannot prove which one a channel will fold as.
10. **A shared channel means one scale, so the columns the layers bind must agree.** Four facts, each its own sentence, each judged only where BOTH columns declare it (the door refuses on evidence, never on ignorance — which is also why a unit mismatch needs two declared units):
    ```
    encodings[0].frame.x: layer "b" shares x with layer "a" but x is a number on "a" and a date on "b"
    encodings[0].frame.x: layer "b" shares x with layer "a" but x is a measure on "a" and a dimension on "b"
    encodings[0].frame.x: layer "b" shares x with layer "a" but x is continuous on "a" and discrete on "b"
    encodings[0].frame.x: layer "b" shares x with layer "a" but x is in "cases" on "a" and in "mg/dL" on "b"
    ```
    `unit` is a new optional `ColumnDecl` / `ColumnFacet` fact — echoed verbatim, never parsed and never converted. It exists for this law: two columns that mean 'cases' and 'mg/dL' cannot share an axis however alike their numbers look.

    The BOUNDARY of laws 9 and 10: they are judged where a frame is DECLARED, and `frame: {}` is enough — every channel it does not name is judged under the shared default. A layered view that declares NO frame is judged exactly as it was before the frame existed, because that is what it is: a def written against 1.2, drawn by a host that folds nothing, each layer on its own extent. Declaring the frame is how a def asks to be held to these two.

    A last thing the fold does that no declaration can prevent, stated at `frameDomains` rather than left to be found: where the columns disagree and the def declared no types to catch it, the SCALE KIND is the first binding layer's, and a categorical fold NAMES every cell it is given — so a number on a category channel becomes the category `"7"`, while a string on a quantitative one is skipped. The two spellings of one disagreement therefore answer differently, which is the reason law 10 exists at the door.

11. **A logarithmic axis, and the three things a logarithm may not be asked to place.** `transform: 'linear' | 'log'` (default `'linear'`, base 10) says which CURVE a channel is drawn on. It rides on BOTH modes — an independent channel's per-layer scales are axes too — and on a layerless view it is one of the axis keys law 7 keeps. Three refusals, all about MEANING rather than data:
    ```
    encodings[0].frame.y: a logarithmic axis has no zero — drop "zero", or draw this channel linearly
    encodings[0].frame.y: layer "counts" is a bar — its y extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic
    encodings[0].frame.x: transform "log" needs a number — layer "planets" binds x to "discovered", a date
    encodings[0].frame.x.transform, if present, must be "linear" or "log"
    ```
    The bar/box half is read through `zeroAnchorsChannel` — the same one predicate law 9 asks — so this law and the zero law cannot drift, and so a **histogram's BIN axis stays legitimately logarithmic**: log-spaced bins are a real figure, and a histogram's count axis is never bound. The column-type half is judged only where the def DECLARES the facet (the `unit` precedent: refused on evidence, never on ignorance). An unknown word is refused rather than defaulted, because a typo that quietly drew a linear axis the author believes is logarithmic is the worst outcome of the four.

    **What the door CANNOT refuse: the cells.** A logarithm has no answer for 0 or a negative number, and WHICH cells those are is data, not declaration. So `frameDomains` folds the union over the POSITIVE cells and sets `excluded` on the domain — how many it could not place — following the law the absence work set: **exclude and count, never silently drop**. When nothing is placeable there is no domain at all (the existing "nothing folds" arm; an invented domain is a drawn lie) and the count still says how many were left out. `excluded` is a SEPARATE fact from a silence — a silence is a cell the data says nothing about, this is one the data speaks plainly about but a logarithm cannot place — and the two are deliberately never summed. `zeroPolicyFor` never anchors a logarithmic channel at zero: one predicate, asked once. The renderer is where a reader meets the number (`excludedNote`, `vizfootprint-ui/primitives/scales.ts`), because that is the picture the marks are missing from.

12. **ZERO IS A PLACE ON THE AXIS, AND A CHART MAY BE TOLD TO DRAW IT.** `zeroGuide?: boolean` asks for one line inside the plot where a signed scale crosses zero, so positive and negative read as two sides of an origin. It rides on BOTH modes and is one of the axis keys law 7 keeps on a layerless view, because it is the axis's own furniture — a Ramachandran plot (a backbone φ against ψ, each running −180…180, the reading being which QUADRANT a residue falls in) needs one on each axis, and so does any signed chart: a difference, a log ratio, a z-score, a residual.

    **Named for ZERO and not for the centre.** The middle of a domain is not zero unless the domain happens to be symmetric — φ runs −180…180 and zero is the middle, a solvent-accessible area runs 0…226 and zero is the edge — so a key named for the centre would draw a line down the middle of an all-positive axis, where the middle means nothing. **DECLARED, never automatic**, and that is a correctness argument rather than house style: a guide that appeared by itself whenever a domain happened to include zero would draw the same view differently at two cursors with nothing in the record saying why. An automatic default was considered and refused (`../encoding/README.md`). And it is a DECLARATION rather than a host prop for the reason every encoding fact is one: a prop the record never sees is a picture whose provenance cannot name its own furniture.

    Two refusals, both about MEANING, plus the shape of the key:
    ```
    encodings[0].frame.color: a zero guide is a line drawn across a plot, and "color" is not a positional channel — declare it on x or y
    encodings[0].frame.y: layer "counts" is a bar, and a bar draws no zero guide on y — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"
    encodings[0].frame.y: a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly
    encodings[0].frame.y.zeroGuide, if present, must be a boolean
    ```
    The first: a guide needs an edge to be perpendicular to, and only x and y are edges (`POSITIONAL_CHANNELS`) — a `size` or an `r` carries a magnitude read off the MARK, and a category list has no zero at all. The second is per PAIR and not per mark (`drawsZeroGuide`, the one predicate both twins ask): a **point** — a scatter, under both its names — draws one on x and y, a **line** on y alone (its x is a run of dates or a band of categories, and neither has a zero a sign is read from), and a **bar**, a **histogram** and a **boxplot** draw none at all, because their extent is already read from a baseline that IS zero and a second line over it says nothing the axis does not. The words are one function (`zeroGuideKindRefusal`), said here with an address in front of it and by the frame that has to draw it exactly as it stands (`vizfootprint-ui/contract/renderers.tsx` · `zeroGuideRefusal`) — the law 9 arrangement, so a def this door accepts is never a frame the renderer refuses. The third is the logarithm's own clause (`noZeroOnALogAxis`): a log axis has no zero, so the answer there is the sentence the logarithm already had with the key you have to drop, and `zero`'s spelling of it is unchanged.

    **What this door CANNOT refuse: whether zero is inside the domain.** No number is typed into a frame, so at declaration time the door is ignorant of it — `refuse on evidence, never on ignorance`. The CHART holds the domain it actually drew on (its own padded extent when no frame handed it one) and refuses there, in one sentence quoting that axis and that channel, in the plot and in the accessible name: *`y was asked for a zero guide, but its axis runs [12, 48] — zero is not a place on it, so there is no line to draw`*. Never clamped to an edge, never silently dropped. A domain that touches zero exactly AT AN END is INSIDE it and the line is drawn there — the closed-interval reading, decided because the other one would have `zeroGuide` refuse the very end `zero: true` extends a domain to reach.

    **Who draws it needs no new law**: `guide: 'merged'` means one axis for the stack drawn by the frame, so the frame draws its zero too; `per-layer` leaves both to the layers.

Two things the fold is OWED rather than able to check, both named at `frameDomains`: **silent cells never enter a domain** (a state column says a cell is a silence, not a low number, so the caller drops those cells first — the adapter's frame door does, per COLUMN, through the port), and **which rows the basis meant** (two reads of the session's one row door: a layer's own window for `rows`, and the table under NOBODY's clause — `viewQuery({ viewId: null })` — for `table`; the fold folds what it is handed and echoes back which it was told). More than four layers on one frame is a **lint** (`frameLint`), never a refusal: a fifth mark is hard to read, not illegal. Paint order is declaration order, first layer at the bottom.

The shape sentences, for completeness: `encodings[i].layers, if present, must be an array of { layerId, table, chartKind, channels }` · `encodings[i].layers[j] must be an object { layerId, table, chartKind, channels, initial?, label? }` · `encodings[i].layers[j]: unknown key "x"` · `…layerId must be a non-empty string` · `…chartKind must be a non-empty string` · `…channels must be a non-empty array of non-empty strings` · `…initial, if present, must be an object mapping channel -> field (strings)` · `…label, if present, must be a string`. A table refused on its own line is not refused again through a layer, and a layer on it is not judged at the build door. The frame's shape sentences: `encodings[i].frame, if present, must be an object mapping channel -> { mode: "shared" | "independent" }` · `encodings[i].frame.<channel> must be an object { mode: "shared" | "independent", domain?, basis?, guide?, zero?, transform?, zeroGuide? }` — on a LAYERLESS view the same channel is named against the axis shape instead, `{ transform?: "linear" | "log", domain?, basis?, guide?, zero?, zeroGuide? }`, and an unknown key there is refused "on an axis" · `…basis, if present, must be "table" or "rows"` · `…guide, if present, must be "merged" or "per-layer"` · `…zero, if present, must be a boolean` · `…transform, if present, must be "linear" or "log"` · `…zeroGuide, if present, must be a boolean` · `encodings[i].frame.<channel>: unknown key "x" on a shared channel`. Not in this version: per-layer opacity/visibility dials, annotation layers, re-encoding one layer of a frame, a map frame with an inset, an implicit crossfilter between sibling layers (only a declared link routes between them), a symlog or a power transform, and a per-layer transform on a shared channel (one resolution per channel) — each its own packet.

## The card a demo cannot get wrong

A demo should be able to say which of the library's features it covers, and a gallery should be able to filter on that. Written by hand, that list is a second source of truth beside the def, and it goes stale the first time somebody adds a view and forgets it. So it is **read off the build**: `defFeatures(dashboard)` projects, as data, what this dashboard can do.

```ts
const card = defFeatures(buildDashboard(nndssDef(tables, graph)));
card.views.find((v) => v.viewId === 'net')?.layers?.length;  // 2
card.selectionKinds.includes('neighbourhood');               // true — a node can be walked from
card.analyses.map((a) => a.builtin);                         // [..., 'layout', 'bringOver']
```

**It takes the BUILT dashboard, not a `DashboardDef`.** Three of its answers are resolved at build and cannot be read off a definition: `revision` (digested once, over the validated def), `engines` (the engine each table actually ROUTED to — a table declaring `auto` reports `memory`, not `auto`) and `sources` (what each source vouched for when it was read). A reader taking a def would have to re-derive all three, which is the drift this reader exists to avoid.

Every other field is a projection with no judgement of its own. A view's VOICE is `voiceOf`'s answer and nobody else's — the same call the link graph and the probe guard make — so a card can never advertise a gesture the guard refuses.

### Law — a card reports what a build HOLDS or a def DECLARES, and never restates a default owned elsewhere

`buildDashboard` applies a fallback when a def declares no link rule and no FDR settings. The card does **not** repeat it: those fields read `null`, meaning "the author declared none, and the build's own default applies". A card that copied the fallback would be a second copy of a value it does not own — and "the author declared no link rule" is a fact worth having on a card anyway.

```ts
defFeatures(buildDashboard(minimalDef)).links.linkDefault;  // null, not 'crossfilter'
defFeatures(buildDashboard(minimalDef)).fdr;                // null, not { procedure: 'LORD++', alpha: 0.05 }
```

### Law — ONE DEMO IS NOT ONE DASHBOARD: a card is per SURFACE

The same demo can build more than one definition. The CDC demo's desk builds its def WITH the co-occurrence graph; its story page builds the same demo WITHOUT it — and the two answer differently, exactly where the graph is:

```ts
defFeatures(buildDashboard(nndssDef(tables, graph)));  // 5 tables · 10 views (one layered) · 8 analyses · 2 relations
defFeatures(buildDashboard(nndssDef(tables)));         // 3 tables ·  9 views (none layered) · 6 analyses · 0 relations
// desk-only: the `net` view, its two layers, the `network` chart kind,
// the `neighbourhood` selection kind, the `nodes` / `edges` tables — and a different `revision`
```

So a card belongs to a SURFACE, and every fact on it carries the surface it came from. A card that merged the two would claim capabilities the page a reader opens does not have.

### What this card is NOT

It says what a build CAN do, never what anybody DID: for that, its twin is [`../branches`](../branches/README.md)'s `logFeatures` (law 5), which reads a captured trace and is honest about the three verbs a log cannot see.

And two things stay hand-written, because no declaration holds them: **which gesture produces which verb**, and **which verbs a particular build leaves unwired**. A def declares the vocabulary; only the host knows which of it got a mouse. A demo that wants that table writes it by hand and labels it as hand-written.

## Resources — the bytes a table cannot hold

A `data` entry is a TABLE: something with columns, a row key, a grain, an absence vocabulary, and a landing judged against what it declared. A **protein structure file** has none of those, and neither does a map's geometry — they are the thing a view DRAWS, not data it reads. So they are declared beside the data, in their own namespace:

```ts
const def = {
  data: { atoms: { rows: atomRows, key: 'atom_id' } },
  actors: { structure3d: { actor: 'user' } },
  // a declared source that is NOT a table: it lands as bytes, it carries a version
  resources: {
    structure: { format: 'text', via: 'http', at: 'https://files.rcsb.org/download/1AY7.pdb' },
    logo:      { format: 'bytes', via: 'file', at: './assets/mark.png' },
  },
};
const dashboard = await buildDashboardAsync(def, { sources: [httpSource(), fileSource] });

dashboard.resources.structure   // FACTS: { format, via, at, version, retrievedAt, bytes: <the size that landed> }
dashboard.resource('structure') // THE BYTES: { format: 'text', body: '<the file>', version, retrievedAt } — in-process only
```

This door judges a resource in the same shape it judges a table's `source` and refuses it in the same words (`./validate.ts` · `validateResourceDecl`, the twin of `validateSourceDecl`): a `format` outside `bytes|text`, a `via` outside `SOURCE_VIAS`, an `at` that is not a path or URL string for `file`/`http`, an unknown key. Three refusals are its own:

| the def says | the door says |
|---|---|
| `resources: { atoms: … }` where `data.atoms` exists | *is also a declared table — one namespace per question: a resource is a declared source that is NOT a table, so it may not share a name with one* |
| `resources: { '': … }` | *a resource name must be a non-empty string* |
| `resources: { s: { format: 'csv', … } }` | *format must be one of bytes\|text — a resource lands as bytes, never as rows* |

**Which door builds it.** `buildDashboard` (synchronous) lands an INLINE resource exactly as it lands an inline table's rows — the payload is the def's own, so there is nothing to await (`../source/inline.ts` · `inlineResource`, the one landing both doors make) — and refuses every other via with *build it with buildDashboardAsync*, the sentence a non-inline source already gets. `buildDashboardAsync` reads them FIRST, before a table: a resource needs no engine and no connection, so a refused one raises the def's error before anything is opened.

**What the resources then do**, all of it in [`../source/README.md`](../source/README.md) under "a resource is a declared source that is not a table": they fill `overview().resources` as FACTS (a size, never a payload), a commit stamps the versions it was true of under its own `resources` key, `dashboard.refresh()` may move one, and `HostHandshake.resources` offers the bytes to a renderer. An inline `bytes` payload is the one place a def carries a `Uint8Array`, and — like a table's `rows` and its inline `source.at` — it is bulk data the author still owns: `freezeDefinition` walks plain objects and arrays only, so it is left exactly as it stands.

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the schema — `DashboardDef`, `DataSourceDef`, `RelationDecl` / `RelationEdge`, `LayerDecl`, `DashboardRuntime` |
| `validate.ts` | the firewall + the parse door; runs the build door once per layer against the layer's table |
| `relations.ts` | the relation laws as refusals, `relationEdgeId`, the default kind, the read-across permission (`joinsTables`, `judgeAnalysisReads`), the join a `bringOver` follows (`relationsFrom`), and the edge a neighbourhood is walked over (`neighbourhoodEndpoints`) |
| `layerAddress.ts` | THE one owner of the layer marker — `LAYER_MARKER`, `layerAddress`, `splitLayerAddress`, `holdsLayerMarker` |
| `layers.ts` | the layer laws as refusals; `layerSurfaceOf` / `layerSurfacesOf`, the surfaces the build door and `lint()` judge |
| `builtinAnalyses.ts` | an analysis as data (the nine records, their options, the extra judge one carries, and the def context another needs) |
| `tableReach.ts` | `tableReachOf(def)` — the ONE reader of what this definition says about its tables reaching one another (the relations, and the columns of every table whose list is known), so the def door and the build door judge a link's reach off one reading (`../links/README.md`, "A default edge is a promise the engine can keep") |
| `register.ts` | the one registry boundary |
| `buildDashboard.ts` | the build — resolves engines (and notes, in the engine's own words, a table routed to one this version does not run), keys, relations and each view's layers onto the runtime; owns the DERIVED-TABLE slots (`landDerivedTable` mints a provider under an act's own name; a refresh drops that parent's tables and every table cut from those, reported as `derivedLost`); `lintData` judges keys and relations against the engine; `lint()` judges every layer against its own table's columns; `lintFrames()` reports the frame's own advice (`frameLint`) per view |
| `declaredTable.ts` | the LANDING judged against the DECLARATION — `notTheDeclaredTable` (the verdict and its one sentence) and `unlandedProvider`, the provider that refuses every read of a table whose bytes were not this table |
| `wasmBackend.ts` | this build's ONE SQL backend: a def's bytes (`rows`, `csv`, or the rows a carrier decoded) landed in one connection opened at most once — with a sentence for each way a landing fails, and never a throw past the door |
| `revision.ts` | the definition's revision, digested once at build |
| `features.ts` | `defFeatures` — the feature card of a BUILT dashboard, read off the build so a demo's tags cannot drift |
| `series.ts` | the long-form series contract |
| `recordIds.ts` | the id counters |
