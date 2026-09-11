# derive — the grammar of a derived column

A derived column is a **declaration**: three node forms, fifty-one ops, and nothing else. This folder is the grammar itself — the tree, the table of ops, the judge that says whether a declaration is a column and what type it is, the walker that takes one row through it, and the fold that takes a GROUP of rows through it.

The column verb's other slots and the lineage record are steps after this one, and each is refused BY NAME below rather than half-built. A second TABLE is not a step after this one at all: reaching one is an act (`../analysis/bringOver.ts`), and law 12 says why.

## Law 1 — the tree is closed, and it is data

Three node forms, and there is no fourth:

```ts
{ col: 'cases' }                                     // read a column of the row
{ lit: 100000 }                                      // a constant, written down
{ op: 'div', args: [ … ], calendar: 'mmwr' }         // one op of the table, applied
```

```ts
// cases / population * 100000
const expr: Expr = {
  op: 'mul',
  args: [{ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, { lit: 100000 }],
};
```

Closed in the TYPE as well as in the judge: each form names the other forms' keys as `never`, so `{ col: 'cases', op: 'sum', args: [...] }` — the shape a spread over an existing node produces — does not compile, and the judge refuses the same node at the JSON door (`… names col and op at once`), where a type cannot reach.

Never an expression string, never a function, never a raw-SQL or JavaScript escape hatch. Every tool that admits one admits that provenance dies there: it can say what a column was called and never what it MEANT. A tree can be read, judged, replayed, put into a sentence, and shown to somebody who was not in the room.

This is the same argument the shipped formula (`../analysis/formula.ts`) makes about `eval`, one level up: that file refuses to run a person's TEXT, and this one refuses to hold anything that is not already a tree. The formula's parser is the right front door for text a person types; its output is a `FormulaNode`, and translating one into this tree is a later step, not a second grammar.

## Law 2 — the op table is the vocabulary, in numbers AND in words

Every op is one row of `ops.ts`, and a row carries six things as DATA: the arity in numbers (`least`, `most`, `odd`), **the arity in words** (`takes`), what each position wants (`wants`, `repeat`), the result-type rule (`yields`), the fold owner (`of`) and the words owner (`words`).

```ts
mod: { category: 'arithmetic', least: 2, most: 2, takes: 'two arguments', wants: ['number', 'number'],
       repeat: 'last', yields: 'number', words: (a) => `the remainder of ${a[0]} divided by ${a[1]}`,
       strict: true, of: (c) => num(c, 0) % num(c, 1) }
```

**`yields` is load-bearing beyond the walker.** It used to be read only here — by the judge, to settle a derived column's type. It is now also read by the DEF door: `resultTypeOf` (`./resultType.ts`) applies the same rule to an aggregate's measures so a minted table's columns arrive at the encoding plane TYPED (`../def/README.md`, "Layers", law 5a). Two consequences for anybody adding or changing a row. First, a `yields` that is wrong is now wrong at the def door too — a channel would accept a binding it should refuse, or refuse one it should accept, before a single row is folded. Second, `resultTypeOf` is TOTAL where the judge refuses: it answers `'unknown'` for anything it cannot settle without running, so a new row needs no edit there, and `'args'` — "the type of what I reduce" — is resolved from the parent's declared columns, or `'unknown'` when the parent never said. The one owner of the rule is `yieldOf` in `./judge.ts`, which both readers call. `resultTypeOf` also keeps the two structural laws that sit BESIDE `yields` in the judge — an `ordered` position needs a type that has an order (a `min`/`max` over a boolean is refused, not merely disagreed with) and a reducer may not stand inside another reducer's own argument — because a type answer for a tree the judge refuses outright, whatever its type, would be exactly the confident wrong answer this reader exists to never give.

The arity is written twice because neither should have to be derived from the other — the formula's own function table settled that, and it is why its refusals read like sentences. Adding an op is adding a row: the judge, the walker and the sentence writer all read the table and none of them needs an edit — plus the one edit outside the table, `OPS_VERSION` in `types.ts`, because a new row grows the vocabulary and a record written against it must not claim to be the old one. A build reads only declarations written against its own version; any other is refused by name.

**Fifty-one ops, in nine categories:**

| category | ops |
|---|---|
| arithmetic | `add sub mul div mod` |
| compare | `eq ne lt lte gt gte between` |
| logic | `and or not` |
| conditional / absence | `if case coalesce isAbsent` |
| number | `round abs floor ceil rowMin rowMax` — the last two over anything ordered, like `min`/`max`: the earlier of two dates is a date |
| string | `concat lower upper trim length contains startsWith endsWith in split substring replace` |
| date | `year month week dayOfWeek dateDiff dateAdd dateTrunc` |
| cast | `cast` |
| reducer | `count sum mean min max countDistinct` — law 11 |

A row has a third shape as well as `strict: true` and `strict: false`: `reduces: true`, the six ops that fold ROWS rather than sibling arguments. Which shape an op has is read off the table and never guessed.

**Five names are reserved**, and each is refused with the reason rather than as an unknown word — a person who asks for one has understood the model and is somewhere else:

```
the op "lookup" is reserved: a lookup reads a SECOND table, and only a declared relation may permit that — declare the
  relation and bring the column over (the bringOver act), then read it here by its name
the op "today" is reserved: a column whose value depends on when it ran cannot be replayed, so this grammar has no clock
the op "distinct" is reserved: distinct names the different values themselves, a set this grammar cannot hold yet — to COUNT them, write countDistinct
the op "avg" is reserved: this grammar names the average mean — write mean
```

`today` and `now` never arrive: a replay months later has a different clock. `lookup` never arrives either, and for a better reason than "not yet" — see law 12. `distinct` is the one name held for LATER, and it is held rather than taken because the SQL word names the different values themselves — a set, which no column can hold yet — so the reducer that counts them is `countDistinct`: a count under the set's name would have to change meaning the day the set arrived, and nothing has shipped carrying the old word. `avg` is the shortest walk of the five: the average is here, and `mean` is the one reducer whose name is not the word SQL, dbt, Cube and Malloy use, so it is the one a person types wrong.

The op vocabulary is versioned (`OPS_VERSION`), and adding a row moves the number — with ONE pre-release exception, stated beside the table and ending at the first published build: while nothing is published there are no records in the wild for a version to protect, so a word may be RENAMED without moving it provided the old word lands in `RESERVED_OPS` naming the new one. That redirect is a better sentence than a version refusal, which would refuse every sound `sum` written yesterday and send nobody anywhere.

**A literal whose text is an ISO date IS a date.** There is no date-literal FORM in the tree, so ISO text is the only way a date constant can be written down — and a grammar in which no date constant can be written is a grammar whose date ops cannot be used:

```ts
judgeExpr({ op: 'lt', args: [{ col: 'when' }, { lit: '2026-01-01' }] }, 'cells', columns);   // ok, boolean
judgeExpr({ op: 'concat', args: [{ col: 'region' }, { lit: '2026-01-04' }] }, 'cells', columns);
// { ok: false, problem: 'argument 2 of the op "concat" must be a string, and the value "2026-01-04" is a date' }
```

The cost is that date-looking text cannot be used as a string without saying so — `cast({ lit: '2026-01-04' }, 'string')` — and that is the right way round: a silent reading of one as the other is exactly what the calendar rule below exists to prevent. The refusal names that cast (`… — an ISO-shaped constant reads as a date; to compare it as text, cast it: …`), because a quoted string being a date is the one thing no spreadsheet person has a prior for, and a refusal without the door would read as the judge contradicting what they can see.

## Law 3 — the absence law, and it is not a dial

> **A cell is absent when it is `null`, OR when the state column GOVERNING that column says the row is not `present`. Every op is strict: any absent input makes the result absent.**

The second half is the whole reason the law needed writing down. In the demo's own rows a `report_state` of `unavailable` sits beside `cases = 0`, and that zero is a reported nothing, not a measured zero:

```ts
const row = { report_state: 'unavailable', cases: 0, population: 1000 };
evaluateRow({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, row, { field: 'report_state', states: [...] });
// null — not 0
```

A state column speaks for itself, so `eq(report_state, "unavailable")` still answers `true` on that row and `isAbsent(cases)` still answers `true`. A row whose state is missing, or is `unknown`, is not `present`: `unknown` means the source could not tell the two silences apart, and reading it as "here it is" would invent the answer the source refused to give.

Strict means strict: division by zero is absent (never `Infinity`), text where a number was declared is absent, non-ISO date text is absent. **The only ops that see absence are the four whose subject IS absence** — `isAbsent`, `coalesce`, and `if`/`case` whose condition is absent (the result is absent, because nobody knows which arm the row belongs in). Those four say `strict: false` in the table itself, so the exceptions are data and can be counted; a test pins that there are exactly four and names them. Their arms arrive UNEVALUATED, so a value arm is not held to its kind: `coalesce(cases, 0)` on a row where `cases` holds text answers with the text, not the fallback — one row cannot be told which type its declaration agreed on, and only the judge knows. `walk.ts` states the limit, and a test pins it.

**The vocabulary must be able to say `present`.** A table may use its own words for the silences, but the arithmetic reads exactly that one word to know a row reported a value, so the def door (`validateAbsence`) refuses a vocabulary without it — `states: ['not catalogued', 'unknown']` would read as absent in every cell of every row, with no sentence anywhere.

This departs from SQL's three-valued `and`/`or` deliberately — `and(absent, false)` is absent here, not `false` — which is why an engine that answers SQL's way must be wrapped rather than trusted. **The absence law is not configurable, and no engine may hold a second opinion.**

It follows that `sum(if(cond, x, null))` — when the group step lands — skips a row rather than adding a zero, and the skipped count stays honest.

### Silence belongs to a COLUMN, not to the row

The walker asks the port (`../data/silence.ts` · `TableSilence`) per column, never per row. A table may declare one state column per measured quantity, each naming the value columns it `governs`:

```ts
absence: [
  { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
  { field: 'mass_state',   states: ['present', 'not-measured', 'unknown'],                                          governs: ['pl_masse'] },
]
// a planet with a mass and no radius: its mass is in the sum, its radius is not
evaluateRow({ col: 'pl_masse' }, row, silenceOfDecl(absence)); // 6.4
evaluateRow({ col: 'pl_rade' },  row, silenceOfDecl(absence)); // null
```

A bare declaration means exactly what it always meant — its one state column speaks for every OTHER column of the table — and every total ever computed under one is byte-identical. A column no entry governs, a state column included, reads as it is.

### A carried number is not a default

> **The walker reads exactly `present`. A definition may opt ONE column in with `arithmetic: 'carried'`, and nothing else moves.**

`carries` says the SOURCE published a figure beside a silence — a bound, an estimate, a replaced number — so the contradiction check stops refusing that row (`../data/README.md`). Whether the ARITHMETIC adds that figure is a second question, and the answer is not a library default:

```ts
// present-only (the default): the published bound is absent, and the sum is 1.0
{ field: 'radius_state', states: [...], carries: ['upper-bound'], governs: ['pl_rade'] }
// carried: the bound reads as the number the cell holds, and the same sum is 3.0
{ field: 'radius_state', states: [...], carries: ['upper-bound'], governs: ['pl_rade'], arithmetic: 'carried' }
```

WHY per column and never a global switch: a switch would silently move every total this library has ever computed, and nobody would see it move. The house law is **declare what must be explained ⇒ data** — if a dashboard wants published estimates inside its sums, that belongs in the declaration where a reader can see it, not in a default nobody chose. A carried state whose cell holds no number is still absent: the gate opens and the arithmetic edge judges the cell it finds.

## Law 4 — calendars are data

`week` and `dayOfWeek` MUST name their calendar, on the node, in the declaration, replayed with it:

```ts
wordsFor({ op: 'week', args: [{ col: 'report_date' }], calendar: 'mmwr' });
// 'the week of report_date on the mmwr calendar'

evaluateRow({ op: 'week', args: [{ col: 'd' }], calendar: 'iso'  }, { d: '2026-01-03' });  // 1
evaluateRow({ op: 'week', args: [{ col: 'd' }], calendar: 'mmwr' }, { d: '2026-01-03' });  // 53
```

Both answers are legitimate week numbers for the same day, and a column that does not say which one it counted agrees with nothing while disagreeing SILENTLY — with the source's own `week` column, with every time axis drawn from it, and with any join back onto it. So a missing calendar is a refusal, not a default:

```
the op "week" must say which calendar counts its weeks — one of iso, mmwr — because a week number that does not say agrees with nothing and disagrees silently
the op "add" does not count on a calendar, so it may not name one — only week, dayOfWeek and a dateTrunc by week do
```

`dateTrunc` needs one only when its unit is `week`; the other three units begin where every calendar agrees they begin. Two companions live in `dates.ts` for the same reason: **a date is an ISO string** (`cast(to date)` answers with one, never a `Date`), and **there is no clock** anywhere in the folder.

## Law 5 — the answers are pinned, not the engine's

An op whose answer moves with the engine is not one answer. Each is named beside its row:

| op | pinned |
|---|---|
| `round` | half **away from zero** — `0.5` → `1`, `-0.5` → `-1` (DuckDB's half-to-even is a different answer and must be wrapped) |
| `mod` | the sign follows the **dividend** — `-7 mod 3` → `-1`, SQL's and JavaScript's `%`. Excel and Sheets `MOD` follow the divisor and answer `2` |
| `div` | always float — `7 / 2` → `3.5`, never `3`. Postgres's own `div(y, x)` and MySQL's `DIV` are INTEGER division and answer `3`; this is `/` |
| compare | by **code unit**; no collation, no locale (which is also why ISO dates compare chronologically) |
| `lower` / `upper` | the Unicode **default** case mappings, never the locale-sensitive ones |
| dates | non-ISO date text is **absent**; `2026/01/04` is not a date here, whatever `Date.parse` says, and a `T` must be followed by a time. The arithmetic writes only the four-digit years its own reader reads back — a day past `9999-12-31` is absent, never spelled wrong. A column of `Date` objects (the only column the engine calls a `date`) enters as its UTC ISO day |
| `between` | both ends included |
| `split` | answers with one PIECE, counted from 1; absent when there is no such piece |
| `substring` | the start counts from 1; a start before the first character, or a negative length, is absent |
| `replace` | every occurrence, not the first — and replacing nothing changes nothing, the way `SUBSTITUTE` answers |
| `cast` | to a number reads **decimal notation only** — `" 12 "` is 12, `"0x10"` is absent, never 16: a reading, never a salvage |
| `min` / `max` | over a group that held two KINDS: **absent**, in either row order — a group nobody can put in one order has no smallest |
| `dateAdd` | month and year arithmetic clamps — 31 January plus one month is 28 February |
| `dateDiff` | whole units, truncated toward zero — 31 January to 28 February is 0 months |
| `length` | code units |

Where an engine cannot match a pinned answer the op is **refused on that engine** (`derive-unsupported-on-engine`, when the codes land), never approximated: a wrong number that looks right is worse than a refusal naming the op and the engine. The conformance fixture in `derive.test.ts` carries a negative modulus, a `.5` rounding, an integer division and a non-ISO date, exactly as the design asks.

## Law 6 — judge before anything moves, and the type is computed

One judgement, at declaration, against the table the column will read, with nothing moved. It answers with the type and the columns read, or with ONE sentence:

```ts
judgeExpr({ op: 'div', args: [{ col: 'cases' }, { col: 'region' }] }, 'cells', columns);
// { ok: false, problem: 'argument 2 of the op "div" must be a number, and the column "region" is a string' }
```

The type is **computed from the op table**, never tallied from the values afterwards — which is what lets a column that is absent on every row still know it is a number, and a column whose bytes are ISO strings still know it is a date. The column types it judges against are the ENGINE's own (`ColumnInfo`), so a column this refuses is a column the dashboard also calls text: there is no second sniffer.

Every refusal, in the judge's own words:

| what was declared | the sentence |
|---|---|
| `{ op: 'sqrt', args: [...] }` | `there is no op named "sqrt" — the ops this version knows are add, sub, …` |
| `{ op: 'sum', args: [...] }` | `the op "sum" is reserved: a reducer needs a group to run over, … ` |
| `{ op: 'add', args: [x] }` | `the op "add" takes two arguments, and it was given 1` |
| `{ op: 'case', args: [a, b, c, d] }` | `the op "case" takes a condition, its value, any further condition/value pairs, and one final fallback, and it was given 4` |
| `{ op: 'add', args: { … } }` | `the op "add" carries its arguments in a list, and this one carries {"a":1}` |
| `{ op: 'not', args: [{ col: 'cases' }] }` | `argument 1 of the op "not" must be a boolean, and the column "cases" is a number` |
| `{ op: 'add', args: [{ col: 'cases' }, { lit: null }] }` | `argument 2 of the op "add" must be a number, and the value null is a written-down absence, which has no type — one may stand only where an op does not pin one: inside coalesce, an if arm or a case fallback` |
| `{ op: 'eq', args: [{ col: 'cases' }, { lit: 'x' }] }` | `the op "eq" needs its arguments to be of ONE type, and the value "x" is a string where the column "cases" is a number` |
| `{ op: 'lt', args: [b1, b2] }` | `the op "lt" puts its arguments in an order, and a boolean has none — the types that do are number, string, date` |
| `{ op: 'coalesce', args: [{ lit: null }, { lit: null }] }` | `the op "coalesce" was given nothing but absences, so nothing in it says what type the column would be` |
| `{ op: 'dateTrunc', args: [d, { col: 'unit' }] }` | `argument 2 of the op "dateTrunc" is the unit it counts in, written down as one of year, month, week, day — and it was given {"col":"unit"}` |
| `{ col: 'deaths' }` | `this column reads "deaths", which table "cells" does not have — it has cases, population, region` |
| `{ col: 'blank' }` (all-absent column) | `this column reads "blank", which table "cells" holds as unknown — a derived column reads columns whose type is known` |
| `{ op: 'concat', args: [{ col: 'region' }, { lit: '2026-01-04' }] }` | `argument 2 of the op "concat" must be a string, and the value "2026-01-04" is a date — an ISO-shaped constant reads as a date; to compare it as text, cast it: { op: "cast", args: [{ lit: "2026-01-04" }, { lit: "string" }] }` |
| `{ op: 'toString', args: [] }` | `there is no op named "toString" — the ops this version knows are add, sub, …` (a name only `Object.prototype` knows is not a row) |
| `{ col: 'cases', op: 'sum', args: [...] }` | `a node of a derived column is one of {col}, {lit} or {op, args}, and this one names col and op at once` |
| `{ lit: [1, 2] }` | `a {lit} node holds a number, a string, a boolean or null, and this one holds [1,2]` |
| `{ param: 'year' }` | `named parameters are reserved and not built — a column reads its table, and everything else it needs is written down in it` |
| `42` | `a node of a derived column is one of {col}, {lit} or {op, args}, and this one is 42` |
| a tree nested 33 deep | `this tree nests more than 32 deep — a column nobody can read back is a column nobody can check` |
| a shared subtree walked 8191 times | `this tree has more than 4096 nodes in it — a column nobody can read back is a column nobody can check` (the depth bounds the shape; this bounds the work) |
| `{ ops: 1, kind: 'row', expr, ovr: { … } }` | `a derived column names ops, kind, expr and over, and this one also names "ovr"` |
| `{ ops: 2, … }` | `this column is written against ops 2, and this build knows ops 1` |
| `{ kind: 'aggregate', expr: { op: 'add', … } }` | `an aggregate column is one a reducer folds, and this one holds none — a reducer needs to say which rows it runs over — declare over: { groupBy: [...] }, and an empty groupBy means the whole table` |
| `{ kind: 'window', … }` | `a window column needs an ordering as well as a group, and an ordering is not in this version` |
| `{ kind: 'shared', … }` | `a derived column's kind is row or aggregate, and this one says "shared"` |
| `{ op: 'sum', args: [{ col: 'cases' }] }` with no `over` | `the op "sum" folds many rows into one answer, and a reducer needs to say which rows it runs over — declare over: { groupBy: [...] }, and an empty groupBy means the whole table` |
| `{ over: { groupBy: ['ghost'] }, … }` | `this column groups by "ghost", which table "cells" does not have — it has cases, population, region` |
| `{ over: { groupBy: ['blank'] }, … }` | `this column groups by "blank", which table "cells" holds as unknown — a column groups by columns whose type is known` (in the group's words, never the read's) |
| `{ over: { groupBy: [], where: { col: 'cases' } }, … }` | `over.where says which rows the reducer runs over, so it must come to a boolean, and this one comes to a number` |

The rest of the group's own refusals — a reducer inside a reducer, a reducer in `over.where`, and the kind law in both directions — are in law 11.

A refusal quotes the offending value and says what is known. Nothing here throws: `judgeExpr` and `judgeDerivedColumn` are total over any value, including `undefined`, a function, and an object that cannot be written down at all.

## Law 7 — the sentence comes from the table

```ts
wordsFor({ op: 'mul', args: [{ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, { lit: 100000 }] });
// '(cases divided by population) times 100000'
```

The why-fragment is a field of the same row that carries the fold, so **the sentence cannot drift from what ran**. A second description written somewhere else would agree with the numbers only until one of them was edited. A nested op is parenthesised so a reader cannot mistake the grouping, and a written-down word is said bare (`the start of the month containing report_date`). A string value is written the way the judge writes it (`JSON.stringify`), so one holding a quote still has a beginning and an end; the group clause is set off by a comma, so it reads as governing the reducers and not the last noun of the tree. The sentence says a tree the judge has already accepted — a caller holding unjudged bytes judges them first.

## Law 8 — the act lands through `analyze`, because the ten verbs are frozen

There are ten dispatch verbs (`../def/types.ts`, `DISPATCH_VERBS`) and the eleventh is reserved. The design this folder grew from asks for a `column` verb; **this step mints none, and needs none.** A declared column is an analysis in every sense the session already means — it reads one table, produces the `columns` channel, lands one commit, and re-enters the data space as an ordinary filterable column at the act's own slot — so it lands through the door `formulaAnalysis` has been standing in since the formula shipped:

```ts
analyses: {
  rate: {
    builtin: 'derive',
    table: 'cells',
    name: 'rate',
    column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { col: 'population' }] } },
  },
}
// …or brought by the act itself, with nothing declared first:
session.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', … }, cause });
```

What the eleventh verb was really wanted for is the OTHER eleven slots of a column — `label`, `type`, `role`, `scale`, `unit`, `format`, `aliases`, `parse`, `description`, `absence`, `order`. **None of those is a computation**, none of them lands values, and every one of them is prose or presentation. When that packet is built it will need its own home; a `formula` slot on it would be a second way to say what this one already says, and prose and computation must never share a fold key.

**The record is data all the way down**, which is what makes the act replayable: `{ builtin, table, name, column: { ops, kind, expr } }` rides on the commit's own value slot, so a replay rebuilds the module from the bytes with nothing registered on the session first — the whole reason the tree is a tree and never an expression string.

The absence vocabulary is **not** in the record. It is the def's (`data[<table>].absence`) and arrives beside it as context, exactly as a relation does for `bringOver`: a record that could name its own absence column could name one nobody declared.

## Law 9 — the type is computed at declaration; a replay re-performs, it does not re-decide

The judge is the one door that sees both the tree and the table's columns, so it is where the type is settled — never tallied from the values afterwards. The act carries that type out on its `ColumnsOutput`, which is why a derived column may be `boolean` or `date`, types arithmetic could never produce.

A replay re-performs an act that already happened and does not re-judge it, so a column rebuilt from the record's bytes in a FRESH session carries its values and says **`unknown`** for its type rather than inventing one from the bytes it just wrote (a same-session replay re-runs the module the declaration judged, and keeps its type). Naming the type on a replayed column is the packet that makes the declared type survive the write; this one refuses to guess. The one thing the run path does judge is the vocabulary version: a declaration written against another `ops` is refused at `build()` with the judge's own sentence, because a replay is the one door it would otherwise walk through under this build's meanings. The declared absence column is judged too — against the table, at the same door as the tree — since a name the table does not have would blank every row with no sentence anywhere.

One consequence worth knowing before writing a date column: the engine calls a column of ISO **text** a `string` (only a column of `Date` objects is a `date` — `../data/fold.ts`, `TypeTally`), so a date op over source text is refused until it is cast. That is the grammar working, not fighting — and a column that really IS a `date` walks as each `Date`'s UTC ISO day (`isoOfMoment`), so the one column shape that satisfies a `date` want directly is one the walk can read:

```ts
// refused: argument 1 of the op "week" must be a date, and the column "report_date" is a string
{ op: 'week', args: [{ col: 'report_date' }], calendar: 'mmwr' }
// the honest spelling — and `cast(to date)` yields an ISO string, never a Date
{ op: 'week', args: [{ op: 'cast', args: [{ col: 'report_date' }, { lit: 'date' }] }], calendar: 'mmwr' }
```

## Law 10 — a refusal about a column says so, in its own code

A declared column's refusals land on the gap ledger under the derive taxonomy rather than the general codes, because an agent has to be able to tell a declaration it can repair from a source it cannot reach without parsing a sentence. An analysis claims the taxonomy in one inert word (`AnalysisDef.refusalTaxonomy: 'derive'`), and the session reads it when it files.

| code | when |
|---|---|
| `derive-invalid` | the declaration is not a legal column: every sentence in Law 6's table, plus a name the base store already holds (`a computed column may not take a source column's name`) |
| `derive-source-refused` | the rows behind it could not be read — the table refused, was never opened (`no provider for table "…"`), or could not say which columns are its own. All three file under this code, the write-back arms included |

**Six of the design's ten codes are deliberately NOT minted**, because a code nothing can file is a promise the library cannot keep. Each is named here with the packet that owns it:

| not minted | who owns it |
|---|---|
| `derive-input-missing`, `derive-type-changed`, `derive-name-shadowed`, `derive-stale` | lazy re-derivation after a refresh — all four are answers about a version that MOVED, and no derived column is stamped with one yet |
| `derive-lookup-not-unique` | the `lookup` question. Today the refusal belongs on `bringOver`, which takes the first row silently (`../analysis/bringOver.ts`) |
| `derive-unsupported-on-engine` | a second engine that evaluates the tree itself. There is one walker today, so no engine can disagree with it |

## Law 11 — the group is declared beside the tree, and the word a column says about itself is a fact

A reducer reads rows the row it is on knows nothing about, so it needs to say WHICH rows. That is `over`, and it rides the declaration:

```ts
// each state cell's share of its disease's national total
const share: DerivedColumnDecl = {
  ops: 1,
  kind: 'row',
  expr: { op: 'div', args: [{ col: 'cases' }, { op: 'sum', args: [{ col: 'cases' }] }] },
  over: { groupBy: ['disease'], where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] } },
};
// 'cases divided by (the total of cases), over each disease, counting only rows where kind is "state"'
```

Six clauses, each of which a wrong answer would look right without:

- **`groupBy: []` means the whole table**, said out loud. There is no implicit default, so no reducer ever ran over rows nobody named. It is a group the DECLARATION names rather than one a value named, so it exists whether or not a row reached it: a grand total nothing folded into is one row saying `0`, never no row — the answer SQL, Malloy and dbt all give. A NAMED group nothing folded into is still no row.
- **`where` picks the rows the reducer FOLDS, never the rows that get a value.** The demo's `cells` hold state rows, region roll-ups and a national total as ordinary rows, so `sum(cases)` over a disease double-counts unless the declaration says `where kind is "state"` — and the roll-up rows still get their disease's answer. The why-sentence prints the clause, so a caption cannot show half of what ran.
- **A row whose group key has an absence is in no group.** Its aggregate is absent and it is folded into nothing — a group named by a silence is not a group. The absence law reaches this through the same reader, so a row the table does not call `present` is in no group either.
- **A reducer SKIPS what it cannot read** — an absent value, or one that is not the kind the position wanted. That is the other side of the absence law, not an exception to it: the law is about the arguments of one row, and a reducer's rows are not its arguments. It is what makes `sum(if(cond, x, absent))` the honest SUMIF — the rows the condition did not pick add nothing rather than adding a zero nobody measured.
- **An empty tally answers for itself:** `count` and `countDistinct` answer `0` (counting nothing is honestly none); `sum`, `mean`, `min` and `max` answer ABSENT. A silence is not a zero.
- **The basis is the FULL table, always** — never the live selection. A per-selection aggregate is a measure (`ViewQuery.reduce`), not a column; a column that moved with the selection would be a number nobody could replay.

**The kind law.** `kind` is not a label somebody chose, and the judge holds a declaration to it in both directions. A column is an AGGREGATE when it is the same on every row of its group — it holds a reducer, and every column it reads outside one is a grouping column, which cannot vary within the group by definition. Malloy's dimension/measure split, made checkable:

```
this column says it is an aggregate, and it reads "cases" outside its reducers — a column that changes within its own group is a row column
this column says it is a row column, and every part of it is the same on every row of its group — that is an aggregate
this column names a group and holds no reducer, so the group would fold nothing — a group is the rows a reducer runs over
the op "max" stands inside another reducer, and a reducer inside a reducer has no rows of its own to run over
the op "mean" folds many rows into one answer, and over.where picks the rows a group is made of, so it cannot itself ask what a group came to
```

A reducer's ARGUMENT is an ordinary row tree, judged with reducing switched off — which is both the nesting refusal above and the reason `sum(if(…))` is legal. `min` and `max` answer with the type they were given (the smallest date is a date); the other four answer with a number.

## Law 12 — `lookup` is not a missing op, it is an act that already exists

The design asks for a `lookup` node carrying `from: { table, key, value }`. This grammar does not have one, and will not, for two reasons that are not "not yet".

**It would name its own join.** A node carrying `{ table, key, value }` could name a join nobody declared, and the relation would stop being the permission (`../def/README.md`, law 6). Everything else in this library that reads a second table resolves it through `relationsFrom` and cannot ask for one that was not declared.

**It would be a second door onto one act.** `bringOver` already carries a column across a declared relation, and what it lands is an ordinary column: filterable, visible at the cursor, carrying the act that made it, rebuilt by a replay from the record's bytes. A `lookup` node would compute the same value inline, off the trace, with no commit to point at — the exact thing the act was written to stop.

So the enrichment case is **two acts, not one node**, and it is the one the design says could not be built without a lookup:

```ts
relations: [{ from: { table: 'cells', column: 'jurisdiction' }, to: { table: 'population', column: 'jurisdiction' } }],
analyses: {
  bringPopulation: { builtin: 'bringOver', table: 'cells', from: 'population', columns: ['population'] },
  // → lands `jurisdiction_population` on cells, at that act's own slot
  casesPer100k: {
    builtin: 'derive',
    table: 'cells',
    name: 'cases_per_100k',
    column: { ops: 1, kind: 'row', expr: { op: 'mul', args: [{ op: 'div', args: [{ col: 'cases' }, { col: 'jurisdiction_population' }] }, { lit: 100000 }] } },
  },
}
```

It works because a derived column is judged against the columns visible AT THE CURSOR, which include what an earlier act derived. Two commits, two sentences, one number.

The refusal names the door rather than the step, so the sentence is a direction:

```
the op "lookup" is reserved: a lookup reads a SECOND table, and only a declared relation may permit that — declare the
  relation and bring the column over (the bringOver act), then read it here by its name
```

**What this cost `bringOver`, and it has now been paid.** If it is THE lookup, it owes the lookup's honesty. Until this step it followed a repeated key with first-row-wins and said nothing; now the key must be an identity, and a repeat is refused at the door, before the commit, quoting the value that names two rows:

```
analysis "bring:cells:population" brings columns over from "population" by its key "jurisdiction", which is not unique —
  "Texas" names 2 rows there; a key that names two rows names neither, so bring the columns over from a table that
  holds one row per "jurisdiction"
```

A related row whose key is ABSENT is not a repeat and is not refused: it names no identity, so it is honestly unreachable rather than ambiguous, and the per-join counters already report every row that reached nothing.

## Law 13 — an aggregate is an act AND a derived dataset

A derived COLUMN lands on the table it reads. An AGGREGATE lands a TABLE beside it: one row per group, cut from the rows visible at its cursor, recorded as one commit whose record carries the parent, the group columns, the measures and an optional filter — and replayed from those bytes, never from serialised rows. The measures ARE the reducers of law 11, judged by the one judge under the kind law's aggregate half, so a measure and a grouped column say the same thing in the same words:

```ts
analyses: {
  byDisease: {
    builtin: 'aggregate',
    table: 'cells',
    name: 'by_disease',
    ops: 1,
    groupBy: ['disease'],
    measures: [
      { as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } },
      { as: 'areas', expr: { op: 'countDistinct', args: [{ col: 'jurisdiction' }] } },
    ],
    where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] },
  },
}
// 'total = the total of cases; areas = how many different jurisdiction there are, over each disease, counting only rows where kind is "state"'
```

Five clauses:

- **Computed once, at its cursor.** The session hands in the rows the selection folded to when the act was declared; a later selection does not recompute it — a new act does. The fold itself (`groupRowsOf`) is pass one of law 11 stopping before the broadcast, so a group exists exactly when at least one of its rows folded in, and the groups come out in first-seen row order.
- **Three outcomes, distinct.** EMPTY — zero groups — is an honest table that LANDS (`{ ok: true, output: { rows: [] } }`); a degenerate result means no honest fit, not zero rows. UNAVAILABLE — the parent's engine refused the read — is `{ ok: false, reason: 'unavailable', rejection }` (`../analysis/types.ts`), the act never performed. REFUSED is the judge's sentence, and nothing lands.
- **The judge says everything at once, in the aggregate's own words**, and the three things that belong to the ACT — the op version, the group columns and the filter — are each said ONCE, never once per measure. A measure is named only for what a measure owns; `where` is refused under the key the record spells it with, and reads inside it are refused under that key too (`where reads "ghost"`), because the aggregate's declaration has no column in it. The version is said first and alone: measures written against a vocabulary this build does not have cannot be judged by its op table at all.

```
this aggregate groups by "ghost", which table "cells" does not have — it has id, region, kind, cases
this aggregate groups by "region" twice, and a table can only group by it once
where says which rows the reducer runs over, so it must come to a boolean, and this one comes to a number
the op "sum" folds many rows into one answer, and where picks the rows a group is made of, so it cannot itself ask what a group came to
measure "share": this column says it is an aggregate, and it reads "cases" outside its reducers — a column that changes within its own group is a row column
measure "total": this column reads "deaths", which table "cells" does not have — it has id, region, kind, cases
the measure "region" takes the name of a group column — the derived table already has a column called that
two measures are called "total", and the derived table can only hold one column of that name
this aggregate is written against ops 2, and this build knows ops 1
an aggregate lands one column per measure, and this one declares none
this aggregate keeps the absence law of "state", which table "cells" does not have — it has id, region, kind, cases
where reads "ghost", which table "cells" does not have — it has id, region, kind, cases
```

The filter's two sentences are the derived column's own (`over.where`), under the aggregate's key: `judgeGroupFilter` and `judgeOver` run the one implementation, so the two acts cannot come to hold two opinions about what a filter may say.

- **The relation back to the parent is minted, never typed** — by the session, from the record, through `../data/derivedTables.ts`: the one group column is the derived table's key. A record that could name its own relation could name one nobody declared.
- **The schema is computed, and a replay says `unknown`** — law 9, for a table: the group columns' types are the parent's own, the measures' are what their trees yield, and a fresh-session replay carries the rows and refuses to tally a type from them.
- **The declaration is also a TABLE DECLARATION, and a view may draw it.** `name` is the table it lands and `groupBy` + `measures[].as` are, in that order, the columns it lands — so a chart over the act's table is a declared chart, judged at the def door with nothing new declared anywhere. `mintedTables(def)` (`../def/builtinAnalyses.ts`) is the one reader of that; `../def/README.md` ("Layers", law 3) is the door:
  ```ts
  analyses: { byDisease: { builtin: 'aggregate', table: 'cells', name: 'by_disease', ops: 1, groupBy: ['disease'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }] } },
  encodings: [{ viewId: 'bars', chartKind: 'bar', channels: ['x', 'y'], layers: [
    { layerId: 'agg', table: 'by_disease', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'disease', y: 'total' } },
  ] }],
  // the def validates; a field the act does not land is refused — `"ghost" is not a column of the table`
  // and until the act lands, a probe on that layer is the typed gap `needs-act`, naming `byDisease`
  ```
  The columns are judged for existence AND for TYPE, because the declaration already states both: a group column keeps the parent's declared type and a measure takes what its reducer `yields` — so `y: 'disease'` on that bar earns `"disease" is string; the y channel of a bar needs a number` at the DEF door. `resultTypeOf` (`./resultType.ts`) is the reader; `../def/README.md` ("Layers", law 5a) is the law and its three rules. What the def still has no `ColumnDecl` for is FACETS: no role, no scale, no unit.

## What the walker checks, and what it does not

The walker walks a tree the judge has already accepted and never re-checks what the judge settled — the division of labour `parseFormula` and `evaluateWith` already keep. What it DOES check on every row is the KIND of each value it actually finds, against the same `wants` the judge read: a column declared `number` that holds text on one row makes THAT ROW absent on every STRICT position, rather than a fabricated answer. Declarations describe; rows are what they are. The four lazy ops are the limit (law 3): their arms are unevaluated, and a `same` position agrees with the OTHER arms — the ones a lazy op must not run — so a value arm hands back what it finds.

```ts
compile(expr)                              // the tree, planned ONCE: a closure tree with the same signature as evaluate after its first argument
evaluate(expr, read)                       // one tree, one reader — a columnar engine uses the same walk; a thin door over compile
evaluate(expr, read, group)                // …and a reducer node answered from beside the walk (law 11)
readerOver(read, absenceDecl)              // the absence law's second half, over any reader — the columnar walk's door
readerFor(row, absenceDecl)                // the same law over one row
evaluateRow(expr, row, absenceDecl)        // the door a caller holding rows wants
valuesOf(column, rowsOver(rows, absence))  // the whole column, grouped or not — the declaration says which
```

A reducer node reached with NO group under it is absent, rather than a number nobody could account for. The judge refuses that declaration long before a walk, so the silence is the door being total and not a path a column can take.

### The walker plans once per tree

Everything that is a property of the TREE — the op behind each name, what each strict position wants, which positions must agree, the thunks a lazy op hands its fold — is decided by `compile` (`walk.ts`) once, before the first row; a row pays the reads and the ops themselves. `evaluate` and `evaluateRow` are thin doors over it (the plan is remembered by the tree, so a one-row caller pays it once), and every hot loop in `groups.ts` — `valuesOf`, `groupRowsOf`, the `where` filter, the reducers' argument walks, the grouping keys — compiles before its row loop and holds the closure. Compiling assumes a JUDGED tree: the judge is untouched and not re-run, and an op the grammar does not know throws where the plan is made, as the walk always threw.

Measured, not claimed — `bench/derive` (`npm run bench:derive`; every walk arm is `valuesOf` over the Rows shape `deriveAnalysis` builds, best of 5 at 1,000,000 rows, node 22 on arm64, the floor being the same tree hand-written as a closure over the same reader):

| expression at 1M rows | before (`67720c6`) | after | floor over the reader |
|---|---:|---:|---:|
| `cases` — a bare read | 30.4 ms | 31.7 ms (unchanged, within noise) | 22.8 ms |
| `div(cases, population)` | 95.1 ms | 58.5 ms (−38%) | 33.5 ms |
| six op nodes — a `case` over a `gt` over a `div`; a `cast` over a `round` over a `coalesce` | 284 ms | 115 ms (−60%) | 32.4 ms |

The same bench found `rowsOver` building a reader — and deciding every column's gate — per ROW, at twice the columnar door's cost on a bare read (66.9 ms against 30.4 ms); it is now one reader over a moving row, the shape `deriveAnalysis` already built, and the two doors measure the same (31.5 ms). What remains between the walk and the floor is a call per node and the arithmetic edge's check per node — 3.55× on the six-op tree — and is left where it is until a brief asks for it with a threshold.

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the tree, the declaration (`over` included), the answers — data before code |
| `ops.ts` | THE op table: 51 rows, six fields each, plus the four reserved names — and `REDUCER_OPS`, the folding subset read off the table itself, which is what a measure picker offers |
| `dates.ts` | the calendar arithmetic: ISO parsing, MMWR and ISO weeks, truncate/add/difference |
| `judge.ts` | is this a column, and what type is it — one sentence, never a throw; and `columnsHave`, the one ending every refusal about a missing column shares |
| `resultType.ts` | the same question the judge answers, asked by a DOOR that may not refuse: what type does this tree land over a table's DECLARED column types — total, with an honest `'unknown'` |
| `walk.ts` | one row through one tree, and the absence law — `compile` plans the tree once, `evaluate`/`evaluateRow` are thin doors over it |
| `groups.ts` | a GROUP of rows through one tree: two passes, the tallies, the broadcast — and `groupRowsOf`, pass one stopping before the broadcast: one row per group |
| `words.ts` | the tree as a sentence, in the table's own words |
| `analysis.ts` | THE ACT: the record's factory — one column, judged at the cursor, landed through `analyze` |
| `aggregate.ts` | THE ACT's twin: the `aggregate` record's factory — one TABLE of one row per group, judged at the cursor, landed through `analyze` (law 13) |
| `index.ts` | the folder's door, with TWO edges out: `../def/builtinAnalyses.ts` takes the factory (one act), and `../def/index.ts` republishes `OPS_VERSION` plus the declaration types onto the published `vizfootprint/def` entry — public names, so renaming one is a breaking change |

## Not in this step, and why

- **`window`** — needs an ordering as well as a group, and an ordering is not in this version. Refused by name.
- **`lookup` as an OP** — not deferred: ruled out. Law 12.
- **`{ param }`** — reserved in the design, refused here.
- **Set-valued `distinct`** — the name is reserved for the op that answers the different values themselves; `countDistinct` counts them today.
- **A count of what a reducer skipped** — the fold knows how many rows it could not read; nothing carries that number out yet. `bringOver`'s per-join counters are the shape it should take when it does.
- **A gap CODE for the not-unique refusal** — `derive-lookup-not-unique` is a sentence today, thrown at `bringOver`'s door before the commit. Turning the derive sentences into codes is the codes packet, and this one will join them there.
- **`absentBy` counting** — the recorder that counts absences per column and per input. The walk that would count them is here; the header that would print them is not.
- **A published subpath of its own** — the folder RUNS as one act (`../def/builtinAnalyses.ts`), never op by op; what a def author must be able to write down (the declaration types and `OPS_VERSION`) already crosses into `vizfootprint/def`, and that is the whole public surface.
- **The other eleven column slots** — `label`, `unit`, `format`, `aliases`, `parse`, `order`, … See Law 8: none is a computation, and this folder computes.
- **A shape-only judge** — a tree is judged against a table, so a record whose tree names an op that does not exist is refused at declaration and nowhere else. A hand-built log that was never judged fails at re-performance instead, and the replay files that as an act it could not perform, naming the throw.
