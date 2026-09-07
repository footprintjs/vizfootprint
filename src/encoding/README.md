# encoding — the encoding plane

Which column may sit on which visual channel, stated as **data** and judged by **one validator** behind **three doors**.

The interaction grammar has three planes: the data plane (which rows are in play; see `src/links`), this one (which columns on which channels), and the arrangement plane (where charts sit). This unit answers one question: *does this column fit this channel, and if not, why not* — in the same sentence for a person, an agent and a test.

## The three doors

| Door | When | What happens |
|---|---|---|
| build | `buildDashboard(def)` | a def whose initial bindings or rules break the law **throws** with the sentences — nothing is built |
| dispatch | `reencode` | the act **does not land**; the answer is a gap with the sentence, recorded in the ledger |
| lint | `lintEncodings(...)` / `lintDashboard(dashboard)` | every declared binding judged, as a list |

Same validator, same sentences, so the doors cannot disagree.

## What a def states

```ts
data: {
  cases: {
    rows,
    absence: { field: 'report_state', states: [...] },   // role absence is DERIVED from this
    columns: {                                            // everything else is STATED, never guessed
      jurisdiction: { role: 'identifier' },
      disease: { role: 'dimension' },
      cases: { role: 'measure' },
      ytd: { role: 'measure', label: 'year to date' },
    },
  },
},
encodingRules: {
  rules: [
    { rule: 'never-together', columns: ['cases', 'ytd'], scope: 'view', sentence: 'a week\'s count and a year-to-date total never share a chart' },
    { rule: 'only-with', column: 'value', companion: 'entity' },
    { rule: 'never-on', column: 'ytd', channels: ['color'] },
  ],
  channels: { line: [{ channel: 'color', scale: 'discrete' }] },   // add to, or override, a chart kind's requirements
  onInvalid: 'refuse',        // or the NAME of a coercer passed at build
  ruleScope: 'dashboard',     // the default reach of never-together
}
```

A **facet** is one column as the plane sees it: the provider's type (or a declared `type`, when the def knows an ISO string is a date), plus the declared role (`identifier | dimension | measure | absence`) and scale (`discrete | continuous`, derived from the type when not stated). A rule that needs a role does not match a column that never declared one — the validator refuses on evidence, never on ignorance.

A **channel requirement** is what a chart kind's channel accepts: types, a scale, roles. The library ships one set by channel name (x carries a magnitude anywhere) and specifics per kind (a line's x is continuous, a heatmap's x is discrete). `encodingRules.channels` sits above both.

A **business rule** is a fact no chart kind can know: `never-on`, `never-together`, `only-with`. Each may carry its own sentence template.

A `dashboard`-scope rule means **anywhere on the page**, and the page is what the caller says it is: `lintEncodings({ views, facets, page })` judges each surface against `page` — every binding on the dashboard, keyed by the address that holds it (a viewId, or a layer's `viewId~layerId`; `pageBindings([...views, ...layers])` builds it). Without `page` the surfaces in `views` are the page, which is the whole page only when one call judges every surface. A layer is judged in a call of its own — its FACETS are its own table's — so its caller passes the page in, and a `never-together` pair cannot hide in the boundary between a frame and its layers. Only field NAMES are compared across the page, so nothing about the two tables has to be unified.

The **built-in law** every def inherits: the absence column never binds to a magnitude channel.

## The kinds the library ships, and their channels

One row per built-in chart kind — what it BINDS (a kind is not proposed while one of these has nothing that fits) and what it also takes when the data has it. `requirementFor(kind, channel)` is the one reader; `channelsOf(kind)` is the left column.

| kind | binds | also takes |
|---|---|---|
| `line` | `x` a number or a date, continuous · `y` a number | `color`, discrete — a line draws without one |
| `scatter`, `point` | `x`, `y` a number or a date | — |
| `histogram` | `x` a number or a date | — |
| `bar`, `boxplot` | `x` discrete · `y` a number | — |
| `heatmap` | `x`, `y` discrete · `color` a number | — |
| `map` | `region` a string | — |
| `network` | `x`, `y` a number or a date · `key` any column that could identify a node — not a measure, not the silence | `source`, `target`, `sourceX`, `sourceY`, `targetX`, `targetY` |
| `table` | nothing — and a kind that binds nothing is never proposed | — |

**A network is the one kind with a `key`, and the reason is a law two rows up.** Its x and y are ordinary positions: the layout act writes them as plain number columns on the nodes table, and nothing about them is a graph. Its KEY is what no other kind has — a node's identity is the thing the edges point at — and the by-name defaults refuse role `identifier` on `x` and `y`, rightly, because one mark per row on an axis is a list rather than a chart. So the kind names a channel of its own for it. A kind's row REPLACES the by-name default whole (`requirementFor` returns the first whole match and never merges field by field), and no by-name default mentions `key` — so this row is what makes the channel exist at all. It refuses only the two roles that are evidence AGAINST an identity: a magnitude is not one, and neither is the silence vocabulary.

`source` and `target` are the edges table's OWN endpoint ids — a relation's `from.column`, which `bringOver` reads and never writes — and they are unconstrained because a node key may be a string or a number. The four endpoint POSITIONS are what `bringOver` writes across the declared relations (`source_x`, `source_y`, `target_x`, `target_y`). All six are **optional**: a nodes-only layer binds none of them and still fits. But the four positions are **all four or none** — a layer binding three is read as a nodes layer and draws no links, so a partial carry-over is a missing picture rather than a partial one. They are members of the `magnitude` class alongside `x` and `y`, because they are coordinates in the same space: the absence law and any def's own `class: 'magnitude'` rule reach an edge endpoint exactly as they reach a node position.

**A node-link is never PROPOSED from one flat table.** `proposeCharts` sees only `FitColumns` — no relations, no table graph, no record of a layout act — so it could not tell a laid-out nodes table from any table with two numbers, and an offer of `{ x: 'week', y: 'cases', key: 'disease' }` under the name of a node-link would be a scatterplot wearing a graph's name. `KINDS_NOT_PROPOSED` keeps the kind out of the default enumeration while leaving its row in the table, where the validator and the renderer both need it. A host that HAS the graph asks for it by name:

```ts
proposableKinds().some((k) => k.chartKind === 'network'); // false — no relation, no layout, no offer
proposeCharts({ columns: nodes, kinds: [{ chartKind: 'network', channels: channelsOf('network') }] });
// every proposal a network, because the caller said so
```

```ts
// the nodes table after the layout act wrote x and y
const nodes = [{ name: 'disease', type: 'string', role: 'identifier' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }];
acceptsOf(whatFits({ columns: nodes, chartKind: 'network', channels: channelsOf('network') }));
// { x: ['x', 'y'], y: ['x', 'y'], key: ['disease', 'x', 'y'] }

// and on a network that names no `key`, a node's identity has nowhere to go:
whatFits({ columns: nodes, chartKind: 'network', channels: ['x', 'y'] })['x'];
// [ …, { field: 'disease', ok: false,
//        because: '"disease" is string; the x channel of a network needs a number or a date' } ]
```

## What fits, before a build

`fitsFor` answers per channel for a view that already exists — it takes FACETS, which a dashboard resolves from a provider's columns and a def's declarations. An authoring wizard has neither: it has a described table, whatever the person has declared on it so far, and a chart kind it is considering. Asking it to build a dashboard to find out whether `cases` can go on `y` is asking it to commit before it may look.

`whatFits` is the same answer one step earlier:

```ts
const described = describeTable(csv);                     // vizfootprint/data
const columns = described.columns.map((c) => ({ name: c.name, type: c.type, ...declaredBy(person, c.name) }));

whatFits({ columns, absence: { field: 'report_state', states: [...] }, chartKind: 'line', channels: ['x', 'y'] })['y'];
// [ { field: 'cases', ok: true }, { field: 'ytd', ok: true },
//   { field: 't', ok: false, because: '"t" is date; the y channel of a line needs a number' },
//   { field: 'report_state', ok: false, because: '"report_state" is the declared absence column — it cannot bind to the magnitude channel "y"; absence is a category, never a magnitude' } ]
```

One `FitColumn` is a name plus a `ColumnDecl`, and the `type` slot is one slot on purpose: `describeTable` puts the sniffed type there and the person overwrites it — which is exactly what a def's declared type does to a provider's.

It adds **no rule of its own**. It calls `resolveFacets` then `fitsFor`, the same two calls in the same order the build door's own lint makes, so the answer here and the answer after the build cannot differ. `src/def/whatFits.def.test.ts` pins that over an NNDSS-shaped fixture: every column on every channel, the same verdict and the same sentence, and then end to end against `dashboard.lint()`.

Two boundaries worth knowing. The evidence differs from the BUILD door's (not from lint's): a def is judged with what the def alone can prove, where column types are the provider's, so `whatFits` — holding real types — refuses things the build door had no evidence for. And a per-channel question is judged with the rest of the view held still, so a `never-together` pair reports on the channel you asked about, where lint judges the whole set at once and names the pair once.

## Policy: strategies with a default

| Ruling | Port | Default | Where the choice lives |
|---|---|---|---|
| refuse or coerce | `Coercer` | refuse | `encodingRules.onInvalid` names a coercer passed in `buildDashboard(def, { encoding: { coercers } })` |
| reach of never-together | rule field | dashboard | `rule.scope`, or `encodingRules.ruleScope` |
| refusal sentences | `Explainer` | the template | `buildDashboard(def, { encoding: { explainer } })` adds prose as `explained`; the template stays on `sentence` |
| preferences | `Recommender` | none — nothing ranks unless a port is passed | `buildDashboard(def, { encoding: { recommender } })` ranks the columns that fit; it never sees the refused ones. `policyRecommender()` is the one this plane ships — see *Preferences, as data* |

Two things are shapes, not strategies: a facet is declared on the column (a per-binding override is a later step), and a swap is a `reencode` with a binding set, not a verb of its own.

## Coercion, honestly

`discreteCoercer` reads a continuous column as discrete when a channel needs discrete. Nothing turns a category into a magnitude. A coerced act lands and reports the coercion on the dispatch result (`coerced`); the commit carries the field name only — carrying the coerced scale in the log is a known next step.

## Preferences, as data

`whatFits` decides WHO may sit on a channel. It says nothing about who should be offered first, and with no recommender passed the answer came back in whatever order the CSV happened to list its columns — which is not neutral, it is the CSV author's opinion presented as no opinion at all.

`policyRecommender()` is the other kind of answer. A policy is an ordered list of rules, each of them three things a person can read — where it speaks, which column it names, and the sentence saying why:

| # | rule | speaks about | names | and says |
|---|---|---|---|---|
| 1 | `date-on-an-axis` | `x`, `y` | a `date` column | *"week" is a date and x is an ordered axis — time is the thing an axis reads best* |
| 2 | `measure-on-a-magnitude` | any magnitude channel | role `measure` | *"cases" is a declared measure, and y carries a magnitude* |
| 3 | `named-for-the-channel` | every channel | a name in the channel's own vocabulary (`CHANNEL_NAMES`) | *"jurisdiction" is named for the region channel — somebody called it that…* |
| 4 | `dimension-on-a-category` | any category channel | role `dimension` | *"disease" is a declared dimension, and color carries a category* |
| — | *the default* | — | everything else | *no rule in this policy names "report_state" for color — it is offered among the columns no rule names, in the order the table lists them* |
| 5 | `an-identifier-last` | every channel | role `identifier` | *"jurisdiction" is a declared identifier, and one mark per row is a list rather than a chart…* |

**First match wins, and a rule either PREFERS a column or DEMOTES it** — both stated against the same middle, the columns no rule named at all. That is why the default sits between rules 4 and 5 in the table above: a rule's POSITION says who speaks first, and `place` says which side of the unnamed columns it speaks from. `placeIn(facet, channel)` returns the band as a number (negative preferred, `0` the default, positive demoted) beside the rule's id and its sentence.

Two consequences worth knowing. **Rule 3 reads a name, and where it sits took an argument**: below what the data and the declarations say about a column's type and its measure role, above "a dimension on a category", because nearly every discrete column is a dimension and `jurisdiction` is the more specific evidence about a map's geography. Order it the other way and an NNDSS map is offered `disease` for its region. And **a preference always beats a demotion**, which is what lets `jurisdiction` be a map's region while still being offered last on a hue.

Over an NNDSS-shaped table — `jurisdiction` (identifier), `disease` (dimension), `week` (date), `cases` and `ytd` (measures), `report_state` (the absence column):

```ts
whatFits({ columns, absence, chartKind: 'line', channels: ['x', 'color'], ports: { recommender: policyRecommender() } });
// x:     week, cases, ytd                    (a date, then the two measures)
// color: disease, report_state, jurisdiction (a dimension, then the unnamed, then the identifier)
```

**It changes the order and never the membership.** The columns that fit and the sentences refusing the ones that do not are identical with and without it — `recommend.test.ts` pins that channel by channel, because one rule for fit is the plane's law and a recommender is not it. The policy is exported as data: read `RANKING_POLICY`, replace it (`policyRecommender(mine)`), or extend it by slicing a new list — all three are the same act.

## Proposing a whole chart

A person at an authoring wizard has a harder question than *may this column sit here*: **given this table, what chart should I make?** `proposeCharts` answers it by composing the two things above and adding no rule of its own.

```ts
const { proposals, notEnumerated } = proposeCharts({ columns, absence });
proposals[0];
// { chartKind: 'line',
//   channels: { x: 'week', y: 'cases' },
//   reasons: {
//     x: 'the x of a line takes a number or a date; "week" is a date and x is an ordered axis — …',
//     y: 'the y of a line takes a number; "cases" is a declared measure, and y carries a magnitude' },
//   cost: 0 }
```

For each chart kind the requirement tables know it enumerates the bindings that fit every channel of the kind, ranks them with the recommender, verifies each WHOLE binding with `whatFits` again, and returns the best few. **Every proposal carries its reasons** — what the channel takes, read off the requirement in force, and why that column was offered for it, in the ranking policy's own words. A recommender is a rewrite by this project's cut line: it changes what a person is offered, so a rank without a reason is an opinion wearing a number.

Four things it states because they are not the plane's:

- **the verification is the pin.** Every binding in a proposal is one `whatFits` accepts, and a binding it refuses never appears. The second pass matters: a rule about two columns (`never-together`, `only-with`) cannot fire while each column is judged alone, so the combination is judged as a whole before it is offered.
- **one column never sits on two channels of one chart.** The plane would allow `x = cases, y = cases`; it is still not a chart anybody meant to be offered. That is enumeration, not law.
- **a kind that binds nothing is not proposed.** `table` names no channel — nothing to bind, nothing to rank, nothing to give a reason for. `channelsOf(kind)` is the list, and a channel a requirement marks `optional` is not in it: a line draws without its colour, and a heatmap does not.

  `ChannelRequirement.optional` has exactly ONE reader today, and it is worth naming rather than leaving to be discovered: **`channelsOf`, on behalf of the enumerator**, which will not propose a chart missing a channel the kind needs. **The validator does not read it** — a requirement judges a binding that exists, and an unbound channel is not a binding — so the field is ADVISORY, not enforced. Giving it a second reader (the build door refusing a declared view that leaves a required channel unbound) is queued below rather than done here, because it may refuse definitions that build today.
- **the caps say when they bit.** `PROPOSAL_CANDIDATES` (4 per channel), `PROPOSAL_BINDINGS` (64 per kind) and the caller's `limit` (8) each come back as a sentence in `notEnumerated` naming what was left out. The first bites on any ordinary table — five columns fitting one channel is nothing unusual — and the second cannot bite on a built-in kind at all, because four candidates on at most three channels is sixty-four.

`cost` is the sum of each channel's offer index: `0` means every channel took the recommender's first choice, and the list is sorted by it, lowest first. It is a **cost** and not a score because lower is better here, and a name that fights its own semantics is a bug waiting for a consumer — it measures how far a binding sat from the policy's first choices, and nothing else.

**A proposal only ever comes from the kinds a host says it can draw**: pass `kinds` (a `chartKind` and the channels it binds) and nothing outside that list is enumerated; pass none and the default is every kind the requirement tables know. The studio wizard's `bar` binds `category` and counts rows where this library's binds `x` and `y`, and a proposal a host cannot draw is a proposal it must not be offered.

## Not yet

- **the build door refusing a view that leaves a REQUIRED channel unbound** — the second reader that would make `ChannelRequirement.optional` enforced rather than advisory. Queued deliberately and not built here: it may refuse definitions that build today, so it is its own packet
- `requires-aggregate` rules (the library has no aggregate binding yet)
- a per-binding facet override recorded as its own commit
- the coerced scale on the commit

## Files

`types.ts` the vocabulary · `requirements.ts` built-in channel requirements + merge, and which channels a kind binds · `sentences.ts` templates · `facets.ts` column → facet · `validate.ts` the validator · `shape.ts` def-door shape checks · `fits.ts` what fits where · `whatFits.ts` the same, before a build · `recommend.ts` the preference policy · `propose.ts` whole charts, offered · `lint.ts` the lint door · `describe.ts` rules as sentences · `coercers.ts` the built-in adapter
