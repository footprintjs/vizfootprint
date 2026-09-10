# why — one join, five questions

`why(target)` answers *"why is this what it is?"* as a **machine-shaped commit set** — flat `{tier, id, kind}` records plus typed per-tier misses, never prose. It is not an algorithm of its own: it is a **JOIN** over slicers that already exist — footprintjs `sliceForKey` (kernel), a caller-harvested `EventMeta`-shaped frame log (agent), and the cause-tagged commit log's own `correlationId` field (viz) — stitched by one key.

Five target kinds ride that one join. What differs is not the algorithm but the **anchor law**: which commit the answer is rooted at, and therefore whose branch it is allowed to name.

## The anchor law, per kind

| target | the anchor is | nothing to anchor at |
|---|---|---|
| `{ kind: 'column', column }` | the commit of the act that **computed** the column | `no-such-target` |
| `{ kind: 'hypothesis', analysisId }` | the commit of the **invocation** the reader's position means | `no-such-target` |
| `{ kind: 'prose', viewId, slot }` | the `describe` commit that **landed the words** | `declared-in-def` — the words are the declaration's own |
| `{ kind: 'selection', viewId }` | the commit that **landed the live selection** | `nothing-live` — a cleared brush is not a selection |
| `{ kind: 'chart', viewId }` | the **newest commit on this branch that shaped what it shows** | `declared-in-def` — the chart looks the way the definition says |

Every one of them is built at the **TARGET's own position** — `branchPath(anchor)`, never the reader's cursor. An id from a branch the target never saw is **dropped and disclosed** (`dropped[]`, with `off-branch` kept apart from `unverified`), never credited as provenance.

## The kind vocabulary

Read in the order a reader walks them: the anchor, its inputs, the other two tiers, then the roles each target adds.

`declaring` · `input-selection` · `kernel-stage` · `agent-frame` — every kind has these four.

`proposal` · `basis` · `ref` — the words a view carries: accepted from, written at, cited by a span.

`reaching-clause` · `binding` · `arrangement` · `link-edit` · `derived-column` — what shaped a chart. A `reaching-clause` carries a **`response` qualifier** (`filter | highlight | mirror | navigate`): a clause reaching a chart plays one role with four meanings, and a role that needs a qualifier takes a **field**, not four kinds.

`origin` · `replaced` · `sibling` — what put a selection there: the commit an undo took back, the clear that made room for a saved picture, and the rest of the same batch (one `correlationId`).

## One example each

**A selection.** Brush the bar, then walk a node-link under it:

```ts
session.why({ kind: 'selection', viewId: 'net~edges' });
// commits: [ { viz, s2, 'declaring' },          // the walk's own commit
//            { viz, s1, 'input-selection' } ]   // the filter it was walked UNDER
```

Undo a brush and the answer names what it took back (`{ viz, s2, 'origin' }`). Apply a saved picture of two conditions and each condition names the other (`'sibling'`) plus the clear that made room (`'replaced'`) — one `correlationId` for the gesture, which is also what threads the tool call that asked for it.

**A chart.** Colour the scatter by a computed column, sort its sheet, then pick a category on the bar:

```ts
session.why({ kind: 'chart', viewId: 'scatter' });
// commits: [ { viz, s4, 'declaring', response: 'filter' },  // the pick — newest, and it FILTERS this view
//            { viz, s2, 'binding' },                        // the reencode
//            { viz, s3, 'arrangement' },                    // the sheet sort
//            { viz, s1, 'derived-column' } ]                // the act that computed cluster_id
```

The anchor is reported **once** — one row per commit, the first role wins — so when the anchor is itself a reaching clause its `response` travels on the `declaring` row (`WhySources.declaringResponse`). An answer must not lose the meaning with the data.

## Reading a row

Every row is an **id and a role**, and the role is the whole of what `why()` claims. A `reaching-clause` also carries the `response` its edge applies, because a clause that filters and a clause that highlights are two different reasons for the same picture. The other chart roles carry no qualifier on purpose: WHICH channel a `binding` rebound, WHICH prop an `arrangement` set, WHICH edge a `link-edit` changed are all facts of the commit itself — resolve the id against `session.commits('anywhere')` and the record's `field` (and `value`) say it, once, where it already lived. The same walk reads the anchor's own act when its `declaring` row carries no qualifier: the id names a record, and the record names the verb.

## What it cannot yet explain

- **A chart the agent PROPOSED.** `ChartView.commitId` names the proposal that minted a chart, and nothing here reads it: `why({kind:'chart'})` answers about a chart the *definition* declared, shaped by acts. Asking why an agent's own chart exists — which proposal, under which words, accepted by whom — is the next gap.
- **A channel that FOLLOWS another view's binding** (an `encoding` edge, `response: 'follow'`). The edit of that edge is named (`link-edit`), but the SOURCE view's binding commit is not, and neither is the act that computed a column arriving that way — `shapingCommits` reads the view's OWN bindings (`viewEncodings`), not the effective ones. Everything named is true; a followed channel is simply not named yet.
- **The kernel tier of a chart** is deliberately an honest miss: a chart may draw several derived columns, so there is no one anchor key. The arithmetic is reached by asking `why({kind:'column'})` about the column the answer named.
- **The reading surface.** The consumer path shipped here is the agent tool (`viz.why`, in the library's own words). A why panel in `ui/` and the studio desk is a later packet.
