# `make` — a spreadsheet, four steps, a desk, one file

`desk` is for a dashboard somebody has already defined. **This is the other
half: it helps a person WRITE the definition.** Paste a CSV, say what the
columns are, pick charts and bind them, and the fourth step opens a real
`Desk` — with a time strip, an editor, notes, paths and a commit log — whose
first commit is theirs. Then it publishes as one HTML file that opens with no
server.

```tsx
import { Make } from 'vizfootprint-studio/make';
import 'vizfootprint-ui/styles.css';

<Make />;
```

That is the whole host. There is nothing to configure because there is nothing
the host knows that the wizard does not: the person brings the rows, the
declarations and the charts, and everything else is the library's.

---

## The four steps are Datawrapper's, and each one is a door the library already had

| step | what a person does | the door under it |
|---|---|---|
| 1 · Bring data | paste a CSV or choose a file, and see what arrived | `describeTable` (`vizfootprint/data`) |
| 2 · Check and describe | declare each column — `{ type, role, scale, label }` — and name the absence vocabulary | `ColumnDecl` + the def's own validator |
| 3 · Visualize | take one of the charts offered, or pick a kind and bind its channels; choose an analysis, write the words | `proposeCharts` + `whatFits` (`vizfootprint/def`) |
| 4 · Open, and publish | the desk, and the file | `parseDashboardDef` → `buildDashboard` → `Desk` |

Nothing here is a new idea about dashboards. It is the shortest path through the
ones that exist, and every sentence a person reads at a step is the sentence the
library itself would have said at the same moment.

## The laws it carries — none of them invented here

**Every step judges before the next may begin, and a refusal is a sentence
naming the thing.** `judgeStep(step, draft, reading)` is the whole of it, and it
is a pure function so a host can ask without a screen.

**A column is declared, never silently demoted.** The sniffed type SEEDS step
two and answers nothing:

> `"region" has no declared role — say what it is (an identifier, a dimension or
> a measure). A column this wizard filled in for you would be a guess the
> dashboard then repeats in every sentence it writes.`

The absence column is the exception, and it is the exception because the library
says so: its role is DERIVED from the vocabulary, so the wizard does not ask,
and it leaves that column out of `data[t].columns` entirely — declaring a role
there is a refusal the def door already owns.

**Step three OFFERS before it asks.** A person who has just declared six columns
knows what those columns mean and does not yet know what they can draw — and the
encoding plane knows the second thing. So the first thing on step three is a
list of charts this table can carry, best first, each with the reason it is
offered:

> `a line — x = quarter · y = sales`
> *the x of a line takes a number or a date; "quarter" is a date and x is an
> ordered axis — time is the thing an axis reads best*
> *the y of a line takes a number; "sales" is a declared measure, and y carries
> a magnitude*

Four things about that offer, and none of them are this package's ideas:

- **`proposeCharts` makes it**, composing `whatFits` with the encoding plane's
  ranking policy. Every reason a person reads is the plane's own sentence, the
  same way every refusal under the picker is. This package contributes the two
  facts only the wizard knows: which kinds it can DRAW (`MAKE_PROPOSAL_KINDS` —
  a made bar binds `category` and counts rows, where the library's binds `x` and
  `y`, so a proposal it cannot draw is never asked for) and how many offers are
  worth reading (`MAKE_PROPOSALS`).
- **Nothing is chosen.** No offer is selected, pre-taken or defaulted; pressing
  Next with none taken is the ordinary *this dashboard has no charts yet*.
- **Taking one is the same act as building one.** `viewFromProposal` produces
  exactly what the ＋ buttons produce, into the same draft, so there is ONE path
  through `judgeStep` and a taken chart can be renamed, rebound or removed like
  any other.
- **The picker stays beneath it.** An offer is an offer; a person who wants a
  chart nobody proposed builds it the way they always did.

**A misfit is refused in a sentence, and the sentence is the encoding plane's.**
`whatFits` greys the option and prints the reason under the picker:

> `"report_state" is the declared absence column — it cannot bind to the
> magnitude channel "y"; absence is a category, never a magnitude`

**The ceiling is stated at upload**, before a file is chosen rather than after
one is loaded — because the only useful moment to hear it is while you can still
bring a smaller slice. `MAKE_CEILING_SENTENCE` says what the memory engine was
measured at (comfortable at ninety thousand rows, past the fifty-millisecond
line at a million); `ceilingVerdict(rows)` places the file against it. It is a
statement and never a refusal: the person's file is the person's.

**Custom analyses are a developer's, and the wizard says so.** The four builtins
are the ones a definition can NAME, because the record form (`{ builtin,
...options }`) is data. Anything else is a function with a `run()`, written in
TypeScript and passed to the build, and no wizard can write one for you — which
is printed on the step rather than left to be discovered.

**The page says what it carries.** A published file's front matter is measured
off the file itself: what the data is, what it unpacks to, what the payload
costs, how many acts replayed and how many bookmarks came back.

**The definition is JSON.** The suite pins it: a definition `make` produces
survives `JSON.parse(JSON.stringify(def))`, passes `parseDashboardDef`, builds,
and answers a select. That is not a nicety — it is what lets the published file
carry its own definition in a script block.

## Authoring is BEFORE the walk

`make` writes a definition. **It never edits a dashboard that already has a
log**, and that is not a limitation waiting to be lifted. A commit says what a
person did to a dashboard; if the dashboard could change underneath the log, the
log would be a record of acts on something that no longer exists.

So the desk at step four is built once. The menu's **Change the charts** goes
back to step three and builds a NEW one, and the item says what that costs —
*the acts on this one are discarded* — rather than doing it quietly.

## Publishing: one program, two roles

The file `make` hands over is **a copy of the page the wizard is running in**,
with a payload block written into it and its mount emptied. Opening that file,
the same bundle finds a payload where it found none and becomes the desk rather
than the wizard. The desk mounts through
[`vizfootprint-ui/story/page`'s `DashboardPage`](../../../ui/src/story/page/README.md)
— the same boot sequence the story page walks, one lens instead of two.

A story page has to be a BUILD because a definition's analyses are code and code
cannot ride in a script block. A made definition has no code in it, so it can —
but React, the engine and the charts still cannot, and they do not have to: they
are already in the page doing the publishing.

**Which is only true when that page is one file.** So publishing is judged
first, and refused in a sentence naming what it found:

> `this wizard is running on a page that loads its code from 3 other files
> (/assets/index-abc.js, …), so a copy of this page would open blank — publish
> from a page built as ONE file (that is what vite-plugin-singlefile is for),
> and everything the desk needs will already be in it`

A dev server is exactly that page, and this is why the wizard says so there
instead of handing someone a file that opens blank on another machine.

## Files

| file | one job |
|---|---|
| `types.ts` | THE CONTRACT — `MakeDraft` and what the four steps collect. Read it first. |
| `steps.ts` | the pure logic: the ceiling, `readTable`, the judge, the offer (`proposalsFor`), `whatFits` per channel, and the assembler. No React, no DOM. |
| `open.ts` | the door out: parse, build, open a session — and what a thrown refusal says. |
| `cells.tsx` | the charts a definition implies, drawn once for both surfaces. |
| `publish.ts` | is this page one file, what the copy of it looks like, and what it carries. |
| `panels.tsx` | steps one to three, drawn. Nothing here decides anything. |
| `Make.tsx` | the shell: the state, the walk, the desk, and the two menu items the wizard adds. |
| `MadePage.tsx` | the published page — the same definition, opened from the file it rode in. |

## What a host can drive without a screen

Every rule above is a plain function, exported beside the component, because a
flow that can only be driven by a screen is a flow nobody can test, script or
hand to an agent:

```ts
import { assembleDef, emptyDraft, judgeStep, openDesk, proposalsFor, readTable, viewFromProposal } from 'vizfootprint-studio/make';

const read = readTable(csv);                       // step 1's own door
if (!read.ok) return refuse(read.refusals);
const draft = { ...emptyDraft(), csv, columns: declaredByHand, views: [bar] };
const step2 = judgeStep('columns', draft, read.reading);
if (!step2.ok) return refuse(step2.refusals);
const offered = proposalsFor(draft).proposals;     // step 3 offers before it asks
const withOne = { ...draft, views: [viewFromProposal(offered[0], 1)] };
const opened = openDesk(assembleDef(withOne));     // parse, build, open
```

Step three judges what only the WIZARD knows — a chart exists, it is named, its
channels carry columns, and each of those fits. The definition itself is judged
by `openDesk`, which is the door out of that step: asking the library twice would
print whichever answer came first.

## Three chart kinds, and why not nine

`bar`, `line`, `table`. The encoding plane knows nine kinds and would happily
judge a heatmap — but the wizard has to RENDER what it offers, and offering a
chart it cannot keep is worse than not offering it. A developer writing their
own `charts` callback has the whole vocabulary; see [`../desk/`](../desk/).

A made bar counts the rows in view per value of its category; a made line sums
its y per bucket of its x; a made table prints the rows. Each says when it
stopped drawing (`the 40 tallest of 312`, `the first 200 of 90,300`) rather than
truncating quietly, and a missing value is a silence in all three — never a bar
called "null", never a point at zero.
