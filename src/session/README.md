# session — the interaction session

One session = one person's (or agent's) walk through a dashboard: a commit log of acts (select, filter, describe, link, …), a cursor into it, branches, bookmarks, and the fold that turns the log into what is on screen. Every act lands as a commit with a cause; reads never land anything.

Five laws govern this folder, and the sections below are them in order: **1** an act either fully happens or it does not happen at all; **2** a fold result is detached; **3** folding as you walk equals folding a replay; **4** commit identity is per dashboard; **5** a read at a cursor answers about that cursor. The sections in between (the view-query port, saved selections, bookmarks) describe doors rather than laws.

## Where the code lives

`session.ts` is the SESSION: one class that owns the state and every door onto
it. That is deliberate and it is not going to change — the doors move the log,
the cursor, the head, the folds, the memos and the stores, often several of
them in one act, and law 1 below is a claim about the ORDER those moves happen
in. A door split across two objects is a door whose order you have to
reconstruct by reading both.

What has been lifted out is everything beside it that is a RULE rather than a
piece of state. Each of these is a plain function over its arguments — nothing
here can reach the session, which is the property that makes them safe to hold
apart, and each file's own header carries the reasoning:

| file | what it owns |
|---|---|
| `wire.ts` | the translations between a clause, a commit's flat triple, a saved condition and the act that lands one. The reason walk-equals-replay (law 3) holds: `doProbe` writes through one of these and `rebuildFold` reads back through another |
| `branchPath.ts` | the parent chain, read three ways — law 5's substrate. Each takes the whole log first and the position second, so a caller has to name the position it means |
| `clausesReaching.ts` | which gestures reach a view through the link graph, and what a mapping renamed them to — the engine-side twin of the renderer's crossfilter law |
| `effectiveEncodings.ts` | what a view SHOWS once the encoding edges are read through, and the ONE-HOP law that keeps two views pointing at each other from becoming a solver |
| `offers.ts` | the offers list and the position stamp — and the line between them, which is why `offers` stopped churning on every act |
| `namespaces.ts` | the names a session-authored commit lands under: the reserved fields and the synthetic `encoding:` / `link:` / `chart:` / `layout:` identities |
| `stampCause.ts` | the cause a commit carries, validated and R1-forced rather than believed |
| `tablesInfo.ts` | the Sources rows — the one part of `overview()` that projects the MAP and not the trace |
| `gapLedger.ts` | the R14 ledger, and `messageOf`, which turns whatever third-party code threw into a sentence a gap can carry |

The memos stayed behind with everything else that is state: a cache key is
session state, so `effectiveEncodings` and `fitsOfView` still hold theirs and
call out to the computation. **The rule for the next cut is the one that
produced these:** move the thing that only reads its arguments, and leave the
thing that owns a field. A judge and its apply phase are one act, and moving
half of one across a file boundary is how law 1 breaks without a test noticing.

Nothing here changed what `rebuildFold` can do, so the expiry condition stated
at the end of law 1 still stands exactly as written: `probeClause` moved to
`wire.ts` and is as total as it was, and every operation the fold performs over
a record is still a string or `Map` write.

## Law 1 — the all-or-nothing law: an act either fully happens, or it does not happen at all

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

## Law 2 — a fold result is DETACHED (`overview`, `viewEncodings`, `ledger`, `gaps`, `links`)

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

## Law 3 — the conformance law: folding as you WALK equals folding a REPLAY

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

## Law 4 — commit identity is per DASHBOARD, not per session

A commit id (`s1`, `s2`, …) is minted from a counter on the dashboard runtime,
beside the saved-picture and bookmark stores — because those stores NAME COMMIT
IDS and are shared by every session on the dashboard. Two sessions used to both
mint `s1`, so a bookmark made in one silently resolved to a different act in the
other. A session's own log therefore has gaps in its numbering, which is
correct. The full law, the reproduction and a worked example are in
[`src/log/README.md`](../log/README.md), "Law 2".

## Law 5 — a read at a cursor must answer about that cursor

The session has two pointers. `_head` is the tip of the branch acts extend;
`_cursor` is where you are standing and looking. `branchPath(cursor)` walks the
parent chain and hands back the root→cursor prefix — everything this position
could have seen — and `rebuildFold` refills the fold from exactly that.

The commit log, though, is not a line. It is a tree, and `this.log.records` is
every commit on every branch of it. Roughly twenty reads in `session.ts` reach
for that array, and until this section they were not marked: some of them were
asking a question the whole tree answers, and some were asking a question only
the cursor's prefix answers, and nothing in the code said which was which.

**The door, so a reader never has to decide silently.** `commits(scope)` is
how anything outside the session reads the trace — the scope is a REQUIRED
argument, because the two answers are two different claims and the whole point
of this law is that the code should say which one it meant:

```ts
s.commits('path');       // root -> cursor: everything THIS position could have seen
s.commits('anywhere');   // every commit on every branch, in arrival order
```

The two words are this law's own, deliberately: `'anywhere'` rather than
`'history'`, because a reader can hear "history" as *the past* — the commits
behind the cursor — which is the very ambiguity the law exists to remove. The
door and the law now say the same thing, so reading one teaches the other.

`log.records` is still there (the trace is a public, frozen, append-only
array), but a consumer reaching for it is a consumer answering this law's
question in its own head. The demo did, in three places, and the cockpit
adapter had baked `readonly log: { records }` into its own session contract for
want of anything better to ask for. Two of those reads genuinely wanted the
whole history (a branch map draws every lineage; a citation check asks whether
an id names a commit at all) and one wanted the path (the last six acts, handed
to an analyst as context — which after a seek used to include acts from a
branch the dashboard was not standing on). One door, one word at the call site,
and each of them now says which.

**The rule, in one line:**

- A read that answers **what is true**, or **what happened**, is about a
  position — scope it to the cursor's branch prefix.
- A read that answers **what exists anywhere in this history** is legitimately
  whole-log: an existence check before a seek, the id set for minting, listing
  branches, comparing two branches, planning a bring-over between them.

The dangerous shape is a read that **sounds** cursor-scoped and is not. It does
not fail loudly. It produces a confident answer about a moment, built out of
evidence from a branch that moment never saw — and because this library dresses
its answers in provenance, the wrongness arrives wearing a commit id.

### Worked example of each side

**Position (must be scoped).** Two brushes off one pick — the affordable end on
path A, the premium end on path B — and a note written on B:

```ts
const root = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
const a    = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [30, 120], cause });
s.seek(root.commit.id);
const b    = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [120, 220], cause });

// standing on B, citing A's brush
await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', cause,
  record: { text: 'The premium end is where the ratings are, see the cheap brush.',
            author: { kind: 'human' },
            refs: [{ span: [46, 51], commit: a.commit.id }] } });

// { ok: false, rejection: { code: 'guard-failed', detail:
//   '"note:n1".caption.refs[0] cites commit "s2", which is on another branch —
//    these words stand at a moment that never saw it; seek to it (or bring it
//    over) and write them there' } }
```

That used to land. The note then hung on the dashboard on path B with a working
anchor pointing at a brush that had never been applied there, and `why()` on
those words listed it as one of the commits they depend on.

**Existence (legitimately whole-log).** Every one of these still reads the whole
tree, on purpose:

```ts
s.seek(a.commit.id);              // travelling to another branch IS the point of a cursor
s.bookmark('the cheap end', a.commit.id);  // a name on a MOMENT; the store is dashboard-wide
await s.compare('A', 'B');        // comparing two branches reads both, by definition
await s.bringOver(a.commit.id);   // planning to carry a step across is not a claim about here
```

And after that bring-over, the citation refused above is honest here — because
the step is now on this path. The refusal never removed an ability; it named
the one step that was missing.

### The full classification

**A citation here names a file and a symbol, never a line.** This table used to
carry line numbers and they were stale before anyone noticed, which is the
failure this whole folder has laws about: a claim that was true when it was
written and is not checked when it is read. A symbol survives every move that a
line number does not, and if a symbol is gone the reader learns something true
rather than landing in the middle of something else.

| read (`session.ts`) | side | why |
|---|---|---|
| `seek` — commit exists | whole | you seek TO other branches; that is navigation |
| `branchPath` — the id map | whole | the substrate the scoping is computed FROM; a parent chain crosses no branch |
| `rebuildFold` | scoped | the fold IS the position |
| `branches()` | whole | listing the branches of the tree |
| `paths()` | whole | listing named refs and their lengths; each `branchPath` is scoped to ITS tip on purpose |
| `newPathAt` — commit exists | whole | you may start a path at any commit |
| `pathToRewind` | scoped, to the named path | "is `at` on the path I would rewind" — deliberately not the cursor's |
| `discardFromHere` | whole for existence, scoped for the step count | two different questions, two different reads |
| `stepsSinceAncestor` | both, deliberately | it exists to compare two branches |
| `adoptPath` → `planBringOver` | whole | planning a bring-over between branches |
| `rowsAtTip` → `foldStateAt(records, tip)` | scoped by `tip` | `foldStateAt` walks the chain itself; the whole log is only its index |
| `compare` → `foldDiff` | whole | comparing two branches |
| `bringOver` / `undo` plans | whole | both are planned AGAINST the cursor, which the planner is given |
| `derivedAt` | scoped | which `risk` is in front of you — see [`../data/README.md`](../data/README.md) |
| `bookmark` — commit exists | whole | a bookmark names a moment anywhere; the store is dashboard-wide |
| `restoreBookmarks` — the id set | whole | validating restored records against the history |
| `applySaved` correlation id | whole | `records.length` is used as a counter, never as a claim |
| **`proseWorld` — `commits`** | **scoped (was whole)** | the mention world; the decision is below |
| `doFork` — commit exists | whole | you may fork from any commit |
| **`provenanceForAnalysis`** | **scoped (new)** | which run of `clustering` you are asking about |
| **`why()` — `vizRecords`** | **scoped to the TARGET's branch (was whole)** | the answer may only name commits the declaring act could have seen |
| `whyProse` — the entry at the cursor | scoped | which words are on screen |
| `whyProse` — the landing record | whole | an id-to-record lookup for a commit the fold already named |
| **`whyProse` — `vizRecords`** | **scoped to the WORDS' branch (was whole)** | same reason as above, at the words' own position |
| `whyProse` — input selections | scoped by `landing.id` | the selections live when the words landed |
| `bookmarkViews` — positions | whole | a bookmark may name a moment on any branch; `ts: -1` when the log does not hold it |
| `overview` — `cursorTests` | scoped | the two-truths surface: tests on YOUR path vs the session's whole ledger |

Four were on the wrong side. Every other row was already right, and several
were right in a way worth noticing: `foldStateAt`, `planBringOver`, `planUndo`
and `foldDiff` all take the whole log and scope it THEMSELVES from the tip they
are given, so handing them everything is correct — the position is the second
argument, not the first.

### The decision: may a note cite a commit on another branch? No.

There is a real argument on both sides, and it is written down here so it can be
revisited on purpose rather than by accident.

**For allowing it.** The commit exists. A note is a durable record that may
outlive the branch you were on — you might archive the path tomorrow — and
refusing to let a person point at something that demonstrably happened is a
strange thing for a provenance library to do. This repo already holds that
parking a path must not destroy the statistics (TL-1).

**Against, which is what we chose.** A citation is not a pointer, it is a claim
about *evidence*. A reader who follows a `refs[].commit` anchor is being told
"this is what these words rest on". Evidence from a branch the words' own
position never saw is precisely the confusion this law exists to remove, and it
arrives silently: nothing about the anchor looks different.

Three things settled it.

1. **The rest of this very world is already at the cursor.** `validateProseRecord`
   judges `basis.columns` against this branch's columns — its refusal literally
   reads *"names a column that is not on this branch"*. The commits were the one
   member of the same record's world that was global. That asymmetry was not a
   decision anyone made; it was the absence of one.
2. **Map versus trace.** The other members of the mention world — the columns,
   the declared analyses, the views with an encoding surface — come from the MAP,
   and the map does not move with the walker, so they are global and should be.
   Commits are TRACE. A world member drawn from the trace has to be read at a
   position, or it is not a reading of the trace at all.
3. **Scoping at write time makes the citation permanently sound; not scoping
   makes it permanently ambiguous.** A commit's ancestor set is frozen the
   moment it lands — the log is append-only, so the prefix behind the note can
   never change. A citation judged against that prefix is therefore true
   forever, including after the branch is archived, restored, serialized or
   replayed. Under the whole-log rule the citation stays *resolvable* but its
   MEANING quietly depends on which branch the reader is standing on. The
   durability argument, on inspection, favours the strict rule.

The refusal is also cheap to escape and the sentence says how: seek to the
commit and write the note there, or bring the step over and write it here. That
is why `proseWorld` gathers the off-branch ids as well — never to admit one,
only so the refusal can say *"it is on another branch"* rather than the untrue
*"the log does not hold it"*, the same courtesy `bookmarkNames` pays.

**What did NOT change, deliberately.** A `@[bookmark]` or `@[saved]` ref still
sees the whole store. Those name records that are dashboard-wide by design
(see [`../log/README.md`](../log/README.md), Law 2) — a bookmark is explicitly a
name on a moment anywhere in the history, and a saved picture is logic, not a
moment. They are the "what exists" side of the same rule.

**And on the way out, not only on the way in.** `basis.atCommit` is inert data
the describe door does not judge at all (a ghost id is dropped, never faked —
that law predates this one). So `why({ kind: 'prose' })` scopes its own record
list to the words' branch: a log restored from the wire, or written before this
door existed, can still carry an off-branch id, and the answer must not dress it
up as provenance. Same for `why({ kind: 'column' | 'hypothesis' })`, scoped to
the DECLARING commit's branch — which may legitimately not be the cursor's, per
`slotForColumn`.

**Dropped, and SAID.** Keeping the drop is right — refusing a basis would block
a note for a reason its author never chose and cannot repair, which is the
difference from an authored `refs[]` citation (see *refuse what the author can
fix, disclose what they cannot*, in [`../agent/README.md`](../agent/README.md)).
But dropping it silently is not. `why()` names every commit it could not honour
in `dropped`, each with `off-branch` (this log holds it, elsewhere) or
`unverified` (nothing found it) — which is why `why()` is handed
`commitsElsewhere` beside the branch: never to admit one, only so the answer can
say *"it is on another branch"* rather than the untrue *"the log does not hold
it"*, the same courtesy `proseWorld` pays at the door.

### Rebuilding at a cursor must rebuild everything derived from it

`rebuildFold(cursor)` is the whole of the position-derived state. The audit,
with what a person would see if a row were missing:

| derived from position | rebuilt? | verdict |
|---|---|---|
| `activeFilters`, `activeFilterCommits` | yes | correct — this is the fold |
| `clearedFilters` (the `onClear` memory) | yes | correct; a link's policy would otherwise honour a clear from another branch |
| `activeEncodings` | yes, re-seeded from each view's declared `initial` first | correct — a seek restores the axes that were live |
| `activeLayouts` | yes | correct — each path keeps its own arrangement |
| `activeLinks` | yes | correct |
| `activeProse`, `activeProposals` | yes, re-seeded from the def's words first | correct |
| the derived-column registry (`runtime.derived`) | **not rebuilt — resolved** | correct, and better. It is a dashboard-scoped store; `derivedAt` resolves a name against `branchPath(cursor)` on every read. Visibility falls out of resolution rather than being a second mechanism beside it ([`../data/README.md`](../data/README.md), rule 3). Rebuilding it would be a second copy of the same truth. |
| the effective-encoding memo, the `fits` memo | **not rebuilt — self-invalidating** | correct. Each is keyed by a `JSON.stringify` of exactly what it depends on (`activeEncodings`, `activeLinks`, the facets). `rebuildFold` replaces those, the key changes, the memo recomputes. Clearing them too would be belt-and-braces on a key that is already the belt. |
| the FDR ledger (`_ledger`) | **not rebuilt, on purpose** | a session-local record of what THIS walker asked for. Alpha is spent when a test is run, not when its commit is in front of you; the ledger counts every test including those on archived paths, which is the whole point of an online-FDR budget. Rebuilding it per cursor would refund alpha by walking away — the one thing the procedure must never do. Already stated under Law 3 as a legitimate walk/replay difference. |
| the gap ledger (`gapLedger`) | **not rebuilt, on purpose** | likewise session-local: a record of what this walker asked for and did not get, including asks that landed nothing at all and so have no position. Already stated under Law 3. |
| the chart register (`_charts`) | **not rebuilt, on purpose — a third session-local record** | a proposal spends ledger budget the moment it is made, so a chart carries `ledgered: true` and a `ledgerStep`. If `charts()` hid a chart when you walked to another path, the ledger would still be charging you for a claim you could no longer see. It belongs on the same side of the line as `_ledger`, and it is named here because it is the one row of this table that could plausibly have gone either way. Its `view.commitId` names the moment the claim was made — and `overview().charts` now CARRIES that moment (`commitId`) plus `onPath`, whether it is on the branch you are standing on, so a reader can tell a claim about now from one made somewhere this position never saw. Listed, never hidden; disclosed, never concealed. `adoptPath` skips a chart commit for the matching reason: a proposal is re-proposed, never replayed. |
| the `why` provenance maps (`whyByColumn`, `whyByAnalysisId`) | **not rebuilt — resolved, like the derived registry** | keyed by SLOT and by analysis id, and read through `slotForColumn` / `provenanceForAnalysis`, which resolve at a position. `whyByAnalysisId` used to be a last-wins slot, which is the bug this law names: run `correlation` on two branches and both branches answered with whichever ran last, ledger row and all. It is a list now, and the resolver applies the law `slotForColumn` already stated — the run on your branch, else the only run there has ever been, else no answer. |
| `_head` | **not rebuilt, on purpose** | HEAD is where the walker stands, not what the fold says. `seek` is navigation, not mutation. |
| `refs` / `BranchRefs` | **not rebuilt, on purpose** | refs live beside the log; `seek` detaches HEAD rather than moving a ref. |
| `_currentView` | **not rebuilt, and not derived** | a navigate on a declared view lands no commit at all (pan/zoom is never a data claim), so there is nothing on the trace to rebuild it from. |

**The expiry condition under Law 1 still stands.** Two places there are sound
only because `rebuildFold` cannot throw over records this session's own doors
landed and froze. Nothing in this law touched `rebuildFold`, and every read it
added is either in a judge phase (`proseWorld`, before anything moves) or in a
read-only door (`why`, `charts`); the one write it changed,
`noteAnalysisProvenance`, is a `Map` read plus a `push`, which is the same class
of step the assignment it replaced was. If a door is ever added that lands a
record `rebuildFold` has to *interpret*, that expiry fires exactly as written.

Pinned by `branchScoped.test.ts`.
