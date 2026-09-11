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
| `{ kind: 'chart', viewId }` | the **newest commit on this branch that shaped what it shows** | `declared-in-def` — the chart looks the way the definition says; the miss **names what reached it** without shaping it (`reached`, below) |

Every one of them is built at the **TARGET's own position** — `branchPath(anchor)`, never the reader's cursor. An id from a branch the target never saw is **dropped and disclosed** (`dropped[]`, with `off-branch` kept apart from `unverified`), never credited as provenance.

## The kind vocabulary

Read in the order a reader walks them: the anchor, its inputs, the other two tiers, then the roles each target adds.

`declaring` · `input-selection` · `kernel-stage` · `agent-frame` — every kind has these four.

`proposal` · `basis` · `ref` — the words a view carries: accepted from, written at, cited by a span.

`reaching-clause` · `binding` · `arrangement` · `link-edit` · `derived-column` — what shaped a chart. A `reaching-clause` carries a **`response` qualifier** (`filter | highlight | mirror | navigate`): a clause reaching a chart plays one role with four meanings, and a role that needs a qualifier takes a **field**, not four kinds. It may also carry a **`narrowed` marker** — the law below.

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

## A clause that filtered nothing is not provenance

**A definition declares its own columns, so the door can answer this synchronously — and where the definition is silent, so is the answer.**

A selection on one view reaches another through the link graph. It may name a column the target's table does not have: a clause the receiving table cannot judge filtered **nothing**, and naming it *the commit that shaped what you see* is a false credit in the one answer a reader trusts most.

So `why({ kind: 'chart' })` asks one synchronous judge — `columnStanding(table, column, reach)` (`src/links/reach.ts`) over the definition's own reading of its tables (`src/def/tableReach.ts`) plus the derived columns live at the cursor — and it has **three answers**:

| the definition says | the answer |
|---|---|
| the table declares its columns and the clause's column is one | judged — credited as a `reaching-clause` like any other |
| the table declares its columns and the column is **not** one | **marked**: the row carries `narrowed: { column, reason }`, and it is never the anchor |
| the table declares no columns (and no act minted it) | **nothing** — no marker, and the answer is byte-identical to one given before the marker existed |

One example each, over the demo's shape (a scatter over a declared `measurements`, a histogram over `radii_per_planet` which an aggregate act mints):

```ts
// 1 · JUDGED — the pick names `planet`, which `measurements` declares
session.why({ kind: 'chart', viewId: 'scatter' });
// commits: [ { viz, s2, 'declaring', response: 'filter' } ]

// 2 · MARKED — a pick on the histogram's own measure reaches the scatter, and
//     `measurements` has no `radii`. It is reported, with the read door's own words.
// commits: [ { viz, s3, 'declaring', response: 'filter' },          // the clause that DID filter
//            { viz, s2, 'reaching-clause', response: 'filter',
//              narrowed: { column: 'radii',
//                          reason: 'table "measurements" has no column "radii" — …' } } ]

// 3 · SILENT — the same gesture on a table that declares no `columns`:
//     nothing is claimed either way, and the row is exactly what it always was.
// commits: [ { viz, s3, 'declaring', response: 'filter' },
//            { viz, s2, 'reaching-clause', response: 'filter' } ]
```

Two consequences worth stating plainly:

- **Marked, not dropped.** A clause nobody mentions reads as a clause nobody sent. Omit, never deny — the same law the read door follows on `ReachingClause.narrowed`, in the same words (`src/session/clausesReaching.ts` · `unjudgeableWords`, the one owner of the sentence).
- **Never the anchor — and the miss names it.** When a marked clause is the *only* thing that reached a chart, the answer is `declared-in-def`: the picture really is the definition's. But **a miss names what reached the target**, so a reader is told everything the door knows, not only that nothing shaped it — omit, never deny, applied to the miss. `WhyTargetMiss.reached` carries every commit that reached the chart and did *not* shape it, as the same `RelatedCommit` rows an `ok` answer would carry (never a twin type): the marked clause with its `narrowed`, and the `derived-column` act that computed a column the chart draws. They pass the same admission `why()` gives a related commit (`src/session/session.ts` · `reachedOnBranch`: validated against this branch, one row per commit, in branch order), so an act on a lineage this cursor left is dropped, never admitted. The key is **absent** when nothing reached — a chart nothing reached answers byte-identically to before the field existed. Only the `chart` miss carries it: a `selection` miss (`nothing-live`) and a `prose` miss have nothing that "reached" them in this sense. The clause's own silence — the rows it did not filter — is still the READ door's to report (`ViewQueryResult.clauses`, and the sheet's status line).

  ```ts
  // 4 · A MISS THAT NAMES WHAT REACHED IT — only the silent pick reached the scatter,
  //     and an act computed `dense`, which the scatter colours by. Neither shaped it.
  session.why({ kind: 'chart', viewId: 'scatter' });
  // { ok: false, missing: 'declared-in-def', target: { kind: 'chart', viewId: 'scatter' },
  //   reached: [ { id: 's1', kind: 'derived-column' },                       // branch order: the act landed first
  //              { id: 's2', kind: 'reaching-clause', response: 'filter',
  //                narrowed: { column: 'radii',
  //                            reason: 'table "measurements" has no column "radii" — …' } } ] }
  // …and a chart NOTHING reached is exactly what it always was:
  // { ok: false, missing: 'declared-in-def', target: { kind: 'chart', viewId: 'scatter' } }
  ```

The whole chain stays **synchronous**: judging this needs no engine and no `await`, because a definition is a declaration.

## What it cannot yet explain

- **A chart the agent PROPOSED.** `ChartView.commitId` names the proposal that minted a chart, and nothing here reads it: `why({kind:'chart'})` answers about a chart the *definition* declared, shaped by acts. Asking why an agent's own chart exists — which proposal, under which words, accepted by whom — is the next gap.
- **A channel that FOLLOWS another view's binding** (an `encoding` edge, `response: 'follow'`). The edit of that edge is named (`link-edit`), but the SOURCE view's binding commit is not, and neither is the act that computed a column arriving that way — `shapingCommits` reads the view's OWN bindings (`viewEncodings`), not the effective ones. Everything named is true; a followed channel is simply not named yet.
- **The kernel tier of a chart** is deliberately an honest miss: a chart may draw several derived columns, so there is no one anchor key. The arithmetic is reached by asking `why({kind:'column'})` about the column the answer named.
- **The reading surface.** The consumer path shipped here is the agent tool (`viz.why`, in the library's own words). A why panel in `ui/` and the studio desk is a later packet.
