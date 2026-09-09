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

One key of that vocabulary is not about the arithmetic at all. `carries` names which of the declared states hold a number ANYWAY, and EIA's hourly grid is the case it exists for: an `estimated` figure is EIA's own number for an hour nobody filed, and a `replaced` one is the number EIA published beside the number the authority filed. Both are figures. It is read by ONE thing — the contradiction check ([`../data/README.md`](../data/README.md)), which refuses a table whose silent row holds a number — so a state named there is not silent and its number is not a table saying two things at once. Default NONE: a def written before the key existed is judged byte for byte as it was. The walker is untouched and still reads exactly `present`, because "the source put a number here" and "the arithmetic may add it" are two different questions, and only the source can answer the first.

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

`data[t].engine` routes a table to a D24 engine: `memory` (in-JS predicates, always on), `wasm` or `server` (typed stubs — the port's shape with nothing behind it), or `auto`. `auto` resolves to **memory** and only quotes the guess the placeholder thresholds would have made, because a round number must not point a real table at an engine that refuses every query.

**A declared stub engine is honoured, and never silent.** It builds, every read of that table is refused, and the BUILD says at the door exactly what the read will say — the same sentence, minted once in [`../data/stubEngines.ts`](../data/stubEngines.ts) and quoted by both:

```ts
buildDashboard({ data: { cases: { rows, engine: 'wasm' } }, actors: { … } }).notes;
// [ 'data["cases"]: the "wasm" engine answers no query in this version — it is a typed stub:
//    it names its declared tables and answers nothing else. Declare engine "memory" to run
//    "cases" in this process, or bring the engine yourself: pass
//    { providers: { "cases": yourProvider } } to the builder you already call' ]
```

**Why a note and not a `parseDashboardDef` refusal.** Three reasons, and they are all the same reason: the def is not what is wrong.

1. `wasm` and `server` are legal declarations of a real seam. What is missing is an engine in this VERSION — a fact about the build, not about the grammar, and the grammar door is where a def's own shape is judged.
2. **The same def RUNS when a host brings that engine.** `buildDashboard(def, { providers: { cases: yourProvider } })` answers the table from the host's own `DataProvider`; the validator never sees the options, so a refusal there would refuse a def that works. (That table then owes the *host* note — the def's routing was not built — and never the stub's.)
3. A stub engine is the one reachable way to exercise what a session does when an engine cannot serve: the typed `needs-backend-data` gap, with the act still standing ([`../session/README.md`](../session/README.md), law 1, rule 3). Refuse the declaration at the grammar door and that behaviour loses its only test path.

What refuses out loud instead, in the same words: `dashboard.notes` at build, `lint()` and `lintProse()` **throw** them (nothing to judge is not "nothing wrong"), and `lintData()` reports them per key and per relation. `availableEngines` bounds one thing only — the guess `auto` quotes — and says so; it has never gated an explicit engine. Naming **no** engine (`[]`) is refused at the door in a sentence, because `[]` is not "unset": it reaches `chooseEngine` with nothing to pick and would abort the whole build with a `RangeError` for a guess that only appears in a note.

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
3. **A layer names its table, and the table is declared.** `table` is required — a layer exists to name one — and unlike a view's default table it is never inferred:
   ```
   encodings[0].layers[0].table must be a non-empty string — a layer exists to name its table
   encodings[0].layers[0].table "ghost" is not a declared data table — the tables are nodes, edges
   ```
4. **A layerId is declared once within its view.** Two views may each have a `nodes` layer (`a~nodes`, `b~nodes` are different addresses); one view may not:
   ```
   encodings[0].layers[1].layerId "nodes" repeats within view "net"
   ```
5. **A layer's bindings are judged against ITS table.** The build door runs the encoding validator once per layer with the layer's table's declared columns — a role declared on the nodes table refuses on the nodes layer and says nothing on the edges layer, where the def declares no such column; `dashboard.lint()` then judges each layer against the columns its own table's provider lists, under the layer address. The view-level `initial` is judged against the default table exactly as before:
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

The shape sentences, for completeness: `encodings[i].layers, if present, must be an array of { layerId, table, chartKind, channels }` · `encodings[i].layers[j] must be an object { layerId, table, chartKind, channels, initial?, label? }` · `encodings[i].layers[j]: unknown key "x"` · `…layerId must be a non-empty string` · `…chartKind must be a non-empty string` · `…channels must be a non-empty array of non-empty strings` · `…initial, if present, must be an object mapping channel -> field (strings)` · `…label, if present, must be a string`. A table refused on its own line is not refused again through a layer, and a layer on it is not judged at the build door. Not in this version: a frame with shared scales, per-layer opacity/visibility dials, annotation layers, an implicit crossfilter between sibling layers (only a declared link routes between them).

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
| `buildDashboard.ts` | the build — resolves engines (and notes, in the engine's own words, a table routed to one this version does not run), keys, relations and each view's layers onto the runtime; owns the DERIVED-TABLE slots (`landDerivedTable` mints a provider under an act's own name; a refresh drops that parent's tables and every table cut from those, reported as `derivedLost`); `lintData` judges keys and relations against the engine; `lint()` judges every layer against its own table's columns |
| `revision.ts` | the definition's revision, digested once at build |
| `features.ts` | `defFeatures` — the feature card of a BUILT dashboard, read off the build so a demo's tags cannot drift |
| `series.ts` | the long-form series contract |
| `recordIds.ts` | the id counters |
