# vizfootprint (pre-alpha, X1'/X2 spikes in progress)

## Importing it

The library is `private` and always will be, but it is importable by name.
`npm run build` emits `dist/`, and fifteen doors are declared in `package.json`'s
`exports` map — `vizfootprint` (the L5 entry) plus `/agent`, `/def`, `/session`,
`/analysis`, `/source`, `/source/file`, `/data`, `/cause`, `/mosaic`, `/prose`,
`/log`, `/branches`, `/renderer` and `/mcp`.

```ts
import { buildDashboard, vizAsTools } from 'vizfootprint';
import { fileSource } from 'vizfootprint/source/file';   // the node carrier, off the browser barrel
```

A relative path into `src/` is not a door and stops resolving the moment it
crosses out of this package. Which symbol belongs on a barrel, which earns a
subpath, and why the two resolutions (`dist/` outside, `src/` in a test run) are
one list twice: [`PACKAGING.md`](PACKAGING.md).

## The foottrail core

Underneath the branching paths below sits a small, standalone pattern:
`src/cause/` (who requested a change vs. who computed it), `src/log/` (a
frozen, append-only, parent-linked commit log — never edited, only grown),
and `src/branches/` (named refs beside that log, proven import-pure by a
structural test). footprintjs records a run of a pre-drawn plan, so its log
is a straight line; this records an exploration with no pre-drawn plan, so
its log is a tree — a branching record of everywhere you went, not just
where you ended up. Its future package name is **foottrail**. Read
[`docs/foottrail.md`](docs/foottrail.md) for the full pattern, what it
deliberately leaves out, and the rule for when it becomes its own package.

## The interaction grammar — four planes, one shape

Everything a person or an agent does to a dashboard is declared as data on the def, judged by one validator behind three doors (build throws, dispatch refuses with a sentence, lint lists), and landed as a commit with a cause. Four planes share that shape: the **data** plane (`src/links`: what one view's selection does to another, and one chart following another's bindings), the **encoding** plane (`src/encoding`: which column may sit on which channel), the **prose** plane (`src/prose`: a view's words with an author, a level of claim and a basis), and the arrangement plane (the layout acts). Each folder has a small README with an example.

## Named paths over your analysis history

Every interaction lands as a commit in an append-only log, so your analysis
history is already a tree: go back and try something else, and a new lane
starts — nothing is ever rewritten or lost.

The `branches` layer gives those lanes names, git-style:

- Work normally and you stay on `main`. Travel back and act, and the new lane
  names itself from your stated intent — say "premium focus" and you get a
  path called `premium-focus`.
- `paths()` lists every path; `switchPath('main')` jumps back to one by name;
  `renamePath` and `newPathAt` manage them. Every piece of bookkeeping is
  journaled, so even branch management is auditable.
- `compare('main', 'premium-focus')` tells you exactly how two paths differ:
  which selections, visual encodings, and analyses changed or exist on only
  one side — with real row counts for each side.
- `bringOver(commitId)` copies one step from another path onto yours;
  `undo(commitId)` reverts one step by restoring what its parent had. Both
  land as ordinary commits whose cause records the story (`replayedFrom` /
  `revertOf`, plus any conflicts) — nothing hidden, and a test that already
  spent alpha is never silently refunded.
- Logs from before naming existed? `deriveBranches(records)` names every lane
  deterministically — the same log always gets the same names.

## Tidying up without erasing anything

Exploring makes dead ends. You can put them away — the record never shrinks:

- `archivePath('premium-focus')` hides a path from the listing while keeping its
  name, its last step, and every commit on it. `restorePath` is the exact
  inverse. An archived path is *frozen*: it can't be switched to, renamed, or
  extended (each says "restore it first"), your only path can't be archived, and
  the path you are standing on detaches HEAD when you hide it — so the next thing
  you do starts a fresh named path instead of quietly re-opening what you put away.
- `discardFromHere()` drops everything after where you are on your own path —
  and keeps the abandoned part as an archived path you can restore. One
  transaction in the branch journal, zero deletions: the old last step still
  folds to exactly the same state.
- `adoptPath('premium-focus')` replays another path's steps onto yours since the
  common ancestor, in order, each as an ordinary commit that records what it
  replayed. Conflicts are noted per step, steps that genuinely cannot be replayed
  are skipped with a reason, and the other path is left untouched.

The rule these all obey, stated in the tools and on screen in the same words:
**hidden, not erased — the statistics remember.** Archiving or rewinding never
refunds alpha, never lowers the test count, and never removes a ledger row —
`compare()` and `why()` still answer about a hidden path, and the online-FDR
ledger reads exactly the same before and after.

Agents get the same power through two fixed tools, `paths` and `compare`, on
the `vizAsTools` port and the MCP server — plus `whats_here` now says which
path you are on and how many paths are archived.
