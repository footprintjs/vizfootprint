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

### The kinds are a promise too, and `runConformance` now holds them to it

`emissionKinds` is the same promise about the same mount, and it used to be
checked in one direction only: `gesture-emits` holds every EMISSION to the
declared kinds, and nothing held a declared KIND to a gesture that delivers it.
So a renderer could declare `interval`, be handed a state it draws no brush for,
and pass the whole kit. That is exactly what happened on a real page: a line
chart standing on a band drew **no brush element of any kind** and a drag left
every count unchanged, while its hello — and the dashboard's own definition —
said the view emits an interval.

Step 11, **`declared-delivered`**, closes it: every emission kind the renderer
declared and this state can deliver must have been delivered by one of the
gestures above it, and the ones that were not are named.

The hard part, and it is the reason the step takes a plan field rather than
being a bare assertion: **a hello is fixed at MOUNT, before any state**, and a
mark's gesture may land a different clause on a different scale. A line brushes
an `interval` over a run of dates and lands a `match` over a band of categories
(law 13, `../../../src/def/README.md`), so it honestly declares both — and one
state is one of them. `ConformancePlan.stateKinds` is the HOST saying which
picture this run is; the three state-sensitive arms (`cell`, `match`,
`neighbourhood`) read the same narrowing through one function, so an arm that
honestly skips a kind and a delivery check that demands it can never contradict
each other. With no `stateKinds` every skip sentence reads exactly as it always
did, and every declared kind is demanded.

### …and the kind label was not enough: a DELIVERED clause must be able to ADDRESS its axis

The step above compares **kind labels**, and a kind label cannot lie about a
value. So it passed the next capability lie one layer in, and a reader found it
before CI did: a line over a residue-number axis **drew** the brush, **fired**
the gesture, delivered the DECLARED kind — and handed the session
`["107", "241"]`, date-shaped strings for a numeric column. 162 marks before the
drag, 162 after. The session took the clause, matched no row with it and filed
**no gap at all**.

So the step gained a second half: every delivered `interval` had to be able to
address the axis it named — `intervalAddresses` / `unaddressableIntervalRefusal`
(`vizfootprint/def`, beside law 13's `drawsIntervalBrush`, which judges a
DECLARATION and therefore never sees a value). The kit could ask what a
renderer cannot, because it holds the live `SessionView` and that state carries
the schema: the contract hands a renderer rows and a folded frame, never a
typed column list.

### …and then the fence moved to the DOOR, and this step went back to kind labels

**The next defect wore a `match`, and it was worse than the one before it.** A
line drawn as a band over a column of numbers declared `match`, drew a brush,
fired a gesture and delivered a match — every word true — while handing over
`["63","64"]` for that column. Measured on a real page: the record went from 4
commits to **5** with the refusal ledger unchanged at 3, and 185 marks in force
became **0**. *A landed clause that kept nothing is worse than a refusal, and
worse than the dead gesture it replaced, because the record now claims the
question was answered.*

The reason the interval arm had lived HERE was that the **session took such a
clause silently** — there was nowhere better. That is no longer true: the
session's probe door refuses an unaddressable point, match or interval by name,
under its own gap code, quoting the column, the kind and what it was handed
(`unaddressableClause` / `unaddressableValueRefusal`, `vizfootprint/def`; the
interval sentence is unchanged, byte for byte). **So the arm is gone from this
step rather than doubled**, and three things follow:

- **`declared-delivered` is about KIND LABELS again**, which is the honest limit
  of what a kind check can know.
- **The door runs BEFORE this step.** Such a gesture lands no commit, so the
  run fails at **`commit-lands`** — which now quotes the session's newest gap
  verbatim, turning *nothing happened* into the diagnosis. That step earns its
  keep for every refusal, not only this one: a capability the view never
  declared and a column that is not there read the same way now.
- **Two fences for one law could only drift**, and a check that can no longer
  fail is a check nobody is running. The door's is also the stronger one: it
  fires for every clause anybody dispatches, not only inside a conformance run.

```
commit-lands: the emission never landed a commit in the session log — the session refused it
              (unaddressable-value): view "surface" delivered the interval ["107","241"] on "resnum",
              whose scale is quantitative — numeric bounds address that axis, so no row can answer the
              clause; an interval addresses the axis it was drawn on
```

**And what neither fence can catch, named rather than implied.** A band exists
because its column folded CATEGORICAL, and the categorical fold names every
cell it is given — so a column reported as text may honestly hold numbers, and
the door declines to judge a value against that declaration. For a band over a
`string` or `boolean` column the only fence is the CHART tier: one owner for
what a slot's name stands for (`slotValues`, `../primitives/slotValues.ts`) and
the tests that pin it per chart.

**And the harder half of that lesson, which no predicate fixes.** Even with the
new arm, the kit only ever sees the states a PLAN builds — and no plan had ever
built a line over NUMBERS. One run is one state (below), so the defect was
invisible for the same reason step 11's own caveat describes. The fence that
actually catches this class is **two things together**: the refusal, and a plan
per x kind. The first-party suite now runs `lineRenderer` **four** times — a run
of dates, a run of numbers, a band of strings, and a **band drawn on a NUMBER
column** — and the four runs together are the claim. That fourth plan is the
state the second defect lived in and the one no plan had ever built; it asserts
the ACCEPTED clause off the session's own log **and the row count it narrowed
to**, because a landed commit that kept nothing is precisely the bug and a test
that stops at "ok" proves nothing. If only one half of the fence survives, keep
the plan: it is what turns "the fence exists" into "the fence ran".

A **third** kind joined the line for the same reason, and the reason is worth
reading twice: a *reachability* fix changed a gesture, and the declaration had
to move with it. A band line's TAP used to release the match; it now **selects
the slot under the pointer** (the reachability law — `../../README.md`, "A mark
you are meant to press must be REACHABLE"), landing the `point` the bar's own
click lands, because at 185 slots in 940px a drag was the only gesture that
could reach a slot at all. So `lineRenderer` declares `interval + match +
point` and `canPointSelect: true`, and a band state narrows to whichever of
them its gesture delivers. **A gesture that changes what a mark emits changes
what its renderer must declare** — a hit area does not (a transparent target
over a bar emits the bar's own clause and adds no kind, which is why nothing in
this file moved for it), but a tap that means something new does.

```ts
// a RUN state: the line delivers the interval, and says it does not deliver the band's match
await runConformance({ renderer: lineRenderer(), …, stateKinds: ['interval'] });
//   match:              the renderer declares match, and this state does not deliver it — the match arm is honestly skipped
//   declared-delivered: every declared kind this state can deliver was delivered: interval (of interval+match+point, this state delivers interval)

// the hostile shape, caught by name
//   declared-delivered: the renderer declares interval and no gesture delivered it for this state
//                       — declare only what this mount delivers, or name this state's kinds in the plan
```

**What it still cannot check.** One run is ONE state, so the kit cannot see a
kind that NO state ever delivers — a renderer declaring `interval` and never
brushing anything anywhere passes every single-state run whose plan narrows it
away. Holding that would mean the kit enumerating a renderer's possible states,
which it cannot do: the states are the host's. What it can do, and what the
first-party suite does, is run the SAME renderer once per x kind — a run of
dates, a run of numbers and a band — and those runs together are the claim. It also cannot judge
whether a plan's `stateKinds` is honest about the state it built; that is the
host's own declaration, and the kit is host-side CI rather than a referee
between a host and itself.

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

**Captions are opt-in decoration.** `<VizNetwork showNodeLabels showEdgeLabels
nodeRadius={n}>` draws a node's `label` (its id when none is declared; an empty
label hides it) and an edge's `label` beside the mark, facing into the frame,
hidden from assistive technology and ignoring the pointer, and dimmed with the
mark it names under a brush. A caption never changes a selection's identifier
— the gesture still lands on the id — and a hostile caption renders only as
text. The radius is clamped to 1–16 and falls back to the default outside it.


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

**The fold follows the address — one per layer (protocol 1.8).** A layer's
clause is keyed by the address that holds it, so each `RenderLayer` carries
`selection`, the fold at ITS address — `selectionForView(selections,
layerAddress(viewId, layerId), resolve, links, cleared)` — and a layered
renderer reads that for the layer's marks (Law 7 below). A layer that carries
none reads the frame's `RenderState.selection`, and for a frame whose every
mark belongs to one layer (the node-link) that fallback must itself be folded
for THAT layer and not for the view: folded for the view, the layer's own
clause reads as FOREIGN — the mark it selected loses its outline, its
neighbours dim by the chart's own clause, and click-again never clears.
`netState` in `conformance.test.tsx` is the worked example of both hosts.

Two halves of the law, pinned together in `capabilities.test.tsx` the way the
bar's `canHighlight` is. **The flag is the promise, not the ability.** The
fixture renderer that draws layers but declares nothing is refused exactly like
the eight first-party charts that declare none — the ninth, `networkRenderer`,
declares it and is drawn. And **a frame is whole or refused**: `bindRenderer`'s
`update` files a typed
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

THE FRAME IS ITS LAYERS (`vizfootprint` "Layers" law 6a) reaches the kit too:
the GENERIC arm (`gesture-emits`/`commit-lands`/`crossfilter-returns`) drives
and expects the plan's own gesture to land at `viewId`, UNLESS the MAP itself
says the view is a frame — `view.getState().links.views` carries `LinkNodeView.
frame` (present exactly when the address reads no rows of its own), read off
the session, never asked of the host. On a frame the kit drives that gesture
through the FIRST address the map names for it instead (the same list the
layers arm reads for the SECOND) and expects the commit there. One owner: a
host cannot set this wrong, because the kit never takes its word for it — it
reads the same fact the session's own refusal is judged against.

### The frame — the layers' shared scales, already folded (protocol 1.5)

A stack of layers is one picture only if it is read on one set of scales. The
def declares that in WORDS — `ViewEncodingDecl.frame`, a `ChannelResolution`
per channel, into which no number can be typed — and the HOST folds it:
`frameDomains` (`vizfootprint/def`) turns the resolution plus the layers' own
values into `RenderState.frame`, at every update.

```ts
// what the host pushes — the numbers are here because the host folded them
frame: {
  x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'temporal', domain: ['2026-01-04', '2026-03-01'] },
  y: { mode: 'shared', basis: 'rows',  guide: 'merged', scale: 'quantitative', domain: [0, 90] },
  color: { mode: 'independent', guide: 'per-layer' },
}
// a channel nothing could be folded from carries NO entry — no domain is more honest than [0, 1]
```

Three things a renderer can rely on. **The domain agrees with the marks**: it
was folded from the same rows, at the same update, through the same door
(`adapter/layerRows.ts`), with absence rows already dropped — an axis drawn
from it cannot contradict what is drawn beside it. **`basis` says which read
it was**: `'table'` means the table's rows at the cursor (a filter elsewhere
repaints the marks and leaves the axis where it was), `'rows'` means only the
rows this frame draws. **`guide` says who draws it**: `'merged'` = the frame
draws ONE axis or legend for the stack, `'per-layer'` = each layer still draws
its own.

**Why this needs no capability flag** (Law 2's test): a renderer that ignores
`frame` draws each layer on its own extent, which is the `independent` picture
and a complete one — nothing is hidden, so there is nothing to refuse out
loud. That is why 1.5 is a MINOR and why a 1.4 renderer binds and draws
byte-identically (`capabilities.test.tsx` pins it: the same frame with and
without the field renders the same DOM). Honouring the frame is a PROMISE some
renderers make — `networkRenderer` folds its one px-per-unit substrate through
`frameDomains` today, and the generic frame renderer draws the merged guide —
and each 2D chart takes the domain as a prop (`domain={{ x, y }}`,
`axes={false}` while the frame draws the guide), so a host can put a layer on
a shared scale without the chart knowing a frame exists.

Two things to know when you push it into a chart. A `ChartDomain`'s `x`/`y` are
NUMBERS, so a `temporal` domain — ISO strings, as the fold answers them — is
converted by the caller with `epochOf` (`primitives/scales.ts`), the same
function the charts use on their own rows; and a `categorical` domain rides on
`domain.categories` instead, the BAND ORDER a band chart lays its slots out in
(`bandOrder`), because a bar has no quantitative x to scale. A value outside the
domain is DRAWN, at its true position: a domain says what the axis means, and a
row past it is a data fact, not an overflow — seeing a layer run off the frame
is the point of sharing one. **A DECLARED extent is the one case that also gets
WORDS** (`ResolvedChannel.bounds`, law 14: what the quantity CAN be, which
`spanOf` prefers over the fold's own union when a def declared one). A folded
domain is a union over the rows, so nothing can be outside it; a declared one
can be wrong, and a mark past the plot edge is invisible rather than merely
off-centre. So the chart COUNTS what falls outside and says it, in the picture
and in the accessible name, in the register the logarithm's exclusions already
use: `x has 3 values outside its declared bounds [0, 100] — bounds say what the
quantity CAN be, so either they are wrong or this data is` (`outsideNotes`,
`primitives/scales.ts`, beside `excludedNote`; honoured by `VizScatter` on both
axes and by `VizLine` on its value axis). Still drawn, still at its true
position — counted, never hidden, and never refused. The band spelling of that law is the same: a
category the frame's list does not name is APPENDED, never hidden, and a slot
the layer has no row for stays EMPTY rather than becoming a bar of zero ("no
rows here" and "none of them" are two different sentences).

**A ZERO GUIDE rides on the same object** (`domain.zeroGuide`, law 12): a
declared line where a signed scale crosses zero, PASSED THROUGH from
`RenderState.frame` to the merged guide and to every layer that binds the
channel, and decided by neither this renderer nor the fold — whether zero is on
the axis at all is the CHART's answer, against the domain it actually drew on
(`zeroGuideFor`, `primitives/zeroGuide.ts`). Who draws it is the frame's
existing `guide` law and not a new one: merged means the frame draws the axis
and its zero, per-layer leaves both to the layers. A layer whose MARK draws no
zero guide on that channel is refused by name, in the def door's own sentence
(`zeroGuideRefusal` · `zeroGuideKindRefusal`) — a hand-folded frame is a public
shape, and a declaration silently dropped is worse than one refused.

**WHERE "one line for the stack" IS ENFORCED, and the rule it replaced.** It
used to ride the CHART's `axes` prop: a layer under a merged guide is handed
`axes={false}`, and the charts read that as "draw no zero line either". The rule
was tidy and it was wrong, because `axes: false` is as often a **density**
decision at a chart's own door — no room for tick labels — as it is "the frame
draws this one", and a chart cannot tell those apart. **This door can**, because
it is the door that decided which axes the frame draws: `layerDomain` does not
ASK a layer for a guide the frame is drawing (`frameDraws`, the same two
conditions `VizFrame` gates its own guide on — it has a guide to draw at all,
merged or a stack whose x it draws once, AND it was given that axis). So the
stack still gets exactly one line, and the charts now draw the guide they were
asked for whatever `axes` says: **ticks and labels are what that flag
suppresses**, because a tick label needs room to be legible and a line at zero
needs one pixel. On a signed scale that line is what the marks are read
against — a dot above it and a dot below it mean categorically different
things — so dropping it removed the ability to read the SIGN. Measured before
the change: a backbone-angle pane at 282×171, 181 dots, no ticks, no crosshair.
Every refusal is untouched: a domain without zero and a logarithmic axis are
refused exactly as before, at any density.

**A line on a band — band versus run is a property of the x COLUMN, not of the
mark.** A line whose x is categorical is a band line: each point sits at its
slot's centre, the segments between are connectors drawn in slot order, and
they claim nothing between slots, because on a band there is no between. The
frame classifies every layer by its x column (`bandX` in `renderers.tsx`): a
bar or a box plot is always a band (the mark makes slots of whatever it is
given), a histogram is always a run (its bins sit on a number), and a line or a
point is a band exactly when the column it binds to x was folded as
categorical — the fold's own answer (`frameScaleOf`, `src/encoding/frame.ts`,
is the one owner of "a string or a boolean folds as categorical"), never a prop
on the mark. Refused, with the reason: an `xKind` prop on `VizLine` to force
the band — the x column's type is a fact the definition and the fold already
carry, and a prop would be a second owner that could disagree with them. The
line's THIRD x, a run of NUMBERS, is read the same way and for the same reason
(`VizLine` · `xKindOf`): the fold's `quantitative` where a host folded one, and
otherwise the quantity each row's own cell holds — the renderer decides no axis,
it hands the chart each row's value faithfully. The
frame hands a band line the band order exactly as it hands a
bar (`domain.categories`), and the two place a slot through ONE geometry
(`bandWidth`/`bandCentre`, `primitives/scales.ts`), so a bar's slot and the
line's point for one category are one x by construction. A slot the line has no
point for is a GAP — the segments on either side stop at their own points; a
line does not invent a value for an empty slot. Two band lines share the band
order the way two bars do, under the same two-bands law. A band line draws no
brush: an interval has no meaning on a band.

The ordinary figure this makes drawable — bars by year with a line of the mean
over them:

```ts
// the bars bind `category`, the line binds `x` — the SAME column, folded as categories on both
const bars = { layerId: 'sales', table: 'sales', rows: countsByYear, encodings: { category: 'year', y: 'count' } };
const mean = { layerId: 'mean', table: 'sales', rows: meanByYear, encodings: { x: 'year', y: 'mean' } };
const frame = frameDomains([
  { layerId: 'sales', chartKind: 'bar', channels: { category: { type: 'string', values: years }, y: { type: 'number', values: counts } } },
  { layerId: 'mean', chartKind: 'line', channels: { x: { type: 'string', values: years }, y: { type: 'number', values: means } } },
]);
const renderer = layeredRenderer({ layers: { sales: { kind: 'bar' }, mean: { kind: 'line' } } });
// → ONE band axis of years, the bars in their slots and the line's points at those slots' centres
```

A bar's x is its `category` channel and a line's is `x` — two channel NAMES, and
the frame's shared-axis door (`sharedAxis`) reads them as ONE axis when both were
folded as categories, uniting the two lists in declaration order the way it
already unites every layer's own rows (`fullBandOrder`). The same line over the
same bars with `year` typed as a `date` is the picture the frame still refuses —
see the table below for its sentence.

**The def door agrees.** A line's x takes a category at declaration too
(`CHART_REQUIREMENTS.line.x`, `src/encoding/requirements.ts` — the door and
the renderer agree, kind by kind), so this figure is a DEFINITION and not only
a page built by hand: a bar layer and a line layer binding one string column to
`x` build, lint clean, and fold one categorical x
(`src/def/encoding.def.test.ts`). A scatter's x stays a number or a date at
that door for the same reason — a point on a band is refused here, and the
door refusing it too is the two agreeing.

Not in this version: per-layer opacity/visible dials, annotation layers,
re-encoding one layer of a frame, a map frame with an inset, a legend on a layer
(a line split into series lays one inside its own box, so the frame refuses it —
see below), a point on a band (`VizScatter` places x on a run of numbers; a
point whose x column is categorical is classified as a band and refused in
words), a brush on a band line (a sweep across slots is a match over the
categories crossed, `VizBar`'s law — a kind the line does not claim yet), a box
plot sharing a band with another layer (it
orders its slots by its own rows), a guide per CHANNEL (a chart draws both its
axes or neither, so one `per-layer` channel gives every layer its own pair —
except on the two-axis frame, where the frame draws x once and each layer its
own y, see "Two scales on one frame" below), a bar as the SECOND scale of a
two-scale frame (its extent is read from the LEFT baseline, so it may take the
first scale and no other — the classic bars-plus-line figure is bars first,
line second; reversed, it is refused in words), a histogram or a box plot as
either scale (each summarises a distribution on an axis of its own). A
selection folded per layer shipped as protocol 1.8 (Law 7 below). Sibling layers get **no implicit crossfilter**: a select on
`net~nodes` reaches `net~edges` only through a declared link.

### The logarithmic axis — the frame owns the curve too (protocol 1.6)

A transform is not a resolution, and the frame owns both. `mode` answers "do
these layers share a scale"; `transform` answers "is that scale traversed by
differences or by factors" — and a plain scatter needs the second exactly as
much as a stack does. So a resolved channel may carry `transform: 'linear' |
'log'` (absent means linear), and a quantitative domain may carry `excluded`.

```ts
// what the host pushes for the canonical log-log figure
frame: {
  x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [0.02, 4700], transform: 'log', excluded: 712 },
  y: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [0.3, 22],    transform: 'log' },
}

// what the renderer does with it — `scaleFor` is the ONE owner of the answer
const x = scaleFor(channel.transform)(lo, hi, plot.left, plot.right);   // primitives/scales.ts
const ticks = logTicks(x.domain[0], x.domain[1], 5);                     // decades, labelled
label = `mass against radius${excludedNote(channel.excluded ?? 0)}`;     // the words for the 712
```

**No new field and no new type.** `RenderState.frame` is typed by the LIBRARY's
own `ResolvedChannel`, imported here, so both keys arrived on this contract the
moment `vizfootprint/def` declared them — which is the whole point of the axis
having one owner. A renderer that reads neither draws the linear axis it always
drew, so 1.6 is a MINOR (`capabilities.test.tsx` pins it: the same frame with
and without the two keys renders the same DOM).

**`excluded` is a count, not a filter.** A logarithm has no answer for zero or a
negative number, and WHICH cells those are is data, not declaration — the def
door cannot refuse them, so the fold excludes and COUNTS them ("exclude and
count, never silently drop"). The renderer is where a reader meets that number,
and it is met TWICE: each first-party chart appends `excludedNote(n)` to the
accessible name it already builds (a screen reader), AND — for the four charts
that can honour a logarithmic transform at all — draws the same words as a
small `<text class="vzf-excluded-note">` inside the picture itself, so a
SIGHTED reader of a log-log scatter that silently omits 300 of 1000 planets
does not see a picture with nothing missing from it. Absent when nothing was
excluded, so a chart with no transform is unchanged. It is a SEPARATE fact from
a silence — a silence is a cell the data says nothing about, this is one a
logarithm cannot place — and the two are deliberately never summed.

**Which channels honour it, per chart.** `VizScatter` x and y; `VizLine` y
(its x is a date, which has no logarithm); `VizHistogram` and `VizHeatmap` x,
their bin edges — log-spaced bins are the legitimate case. `VizBar` honours
NEITHER, `VizBoxPlot` honours NEITHER, and `VizNetwork` neither: a bar's
length IS its quantity (the def door refuses it as law 11c), and a box's y is
the SAME shape — its extent is read whisker-to-whisker, `zeroAnchorsChannel`
treats `'boxplot'` identically to `'bar'`, and the def door refuses that
declaration too — while a node-link's x and y are one spatial substrate with
one px-per-unit, which a factor axis would turn into a spiral. A chart ignores
the key for a channel it has no quantitative scale for, exactly as it already
ignores `domain.x` there. A logarithmic axis also takes no additive padding
(`padFor`): breathing room is a difference, and adding one to a logarithmic
domain does not widen it but breaks it — the decade ticks are its breathing
room.

**AND THE GENERIC FRAME RENDERER HAS TO PASS IT THROUGH, which for three
releases it did not.** `layeredRenderer` folded a span and a band order for each
layer and handed over NO curve, so a def declaring a logarithmic channel got a
LINEAR axis through the frame — `VizFrame · curveOf` was already reading
`domain.transform` for its merged guide and nothing was filling it. It is the
same one-line shape the zero guide's ask has (`transformAsk`, the twin of
`zeroGuideAsk`): read off `RenderState.frame`, passed through, decided nowhere,
absent unless something declared a curve — so a frame that declares none hands
out the object it always did, and a log axis drawn linearly (which no test can
have been pinning on purpose, because it is a false picture) is now the axis the
def asked for. An axis bound on several channels takes the first curve declared
among them, in `axisChannels` order; one resolution per channel is the library's
law, so two answers for one axis cannot be declared.

Not in this version: a symlog or a power transform (a log is the one the
figures asked for), a per-layer transform on a shared channel (one resolution
per channel, so `VizFrame` asserts it as a SHAPE rather than handling it — every
layer is handed the frame's one `domain` object by the same reference), a
logarithmic count axis for a bar or a histogram bin height, and a logarithmic
colour ramp.

### The frame renderer (R6): the def's stack of 2D marks, drawn

`layeredRenderer` is the GENERIC one — `canLayer: true`, and it draws the five
2D marks (line, bar, point, histogram, boxplot) in DECLARATION order inside one
box, through `<VizFrame>`. The contract carries rows, never marks, so the host
names each layer's mark (its def `chartKind`) and that mark's row fields:

```ts
const res = bindRenderer(
  layeredRenderer({
    layers: {
      all: { kind: 'bar', colorOf: () => 'var(--vzf-line)' },
      top: { kind: 'bar' },
    },
    xLabel: 'category',
    yLabel: 'rows',
  }),
  el,
  {
    viewId: 'bar',
    callbacks: verbs('all'),
    // 1.2: one bundle per layer, so a gesture lands under `bar~all` / `bar~top`
    layers: { layerIds: ['all', 'top'], callbacksFor: (address) => verbs(address.split('~')[1]!) },
  },
);
res.view.update({ ...state, layers, frame: frameDomains(values) }); // the fold the axis is drawn from
```

`res.view.update` renders SYNCHRONOUSLY (`flushSync` — every `reactRenderer`,
not only the frame's, see "The bridge" above): a REACT host that calls it from
inside its own render (an effect) has to push the frame's `update` on a
microtask, or React warns that `flushSync` ran while it was still rendering.
`ui/gallery/frame.tsx` shows the one-line shape (`queueMicrotask(() =>
boundRef.current?.update(...))`) — the price of the synchronous render, not a
bug in the frame.

What it owns:

- **ONE MARGIN BOX.** Every layer's PLOT rectangle is the same rectangle. The
  charts keep different margins of their own (a line 52px on the left, a bar
  38), so the frame takes the UNION as its own margin and offsets each layer by
  ITS pad — each chart's `PAD` is exported and stays its one owner, so an
  alignment computed in the frame cannot drift from the box the chart draws.
- **ONE GUIDE, OR TWO SIDES.** With every folded channel asking for
  `guide: 'merged'` the frame draws the axes once, from the frame's own fold,
  and every layer is drawn with `axes={false}`. A single `'per-layer'` channel
  (or an `independent` one, which is per-layer by definition) gives a SINGLE
  layer its own pair instead. Two or more layers under `'per-layer'` are the
  TWO-AXIS FIGURE ("Two scales on one frame", below): the frame still draws x
  once, and each layer whose y is its own draws that y on an edge of its own —
  the first on the left, the second on the right. There is no third edge, and
  a bar takes neither; both are refused in words (see the table below).
- **each layer gets only what IT binds.** A bar that binds no `y` keeps its own
  count ceiling: a value span folded over somebody else's column is not this
  bar's height. Bind `y` to the count field on both bar layers and they share
  one ceiling, which is what makes their heights comparable.
- **the layer's own voice.** A gesture speaks through
  `handshake.layers[layerId]`, so the commit lands under `viewId~layerId` (the
  1.2 law). With no bundle for it the view speaks and the ADDRESS is lost, not
  the gesture — and on a frame with no own binding (a layered view with no
  view-level `initial`: the frame is its layers, `src/def/README.md` "Layers",
  law 6a) the session then refuses that gesture by name, listing the layers it
  should have landed under, because the frame's address reads no rows. Register
  the bundles.
- **the pointer law of a stack.** The BOTTOM layer keeps the pointer over its
  whole box (nothing is beneath it to reach); every layer above takes the
  pointer only where it drew a mark, so a click on blank canvas falls through
  instead of being swallowed by whichever layer is on top.

What it REFUSES, in words, rather than drawing wrong — each of these is a
picture that would be drawn a lie, not one that would merely be empty:

| the stack | the reason |
|---|---|
| a kind that owns its own frame (map, network, heatmap, table) | a frame draws the 2D marks; the others are frames |
| a run over bands (a line whose x column is a date or a number, over a bar) | *layer "b" draws its x as a run — column "when" is a date — over layer "a"'s bands; a line over bands must bind a category to x, or take a frame of its own.* A line whose x column IS a category is a band and draws; a histogram is a run by its mark (its bins sit on a number) |
| a point on a band (a point whose x column is a category) | classified as a band — that is the column's fact — and refused because `VizScatter` draws no band in this version |
| two band layers with no category list folded | each would order its slots by its own rows, so "Formal" would be two different slots — two band LINES included |
| a box plot sharing a band | it reads no category list in this version |
| a line split into 2+ series | its legend sits inside its own box and moves its plot top off the frame's |
| a layer with no mark named | a frame draws what the def declared; it never guesses |
| an x left to the layers, on two or more (a per-layer or independent x, or one never folded) | *x is per-layer on layers "a" and "b" — one frame has one x, drawn once by the frame. Declare guide: 'merged' on x, or draw one layer.* |
| a THIRD y of its own | *layers "temp", "rain" and "wind" each draw a y of their own — a frame has two sides, left and right, and no third. Draw two of them here, and the rest on a frame of their own.* |
| a histogram or a box plot with a y of its own on such a frame | *layer "counts" is a histogram with a y of its own — a histogram's extent is read against one baseline, so it takes neither side of a two-scale frame. Declare guide: 'merged' on y, or draw it on a frame of its own.* — the def door already refuses BOTH shapes that draw one (`independent`, and `shared` drawn `per-layer` beside a second layer — law 9, `validateFrame`); this is the frame's OWN defense, for a `RenderState.frame` a host folds by hand, skipping the door entirely |
| a BAR that would take the SECOND scale (the right edge) | *layer "counts" is a bar with a y of its own, but layer "rate" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y* — a bar may hold the FIRST scale (bars left, line right) and no other; ONE owner for the sentence, quoted from the def door (`firstScaleTakenRefusal`), so the two twins of law 9 say the same words |

#### Two scales on one frame — the second axis on the right, the words that keep it honest, and the ink that matches the scale

**Two scales on one frame are two claims, and the frame must say so.** A
dual-axis figure is legitimate — temperature and rainfall over the same weeks
— and it is also the classic way to make any two series look related by
choosing the scales. So the second axis is allowed under four laws:

1. **Two sides, so at most two independent scales.** The first layer whose y
   is not merged draws its axis on the LEFT edge, the second on the RIGHT,
   each labelled with its own field (`axisSide` on `VizLine`/`VizScatter`,
   handed out by `VizFrame` in declaration order). A third own y is refused
   naming every layer that would draw one — there are two sides and no third.
   x is never per-layer on a frame: one frame has one x (the band/run law
   already says so), the frame draws it once, and an x left to the layers is
   refused by name.
2. **A bar may take the FIRST scale, and only the first.** Bars of a count on
   the LEFT with a line of a rate on the right is the commonest two-scale
   figure there is, and it is honest in that one arrangement: the left axis is
   where a reader reads an extent from a baseline. A bar SECOND — read against
   a second baseline behind a line — is the overstatement the law exists to
   prevent, and it is refused in the def door's own words (`mayTakeFirstScale`
   and `firstScaleTakenRefusal`, `src/encoding/frame.ts`: ONE predicate and ONE
   sentence, asked and said by both twins, so a def the door accepts is never a
   frame this renderer refuses). A **histogram** and a **box plot** take
   NEITHER edge: each summarises a distribution on an axis of its own, neither
   reads as "this much, from zero" beside a second scale, and neither draws a y
   on a frame's edge in this version. The def door refuses the same shapes —
   `independent`, and a `shared` channel drawn `per-layer` beside a second
   layer (law 9, `validateFrame`) — so a def built through `buildDashboard`
   never reaches these refusals at all; the frame keeps its own as a defense of
   its own, for a `RenderState.frame` a host folds by hand, skipping the door
   entirely. The bar draws its own count axis on the left, from ZERO, with the
   frame's x as its baseline (`axes: 'y'` on `VizBar`, which reads no
   `axisSide` — the only edge it can be handed is the one it draws on) and no
   label of its own: its 38px margin is the room the frame aligns every layer's
   plot by, so it holds the ticks and law 3's sentence NAMES both scales.
3. **The frame says the scales are unrelated, in words a reader sees.** When
   two y SCALES are drawn (an independent y, or one the frame never folded),
   the frame renders `twoScalesSentence(left, right)` — *two scales — left is
   temperature, right is rainfall; heights are not comparable across them* —
   in its own caption strip beneath the plot and in its accessible label. ONE
   owner (`contract/renderers.tsx`), exported so a host drawing its own
   surface quotes it. A shared y with a per-layer guide is one scale on both
   edges — heights across it ARE comparable — so no sentence is said rather
   than a false one. Omit-never-deny: a dual axis that says nothing is the lie;
   a dual axis that says this is a figure. Two fields of the SAME NAME on two
   tables (`value` on both) would read *left is value, right is value* — true
   and useless, since a reader still cannot tell which edge is which — so
   `frameWords` names the LAYER too, exactly where the fields collide: *left is
   "value" on layer "shopA", right is "value" on layer "shopB"*.
4. **The ink matches the scale.** On the frame that says those words, each
   own-y layer is also handed one of two HUES — `--vzf-scale-left` and
   `--vzf-scale-right` (`styles.css`, one definition for both grounds, neither
   of them the brand) — and the layer draws its OWN y axis (its line, its ticks,
   its label) and its unsplit marks in it (`FrameLayerDraw.scaleHue` →
   `scaleHue` on `VizLine`/`VizScatter`/`VizBar` — on a bar, its count axis and,
   where no `colorOf` names them, its bars). So a reader can see which marks belong
   to which edge before reading a word, which the field labels alone never said.
   ONE owner: `VizFrame` · `SIDE_HUES`, the same place that hands out the sides,
   because only the frame knows there are two scales. A layer that splits its
   marks by series (`colorOf`) keeps its series colours and takes the hue on its
   AXIS alone — identity is never colour-alone, and a hue that already names
   something may not be taken over. The frame's own x, the axis both scales
   stand over, stays the ink token: it belongs to neither. And the hue rides
   WITH the words, never instead of them — it is handed out exactly where law 3
   says the sentence, so a shared y drawn on both edges (one scale twice) gets
   no hue any more than it gets a sentence, and the redundant cue can never
   become the only one. A frame with ONE scale renders byte-identically to the
   frame before hues existed.

```ts
// a line of temperature and a line of rainfall over the same weeks
const layers: RenderLayer[] = [
  { layerId: 'temp', table: 'weather', rows: weeks, encodings: { x: 'when', y: 'temperature' } },
  { layerId: 'rain', table: 'weather', rows: weeks, encodings: { x: 'when', y: 'rainfall' } },
];
const renderer = layeredRenderer({ layers: { temp: { kind: 'line' }, rain: { kind: 'line' } } });
// the fold: x shared and merged (one x, drawn once by the frame); y left to the layers (two scales)
const frame = { x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'temporal', domain: [first, last] }, y: { mode: 'independent', guide: 'per-layer' } };
res.view.update({ ...state, layers, frame });
// → temperature's axis on the left, rainfall's on the right, one x beneath, and under the plot:
//   "two scales — left is temperature, right is rainfall; heights are not comparable across them"
// → and each line drawn in its own axis's hue: temperature in --vzf-scale-left, rainfall in --vzf-scale-right
```

```ts
// the classic figure: bars of a count on the LEFT, a line of a rate on the right, over one band
const layers: RenderLayer[] = [
  { layerId: 'counts', table: 'weeks', rows: perWeek, encodings: { category: 'week', y: 'count' } },
  { layerId: 'rate', table: 'weeks', rows: perWeek, encodings: { x: 'week', y: 'rate' } },
];
const renderer = layeredRenderer({ layers: { counts: { kind: 'bar' }, rate: { kind: 'line' } }, xLabel: 'week' });
// the fold: the band shared and merged under BOTH names an axis has (a bar's `category`, a line's `x`),
// y left to the layers. The bars are FIRST, which is the only place a bar may be.
const frame = {
  category: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: weeks },
  x: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: weeks },
  y: { mode: 'independent', guide: 'per-layer' },
};
res.view.update({ ...state, layers, frame });
// → the bars' count axis on the left, ticked from zero (its baseline IS the frame's x); the rate's on
//   the right; and under the plot: "two scales — left is count, right is rate; heights are not
//   comparable across them". Declare `rate` first and the frame refuses it in the def door's words.
```

Two remedies were REFUSED, by name: (a) **`derive: 'align-extent'`** — a
transform that stretches both scales to the same pixels is the deception
itself, dressed as a feature; (b) **silently merging when the two fields share
a unit** — a merged guide is a DECLARATION (`guide: 'merged'`), never an
inference.

The geometry is one owner each: a right axis keeps its room on the right
(`padOnSide`, `primitives/scales.ts` — the chart's own `PAD` mirrored, read by
the chart to place its plot and by `VizFrame` to union the margins), and the
caption strip is taken from the frame's bottom margin only when there are
words (`CAPTION_ROOM`). A frame with neither is byte-identical to the frame
before they existed; a chart without `axisSide` is byte-identical to the chart
before sides existed. The INK has one owner too, on both sides of the line
between markup and stylesheet: the hue travels to the CSS on ONE inherited
custom property (`scaleHueStyle`, `primitives/scaleHue.ts` — the only place
`--vzf-scale-hue` is spelled) and each rule spends it on the property IT paints
with (`.vzf-axis` on its stroke, `.vzf-tick` and `.vzf-axis-label` on their
fill), which is also what leaves the axis label's hover cue to the brand — an
affordance is about the click, not about the scale. The ZERO GUIDE has a token
of its own beside those (`--vzf-zero`, spent by `.vzf-zero`, and
`.vzf-zero-note` for the sentence) and deliberately does NOT fall back to
`--vzf-scale-hue`: a scale's hue names its MARKS, and a zero guide is
furniture.

**The first-party layered chart has since shipped** (packet 4): `networkRenderer`
— `<VizNetwork>` behind the bridge — is the ninth reference renderer and the
first to declare `canLayer`, two tables on one frame with one shared pair of
scales, and the first whose every mark belongs to a LAYER rather than to the
view. It passes the conformance kit's arms up to `commit-lands`, where the kit
asks for a view-level gesture a two-table node-link does not have; that stop is
pinned and explained in `conformance.test.tsx`. Read `renderers.tsx`'s header
before changing either side.

---

## Law 5 — one gesture on a node selects the ties inside the set it walks to, and the ANSWER is recorded with the question (protocol 1.3, which-walk 1.4)

A `neighbourhood` emission is the one kind on the rail that a renderer cannot
answer. It carries a **seed** — one node id, on one endpoint column of the
edges table — and nothing else, because the walk reads the edge ROWS at the
cursor and a renderer owns no rows (the transform-ownership rule: it never
bins, and it never walks). The session walks once, and lands ONE commit
carrying the question (`seed`, `derivation`, `hops`, and `to` for a path)
beside the answer (the materialized `ids`).

**WHICH walk is the renderer's to ask and the host's to run (protocol 1.4).**
`encoding.walk` says which: `{ derivation: 'ego', hops: 2 }` for two hops out,
`{ derivation: 'component' }` for everything the seed reaches, or
`{ derivation: 'path', to: <node> }` for the nodes in order between two of them.
Absent means one hop of ego, so a 1.3 renderer's emission is byte-identical and
lands the act it always did. It is still a QUESTION: the host owns the rows, so
the host runs it — and refuses it in a sentence when it cannot (a walk whose
answer is too big to record, a `hops` past two, a `to` on a walk that has no far
end). A path takes two nodes, so a chart asks it in two gestures and reads the
first one's seed back off the FOLD — `<VizNetwork>` keeps no state for it, which
is why the gesture after a seek asks about the walk the trace shows. The same
rule settles its WORDS: what an alt-click on the seed clears is named off the
LANDED body (`landedWords`), not off the pick, because a walk can arrive from a
seek, an agent or a saved picture and the two disagree.

```ts
// the ASK, from the chart — a question, never a set
callbacks.emit({ rawValue: 'Salmonellosis', encoding: { kind: 'neighbourhood', field: 'source' } });

// the ANSWER, read back off the fold — how a node-link lights its ego net
const walk = selfSelectedNeighbourhood(state.selection);
// { fields: ['source', 'target'], seed: 'Salmonellosis', derivation: 'ego', hops: 1, ids: [...] }
```

Three things this law is made of, and every one of them is a consequence of
the clause being over the EDGES table:

- **the ask and the answer sit at two addresses.** The clause names the edges'
  two endpoint columns, so it is spoken through `handshake.layers['edges']` and
  lands under `viewId~edges` — while the layer that must DRAW it is the nodes.
  So `networkRenderer` hands `<VizNetwork>` a `walk` door (the endpoint column
  + the edges layer's `emit`) and offers no walk at all when the frame carries
  no edges layer or that layer has no bundle: there is no honest fallback to
  the view's own voice, because a clause naming edge columns judged against the
  nodes table selects nothing and refuses everything after it.
- **the rows are the ones the highlight promised.** The clause keeps an edge
  row when BOTH endpoints are in the walked set — the induced ego subgraph,
  which is exactly the edge set `<VizNetwork>` brightens. "Either endpoint"
  would keep a neighbour's tie to a stranger outside the set, drawn dim: one
  commit would then read as one edge in the picture and two in the data.
- **the walked set is never a row predicate for the nodes.** A node row carries
  no endpoint column, so folding the walk into the node predicate would dim the
  whole frame. `<VizNetwork>` takes it out of the predicate and READS it
  instead — which is what `selfSelectedNeighbourhood` is for. It answers about
  the FRAME rather than one address: the view's own walk if it has one, else
  the one that reached it (arrival is the permission — `selectionForView` has
  already dropped what a `none` or absent link edge blocks) — and a walk that
  reached it TRAVELLED, as the `match` on the nodes' key the session made of
  its ids, is read the same way (`isWalk`; Law 8, "A walk that travelled is
  still the walk").
- **the answer is recorded because a read at a cursor answers about that
  cursor.** The walk is over rows a later act may change, so a commit carrying
  only the seed would re-walk today's rows and answer a question nobody asked.
  Time travel shows the ego net that walk found.

The conformance kit's `neighbourhood` arm is gated on the renderer declaring
the kind (the `match` arm's own model): it drives `plan.neighbourhoodGesture`
and requires exactly ONE commit — both endpoint columns, the seed INSIDE the
recorded set, and an addressable clause at whichever address spoke.

Not in this version: k-hop beyond one, shortest paths, connected components,
community detection.

---

## Law 6 — a clause a row cannot answer does not drop it (protocol 1.7)

**A clause is a sentence about a column. A row that does not carry that column
cannot answer it, so the clause does not exclude that row — it says nothing
about it.**

This is the session's own law — `src/session/README.md`, "A clause a table
cannot judge": *a sentence about a column these rows do not have is not a claim
about these rows* — applied one tier down, where the fold happens. The read
door narrows such a clause against the table's column list before the engine
runs and reports it (`ReachingClause.narrowed`). A renderer's host folds over
ROWS with no column list in hand, so the same law is applied per row, in ONE
place: `selection.ts` · `judgeable`, which every arm of `compileClause` hands
its test to. `keepPredicate`, `brightPredicate` and `filtersHere` fold the same
compiled predicate, so the `filter` and `highlight` responses got the law from
that one change; `mirror` lifts a value list and never tests a row, so it was
never touched.

**The evidence is the KEY, not the value.** `field in row` is the test. A row
that HAS the column holding `null` is judgeable and its answer does not change:
an IS-NULL point (a cell side with a null value) still matches it, an interval
still refuses it (no number to place), a walk still keeps no null endpoint
(SQL's `IN (NULL)` is never true). Only a MISSING key is unjudgeable. A
`cell` gets the guard on both sides by composition — a row missing the x column
is judged by the y side on its own column — and a `neighbourhood` names two
endpoint columns, and a row missing EITHER cannot be shown to be outside the
induced subgraph.

Before this law the answer depended on the arm: a missing column DROPPED the
row for a point, an interval, an including match, a cell and a neighbourhood,
but KEPT it for an IS-NULL point (`undefined == null` is true when the key is
absent) and an excluding match (`!hit`). One missing column, six kinds, two
answers — the proof that nothing had decided it. A dashboard met it as a blank:
a selection on `radii`, reaching a year chart whose rows have no such column,
kept 0 of 2 and greyed every dot. The direction is the map's inverted: the map
removes an edge only when it can prove it unkeepable
(`src/links/README.md`), and this tier drops a row only when it can prove the
sentence false — refuse on evidence, never on ignorance.

```ts
const sel = selectionForView([{ viewId: 'radius', field: 'radii', kind: 'interval', value: [1, 5] }], 'year');
const keep = keepPredicate(sel);
[{ year: 2001, count: 3 }, { year: 2002, count: 7 }].filter(keep); // both — no row carries `radii`
[{ radii: 0.5 }, { radii: 2 }, { radii: null }].filter(keep); // [{ radii: 2 }] — judged as ever
```

**And the contract carries the fact, not only the behaviour.**
`SelectionClauseView.narrowed?` (protocol 1.7) is the session's word that a
clause reached this view and could not be judged on its table — the column
and the library's sentence (`unjudgeableWords`), quoted and never re-worded.
The session states it once and per consumer on the overview's own rows
(`activeSelections[i].narrowedFor`, keyed by the consumer's address —
`src/session/README.md`, "A clause that filtered nothing says so where it was
sent"); the adapter carries it whole (`SelectionView.narrowedFor`, each entry
kept only when whole); and `selection.ts` · `narrowedAt` picks THIS view's
entry into the clause view at the fold — a whole-dashboard fold names no
consumer and carries none. It is per consumer and not one word per selection
because a selection is one entry per SOURCE while "could not be judged" is a
fact about that clause at ONE consumer's table (the same brush is narrowed on
one chart and judged on the next), which is why the old per-source
`SelectionView.narrowed` could never be filled and is gone. It is never
inferred here from the rows: the predicate beside it already keeps a row that
lacks the column, and which columns the TABLE lacks is a fact only the session
holds. A renderer that wants to say so has the one sentence the Sheet already
says — `narrowedSaid`, on the root barrel — and the chips say it from the
source's side (`panels/SelectionChips.tsx`), so the receipt, `why()`, the
Sheet, the chip and a host's own surface read one fact one way. A 1.6 renderer
never reads the field and draws byte-identically (`capabilities.test.tsx`).

The law's tests are `selection.unjudgeable.test.ts` — every kind, a row lacking
the column beside a row holding it as `null`, the demo's exact shape, and one
test that asserts the six kinds now agree.

---

## Law 7 — the frame folds per layer (protocol 1.8)

**A layer reads the clauses that reached ITS address, folded with ITS clause as
self; the frame's one selection is the fallback a 1.7 host still gets,
byte-identical.**

A self-exclusion fold names ONE address (`RenderSelection.selfClauseId`). Until
1.8 the contract carried one fold per frame, so a host with several interactive
layers had to choose whose clause was "self" — and every other layer's own
brush read as foreign to itself: the gallery's two-line figure folded at the
first line's address, so the second line's own brush was foreign to itself —
invisible on a line, which reads no fold, and wrong on every mark that does (a
second point layer dimmed under its own brush). The
session's reach law never had that problem — it judges each edge against the
LAYER's table (`src/def/layers.ts` · `layerLinkViewOf`) — so door and renderer
agreed kind by kind only on a one-layer frame. This is the protocol change the
renderer's own header used to name.

`RenderLayer.selection` — optional — is the fold at the layer's address, built by the host
exactly the way a view's is:

```ts
const at = (layerId: string) => selectionForView(state.selections, layerAddress(viewId, layerId), 'intersect', state.links, state.cleared);
bound.view.update({
  ...frame,
  selection: selectionForView(state.selections, viewId, 'intersect', state.links, state.cleared), // the frame's own — the fallback
  layers: layers.map((layer) => ({ ...layer, selection: at(layer.layerId) })),
});
```

`layeredRenderer` reads `f.layer.selection ?? state.selection` for each mark, so
a brush on layer `b` is `b`'s self (never dimmed by it) and `a`'s foreign
(dimmed where a link lets it reach). The node-link reads TWO: the nodes layer's
fold is judged on the node rows and the edges layer's on the edge rows
(`VizNetwork.edgeSelection`), beside the two-ends rule — so a declared
`highlight` edge from `net~nodes` to `net~edges`, mapped onto an endpoint
column, dims every link the clicked node is not the named end of, which one
fold could never say. Sibling layers hold no default edge between them
(`src/links/materialize.ts`), so with nothing declared the edges' fold carries
no clause of the nodes' and the picture is exactly what the one fold drew.

Two things the field does NOT change. `selfClauseId` stays singular: the
layering design's plural was for several layers reading one fold, and a fold
per layer has exactly one self each. And the frame's `RenderState.selection`
stays required: it is what a 1.7 host pushes and what a layer with no fold of
its own reads — for the node-link that fallback must be folded at the NODES
address (Law 4), as it always had to be. A 1.7 renderer never reads the key
and draws byte-identically (`capabilities.test.tsx`); the `notInThisVersion`
pins hold the version to the prose.

The law's tests: `renderers.test.tsx` (the two-layer self/foreign frame, the
1.7 fallback, the node-link under per-layer folds and the declared highlight
between siblings), `VizNetwork.test.tsx` (a link judged by its own row), and
`conformance.test.tsx` · `netState` (both hosts: outline, dim, clear on
click-again, on a real session).

---

## Law 8 — a clause travels a relation (protocol 1.9)

**The fold takes the session's travelled clause and never joins.** A clause
that reached this view through a declared relation — because the table it
reads lacks the clause's column, and a relation joins that table to the
source's — arrives as the session's own `match` on the relation's far column,
and this tier judges that column with the predicate every match already gets.
Which tables a relation joins, and what the source's rows held under the
clause, are facts only the session's engines hold (`src/session/README.md`,
"A clause travels a relation"); a render tier that folded a join of its own
over the rows it happens to hold would be re-deriving the library's answer,
which is the third law of `../adapter/README.md` broken one tier down.

The session states it per consumer on the overview's own rows
(`activeSelections[i].travelled`, keyed by the consumer's address — the
`narrowedFor` shape, with the far-column `match`, the relation and the
consumer's declared label); the adapter carries it whole
(`SelectionView.travelled`, each entry kept only when whole — a match with a
field and a values list, a path of two-ended relations, a number of rows); and
`selection.ts` · `travelledAt` picks THIS view's entry into the clause view
at the fold, beside `narrowedAt`. When it does, the row IS the travelled
clause — `kind: 'match'`, `field` the far column, `value: { values }`, a
`predicate` over that column — and `SelectionClauseView.via` says how: the
relation (`path`), the def's own `label` for it when it declares one, the
source rows it was folded from (`rows`), and `from`, the SOURCE's own clause
as this fold saw it — the row's `kind`, `field`, `value` and `fields`, which
the wire already carried (1.9, amended in this same unreleased train; no
consumer ever spoke a 1.9 without it, and a 1.8 renderer still draws
byte-identically). A whole-dashboard fold names no consumer and carries none;
a view's own clause never travels to itself; a `leave`-kept cleared clause
keeps the travelled reading it had. `narrowed` and `via` never ride one row —
a travelled clause was judged.

**A walk that travelled is still the walk.** The session travels a
neighbourhood clause by its IDS (`src/session/README.md`, "A clause travels a
relation": the walk recorded the node keys it reached, so the nodes receive
`key IN ids` with no engine ask), and at this tier the row is then a `match`
— which alone could not say it was a walk. `via.from` says it: `selection.ts`
· `isWalk` is the ONE reader of "is this row a walk" (a `neighbourhood` as
made, or a `match` whose `via.from.kind` is `neighbourhood`), and
`walkClause` answers a travelled walk with the source's `fields` and `value`,
so `selfSelectedNeighbourhood` reads seed, derivation, hops and ids exactly
as before the clause travelled and a node-link lights the ego net the walk
RECORDED (Law 5). The same reader keeps it out of every keep-set (`setOf`: a
mirrored walk outlines nothing — its picture is the ego net, read) and out of
a node-link's row predicate (`VizNetwork` · `withoutWalks`: the nodes READ
the set, and reading it and judging it would be one answer twice). Pinned
against the pre-travel fold in `VizNetwork.test.tsx`: the same node classes
under the desk's `mirror` edge and under a `filter` edge.

```ts
// the exoplanet desk: a pick of three planets on the scatter, travelled to the years as two references
const pick = { viewId: 'mass_radius~planets', field: 'pl_name', kind: 'match', value: { values: ['Kepler-22b', 'TRAPPIST-1e', 'HD 209458 b'] },
  travelled: { 'by_year~references': { clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] }, via: { path: [{ from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } }], label: 'where the composite took its accepted radius from', rows: 3 }, label: 'Discoveries by year' } } };
const sel = selectionForView([pick], 'by_year~references', 'intersect', links);
sel.clauses.get('mass_radius~planets'); // { kind: 'match', field: 'ref', value: { values: ['ref-A', 'ref-B'] }, response: 'filter', predicate, via: { path: […], label: '…', rows: 3, from: { kind: 'match', field: 'pl_name', value: { values: [...] } } } }
[{ ref: 'ref-A', year: 2011 }, { ref: 'ref-C', year: 2009 }, { year: 1999 }].filter(keepPredicate(sel)); // ref-A stays, ref-C goes, the row lacking `ref` is kept (Law 6)
```

A renderer that wants to say so has the chip's and the Sheet's sentences —
`travelledWords` (`panels/SelectionChips.tsx`: *reached Discoveries by year
through where the composite took its accepted radius from · 2 ref values*)
and `travelledSaid` (on the root barrel, the consumer's vantage) — which name
the relation by its declared label or, when none, by the def door's own
spelling (`relationEdgeId`, `vizfootprint/def`), so a chip, a sheet and a
refusal name an edge one way. A WALK travelled by identity (Law 8 above:
`via.from` is the neighbourhood) quotes no relation, because nothing was
joined — *reached Diseases as the walked set · 3 disease values* / *the walk
from Ties reached these rows as its walked set · 3 disease values*: the two
relations on `via.path` are the permission, not the route. A 1.8 renderer never reads the field and draws
byte-identically (`capabilities.test.tsx`); the `notInThisVersion` pins hold
the version to the prose.

The law's tests: `selection.travelled.test.ts` (the fold on the far column,
under `filter` and `highlight`, the unnamed consumer, the whole-dashboard
fold, the `leave`-kept clause, `via.from` byte for byte, the travelled walk
read back through `selfSelectedNeighbourhood` and `isWalk`),
`../adapter/sessionView.travelled.test.ts` (whole-or-dropped on both hosts),
`../panels/SelectionChips.travelled.test.tsx` and `../sheet/Sheet.test.tsx`
(the sentences), `../charts/VizNetwork.test.tsx` (the travelled walk: the
ids lit, the seed's focus and clear affordance, the picture unchanged).

---

## Law 9 — the bytes a plane cannot see ride the handshake, and nothing computes from them (protocol 1.10)

A choropleth needs an outline. A 3D view needs a structure file. Neither is a
row, and neither ever will be — so `mapRenderer({ geo })` took its GeoJSON as a
**factory option** and a protein desk fetched its structure **by hand**, which
meant the bytes were on no commit, in no `overview().sources`, carried no
version and were invisible to time travel. Every number computed from that file
was true *of those bytes*, and nothing recorded which bytes they were.

The library closes it as a DECLARED RESOURCE — a declared source that is not a
table, with a version, on the record (`vizfootprint/source`, "a resource is a
declared source that is not a table") — and this protocol is how it reaches a
renderer:

```ts
const structure = dashboard.resource('structure');   // { format: 'text', body, version, retrievedAt }
bindRenderer(myStructureRenderer, el, {
  viewId: 'structure3d',
  callbacks,
  resources: structure === undefined ? {} : { structure },   // HostHandshake.resources
});
```

**At MOUNT, and deliberately not on the frame.** `RenderState` is pushed on
every update and a resource is fetched once, so carrying megabytes of geometry
on the state would pay for them again on every hover. A resource that MOVES (a
refresh re-fetched it) is a new mount, which is the honest shape: the renderer
that drew the old bytes never silently starts drawing the new ones under the
same version.

**No capability, and no guard** — Law 2 decides it, not a preference. A guard
belongs where a host-driven act would otherwise vanish; a renderer that ignores
an offered resource records nothing and hides nothing, and the missing geometry
is visible on screen. So `bindRenderer` passes `resources` through untouched
(`bind.ts` · `handshakeOf`) and a renderer that declares nothing about resources
binds and draws byte-identically.

**What a renderer may do with them is narrow, and the narrowness is the
contract: bytes are for GEOMETRY THE PLANE CANNOT SEE** — a mesh, an outline, a
structure. A renderer still paints what the ROWS say. Computing a value out of a
resource and drawing it as data would be an aggregation the host does not own
and no commit records — the same law `transforms` is refused under (Law 1's
`transforms-not-owned`), and the reason a resource is never decoded anywhere in
this library.

`version` on the row is not decoration: it is the id of the exact bytes this
mount drew, the same string a commit standing on them carries
(`CommitRecord.resources`), which is what lets a receipt say WHICH structure
file a number was true of. A 1.9 renderer never reads the key and a host that
declares no resource hands over a byte-identical handshake; the
`notInThisVersion` pins hold the version to the prose.

The law's tests: `bind.test.ts` (offered as handed in, absent when none, a
renderer that declares nothing about resources unaffected), `capabilities.test.tsx`
(the version), `notInThisVersion.test.ts` (`resources` on the handshake and not
on the frame).

## Law 10 — a camera a clause moved records nothing (protocol 1.11)

A protein desk's whole point is that the molecule is the reference and the
charts are evidence about it. A reader selects a residue in the scatter and the
3D view **recolours** it — and on a 185-residue structure that residue is
routinely *behind the molecule*, so the mark is drawn and nobody sees it. Mol\*
can obviously frame a residue. **The contract could not ask.** `update(state)`
was the only inbound call, and `canPanZoom` points the other way: it declares
that a renderer RECORDS its own camera moves as a `navigate`. There was no
inbound direction at all.

Protocol 1.11 adds one:

```ts
const bound = bindRenderer(molstarRenderer({ structure }), el, { viewId: 'structure3d', callbacks });
// …a clause on another view now names residue A:57
bound.view.bringIntoView(['A:57']);
// { ok: true }  — the ask reached the renderer. NOT "the camera moved".
```

### The law, and it is the part to get right

> **A camera move a READER makes is an ACT. A camera move a CLAUSE causes is a CONSEQUENCE. Only the first reaches the record.**

A reader orbiting the molecule with the mouse is a visible act, and a renderer
that records it declares `canPanZoom` and speaks `navigate` — unchanged, and
still the only camera verb on the recording rail. A framing caused by a
selection is **derived** from a clause that is already on the trace. Recording
it again would put **two owners on one fact**, and it would be worse than
redundant at a cursor: stepping the trace back would replay a camera move
*nobody ever decided*, and the reader would watch the view swing for a reason
the log cannot explain.

So `bringIntoView` lands **no commit, ever**, and the proof is structural
rather than a promise — the branch in `bind.ts` reaches no outbound callback,
where `navigate` beside it reaches `options.callbacks.navigate`. There is
nothing there for a second owner to be written into, and
`notInThisVersion.test.ts` fails the moment a callback appears inside it.

### Framing is an EVENT, not a state

A field on `RenderState` was the obvious shape and is the wrong one. State is
pushed on **every** frame, so the camera would jump on every re-render: a hover
in the chart beside this one repaints, the field is still set, and the reader is
yanked back mid-orbit. The only cure would be per-renderer bookkeeping
comparing this frame's field to the last one.

A **one-shot field** (a nonce the renderer consumes) buys that bookkeeping back
and adds a worse problem twice over. The host cannot tell whether the ask
arrived — a renderer that silently never consumed it looks exactly like one that
framed. And a consumed token makes the *second* ask do nothing, which is the one
case that matters most:

**Asked twice for the same rows, a renderer frames again.** It must not suppress
the repeat. A reader who has orbited away and asks again for the residue they
still have selected is asking to be brought back, and the rows being identical
is precisely *why* they are asking.

### Which rows — and the two cases that are decisions, not defaults

`keys` are row ids: the vocabulary `RendererCallbacks.hover` and
`RenderState.hover` already speak. A second spelling for "which rows" would be a
second thing to keep in sync.

- **`[]` means RETURN TO THE WHOLE.** A cleared selection leaves the camera
  parked on a row nobody has selected any more, which is the picture asserting a
  selection that no longer exists; the honest answer is the same one `update`
  gives when it repaints every row as kept. A host that means *don't move*
  simply **does not call** — not calling and calling with nothing are different
  sentences, and the protocol keeps them apart.
- **Keys this renderer does not hold**: frame the ones it does, and if it holds
  **none** of them, **do not move the camera**. Emphatically not the same as the
  empty ask — a camera parked on nothing is worse than a camera that stayed put,
  and collapsing the two would let one mistyped id silently reset a reader's
  view. The host owns the rows (the transform-ownership rule), so it already
  knows which keys this view holds; asking with keys it does not is the *host's*
  error, and the renderer's duty is only to not make it visible.

### Asking a renderer that cannot frame: refused by name

A safe no-op was the alternative, and Law 2 rejects it. A guard belongs where an
absence would otherwise be **silent** — and this absence is not visible, because
the rows *were* still recoloured and the frame looks complete. The reader is
left hunting a mark behind the molecule with nothing saying why. That is the
`canLayer` reasoning applied to an act instead of to a frame, and it matches
what this library does everywhere else: it refuses a declared gesture a renderer
will not draw, and it makes an unaddressable clause a named refusal rather than
a silent nothing.

```ts
bindRenderer(scatterRenderer(), el, { viewId: 'scatter', callbacks }).view.bringIntoView(['a']);
// { ok: false, gap: { code: 'bring-into-view-unsupported', op: 'bringIntoView',
//   detail: 'view "scatter" declares no canBringIntoView — the request to bring 1 row(s) into view was not carried' } }
```

A **second** code exists because the opposite mistake deserves its own word: a
renderer that declares `canBringIntoView: true` and ships no `bringIntoView`
method lands `bring-into-view-undelivered` — the capability lie of Law 1, named.
Neither refuses the *bind*: a mis-declared camera nicety makes one act wrong,
where a version mismatch or an unowned transform makes every frame wrong.

### What conformance falsifies, and what it admits it cannot

The kit's `bring-into-view` arm asks a declaring renderer four times — the
plan's rows, the **same rows again**, the empty set, and a row it does not hold
— and then checks that no commit landed, the fold did not move, no session gap
was filed and not one of the four outbound verbs spoke. A renderer declaring
nothing is asked once and must come back refused by name.

**It cannot verify that the camera moved.** Nothing at this boundary can — a
camera lives inside somebody else's WebGL scene, and a harness that claimed
otherwise would be making exactly the kind of promise this folder exists to
refuse. What it *can* prove is: the call arrived, the renderer did not throw, a
declared capability is really wired (the `undelivered` guard catches a hello
promising a method its mount never shipped), all four ask-shapes are survivable,
and **nothing was recorded**. A reader of the report should take a green
`bring-into-view` to mean exactly that list and not one word more.

**Every renderer that does not declare it is byte-identical.** None of the nine
first-party charts declares `canBringIntoView`, none grows a `bringIntoView`
method, and asking any of them files the typed gap and leaves the mount's bytes
untouched (`capabilities.test.tsx`: the nine helloes, the nine refusals, and the
same frame drawn with and without a framing ask). A 1.10 renderer binds, draws
and is asked byte-identically, because it is never asked at all.

The law's tests: `bind.test.ts` (the ask carried with the host's rows and not
one outbound verb spoken; the repeat; the empty and unheld asks verbatim; both
typed gaps; a 1.10 renderer's lifecycle unchanged), `capabilities.test.tsx` (the
nine, and a declaring renderer's two halves failing together),
`conformance.test.tsx` (the arm on a REAL session — **the no-commit law pinned
where commits actually land** — plus the undelivered lie caught),
`notInThisVersion.test.ts` (the version, the call, the flag, both gaps, and the
structural no-commit check over `bind.ts`).

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
   the handshake's bundles); 1.3 added the `neighbourhood` kind and the walk
   arm; 1.4 added `walk` on a neighbourhood emission (WHICH walk); 1.5 added
   `RenderState.frame`, the layers' shared scales already folded; 1.6 added
   the logarithmic axis on that frame; 1.7 added `SelectionClauseView.narrowed`
   (Law 6); 1.8 added `RenderLayer.selection` (Law 7); 1.9 added
   `SelectionClauseView.via` (Law 8), amended in the same unreleased train
   with `via.from` (the source's clause, so a travelled walk is still the
   walk); 1.10 added `HostHandshake.resources` (Law 9); 1.11 added the second
   INBOUND call, `MountedRenderer.bringIntoView`, with `canBringIntoView` and
   its two typed gaps (Law 10) — all optional, so every one of them stayed a
   minor. **An inbound call is a minor where an outbound verb is a major, and
   that is not a double standard**: "exactly four verbs" is a stated law about
   the renderer's *voice*, so a fifth changes what a renderer **is**, while an
   optional inbound call changes only what a renderer may be **asked** — one
   that declares nothing is never asked, and a host that never asks changes
   nothing.

## One more habit: the derivation helpers ship in a set

`selfSelectedValue` / `selfSelectedInterval` / `selfSelectedCell` /
`selfSelectedSet` / `selfSelectedNeighbourhood` are how a host-built chart reads its own live selection out
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
