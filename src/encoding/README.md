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

The **built-in law** every def inherits: the absence column never binds to a magnitude channel.

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
| preferences | `Recommender` | none | `buildDashboard(def, { encoding: { recommender } })` ranks the columns that fit; it never sees the refused ones |

Two things are shapes, not strategies: a facet is declared on the column (a per-binding override is a later step), and a swap is a `reencode` with a binding set, not a verb of its own.

## Coercion, honestly

`discreteCoercer` reads a continuous column as discrete when a channel needs discrete. Nothing turns a category into a magnitude. A coerced act lands and reports the coercion on the dispatch result (`coerced`); the commit carries the field name only — carrying the coerced scale in the log is a known next step.

## Not yet

- `requires-aggregate` rules (the library has no aggregate binding yet)
- a per-binding facet override recorded as its own commit
- the coerced scale on the commit

## Files

`types.ts` the vocabulary · `requirements.ts` built-in channel requirements + merge · `sentences.ts` templates · `facets.ts` column → facet · `validate.ts` the validator · `shape.ts` def-door shape checks · `fits.ts` what fits where · `whatFits.ts` the same, before a build · `lint.ts` the lint door · `describe.ts` rules as sentences · `coercers.ts` the built-in adapter
