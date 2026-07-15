# The foottrail core

vizfootprint's provenance heart — `src/cause/`, `src/log/`, `src/branches/` —
is a standalone pattern for recording an exploration with no pre-drawn plan.
It already lives behind an enforced import boundary. Its future package name
is **foottrail** (npm-verified free, including `foottrail-js` and
`@foottrail/core`, as of 2026-07-16). This document names the pattern and
draws the line around it, so the day a second real consumer shows up, the
extraction is a lift-and-shift, not a redesign.

## The naming story

footprintjs records executions of a pre-drawn plan. You build a flowchart
first, then run it — the plan exists before the run, so one run is linear:
start, a sequence of stages, finish. Its log is an array. That's a
**footprint**: one mark, left by a run that already knew where it was going.

foottrail records something that has no pre-drawn plan: a person, or an
agent, exploring. There's no chart to execute — you try something, look at
the result, go back, and try something else. That history isn't a line: it
forks every time someone goes back and steps a different way. The record
can't be an array, because it has to hold every lane, not just the one you're
standing on right now. So the record IS the map, drawn by walking — a tree.
A footprint is one mark on the ground. A **foottrail** is the branching
record of everywhere the feet went, including the paths not taken.

The two logs stay connected without merging: a first-class `correlationId`
field threads a foottrail commit to the footprintjs run that caused or
consumed it, resolved at the `why()` tier (`src/why/why.ts:31`,
`src/why/resolvers.ts:37-54`) — a join, never a merge. Neither log needs to
know the other's shape.

## The pieces

### `src/cause/` — the two-slot tag (fully generic)

`Cause` (`src/cause/cause.ts:25`) is the smallest honest unit of "who asked
for this, and who computed it": `requestedBy` and `computedBy` are
independent `Actor` slots (`'user' | 'agent' | 'system'`,
`src/cause/cause.ts:15`) — a user can request something an agent computes.
`parseCause`/`validateCause` (`:91`, `:159`) rebuild a `Cause` from scratch
field-by-field, so no extra key, getter, or prototype-pollution payload
survives validation. `markReplayed` (`:174`) is the one mutation the type
allows: it adds `replayed: true` without touching either slot — replay is a
mode, never a rewrite of who-did-what.

### `src/log/` — the frozen parent-linked spine

`CommitRecord` (`src/log/log.ts:40`) is one interaction: `id`, `parent`
(`string | null` — `null` marks a root, enabling branching), an optional
`correlationId` (the cross-tier join key, `:55`), a `Cause`, and a payload.
`CauseSelectionSession.commit()` (`:113`) is the only way to add a record —
it always appends (`this.records.push`, `:152`) and always freezes
(`Object.freeze(record)`, `:151`) before appending, so even a caller holding
a live reference cannot rewrite history under the log's feet. There is no
delete/edit API, by construction, not by convention. `replayLog` (`:179`)
rebuilds a fresh session by re-committing a path of ids through the same
`commit()` — live authoring and replay are the same code path, so their
behavior can't diverge.

The generic spine here is `{id, parent, correlationId, cause, ts}`. The
current `CommitRecord` also carries Mosaic-selection fields (`viewId`,
`kind: 'point' | 'interval'`, `field`, `value`, `predicateSQL`,
`clientViewIds`) — vizfootprint's own payload. That coupling is called out
explicitly below (see "What it deliberately is NOT").

### `src/branches/` — refs beside the log, plus a worked example on top

Two things live in this one folder, and they are not the same kind of code.

**Generic — reusable against any `{id, parent, cause}` log:**
- `BranchRefs` (`src/branches/refs.ts:32`) — named refs (`{name → tip}`) +
  `HEAD`, journaled beside the log. `noteCommit` (`:92`) is the whole rule:
  landing on a branch's tip advances that ref; landing while `HEAD` is
  detached (the cursor travelled into the past) auto-creates a new ref,
  named from the commit's own cause — branch-on-act, now named. Every
  create/advance/switch/rename is a frozen `RefEvent` (`:76-78`), never a
  commit — bookkeeping is auditable without touching the log.
- `deriveBranches` (`src/branches/derive.ts:25`) — names every lane of a
  *pre-existing* anonymous log deterministically (same log in → same names
  out, every time), so a log authored before naming existed still gets
  stable branch names.
- `commonAncestor` / `lcaOf` (`src/branches/walk.ts:53`, `:40`) — loop-safe
  LCA over raw parent pointers; `chainToRoot` (`:21`) stops at a missing id
  instead of spinning, because this layer accepts hand-carried or legacy
  arrays, not just its own trusted log.
- `slugForCommit` (`src/branches/slug.ts:32`) — the one naming rule both
  `BranchRefs` and `deriveBranches` share: prefer the commit's own
  `cause.intent`, else `field-value`, else `field`, else `'path'`. Same
  input, same slug, everywhere.

**Domain-specific — a worked example, not something a second consumer would
import as-is:**
- `foldStateAt` / `foldDiff` (`src/branches/fold.ts:66`, `:124`) — replay a
  tip's root-to-tip path into a last-wins state map, then diff two tips.
  `keyOf` (`:44`) hardcodes vizfootprint's own key-space (`selection:`,
  `encoding:`, `analysis:` prefixes) — this is genuinely a *pattern*
  (derive current state purely by folding the log, never mutate a parallel
  store), but the key-space itself is viz-shaped.
- `planBringOver` / `planUndo` (`src/branches/plans.ts:106`, `:124`) — plan,
  don't execute: read the log, return `{recipe, conflicts}`, touch nothing.
  A conflict is "the same state key changed on the target path since the
  LCA" — named, not swallowed; the plan stays executable and the caller
  decides. The recipe vocabulary (`apply: 'selection' | 'encoding' | …`)
  is vizfootprint's own dispatch verbs.

### The import-purity test

`src/branches/branches.test.ts:57-69` is a structural test, not a unit test:
it reads every non-test source file in `src/branches/`, regexes out every
`from '...'` specifier, and asserts every relative `../` import targets
`../log/` — nothing from `src/session`, `src/mosaic`, `src/agent`, or any UI
layer. It fails the moment someone reaches for a session helper from inside
`branches/`. This is the boundary the extraction rides on: it's already
proven, not merely believed.

## What it gives any app

- **Mixed-principal provenance** — every change carries who *asked* and who
  *computed*, independently, from the first commit. Not bolted on later.
- **Branch-on-act** — going back in history and acting again doesn't need an
  explicit "new branch" command; the log itself declares the fork, and the
  fork gets a name for free from the cause that created it.
- **Fold, never a parallel mutable store** — "what's true right now" is
  always the log replayed to a tip. There is no second place state can drift
  out of sync with the log, because there is no second place.
- **Compare / LCA** — two tips can be diffed structurally (which keys
  changed, which exist only on one side) purely from the log, no engine
  required; vizfootprint's own `session.compare()` (`src/session/session.ts:586`)
  is exactly `foldDiff` plus row counts bolted on top.
- **Bring-over / undo as new commits, never a rollback** — cherry-picking or
  reverting a step lands as an ordinary new commit whose cause records the
  story (`replayedFrom` / `revertOf`, plus any `conflicts`). Nothing is
  edited in place; the record of "I changed my mind" is itself permanent.
- **Checkpoints for free once you're append-only** — vizfootprint's own
  `checkpoints()` (`src/session/session.ts:1156-1160`) is nothing more than
  a frozen `{label, commitId, ts}` pushed onto a list — the append-and-freeze
  discipline the core establishes makes a consumer's own bookkeeping this
  thin.
- **Honest gaps, not silent no-ops** — an unknown commit id, an unbring-overable
  analysis, an unnamed branch: every one of these returns a typed, explained
  failure (`{ok: false, reason, detail}`), never a swallowed exception or a
  quiet default.

## What it deliberately is NOT

- **Not a chart or rendering layer.** Nothing here knows what a bar looks
  like. That's `ui/` and the `bridges/` packages, layered above.
- **Not Mosaic-coupled by necessity, but Mosaic-coupled today.** `src/branches`
  is import-pure (the structural test proves it: zero runtime dependency on
  Mosaic, session, or UI code). But `CommitRecord`'s *wire shape*
  (`viewId`/`kind`/`field`/`value`/`predicateSQL`) and `src/branches/fold.ts`'s
  key-space are Mosaic-selection-flavored. `refs.ts` / `derive.ts` /
  `walk.ts` / `slug.ts` are genuinely payload-agnostic today; `fold.ts` /
  `plans.ts` are a worked example a second consumer would re-derive over its
  own payload, not import unmodified. Extracting to a package means
  genericizing the payload (`{id, parent, correlationId, cause, ts, payload:
  T}`), not rewriting the tree logic.
- **Not the FDR ledger.** Declared analyses spending alpha budget is a
  vizfootprint-specific tier (`src/fdr/`) built on top of the log; the core
  has no concept of a hypothesis.
- **Not an agent framework.** The `correlationId` join to an agent tool-call
  frame (`src/why/`) is a consumer, not a dependency — the core never
  imports agentfootprint or anything agent-shaped.
- **Not state rollback.** There is no operation anywhere in this pattern
  that deletes or rewrites a committed record. Undo is a new commit that
  happens to restore an old value; the undone commit is still right there
  in the log, forever.

## Honesty invariants

- **Append-only, enforced by construction, not convention.** The only write
  path is `commit()`; it only ever pushes; every record is frozen the
  instant it's built. There is no code path anywhere that mutates a landed
  `CommitRecord`.
- **Refs move, records never do.** `BranchRefs` changes which id a name
  points at; it never touches a `CommitRecord`. The frozen log and the
  movable refs are two different mutability regimes on purpose — conflating
  them is the one thing this pattern refuses to do.
- **View-state is never a data claim.** A layout arrangement (`layout:${scope}`,
  `LAYOUT_VIEW_PREFIX` in `src/branches/fold.ts:41`) or a chart proposal's
  registration (`CHART_VIEW_PREFIX`, `:33`) folds as **inert** — it rides
  the same log for replay/seek, but it never enters `foldDiff`'s changed
  keys or a bring-over's conflict set. Where something rendered and what
  the data actually says are kept honestly separate, all the way down to
  the key-space.
- **Replay is additive, never destructive.** `markReplayed` only ever adds
  `replayed: true`; `requestedBy`/`computedBy` are frozen at authorship
  forever, even under replay.

## Candidate second consumers

No package ships yet — see the extraction rule below — but two threads
already look like a real second use of the same pattern, not a coincidence:

- **hcifootprint branchable sessions** — an agent's skill-graph navigation
  session going back to an earlier decision point and trying a different
  tool path is structurally the same "explorations leave trails" shape as
  vizfootprint's own act-while-detached branch-on-act.
- **gameFootprint replay trees** — Number Rain's seed+gestures replay today
  is linear (one seed, one deterministic run); a tree of replay branches
  (try the run again from checkpoint N with different input) is the same
  frozen-parent-linked-commit shape this core already proves out.

Neither is built. Both are named here so the next person who reaches for
"I need branch-on-act provenance" in either repo checks here first instead
of re-deriving `BranchRefs` from scratch.

## The extraction rule

This ships as a package only when a second real consumer exists — not when
it *could* be reused, when it *is*. vizfootprint already has the precedent
for this discipline: `docs/proposals/renderer-protocol.md` (D27) rejected a
public conformance badge for the renderer contract because a badge without a
second, non-author implementer certifies an already-competitive market
instead of creating one. The same logic applies here in reverse: a package
without a second consumer is a promise, not a proof. Until then, the pattern
stays exactly where it is — proven by the import-purity test, documented
here, and one lift away from a package the moment hcifootprint or
gameFootprint (or anyone else) actually needs it.
