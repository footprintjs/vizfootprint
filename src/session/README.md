# session — the interaction session

One session = one person's (or agent's) walk through a dashboard: a commit log of acts (select, filter, describe, link, …), a cursor into it, branches, bookmarks, and the fold that turns the log into what is on screen. Every act lands as a commit with a cause; reads never land anything.

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
deliberately does not do and `adoptPath` deliberately does.

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
