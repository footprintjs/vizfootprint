# links — the edge layer of the interaction grammar

A **view** has a **voice**: the emission kinds it can produce (`point`,
`interval`, `cell`, `match`; a declared `point` implies `match`). An **edge**
says what one view's emission does to another: `filter` drops rows there,
`highlight` dims them and keeps them, `navigate` moves the target's viewport
and claims nothing about data, `mirror` outlines the same value there, `none`
says the link is deliberately off. A **graph** is the edges plus a default
rule.

Three laws, stated once here:

- **Nothing implicit.** The default rule (`crossfilter`: every view filters
  every other, self excluded — today's behaviour) is *materialized* into
  explicit edges at declaration. A declared edge replaces the default edge with
  the same `(source, kind, target)` in place. An absent edge under default
  `none` is a silence; a declared `none` is a fact. The matrix shows both.
- **Refused at declaration.** An edge whose kind is not in its source's voice,
  whose ends are not declared views, that links a view to itself, or that
  repeats another edge is refused with a sentence before any session exists.
- **One pass, no cycles.** One emission runs one pass over the edges in graph
  order; a response never re-emits. Filter runs before highlight before
  navigate. (The pass itself lives in the consumer: the ui adapter's
  `selectionForView` reads `edgesInto(target)`.)

**Grain and fold (enforced).** A view may declare its GRAIN on the def
(`grains: [{ viewId, keys }]`): the group keys its marks stand for, `[]` for one
mark per row. An edge whose source emits over an aggregate (a non-empty grain)
and whose target shows another grain CROSSES grains, and must state its `fold`
in words — the def door and the `link` verb refuse it otherwise, with the same
sentence. The default rule's crossing edges carry `fold: 'crossfilter'` when
written out, so no crossing is ever implicit. A view with no grain is never
judged, and only `filter` and `highlight` edges are: a `navigate` moves a
viewport, a `mirror` outlines a value, a `none` carries nothing — no rows fold. **`onClear` (enforced where responses run):** `showAll` (the default)
drops the clause when the source clears; `leave` keeps the last emission in
force on that edge until the source selects again; `excludeAll` keeps nothing.
The session remembers what a cleared view last selected
(`overview.clearedSelections`), and the consumer's `selectionForView` applies
the edge's policy — one rule for a chart; an analysis input stays the live set.

| file | one job |
|---|---|
| `types.ts` | the vocabulary and the `LinkGraph` shape; `edgeId` |
| `voice.ts` | `voiceOf(capability, { hasEncodingSurface })` / `impliedKinds` — the ONE owner of "what can this view emit" (selection kinds from the capability; the `encoding` voice from having a surface) |
| `materialize.ts` | default rule → edges; declared edges override in place; `edgesInto` / `edgesFrom` |
| `validate.ts` | the refusals, as sentences, for `validateDashboardDef` |
| `mermaid.ts` | `linksToMermaid(graph)` — declared === drawn |

Declared on the dashboard def:

```ts
links: [
  { source: 'map', kind: 'point', target: 'diseases', response: 'highlight' },
  { source: 'weeks', kind: 'interval', target: 'trend', response: 'navigate' },
  { source: 'table', kind: 'point', target: 'diseases', response: 'none' },
],
linkDefault: 'crossfilter', // the default; 'none' starts from silence
```

Read back through `session.overview().links` (and the agent's `whats_here`).

**Edited at run time — the `link` verb.** A person (the matrix) or the agent
(`dispatch` with `verb: 'link'`) lands one edge as a commit: `{ source, kind,
target, response, mapping? }`. It is validated exactly like a declared edge,
folds last-wins per edge id (`link:<edgeId>` in the log), overrides the base
edge in place with origin `edited`, and rides undo, bring-over and time travel
like every act. `response: null` un-declares the edit: the edge falls back to
the def's rule (a cleared interval's shape). `applyLinkOverrides(base,
overrides)` is the fold.

## The encoding kind — one chart follows another's bindings

An edge may carry a source view's channel **binding** instead of a selection: `kind: 'encoding'`, response `follow` or `none`. A view has that voice exactly when it declares an encoding surface — even one nobody can brush, whose axis choice the others may follow.

```ts
links: [{ source: 'weeks', kind: 'encoding', target: 'trend', response: 'follow', channels: [{ from: 'color', to: 'color' }] }]
// omit `channels` and the edge is written out with every channel both views declare, by name — never left implicit
```

Two laws, beside the first:

- **No default encoding edge.** Crossfilter is a data-plane sentence; there is no honest default for "every chart's encoding follows every other's." An encoding edge is only ever declared or edited; absent is a silence, a declared `none` is a fact.
- **One hop.** A follow reads the source's **own** binding, never one the source is itself following. Two views may point at each other and each mirrors the other's own choice; where two edges reach one channel, graph order decides.

**Read through, never landed.** A rebind on the source lands one commit and nothing for the target. The target's *effective* bindings are its own fold with the followed channels laid over it, computed at every read, so undo, seek and compare on the source carry the target for free. Each followed channel is judged by the **target's own rules** through the one validator; a refused follow leaves the target's own binding in place and reports the sentence on the wire (`views[].effective.refused`) — reported, never filed as a gap, since a projection must not spend the ledger.

**A follow is never coerced.** A coercion belongs to an act; a follow is a reading. A followed binding that would need a coercer under the target's policy is refused with the sentence, like any other misfit.

**The edge owns a followed channel.** The target's own `reencode` of that channel is refused with a sentence that names the edge; to break a follow, edit the matrix. The wire keeps `encodings` as what a view *chose* and adds `effective` (bindings, followed, refused) and a flat `effectiveEncodings`: render `effective`, edit `encodings`. `onClear` and `fold` do not apply to an encoding edge and are refused at declaration. `why()` does not yet explain a followed binding; the effective block names the edge and its `link` commit carries the cause.

## Routing and offers (steps 5 and 6)

**Routing, read-only** (its own module, `src/links/route.ts`, since it imports agentfootprint's skill-graph door and the ui bundle must not). A view may declare a `does` sentence (`actors[viewId].does`): what acting on it does. `routeNodes(graph.views, does)` makes one node per VIEW that has a sentence and a voice (the act picks the kind; two kinds never tie on one sentence) — never guess a silent view's purpose — and `routeIntent(phrase, nodes)` asks agentfootprint's skill-graph kernel which node the phrase reaches: the scorer scores every candidate, the framework decides `move`, `stay` (mid-conversation ambiguity holds the incumbent), `menu` (a cold-start near-tie) or `unmatched` (nothing above the floor). Routing lands nothing; the act that follows carries the verdict as evidence.

**Offers.** `overview().offers` lists every (view, kind) of the dashboard — a voice is declared and does not move, so neither does this list — and `overview().asOf` states, ONCE, the position they are all good AS OF: an id minted from the cursor. The view's `does` rides once too, on `views[]`. A `select`/`filter` may pass that position back as the moment it is answering; a stale one — the position moved since — is refused as a `stale-offer` gap naming the current one, and a session built with `requireOffer: true` refuses an act that names none. The tool list stays byte-stable: the offer is data in `whats_here`, not a new tool.

The position used to be stamped onto every offer, which made `offers` the largest CHURNING item in the answer — a select moved all N ids while their content was identical. It is one field now, and nothing was given up: what an offer proves is that the agent read a CURRENT answer, and the act it rides on already names its own view and kind, so the node never needed restating in the id. The guard still checks both halves — that the node has that voice, and that the position is current — and says which failed.

**Saved selections.** A note (`annotate`) on a selection commit names it — `annotate { target: <commitId>, note: 'New England' }` — and that is a saved selection: the ui adapter lists every named selection commit (`state.saved`), and applying one is `bringOver(commitId)`, the same replay any commit gets. No new verb, no new namespace: a saved selection is story material, like a bookmark.
