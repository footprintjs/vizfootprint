# Weave study — what a 15-year-old visual-analytics platform teaches vizfootprint

Source material: a 5-reader study of the Weave (ActionScript, ~2008–2015) and WeaveJS (TypeScript/React port)
codebases, plus a focused re-read of the repo owner's own 2016 "Adapter" project (a framework-agnostic bridge
over WeaveJS). Every finding below traces to real `file:line` citations in those clones — nothing here is
paraphrased from memory of how Weave "probably" works.

## The headline symmetry

Weave's `KeySet` already computes exactly the two things a crossfilter-style selection needs to broadcast
efficiently — `keysAdded` / `keysRemoved` — on every mutation (`KeySet.as:271-308`, delta pre-callback at
`KeySetCallbackInterface.as:26-50`). And then it **throws them away**: the only thing that survives a mutation is
a freshly rebuilt `[keyType, ...localNames]` session-state array (`KeySet.as:89-119`), and undo/redo re-diffs that
whole array from scratch on every change (`SessionManager.as:1527-1535`, `SessionStateLog.as:191-243`). Weave
computed the delta and discarded it at the exact layer — persistence — where a delta is most valuable.

That is precisely the layer vizfootprint's append-only commit log already owns. A `CommitRecord` **is** a durable
delta; nothing here needs inventing. So the honest read of this study is a trade: Weave's core weakness (compute
the delta, discard it, pay full-state diff cost forever after) is a problem vizfootprint's architecture already
solved by construction. What vizfootprint does *not* have — and what this study is really about — is the 15 years
of scale engineering Weave built on top of its (weaker) core: identity interning, time-sliced async scheduling,
importance-driven level-of-detail, and a spatial index that makes hit-testing cheap at six figures of records.
That engineering is the actual transfer target. The six angles below are organized around it.

---

## 1. Session-state core

Weave's entire reactivity model rests on one empty marker interface, `ILinkableObject`
(`ILinkableObject.as:18-27`) — any object that implements it gets an externally-managed `CallbackCollection` and
a serializable session state, both attached by identity in a `WeakMap` side-table
(`SessionManager.as:975-1012`), not by inheritance. That single design choice pays for a surprising amount of
downstream machinery:

- **Version numbers instead of dirty flags.** Every `CallbackCollection` carries a monotonic `_triggerCounter`
  (starts at 1 so a comparer initialized to 0 always sees the first change) that increments on every trigger,
  even while notifications are delayed (`CallbackCollection.as:79-87`). Consumers store the last counter they
  saw and diff against it — O(1), allocation-free change detection. `delayCallbacks()`/`resumeCallbacks()` is a
  reference-counted mutex so N nested mutations coalesce into one notification (`CallbackCollection.as:246-261`).
  **Transfer:** vizfootprint's commit log already has an equivalent clock (`executionIndex`/commit id) — the
  reusable idea is the *comparer pattern* (store-last-seen, diff-on-read) for any UI surface that wants O(1)
  staleness checks against the log without re-subscribing to every commit.

- **Two-tier callback scheduling.** Immediate callbacks run synchronously in add-order; a second "grouped"
  channel batches by `(context, fn)` identity and flushes at most once per animation frame regardless of how many
  times it was triggered that frame (`CallbackCollection.as:401-553`, JS port at
  `GroupedCallbackEntry.as:156-210`). Bookkeeping/state-tracking callbacks stay immediate; anything expensive
  (chart repaint) rides the frame-coalesced channel. **Transfer:** this is the missing scheduling tier discussed
  in §3 below — vizfootprint has commit-per-gesture immediacy but no equivalent "coalesce N commits into one
  paint" primitive yet.

- **Bubbling with no payload.** `registerLinkableChild(parent, child)` wires the child's collection to call the
  parent's `triggerCallbacks` last (`alwaysCallLast`, `SessionManager.as:90-131`), so "something under me changed"
  propagates synchronously to the root with zero event object — consumers re-read state or check the counter to
  find out what changed. Ownership (who disposes you) and parenthood (who serializes/hears you) are two
  deliberately separate graphs (`SessionManager.as:144-200`) — conflating them is a documented source of leaks
  and phantom state.

- **Diff = valid partial state, one code path for everything.** `computeDiff`/`combineDiff`
  (`SessionManager.as:1497-1756`) produce diffs that are themselves legal partial session states — applying a
  diff through the ordinary `setSessionState` path IS load, undo, redo, and replay. There is no separate patch
  interpreter. Arrays of dynamic children diff by `objectName` as key (a bare name string = "unchanged, still
  present here"; a `className:'delete'` tombstone = removed) rather than by index — far more merge-friendly than
  positional array diffs, and it maps directly onto a chart spec's layers/series collections.

- **Undo/redo is a listener, not instrumentation.** `SessionStateLog` watches the root object and, after each
  batch of mutations settles, stores **both** `forward` and `backward` diffs plus the real wall-clock
  `triggerDelay` between changes (`SessionStateLog.as:41-296`). `undo`/`redo` just re-apply the stored diff. The
  think-time recording means the same log doubles as a replayable user-session trace, paced at adjustable speed
  by `SessionHistorySlider` (`SessionHistorySlider.mxml:174-217`) — scrubbable, speed-adjustable replay derived
  from *generic* diff machinery, no bespoke event recorder. An `_undoActive` echo-guard rewrites the top redo
  entry instead of appending new history while an undo is in flight, absorbing the diffs an undo's own apply
  would otherwise generate (`SessionStateLog.as:214-296`).

- **Cross-tool linking's dominant pattern is named objects, not events.** Two ways coexist: pairwise
  `linkSessionState` (two mirroring closures terminated purely by setter-equality, no infrastructure —
  `SessionManager.as:1351-1401`), and — the pattern that actually carries the app — three **global named objects**
  at the session root (`defaultSelectionKeySet`, `defaultProbeKeySet`, `defaultSubsetKeyFilter`,
  `Weave.as:130-176`) that every tool binds to via a `LinkableDynamicObject`/`LinkableWatcher` **path reference**
  (`LinkableDynamicObject.as:58-181`, `LinkableWatcher.as:83-283`). A tool doesn't hold a copy of the selection —
  it holds a reference that resolves the current target and self-heals if the target doesn't exist yet (crucial
  for out-of-order document load). Linked brushing across arbitrarily many panels falls out for free: nobody
  wires it, everyone just points at the same mutable object.

**Transfer note for vizfootprint:** the equality-gated setter as the *only* cycle terminator (§ end-to-end trace,
`LinkableVariable.as:144-241`) is worth stating as an explicit invariant if it isn't already — it is what makes
bidirectional linking safe with zero extra bookkeeping, and it is cheaper than dirty-source tracking.

---

## 2. Keys / selection at scale

**Interning, not hashing.** Every record id is a `(keyType, localName)` pair interned once to a canonical `QKey`
object, so identity comparison and membership tests are O(1) pointer ops. The AS original does this with a real
C uthash string table compiled via FlasCC (`hashutil.c:28-111`) — the "hash" is actually a unique-id assignment,
not collision-bucketed hashing. The JS port replaces it with nested `Map`s plus a cached `"keyType#localName"`
string (for DOM/React keys) and a dense monotonic `serial`/`toNumber()` int
(`QKeyManager.ts:55-156`, `QKey.ts:29-42`) — a rail built for `Uint32Array`/bitset selection math that, per the
study, is used almost nowhere downstream (`KeyColumn.ts:69` is the only consumer). That is a concrete opportunity
sitting unclaimed in the reference implementation: intern to an object carrying both a stable string id
(serialization boundary) and a dense int (hot-path bitset indexing), and actually use the int.

**KeySet: the structure at the center of the headline symmetry.** An ordered array plus a `key → index` map gives
O(1) `containsKey` and O(1) removal via swap-remove (`KeySet.as:124-136,271-308`). `replaceKeys` diffs against
the previous index and computes exactly `keysAdded`/`keysRemoved` — but as documented above, that delta is fed to
observers and then discarded at the persistence boundary (`KeySet.as:89-119`). **This is the single most directly
transferable lesson in the whole study:** ship the delta as the durable unit (a commit-log entry — vizfootprint
already has the shape), and materialize snapshots lazily instead of re-serializing + full-copy-diffing the
materialized set on every mutation.

**Composable subset algebra, all time-sliced.** `KeyFilter` (include/excluded sub-`KeySet`s + a boolean policy),
`FilteredKeySet` (lazy — revalidates only when its own trigger counter goes stale, then scans under a scheduler
time budget), `KeySetUnion` (dedupes async, with an explicit "no observable change" fast path via a
`_prevCompareCounter`), and `SortedKeySet` all compose through the same lazy-validate-on-read pattern
(`KeyFilter.as`, `FilteredKeySet.as:171-267`, `KeySetUnion.as:97-172`). A separate `busyStatus` collection tracks
"I finished background work" apart from "my value changed," preventing spurious re-renders from mere task
completion.

**Selection and probe (hover) are just two more global KeySets**, bound the same path-reference way as §1 — every
tool's `DynamicKeyFilter` targets `defaultSelectionKeySet`/`defaultProbeKeySet` by default
(`LayerSettings.as:36-41`, JS port `AbstractVisTool.tsx:88-112`). Rebinding one tool's `targetPath` gives it a
private brush for free; the wiring itself is part of saved session state.

**Probing/hit-testing is a 5-D KD-tree** over `[xmin, ymin, xmax, ymax, importance]` (`SpatialIndex.as:58-84`) —
a box-overlap query becomes one range query via the standard inverted-rectangle trick, and the `importance`
dimension lets a query filter by current LOD in the same call. Ranking uses a "found center overlap" state
machine (`SpatialIndex.as:485-701`) and quantizes probe distance to pixel precision so sub-pixel jitter doesn't
cause tooltip flicker.

**What actually bites at 100k+ keys**, verified in the source rather than assumed: `KeySet.updateSessionState`
rebuilds the *entire* serialization array on every mutation; `SessionStateLog` full-copies arrays on diff; each
render task re-scans the whole subset even to draw a 1-key probe highlight; and — the unused-rail finding above —
the delta channel and the dense-int identity rail both exist and are both nearly unconsumed. **For
vizfootprint:** keep interning + O(1) membership + the KeySet/KeyFilter composition shape, but persist the delta
(which vizfootprint's log already can) instead of re-diffing materialized snapshots, and do set algebra on
interned ints/bitsets rather than `Map`/`Set` churn once selection sizes get large.

---

## 3. Scheduler (the missing tier)

Weave's async engine — `StageUtils.as` in AS, `Scheduler.as` in the JS port — is a single-threaded cooperative
time-slicer built around one contract:

```
type IterativeTask = (deadline?: number) => number   // returns 0..1 progress; 1 = done
```

A task registered via `startTask` gets re-invoked next frame if it returns less than 1
(`StageUtils.as:551-671`). Every scale-sensitive subsystem in Weave — column ingestion, statistics, Jenks
binning, geometry-detail streaming, canvas plotting — is one more implementation of this same contract; nothing
special-cases scale, the contract *is* the scale story.

**Priority tiers with carry-over budgets.** One frame-pump call (`_handleCallLater`) drains an IMMEDIATE queue
unconditionally, then round-robins HIGH/NORMAL/LOW with per-tier ms budgets that **carry over deficits** — a tier
cut off mid-slice resumes next frame with a *reduced* budget rather than a fresh one, so no tier can either starve
forever or hoard unbounded backlog (`StageUtils.as:333-447`). The tiering *principle*, stated by the codebase's
own comments: data/keys that block downstream correctness get HIGH ("metadata is a prerequisite for many
things"); presentation-only detail that degrades gracefully gets NORMAL/LOW ("geometries can still be used even
without all the detail," `GeometryStreamDecoder.as:382-565`).

**Self-cancellation by staleness, not an external cancel token.** The recurring idiom across every resumable
data task: snapshot a version counter (`prevTriggerCounter = column.triggerCounter`) when starting, re-check it
on *every* resumption, and self-abort (`return 1`, discard partial accumulators) the instant it's stale
(`ColumnStatistics.as:163-265`, `BinnedColumn.as:88-155`). This is a close structural match for footprintjs's own
`runId`/`executionIndex` monotonic counters — a resumable layout/paint pass over a growing commit log could
snapshot the run's execution index at start and bail (discarding partial layout) the moment a newer commit
arrives, with no `AbortController` threading required.

**Compound phase-chaining.** `generateCompoundIterativeTask` glues N resumable phases into one schedulable unit
with combined 0→1 progress (`StageUtils.as:511-544`), including a "barrier" pattern — one phase polls another
independently-scheduled task's `.result == null` from inside its own scheduled slot (`NaturalJenksBinningDefinition.as:138-186`)
— a dependency-composition primitive that stays inside one deadline-budgeted scheduler without pulling in
Promises.

**Busy state is computed on demand, never cached.** `linkableObjectIsBusy` is a memoized BFS over the
session parent-child graph plus a task-ownership registry, using reusable scratch buffers to avoid GC churn
(`SessionManager.as:906-969`). Completion is debounced: when an owner's last task finishes, the manager snapshots
its trigger counter and schedules a re-check next tick, firing "became idle" only if nothing re-busied in the
interim (`SessionManager.as:794-901`) — closing the "task finished but nothing changed" starvation hole that
naive busy flags leave open. This generalizes cleanly to footprintjs-style dynamic subflow mounting, where
manually bubbling a dirty/busy flag up a tree that's being edited concurrently is exactly the kind of thing that
gets subtly wrong.

**The port's frame-pump swap is the clearest "what to copy vs. skip" data point in the whole study.** Flash's
`ENTER_FRAME`/`RENDER` stage events become `requestAnimationFrame`; `ACTIVATE`/`DEACTIVATE` become the Page
Visibility API — but the priority/budget *algorithm* itself is nearly byte-identical across three successive
rewrites (AS3 → transpiled ASJS → native TS). `IScheduler`'s public surface shrank to three methods
(`frameCallbacks`/`callLater`/`startTask`), shedding every Stage-coupled mouse/keyboard member the AS
`IStageUtils` carried. `requestIdleCallback` is never used anywhere in either codebase, across a decade — the
deliberate, sustained choice is `rAF` + a self-imposed ms budget, because rAF work finishes *before the next
paint* (visual and data model stay frame-aligned), whereas `requestIdleCallback`'s deadline is opportunistic and
was historically unsupported in Safari.

### Note: footprintjs already ships the non-blocking half of this

vizfootprint doesn't need to build the batching primitive from scratch. The sibling `footprintjs` repo's
`observer-queue/` module already ships the pattern Weave's scheduler is doing manually:

- **`FlushDriver`** (footprintjs `src/lib/observer-queue/flushDriver.ts`) — an armed-once microtask batcher.
  `arm()` is idempotent (at most one pending flush), a flush drains a *snapshot* under a `flushBudgetMs` time
  budget (default 2ms, `Infinity` = full drain, option at `flushDriver.ts:68`) and re-arms if backlog remains —
  this is Weave's "carry-over deficit" tier budget, minus the 4-tier priority bookkeeping. Both the clock (`now`)
  and the checkpoint primitive (`schedule`, default `queueMicrotask`, `flushDriver.ts:72,125`) are injectable —
  exactly the decoupling the historian lens (see the renderer-protocol proposal) flags as the reason Weave's
  scheduler *algorithm* survived a decade of pump-source changes (`ENTER_FRAME` → `rAF`) unmodified.
- **`ring.ts`** (`src/lib/observer-queue/ring.ts`) — a bounded circular buffer with explicit, *counted* overflow:
  `'drop-oldest' | 'sample' | 'block'` (`ring.ts:43`, options at `:47-54`). This is the storage primitive Weave's
  `ProgressIndicator`/task registries reinvent ad hoc; footprintjs already has the conservation invariant
  (`pushes === delivered + drops + rejections + size`) property-tested.

**Recommendation for the PROPOSED `schedule/` mini-lib (W2 below):** don't re-derive `FlushDriver`/`ring.ts` —
depend on or mirror their interfaces (injectable `schedule` pump + `now` clock + budget + counted overflow), and
add on top of that seam the two things Weave has that footprintjs's queue doesn't need for its own use case:
**(a)** Weave's priority tiers (HIGH/NORMAL/LOW with carry-over budgets — footprintjs's queue is single-tier
today) and **(b)** the `iterativeTask(deadline) => progress` contract plus version-stamp self-abort, for
multi-frame incremental work (layout, LOD refinement) rather than just event delivery. The pump itself should
stay swappable across `queueMicrotask` / `MessageChannel` / `requestAnimationFrame` / `requestIdleCallback` /
`scheduler.postTask` — footprintjs's `schedule` injection point already proves that seam works; Weave's decade of
shipping only `rAF` (never `requestIdleCallback`) is evidence for defaulting rendering-adjacent work to rAF and
reserving idle/worker scheduling for genuinely non-visual background work.

---

## 4. Geometry / level-of-detail

Weave's map stack is a complete importance-driven progressive-geometry pipeline built on one invariant: **vertex
importance and viewport detail are the same physical quantity**, so "what to fetch," "what to draw," and "what to
hit-test" all reduce to comparisons against one number.

- **Importance is computed once, at ingest, and never post-processed** — a Visvalingam-style effective-area
  algorithm over a circular doubly-linked vertex chain (Java, offline): each vertex's importance is the area of
  the triangle it forms with its current neighbors, and importance is monotone — removing a vertex can only
  *raise* its neighbors' importance, never lower it (`GeometryStreamConverter.java:201-296`,
  `VertexChainLink.java:61-152`). That monotonicity guarantees strict nesting of detail levels: a lower-zoom
  render is always a subset of a higher-zoom one. This is exactly the "compute once during the single ingest
  pass, never post-process" philosophy the footprintjs CLAUDE.md already states for commit capture — Weave is
  independent evidence the same discipline pays off for geometry.

- **The zoom↔detail contract — the single most portable idea in the study:** `minImportance = dataBounds.area /
  screenBounds.area`, the data-area of one screen pixel (`PlotTask.as:454-477`, ported verbatim in
  `StreamedGeometryColumn.ts:232-254`). One number, computed in one line from `viewBox` vs. client size, drives
  simplification (which vertices belong in a path's `d`), culling (which marks are sub-pixel and droppable), and
  demand-loading (what detail to fetch next) — all at once, resolution-independent, and animation-friendly
  (importance interpolates continuously through a zoom transition, no level-popping).

- **Byte-budgeted tiling — a quadtree in bytes, not space.** The offline tiler sorts all stream objects
  descending by importance, chunks them into "levels" targeting `4^k` tiles each sized to a byte budget (default
  32KB), then recursively splits each level at byte-weighted spatial medians rather than fixed geographic
  quadrants (`GeometryStreamUtils.java:52-147`). Result: every tile is a predictable size regardless of spatial
  data density, and each level quadruples resolution exactly the way zoom levels quadruple pixels — no z/x/y
  quadtree addressing scheme required.

- **Client tile bookkeeping folds into the same KD-tree trick as hit-testing:** tile descriptors
  `[xMin,yMin,xMax,yMax,maxImportance]` go into a 5-D KD-tree, and "which tiles do I still need for this
  viewport at this zoom" becomes one range query (`GeometryStreamDecoder.as:116-251`, ported at
  `KDTree.ts:94-238`). Two small operational details worth copying verbatim: randomize insertion order when
  bulk-loading a KD-tree (avoids degenerate unbalanced trees from sorted input), and use a monotone "exclude"
  flag instead of deleting nodes, so re-requests during async loading are idempotent.

- **BLGTree — the render-side dual of the importance stream.** Per geometry part, vertices live in one binary
  tree ordered by index with a max-heap-like importance property (a child's importance ≤ its parent's); a pruned
  in-order traversal at any threshold emits the simplified polyline in output order with no sorting
  (`BLGTree.as:250-362`), and out-of-order streaming inserts are handled natively — crucial because Weave's
  vertices arrive over the network in importance order, not index order. A modern equivalent for data that
  arrives in one batch is simpler: a vertex array sorted by index alongside a parallel importance array,
  binary-searchable — the tree earns its complexity only when points genuinely stream in out of order, which is
  exactly the commit-log case (appends refine an earlier render without a rebuild).

- **Hit-testing tests against the same simplified geometry that was drawn**, at the same importance threshold —
  hover agrees with pixels by construction, not by coincidence (`SpatialIndex.as:342-473`). Probe distances are
  quantized to pixel precision before ranking to stop sub-pixel jitter from flickering tooltips. Geometry that
  hasn't finished streaming in yet is treated as a bbox-hit (inclusive honesty during progressive load) rather
  than silently excluded.

**Cautionary lesson from the port:** when WeaveJS handed draw-time simplification to OpenLayers, the GeoJSON
conversion boundary passed `minImportance=0` (`ColumnUtils.ts:380-412`) — the LOD machinery survived the platform
rewrite in the *data* layer, but the parameter that would have kept per-frame simplification alive at the
*render* boundary was silently left at zero. When vizfootprint eventually hands geometry/path data to a
third-party renderer, the pixel-importance threshold needs to be threaded through that handoff explicitly, not
assumed to survive it.

---

## 5. Feature inventory

A survey of what Weave actually shipped, read as a pattern library rather than a feature list:

- **Build vs. wrap is a real, load-bearing decision, not a detail.** The AS client hand-rolled ~40 chart types
  over a shared immediate-mode `BitmapData` raster (`AbstractPlotter`/`drawPlotAsyncIteration`) — enough control
  to animate thousands of glyphs across many linked panels at once. The JS port deliberately did **not**
  reimplement most of them: it wraps C3/D3/OpenLayers instead, and there is no RadViz, ParallelCoordinates,
  Cytoscape, or word-cloud port at all. From-scratch buys scale and uniform interaction hooks at high
  implementation cost; wrapping buys chart-type breadth cheaply and loses both. A commit-log SVG library should
  make this call **per chart type**, not once for the whole library — which is exactly the question the
  renderer-protocol proposal (docs/proposals/renderer-protocol.md) is about.

- **Cross-tool linking has zero pub/sub code**, confirming §1/§2 from the tool-implementation side: every panel
  binds a `DynamicKeyFilter` to the same three global objects; there is no dispatcher anywhere in the codebase.

- **The interaction vocabulary is data, not code.** `InteractionController` maps modifier+gesture tokens
  (`ctrl+drag`, `shift+drag`, wheel, pinch) to named actions (`select`, `pan`, `zoom`) through CSV-encoded
  `LinkableString`s (`InteractionController.as:33-226`) — remapping "what does shift-drag do" is a session-state
  edit, not a code change, and the binding table is automatically part of undo/save/collaboration because it's
  ordinary sessioned state.

- **"Everything is a column."** Raw sources, filtered views, sorted views, formula columns (`EquationColumn` —
  compiled expressions referencing other columns as named variables, re-triggering when a referenced column's
  *value or cached statistics* change), aggregates/pivots (`GroupedDataTransform`, itself a full data source so
  it composes with other transforms), and even R-script outputs all implement the same `IAttributeColumn`
  interface (`AttributeColumns/`, `EquationColumn.as:50-76`, `Transforms/GroupedDataTransform.as:45-217`). Any
  chart that depends only on that interface automatically works over any transform chain with zero chart-side
  special-casing.

- **"Play through time" is one shared cursor, not per-chart animation code.** `SecondaryKeyNumColumn` stores a
  2-D `(record, time-slice)` map; a single process-wide static `secondaryKeyFilter` value determines which slice
  is "in effect," and every bound chart re-renders via its own reactive callback when the slider moves it
  (`SecondaryKeyNumColumn.as:33-127`, `DimensionSliderTool.mxml:89-91`). Generalizes past time to any "current
  slice" concept — scenario, run, branch — a commit-log library might want to scrub through.

- **Dashboard layout is ordinary sessioned state**, not component-local UI state: `LayoutState` is a plain
  recursive `{flex, direction, children}` tree that satisfies `ILinkableVariable`
  (`FlexibleLayout.tsx:9-79`), so panel arrangement rides the exact same undo/save pipeline as data — "my
  dashboard layout is undoable and shareable" costs nothing extra once layout lives in the same state model.

- **Legends are literally plotters over a synthetic key space** — one "record" per color/size bin, hit-tested
  through the identical generic mouse-handling code path as a real data point (`ColorBinLegendPlotter.as:56-347`)
  — so clicking a legend swatch to filter needs zero bespoke interaction code.

- **One generic config UI for ~40 tool types.** `ISelectableAttributes` is a 2-method interface (named slots →
  labels); `AttributeSelectorPanel` is the *only* attribute-picker implementation in the codebase, generic over
  anything that implements it (`ISelectableAttributes.as:23-35`). New chart types get a working config UI free by
  declaring their slots.

---

## 6. Adapter — the author's own prior attempt, read honestly

The repo owner's 2016 "Adapter" project tried the more general version of the renderer-bridge problem
vizfootprint is revisiting now: a framework-agnostic session shape (`session/ScatterPlot.js`) plus per-renderer
`hook`s (`D3Hook.js`, `C3Hook.js`) bound through a hub (`WeaveJSPeer.js`). It is useful precisely because it is a
small, readable, first-hand precedent — including its unfinished parts.

**The core mechanism — hub-and-spoke with an identity echo guard.** A selection event from any chart writes into
one global `selectionKeysPath`; that write's callback (`renderSelection`, `WeaveJSPeer.js:75-87`) iterates every
registered hook and calls `doSelection(keys)` on all of them **except** the one whose live `chart` reference
equals `activeHook` — a plain mutable field set by the originating UI right before the call and unconditionally
cleared after. It works, but it is a throwaway in-memory flag with no record of *why* a chart changed, and it is
scoped to nothing — just "good enough" for a single-threaded synchronous callback chain.

**Where a commit log is a strict upgrade, not just a nicer version:** tag every commit with its origin chart id,
and "broadcast to everyone except origin" becomes a *filter over the log* — replayable and auditable, which
Adapter's in-memory flag structurally cannot offer. This is the single most concrete data point in the whole
study for what vizfootprint's commit log already buys over the median hand-rolled linked-brushing
implementation.

**What Adapter had that's worth deliberately keeping:**

- **The hook is a separate object from the rendering component**, not folded into it — the `ScatterPlot` tool
  composes `sessionData` + `hook` + a lazily-created `ui` (`components/D3/ScatterPlot.js:68-118`), giving the hub
  a stable handle to "the chart" independent of React mount/unmount lifecycle.
- **The base interface degrades gracefully.** `AdapterInterface`'s default `doSelection`/`doProbe` are harmless
  `console.log` stubs, not throws (`AdapterInterface.js:17-23`) — an incomplete hook doesn't crash the fan-out
  loop.

**What Adapter got wrong — worth naming as an anti-pattern, not just a footnote:**

- **The key↔index translation problem is real and under-solved.** D3's chart already speaks in domain keys, so
  its hook passes them straight through. c3.js's selection API is index-based, so `C3Hook.js` needs a
  `keyColumnToYIndex`/`yIndexToKeyColumn` table, built once per data load inside `ScatterPlotUI.js:109-152` and
  never abstracted — a third index-based renderer would reinvent the same table from scratch. vizfootprint's
  `{rawValue, encoding}` emission model is a strictly better answer *if* that translation seam is made a
  first-class adapter responsibility rather than left for every new renderer to rebuild.
- **The crossfilter slot collapses to one global instance.** Exactly one `defaultSelectionKeySet` and one
  `defaultProbeKeySet` exist for the whole session (`WeaveJSPeer.js:32-38`) — there is no way to run two
  independent linked-brushing groups. Worth an explicit check that vizfootprint's clause-based crossfilter
  (see the renderer-protocol proposal, point 1b) doesn't quietly reduce to the same single-global-slot trap when
  a dashboard needs more than one selection group.
- **State and the accessor everyone trusts drifted apart.** `getSessionStateValue()` — the one accessor
  components actually read — omits `keyColumn` even though `keyColumn` is real, sessioned, and actively used by
  the C3 renderer (`session/ScatterPlot.js:108-115` vs. `C3/ScatterPlotUI.js:121`). This is the textbook failure
  mode a commit-log/event-sourced session should structurally prevent: if every mutation must go through the
  commit path, there's no shadow field a generic reader can silently miss the way a hand-maintained getter can.
- **Multi-renderer parity came from a shared state *class*, not a shared rendering IR.** Two independent renderer
  packages both instantiate the same `session.ScatterPlot`, but "encoding" is just two `LinkableString`s
  (`xAxis`/`yAxis`) that each renderer hand-wires into its own config shape (`ScatterPlotUI.js:33-75`) — a third
  renderer means a third hand-written mapping. Adapter is proof, from the inside, that a shared state class alone
  is not enough to avoid per-renderer boilerplate; a declarative `{rawValue, encoding}` emission is the stronger
  version of the same idea.
- Two abandoned/broken files sit in the tree unreferenced (`components/VisTool.js` calls an undefined method and
  exports a nonexistent identifier; `session/WeaveScatterPlot.js` is a draft whose methods reference fields its
  own constructor never sets) — not a design lesson, but a reminder that "the code that's actually imported and
  exercised end-to-end" (`docs/documentation.js`) is the only trustworthy source of truth in a repo, including
  this one.

---

## W1–W3: the transferable mini-lib roadmap (PROPOSED — none of this exists in `src/` yet)

Three small, independently useful subpaths fall out of this study. None are built; each is scoped to be additive
to the existing `src/{agent,analysis,branches,cause,data,def,fdr,log,mcp,mosaic,session,why}` layout without
touching the commit-log core.

- **W1 — `keys/` (PROPOSED).** Interning (stable string id + dense int, §2) + a `KeySet`-shaped structure whose
  `added`/`removed` delta *is* the thing that gets logged (fixing the headline symmetry directly) + the
  `KeyFilter`/lazy-validate composition pattern for subset algebra at scale.
- **W2 — `schedule/` (PROPOSED).** Adopt footprintjs's `observer-queue` interfaces (injectable pump + clock +
  budget + counted overflow — see §3's sidebar) rather than re-deriving them; add Weave's priority tiers and the
  `iterativeTask(deadline) → progress` contract with version-stamp self-abort on top.
- **W3 — `lod/` + `hittest/` (PROPOSED).** The zoom↔detail contract (`minImportance = dataArea/screenArea`) as a
  one-line derivable value; a BLGTree-or-simpler pruned-traversal structure for path simplification; a spatial
  index (KD-tree or a simpler flatbush/rbush-style index plus an importance dimension) shared between rendering
  and hit-testing so hover always agrees with what was actually drawn.

None of these are a prerequisite for the renderer-protocol work in `docs/proposals/renderer-protocol.md` — they
are a separate scale-engineering track that this study is the evidence base for, to pick up when vizfootprint's
own scale (row counts, selection sizes, geometry density) actually needs them.
