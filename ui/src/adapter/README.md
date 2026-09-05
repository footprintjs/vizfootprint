# `ui/src/adapter` — the PROJECTION

The MAP says what could happen, the TRACE records what did, and the FOLD derives
what is on screen. **This folder turns that fold into the one shape every
component reads** — `SessionViewState` — from either of two sources: an
in-process `SessionLike` (a live vizfootprint session) or a polled `/api/state`
endpoint. Both normalize into the same object, and the components below never
learn which one they got.

Everything the surrounding library claims rests on one property: *what you see
is derived from a recorded trace, and the library is the one that derived it*.
An adapter that recomputes a fact the library already holds does not break that
loudly — nothing crashes; the cockpit simply starts believing a second version
of the truth. So this folder is written to a single standard, and the three
laws below are why each mapper looks the way it does — the third one reaching
past this folder, to the doors the library owes it.

---

## Law 1 — PROJECT what the library serves; never RE-DERIVE it from the log

Every field of `SessionViewState` is one of exactly two things:

1. **a projection** — a record the session already computed (`overview.*`,
   `session.bookmarkViews()`, `session.saved()`, `session.gaps()`), copied field
   for field into a view-model; or
2. **a presentation derivation** — something the session has no opinion about,
   because it is about the SCREEN and not about the data: `isCursor`, `isHead`,
   `onBranch`, `commitLabel`, the layout parse.

There is no third kind. If the library knows a fact, the adapter copies it. If
the adapter computes a fact the library also computes, one of the two is going
to drift, and the one on screen will be the one nobody tested.

### The scar: saved selections, derived from annotations

This law is written down because the adapter broke it, in the most expensive way
available, and did so silently for a long time.

The library holds saved selections in its own store: `SavedSelection` records
with their own ids (`p1`, `p2`, …), a list of `conditions` — saved LOGIC, one
clause per view — who saved it, when, and the data version it was saved on. The
session serves them through `saved()`, `saveSelection`, `renameSaved` and
`applySaved`, and carries them on `Overview.saved`.

`SessionLike` had no door for any of that. So `finalize` computed the list
itself:

```ts
// the OLD adapter — gone
saved: savedSelectionsOf(commits),

export function savedSelectionsOf(commits: readonly CommitView[]): SavedSelectionView[] {
  // …scan the log backwards for `annotation:` commits whose `field` names a
  // selection commit, and call that pair a saved selection
}
```

Four things were wrong at once, and only the fourth was ever visible:

1. **A picture saved through the library was invisible in the cockpit**, and one
   saved through the cockpit was invisible to the library. Two stores, no
   overlap, no error.
2. **Applying one replayed a commit** (`bringOver`) instead of calling
   `applySaved`, so the replace/layer modes and the judge-first-clear-second law
   were simply not on screen. A picture that could land nothing still cleared
   the live filters to make room for it.
3. **The identity was wrong.** A derived picture was identified by the commit it
   was named from. But a saved selection is logic, not a moment: `from` is
   provenance. Renaming meant re-annotating, so a rename could not be free.
4. **Every note that `@`-mentioned a saved selection was refused at save.**
   `mentionWorldOf` mapped a name to a COMMIT id; `src/prose/validate.ts` judges
   a `saved` ref against the set of ids the STORE holds — which the cockpit never
   wrote to, so the set was always empty and the sentence was always
   *"points at a saved selection that does not exist"*. The feature was dead, and
   the derivation is why.

The fix is the law: `SessionLike` gained the four real doors, `mapSaved`
projects the store, `SavedSelectionView` carries the store's `id`, and
`savedSelectionsOf` was deleted outright — no fallback, no alias. There is one
place a saved selection can come from now, and it is the place that mints them.

```ts
// the adapter today — a projection, and nothing else
saved: mapSaved(session.saved()),   // in-process
saved: mapSaved(raw.saved),         // polled: the same records, off the wire
```

**How to tell you are about to break this law.** You are writing a `…Of(commits)`
function. Stop and ask which library call already answers it. If one does, put
it on `SessionLike` (and on `RawPollState`, and in the server's `/api/state`) and
copy the answer across. If none does, the fact belongs in the library, not here
— describe it and let the library grow the door.

---

## Law 2 — an ACT is a door or a dispatch, and the difference is not cosmetic

Most cockpit actions ride `dispatch({ verb, … })`, and that is the default: one
gesture, one cause-tagged commit. But some library acts are **not** dispatch
verbs, and routing them through one is how the annotation scar started (`save
this picture` became `annotate that commit` because `annotate` was a verb and
`saveSelection` was not reachable).

The test is what lands on the trace:

| the act | lands | how the adapter drives it |
|---|---|---|
| select, filter, describe, link, navigate, … | ONE commit | `dispatch(…)` |
| naming / renaming a picture, bookmarking | NOTHING (a store record) | its own door / endpoint |
| applying a picture | SEVERAL commits, one cause | `applySaved` — never a replay |

A door has no verb, so it needs its own poll endpoint (`/api/saved`, the
`seek`/`bookmark`/`paths` pattern) and its own entry in `PollEndpoints`. Both
halves must be added together, or the in-process cockpit works and the demo's
polled one silently no-ops — which has happened here before (the bookmark
composer, found only by dogfooding).

### An answer is projected too — including a refusal

The library's refusals are sentences written for a person. The adapter passes
them through and never rewrites them:

```ts
await view.applySaved('p1');
// { ok: false, sentence: '"coastal" cannot be applied here —
//   table "data" no longer has the column "no_such_column"' }
```

And an `ok: true` may still carry refusals — an apply is honest **per
condition**, so a picture that half-lands says which half did not:

```ts
await view.applySaved('p2');
// { ok: true, name: 'the pair', applied: 1, cleared: 2,
//   refused: [{ viewId: 'heat', rejected: '"heat" is no longer on the dashboard' }] }
```

A surface that renders only the failure arm hides that, which is why `refused`
sits on the success arm where it is hard to miss. When a door answers with no
words at all, the adapter says exactly that (`"the apply was refused and the
session gave no reason"`) rather than inventing a reason it was not given.

---

## Law 3 — when a consumer has written a helper the library should have given it, the fix is the DOOR, not the helper

Law 1 is about a fact the library already holds and the adapter recomputed.
This is its sibling, one step further out: a fact the library holds and gives
**no way to ask for**, so the consumer writes a small helper of its own. That
helper is not the mistake. The mistake is leaving it there, because a helper
outside the library is a second implementation of a library rule — and the
second implementation is the one nobody tests, nobody versions, and nobody
tells when the rule changes.

The tell is the same one Law 1 uses, asked one level up. Law 1: *which library
call already answers this?* Law 3: *if none does, why not?* If the answer is
"the library knows this and simply has no door for it", the fix is the door.
Writing the helper instead is a decision to keep the rule in two places
forever, made silently, by whoever was in a hurry.

### The scar: two bookmark resolvers that had already drifted

A bookmark names a moment. Which commit is that? There are two fields, and for
a legacy `bookmark:` commit from an older log they are **different commits**:
`commitId` is the act of naming and `at` is the moment named.

The UI had the answer, for a record: `bookmarkTarget(c)` = `at ?? commitId`.
What it did not have was a way to go from a REF — the id a note's
`@[bookmark]` link carries — to that moment. So the demo wrote one:

```ts
// the demo's own resolver — gone
export function bookmarkCommitId(bookmarks, ref) {
  const bookmark = bookmarks.find((c) => c.id === ref) ?? bookmarks.find((c) => c.label === ref);
  return bookmark?.commitId ?? null;   //  ← commitId, not `at ?? commitId`
}
```

One character of drift, and the dashboard now seeks **two different commits for
one bookmark**: the slideshow's prev/next went to the moment named, every note
anchor and every prose link went to the act of naming. Both worked. Neither
threw. On this demo's data the two fields happen to be equal, so nothing was
visibly wrong — the bug was already written and was waiting for the first
legacy log to arrive.

Notice what the drift was NOT: nobody re-derived a fact from the log, nobody
recomputed a fold. Law 1 was obeyed. The rule that broke was one the library
knew and had not exported, so the copy that mattered lived somewhere the
library's tests could not see it.

```ts
// the door, in ui/src/time/presentBookmark.ts, beside the record resolver it calls
bookmarkRefTarget(state.bookmarks, ref);   // id first, then label; null when nothing matches
```

`bookmarkTarget` — the one owner of `at ?? commitId` — is now called by the
ref resolver rather than restated beside it, and the two are exported from the
same barrel, so the next consumer reaches the door before it reaches for a
`find`.

### The same shape, three more times in one packet

Each is the same story with a different door, and they are listed because the
pattern is what you are meant to recognise, not the individual fix:

| the helper a consumer wrote | why it existed | the door |
|---|---|---|
| the demo's `landedBy` / `actLabel`, walking four result shapes for "what id did this act land" — **twice, and the two disagreed about a refusal** | `VizToolResult` is `Record<string, unknown>`, so there was nothing to read a field off | `whatLanded(result)`, plus real types for the act results (`vizfootprint/agent`) |
| three demo reads of `session.log.records`, and `readonly log: { records }` baked into `SessionLike` itself | the session served the raw trace and no scoped list | `session.commits('path' \| 'anywhere')` — the scope is REQUIRED, so the signature says which question was asked |
| the demo's `filtersHere`, restating which link response NARROWS a view | `keepPredicate` folded by that rule and never exported it | `filtersHere` (`contract/selection.ts`), which `keepPredicate` now calls |
| the demo's `storyDroppedNote`, turning a section's `dropped` rows into the one quiet line a reader sees | `toStory` carried the rows and named no sentence for them, so the first surface to show them wrote one | `storyDroppedNote` (`vizfootprint-ui/story`), beside the rows it reads — moved the day a SECOND surface (the story stage) needed the same words, which is the moment a helper stops being a local convenience |
| the demo's story capture, stamping `by: 'user'` and `new Date()` onto every bookmark it carried — and printing a note on the page saying it vouched for neither | `bookmarkViews()` served the id, the label and the moment and dropped the store's CREATION stamp, which is exactly what `restoreBookmarks` requires | `by` and `madeAt` on `BookmarkView`, at both ends. The consumer stopped stamping, and the page's front matter has nothing to confess — the note was the honest report of a door that had not been finished, not a fix for it |
| a story stage about to ask `state.commits` "does this session hold that commit?" before every seek | `SessionView.seek` returned `Promise<void>`: the session's own `SeekResult` — judged before anything moved, with its sentence — was read and dropped on the floor here | `seek` ANSWERS now, over both sources, with the same `{ ok } \| { ok, sentence }` every other gesture speaks. The consumer stopped judging and started printing what the session said |

The last row is worth reading as the general shape, because the helper had not
been written yet: the consumer was about to re-derive *reachability* from the
commit list, and the library already knew the answer and was throwing it away.
**A door that discards its own answer is a door that has not been finished** —
the next consumer will compute that answer again, less well, somewhere the
library's tests cannot see it. The fix is never a check on the consumer's side;
it is the door saying what it did.

**How to tell you are about to break this law.** You are in a consumer, about
to write a function whose body encodes a rule the library states in prose — a
fallback order, which field wins, what a response means. Stop and ask whether
the library could hand you the answer. If it could and does not, describe the
door and let the library grow it; the helper you were about to write IS the
door, in the wrong repository.

---

## Adding a field to `SessionViewState` — the checklist

1. **Name the source.** Which session call already answers it? If the answer is
   "none, I'll compute it from `commits`", re-read Law 1.
2. **Both sources, one mapper.** Add it to `SessionLike` (or read it off
   `Overview`) AND to `RawPollState`, and map both through the SAME function.
   A field only one source fills is a field half the cockpit will never see.
   The commit rows themselves were the exception that proved it: `mapSession`
   and `mapPolled` each built `rawCommits` inline, byte for byte the same, so
   a new field on a commit had to be remembered twice. They share `mapCommits`
   now, and the in-process side reaches its records through
   `session.commits('anywhere')` rather than the raw log (Law 3).
3. **Server side too.** A polled field that no server serializes is absent
   forever. `/api/state` in the demo is the reference implementation.
4. **Required, not optional.** `saved?:` invited a `?? []` fallback in three
   callers and hid the empty list behind "an older wire". Both mappers set every
   field, so the type should say so.
5. **Test from the user's side.** `saved.integration.test.ts` is the pattern: a
   real dashboard, a real session, the store on top — "a picture saved through
   the library is on screen", "a rename keeps a note's link working". A test that
   asserts against a hand-built `RawPollState` proves the mapper; only a test
   over a real session proves the two ends agree.
