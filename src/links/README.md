# links — the edge layer of the interaction grammar

A **view** has a **voice**: the emission kinds it can produce (`point`,
`interval`, `cell`, `match`, `neighbourhood`; a declared `point` implies
`match`, and `neighbourhood` is implied by nothing — see the third law). An **edge**
says what one view's emission does to another: `filter` drops rows there,
`highlight` dims them and keeps them, `navigate` moves the target's viewport
and claims nothing about data, `mirror` outlines the same value there, `none`
says the link is deliberately off. A **graph** is the edges plus a default
rule.

Four laws, stated once here:

- **Nothing implicit.** The default rule (`crossfilter`: every view filters
  every other, self excluded — today's behaviour) is *materialized* into
  explicit edges at declaration. A declared edge replaces the default edge with
  the same `(source, kind, target)` in place. An absent edge under default
  `none` is a silence; a declared `none` is a fact. The matrix shows both.
- **Assumed, except the walk.** A view that declares no capability is assumed
  to speak every kind but `neighbourhood`, and `voiceOf` is the ONE place that
  says so — the session's act door, the overview's `selectionKinds`, the offers
  and this graph all read it, so an agent is never told something the guard
  would refuse. The walk is the exception because it cannot exist without a
  declared relation to walk over (`../def/README.md`, law 7): assuming it would
  offer every chart in the cockpit a gesture none of them could answer, and
  write a default crossfilter edge out of every view for a voice almost none of
  them have. A view that can be walked from says so:
  `capabilities: [{ viewId: 'net', canProbe: true, encodings: ['point', 'neighbourhood'] }]`.
- **Refused at declaration.** An edge whose kind is not in its source's voice,
  whose ends are not declared views, that links a view to itself, or that
  repeats another edge is refused with a sentence before any session exists.
- **One pass, no cycles.** One emission runs one pass over the edges in graph
  order; a response never re-emits. Filter runs before highlight before
  navigate. (The pass itself lives in the consumer: the ui adapter's
  `selectionForView` reads `edgesInto(target)`.)

**A default edge is a promise the engine can keep (enforced).** The
`crossfilter` default may only mint an edge whose clause could *reach* the
target's table. An edge carries a sentence about the source's columns to the
target's **rows**, so two views over tables that no declared relation joins and
that share no column name cannot filter one another — the edge would be a
promise nothing can keep, and an engine asked to judge `radii = 4.5` against a
table with no `radii` refuses the *whole* read.

`reach.ts` is the one owner (`relationPath` finds the relation both it and the edge’s `via` read). `tablesCanReach(source, target, reach)` answers
`true` on the three grounds — one table judges its own sentences, a declared
relation is a permission to read across, one shared column name is a sentence
both sides hear — and `true` on **every kind of ignorance**: no reach handed in,
a view whose table is unstated, a table whose columns nothing declares. It only
ever removes an edge it can *prove* is unkeepable (the `grain.ts` rule: refuse
on evidence, never on ignorance).

```ts
// two views over tables nothing joins: the default mints no edge, and says why
const g = materializeLinks([hist, scatter], [], 'crossfilter', tableReachOf(def));
g.edges;    // []
g.declined; // [{ id: 'hist:point→scatter', source: 'hist', kind: 'point', target: 'scatter', reason: 'view "hist" draws table "radii_per_planet" and view "scatter" draws table "measurements" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there' }]
```

**The map says WHY an edge crosses tables (`LinkEdge.via`).** The second
ground — a declared relation — is written on the edge it explains, for
default, declared and edited edges alike: `via` is the relation path
`reach.ts` · `relationPath` found between the two views' tables, in
declaration order, one hop only. It is absent when the two views draw one
table, when the tables share only a column name (the edge stands on that
ground, and no relation is the reason), or when the graph was judged by no
reach — so every graph built before the key existed is byte-identical. A
reader of the map sees which relation joins the two, and the session's travel
strategy (`../session/README.md`, "A clause travels a relation") reads the
list instead of finding the relation a second time — a semi-join takes the
first listed whose far column the target has, a walk takes the pair its two
endpoint columns declare: the permission and the path can never disagree.

```ts
// a scatter over `planets` and a year chart over `references`, joined by one declared relation
const reach = { relations: [{ from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } }], columns: { planets: ['pl_name', 'radius_ref'], references: ['ref', 'year'] } };
const g = materializeLinks([scatter, years], [], 'crossfilter', reach);
g.edges[0]; // { id: 'mass_radius~planets:point→by_year~references', …, origin: 'default', via: [{ from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } }] }
applyLinkOverrides(g, edits, reach.relations); // an edited edge over the same tables carries the same `via`
```

**A declined edge is a fact, not a silence.** "Declared === drawn" cuts both
ways: a reader who counts the default's n² edges and finds fewer is owed the
reason, so every declined edge is recorded on the graph (`LinkGraph.declined`)
and `linksToMermaid` writes each as a note beside the graph it drew. The key is
absent when nothing was declined, so a graph judged by no reach is byte-identical
to one built before this law.

**A DECLARED edge is the author's claim, and the door judges it separately.**
`links: [{ source, kind, target, response: 'filter' }]` between two such views is
refused by name, in the same sentence, with its remedies:

```
links[0]: view "hist" draws table "radii_per_planet" and view "scatter" draws table "measurements" — no relation joins those tables and they share no column, so nothing this edge carries could be judged there. Declare a relation between the tables, map the field to one the target has, or write response: 'none'
```

Judged for `filter` **alone**. `filter` is the one response that makes an
*engine* judge the source's sentence against the target's rows, so an
unjudgeable filter is a read that would have failed; `highlight` and `mirror`
are drawn, not queried, and an unjudgeable one dims nothing.

**Two grounds, never both judged on one edge.** With no `mapping`, the tables'
own reach decides — a declared relation, or a shared column name
(`tablesCanReach`, above). With a `mapping`, the author has *named* the landing
column by hand, which voids the shared-column-name evidence entirely (two
unrelated tables may still be joined by an aimed mapping) — but the name itself
is now evidence of its own, and `unmappedColumn` judges *that* instead: a
mapping onto a column the target does not have is refused by name too —

```
links[0]: table "nodes" has no column "bogus" — the link from edges maps weight → bogus. Name a column the table has, or write response: 'none'
```

(An earlier cut of this door skipped the mapped case entirely — trusting any
mapping to be self-evidently correct — so a mapped-but-wrong edge was caught
nowhere; review found it and this is the fix, `unmappedColumn`/
`unmappedColumnWords`.)

Where the rule is **not** knowable at declaration — a table that declares no
columns, or a field that depends on the gesture — the runtime half catches it:
`../session/README.md`, "A clause a table cannot judge". There, the two
grounds split again: an unmapped miss is *narrowed* (omitted, reported, the
read survives); a mapped miss still **refuses** the read, because an author's
aim that misses is an error, not a coincidence to omit quietly.

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
| `materialize.ts` | default rule → edges (none within a frame: a view and its layers — `sharesFrame`; none into or out of a FRAME that reads no rows — `isFrame`; `via` written on every edge a declared relation explains — `viaOf`); declared edges override in place; `edgesInto` / `edgesFrom` |
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

**A frame's layers are one place — nothing crosses between them unless
declared.** A view over more than one table has layers (`encodings[i].layers`,
[`../def/README.md`](../def/README.md) "Layers"), and each layer is its own
node of the graph under its address `viewId~layerId`, speaking its view's
voice. The default rule writes NO edge between two nodes that share a frame —
a view and its layers, or two layers of one view — for the reason it writes
none from a view to itself: the layers of a node-link already share a canvas,
and a select on the nodes cannot filter the edges by a nodes column. Every
other pair follows the rule as before, and a declared edge may name a layer
address on either end:

```ts
encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: [
  { layerId: 'nodes', table: 'nodes', chartKind: 'point', channels: ['x', 'y', 'size'] },
  { layerId: 'edges', table: 'edges', chartKind: 'line',  channels: ['x', 'y'] },
]}],
links: [{ source: 'net~nodes', kind: 'point', target: 'net~edges', response: 'highlight' }],
// materialized: the one declared edge, and no default edge among net, net~nodes, net~edges
// links[0].source "net~ghost" is not a declared view              ← an undeclared layer
// links[0]: view "net~nodes" declares no encoding surface — …     ← an encoding edge: a layer's bindings are declared on the layer
```

A graph with no layers is written exactly as before: a plain viewId is its own
frame, so "shares a frame" is "is the same node".

**The frame is its layers — a view's own address is a node only when it reads
rows there.** A node of the link graph is a place that reads rows. A layered
view's own address reads the default table only when the view binds something
at its own level (a non-empty view-level `initial`); otherwise the map lists it
as a FRAME — `LinkView.frame`, the layer addresses that read for it, never
beside `table` — the default rule mints no edge into or out of it (and records
nothing under `declined`: a frame is not a refused edge, it is not a node that
reads), and a declared edge naming it is refused by THAT name, with the layers
to use — never as "not a declared view", because it is declared. The question
has ONE owner, [`../def/layers.ts`](../def/README.md) · `readsOwnTable` (law 6a
there, with the exoplanet-shaped example); this package only reads the answer
off the node. WHY the node is listed rather than dropped: the map says what a
view IS, and a reader of the graph still finds the view under its own id with
its readers beside it.

```ts
// a scatter with ONE layer over `planets` and no view-level `initial`, beside a sheet over the default table
views: [{ viewId: 'mass_radius', voice: […], frame: ['mass_radius~planets'] }, { viewId: 'sheet', voice: […], table: 'measurements' }, { viewId: 'mass_radius~planets', voice: […], table: 'planets' }]
// materialized: sheet ↔ mass_radius~planets only — nothing into or out of mass_radius, nothing declined for it
// links[0].target "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets   ← a declared edge into it
// links[0].source "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets   ← …or out of it
```

**Edited at run time — the `link` verb.** A person (the matrix) or the agent
(`dispatch` with `verb: 'link'`) lands one edge as a commit: `{ source, kind,
target, response, mapping? }`. It is validated exactly like a declared edge —
the SAME reach-law refusal included (`InteractionSessionImpl.doLink` reads
`tableReachOf(this.runtime.def)` off the running def, the ONE reader both
doors already shared; review found this call omitted `reach` and fixed it,
since a promise "the same refusals a declared edge gets" that only held for
half of them was worse than making none) — folds last-wins per edge id
(`link:<edgeId>` in the log), overrides the base edge in place with origin
`edited`, and rides undo, bring-over and time travel like every act.
`response: null` un-declares the edit: the edge falls back to the def's rule (a
cleared interval's shape). `applyLinkOverrides(base, overrides)` is the fold.

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
