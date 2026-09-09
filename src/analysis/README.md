# analysis — declared analyses, and the one a person writes

An analysis is DECLARED and executed as a footprintjs flowchart, and its output re-enters the data space through one of four existing rails (`columns`, `geometry`, `scalar`, `table`) — never a row-id list, never a new dispatch verb. `defineAnalysis` is the door; `builtins.ts` holds the four a developer gets for free, `formula.ts` the one a person writes, and `layout.ts` and `bringOver.ts` the two that read a second table; `stats.ts` holds the arithmetic they share.

Six of the seven are code a DEVELOPER wrote. The seventh is a sentence a PERSON typed, and that difference is what the next section is about.

## Three outcomes, distinct

Every analysis finishes in one of three ways, and `AnalysisResult` (`types.ts`) says which without a reader guessing it from a field that happens to be missing:

- **It landed** — `{ ok: true, output }`. An EMPTY output is this: a table of zero rows, a column of nothing but absences. Zero rows is an honest answer, never a failed one.
- **It read the rows and found no honest fit** — `{ ok: false, reason: 'degenerate-fit', fitDegenerate: true, n }` (R14). The act ran, the rows were read, and the arithmetic would have had to fabricate a number: fewer than two nodes to lay out, a line through one point.
- **It could not read the rows at all** — `{ ok: false, reason: 'unavailable', rejection }`. The table's engine refused the read (a stub engine, a source that is not there), so nothing was computed and nothing lands. It carries the engine's own `DataProviderRejection` verbatim; the session files it as `derive-source-refused`.

The third arm exists because the second was once made to stand in for it: a refused read reported as a degenerate fit with `n: 0` told a person their data had no fit when it had never been read. Code that branches on `ok` alone still holds; code that reads `n` or `fitDegenerate` narrows on `reason` first.

```ts
const result: AnalysisResult = {
  ok: false,
  reason: 'unavailable',
  rejection: { ok: false, engine: 'wasm', operation: 'evaluate', reason: 'not-implemented', detail: 'the wasm engine is a stub in this build' },
};
```

## The formula: a derived column, as data

```ts
analyses: { rate: { builtin: 'formula', expression: 'cases / population * 1000', name: 'rate' } }
```

`formulaAnalysis` (`formula.ts`) is `produces: 'columns'`, run row-wise over the table it reads, landing one column at the act's own slot through the same path `clusteringAnalysis` uses. There is no second column-writing path and no new node type: a formula column IS a derived column, and everything [`../data/README.md`](../data/README.md) says about one — the per-act slot, the branch resolution, the retention policy, the refusal to take a source column's name — is true of it unchanged.

What is new is the evaluator, and it had to be new: **nothing in this library could evaluate an expression, and nothing in it may be allowed to.**

### Why there is a hand-written parser and never an `eval`

`eval`, `new Function` and a prototype walk are all ways of running a person's text as a PROGRAM. The text on this door is not a program. It is arithmetic over the columns of one table, and the grammar below is the whole of what may be said:

```
expression := term (('+' | '-') term)*
term       := unary (('*' | '/') unary)*
unary      := '-' unary | primary
primary    := number | column | call | '(' expression ')'
call       := function '(' expression (',' expression)* ')'
column     := identifier | '"' any name '"'
```

A tokenizer, a precedence parser to an AST, and a walker over one row. No strings, no comparisons, no assignment, no property access, no calls but the five below. `parseFormula(text)` is total over any string: it answers with the tree and the columns the tree reads, or with one sentence — never a throw, and never a half-parsed tree.

- **Numbers** are `12`, `12.5`, `.5`. There is no exponent form: `1e3` is a number followed by a name, and reads as one.
- **Columns** are bare identifiers (`cases`, `ytd_2024`, `_raw`) or, for a name with a space or a symbol in it, the same name in double quotes: `"the count" / "total cases"`. A column genuinely called `abs` is `"abs"`.
- **Functions** are `abs(x)`, `log(x)` (natural), `round(x)`, `min(a, b, …)` and `max(a, b, …)`. Five, closed. Nothing that reads a file, a URL, a date or another row.
- **Unary minus** only. A leading `+` is not in the grammar.

### A silence stays a silence

One rule covers every arithmetic edge, and it is the rule the rest of this library already keeps — an absence is not a number and must not become one:

> **A step that cannot produce a finite number produces `null`, and `null` spreads through everything above it.**

So a division by zero is `null`, never `Infinity`. A row whose column is empty, or text, or a date, is `null` for that row, never `0`. `log(0)` is `null`, never `-Infinity`, and an overflow is `null`, never `Infinity`. A column of silences reads as a column of silences, and a chart drawn over it shows a gap rather than a floor.

### Every refusal, and where it happens

**At parse** — before an analysis is built, and therefore before a row is touched. Each names the token and its position, counted from 1 the way a person counts what they typed:

| what was written | the sentence |
|---|---|
| `cases % 2` | `the formula has no rule for "%" at position 7` |
| `` (empty) | `the formula is empty — write an expression over this table's number columns` |
| `1.2.3` | `"1.2." at position 1 is not a number — a number has one decimal point` |
| `1 + "the count` | `the column name opened with " at position 5 is never closed` |
| `"" + 1` | `the empty name at position 1 is not a column` |
| `cases +` | `the formula stops at position 8 — something is missing at the end` |
| `cases 2` | `"2" at position 7 is not part of the formula` |
| `* 2` | `"*" at position 1 is not where a value can go` |
| `(1 + 2` | `the "(" at position 1 is never closed` |
| `sqrt(9)` | `there is no function named "sqrt" at position 1 — the formula knows abs, log, max, min, round` |
| `abs + 1` | `"abs" at position 1 is a function and needs its arguments in ( )` |
| `abs(1, 2)` | `"abs" at position 1 takes one argument, and it was given 2` |
| `min(1)` | `"min" at position 1 takes two or more arguments, and it was given 1` |
| `abs(1` | `the arguments of "abs" at position 1 are never closed` |

A record's expression is parsed by the def door as part of validating the record (`validateBuiltinAnalysis`), so a mistyped formula in a definition is a sentence beside every other refusal that def collects — not a stack trace from a factory. `formulaAnalysis` called directly throws `FormulaError` for the same reason at the same moment.

**At declaration** — the columns, judged against the table the analysis will read, with nothing moved yet. This is `AnalysisDef.judgeTable`, a general hook the session asks of any analysis that carries one, and the formula is its first and only user:

```
the formula "cases / deaths" reads "deaths", which table "data" does not have — the numbers it may read are cases, people
the formula "cases / region" reads "region", which table "data" holds as string — a formula reads numbers
```

The type rule is the ENGINE'S — `ColumnInfo.type`, the same `TypeTally` `describeTable` and the memory provider settle on — so a column this refuses is a column the dashboard also calls text. There is no second sniffer. The columns are the ones visible AT THE CURSOR, which is why a formula over a column an earlier act derived is judged against what that act actually left there, and is allowed.

A refusal here is an ordinary `guard-failed` gap and **the act does not happen**: no commit, no column, no fold moved. That is law 1 of [`../session/README.md`](../session/README.md), and it is why the judge runs before the input is even read.

**At the write** — the output name against the table's DECLARED columns. Nothing new: this is the existing law in [`../data/README.md`](../data/README.md), unchanged. A formula whose column is called `price` on a table that declares `price` lands its commit (the analysis really ran) and refuses the write, with `materialized: []` and the sentence *"a computed column may not take a source column's name"*.

### What the chart is handed, and why it is columns

`toRunInput` folds out — in one walk — only the columns the expression names, and hands the chart those arrays plus the row count. Not the rows.

That is smaller and faster than the whole table, but the reason it is written that way is correctness: **a value handed to the engine is committed, and a committed value is frozen.** Handing over the provider's own row objects would freeze the table itself, and the next analysis to materialize a column into a row-layout store would find the rows unextensible. Fresh arrays of the cells are ours to give.

The two keys the chart uses beside the column's own (`"<name> input"` and `"<name> loaded"`) are DERIVED from the column name and strictly longer than it, so no column name can collide with them — footprintjs guards an input key as readonly and throws on a colliding write, and the final committed key here has to *be* the column's name, because that is the key `writeColumns` reads the values back off.

### Replay

A formula replays like any other act, which is the point of building it this way: the replay re-performs it at its own position over the table it read, and its column lands in the slot its own commit id names. Two branches that computed the same column name keep their own numbers on both sides.

And it replays **from the log alone**. The commit's value slot carries `{ id, table, def }` — the record the analysis was built from — because a record is data and there was never a reason for a commit to be an incomplete record of its own act. So a formula declared at runtime, through the desk's *add a column*, replays into a session that declares nothing:

```ts
const fresh = buildDashboard(defWithNoAnalyses).createSession();
await fresh.replay(JSON.stringify(source.log.records));   // { ok: true, reran: 1, filed: 0 }
```

A MODULE cannot ride — a function is not data — so an analysis a developer wrote still has to be declared on the replaying session, and a log holding one files the ordinary `needs-analysis-kind` gap with the column honestly absent. That line is not about the formula; it is about what can be written down. See [`../session/README.md`](../session/README.md), law 6.

## An analysis may read a RELATED table

Some analyses cannot be computed from one table. A stress layout on `nodes` needs the `edges`; a pull per node is the weight of the ties touching it, and the weights are on the other table. `reads` names those tables, and the rest follows one law:

**A declared relation is the permission, and there is no other way across.**

```ts
defineAnalysis<readonly Row[], ColumnsOutput>({
  id: 'pull',
  kind: 'transform',
  produces: 'columns',
  inputs: [{ column: 'id', role: 'identifier' }],       // ← the column rows are IDENTIFIED by, not grouped by
  reads: ['edges'],                                    // ← the table BESIDE the one it runs over
  build: …,
  toRunInput: (rows, related) => ({                    // ← the rows arrive here, keyed by table name
    ids: rows.map((r) => String(r['id'])),
    ties: related['edges']!.map((e) => ({ s: String(e['source']), t: String(e['target']), w: Number(e['weight']) })),
  }),
  readOutput: () => ({ ok: true, output: { as: 'columns', table: 'nodes', columns: { pull: { type: 'int' } } } }),
});
```

```ts
await session.declareAnalysis('pull');                 // relations: edges.source → nodes.id, edges.target → nodes.id
// pull = [5, 6, 1] — a column `nodes` alone could not have produced
```

Without that relation the act does not happen, and the sentence says what to declare:

```
analysis "pull" reads table "edges", which no declared relation joins to "nodes" — declare the relation first
analysis "pull" reads table "ghost", which is not a declared data table — the tables are nodes, edges
```

Four things about the rows that arrive, all of them the same rules the OWN table has been read under all along — the two tables go through one path (`resolveAnalysisInput`), which is why the replay arm needed nothing new:

- **At the cursor.** A column an earlier act derived on the related table is there, under its logical name — so an analysis reading `weight2` reads what the act that made it actually left there, on this branch.
- **Under that table's own clauses.** A brush on the edges layer changes what a layout over them sees, and `why()` names that brush as an `input-selection` of the column it produced — a related table read under a selection really is a causal input, and the provenance would lie if it did not say so. The own table is still read WHOLE for a columns analysis (its values must align to the row order), so a brush on IT is still not an input.
- **Detached.** The rows are copies, because they go to footprintjs as a run input and footprintjs freezes what it is given.
- **All or nothing.** A backend that refuses a related table stops the act with a `needs-backend-data` gap (`related table "edges": the edge store is offline`). Half an input is not an input.

The last one is a law about the ACT, so it holds one layer down too, where the caller is not a session:

```ts
await pull.run(nodeRows);                              // no { related } for a def that declared one
// vizfootprint: analysis "pull" reads "edges" beside its own table, and this run was handed no rows
// to read there — "reads" is a promise the caller resolves
```

`run` keeps both halves of that promise. A declared table nobody handed over refuses by name rather than laying out an edgeless graph and calling it a success — which is what makes the `!` in the example above safe, and what lets a builtin write `related['edges'] ?? []` and mean an EMPTY table, never a missing one. A table the def never named is dropped rather than forwarded: the permission the door granted was for the declared names.

`readOutput` is unchanged, and so is everything downstream: an analysis still writes ONE table's columns, still at its own slot, still replayable. Reading is where a second table enters; writing is not.

## The layout: a position is data

```ts
analyses: { map: { builtin: 'layout', algo: 'stress', table: 'nodes', edges: 'edges' } }
```

```ts
await session.declareAnalysis('map');   // relations: edges.source → nodes.id, edges.target → nodes.id
// x = [ -1.87, 0.42, … ]  y = [ 0.11, -2.03, … ]  — two derived columns on `nodes`, at this act's slot
```

`layoutAnalysis` (`layout.ts`) is `produces: 'columns'` and `reads: ['edges']`. It writes `x` and `y` back through the same derived-column path a formula uses, which means every word of [`../data/README.md`](../data/README.md) about a derived column is true of a position: the per-act slot, the branch resolution, the refusal to take a source column's name.

**The law: a position not on the trace is a position a replay cannot promise.** That is the whole reason the layout is an analysis instead of a step inside a renderer. A renderer that computed positions would draw a picture no log could reproduce, and every later act — a brush over a region of the picture, a second layout that starts from this one — would rest on numbers nobody wrote down.

### What it computes

Seeded SGD stress majorization (Zheng, Pawar & Goodman 2019), over exact unweighted hop distances, in three phases the bench measures separately:

1. **`adjacencyOf`** joins the two tables by key. Every edge row is USED or DROPPED and both are counted — an endpoint naming no node, or a self-loop, is a fact about the data, never a silent omission.
2. **`distancesOf`** runs a BFS from every node. A pair with no path between them takes `maxFinite + 1` — one hop beyond the graph's own diameter, so components sit apart without being flung to infinity.
3. **`place`** runs the seeded iterations: each pass walks every pair in an order the seed shuffles, with a learning rate decaying from the loosest pair's step to the tightest's. 30 passes unless the record says otherwise.

`makeRng` (`../fdr/rng.ts`) is the only randomness, and the seed is on the record: **the same seed and the same rows give byte-identical positions**, pinned by a test that runs the whole act twice and compares.

### The mental map

A re-layout that moves everything destroys the reader's map of the picture (Misue et al. 1995). So a node that already has a finite `x` and `y` **keeps them exactly**, and only a new node is placed — at the centroid of the neighbours that already have a position, or on the seeded ring when it has none.

A second layout act needs nothing new for this: the first act's `x` and `y` are ordinary derived columns, visible at the cursor under their logical names, so they arrive as columns of the rows the second act reads.

### What it refuses

Exact all-pairs is one `n × n` matrix, so there is a ceiling — `LAYOUT_NODE_CAP`, judged from the node count alone before a cell is allocated:

```
a stress layout needs exact all-pairs distances, which is one 5001 × 5001 matrix: this graph has 5001 nodes and the ceiling is 5000 — filter the nodes down, or lay the graph out in pieces
```

Fewer than two nodes is a degenerate fit (`precheck`, R14): the act lands nothing and says so, rather than fabricating a position for a graph that has no distances to fit.

What the cap costs, and what quality the iterations buy, are measured by [`../../bench/layout/`](../../bench/layout/) — whose acceptance was written before this file existed and holds it to the seam, the seed, the cap sentence and the anchoring. No number for either belongs on this page unless that bench generated it; the two below are quoted from [`../../bench/layout/layout-table.md`](../../bench/layout/layout-table.md) and move when it is re-run.

**Why 5,000 and not 10,000.** At 1,000 nodes the matrix is 1.9 MiB and the whole act — flowchart, commit and column write included — takes 200.318 ms; at 10,000 the matrix is 190.7 MiB and `place` alone takes 24,087.936 ms. Ten times the nodes cost a hundred times the memory and roughly a hundred and thirty times the placement, which is what a quadratic looks like from the outside, and 24 seconds is past anything a person waits through for one act. 5,000 sits between them at a 47.7 MiB matrix, which is why the refusal quotes it. Above the cap the honest move is to filter the nodes down, or lay the graph out in pieces — which is what the sentence says.

The matrix is a `Uint16Array`, so those bytes are array-buffer memory and not JS heap: at 10,000 nodes the bench reads 381.6 MiB of array buffers against 26.4 MiB of heap. A page that quoted the heap figure would be saying the matrix is nearly free.

## Bring a related table's columns over

```ts
relations: [
  { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } },
  { from: { table: 'edges', column: 'target' }, to: { table: 'nodes', column: 'id' } },
],
analyses: { ends: { builtin: 'bringOver', table: 'edges', from: 'nodes', columns: ['x', 'y'] } }
```

```ts
await session.declareAnalysis('map',  { table: 'nodes' });   // the layout writes x and y onto the nodes
await session.declareAnalysis('ends', { table: 'edges' });   // this carries them across BOTH ties
// edges now hold source_x, source_y, target_x, target_y — an edge mark reads its own row and looks nothing up
```

`bringOverAnalysis` (`bringOver.ts`) is `produces: 'columns'` and `reads: [from]`. It writes one derived column per **join × fetched name**, spelled `<relationColumn>_<column>`, onto the table that holds the pointing columns.

**The law: the relation is the permission AND the join.** Which columns this produces is never typed in — the record names the two tables and WHAT to fetch, and the ties are read off the DECLARED relations pointing from `table` at `from` (`../def/README.md`, law 6). `edges.source → nodes.id` is what makes `source_x` exist. A record that could name its own join could name one nobody declared, and the relation would stop being the permission.

This is a **general door**, not a network feature: a sales table brings its customer's `region` over the same way, and nothing in the file knows what a node is.

### What it refuses

| the problem | the sentence |
|---|---|
| nothing points that way | `analysis "ends" brings x, y over from "nodes", but no declared relation points from "edges" at "nodes" — declare the relation first` |
| declared on another table | `analysis "ends" writes onto table "edges", but this act reads table "cells" — declare it on "edges"` |
| a tie on a column this table lacks | `analysis "ends" follows column "target", which table "edges" does not have — the columns are source, weight` |
| the fetched column is not over there | `analysis "ends" brings y over from "nodes", which has no such column — compute it there first` |
| the key names two rows over there | `analysis "bring:cells:population" brings columns over from "population" by its key "jurisdiction", which is not unique — "Texas" names 2 rows there; a key that names two rows names neither, so bring the columns over from a table that holds one row per "jurisdiction"` |

The first three are `judgeTable`, so nothing moves and the session files an ordinary `guard-failed` gap. The last two are raised at run time — no hook this library has can see the related table's rows — and still before the commit, so the act does not happen either way. A produced name landing on a DECLARED source column is judged where that law already lives, in the session's `writeColumns`: it is the only judge that can tell a declared column from one an earlier act derived, which is what lets this analysis be re-run over its own output.

### The counters

A row whose endpoint names nothing in the related table gets `null` — and is COUNTED. The counters ride the analysis's own committed state, one entry per join column, in [`../data/fold.ts`](../data/fold.ts)'s shape:

```ts
{ source: { total: 2, counted: 2, skipped: 0 }, target: { total: 2, counted: 1, skipped: 1 } }
```

A silent null is a lie about how many rows the answer really covers. An EMPTY related table is not a refusal but honest emptiness: every row skipped, nothing invented.

**A key that names two rows names neither.** This is the door a derived column reaches a second table through — `../derive/` has no `lookup` op, and law 12 of [`../derive/README.md`](../derive/README.md) says why — so it owes the lookup's honesty. A repeated key is REFUSED at the door, before the commit, quoting the value that repeats: whichever row an engine returned first would be a number that is right by accident. (The pure fold `bringOverColumns` still breaks a tie first-row-wins, so a caller who assembled the work by hand gets a total function; the declared act cannot get there.) A related row whose key is ABSENT is not a repeat and is not refused — it names no identity, so it is honestly unreachable rather than ambiguous.
