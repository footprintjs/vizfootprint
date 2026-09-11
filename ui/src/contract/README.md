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
is the point of sharing one. The band spelling of that law is the same: a
category the frame's list does not name is APPENDED, never hidden, and a slot
the layer has no row for stays EMPTY rather than becoming a bar of zero ("no
rows here" and "none of them" are two different sentences).

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
axes or neither, so one `per-layer` channel gives every layer its own pair), a
second axis placed on the right for per-layer guides (the honest remedy for
two-or-more layers under `'per-layer'` — refused in words instead, in this
version, see below), and a selection folded per layer (the contract carries ONE
`selection` per frame, so a host with several interactive layers chooses whose
clause is "self"). Sibling layers get **no implicit crossfilter**: a select on
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
- **ONE GUIDE.** With every folded channel asking for `guide: 'merged'` the
  frame draws the axes once, from the frame's own fold, and every layer is drawn
  with `axes={false}`. A single `'per-layer'` channel (or an `independent` one,
  which is per-layer by definition) gives every layer its own pair instead —
  legal for exactly one layer. Because every layer's plot rectangle is the SAME
  rectangle (promise 1), two-or-more layers under `'per-layer'` would land their
  axes at the same frame pixel, so the frame REFUSES that stack in words (see
  the table below) rather than overprint them; declare `guide: 'merged'`, or
  draw one layer.
- **each layer gets only what IT binds.** A bar that binds no `y` keeps its own
  count ceiling: a value span folded over somebody else's column is not this
  bar's height. Bind `y` to the count field on both bar layers and they share
  one ceiling, which is what makes their heights comparable.
- **the layer's own voice.** A gesture speaks through
  `handshake.layers[layerId]`, so the commit lands under `viewId~layerId` (the
  1.2 law). With no bundle for it the view speaks and the ADDRESS is lost, not
  the gesture.
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
| per-layer guides on two or more layers | every layer's plot rectangle is the same rectangle, so their axes would land on the same pixels |

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
  already dropped what a `none` or absent link edge blocks).
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
It rides in from the adapter's `SelectionView.narrowed` and is ABSENT whenever
the session did not say — which is every clause on `activeSelections` (a fold
of what each view sent, which knows no one consumer's table): a host that
folds a reaching answer's clauses (`ViewQueryResult.clauses`) into
`SelectionView` shape is what fills it. It is never inferred here from the
rows: the predicate beside it already keeps a row that lacks the column, and
which columns the TABLE lacks is a fact only the session holds. A renderer
that wants to say so has the one sentence the Sheet already says —
`narrowedSaid`, on the root barrel — so the receipt, `why()`, the Sheet and a
host's own surface read one fact one way. A 1.6 renderer never reads the field
and draws byte-identically (`capabilities.test.tsx`).

The law's tests are `selection.unjudgeable.test.ts` — every kind, a row lacking
the column beside a row holding it as `null`, the demo's exact shape, and one
test that asserts the six kinds now agree.

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
   (Law 6) — all optional, so every one of them stayed a minor.

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
