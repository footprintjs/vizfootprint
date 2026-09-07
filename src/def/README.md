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

`formula` is the one whose content is a sentence a PERSON typed rather than options a developer chose, so it is the one this door judges twice: the grammar reads `expression` here, at validation, and refuses a token it has no rule for by naming it and its position (`analyses["rate"].expression is not a formula: the formula has no rule for "%" at position 7`); the SESSION then judges the columns it names against the table it will read, before the act exists. The grammar, the five functions it knows and every refusal either judge makes are in [`../analysis/README.md`](../analysis/README.md).

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
analyses["a"].builtin "kmeans" is not a builtin analysis — one of groupBy | correlation | regression | clustering | formula | layout | bringOver
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

## What fits, before a build

`whatFits` (the encoding plane's door, re-exported here beside `fitsFor`) answers "which column may sit on which channel" without building anything. `whatFits.def.test.ts` pins it against this door's own lint, column by column and channel by channel. See [`../encoding/README.md`](../encoding/README.md).

## Relations — the edges between tables

A def declares its tables as `data: Record<string, DataSourceDef>`, and each table may name its row identity (`key`). `relations` is the one place two tables are joined: an edge from a column of one table to the **key** of another. Relations are data on the MAP — the overview echoes them (`overview().relations`, the `relations` part of `whats_here`), and one thing in the session acts on them: an analysis may read across a declared edge and no other way (law 6). The neighbourhood selection kind comes later, and it too will read this list rather than infer a join from the rows.

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

Six laws. The door does not judge them in this order: per end it first asks that the table is declared (law 3) and only then judges the column on it (law 2) or the key it points at (law 1); self-join and repeat (law 3) and `kind` / `label` (law 4) come last; law 5 is a runtime fact, not a door law.

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
6. **The resolved layers are data on the view.** `ViewDecl.layers` is the declared list, frozen at build, present only when the def declared it; the session's `tableFor(address)` reads the layer's table off it, and the overview projects `views[].layers`.

The shape sentences, for completeness: `encodings[i].layers, if present, must be an array of { layerId, table, chartKind, channels }` · `encodings[i].layers[j] must be an object { layerId, table, chartKind, channels, initial?, label? }` · `encodings[i].layers[j]: unknown key "x"` · `…layerId must be a non-empty string` · `…chartKind must be a non-empty string` · `…channels must be a non-empty array of non-empty strings` · `…initial, if present, must be an object mapping channel -> field (strings)` · `…label, if present, must be a string`. A table refused on its own line is not refused again through a layer, and a layer on it is not judged at the build door. Not in this version: a frame with shared scales, per-layer opacity/visibility dials, annotation layers, an implicit crossfilter between sibling layers (only a declared link routes between them).

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the schema — `DashboardDef`, `DataSourceDef`, `RelationDecl` / `RelationEdge`, `LayerDecl`, `DashboardRuntime` |
| `validate.ts` | the firewall + the parse door; runs the build door once per layer against the layer's table |
| `relations.ts` | the relation laws as refusals, `relationEdgeId`, the default kind, and the read-across permission (`joinsTables`, `judgeAnalysisReads`) and the join a `bringOver` follows (`relationsFrom`) |
| `layerAddress.ts` | THE one owner of the layer marker — `LAYER_MARKER`, `layerAddress`, `splitLayerAddress`, `holdsLayerMarker` |
| `layers.ts` | the layer laws as refusals; `layerSurfaceOf` / `layerSurfacesOf`, the surfaces the build door and `lint()` judge |
| `builtinAnalyses.ts` | an analysis as data (the seven records, their options, the extra judge one carries, and the def context another needs) |
| `register.ts` | the one registry boundary |
| `buildDashboard.ts` | the build — resolves engines, keys, relations and each view's layers onto the runtime; `lintData` judges keys and relations against the engine; `lint()` judges every layer against its own table's columns |
| `revision.ts` | the definition's revision, digested once at build |
| `series.ts` | the long-form series contract |
| `recordIds.ts` | the id counters |
