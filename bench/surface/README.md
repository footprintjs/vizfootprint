# bench/surface — what the agent surface costs, in bytes

The cost of vizfootprint's agent surface has been quoted from one-off
measurements an agent took in a chat. This bench turns those numbers into
something checked in, reproducible, and honest about its own units.

    node bench/surface/run.mjs [outDir]            # bytes (the default)
    node bench/surface/run.mjs [outDir] --tokens   # + the optional real-token pass
    npm run bench:surface

Writes `surface-results.json` (every number, plus node version and platform)
and `surface-table.md` (the tables). The esbuild bundle is a build artefact and
is deleted on success; it is left behind when the child fails, so a failure
stays debuggable.

- `shapes.ts` — the parameterised `DashboardDef` generator: views, table
  columns, DECLARED link edges, analyses, prose slots in use. Three named
  shapes — `SMALL`, `REALISTIC` (nine views over a thirty-column table with a
  dense link graph) and `LARGE` — so the bench shows how cost SCALES rather
  than reporting one number. Nothing here hand-writes an answer: the def goes
  through the real `buildDashboard` door, and the numbers come out of a real
  `createSession()` + `vizAsTools(session)` — the same surface a host serves.
- `surface-entry.ts` — the measurements. Bundled by `run.mjs` and run under
  plain Node, like `bench/step0`.
- `run.mjs` — bundle + spawn + tables.

Node only. **Never edits `src/`** — it only reads it, which is why a number
here moves when the library moves.

## Units — the whole point of the exercise

**Bytes are the checked-in unit.** Every number in `surface-table.md` and
`surface-results.json` is a count of UTF-8 bytes of a JSON serialization
(`Buffer.byteLength`, not `String.length` — the tool descriptions are full of
em dashes and the link-edge ids carry a `→`, so `String.length` under-reports
this surface by roughly half a percent). Bytes are exact and need no network.

**Tokens are a different thing, and this bench never estimates them.** There is
no divide-by-four here, no GPT tokenizer, and no column called "tokens" that
did not come from a real Claude tokenizer. `--tokens` adds an OPTIONAL pass
(off by default) that calls Anthropic's real `/v1/messages/count_tokens`
endpoint when `@anthropic-ai/sdk` is importable and `ANTHROPIC_API_KEY` (or
`ANTHROPIC_AUTH_TOKEN`) is in the environment. If either is missing it prints
one line saying tokens were not counted and why, and carries on with bytes. No
`.env` file is ever read, and no key ever reaches an output file.

**A bytes-to-tokens ratio must never be assumed.** The token pass reports a
bytes-per-token column for the content it actually measured; that ratio is a
property of *that* content at *that* model, and quoting it as a constant for
this surface would be exactly the mistake this bench exists to stop.

**Every row carries its shape.** A byte count without the shape it was measured
at is meaningless. Shapes are written `9v/30c/132e` — views / table columns /
materialized link edges — and the shape columns report what the def actually
produced, not what was requested.

## The five measurements

**1 · menu** — `JSON.stringify(tools())`: the fixed cost paid on every turn,
with the per-tool breakdown split into description bytes and schema bytes.
`vizAsTools`'s docstring says the tool array never changes for the life of a
session. That is a claim, so the bench checks it: the menu is serialized at all
three shapes and again after a session has performed a select, a filter, a
reencode and a bookmark. The table prints **HOLDS** or **BROKEN**. If it ever
reads BROKEN, that is a defect worth knowing about — a shape-dependent or
act-dependent tool list breaks every prompt cache downstream.

**2 · whats_here** — `JSON.stringify(await call('viz.whats_here'))` at each
shape, and its ratio to the menu.

**3 · composition** — where those bytes go. The byte share of every top-level
key, computed by **serializing each subtree**, never by guessing: an entry's
bytes are its quoted key plus the colon plus its serialized value, and the
table prints the unattributed residual (the object's own braces and commas) so
the split is provably complete rather than plausibly complete. Section 3b goes
one level deeper into the two keys that carry the answer, `views` and `links`,
by the same method.

**4 · churn** — serialize `whats_here`, perform ONE ordinary act through
`viz.dispatch`, serialize again, and report what fraction is unchanged. Three
acts (a select, a filter, a reencode), each from a **fresh session**, so one
act's churn is never compounded with another's. Two numbers, because they
answer different questions:

- *unchanged (top-level keys)* — bytes in top-level keys whose whole subtree
  serialized identically. This is what a coarse key-level delta would save.
- *unchanged (deep)* — bytes unchanged at any depth, compared structurally:
  identical subtrees count whole, objects are compared key by key, arrays
  position by position (a shifted list is honestly reported as changed,
  because to a cache it is). The measure is deliberately conservative —
  braces, brackets and commas are never counted as stable, only quoted keys,
  colons and values — so the fraction is a floor on how much is really
  unchanged, never a flattering ceiling.

The reencode row is where the two diverge, and that divergence is the finding:
a rebind moves a handful of bytes inside `views`, but `views` is the majority
of the answer, so a key-level delta saves almost nothing while a structural one
saves nearly everything.

**5 · floor** — the smallest subset of the answer that still supports a first
correct act. **This is a judgement, and the reader must be able to disagree**,
so here is exactly what was counted:

- **floor (strict)** = the default table, the dispatch verbs, and per view its
  `viewId`, `canProbe`, `selectionKinds` and the field names it carries. That
  is enough to name a view, name a column on it, and choose a verb. It repeats
  the field list per view — which is what the answer USED to do.
- **floor (shared column list)** = the same facts with the column names stated
  **once**. A view has no table of its own, so `views[].columns` was redundancy
  rather than information — it was the same ARRAY as `Overview.columns[defaultTable]`,
  written at one site with no per-view branch. **This is now what ships**: the
  answer states the columns once, and `views[].accepts` answers the per-view
  question (which of them FIT this channel) properly. `strict` is kept beside it
  as the price that used to be paid; the gap between the two columns is what
  cutting the copy was worth. That cut is most of why the whole answer fell from
  65,609 to 45,707 bytes at the realistic shape and from 306,670 to 190,428 at
  the large one.
- **verbs alone** is broken out because a host already has the verb list in the
  menu's `dispatch` schema enum. An answer that omitted the verbs would lose
  nothing — subtract that column if you think the floor should not pay for
  them twice.

What the floor deliberately does **not** include: the link graph, the encoding
plane's `accepts` and `rules`, the prose, the analyses and their readiness, the
FDR ledger, the paths and the offers. Every one of those is needed for some
*second* act, or for acting *well*; none is needed to act *correctly once*. If
you think a first correct act requires knowing that a channel is followed
before you try to rebind it, then the encoding plane belongs in the floor and
the number should be larger — the code is one function (`floorOf`), and it is
meant to be edited.
