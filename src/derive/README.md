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
| reducer | `count sum mean min max distinct` — law 11 |

A row has a third shape as well as `strict: true` and `strict: false`: `reduces: true`, the six ops that fold ROWS rather than sibling arguments. Which shape an op has is read off the table and never guessed.

**Three names are reserved**, and each is refused with the reason rather than as an unknown word — a person who asks for one has understood the model and is somewhere else:

```
the op "lookup" is reserved: a lookup reads a SECOND table, and only a declared relation may permit that — declare the
  relation and bring the column over (the bringOver act), then read it here by its name
the op "today" is reserved: a column whose value depends on when it ran cannot be replayed, so this grammar has no clock
```

`today` and `now` never arrive: a replay months later has a different clock. `lookup` never arrives either, and for a better reason than "not yet" — see law 12.

**A literal whose text is an ISO date IS a date.** There is no date-literal FORM in the tree, so ISO text is the only way a date constant can be written down — and a grammar in which no date constant can be written is a grammar whose date ops cannot be used:

```ts
judgeExpr({ op: 'lt', args: [{ col: 'when' }, { lit: '2026-01-01' }] }, 'cells', columns);   // ok, boolean
judgeExpr({ op: 'concat', args: [{ col: 'region' }, { lit: '2026-01-04' }] }, 'cells', columns);
// { ok: false, problem: 'argument 2 of the op "concat" must be a string, and the value "2026-01-04" is a date' }
```

The cost is that date-looking text cannot be used as a string without saying so — `cast({ lit: '2026-01-04' }, 'string')` — and that is the right way round: a silent reading of one as the other is exactly what the calendar rule below exists to prevent. The refusal names that cast (`… — an ISO-shaped constant reads as a date; to compare it as text, cast it: …`), because a quoted string being a date is the one thing no spreadsheet person has a prior for, and a refusal without the door would read as the judge contradicting what they can see.

## Law 3 — the absence law, and it is not a dial

> **A cell is absent when it is `null`, OR when the table's declared absence column says the row is not `present`. Every op is strict: any absent input makes the result absent.**

The second half is the whole reason the law needed writing down. In the demo's own rows a `report_state` of `unavailable` sits beside `cases = 0`, and that zero is a reported nothing, not a measured zero:

```ts
const row = { report_state: 'unavailable', cases: 0, population: 1000 };
evaluateRow({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] }, row, { field: 'report_state', states: [...] });
// null — not 0
```

The absence column speaks for itself, so `eq(report_state, "unavailable")` still answers `true` on that row and `isAbsent(cases)` still answers `true`. A row whose state is missing, or is `unknown`, is not `present`: `unknown` means the source could not tell the two silences apart, and reading it as "here it is" would invent the answer the source refused to give.

Strict means strict: division by zero is absent (never `Infinity`), text where a number was declared is absent, non-ISO date text is absent. **The only ops that see absence are the four whose subject IS absence** — `isAbsent`, `coalesce`, and `if`/`case` whose condition is absent (the result is absent, because nobody knows which arm the row belongs in). Those four say `strict: false` in the table itself, so the exceptions are data and can be counted; a test pins that there are exactly four and names them. Their arms arrive UNEVALUATED, so a value arm is not held to its kind: `coalesce(cases, 0)` on a row where `cases` holds text answers with the text, not the fallback — one row cannot be told which type its declaration agreed on, and only the judge knows. `walk.ts` states the limit, and a test pins it.

**The vocabulary must be able to say `present`.** A table may use its own words for the silences, but the arithmetic reads exactly that one word to know a row reported a value, so the def door (`validateAbsence`) refuses a vocabulary without it — `states: ['not catalogued', 'unknown']` would read as absent in every cell of every row, with no sentence anywhere.

This departs from SQL's three-valued `and`/`or` deliberately — `and(absent, false)` is absent here, not `false` — which is why an engine that answers SQL's way must be wrapped rather than trusted. **The absence law is not configurable, and no engine may hold a second opinion.**

It follows that `sum(if(cond, x, null))` — when the group step lands — skips a row rather than adding a zero, and the skipped count stays honest.

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
| `div` | always float — `7 / 2` → `3.5`, never `3` |
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
const share: DerivedColumn = {
  ops: 1,
  kind: 'row',
  expr: { op: 'div', args: [{ col: 'cases' }, { op: 'sum', args: [{ col: 'cases' }] }] },
  over: { groupBy: ['disease'], where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] } },
};
// 'cases divided by (the total of cases), over each disease, counting only rows where kind is "state"'
```

Six clauses, each of which a wrong answer would look right without:

- **`groupBy: []` means the whole table**, said out loud. There is no implicit default, so no reducer ever ran over rows nobody named.
- **`where` picks the rows the reducer FOLDS, never the rows that get a value.** The demo's `cells` hold state rows, region roll-ups and a national total as ordinary rows, so `sum(cases)` over a disease double-counts unless the declaration says `where kind is "state"` — and the roll-up rows still get their disease's answer. The why-sentence prints the clause, so a caption cannot show half of what ran.
- **A row whose group key has an absence is in no group.** Its aggregate is absent and it is folded into nothing — a group named by a silence is not a group. The absence law reaches this through the same reader, so a row the table does not call `present` is in no group either.
- **A reducer SKIPS what it cannot read** — an absent value, or one that is not the kind the position wanted. That is the other side of the absence law, not an exception to it: the law is about the arguments of one row, and a reducer's rows are not its arguments. It is what makes `sum(if(cond, x, absent))` the honest SUMIF — the rows the condition did not pick add nothing rather than adding a zero nobody measured.
- **An empty tally answers for itself:** `count` and `distinct` answer `0` (counting nothing is honestly none); `sum`, `mean`, `min` and `max` answer ABSENT. A silence is not a zero.
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

## What the walker checks, and what it does not

The walker walks a tree the judge has already accepted and never re-checks what the judge settled — the division of labour `parseFormula` and `evaluateWith` already keep. What it DOES check on every row is the KIND of each value it actually finds, against the same `wants` the judge read: a column declared `number` that holds text on one row makes THAT ROW absent on every STRICT position, rather than a fabricated answer. Declarations describe; rows are what they are. The four lazy ops are the limit (law 3): their arms are unevaluated, and a `same` position agrees with the OTHER arms — the ones a lazy op must not run — so a value arm hands back what it finds.

```ts
evaluate(expr, read)                       // one tree, one reader — a columnar engine uses the same walk
evaluate(expr, read, group)                // …and a reducer node answered from beside the walk (law 11)
readerOver(read, absenceDecl)              // the absence law's second half, over any reader — the columnar walk's door
readerFor(row, absenceDecl)                // the same law over one row
evaluateRow(expr, row, absenceDecl)        // the door a caller holding rows wants
valuesOf(column, rowsOver(rows, absence))  // the whole column, grouped or not — the declaration says which
```

A reducer node reached with NO group under it is absent, rather than a number nobody could account for. The judge refuses that declaration long before a walk, so the silence is the door being total and not a path a column can take.

## Where the code lives

| file | one job |
|---|---|
| `types.ts` | the tree, the declaration (`over` included), the answers — data before code |
| `ops.ts` | THE op table: 51 rows, six fields each, plus the three reserved names |
| `dates.ts` | the calendar arithmetic: ISO parsing, MMWR and ISO weeks, truncate/add/difference |
| `judge.ts` | is this a column, and what type is it — one sentence, never a throw |
| `walk.ts` | one row through one tree, and the absence law |
| `groups.ts` | a GROUP of rows through one tree: two passes, the tallies, the broadcast |
| `words.ts` | the tree as a sentence, in the table's own words |
| `analysis.ts` | THE ACT: the record's factory — one column, judged at the cursor, landed through `analyze` |
| `index.ts` | the folder's door, with TWO edges out: `../def/builtinAnalyses.ts` takes the factory (one act), and `../def/index.ts` republishes `OPS_VERSION` plus the declaration types onto the published `vizfootprint/def` entry — public names, so renaming one is a breaking change |

## Not in this step, and why

- **`window`** — needs an ordering as well as a group, and an ordering is not in this version. Refused by name.
- **`lookup` as an OP** — not deferred: ruled out. Law 12.
- **`{ param }`** — reserved in the design, refused here.
- **A count of what a reducer skipped** — the fold knows how many rows it could not read; nothing carries that number out yet. `bringOver`'s per-join counters are the shape it should take when it does.
- **A gap CODE for the not-unique refusal** — `derive-lookup-not-unique` is a sentence today, thrown at `bringOver`'s door before the commit. Turning the derive sentences into codes is the codes packet, and this one will join them there.
- **`absentBy` counting** — the recorder that counts absences per column and per input. The walk that would count them is here; the header that would print them is not.
- **A published subpath of its own** — the folder RUNS as one act (`../def/builtinAnalyses.ts`), never op by op; what a def author must be able to write down (the declaration types and `OPS_VERSION`) already crosses into `vizfootprint/def`, and that is the whole public surface.
- **The other eleven column slots** — `label`, `unit`, `format`, `aliases`, `parse`, `order`, … See Law 8: none is a computation, and this folder computes.
- **A shape-only judge** — a tree is judged against a table, so a record whose tree names an op that does not exist is refused at declaration and nowhere else. A hand-built log that was never judged fails at re-performance instead, and the replay files that as an act it could not perform, naming the throw.
