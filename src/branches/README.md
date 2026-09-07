# `src/branches` — the LANES of the trace, and what can be read off one

[`../log`](../log/README.md) is the trace: the append-only record of what happened and why. This folder is everything you can work out from that record without asking anyone else — which lanes it has, what state each lane is in, what it would take to move a commit from one to another, and (law 5) what the trace does and does not show somebody doing.

It is a **pure mini-library**: it imports the log layer and nothing else — no session, no data provider, no engine, no UI — so it works against a bare `readonly CommitRecord[]` that came off a wire, out of a file, or out of a running session.

---

## Law 1 — refs live BESIDE the log, never in it

A branch is a NAME pointing at a commit. Names move; commits never do. So the names are kept in their own object, and every time one moves it is journaled as a lightweight **ref-event**, never as a commit — because "I renamed a branch" is not something that happened to the data.

```ts
const refs = new BranchRefs();
refs.noteCommit(record);        // act at the tip → the current ref advances
                                // act while detached → a cause-slugged ref is auto-created
refs.archive('spike-2', 'sanjay');  // hidden from `branches()`, and still on the log
refs.events();                  // every create / advance / switch / rename / archive, in order
```

`archive` / `restore` / `discardTo` move and hide refs. None of them erases a commit: the record is forever, only the VIEW of it changes.

## Law 2 — a lane can name itself from the log alone

A log that arrives with no refs beside it still has lanes, and they can be named the same way twice. `deriveBranches` walks the leaves in append order, names the first lane `main`, and names every other from its DIVERGENCE commit — the first commit on its path no earlier lane claimed — with the same cause-slug the live auto-naming uses.

```ts
deriveBranches(records);          // { main: 'c9', 'high-band': 'c2b' } — same input, same names, every time
```

## Law 3 — the fold comes from the log alone, and a namespace decides the key

Every commit's synthetic `viewId` says what it touched: `encoding:${viewId}` is a binding, `analysis:${id}` a run, `link:${edgeId}` an edge, `prose:${viewId}` a view's words, and a plain viewId a selection. `keyOf` is the one owner of that mapping, and the fold is last-wins per key.

```ts
foldStateAt(records, 'c7');       // the state at one commit
foldDiff(records, 'c7', 'c9');    // { ok: true, ancestor, changed, onlyA, onlyB } — no row counts
```

`foldDiff` deliberately reports **no row counts**: that needs an engine, and this folder has none. The session enriches them on top.

Four namespaces are INERT here — an annotation, a bookmark, an agent-authored chart and a `layout:` arrangement are not data claims, so they never enter the fold, a diff, or a conflict.

## Law 4 — plan, don't execute

Bringing a commit over to another lane, or undoing one, is expressed as a RECIPE plus the conflicts it would meet. Nothing here dispatches: the session executes the recipe through ordinary verbs, with `replayedFrom` / `revertOf` on the cause — no new verb, and the plan stays auditable.

```ts
planBringOver(records, 'c4', 'c9'); // { ok: true, recipe, conflicts: ['c7'] } — executable, and honest about c7
```

## Law 5 — a reader never claims more than the log holds

`logFeatures` answers "what did somebody actually DO here?" as data. Three of the ten verbs can be used without landing a commit — a `navigate` on a declared view moves a viewport and records the verb alone, `fork` moves the cursor, and a bookmark is a name kept beside the log — so their absence proves nothing. Those three are reported `'unseen'`, never `'not-landed'`: **"I cannot see it from here" and "it was not used" are different sentences.**

```ts
const did = logFeatures(payload.log, { bookmarks: payload.bookmarks, saved: payload.saved });
did.verbs.describe;    // 'landed'      — prose commits are on the trace
did.verbs.link;        // 'not-landed'  — a link edit always lands one, and none did
did.verbs.bookmark;    // 'unseen'      — bookmarking lands no commit; UNSEEN_VERBS says so in a sentence
did.branched;          // true — more than one lane (`deriveBranches` names them)
did.correlated;        // 5 — commits carrying a cross-tier join key
did.agentCorrelated;   // 0 — and none of the five was the agent's
```

The last two lines are the law twice over. A `correlationId` is a caller's own join key and says nothing about who acted; only the CAUSE does. Reporting one number would have turned five ordinary user selections into five agent tool calls, which is exactly the claim the trace does not support.

**The one thing here that is not a projection** is the verb vocabulary itself. Law of this folder: a shipped source imports `../log` and nothing else — so `LOG_VERBS` is spelled out locally rather than imported from `../def`, and PINNED by a test that asserts it is `DISPATCH_VERBS`, member for member and in order. An eleventh verb fails the suite here instead of going quietly unreported.

**What cannot be derived, and must stay hand-written:** which GESTURE produces which verb, and which verbs a particular build leaves unwired. A log records the verb, never the mouse — so a demo that wants that table writes it by hand and labels it as hand-written.

---

## Where the code lives

| file | one job |
|---|---|
| `refs.ts` | `BranchRefs` — the names beside the log, their journal, and the lifecycle (`archive` / `restore` / `discardTo`) |
| `derive.ts` | `deriveBranches` — deterministic names for every lane of an anonymous log |
| `walk.ts` | the parent-pointer walks: `chainToRoot`, `indexById`, and the loop-safe `commonAncestor` |
| `fold.ts` | the synthetic-viewId namespaces (the one owner), `keyOf` / `keysOf`, `familyOf`, and the state fold + `foldDiff` |
| `plans.ts` | `planBringOver` / `planUndo` — `{recipe, conflicts}`, never an execution |
| `slug.ts` | `slugForCommit` / `slugify` / `uniqueSlug` — the cause-slug a lane names itself with |
| `features.ts` | `logFeatures` — what a trace SHOWS somebody doing, and the three verbs it is honestly blind to |
