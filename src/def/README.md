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

> **The arithmetic reads exactly `present`. A definition may opt ONE column in with `arithmetic: 'carried'` (default `'present-only'`), and nothing else moves.**

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

A dashboard with no wasm table has nothing to close and says so by doing nothing — as does a sync-door build whose lazy wasm table nobody ever read, because nothing was opened. `refresh()` on a wasm table still refuses (below), and its remedy is this pair of acts: close, then build again.

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

Two consequences, both said out loud rather than papered over. The SYNC door refuses an inline source beside `engine: 'wasm'` in a sentence (landing bytes is an await, whichever via carried them). And `refresh()` REFUSES such a table (`reason: 'not-reloadable'`): a refresh swaps an array, and this table's rows are a table in a SQL backend — re-landing them is a different act with a different delta, and quietly rebuilding it as a memory table would make `dashboard.engines` a lie. The remedy names both acts — `close()` this dashboard and build again — because a second build over an unclosed one leaves the first database open.

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

## What fits, before a build

`whatFits` (the encoding plane's door, re-exported here beside `fitsFor`) answers "which column may sit on which channel" without building anything. `whatFits.def.test.ts` pins it against this door's own lint, column by column and channel by channel. See [`../encoding/README.md`](../encoding/README.md).

## Relations — the edges between tables

A def declares its tables as `data: Record<string, DataSourceDef>`, and each table may name its row identity (`key`). `relations` is the one place two tables are joined: an edge from a column of one table to the **key** of another. Relations are data on the MAP — the overview echoes them (`overview().relations`, the `relations` part of `whats_here`), and two things in the session act on them: an analysis may read across a declared edge and no other way (law 6), and the `neighbourhood` selection kind walks a pair of them (law 7) rather than inferring a join from the rows.

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
5. **A layer's bindings are judged against ITS table.** The build door runs the encoding validator once per layer with the layer's table's declared columns — or, on a MINTED table, against the act's declared column list (`groupBy`, then the measures' `as` names), for **existence only**: a minted column has no `ColumnDecl` to declare a role or a scale and its type is the act's to answer when it runs, so `"ghost" is not a column of the table` is the whole of what the def can say. `lint()` has no provider to ask for such a table and judges it when the act lands — a role declared on the nodes table refuses on the nodes layer and says nothing on the edges layer, where the def declares no such column; `dashboard.lint()` then judges each layer against the columns its own table's provider lists, under the layer address. The view-level `initial` is judged against the default table exactly as before:
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
6. **The resolved layers are data on the view.** `ViewDecl.layers` is the declared list, frozen at build, present only when the def declared it; the session's `tableFor(address)` reads the layer's table off it, and the overview projects `views[].layers`.

### The frame — layers share their scales, and the frame owns them

A stack of layers is one picture only if it is read on one set of scales ("scales are common across layers" — Wickham). `frame` on the view's encoding says how, **per channel**, and says it in words: `{ mode: 'shared' | 'independent' }`, plus `domain: 'union'`, `basis: 'table' | 'rows'`, `guide: 'merged' | 'per-layer'` and `zero` on a shared one, and `transform: 'linear' | 'log'` on either (law 11 — a transform is not a resolution, and it is legal on a view with no layers at all). **No number can be typed into it.** The domains are folded from the rows by `frameDomains` (`vizfootprint/def` — the door that re-exports the encoding plane, PACKAGING.md, Law 1) at every update, so an axis can never disagree with the data under it, and a channel the frame does not name is `shared / union / table / merged` — the default that makes a stack one picture.

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

Four more laws.

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
9. **A bar, a histogram and a boxplot may not take an independent magnitude channel, and a bar or a box may not be told to drop zero.** Their extent IS the quantity: measured against a second axis, or off a cut baseline, a bar overstates a difference by exactly what was taken away. A line or a point encodes POSITION and may honestly zoom, which is why the law is about the marks and not about the channel:
   ```
   encodings[0].frame.y: layer "counts" is a bar — a bar cannot take an independent y, its extent is read against one baseline
   encodings[0].frame.y.zero is false but layer "counts" is a bar — its y is read from zero
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

Two things the fold is OWED rather than able to check, both named at `frameDomains`: **silent cells never enter a domain** (a state column says a cell is a silence, not a low number, so the caller drops those cells first — the adapter's frame door does, per COLUMN, through the port), and **which rows the basis meant** (two reads of the session's one row door: a layer's own window for `rows`, and the table under NOBODY's clause — `viewQuery({ viewId: null })` — for `table`; the fold folds what it is handed and echoes back which it was told). More than four layers on one frame is a **lint** (`frameLint`), never a refusal: a fifth mark is hard to read, not illegal. Paint order is declaration order, first layer at the bottom.

The shape sentences, for completeness: `encodings[i].layers, if present, must be an array of { layerId, table, chartKind, channels }` · `encodings[i].layers[j] must be an object { layerId, table, chartKind, channels, initial?, label? }` · `encodings[i].layers[j]: unknown key "x"` · `…layerId must be a non-empty string` · `…chartKind must be a non-empty string` · `…channels must be a non-empty array of non-empty strings` · `…initial, if present, must be an object mapping channel -> field (strings)` · `…label, if present, must be a string`. A table refused on its own line is not refused again through a layer, and a layer on it is not judged at the build door. The frame's shape sentences: `encodings[i].frame, if present, must be an object mapping channel -> { mode: "shared" | "independent" }` · `encodings[i].frame.<channel> must be an object { mode: "shared" | "independent", domain?, basis?, guide?, zero?, transform? }` — on a LAYERLESS view the same channel is named against the axis shape instead, `{ transform?: "linear" | "log", domain?, basis?, guide?, zero? }`, and an unknown key there is refused "on an axis" · `…basis, if present, must be "table" or "rows"` · `…guide, if present, must be "merged" or "per-layer"` · `…zero, if present, must be a boolean` · `…transform, if present, must be "linear" or "log"` · `encodings[i].frame.<channel>: unknown key "x" on a shared channel`. Not in this version: per-layer opacity/visibility dials, annotation layers, re-encoding one layer of a frame, a map frame with an inset, an implicit crossfilter between sibling layers (only a declared link routes between them), a symlog or a power transform, and a per-layer transform on a shared channel (one resolution per channel) — each its own packet.

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

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the schema — `DashboardDef`, `DataSourceDef`, `RelationDecl` / `RelationEdge`, `LayerDecl`, `DashboardRuntime` |
| `validate.ts` | the firewall + the parse door; runs the build door once per layer against the layer's table |
| `relations.ts` | the relation laws as refusals, `relationEdgeId`, the default kind, the read-across permission (`joinsTables`, `judgeAnalysisReads`), the join a `bringOver` follows (`relationsFrom`), and the edge a neighbourhood is walked over (`neighbourhoodEndpoints`) |
| `layerAddress.ts` | THE one owner of the layer marker — `LAYER_MARKER`, `layerAddress`, `splitLayerAddress`, `holdsLayerMarker` |
| `layers.ts` | the layer laws as refusals; `layerSurfaceOf` / `layerSurfacesOf`, the surfaces the build door and `lint()` judge |
| `builtinAnalyses.ts` | an analysis as data (the nine records, their options, the extra judge one carries, and the def context another needs) |
| `register.ts` | the one registry boundary |
| `buildDashboard.ts` | the build — resolves engines (and notes, in the engine's own words, a table routed to one this version does not run), keys, relations and each view's layers onto the runtime; owns the DERIVED-TABLE slots (`landDerivedTable` mints a provider under an act's own name; a refresh drops that parent's tables and every table cut from those, reported as `derivedLost`); `lintData` judges keys and relations against the engine; `lint()` judges every layer against its own table's columns; `lintFrames()` reports the frame's own advice (`frameLint`) per view |
| `wasmBackend.ts` | this build's ONE SQL backend: a def's bytes (`rows`, `csv`, or the rows a carrier decoded) landed in one connection opened at most once — with a sentence for each way a landing fails, and never a throw past the door |
| `revision.ts` | the definition's revision, digested once at build |
| `features.ts` | `defFeatures` — the feature card of a BUILT dashboard, read off the build so a demo's tags cannot drift |
| `series.ts` | the long-form series contract |
| `recordIds.ts` | the id counters |
