# PACKAGING — the doors

The MAP says what could happen, the TRACE records what did, and the FOLD derives
what is on screen. **This file is about none of that. It is about who is allowed
to reach in, and through which opening.**

Until now nothing outside this checkout could import this library by name. It
was `private: true` at version `0.0.0` with no `main`, no `types`, no `exports`
and no build, so the only way in was a relative path into TypeScript source —
and the demo used eleven of them while declaring no dependency on the library at
all. That is not a small inconvenience. A relative path into `src/` is an
import of a *file*, and a file is not a promise: it can move, split, or become
two files, and the importer only finds out when it breaks. Worse, it makes the
library's shape invisible — nobody could say what the public surface was,
because there was no place where it was written down.

Now there is. `package.json`'s `exports` map is that place, and this file is the
law that governs it.

**The package stays `private: true`.** Private is not the opposite of
importable. A private package can carry a complete `exports` map and be consumed
locally by name — which is exactly what this is — and nothing here is a step
towards publishing.

---

## Law 1 — the doors are a list, and the list is the whole surface

Fifteen subpaths, and nothing else:

| door | what it is |
|---|---|
| `vizfootprint` | the same module as `/agent`. The L5 entry declares itself "the one L5 entry" and re-exports the declare + connect halves, so the root is that barrel rather than a second list that could drift from it |
| `vizfootprint/agent` | L5 — `buildDashboard` → `createSession` → `vizAsTools` |
| `vizfootprint/def` | the `DashboardDef` schema and its validator; re-exports the links and encoding planes and the source layer beside the def that declares them |
| `vizfootprint/session` | the interaction session: dispatch, cursor, branches, folds |
| `vizfootprint/analysis` | the declared analyses |
| `vizfootprint/source` | the data-source layer: formats, vias, the adapter port, the inline carrier |
| `vizfootprint/source/file` | **the one non-barrel door** — see Law 3 |
| `vizfootprint/data` | the query port, the clause predicate, the one-pass recorders, CSV |
| `vizfootprint/cause` | `Cause`, `Actor`, and the cause gate |
| `vizfootprint/mosaic` | the Mosaic seam: `ChartEmission`, `ActorMeta`, the source registry |
| `vizfootprint/prose` | mentions, refs, prose slots |
| `vizfootprint/log` | the TRACE: `CommitRecord`, the append-only log, the parser |
| `vizfootprint/branches` | git-style named branching over the log |
| `vizfootprint/renderer` | the runtime-free chart-spec shape gate |
| `vizfootprint/mcp` | the MCP server — the ONLY place the optional SDK peer is imported |
| `vizfootprint/package.json` | the convention |

`vizfootprint/mcp` is the one door nothing imports yet. It is open anyway, and
on purpose: it is where the optional `@modelcontextprotocol/sdk` peer lives, and
keeping it a door is what keeps that peer out of every other entry.

**`src/detach`, `src/encoding`, `src/fdr`, `src/links` and `src/why` have
barrels and are not doors.** Nothing outside this package imports them (the
encoding and links planes are reachable through `/def`, which re-exports them
beside the def that declares them). They are not closed on principle — they are
closed because Law 2 says a door is opened by an importer, and none has asked.

### Why there is no `/fdr` door

Because FDR is not one surface. It is two halves of two surfaces that already
exist, and the split is a line this library draws everywhere else:

| you are… | the symbol | the door |
|---|---|---|
| DECLARING the correction | `FdrDecl`, `FdrStepper`, `createLordPlusPlus` | `vizfootprint/def` |
| OBSERVING what it produced | `FdrSummary`, `FdrStep` | `vizfootprint/session` |

You choose a stepper when you declare a dashboard, so the builtin ships beside
the declaration that names it and the interface it satisfies. You read the rows
while the session walks, so the row ships beside the summary it rows up to —
`FdrSummary.ledger` is `readonly FdrStep[]`, which is the tell: the two were
already reachable from one place and nameable from two, and a consumer holding
the summary should not have to go somewhere else for its own element type.

A `/fdr` door would cut across that line rather than along it, and would offer
one surface where the library has two. So `src/fdr` stays a barrel: it is the
implementation of a rule, not a surface anybody consumes as a unit. Both
widenings went on barrels that already existed, which is Law 2's first answer
and the one to reach for.

`createAlphaInvesting` and the option/state types are deliberately still
unexported — Law 2 again: no importer has asked.

---

## Law 2 — a symbol earns a BARREL first, a subpath second, and a door last

When a consumer needs something it cannot reach, there are three answers, and
they are ordered. Take the first one that is honest:

**1. Widen the barrel it already belongs to.** This is almost always the answer,
and it was the answer for six of the seven deep paths that existed the day this
file was written. `parseCSVTyped`, `matchesClause`, `PredicateClause`,
`SeriesPoint`, `SeriesGrain`, `MAGNITUDE_CHANNELS`, `familyOf`,
`BOOKMARK_VIEW_PREFIX`, `PROSE_VIEW_PREFIX` — every one of them was ALREADY on
its folder's barrel. The importers were not reaching past a closed door; they
were walking around an open one, because a relative path made both look the
same. Nothing was widened. The importers were pointed at the doors that were
already there.

**2. Give it its own subpath — only when the barrel must not carry it.** There
is exactly one such symbol today and its reason is a real one; see Law 3.

**3. Change the importer.** When the thing is not public at all. `src/session/dashboard.fixture.ts`
says in its own header that it is not shipped, and it is excluded from the
build. Two ui tests use it, and they still reach it by relative path — which is
correct, and is not an exception to anything: **a test is not a package
consumer.** It runs inside the checkout, against source, and an exports map does
not govern it. Production code in ui reaches nothing this way, and that is the
line: if a file that ships needs it, it needs a door; if a test needs it, a test
may take the relative path and no door is minted for it.

### The worked example: `MAGNITUDE_CHANNELS`

`ui/src/primitives/compat.ts` imported one `Set` of six strings from
`../../../src/def/types.js` — a leaf module three levels down.

- Answer 3? No: it ships, and the ui needs it.
- Answer 2, a `vizfootprint/def/types` subpath? Tempting, because the leaf is
  tiny and `/def` is a 69-export barrel that re-exports the links plane, the
  encoding plane and the source layer. But a subpath minted to avoid a big
  barrel is a subpath minted to avoid a bundler problem, and this one does not
  exist: the library declares `sideEffects: false`, the doors are ESM, and the
  demo's production build shakes the whole graph out. Measured, not assumed —
  `linksToMermaid`, `BUILTIN_COERCERS`, `wasmProvider` and
  `PLACEHOLDER_ENGINE_THRESHOLDS` all appear **zero** times in the built page,
  and the one wanted symbol appears once.
- Answer 1 it is. `MAGNITUDE_CHANNELS` was already exported from
  `src/def/index.ts`. The import became `from 'vizfootprint/def'` and nothing in
  the library changed at all.

That is the shape of nearly every one of these: **the door was already open, and
the deep path was the thing to delete.**

---

## Law 3 — `source/file` is the exception, and it is about NODE, not about size

`fileSource` is not on `src/source/index.ts`, and the barrel says why in its own
header: *"Carriers that need a runtime (file, http) are their own modules beside
this one, so the default entry never loads node or a socket."*

That is the only reason good enough to mint a subpath. `src/source/file.ts` is
the ONE file in the whole library that imports a node builtin (`node:fs/promises`,
`node:url`). Widening the barrel to carry `fileSource` would drag `node:fs` into
every browser build that touches a data source — a real breakage, not a size
preference. So the barrel stays browser-clean and the node carrier gets
`vizfootprint/source/file`.

The rule generalizes: **a subpath is for a symbol whose PRESENCE on the barrel
would change what the barrel costs to load.** Not for a symbol that feels
internal, not for one that feels heavy — for one that pulls a runtime, a peer,
or a dependency the barrel promises not to need. `vizfootprint/mcp` is the same
rule at folder scale (the optional MCP SDK).

---

## Law 4 — a deep import that works today stops working the moment there is an exports map

This is the part to read twice, because it is the one that will bite.

Before the `exports` map existed, `import { fileSource } from 'vizfootprint/source/file.js'`
would have resolved — Node's old rule was "any file under the package
directory". An `exports` map replaces that rule entirely. Every path not in the
map is now `ERR_PACKAGE_PATH_NOT_EXPORTED`, and the failure is at resolution,
not at type-check: a deep import can pass `tsc` under some settings and still
throw at runtime.

Two consequences worth stating plainly:

- **`files` is not the surface. `exports` is.** `src/` ships (the source maps
  point into it, and reading the code beside a `.d.ts` is worth the bytes), but
  shipping a file and exporting it are unrelated. Everything under `src/` is
  present and unreachable, and that is the intended state.
- **A relative path is not governed by any of this** — which is precisely why
  the demos stopped taking one. `demo/`, `demo-agent/`, `bench/` and `spikes/`
  live inside the package, so `../../src/...` resolves for them and the exports
  map never gets a vote. That was read for a while as "nothing asks them to
  change". It is the opposite: a place where the map has no vote is a place
  where **an open door and a closed one look identical**, and the whole finding
  this file was written on is that a relative path makes those two
  indistinguishable. So the demos import the package BY NAME — a package with an
  `exports` map can self-reference, and `demo/` and `demo-agent/` now do, which
  makes them the first readers of the surface rather than the last people
  exempt from it. See "The demos walk through the doors" below. The moment code
  moves OUT of this package it stops being able to take the relative path at
  all, and the eleven paths in the demo repo are what that transition looked
  like.

---

## The demos walk through the doors

`demo/` and `demo-agent/` import `vizfootprint/log`, `vizfootprint/data`,
`vizfootprint/agent` and the rest, exactly as an outside consumer would. Nothing
about them changed except which spelling they use, and that is the point: **they
are the in-repo witness that the doors are the surface.** A symbol that is
reachable only by a deep path now fails to compile in a demo the same way it
fails to resolve in `vizfootprint-demo`, instead of quietly working here and
breaking there.

Three consequences to know:

- **The demos need `npm run build` first**, like every other door-resolver. The
  browser bundles (`demo/build.mjs`, `demo-agent/build.mjs`) run esbuild
  directly, so they resolve doors through the exports map to `dist/` — no vitest
  alias reaches them. Under vitest the same files are aliased back to `src/` by
  `vitest.alias.mjs`, which is the split the "Two resolutions, one list" section
  already describes.
- **A demo may NOT open a door.** If a demo needs something no door serves, that
  is a finding about the public surface, and it goes to whoever owns the surface
  — never resolved by minting a subpath so a demo compiles. Moving the demos
  produced exactly one such finding, and it is worth reading as the worked
  example of this rule: `demo/src/analyst.ts` wanted `FdrStep` and
  `demo/demo.test.ts` wanted `createLordPlusPlus`, and neither was on any
  barrel. The answer was NOT a `/fdr` door — it was Law 2's first answer, twice,
  split by role: `FdrStep` onto `/session` beside `FdrSummary`, and
  `createLordPlusPlus` onto `/def` beside `FdrDecl` and `FdrStepper`. See "Why
  there is no `/fdr` door" under Law 1. **There is no relative import left in
  `demo/` or `demo-agent/`**, which is what makes this section a law rather than
  an aspiration: the next one to appear is a finding, not a habit.
- **A test may still take the relative path** (Law 2, answer 3) — the demo tests
  simply have no reason to any more, so they walk the doors too.

---

## The build

`npm run build` → `tsc -p tsconfig.build.json` → `dist/`, holding the emitted
`.js` beside its `.d.ts`, its `.js.map` and its `.d.ts.map`.

**Why tsc and not esbuild**, given the ui package bundles with esbuild: because
the two packages ship different things. `vizfootprint-ui` is a component library
whose consumers want a bundle and a UMD file for a `<script>` tag; this is a
plain ESM module graph with fifteen entry points, and bundling it would either
duplicate shared code across every entry or force a chunking scheme to avoid it.
Transpiling the graph in place keeps `source/file` from pulling `node:fs` into
anything that did not ask for it, which is Law 3's whole point. And tsc emits
the declarations in the same pass, from the same program, so the `.js` and the
`.d.ts` cannot disagree.

The honest note: the repo's own `tsconfig.json` already said
`"declaration": true, "outDir": "dist", "rootDir": "src"`. The build it
described had simply never been given a script. This is that build, plus a
`tsconfig.build.json` that lets it emit and names the three things that never
ship — `*.test.ts`, `*.fixture.ts`, `*.coverage.helpers.ts`.

`dist/` is gitignored. Anything that resolves a door — the ui package's
type-check, the demo, Node — needs `npm run build` to have run first.

### Two resolutions, one list

The exports map points every door at `dist/`. A **test run inside this checkout
does not go there**: the three vitest configs (root, `ui/`, `bridges/vega-lite/`)
resolve the doors back to `src/` through the one shared list in
`vitest.alias.mjs`. Two reasons, both load-bearing, and both written at the top
of that file: coverage is enforced at 100% over `src/**` and would credit none of
a `dist/` load, and `dist/` is a second copy of every module — a test file
holding the fixture from `src` and the builder from `dist` would be holding two
libraries, with two commit-id counters, and the failure would read as a bug in
the library rather than in the resolution.

`vitest.alias.mjs` and the `exports` map are the same list twice. **A door added
to one and not the other is the drift to watch for**, and it shows up as a test
that passes while the demo cannot resolve the import, or the reverse.

---

## Consumers

`ui/` and `bridges/vega-lite/` are workspaces inside this package and each
carries `"vizfootprint": "file:.."` (`file:../..` for the bridge) in
`devDependencies`, which is what makes `node_modules/vizfootprint` a symlink to
the checkout root. Both also declare it as a `peerDependency`: the ui package's
ESM bundles externalize the library, so the APP resolves it, once — never a copy
inside `ui/dist`.

`vizfootprint-demo` is the outside consumer, and it is deliberately the only one
with **no alias**. It carries `"vizfootprint": "file:../vizfootprint"` as a real
dependency and resolves every door through the exports map to `dist/`, which is
the point: it is the clean room where the built entry points either work or do
not. The family's standing warning applies — a `file:` link plus `npm link` will
happily mask a resolution bug that a real install would catch — so the demo's
doors are checked by resolving and importing all fifteen and reading the
resolved path back, not by trusting that the old relative paths still point
somewhere.

---

## Adding a door — the checklist

1. **Ask Law 2 first.** Is the symbol already on a barrel? Nine times in ten it
   is, and there is no door to add — only an importer to correct.
2. **If it is not, widen the barrel** unless Law 3 applies (it pulls a runtime,
   a peer, or a dependency the barrel promises not to need).
3. **If Law 3 applies, mint the subpath**, and write the reason into the
   barrel's own header the way `src/source/index.ts` does — the next person
   deciding this will read the barrel, not this file.
4. **Add it in BOTH places**: the `exports` map in `package.json` and the `DOORS`
   list in `vitest.alias.mjs`. One without the other is the drift Law 4's last
   section describes.
5. **Add the row to Law 1's table.** A door nobody can find is a door nobody
   uses, and the next reader will reach for a relative path instead.
6. **Prove it resolves**, from the demo and not from here: `import.meta.resolve`
   should name a file under `dist/`, and the symbol should come back off the
   module. The alias makes an in-repo test a poor witness, on purpose.
