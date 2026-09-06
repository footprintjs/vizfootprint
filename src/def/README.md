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
analyses["a"].builtin "kmeans" is not a builtin analysis — one of groupBy | correlation | regression | clustering | formula
analyses["rate"].expression is not a formula: the formula has no rule for "%" at position 7
```

`k: 0` is the one worth pointing at: `quantileBins` throws on it. Refusing it at declaration is the difference between a sentence and a stack trace.

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

## Files

`types.ts` the schema · `validate.ts` the firewall + the parse door · `builtinAnalyses.ts` an analysis as data (the five records, their options, and the extra judge one of them carries) · `register.ts` the one registry boundary · `buildDashboard.ts` the build · `series.ts` the long-form series contract · `recordIds.ts` the id counters
