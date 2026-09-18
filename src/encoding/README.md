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

A **channel requirement** is what a chart kind's channel accepts: types, a scale, roles. The library ships one set by channel name (x carries a magnitude anywhere) and specifics per kind (a bar's x is discrete, a scatter's is a number or a date). `encodingRules.channels` sits above both.

**The door and the renderer agree, kind by kind.** A door that accepts what the renderer refuses sends a definition author into a refusal they cannot see at declaration; a door that refuses what the renderer draws hides a capability. So a requirement widens or narrows WITH the chart that draws the kind, and the reason sits at the entry (`CHART_REQUIREMENTS`, `requirements.ts`). The two entries that show the law from both sides:

- **a line's x takes a category** — `accepts: ['number', 'date', 'string', 'boolean']`, and no `scale` is fixed: the frame renderer draws a line whose x is a string or a boolean as a *band line* (each point at its slot's centre, the segments connectors in slot order, claiming nothing between slots — `bandX`, `ui/src/contract/renderers.tsx`), so the scale follows the column, which is exactly what the fold decides on its own (`frameScaleOf`). `notRoles: ['identifier']` stays: an identifier along a run is a lie about order, and whether an identifier makes an honest band for a line is a question the entry does not take. **The `'number'` in that list was the one the two sides DISAGREED about**, and the disagreement cost a reader their gesture: the door admitted it, the chart drew it as dates (`Date.parse`) and emitted date-shaped strings a numeric column cannot answer. The chart has a numeric-run arm now (`VizLine` · `xKindOf`, `ui/README.md`) and its own picker no longer vetoes the number, so all three of a line's x kinds — a run of dates, a run of numbers, a band — are drawn by the chart the door admits them for.
- **a scatter's x stays a number or a date** — `VizScatter` draws no band in this version and the frame refuses a point on a band in words, so the door refusing it too is the two agreeing. When the scatter learns a band, that entry widens with it (`point` is the same chart under its VL/Mosaic name and moves with it).

One door stays narrower than this table ON PURPOSE: the studio wizard's MADE line (`MAKE_ENCODING_RULES`, `studio/src/make/steps.ts`) still takes only a number or a date, because a made line sums a measure into DATED points and draws no band — the same law that widened `CHART_REQUIREMENTS.line.x` narrows the wizard's own `encodingRules.channels` above it, agreeing with the chart it actually draws. See `studio/src/make/README.md` for the full reasoning.

```ts
// the figure this makes declarable: bars by year with a line of the mean over them, one string column on both x channels
encodings: [{ viewId: 'fig', chartKind: 'bar', channels: ['x', 'y'], frame: { x: { mode: 'shared' } }, layers: [
  { layerId: 'bars', table: 'sales', chartKind: 'bar',  channels: ['x', 'y'], initial: { x: 'year', y: 'count' } },
  { layerId: 'mean', table: 'sales', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'year', y: 'mean' } },
]}]
// → builds, lints clean, and the frame folds ONE categorical x for the two bands (src/def/encoding.def.test.ts)
```

A **business rule** is a fact no chart kind can know: `never-on`, `never-together`, `only-with`. Each may carry its own sentence template.

A `dashboard`-scope rule means **anywhere on the page**, and the page is what the caller says it is: `lintEncodings({ views, facets, page })` judges each surface against `page` — every binding on the dashboard, keyed by the address that holds it (a viewId, or a layer's `viewId~layerId`; `pageBindings([...views, ...layers])` builds it). Without `page` the surfaces in `views` are the page, which is the whole page only when one call judges every surface. A layer is judged in a call of its own — its FACETS are its own table's — so its caller passes the page in, and a `never-together` pair cannot hide in the boundary between a frame and its layers. Only field NAMES are compared across the page, so nothing about the two tables has to be unified.

The **built-in law** every def inherits: the absence column never binds to a magnitude channel.

## The kinds the library ships, and their channels

One row per built-in chart kind — what it BINDS (a kind is not proposed while one of these has nothing that fits) and what it also takes when the data has it. `requirementFor(kind, channel)` is the one reader; `channelsOf(kind)` is the left column.

| kind | binds | also takes |
|---|---|---|
| `line` | `x` a number, a date, a string or a boolean — the scale follows the column (a category is a band line) · `y` a number | `color`, discrete — a line draws without one |
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
| 4 | `an-order-on-an-axis` | `x`, `y` | a `continuous` column | *"sales" is continuous — it carries an order of its own, and x is an ordered axis; a category has no order to read along one* |
| 5 | `dimension-on-a-category` | any category channel | role `dimension` | *"disease" is a declared dimension, and color carries a category* |
| — | *the default* | — | everything else | *no rule in this policy names "report_state" for color — it is offered among the columns no rule names, in the order the table lists them* |
| 6 | `an-identifier-last` | every channel | role `identifier` | *"jurisdiction" is a declared identifier, and one mark per row is a list rather than a chart…* |

**First match wins, and a rule either PREFERS a column or DEMOTES it** — both stated against the same middle, the columns no rule named at all. That is why the default sits between rules 5 and 6 in the table above: a rule's POSITION says who speaks first, and `place` says which side of the unnamed columns it speaks from. `placeIn(facet, channel)` returns the band as a number (negative preferred, `0` the default, positive demoted) beside the rule's id and its sentence.

Three consequences worth knowing. **Rule 3 reads a name, and where it sits took an argument**: below what the data and the declarations say about a column's type and its measure role, above "a dimension on a category", because nearly every discrete column is a dimension and `jurisdiction` is the more specific evidence about a map's geography. Order it the other way and an NNDSS map is offered `disease` for its region. **Rule 4 exists because a line's x takes a category** (the door and the frame renderer agreed on the band line): membership widened, so the order had to say where a category sits on an axis — without it a bare `region + sales` table is offered a line over the region *first*, on the table's order alone. It is a preference for the ordered column and never a demotion of the category (a bar's x is made of categories, and "offered after" would be false there), which is why `proposeCharts` offers that table its bar first and the line over the category last. And **a preference always beats a demotion**, which is what lets `jurisdiction` be a map's region while still being offered last on a hue.

Over an NNDSS-shaped table — `jurisdiction` (identifier), `disease` (dimension), `week` (date), `cases` and `ytd` (measures), `report_state` (the absence column):

```ts
whatFits({ columns, absence, chartKind: 'line', channels: ['x', 'color'], ports: { recommender: policyRecommender() } });
// x:     week, cases, ytd, disease           (a date, then the two measures, then the category a band line may stand on)
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
//     x: 'the x of a line takes a number, a date, a string or a boolean; "week" is a date and x is an ordered axis — …',
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

## Matrix or node-link: the reading rule, as data

A graph has two honest pictures — the **node-link** (circles and lines) and the **matrix** (source by target, shaded, which is the heatmap this library already draws) — and which one a reader should be given is not a matter of taste. It is a property of the GRAPH and the QUESTION, and it has been measured. So it is stated as data: `GRAPH_READING_RULES` is a frozen, ordered array, each rule carrying the fact it fires on and the REASON it fires for, and `graphReadingFor` is nothing but *the first rule that fires*.

```ts
graphReadingFor({ nodes: 15, edges: 105 });
// { prefer: 'matrix', rule: 'dense',
//   reason: 'at a density of 0.2 or more the lines cross more than they connect: Ghoniem, Fekete and
//            Castagliola (2004) found the matrix beat the node-link on every task but path-finding …' }

proposeCharts({ columns, kinds, graph: { nodes: 15, edges: 105 } }).reading;   // the same ruling, on the offer
```

The rules, in the order they are read:

| rule | fires when | prefers |
|---|---|---|
| `dense` | density ≥ `DENSE_AT` (0.2), stated or derived from `nodes`/`edges` | matrix |
| `matrix-question` | the question is adjacency, common neighbours or counting clusters | matrix |
| `big-and-static` | more than `BIG_AT` (50) nodes and no interaction | matrix |
| `sparse-path` | a path or topology question, on a graph a reader can explore | node-link |
| *(default)* | nothing said the graph was dense or the question adjacency | node-link |

Three things it states because they are easy to get wrong:

- **the order is part of the rule set.** Density is read first: a path through a hairball is still a hairball. The node-link rule is last because it asks for three things at once — a sparse graph, a path or topology question, and a reader who can hover.
- **a ruling is never a refusal.** `proposeCharts` still offers both pictures when both fit; the reading only decides which comes FIRST, and it never touches `cost` (which measures one thing: how far a binding sat from the recommender's first choices). Every other kind keeps its cost order — a reading has no opinion about a bar chart.
- **the reason travels with the ruling.** The two studies are named in the value, not in a comment: Ghoniem, Fekete and Castagliola (2004), who found the matrix ahead on every task but path-finding as size and density grew, and Okoe, Jianu and Kobourov (2018), who found the node-link recovering on topology and paths WHEN a reader could explore, while the matrix stayed ahead on adjacency, common neighbours and clusters. A ruling nobody can check is an opinion with a citation stapled to it.

## The frame's fold, and the logarithmic axis (`frame.ts`)

`frameDomains` folds ONE domain per shared channel from the layers' own values — the numbers no def can type in. What the DECLARATION means is judged at the def door (`../def/README.md`, "The frame", laws 7–11); this file only folds, and echoes back the words it was told.

**A transform is not a resolution, and the frame owns both.** `ChannelResolution.transform` (`'linear' | 'log'`, default linear, base 10) rides onto `ResolvedChannel` on BOTH modes, so a renderer knows which scale to build (`scaleFor`, `vizfootprint-ui/primitives/scales.ts`, is the one owner of that answer on the chart side).

**Exclude and count, never silently drop.** A logarithm has no answer for 0 or a negative number, and which cells those are is DATA, not declaration — the door cannot refuse them. So a logarithmic fold takes the union over the POSITIVE cells and records how many it could not place:

```ts
frameDomains(layers, { mass: { mode: 'shared', transform: 'log' } });
// → { mass: { mode: 'shared', basis: 'table', guide: 'merged', transform: 'log',
//             scale: 'quantitative', domain: [0.02, 4700], excluded: 712 } }
//
// …and when NOTHING is placeable there is no domain at all — no entry, the existing
// "nothing folds" arm, because an invented domain is a drawn lie.
```

Three things to know about `excluded`. It is **absent** unless something was excluded, so a linear fold is byte-identical to the one that existed before the key. It is **not a silence**: a silence is a cell the data says nothing about (the adapter has already dropped those, per column, before this fold sees a value), and this is a cell the data speaks plainly about but a logarithm cannot place — a reader told "712 excluded" without knowing which has learned nothing, so the two are deliberately never summed. And it is **met in the picture**, not here: the chart appends `excludedNote(n)` to the words it already says, because that is where the marks are missing from.

`zeroPolicyFor` never anchors a logarithmic channel at zero — one predicate, asked once, so no caller has to remember it. The def door refuses a DECLARED `zero: true` beside `transform: 'log'`, so the only zero that can reach the fold with a log is one the MARKS implied — and those marks (a bar, a box) are refused a logarithmic axis on that very channel by law 11.

## Zero is a place on the axis (`frame.ts`, law 12)

**A chart may be TOLD to draw the line where a signed scale crosses zero**, so that positive and negative read as two sides of an origin instead of a cloud of marks in a box. It is one key on the same `ChannelResolution` the transform rides on — the axis has one owner, and this is the axis's own furniture:

```ts
// a Ramachandran plot: a backbone φ against ψ, each running −180…180, and the reading
// is WHICH QUADRANT a residue falls in — the figure that asked for this
frame: { x: { zeroGuide: true }, y: { zeroGuide: true } }
// → { x: { mode: 'shared', basis: 'table', guide: 'merged', zeroGuide: true,
//          scale: 'quantitative', domain: [-180, 180] }, y: … }
```

**Named for ZERO and not for the centre**, and this is not a spelling preference. The middle of a domain is not zero unless the domain happens to be symmetric: φ runs −180…180 and zero is the middle, a solvent-accessible area runs 0…226 and zero is the edge. A key named for the centre would draw a line down the middle of an all-positive domain, where the middle means nothing — a quiet lie, drawn, which is the kind of thing this library exists to refuse.

**DECLARED, and an automatic default was considered and REFUSED.** The next reader will want to add one, so here is the argument against it: if the guide appeared by itself whenever a folded domain happened to include zero, then the **same view would draw differently at two cursors** — absent before the data crossed zero, present after — with nothing in the record saying why. A picture that changes its own furniture for reasons the log does not carry is exactly what this library forbids. `zeroGuide: false` is therefore legal and meaningful: it is a def saying out loud what it wants, which is a different record from a def that said nothing.

**The fold echoes it and decides nothing.** `resolutionFor`/`frameDomains` put the key on `ResolvedChannel` beside `transform`, absent unless declared, on both modes and on the layerless arm. The verdict — is zero actually ON this axis — needs the domain that was DRAWN ON, and that is the fold's only when a frame handed one over: a standalone chart draws its own padded extent, and nothing upstream has those numbers. So the chart answers it, once, for every chart (`zeroGuideFor`, `vizfootprint-ui/primitives/zeroGuide.ts`), and an axis with no zero on it is REFUSED IN WORDS — in the plot and in the accessible name, quoting the axis it was asked of and the channel it was asked on — never clamped to an edge and never silently dropped.

**Who draws it is already decided**, by `guide: 'merged' | 'per-layer'` and not by a second rule: the zero guide is that axis's furniture, so the frame draws one for the stack exactly where it draws the axis, and a per-layer channel is the layers' to draw. A frame never unions two answers for one channel, because the span, the curve and this key all ride on the ONE `ChartDomain` object every layer receives by the same reference.

**CORRECTED — the guide is NOT gated on a chart's `axes` prop, and it used to be.** The rule this paragraph first carried ended "each gated on its own `axes` prop", so `axes: false` erased the guide. The reasoning was tidy: the guide is an axis's furniture, a chart that draws no axis draws none of its furniture. What it missed is what that flag MEANS at a chart's door. A host turns the axes off as a **density** decision — no room for tick labels, its floor folded from `framePad` — not to say the chart has no axis. Measured consequence on a real page: a backbone-angle pane at 282×171 drew 181 dots, no ticks and **no crosshair**, so the reader lost the only thing saying where the origin was at exactly the size where they could not read it off the labels either. A tick label needs room to be legible; **a line at zero needs one pixel**. And on a signed scale that line is not decoration — a dot above it and a dot below it mean categorically different things — so dropping it removes the ability to read the SIGN. So: **ticks and labels are what `axes: false` suppresses, and the guide survives it.** Nothing about honesty moved — a domain without zero and a logarithmic axis are refused exactly as before, at any density. And the stack still gets exactly ONE line, because who ELSE might draw it is decided where that is known: a frame drawing the merged guide does not ASK its layers (`layerDomain`, `vizfootprint-ui/contract/renderers.tsx` — the one place that decision lives, since it is the one door that knows which axes the frame draws).

Three things this file owns for the law. `drawsZeroGuide(chartKind, channel)` — WHICH marks draw one and where: a **point** (a scatter, under both its names) on x and y, a **line** on y alone (its x is a run of dates or a band of categories, and neither has a zero a sign is read from), and nothing else. `zeroGuideKindRefusal` — the words for a mark asked for one it does not draw, said by the def door with its address in front of it and by the frame exactly as it stands (the `firstScaleTakenRefusal` arrangement). `noZeroOnALogAxis(key)` — the logarithm's own clause, because a log axis has no zero at all: the answer there is the sentence the logarithm already had, with the key each author has to drop, and `zero`'s spelling of it is byte-identical to what it always said.

### A band is a range too (law 13)

Two things this file owns for it, the same pair law 12 owns. `drawsIntervalBrush(chartKind, scale)` — does this mark draw a horizontal interval brush on an x of this SCALE KIND: a **scatter** (a point, under both its names), a **line** and a **histogram** do, on anything but a band; nothing else does at all (a bar's drag was always a match, a box plot has no drag, a heatmap's gesture is the compound cell, a map has regions, a table rows, a network a walk). The answer is per PAIR because of the second half: a CATEGORICAL x is a band, a band has no BETWEEN for an interval to name, and a drag across its slots is a RUN of them — which is the match language every band already speaks. That is why a line, the one mark whose x may be either, brushes an interval over a run of dates and lands a MATCH over a band of categories.

`intervalGestureRefusal(subject, chartKind, scale, column)` — the words for a declared `interval` a mark will not draw, said by the def door with its address in front of it (`../def/README.md`, law 13) and by the frame that has to draw it exactly as it stands (`vizfootprint-ui/contract/renderers.tsx` · `intervalBrushRefusal`). TWO ARMS in one function, chosen by the evidence, because the two mistakes have two different repairs (the `refuseOwnScale` precedent): a band gets *declare `encodings: ["match"]`*, a mark that brushes nothing at all gets *drop `"interval"`*. The scale kind is a PARAMETER and never re-derived here — `frameScaleOf` is its one owner, which is also the one thing the def door cannot always know: a field is a band because of its DATA.

**AND LAW 13 AT THE VALUE — four more things this file owns, because the judgement and the sentence must not drift.** The pair above judges what a mark DECLARES against the scale it stands on, and a declaration carries no values. A clause a gesture actually DELIVERED is the lie one layer in, and it is judged here:

- `intervalAddresses(scale, bounds)` — can an interval of these bounds address an axis of this scale kind. `INTERVAL_BOUND_KINDS` is the ONE table under all of it: a quantitative axis takes numeric bounds, a categorical one strings, a temporal one **either spelling of a date the library carries** (the ISO string a fold emits, or an epoch — it refuses nothing it might have been able to answer). The rule is not taste: it is the interval evaluator's own no-cross-type-coercion law read backwards.
- `valueAddresses(scale, value)` — the same question for the kinds that carry VALUES rather than bounds: a point, and each member of a match. It reads the same table, so *what addresses a quantitative column* is answered in one place for every clause shape.
- `unaddressableClause(kind, value, scale)` — the ONE fan-out over the three single-column kinds, taking the WIRE value (a point's value, an interval's bounds, a match's `{ values, exclude }` body) because that is what both callers hold, and handing the EVIDENCE back rather than a bare `false`. A match is judged STRICTLY — every member must address the column, which is the interval arm's own `every` read across a list — because a set that silently lost half its members is the same lie in a smaller costume and a commit has nowhere to record the loss.
- `unaddressableValueRefusal(subject, column, kind, scale, delivered)` — one sentence for all three kinds, quoting what was handed over (an author told only *wrong kind* goes looking in the definition, where nothing is wrong). Its INTERVAL arm is `unaddressableIntervalRefusal` **verbatim**: that sentence shipped, and a law that grew a tier is not a reason to re-word the tier it already had.

**Asked by the session's probe door**, which already read the column list and used it only for the NAME. The defect that bought it, measured end to end: a band drawn over a column of numbers emitted a `match` of its slots' SPELLINGS, the door took it, the record gained a commit (4 → 5) with the refusal ledger unchanged at 3, and 185 marks in force became 0. **A landed clause that kept nothing is worse than a refusal and worse than the dead gesture before it, because the record now claims the question was answered.** The refusal is filed under a gap code of its own (`unaddressable-value`, `../session/types.ts`) because nothing about the view, the declaration or the column is wrong — the repair is in the values sent, and an agent has to be able to branch on that.

**REFUSED ON EVIDENCE, NEVER ON IGNORANCE — and `categorical` is deliberately absent from the VALUE tier.** A quantitative or temporal fold corroborates its own declaration: it reads only the cells it can read as that kind and SKIPS the rest, so a column folded as one really holds that kind. The categorical fold is the asymmetric one — it NAMES every cell it is given (`String(cell)`, so *a number on a category channel becomes the category `"7"`*) — so a column declared `string` is a column this file itself says may hold numbers, and judging a value against that declaration would refuse clauses that keep rows. An INTERVAL over a categorical axis is still refused, on the different ground `drawsIntervalBrush` names: a band has no BETWEEN.

**Not in this packet, and named so nobody looks for it**: the shaded density regions of a real Ramachandran plot — the favoured and allowed contours. Those are a REGION layer under a scatter, which a frame's layer kinds do not include, and they are **external published reference data** rather than anything computed from the structure in front of the reader — so they have to arrive as a declared and cited source with a version. That is its own packet, and it is the harder half. This one is the axis only.

## What the quantity can be (`frame.ts`, law 14)

**A numeric extent CAN be declared, and it is a fact about the QUANTITY rather than about the rows.** `bounds?: readonly [number, number]` is the extent an axis is read on — the one numeric pair a frame carries:

```ts
// the same Ramachandran plot, now saying what a torsion angle IS rather than
// what these residues happen to reach
frame: { x: { bounds: [-180, 180] }, y: { bounds: [-180, 180] } }
// → { x: { mode: 'shared', basis: 'table', guide: 'merged', bounds: [-180, 180],
//          scale: 'quantitative', domain: [-172, 107] }, y: … }
```

**Beside `domain`, never instead of it**, which is the whole shape of the law. `domain` is what this data reaches; `bounds` is what the quantity can reach; a reader holding both can see a table covering a third of its own axis, which is a fact worth having. The fold **echoes and decides nothing**, exactly as it does for `transform` and `zeroGuide` — nothing here folds a declared pair, and nothing here overwrites one.

**Why it is declarable at all, when law 7 says a frame declares a fold and never numbers.** Those are two claims, and this is the opposite one rather than an exception to it: `domain: 'union'` is a word about how LAYERS combine their extents, and `bounds` is what the quantity is by definition — a torsion angle is −180…180 whatever residues are in the table, a percentage 0…100, a probability 0…1, a correlation −1…1. No fold over rows can know that, and no fold may overwrite it. The axis says what the quantity CAN be; the marks say what this entry HAPPENS to be. The argument for the WORD (`bounds`, not `domain`, and specifically not `range` — which this repo already spells twice, once for a filter's interval and once for d3's pixel pair) is law 14 of `../def/README.md`, with the four refusals.

**It never hides a value**, and that is the half a reader meets. The CHART prefers the declared pair when it draws (`spanOf`, `vizfootprint-ui/contract/renderers.tsx`), a cell outside it is still placed at its true position — nothing is dropped — and because a mark past the plot edge is invisible it is **counted and said**, in the picture and in the accessible name, in the register the logarithm's exclusions already use: *`x has 3 values outside its declared bounds [0, 100] — bounds say what the quantity CAN be, so either they are wrong or this data is`* (`outsideNotes`, `vizfootprint-ui/primitives/scales.ts`, beside `excludedNote`). A value outside means either the data is wrong or the claim is, and the reader is the only person who can tell which.

One thing this law does not do: a channel with no foldable cell still gets **no entry at all** (the existing "nothing folds" arm — an invented domain is a drawn lie), so declared bounds over an empty table reach no picture. An axis drawn over no data is a different question.

## Not yet

- **the build door refusing a view that leaves a REQUIRED channel unbound** — the second reader that would make `ChannelRequirement.optional` enforced rather than advisory. Queued deliberately and not built here: it may refuse definitions that build today, so it is its own packet
- `requires-aggregate` rules (the library has no aggregate binding yet)
- a per-binding facet override recorded as its own commit
- the coerced scale on the commit

## Files

`types.ts` the vocabulary · `requirements.ts` built-in channel requirements + merge, and which channels a kind binds · `sentences.ts` templates · `facets.ts` column → facet · `validate.ts` the validator · `shape.ts` def-door shape checks · `fits.ts` what fits where · `whatFits.ts` the same, before a build · `recommend.ts` the preference policy · `propose.ts` whole charts, offered · `graphReading.ts` matrix or node-link, the rule as data · `lint.ts` the lint door · `frame.ts` THE FRAME — one domain per shared channel, folded from the layers' own values (`frameDomains`, the resolution defaults, the zero policy, the LOGARITHMIC fold with its `excluded` count, and `frameLint`, the layer-count ADVICE a host reaches through `Dashboard.lintFrames()` as `FrameNote` rows) · `describe.ts` rules as sentences · `coercers.ts` the built-in adapter
