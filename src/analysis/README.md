# analysis — declared analyses, and the one a person writes

An analysis is DECLARED and executed as a footprintjs flowchart, and its output re-enters the data space through one of four existing rails (`columns`, `geometry`, `scalar`, `table`) — never a row-id list, never a new dispatch verb. `defineAnalysis` is the door; `builtins.ts` holds the four a developer gets for free; `stats.ts` holds the arithmetic they share.

Four of the five are code a DEVELOPER wrote. The fifth is a sentence a PERSON typed, and that difference is what the rest of this file is about.

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
