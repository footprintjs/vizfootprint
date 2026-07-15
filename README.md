# vizfootprint (pre-alpha, X1'/X2 spikes in progress)

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

Agents get the same power through two fixed tools, `paths` and `compare`, on
the `vizAsTools` port and the MCP server — plus `whats_here` now says which
path you are on.
