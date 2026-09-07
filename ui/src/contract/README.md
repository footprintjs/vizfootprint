# `ui/src/contract` — the renderer contract

The MAP says what could happen, the TRACE records what did, and the FOLD
derives what is on screen. **This folder is the door any charting stack walks
through to join that loop.** A renderer says hello (the version it speaks, its
honest capabilities, the transforms it declares), the host pushes it a
`RenderState` per frame, and the renderer talks back through exactly four
callbacks. `bindRenderer` guards the door; `runConformance` proves a renderer
actually walks it.

Everything the surrounding library claims rests on one property: *what you see
is derived from a recorded trace*. A contract that promises a behaviour it does
not carry breaks that claim more quietly than a bug does — nothing crashes, a
host simply believes something untrue. So this folder is written to a single
standard, and the three laws below are why each piece of it looks the way it
does.

---

## Law 1 — a capability is a promise about the BOUND renderer, not about the chart underneath

`RendererCapabilities` is read by hosts to decide what a view can be asked to
do. A flag is therefore `true` only when **`update()` on this mount visibly
delivers that behaviour through the contract** — never when the wrapped chart
*could* deliver it if someone wired it by hand outside the protocol.

The bar chart is the worked example, and it is a real one — it used to fail
this law in the honest direction and now passes it in code rather than in
prose.

`<VizBar>` can draw a Layer-4 **highlight share**: a narrower inner bar saying
"this much of it is bright" under another view's `highlight` edge. The demo
drives that prop directly and it works. But bound through the contract, the
chart receives rows the HOST already aggregated — one row per category, with
its count — and the transform-ownership rule forbids it from counting anything
itself. It has no rows on screen to dim and no way to recompute a share. So
the bright share can only arrive the way every other aggregate arrives: as a
second host-computed number on the row.

Which makes the flag a *consequence*, not a decision:

```ts
// no highlight field named → nothing to draw → the flag says so
barRenderer();
//   hello.capabilities.canHighlight === false

// the host names the field it aggregates the bright share into
barRenderer({ countField: 'cases', highlightCountField: 'brightCases' });
//   hello.capabilities.canHighlight === true
//   update() draws rect.vzf-barhl over each bar, to scale
```

```ts
canHighlight: highlightField !== undefined,   // renderers.tsx — the law, in one line
```

Two details that are part of the law, not decoration. **The flag is computed at
the factory**, so the declaration cannot drift from the wiring — you cannot flip
one without the other. And a frame whose rows carry no share draws **no
overlay at all** rather than an overlay of zeros: an absent highlight is an
absence, and a bar reading "none of this is bright" would be a claim the host
never made.

The pinning test (`capabilities.test.tsx`) asserts both halves of each
declaration together — the flag AND what the mount does when a host pushes a
live highlight clause. They fail together on purpose.

## Law 2 — a capability exists so a HOST can refuse out loud; a channel that records nothing needs no flag

It is tempting to add a flag per verb for symmetry. Don't. A capability earns
its place when its absence would otherwise be **silent** — when a host drives an
act that would vanish with nothing on the record to show for it.

That is exactly one verb today. `navigate` is the only act a host pushes INTO a
view, so a non-capable view must refuse audibly:

```ts
const bound = bindRenderer(scatterRenderer(), el, { viewId: 'scatter', callbacks });
bound.view.navigate({ x: [0, 100] });
// { ok: false, gap: { code: 'navigate-unsupported', op: 'navigate',
//   detail: 'view "scatter" declares canPanZoom: false — the navigate request was not recorded' } }
```

The other flags need no guard, and adding one would be theatre. `canBrush` and
`canPointSelect` describe gestures the *user* makes, and those ride `emit`,
which the session records whether or not a flag was set. `canHighlight` and
`canReencode` describe what a renderer does with state the host pushes, where
absence is visible on screen rather than silent.

**`hover` is the case that settles the rule.** It is declared on the callbacks,
carried on `RenderState`, collected by the conformance kit — and no first-party
renderer speaks it. That looked like a gap ("a host cannot ask who hovers"), and
it is not one, because hover is the single verb on the rail that **records
nothing**. This library deliberately does not log transient state; a hover is
derived from a pointer, never from the trace, and it never lands a commit. So a
renderer that never hovers loses nothing that a host needed to know in advance:
push `state.hover` to everyone, and a renderer without a hover concept ignores
it. There is no gap to file because there is no act to lose. The channel stays
(it is the protocol's only home for a crosshair a host wants to coordinate, and
the kit proves such a hover reaches the host and never reaches the trace) and
carries no `canHover` — by decision, now written down where the next reader will
find it.

## Law 3 — a visible act either reaches the record, or claims nothing

`canRearrange` was declared here, set `true` by the table renderer, and honoured
by nobody: `RendererCallbacks` had no rearrange verb, `bindRenderer` never read
the flag, and `<VizTable>`'s column sort lived — and still lives — in its own
React state. A user reordered a table in front of a dashboard whose whole claim
is provenance, and the record never heard about it.

The flag is gone. The sort is not: it stays visible, local, and now **stated**
as local in both `VizTable`'s header and `tableRenderer`'s docs. That is the
honest end of it, because a column sort is the same class of act as a scroll
position — it changes no rows, no selection and no fold, so a replay of the
trace reproduces the dashboard exactly without it.

Removing beat pretending, and the reverse would have been worse: today's four
callbacks are a renderer's entire voice, and the nearest existing verb,
`navigate`, is typed as DATA-space viewport domains and recorded by the host as
a viewport move. Pushing a sort order through it would have put the act on the
trace **under another act's name** — a second lie, on the record this time.

If a sort ever must survive time travel, it becomes an arrangement commit, and
it takes four things in this order (the same list is in `types.ts`, where
someone tempted to re-add the flag will read it first):

1. a dispatch verb that RECORDS an arrangement — the library already has the
   shape: `navigate` with the `layout:${scope}` identity lands one cause-tagged
   commit carrying plain `field`/`value` strings, and time travel restores it;
2. a FIFTH outbound callback carrying the new order — a protocol MAJOR
   decision, since "exactly four verbs" is a stated law, not an accident;
3. a `bindRenderer` guard, so a host-driven rearrange on a non-capable view
   files a typed gap the way `navigate` does;
4. a conformance step proving the reorder lands a commit.

Until all four exist, a renderer that reorders says so in its docs and declares
nothing.

Removing it did not bump `RENDERER_PROTOCOL_VERSION`, and that is not an
oversight: no code ever read the flag, so a third-party hello that still
carries it binds byte-identically — `bindRenderer` reads the version, the
declared transforms and `emissionKinds`, and nothing else. A version bump
signals a change in what the protocol *does*; this changed only what it
claimed.

## Law 4 — one frame may hold several tables, and a layer speaks through its own bundle (protocol 1.2)

A node-link is two tables on one picture: edges drawn under nodes. A view has
no table of its own — every act on a plain view is judged against the
dashboard's default table — so the library gives a view **layers**, each with
ITS table, and names a layer by an ADDRESS, `viewId~layerId`. The address reads
as a viewId everywhere a viewId is accepted: the log, the fold, the tools and
the session's guards never split it; only the session's table guard does, and
the marker has exactly one owner (`vizfootprint/def`'s `layerAddress.ts`, pinned
by a grep over this folder too). This barrel re-exports `layerAddress`,
`splitLayerAddress`, `holdsLayerMarker` and `LAYER_MARKER` so a host never
spells it.

The contract carries layers as three optional additions — which is why 1.2 is a
MINOR, and why a 1.1 renderer binds byte-identically:

- `RenderState.layers?` — the frame's layers in draw order (first = bottom),
  each `{ layerId, table, rows, encodings }`, rows host-prepared exactly like
  `rows`;
- `RendererCapabilities.canLayer?` — the honest declaration that `update()`
  draws them;
- `HostHandshake.layers?` — one callback BUNDLE per layerId, the same four
  verbs bound to the layer address. Not a fifth verb, not a third emission key:
  which layer spoke is carried by **which bundle spoke**.

```ts
// the host binds the view's layers once; bind mints each address and wires a bundle
const res = bindRenderer(networkRenderer(), el, {
  viewId: 'net',
  callbacks: callbacksFor('net'),
  layers: { layerIds: ['edges', 'nodes'], callbacksFor },   // → handshake.layers.edges / .nodes
});

// the renderer, on a click on an edge mark — through the EDGES bundle, never the view's callbacks
handshake.layers!['edges']!.emit({ rawValue: 5, encoding: { kind: 'point', field: 'weight' } });
// → ONE commit, viewId 'net~edges', judged against the edges table; the fold keys its clause under that address
```

**The fold follows the address.** A layer's clause is keyed by the address that
holds it, so a layered renderer's `RenderState.selection` must be folded for the
LAYER whose marks it draws — `selectionForView(selections, layerAddress(viewId,
layerId))` — and not for the view. Folded for the view, that layer's own clause
reads as FOREIGN: the mark it selected loses its outline, its neighbours dim by
the chart's own clause, and click-again never clears. `netState` in
`conformance.test.tsx` is the worked example.

Two halves of the law, pinned together in `capabilities.test.tsx` the way the
bar's `canHighlight` is. **The flag is the promise, not the ability.** The
fixture renderer that draws layers but declares nothing is refused exactly like
the eight first-party charts, none of which declares `canLayer`. And **a frame
is whole or refused**: `bindRenderer`'s `update` files a typed
`layers-unsupported` gap when a host pushes layers at a renderer without the
flag, and forwards NOTHING of that frame —

```ts
bound.view.update({ ...frame, layers });
// { ok: false, gap: { code: 'layers-unsupported', op: 'update',
//   detail: 'view "net" declares no canLayer — the frame carried 2 layer(s) and was not drawn' } }
```

**What changed for a host, in one line:** `BoundRenderer.update()` now answers
`UpdateOutcome` where it answered nothing, mirroring the `navigate():
NavigateOutcome` already beside it — a host that ignores the answer, or reads
`.ok`, is unaffected, and a host that only listens on `onGap` still hears this
refusal there. This is a HOST-side type, not the wire: `RENDERER_PROTOCOL_VERSION`
moved 1.1 → 1.2 for the three optional additions above, and a RENDERER's own
`update(state): void` (`Renderer` / `MountedRenderer` in `types.ts`) is
untouched — no renderer, first-party or otherwise, returns anything. The one
place that must change is a hand-authored object typed as `BoundRenderer` (a
downstream test double): `update()` there must now return `{ ok: true }`.

This is Law 2 applied to an inbound push, and the reason it earns a guard: a
renderer that drew only `rows` from a layered frame would show ONE table under a
picture that looks complete — absence that is not visible, which is the one
kind Law 2 says must be refused out loud. An empty `layers: []` carries nothing
to refuse and is forwarded like a plain frame.

The conformance kit's `layers` arm (gated on `canLayer`, skipped honestly
otherwise) pushes the plan's two-layer frame, requires both drawn, then drives
a gesture on the SECOND layer and requires exactly one commit whose viewId is
that layer's address — a gesture spoken through the view's callbacks, or
through the first layer's bundle, fails the arm in plain words. It runs on a
real two-table session (`adapter/network.fixture.ts`) against a pure-DOM
`canLayer` renderer (`layered.fixture.ts`).

Not in this version: shared scales across layers, per-layer opacity/visible
dials, annotation layers, and any first-party layered chart — the network view
is the next packet. Sibling layers get **no implicit crossfilter**: a select on
`net~nodes` reaches `net~edges` only through a declared link.

---

## Adding a capability — the checklist

1. **Name the act.** Who performs it: the user (it rides `emit`), or the host
   (it needs a guard and a typed gap)?
2. **Does it record?** If nothing lands on the trace, ask Law 2 whether a flag
   is warranted at all.
3. **Wire it first, declare it second.** The flag goes in only once
   `update()`/`bindRenderer` deliver the behaviour — and prefer *computing* it
   from what was wired, as `barRenderer` does, over writing a constant.
4. **Pin both halves in `capabilities.test.tsx`**, in one test: the declaration
   and the observable behaviour, failing together.
5. **Version it.** A new optional field on the hello is a MINOR bump
   (`RENDERER_PROTOCOL_VERSION`); a new outbound verb is a MAJOR one. 1.1
   added the `cell` kind; 1.2 added layers (`RenderState.layers`, `canLayer`,
   the handshake's bundles) — all optional, so both stayed minors.

## One more habit: the derivation helpers ship in a set

`selfSelectedValue` / `selfSelectedInterval` / `selfSelectedCell` /
`selfSelectedSet` are how a host-built chart reads its own live selection out
of the addressable fold instead of keeping private state. SET-1 added the
fourth and the barrel was never updated, so for a while a consumer could
outline a point, an interval and a cell but not a multi-select — the shape the
release was named after. When a selection shape is added, export its reader
from `index.ts` in the same change, and give the chart-side helpers
(`selectedSet`, `inSet`, `markClass`, and the SET-1 emission builders) the same
treatment in `primitives/index.ts`. A law nobody can import is a law nobody
obeys.

`filtersHere` is the same habit applied to a RULE rather than a shape. Which
link response NARROWS a view — `filter` and, on a graph-less wire, `undefined`;
never `highlight`, `navigate` or `mirror` — is the rule `keepPredicate` folds
by, and it used to live only inside that fold. A host that reads one clause's
value by hand has to narrow by the same rule or its dashboard says a link is
off while the view moves anyway, so the demo restated the line. It is exported
now and `keepPredicate` calls it: one rule, one spelling, one answer.
