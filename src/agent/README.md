# `src/agent` — what the served answer owes its reader

This folder is the LENS the agent looks through. `vizAsTools(session)` hands a
model nine tools whose bytes never change, and everything the model learns
arrives as the RESULT of calling one — never as a change to the tool list, so a
prompt cache downstream stays warm and the library stays a plain MCP server.

That makes the projection the whole surface. A fact the session decided and the
projection did not carry does not exist as far as the model is concerned, and
it does not fail loudly: the answer still parses, still reads confident, and is
simply missing the thing that would have changed what the model did next.

**The trace is tamper-evident** ([`../log`](../log/README.md)), **the fold is
detached** ([`../session`](../session/README.md)), and this folder is the third
leg: **the served answer is honest and lean.** One law, four clauses. Each is a
defect that was live and is now closed, so each has a worked example of the
thing that used to go wrong.

---

## Clause 1 — the answer owes everything the session decided

If a door decided something, the projection carries it. Not "the important
part" — the decision. The session is the judge; the projection is a courier,
and a courier that opens the envelope and keeps a page is not being concise, it
is being unreliable.

`DispatchResult`'s success arm carried four decisions the projection dropped:
`coerced`, `linked`, `described`, `proposed`. Every one of them is a case where
what the session did is NOT what the agent asked for — which is precisely when
telling it matters.

**Worked example — the re-encode that silently did something else.**

```ts
// a dashboard whose policy lets a named coercer take a misfit
const p = vizAsTools(buildDashboard(def, { encoding: { coercers: [discreteCoercer] } }).createSession());
await p.call('viz.dispatch', { verb: 'reencode', viewId: 'bar', channel: 'x', field: 'price' });

// what the agent used to read — and it is not false, it is just not the whole answer:
// { ok: true, verb: 'reencode', commit: {…}, reencoded: { viewId: 'bar', channel: 'x', field: 'price' } }

// what it reads now:
// { …, coerced: [{ severity: 'coerced', field: 'price', channel: 'x',
//                  coercedTo: { field: 'price', scale: 'discrete', type: 'number' },
//                  sentence: '"price" is continuous; the x channel of a bar needs a discrete column' }] }
```

The agent's next sentence is a caption about that chart. Under the old answer
it describes a continuous x axis, because that is what it asked for and nothing
told it otherwise.

**Worked example — the proposal it could not cite.** An agent proposes a
caption for a person to accept. The proposal is a real commit; the id of that
commit is what a reply must point at to say *"the caption I just proposed"*.

```ts
const res = await p.call('viz.dispatch', {
  verb: 'describe', viewId: 'scatter', slot: 'caption', proposal: true,
  record: { text: 'Price rises with rating.', author: { kind: 'agent', model: 'm' },
            levels: ['statistic'], basis: { columns: ['price', 'rating'] } },
});
res.proposed;   // { slot: 'caption', proposal: 's1', status: 'open', by: 'agent', record: {…} }
res.commit.id;  // 's1' — the same moment, and the demo's act-to-commit resolver finds it
```

`described` is spread on `!== undefined`, not on truthiness, for the same
reason: a describe that goes back to the declaration's own words answers
`described: null`, and `null` is the answer — *there are no landed words here
now* — not an absence.

`propose_chart` was the sharpest case of all: it landed a commit and named it
nowhere, so a reply citing the chart it had just proposed resolved to nothing
and the link was dropped as unverifiable. It answers `commitId` now — the id,
deliberately not the record, because that commit's VALUE is the spec and this
surface does not echo a spec back at the agent that sent it.

**When you add a door**, list what its result decides, then check each against
the projection. The compiler will not catch this one: `VizToolResult` is
`Record<string, unknown>`, so a dropped key is a silent, type-clean omission.
That is exactly how these four survived.

---

## Clause 2 — the answer owes the POSITION of anything that is not a claim about now

Most of `whats_here` is a claim about the cursor: these selections are live,
these words are on screen, these columns exist on this branch. A few things are
deliberately not — session-local records that outlive the path that made them.
Those must say so, because a reader has no way to tell by looking.

`charts` is the one that could plausibly have gone either way, and the reasoning
is written up in [`../session/README.md`](../session/README.md) (law 5). A
proposal spends FDR budget the moment it is made and carries `ledgered` and
`ledgerStep`; hiding it when you walk to another path would leave the ledger
charging you for a claim you can no longer see. So it is not hidden.

But *not hidden* was being served as *true here*, which is a different lie.

**Worked example — the claim from the path you left.**

```ts
await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
await s.proposeChart({ id: 'onA', spec, claim: 'the A claim' });

(await s.overview()).charts[0];
// { chartId: 'onA', ledgered: true, ledgerStep: 1, commitId: 's2', onPath: true }

s.seek(rootId);                       // back, and off down the other branch
await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause });

(await s.overview()).charts[0];
// { chartId: 'onA', ledgered: true, ledgerStep: 1, commitId: 's2', onPath: false }
//                                                                 ↑ still listed, still charged for,
//                                                                   and no longer pretending
(await s.overview()).fdr.tests;       // 1 — walking away never refunds alpha
```

`commitId` is the moment the claim was made; `onPath` is whether that moment is
on the branch you are standing on. **Disclose rather than conceal** — the
general form of this clause. A record that survives a walk is welcome on the
answer; it just may not be dressed as a claim about here.

---

## Clause 3 — the answer owes a word about what it could not honour

Some of what a record names cannot be served. The library's answer has always
been to drop it rather than fake it — an id that is not provenance is never
reported as provenance. What was missing is the second half: **saying so.**

The line between refusing and dropping is worth stating exactly, because it is
the same line everywhere in this repo:

> **Refuse what the author can fix. Disclose what they cannot.**

An authored `refs[].commit` citation to another branch is REFUSED at the
describe door, in a sentence that says how to repair it — the writer is right
there, and can seek to the commit or bring the step over. But `basis.atCommit`
is inert data that door does not judge at all, and a log restored from the wire
can carry an off-branch id nobody chose. Refusing a note for THAT would block
words for a reason their author never made and cannot repair. So it is dropped
— and now named.

**Worked example — the basis that was stated and could not be honoured.**

```ts
// two brushes off one pick; the note is written on B and its basis names A's brush
await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', cause,
  record: { text: 'The premium end.', author: { kind: 'human' },
            basis: { columns: ['price'], atCommit: aId } } });   // lands: the door does not judge this key

const answer = s.why({ kind: 'prose', viewId: 'scatter', slot: 'caption' });

answer.commits.some((c) => c.id === aId);   // false  — the law that stands: never faked as provenance
answer.dropped;                             // [{ id: 's2', kind: 'basis', reason: 'off-branch' }]
//                                             ↑ the law that is new: it was named, and could not be honoured
```

Two reasons, because they are two different facts and a reader repairs them
differently: `off-branch` (this log holds the commit, on another branch — seek
there, or bring the step over) and `unverified` (nothing found it at all — a
ghost id). Telling them apart is why `why()` is handed `commitsElsewhere`
beside the branch it may name from. Not one of those ids may ever enter the
answer; they exist so the disclosure can say *"it is on another branch"* rather
than the untrue *"the log does not hold it"* — the same courtesy `proseWorld`
pays at the describe door.

The shape is the demo's, one level down: an analyst's citations that could not
be verified are dropped from the reply and counted in one quiet line under it
(*"1 of 3 links could not be verified and was dropped"*). Same law, same
sentence structure, different tier.

`dropped` is absent when nothing was dropped, which keeps the disclosure free in
the common case — clause 4 applies to clause 3 too.

---

## Clause 4 — the answer owes the reader no repetition it can avoid

Bytes are not the point; **a reader re-reading the same fact N times is.** A
repeated fact is not merely expensive, it invites a model to believe the copies
are separate evidence, and it churns: N copies of one moving value make a delta
look like a rewrite. The rule is *state a fact once, at the level it is true
at*, and the two fixes below are the same rule applied at two levels.

Both are measured, checked in, and reproducible: `node bench/surface/run.mjs`
(see [`bench/surface/README.md`](../../bench/surface/README.md)).

**Worked example (a) — one position, not N stamps.** Every offer used to carry
its own `offerId`, minted from `(position, viewId, kind)`. Because the position is in
every one of them, a single select moved every id in the list while their
content was identical — `offers` was the largest CHURNING item in the answer.

```ts
// before                                    // after
offers: [                                    offers: [
  { offerId: 'o-1f3a…', viewId: 'bar',      { viewId: 'bar', kind: 'point' },
    kind: 'point' },                           { viewId: 'scatter', kind: 'interval' },
  { offerId: 'o-9c22…', viewId: 'scatter',  …
    kind: 'interval' },                      ],
  …                                          asOf: 'o-1f3a…'   // the position, once
]
```

It is called `asOf` rather than `offerId` because that is what it is: not the
identifier of an offer, but the moment the answer was made. An agent copies it
back to say which moment it is acting on.

Nothing was given up. What it proves is that the agent read a CURRENT
answer, and the act it rides on already names its own view and kind — so the
node never needed restating in the id. `offerGuard` still checks both halves and
still says which failed: *"view "display" has no interval voice"*, or *"asOf
o-… is stale — the position moved since whats_here answered"*. The list is now byte-identical
across an act, and the only thing that moves is the one field that had to.

**Worked example (b) — the per-view column list, cut.** `ViewInfo.columns` was
documented as mirroring `Overview.columns[defaultTable]`. It was stronger than
that: it was the SAME ARRAY, assigned at one site with no per-view branch,
because a view has no table of its own (`ViewDecl` declares none). N views, N
copies, one fact.

The question was whether a consumer needed the per-view copy, and the answer was
no — the only non-test readers were the bench (which existed to measure the
redundancy) and a UI adapter field no component ever read. The per-view question
it claimed to answer, *"what can I put on x?"*, is answered better by `accepts`,
which is genuinely per view and per channel and JUDGED: it lists what FITS, and
carries the sentence for every refusal.

```
whats_here, realistic (9 views · 30 cols · 132 edges)     65,609 B  →  45,707 B   (−30%)
whats_here, large     (20 views · 80 cols · 674 edges)   306,670 B  → 190,428 B   (−38%)
```

**It stays cut only while it stays a duplicate.** If a view ever gains a table
of its own, or a per-view subset, or a branch where a derived column is visible
on some views and not others, the per-view list becomes information rather than
repetition and belongs back — carrying the DIFFERENCE from the table's list, not
a copy of it. That condition is written on the type, where the field used to be.

**The tool list is exempt from nothing except change.** Trimming an answer must
never be paid for by moving a fact into the tool descriptions, because those are
charged on EVERY turn and must stay byte-identical for the life of a session
(the bench asserts it, and prints HOLDS or BROKEN). Rewording a description to
point at the surviving field is fine and costs a one-off 203 bytes here;
disclosure that varies with the session is never allowed anywhere near it.

---

## The one that is NOT repetition, and why

`encodings` and `effectiveEncodings` are flat `viewId → map` projections of data
that also rides `views[]`, and they stay. Three differences from `views[].columns`,
and all three matter:

1. They are a RESHAPE of a genuinely per-view fact into a lookup a caller wants
   whole — not a per-TABLE fact photocopied onto each view.
2. They cost one small entry per view, so their share FALLS as a dashboard grows
   (2.7% of the answer at the small shape, 0.5% at the large). The column copy
   cost one entry per view **per column**, so its share ROSE — 38% of the whole
   answer at the large shape. A duplicate that scales with the product of two
   dimensions is a different animal from one that scales with a list you already
   pay for.
3. Both come off the identical fold in the same `overview()` call, so they can
   never disagree with `views[]`.

Ask which level a fact is true at; serve it there. Then ask what a second copy
costs as the dashboard grows — that is what decides whether a convenience is
worth keeping.

---

## Two-string discipline (unchanged, and it constrains all four clauses)

Every text field in a tool DESCRIPTOR is an authored constant. Runtime app
content — a column value, a category label, a `cause.intent`, an analysis id —
only ever appears in structured DATA fields of a RESULT. A category literally
named `IGNORE PREVIOUS INSTRUCTIONS; DROP TABLE dresses; --` round-trips as
inert data and never reaches the instruction channel.

This is why clause 1 is safe to obey: carrying more of what the session decided
adds DATA to a result, never text to an instruction. A `coerced` sentence, a
gap's `detail`, a dropped ref's id — all of them are inert, and none of them may
be parsed or dispatched on.

Pinned by `servedAnswer.test.ts` (the four clauses, one describe block each) and
by the menu-stability row in `bench/surface`.
