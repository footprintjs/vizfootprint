# vizfootprint-studio

A **desk** is a whole provenance dashboard, installable.

[vizfootprint](../README.md) records what a person did to a dashboard and can say
afterwards how it got to what it is showing. [vizfootprint-ui](../ui/README.md)
draws the pieces of one — a cockpit shell, eight charts, a time-travel bar, a
branch map, the honesty panels. Between those two there was, until now, a gap the
size of a real application: somebody still had to write the eleven hundred lines
that wire a session to a screen. The CDC demo wrote them, and every next
application would have written them again, differently, and got some of them
subtly wrong — because most of those lines are not about CDC data at all. They
are about what a dashboard IS when everything on it is recorded.

This package is those lines, once.

```
npm run build          # dist/desk.js + dist/make.js + types/
npm test               # vitest (jsdom, over a second definition)
npm run test:coverage  # the same, at 100% on all four axes
```

```tsx
import { Desk } from 'vizfootprint-studio/desk';
import { createSessionView, pollingSource } from 'vizfootprint-ui';
import 'vizfootprint-ui/styles.css';

<Desk
  view={() => createSessionView(pollingSource({ intervalMs: 1000 }), { as: 'user' })}
  charts={(desk) => [
    { id: 'shelves', weight: 2,
      caption: `Books by ${desk.bound('shelves', 'category', 'shelf')}`,
      render: ({ width, height }) => <VizBar viewId="shelves" data={myCounts} selection={desk.selFor('shelves')} width={width} height={height} … /> },
    { id: 'years',
      caption: `Pages per ${desk.bound('years', 'x', 'year')}`,
      render: ({ width, height }) => <VizLine viewId="years" data={myTrend} width={width} height={height} … /> },
  ]}
/>
```

That is a working desk. It has time travel, named paths with a fork toast, an
editor drawer, notes with mentions, saved pictures, present mode as a slideshow,
a commit log, a branch map, a jump box and the layout presets — and not one of
those was configured, because none of them is about the books.

---

## The law: the desk PROJECTS, the host DERIVES

Everything about this package's shape follows from one sentence, and it is the
adapter's law (`../ui/src/adapter/README.md`, law 1) one tier further out.

**A fact the session holds, the desk copies.** Which field a channel is bound to
at the cursor. Which clause reaches a view through the link graph. A view's
words, who wrote them, and whether they went stale. The paths, the log, the
bookmarks, the saved pictures, the tables, the columns. The desk reads every one
of those off the session view and never recomputes any of them, because the
moment a shell starts believing a second version of the truth, nothing crashes —
the dashboard simply starts disagreeing with its own log, and the version on
screen is the one nobody tested.

**A fact about the host's own ROWS, the desk never touches.** How many cells
carry each value; what a week sums to; which areas reported nothing; what a
category's bar is tall. The desk does not have the rows and does not ask for
them.

That is why `charts` is a **function of the projection** and not a list of
charts. The desk hands you everything the session knows; you hand back the cells,
having done your own arithmetic over your own rows with the session's answers as
the inputs.

```tsx
charts={(desk) => {
  const sel = desk.selFor('shelves');           // through the link graph — never state.selections
  const field = desk.bound('shelves', 'category', 'shelf');  // the session's binding, not a constant
  const bars = useMemo(() => countBy(rows, field, keepPredicate(sel)), [rows, field, sel]);
  return [{ id: 'shelves', caption: `Books by ${field}`, render: … }];
}}
```

Two things follow that are easy to miss:

- **`charts` may use hooks.** It is called once, unconditionally, from the desk's
  own body, so a `useMemo` inside it is a custom hook and behaves like one. For
  anything the size of a real table it *should*: without memoization the
  aggregation behind every cell re-runs on every poll.
- **A caption is part of the projection too.** Read the field name through
  `desk.bound(...)` rather than typing it. An axis that moved while the sentence
  under it did not is the bug this arrangement exists to prevent.

---

## The doors

| door | what it is |
|---|---|
| `vizfootprint-studio/desk` | `Desk`, `DeskFigure`, the contract types, the tokens |
| `vizfootprint-studio/make` | `Make`, the wizard — and the pure step logic under it |
| `vizfootprint-studio/cards` | `DemoGallery`, `DemoCard` — what a demo covers, read off the demo |
| `vizfootprint-studio/package.json` | the convention |

**There is no `.` root export, on purpose.** A root would have to be one of the
three programs wearing the package's name, or a barrel that carries all of them —
and each has a different dependency footprint. Three names, each saying what it
is.

**The three doors are three programs.** `desk` drives a definition somebody has
already written; `make` helps a person write one; `cards` says what one covers,
for a gallery that lists several. A host that only mounts a desk should not
bundle an authoring flow, and a host that only lists demos should not have to
know what a `DeskProjection` is — so they are three entries, three bundles,
three names.

## What the desk owns, and what it asks you for

| the desk brings | you bring |
|---|---|
| the time strip, the jump box, the bookmark namer, present mode and the slideshow | — |
| the summary line, its drafts and their accept/decline | — |
| the selection chips, the saved pictures, the ✕ on a live cell | — |
| the charts band, the layout presets, drag-to-reorder, the ✎ on every cell | `charts` — the cells themselves |
| the editor drawer | extra `aside` tabs, if you have an analyst or a debugger |
| notes, their mentions and their anchors | — |
| the commit log and the branch map | — |
| the fork toast and the paths modal | — |
| the silences panel | `silences` — the groups, and what your vocabulary means |
| the agent-proposals panel | `proposals` — the rows and the door that asks for them |
| the Data workbook, and the Sheet's columns off the session | `data.sheet` — where your rows come from |
| the Story tab: the post, the stage, the pinned figure | `story.figure` — which cells the figure shows |
| the notice line | `notice` — anything your own doors said went wrong |
| the ☰ menu: edit, save, paths, present, text | `menu(desk, own)` — your items, and the order |
| the report chips | `reports(desk, own)` — your panels, and the order |
| — | `front` — the landing page, if you have one |

`menu` and `reports` are **combinators** rather than lists appended at one end.
The order of a chip strip is a design decision and belongs to whoever drew the
dashboard; and a host that drops one of the desk's panels should have to do it
out loud rather than by leaving a flag off.

Every optional slot removes its own furniture when it is absent. A desk given no
`story` has no Story chip — an empty panel is furniture, not information.

### The front door, and why `view` takes a factory

`view` accepts a live `SessionView` **or a function that makes one**, and the
difference is who is answerable for it. A live view belongs to the host: the
single-file story page builds the session itself, and will dispose of it. A
factory belongs to the desk — called once on mount, disposed on unmount.

The factory form exists for `front`. A polled session begins polling the moment
it is created, so a desk that held a landing page while its own session was
already fetching behind it would be the one place in a provenance dashboard that
quietly reported something it did not yet know. With a factory, **nothing** is
mounted until the reader goes in.

## What is tokenised, and what is not

`tokens.ts` holds seventeen names — colours, four type sizes, a line height, a
mono stack, two gaps, a padding, a radius — written onto the desk's root as CSS
custom properties, and overridable one at a time:

```tsx
<Desk … tokens={{ stale: '#8a5a00', danger: '#b3261e', mono: '"IBM Plex Mono", monospace' }} />
```

They govern **only what the desk itself draws**: a view's words and their stale
mark, the summary and its drafts, the aside's tabs, the jump box, the notice
line, and the two report panels whose words are the desk's.

They do **not** govern the charts, the cockpit shell, the modals, the time strip,
the branch map or the sheet. That is `vizfootprint-ui`'s look, it wears
`--vzf-*` from its own stylesheet, and it has its own `ThemeConfig`. This is not
a design system and is not trying to become one; it is the smallest set of names
that makes today's look a default rather than a hard-code.

**The defaults are written inline on the root**, from one map in TypeScript, and
not in a `studio/styles.css`. A host that forgot the stylesheet import would
otherwise get a desk with no colours and a failure that looked like a bug in the
desk. The cost of that choice is stated rather than hidden: an inline custom
property beats a stylesheet, so a host restyles through the `tokens` prop (or by
setting the variable on an element *inside* the desk), never by writing
`.vzfs { … }` in its own CSS.

## The figure

`DeskFigure` draws a named subset of the SAME cells, pinned, at the size a story
column gives them — and the desk's own Story tab draws its figure through the
same code. That is the point rather than a saving: a story whose figure was a
second set of charts would be a story about a dashboard nobody was looking at.

A named cell this desk has not got is **refused in a sentence** and the rest are
drawn:

> this figure names "sales", which is not a cell on this desk — the rest are drawn

Not silently dropped. A figure that quietly showed three charts where a story
asked for four has lied about what it is.

## The build

`npm run build` → `node build.mjs`: one esbuild pass per door, plus `tsc -p
tsconfig.build.json` for the declarations. React, `vizfootprint`,
`vizfootprint-ui` and `storydeck` are all **external**, for the reason
`ui/build.mjs` externalizes the library: the app resolves one of each, once. Two
copies of the commit-id counter meeting in one page is the failure that rule
exists to prevent.

No UMD bundle, and no stylesheet — both are decisions rather than omissions, and
both are argued at the top of `build.mjs`.

`storydeck` is an **optional peer** and reaches this package only through
`vizfootprint-ui/story/stage`, which the Story tab mounts. A host that passes
`story` needs it installed; a host that does not, does not use the tab — but the
import is static, so today it must still resolve at build time. That is the one
place this package asks for more than it uses, and it is written down here rather
than discovered.

## Tests

`src/desk/Desk.test.tsx` runs the whole contract over **a second definition** — a
small library-of-books desk with two cells, a different table and different
columns — because a shell exercised only by the host it was extracted from is a
shell that has not yet been proven to be one. It pins the three things a consumer
would find out the hard way: that a second definition renders with no shell code
of its own, that a re-encode moves the caption (the projection answers with the
session, not with a constant), that a missing figure id is refused in a sentence,
that the tokens default and override, and that a `front` slot opens no session
until the reader goes in.

The suite resolves `vizfootprint-ui` through **its exports map, to `ui/dist`** —
not aliased back to source like the library's own doors. That is deliberate: the
desk is the first consumer of that surface from outside the component tree, and a
test that reached into `ui/src` would prove a composition against files no
installed consumer can see. Run `npm run build -w vizfootprint-ui` first.

**This workspace carries its own 100% coverage gate**, at the library's own
standard, because nothing else is measuring it. The repo-root config measures the
five trees it *names* — and until this package arrived, a bare `src/**` in that
list was matched loosely enough to sweep in any workspace nesting a `src/`, so a
new one joined the library's gate the day it appeared without being named. That
glob is anchored now, and each workspace's coverage is its own gate, the way
`ui/` and the vega-lite bridge already have their own configs. A workspace whose
gate is weaker than the library's is where the next silent defect lives.

One `/* v8 ignore */` in the whole tree, at the site and with its reason: the
slideshow's empty title, which cannot be reached because `bookmarkIndex` is an
index *into* the bookmark list, clamped at zero, and the slideshow is only built
when there is at least one.

## The worked example

`vizfootprint-demo` is this package's real host, and its `web/src/App.tsx` is
what the extraction was measured against: 1,112 lines before, and after it, the
NNDSS definition's own derivation, its parameter list, two host extensions and
one `<Desk …/>`. Its `web/src/cells.tsx` is the reference for what a `charts`
callback looks like when the table is 90,300 rows and the memos matter.

---

## The other half: `make`

A desk needs a definition, and until now somebody had to write one in
TypeScript. `vizfootprint-studio/make` is the four steps that get a person from
a spreadsheet to a definition — Datawrapper's steps, each mapped onto a door
this library already had:

```tsx
import { Make } from 'vizfootprint-studio/make';
<Make />;
```

1. **Bring data** — paste or upload a CSV; `describeTable` says what arrived,
   and the ceiling (ninety thousand rows comfortable, a million past the
   fifty-millisecond line) is stated before a file is chosen rather than after
   one is loaded.
2. **Check and describe** — the person declares each column (`{ type, role,
   scale, label }`, the def's own `ColumnDecl`) over the sniff. Nothing is
   demoted silently: a column with no role stops the step, by name.
3. **Visualize** — a chart kind and a column per channel, with `whatFits`
   greying what does not fit and printing the plane's own sentence for why.
   Optionally one of the five builtin analyses, declared as a record — including
   a `formula`, an arithmetic expression over the number columns that becomes a
   new one; anything beyond them is a developer's, and the step says so.
4. **Open, and publish** — `parseDashboardDef` → `buildDashboard` → this
   package's own `Desk`. Publishing hands over ONE HTML file that opens with no
   server, carrying the log, the bookmarks, the pictures and — because a made
   definition is entirely JSON — its own definition.

**Authoring is before the walk.** `make` never edits a dashboard that already
has a log: the menu's *Change the charts* goes back to step three and builds a
new desk, and says out loud that the acts on the old one are discarded.

The whole flow is also a set of plain functions (`judgeStep`, `assembleDef`,
`openDesk`, `ceilingVerdict`, `readTable`), so a host — or a test, or an agent —
can drive it with no screen at all. The argument, the laws and the file map are
in [`src/make/README.md`](src/make/README.md).

---

## The third: `cards`

A gallery of demos has to say what each one covers, and every such list ever
written by hand has gone stale. `vizfootprint-studio/cards` reads the tags off
the demo instead — chips grouped by which reader vouched for them:

```tsx
import { DemoGallery } from 'vizfootprint-studio/cards';

<DemoGallery
  heading="What the demos cover"
  surfaces={[
    { demo: 'CDC NNDSS', surface: 'desk',       declares: defFeatures(buildDashboard(nndssDef(tables, graph))), byHand: GESTURES },
    { demo: 'CDC NNDSS', surface: 'story page', declares: defFeatures(buildDashboard(nndssDef(tables))), walked: logFeatures(payload.log, payload) },
  ]}
/>
```

- **declares** — `defFeatures(dashboard)`: the build holds it, whether or not
  anybody used it.
- **walked** — `logFeatures(records)`: a commit proves somebody did it.
- **by hand** — which gesture produces which verb, and which verbs a build leaves
  unwired. Neither is in a definition or a log, and both are drawn under a
  heading that says so.

**A card is per SURFACE.** One demo is not one dashboard: the CDC desk builds its
definition with the co-occurrence graph and its story page builds the same demo
without it, so they are two cards with two revisions, and the filter narrows to
surfaces rather than demos. The five laws, with an example each, are in
[`src/cards/README.md`](src/cards/README.md).
