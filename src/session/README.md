# session — the interaction session

One session = one person's (or agent's) walk through a dashboard: a commit log of acts (select, filter, describe, link, …), a cursor into it, branches, bookmarks, and the fold that turns the log into what is on screen. Every act lands as a commit with a cause; reads never land anything.

## The all-or-nothing law: an act either fully happens, or it does not happen at all

Everything on screen is derived from the TRACE. That is the whole claim of this
library, and it is a claim about *moments*, not about averages: there must be no
moment at which the live session has moved and no commit records it, and no
moment at which a commit is on the log and the session disagrees with it.

A half-applied act breaks that claim **silently**. There is nothing in the log to
show for it — that is precisely what it means for the state and the trace to
have come apart — so it does not surface as a bad answer, it surfaces as a
dashboard that is quietly no longer explaining itself. Every other law here
(the fold is detached, the trace is append-only, replay equals the walk) rests
on this one.

Three rules keep it. Each `doX` in `session.ts` already obeyed the first; the
second and third are what this section added.

### 1. JUDGE FIRST — every refusal happens before anything moves

Every door runs its guards and returns a `reject(...)` before it touches the
log, the cursor, the head, the filters, the folds, or a store. A view that is
not declared, a column the table lacks, a channel this chart kind has no slot
for, a saved picture that could land nothing: all refused with a typed gap
(R14), with the session exactly as it was.

`applySaved` is the sharpest case, and it says so in its own section below: it
judges every condition first, because a `replace` clears the live filters to
make room — and clearing to make room for something that then cannot land would
be a change to the dashboard nobody asked for.

### 2. THE APPLY PHASE MAY NOT FAIL PARTWAY

Judging first is only half of it. Once judging is done, the steps that actually
move things must not be able to throw between them — otherwise the refusal is
sound and the *success* is what half-happens.

The shape is: **compute everything that can throw during the judge phase; leave
the apply phase as pure assignment.** Never a rollback. This codebase has no
state rollback anywhere, on purpose (a rollback path is more state you have to
get right, and it is exercised only when things are already going wrong).

Two windows were open and are now closed, both of them the same mistake — a
fallible step standing between two halves of one act:

- **`log.commit()` used to move the live selection before the record existed.**
  `causeClause(spec)` → `selection.update(clause)` → *then* ask the session for
  the data stamp, render `predicateSQL`, build the record, deep-freeze it, push
  it. Four fallible steps after the screen had already moved. A throwing
  `stampData`, or a predicate whose `toString` threw, left the live selection
  standing on a clause with no commit behind it — the exact thing
  [`../detach/README.md`](../detach/README.md) says must be impossible. Now the
  clause, the stamp, the record and the freeze are all built while nothing has
  moved, and the apply phase is two assignments: push the record, drop the
  cached snapshot.
- **`proposeChart` used to render the spec BETWEEN its two commits.**
  `gateChartSpec` judges a spec's *shape* — it does not judge whether the spec
  can be written down. A spec carrying a `BigInt` (or a reference back to
  itself) passes every gate and then makes `JSON.stringify` throw — after the
  FDR ledger had spent a step and the `pValue` hypothesis commit was already
  history. That left a ledgered claim on the trace for a chart with no spec and
  no view. The wire form is rendered in the judge phase now, and an unwritable
  spec is an ordinary `chart-invalid-spec` refusal.

**A burnt commit id is NOT a window, and that is worth stating.** `nextId()`
mints before `log.commit()` runs, so a refusal inside `commit()` spends a number
nothing ever uses. That is fine, and it is fine for a reason already on the
record: ids are minted per DASHBOARD, so a session's own log has gaps in its
numbering anyway, and nothing anywhere reads an id as a position — order is the
parent chain and `ts`. See [`../log/README.md`](../log/README.md), Law 2. What
would NOT be fine is any *other* state surviving that throw, so the log's cell
refusal is now the first thing `commit()` judges, before it registers a source.

### 3. AN OUTBOUND EFFECT IS NOT PART OF THE ACT

Some steps genuinely can fail and are genuinely not the act: they reach outside
the session, into code this library does not own. A mounted adapter re-rendering
(`ViewAdapter.applyClause`, R3 inbound). The live Mosaic `Selection` relaying to
whatever listeners a host attached. A provider writing an analysis column back
into the data space.

Those are moved OUT of the transaction, and their failure is a typed
`effect-failed` gap naming the act, the thing that failed, and what it said.
Never swallowed — the gap ledger is this library's channel for "something did
not work" and it is used here exactly as everywhere else.

The reasoning is worth being explicit about, because "swallow it" and "let it
throw" are both wrong. A dashboard whose chart failed to redraw is a dashboard
with a stale picture on it — annoying, visible, recoverable. A dashboard that
lost the commit because the chart failed to redraw is one whose picture is not
derived from the trace at all. And a dispatch that *throws* for an act that
already landed tells the caller the opposite of the truth: the rail, the fold
and the log all say it happened.

#### Worked example — an adapter that throws, and the act still stands

```ts
const s = buildDashboard(def).createSession();
s.mountView('bar', {
  capabilities: { canProbe: true },
  applyClause: () => { throw new Error('renderer blew up'); },
});

const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category',
                               value: 'Formal', cause });

res.ok;                                    // true  — it happened, and it says so
s.log.records.length;                      // 1
s.head === res.commit.id;                  // true
s.cursor() === res.commit.id;              // true
(await s.overview()).activeSelections;     // [{ viewId: 'bar', value: 'Formal', … }]
(await s.overview()).selectedRowCount;     // 8 — the filter really is applied

s.gaps().at(-1);
// { code: 'effect-failed', op: 'select', target: 'bar',
//   detail: 'commit s1 landed, but the mounted adapter for view "bar" threw
//            while re-rendering it: renderer blew up' }
```

Before this, that same call **threw** `renderer blew up` out of `dispatch` — with
the commit already on the log, the head already moved and the filter already
live. The caller saw a failure for an act that had entirely happened. A replay
of the trail (`adoptPath`) told the same lie in report form: it reported the step
`applied: false` while the commit it had just landed sat in the log.

Two more of the same shape, same answer:

```ts
s.log.selection.addEventListener('value', () => { throw new Error('a chart blew up'); });
await s.dispatch({ verb: 'select', … });
// ok. gap: { code: 'effect-failed', op: 'commit', target: 's1',
//            detail: 'commit s1 landed, but the live selection for view "bar" threw …' }

// a provider that cannot write a materialized column back
const out = await s.declareAnalysis('clustering');
out.commit;                 // the analysis ran, and its commit stands
out.materialized;           // []  — honestly claims nothing was written
out.gap;                    // { code: 'effect-failed', op: 'declareAnalysis', target: 'cluster_id', … }
```

That write has a JUDGE in front of it, and the judge is rule 1 above: a computed
column may never take a declared source column's name, refused before a single
value moves (`guard-failed`). Which columns a derived one is allowed to take,
how two branches computing the same name stay apart, and why column VISIBILITY
is a consequence of that resolution rather than a second mechanism, are in
[`../data/README.md`](../data/README.md) — "a derived column belongs to the act
that made it".

The `op` on an `effect-failed` gap is the verb where there is one, and `commit`
where there is not: the live selection's update happens inside
[`../log`](../log/README.md), which does not have a verb — so the gap's `target`
names the COMMIT, which identifies the act more exactly than a verb would
anyway.

### What this means when you add a door

List, in order, what your `doX` mutates: the log, `_head`/`_cursor`, the refs,
`activeFilters`/`activeFilterCommits`/`clearedFilters`, `activeEncodings`/
`activeLayouts`/`activeLinks`, the prose folds, the memos, the gap ledger, the
dashboard-level stores, the adapters. Then ask of each step: *can it throw, and
if it throws, is what came before it observable?* Anything that can throw belongs
above `log.commit()`; anything that reaches outside the session belongs below the
last assignment, wrapped, with a gap.

`landed()` is written the same way and for the same reason: it routes the record
through the refs first (the one step that does real work — naming or advancing a
path, journaling the event) and moves `_head`/`_cursor` last, as two assignments
that cannot fail.

Pinned by `atomicity.test.ts` (the session half) and by the "judge everything
first, then apply" block in [`../log`](../log/README.md)'s `log.test.ts`.

**Deliberately not guarded**, and stated rather than hidden: `rebuildFold`
clears every fold map and refills it from the branch path, so a throw partway
through would leave a genuinely half-built fold. It is not defended, because
every record it reads is one this session's own doors landed and deep-froze —
plain JSON, judged on the way in — and every operation over them is a string or
`Map` write. If a door is ever added that lands a record `rebuildFold` has to
*interpret* (rather than route), that reasoning expires and the fold should be
built into fresh maps and swapped in.

## The view-query port (`viewQuery`, `clausesFor`)

A sheet window is ONE call: `viewQuery({ table?, viewId?, columns?, sort?, limit?, offset? })` answers `{ columns, rows, rowIds, positional, key?, count, start, version, cursor, clauses }` or a typed refusal with a sentence. `clausesFor(viewId)` is the engine-side twin of the renderer's crossfilter law — which gestures reach a view through the link graph (own clause excluded, each edge's response and mapping applied, a cleared source remembered per its `onClear`). With no view, the count is exactly what `Overview.selectedRowCount` counts. The engine keeps one sort permutation per (table, sort spec); a brush never rebuilds a sort. The version is read beside the provider and re-checked after the rows: a refresh in between is `version-moved`, never a misdated window.

## Saved selections are saved logic (`saved`, `saveSelection`, `renameSaved`, `forgetSaved`, `applySaved`)

A saved selection is the whole picture a person had filtered to, written as data: one condition per view — which chart, which field, which test on the value — plus who saved it, when, and the data version it was made on. It lives BESIDE the log (the dashboard's store, shared by every session), never in it: saving lands nothing on the rail. `saveSelection(name, { live: 'all' } | { viewId } | { conditions })` names it; `applySaved(name, cause, { mode })` is the act — one ordinary select or filter commit per condition, all under one cause ("applied saved selection <name>") and one correlation id; `replace` (the default) clears the other live filters first so the picture comes back, `layer` adds to what is selected. The answer is honest per condition: what landed, what was cleared, and every condition that could not land with its sentence (a view no longer on the dashboard, a field the table lacks). Every picture carries its own short id (`p1`, `p2`, …), minted by the store, which NEVER MINTS A NUMBER TWICE (forgetting frees the name, not the number: words written at another moment in the history link that id, and the forget guard only sees the words on screen at the cursor); `by`/`at` are the CREATION stamp and never move, and a rename records `editedBy`/`editedAt` beside them — which is why the list, ordered by `at`, never reorders under a rename. A note's `@[name]` ref carries that ID (its `label` keeps the words the writer typed); a click applies it, never seeks.

Four laws at the moment of apply: it is JUDGED FIRST — a condition on a view that is gone or a column the table no longer has is refused before anything is touched, and an apply that could land nothing clears nothing (`ok: false`); a picture names a view ONCE (a second condition on the same view is refused at save); the clears a `replace` makes are marked `replacedBy` in their cause, so a link's `onClear` never remembers them — no ghost of the old picture survives; and `layer` is per view — a condition on a view already selecting replaces that view's clause, it does not union within it. Renaming is FREE, even while notes link the picture — they link its id, so nothing breaks; only the words an anchor shows may go stale, and the library never rewrites prose. Forgetting IS refused while words on screen link it, since the link really would break: the sentence names them (`"coastal" is linked from note n1, dashboard — change the link in the words first`). Undo is per commit today; the correlation id lets the rail fold the batch.

Persistence: a host reads `session.saved()` and puts the pictures back whole with `session.restoreSaved(list)` (or `dashboard.restoreSaved`) — judged, never re-stamped: id, who, when, any edit stamp, and on-what survive the round trip. A record keeps the id it arrives with when no other record holds it; when it carries none, or one already taken, the store names it and says so in `reidentified` — an id is never quietly overwritten. Not here yet: a "saved on version 3, applied on version 5" sentence in the UI, a group undo, a one-update-at-the-end seam for an apply of many conditions, and the rail's family filter that hides non-act commits.

## Bookmarks are names on moments (`bookmarks`, `bookmark`, `describeBookmark`, `renameBookmark`, `forgetBookmark`, `restoreBookmarks`)

A bookmark is a name (and a description) on a commit, plus who made it and when — kept beside the log, never in it. Bookmarking lands no commit, starts no branch and saves no state; several bookmarks may sit on one commit; a name points at one moment. The `bookmark` dispatch verb is the same act. `bookmarkViews()` is the wire's view of the same bookmarks — the bookmark's `id`, its `label`, the bookmarked `commitId` (also `at`), and the commit's position `ts` (`-1` when the bookmark names a moment this log does not hold); `whats_here` carries the records as `Overview.bookmarks`. Every bookmark carries its own short id (`b1`, `b2`, …), minted by the store — which never mints a number twice, for the reason a picture's never is — and that is what a note's `@[bookmark]` ref links: renaming is FREE, even under a link. `by`/`at` are the CREATION stamp and never move; a rename and `describeBookmark` (which is how a bookmark's words change) record `editedBy`/`editedAt` beside them, so the list never reorders. Forgetting IS still refused while words on screen link the bookmark — that link really would break. `restoreBookmarks` puts bookmarks back whole for a host's persistence, keeping a free id and naming any record it had to re-id (`reidentified`), and refusing a commit the session's log does not hold — `dashboard.restoreBookmarks` has no log to check against, so a host's own record is taken as it stands.

## A fold result is DETACHED (`overview`, `viewEncodings`, `ledger`, `gaps`, `links`)

The FOLD derives what may responsibly be claimed now; a LENS serves a bounded
view of that fold to a reader. The law: **a reader never holds the object the
system is still using.** If it does, the reader can change what the dashboard
believes without a commit — and then what is on screen is no longer derived
from the trace, which is the one thing this library claims.

Three surfaces were breaking that law, and all three are one bug wearing three
hats — a *cached* thing handed out by reference:

```ts
dashboard.def.meta.title = 'HIJACKED';        // stuck. the def was documented frozen and was not

const enc = session.viewEncodings('scatter');
enc.x = 'FORGED';
session.viewEncodings('scatter').x;           // 'FORGED' — the live cached object

const ov = await session.overview();
ov.links.edges.push(forgedEdge);
(await session.overview()).links.edges.length; // 37, not 36 — with zero commits in between
```

None of them work now. Each throws a `TypeError`, and the next read says what
the trace says.

### Freeze or copy — chosen per surface, on cost

There are two honest ways to detach, and they cost different things (the helper
and the reasoning live in [`src/detach`](../detach/README.md)):

| surface | how | why this one |
|---|---|---|
| `dashboard.def` | **freeze**, once at build | The MAP is still: declared once, read by every fold, lint and overview, written by nobody. A copy per read would be the most expensive possible way to say something true forever. |
| the materialized link graph, and `overview().links` | **freeze**, once at build | `applyLinkOverrides` hands back the base graph BY REFERENCE when there is nothing to lay over it — which was the bug. A reference to something nobody can change is safe, and it keeps a call made several times per gesture free. An overlaid graph is frozen too; only its new edges are actually walked, since the base is already frozen. |
| `viewEncodings(viewId)` | **freeze**, where the fold stores it | Read several times per view per `overview()` and once per encoding edge. The fold only ever REPLACES these maps (`set(id, {...current, …})`) — it never writes into one in place — so freezing where they are stored costs nothing and a copy per read would not be free. |
| the effective-encoding and `fits` memos | **freeze**, where they are built | A memo is a cached object by definition, and `overview()` hands both to a reader. Rebuilt whole when their key changes, never written into. |
| `ledger()`, `gaps()`, `refs.events()` | **copy** the list, **freeze** each row | These are lists the session still APPENDS to, so freezing the list would stop the session working — but the rows inside are shared with the list, so each is frozen where it LANDS (an audit row, like a commit, is finished the moment it is written). All three are cold enough that a copy per call is the right trade. |
| `dashboard.sources` | **copy** | The one build-time record that MOVES: `refresh()` replaces a table's entry. |
| `saved()`, `bookmarks()` | **copy** (already did) | Store records a host may hold across edits. |
| a table's `rows` and inline `source.at` | **neither, on purpose** | Bulk data the AUTHOR still owns — the demo in this repo declares `data: { data: { rows } }` and keeps drawing its own chart from that same array. Every provider copies the rows at build, so nothing the dashboard reads is affected. Stated rather than hidden. |

### The sweep

Every getter that could hand back a cached object, a store's own array, or a
graph by reference was checked. Fixed: `Dashboard.def`, `Dashboard.sources`,
`Dashboard.engines`, `Dashboard.notes`, `Dashboard.journal()` and its entries,
`runtime.keys`, `applyLinkOverrides`/`materializeLinks`, `session.viewEncodings`,
the encoding and layout folds, the effective-encoding and `fits` memos,
`session.ledger()` (and the FDR rows inside it), `GapLedger.rows()`,
`BranchRefs.events()`, the registered chart views behind `charts()`, and
`overview()`'s `sources` / `journal` / `fdr.ledger` / `paths.events`.

Already correct and left alone: `saved()`, `bookmarks()`, `bookmarkViews()`,
`layouts`, `clausesFor()` (it copies each clause), and the journal records,
which this repo was already freezing by hand — the law was known here, just not
applied evenly. Also closed while passing: `BranchRefs`'s `Head` record, which
`head` and `state()` hand straight out (flat, replaced whole on every move, so
a freeze where it is assigned is enough). The one deliberate exception left is
a table's bulk `rows`, for the reason in the row above. Pinned by
`detached-folds.test.ts`.

**Detaching cuts both ways**, and this is the half that is easy to miss: a
frozen thing is safe to hand out, but it is not safe to have TAKEN. The commit
log copies the `value` a caller passes before it freezes the record — a
multi-select hands in the array the UI is still holding, and without the copy,
landing the commit would freeze the caller's own array under it. See
[`src/log/README.md`](../log/README.md), Law 1 ②.

A second-order bug fell out of this sweep and is worth remembering: spreading
an object EVALUATES its getters. The async builder used to layer its refresh
door on with `{ ...dashboard, refresh }`, which quietly froze a build-time copy
of `sources` the moment `sources` became a getter. `assemble` now takes the
refresh door as a parameter, so there is one dashboard object literal and no
place for that to happen again.

## The conformance law: folding as you WALK equals folding a REPLAY

The fold a session builds incrementally while a person walks (each door writing
its own bit of state as an act lands) must equal the fold rebuilt from nothing
but the commit log. If those two can disagree, "the dashboard explains itself"
is a story about the walk and not about the record — and a replay, a seek, a
shared link and a restored session each show something the trace cannot account
for.

`conformance.test.ts` is that law, written as a test. It drives one session
through a varied sequence — a point select, an interval filter, a match select,
a cell select, a clear, a re-encode, a link edit, an analysis, prose, a layout
move, a fork and a seek — capturing the fold after every act. Then it
serializes the log, replays it into a fresh session on a fresh dashboard, seeks
to each of those moments, and asserts the folds are equal.

```ts
const walked = buildDashboard(def()).createSession();
const { tip } = await walk(walked);              // the fold the DOORS built

const replayed = buildDashboard(def()).createSession();
replayInto(replayed, deserializeLog(serializeLog(walked.log.records)), tip.cursor);

expect(foldOf(await replayed.overview())).toEqual(tip.fold);   // ← the law
```

**EQUAL means** every surface the fold produces: the live selections and the
commits they came from, the cleared selections a link's `onClear` still
honours, the filters as a prose basis states them, each view's own and
effective encodings, the link graph, the layout arrangement, and every view's
prose and open proposals — at the same cursor.

**What may legitimately differ**, and why none of them is a fold: wall-clock
stamps (a replay happens later, by definition); `cause.replayed`, which a
replay ADDS and is the honest marker of the second run; HEAD, which is where
the walker is standing rather than what the fold says; the FDR and gap ledgers,
which are session-local records of what this walker asked for; the stores
beside the log (saved pictures, bookmarks, the data journal), which live on the
dashboard and have their own persistence doors; and materialized columns —
re-running an analysis means running third-party code again, which a log replay
deliberately does not do and `adoptPath` deliberately does. (A materialized
column that IS present is branch-scoped, and that scoping is one mechanism, not
two: see [`../data/README.md`](../data/README.md).)

One caveat, stated because it matters: a fold read after a `seek` is ALREADY a
rebuild, so comparing that to a replay compares `rebuildFold` with itself and
proves nothing. The test therefore compares the fold the doors built as each
act landed. It was checked against five deliberate fold bugs (dropping the
layout fold, the cleared-selection memory, the link-edit fold, the encoding
fold and the prose fold) and catches all five.

The session has no public "replay this log into me" door today; the test
re-commits each record through `session.log` and then seeks, which is what
`replayLog` does at L1. That seam is worth adding.

## Commit identity is per DASHBOARD, not per session

A commit id (`s1`, `s2`, …) is minted from a counter on the dashboard runtime,
beside the saved-picture and bookmark stores — because those stores NAME COMMIT
IDS and are shared by every session on the dashboard. Two sessions used to both
mint `s1`, so a bookmark made in one silently resolved to a different act in the
other. A session's own log therefore has gaps in its numbering, which is
correct. The full law, the reproduction and a worked example are in
[`src/log/README.md`](../log/README.md), "Law 2".
