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
of the truth. So this folder is written to a single standard, and the two laws
below are why each mapper looks the way it does.

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

## Adding a field to `SessionViewState` — the checklist

1. **Name the source.** Which session call already answers it? If the answer is
   "none, I'll compute it from `commits`", re-read Law 1.
2. **Both sources, one mapper.** Add it to `SessionLike` (or read it off
   `Overview`) AND to `RawPollState`, and map both through the SAME function.
   A field only one source fills is a field half the cockpit will never see.
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
