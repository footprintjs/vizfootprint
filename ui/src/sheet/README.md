# sheet — the read-only Sheet

The rows the charts see, in a scrollable grid. Every visible window is one question the engine answered; nothing here holds a copy of the table.

```tsx
import { Sheet, httpSheetData, sessionSheetData, sheetSortOf } from 'vizfootprint-ui';

// in process
const data = useMemo(() => sessionSheetData(session, { table: 'cells' }), [session]);
// or over a door that answers the session's ViewQueryResult JSON verbatim
const data = useMemo(() => httpSheetData({ endpoint: '/api/window', table: 'cells', columns: facets }), [facetsKey]);

// the sort is the TRACE's, not the component's: read it at the cursor, land it as an act
<Sheet data={data} viewId="sheet" table="cells" height={480} version={version} cursor={state.cursor} selectedRowId={pickedRowId} onSelect={(field, value) => view.emit('sheet', { rawValue: value, encoding: { kind: 'point', field } })} sort={sheetSortOf(state.layouts, 'sheet')} onSort={(next) => void view.setSheetSort('sheet', next)} readOnly={presenting} />
```

## The laws

- **The grid is virtualized over the engine.** A window is `viewQuery({ viewId, sort, offset, limit })` — sorted, offset, with a row identity per row — and it answers `{columns, rows, rowIds, positional, key, count, start, version, cursor}`. The count is the engine's, so the scrollbar is never a guess.
- **Whose eyes.** `viewId` is the consumer: the session excludes the sheet's own clause and applies each edge's response, so selecting a row never makes the sheet's other rows vanish. Rows that failed the incoming clauses are already absent — the engine filtered them; the sheet did not hide them.
- **The window names the key.** `SheetWindow.key` is the declared row key's column: what the grid moves to the front, freezes, and selects on. A host never has to hand it in (the facets are still worth handing in, for types and roles).
- **The capped canvas keeps both ends exact.** 1M rows × 28px is 28 million pixels, past what a browser will lay out, so the canvas is capped at `canvasMax` (10,000,000 px) and the scrollbar becomes a shorter ruler. The map is between what can be *scrolled* and what can be *shown* — `scrollTop ∈ [0, canvasHeight − bodyHeight]` ↔ `first row ∈ [0, count − visibleRows]` — so **the last row is always reachable** and a row → scroll → row round trip returns the row it started from. The rows layer is drawn from the viewport's top edge (scrolling is row-quantized by construction) and is never allowed to reach past the canvas, which would invent scrollable space below the last row.
- **One block cache, two keys.** The **question** (table, viewId, columns, sort) says which rows in what order; change it and the blocks are forgotten. The **stamp** (version, cursor) rides beside it: the blocks wear the stamp of the ANSWER that filled them, never of the ask. A host whose polled cursor is one poll behind therefore asks with the old stamp, gets an answer stamped with the live one, and it applies — no refusal — and the next ask (with the caught-up prop) is a hit. Only an answer whose own stamp differs from the blocks' replaces them: two versions never share a grid. An answer to a question the cache has since LEFT is dropped rather than written into the new question's blocks — the cache enforces its own law, so a host driving it directly (a future AG Grid adapter) gets the same guarantee the `<Sheet>` does. Blocks are `blockRows` (100) rows, at most `maxBlocks` (50), evicted least-recently-served first. A miss is fetched as ONE range, never one call per block.
- **Answers apply in request order.** Every ask takes a sequence number; an answer below the last applied one is dropped silently — a fresher answer is already on screen, and there is nothing to tell.
- **Nothing breaks quietly.** A data layer that throws, a door that cannot be reached, a 200 that is not a window, a schema that fails — each becomes a sentence in the status line beside the rows already on screen, which keep the version they were read at. A refused window never clears the grid.
- **Headers carry the name, the type** the tally settled on, and a **role badge** when the role changes what the column is (`identifier`, `measure`, `absence` — a plain dimension gets none). The sort toggle (none → ascending → descending → none) appears **only when `capabilities.sort` is true, the host wired `onSort`, and this is not Present mode** — sorting is an act: an act with nowhere to land is not offered, and reading never rearranges. When the ENGINE is the reason, the header grows a second line and says why, as readable text — a tooltip is not an answer; when the host simply wired no door there is no sentence, because nothing is claimed and nothing is hidden (see "The sort is an act" below). And an engine that refuses a sort it was sent hands it back to the host to clear, so the readout never claims an order the rows are not in.
- **A row click is a selection, or a refusal.** On a keyed table it emits a `point` on the key column through `onSelect`, and `selectedRowId` marks the row the session's own clause holds. **The second click of a double-click never selects** — the first one already did, exactly as a spreadsheet behaves. On a **positional** table the click is refused in the status line: *"this table declares no row key — a row cannot be selected; declare `key` on the table"*. `readOnly` (Present mode) closes the door.
- **A cell edit is refused with a next action.** Double-click a cell and the status line says *"‹column› is a source column — the sheet is read-only in this version; annotate the row instead"*. `capabilities.edit` is `false` by construction: the unit is the column, never the cell.
- **Adding a column is an ACT, not an edit.** `<AddColumn>` is a form beside the grid, never a control inside it, and the grid it sits beside stays exactly as read-only as it was. See "Add a column" below.
- **The status strip is two regions.** The readout (`rows a–b of N · version v · sorted by x ↓`, never a range past the count) is `aria-live="off"` because it changes on every scroll; the refusals sit in their own `role="status" aria-live="polite"` and are the only thing announced.
- **Memoize the adapter.** `data` is part of the question: a new `httpSheetData(…)` built on every render is a new data layer every render. Build it in a `useMemo` keyed on the facts (endpoint, table, the schema's values — not the poll's object identity).
- **Mount it once the state knows the version**, or the first paint asks once for the unknown version and again when it arrives. The gallery's sheet page shows the pattern.
- **Height.** Give `height` (the OUTER height, frame included) and the sheet uses it; leave it out and the sheet measures the box it was given with a `ResizeObserver` and follows it. A host without one keeps the first measurement.
- **Keyboard: APG grid keys.** Arrow keys move the focused cell, Home/End move to the first/last column of the row, PageUp/PageDown move a page of rows; the scroll follows the focus. A move onto a row this window does not hold yet KEEPS the intent until the row arrives, then takes the DOM focus — it is never dropped on a render that could not honour it. **The intent never outlives its own ask**: a newer ask, a refused window, focus leaving the grid, or any pointer press anywhere drops it, so a window that lands minutes later can never reach across the page and steal focus from whatever a person is typing in. The focus is taken only after a keyboard move, never on first paint.
- **A refused sort is remembered.** When the engine says `unsupported-sort` at runtime the sort is handed BACK to the host to clear — one honest act, never a quiet local undo — AND the sentence is kept for the life of this sheet: the header shows it on its own line from then on, the toggles go, and the status strip keeps it instead of flashing once and vanishing.

## The sort is an ACT — the ruling, and where it lands

**The law: a read asks a question; an act changes what the next question is asked of.** Scrolling is a read — `offset` moves where you stand in one fixed order, and two people scrolled to different rows have not changed each other's dashboard. A **sort is not that**: it replaces the order itself, so it changes what row 1 *is* for every window afterwards, including one a story page replays or a colleague opens. "Look at the top of the sheet" means two different things before and after one, and nothing on the trace said which.

The library had already drawn this exact line, and this folder only had to stand on the right side of it. A pan/zoom `navigate` on a declared view lands **no** commit (a viewport is never a data claim); a `navigate` on a `layout:${scope}` identity **lands one**, and `rebuildFold` restores it per cursor so "each path keeps its own arrangement". **The sheet's scroll is the pan/zoom. The sheet's sort is the layout.**

So a sort lands through the verb it already had, and **no verb was added — the vocabulary stays at ten**:

```tsx
// the host owns the arrangement: it LANDS what the sheet asks for, and hands back what the trace holds
<Sheet
  data={data}
  viewId="sheet"
  table="cells"
  sort={sheetSortOf(state.layouts, 'sheet')}
  onSort={(next) => void view.setSheetSort('sheet', next)}
/>

// one click on the "cases" header lands exactly one commit:
//   viewId  layout:sheet:sheet
//   field   sort
//   value   [{"field":"cases","dir":"desc"}]
//   cause   "sheet: sorted by cases ↓"  (requestedBy: user)
// and after a seek back past it, `sheetSortOf` answers `undefined` — the order that cursor was in.
```

Five things follow, and each is a test in `arrangement.integration.test.ts`:

- **It is INERT.** The commit never filters, never enters `selectedRowCount`, never reaches `foldDiff` — that is what lets an arrangement be recorded without becoming a data claim. Recorded, folded, restored; never dispatched on.
- **Time travel restores it, and a reload does too.** The fold is rebuilt from the branch path, so a cursor before the sort is a cursor with no sort; and because the order rides *on the commit*, `session.replay(log)` rebuilds it in a session that never saw the walk. Those were the two visible defects.
- **Clearing is an act too**, with its own words (`"sheet: sort cleared"`) and its own commit. A sort that vanished quietly would be the original bug wearing the opposite sign.
- **The sheet remembers nothing.** It renders `sort` and asks through `onSort`. A sheet given no `onSort` — and a sheet in Present mode, which closes this door exactly as it closes the row-click one — has **no toggle and says nothing of its own** — no toggle to offer, and when the host holds no order either, no arrow and nothing about one in the readout, so there is no lie to correct; printing "nobody wired this" over every column would scold a developer in a reader's face and cost a row of their table. Which doors a host wired is a fact about the dashboard, and it belongs here. (An engine that *cannot* sort is the opposite case and does get its sentence: it refuses something a person would reasonably try.)
- **The engine's runtime refusal is handed back, not swallowed — ONCE, and never in Present mode.** `unsupported-sort` makes the sheet ask the host to clear the order, so the trace is never left claiming an order the rows are not in. Three rules ride with it. It is handed back **once per refused order**: the refusal grows the header by a line, which shrinks the window and re-asks before an asynchronous host has landed the clear, and one refusal must not land two commits. **Present mode hands back nothing at all** — clearing is an act, and a person who only opened a story writes nothing to the trace they are reading; the sheet says the engine's sentence instead. And the readout and `aria-sort` **speak for the rows, not for the ask**: an order the engine refused is not one they are in, so neither claims it. A sheet with no door has nobody to hand it to — it shows the sentence and no rows, rather than rows in an order nobody got. The refusal is remembered for the life of that PORT, not of the component: a host that swaps `data` gets an engine that has refused nothing yet.

- **The words name every key.** `sortWords` spells the whole arrangement (`sheet: sorted by region ↑, cases ↓`) rather than the first key and a count, because two different arrangements would otherwise land byte-identical words, and the words are the only account of the act a person scrolling the rail has. The glyph pair has one owner (`sortArrow`), spent by the rail, the readout and the header alike.

**Why the value is JSON** and not a joined string like the cockpit's `order`: this folder already ruled on it one file over. `httpSheetData` sends `columns` and `sort` as JSON because *"a column may be called `a,b`; a joined list could not carry it"* — the same hazard, already decided. JSON also round-trips `absent` and a multi-key spec exactly, so nothing is silently truncated. The plain words a reader sees ride the cause's **intent**, exactly as `setLayout`'s do: the value is for the machine, the intent is for the reader. Reading one back is **total** — a blank value, a leaf that is not text at all (a poll's JSON can carry `null` there), text that is not JSON, a half-written key, or a key carrying a slot this version does not know all read as *no sort*, never a guessed one. That last one matters most: the window port silently drops a prop it cannot name, so honouring the rest of a newer wire's key would put the grid in an order nobody asked for.

**The alternative was considered and refused.** "Sort is a read, like scrolling — so lift it into view state a bookmark and the story payload carry" fails on the library's own laws: a bookmark is a name on a moment that explicitly *saves no state*, and the story payload carries the log, the bookmarks and the saved pictures — the trace and the stores beside it. Making a sort survive that way means inventing a second persistence channel next to the trace, which is the one thing this library exists not to do. The trace already had a place for it.

### Where the code lives

| file | what it owns |
|---|---|
| `arrangement.ts` | the identity (`layout:sheet:<viewId>`), the codec both sides share, `sheetSortOf` (the read at a cursor), and every word an arrangement is said in — `sortArrow`, `sortPhraseOf`, `sortedByWords`, `sortWords`. Pure — no React, no session |
| `Sheet.tsx` | renders `sort`, asks through `onSort` (closed in Present mode), and owns `noSortWords` — why a header has no toggle, when the answer is the engine's. It spends `arrangement.ts`'s words rather than writing its own |
| `../adapter/sessionView.ts` | `setSheetSort` (the act, over both sources) and `SessionViewState.layouts` (every layout scope, not only the cockpit's) |
| `AddColumn.tsx` / `AddAggregate.tsx` | the two doors beside the grid — what is typed or picked, whether an act is in flight, and the last thing the session said. Neither judges |
| `../adapter/sessionView.ts` (`addAggregate`, `aggregateIntent`) | the measure TREE minted from a pick, the `ops` version read from the library, and the act's plain words |

## Add a column — an act, not an edit

```tsx
<AddColumn columns={numericColumnNames} onAdd={(name, expression) => view.addColumn(name, expression, { table })} readOnly={presenting} />
```

A cell edit is refused here and always will be: a cell is not a unit anything on this dashboard could be derived from, and a dashboard that let one be typed over would be showing a number with nothing on the trace behind it. A **column** is the opposite. A formula over the columns that are already there is an ordinary act — it lands a commit with a cause, the column belongs to that commit, it resolves at the cursor's branch path, and it replays. So the door exists, and it is a door onto the SESSION drawn beside the grid, not an editor bolted into it.

Four laws, and they are all the same law seen from four sides:

- **It judges nothing.** The name, the expression, whether the columns exist and whether they are numbers are the library's to answer. `<AddColumn>` sends what was typed and shows what came back. A second opinion here would be a second set of rules to keep in step, and the one on screen would be the one nobody tested.
- **A refusal is the session's own sentence, and lands nothing.** *"the formula "cases / disease" reads "disease", which table "cells" holds as string — a formula reads numbers"* appears in the form's own `role="status"` register, the typed text is kept (a refusal is a thing to fix, not a thing to retype), and no commit exists. A door that threw says so in the same place rather than freezing.
- **What landed is said too**, in the column's own name (*"rate is on the sheet"*), and the fields clear. The column itself appears in the grid at the next refresh, through the ordinary window — the sheet learns nothing special about it, because there is nothing special about it.
- **`readOnly` closes it.** Present mode is reading; the inputs and the button are disabled and the strip says why. An act in flight cannot be sent twice.

The columns the form lists are the ones a formula may READ — the number columns the table has at the cursor. They are listed, never enforced: a name that is not among them is refused by the session, in the session's words. The grammar itself, the five functions it knows and every refusal it makes are in [`vizfootprint/src/analysis/README.md`](../../../src/analysis/README.md).

The act rides `SessionView.addColumn`, which is the `analyze` verb carrying its own declaration — a builtin `formula` record, which is data, so an in-process session and a polled endpoint get the same bytes and the same library judges them.

**A column added here replays from the log alone.** The record rides on the commit, so a log carrying it is enough to rebuild the column in a session that declares nothing — no pre-registration, no host cooperation. That is the library's law 6 doing the work; this form only has to hand over the two words a person typed.

## Cut a table — the same act, one level out

```tsx
<AddAggregate columns={everyColumnName} onAdd={(name, pick) => view.addAggregate(name, pick, { table })} readOnly={presenting} />
```

`<AddColumn>` lands a column ON the rows in front of you. `<AddAggregate>` lands a **table beside them**: one row per group, cut from the rows visible at THIS cursor, with the measures it names as its columns. It is an act for the same four reasons — it belongs to the commit that made it, it resolves at the cursor's branch path, it carries the data version it was cut from, and it replays — so the four laws above are its laws too, word for word: it judges nothing, a refusal is the session's own sentence and lands nothing, what landed is said (*"by_region is a table now — it has a sheet of its own"*), and `readOnly` closes it.

Three things are its own:

- **The reducers are the LIBRARY's.** The picker offers `REDUCER_OPS`, which is read off the op table itself (`src/derive/ops.ts`) — so a seventh reducer added to the grammar arrives in this form with no edit here, and this form can never offer a fold the grammar does not have. One owner.
- **A picked measure is not a tree.** The form hands back `{ as, op, of }` — a name, a fold, a column — and `SessionView.addAggregate` mints `{ as, expr: { op, args: [{ col }] } }` from it. That is the ONE place the shape is written down, so no screen has to know the grammar.
- **The empty group is an ANSWER, said out loud.** Picking no group column reads *"no group column — one row for the whole table"* and sends `groupBy: []`. A form that quietly refused to submit would be judging, and this door judges nothing.

```tsx
// what the door sends, and the only shape it owns
await view.addAggregate('by_region', { groupBy: ['region'], measures: [{ as: 'total', op: 'sum', of: 'cases' }] });
// → one commit: analysis:by_region, "cut by_region: total = sum of cases by region"
```

The table it cuts is an **ordinary table** everywhere after that: `sessionSheetData(session, { table: 'by_region' })` reads its rows through the same port, its key is the one the act minted from its group column (read off the Sources rows, not `overview.keys` — a table nobody declared is not in the def's map), and `<Workbook sheets=…>` gives it a tab of its own. Nothing versions it: the session answers `version: null`, because no carrier vouched for those rows — the CURSOR is the stamp that moves, and seeking past the act takes the table with it.

## The port

`SheetData` (`./types.ts`) is React-free and core-free at the type level — only TYPES come from `src`. It is three things: `capabilities` (each `false` naming its refusal sentence), `columns()` (name, type, role), and `rows(window, { signal })` answering a window **or** a refusal. There is no third arm: an empty grid never stands in for an answer nobody gave.

Two adapters ship. `sessionSheetData` is in process: a translation and a refusal pass-through over `session.viewQuery`, which turns a throw into a sentence and drops a window whose signal was aborted. `httpSheetData` speaks `GET <endpoint>?table=&viewId=&columns=&sort=&offset=&limit=` with `columns` and `sort` as **JSON** (a column may be called `a,b`; a joined list could not carry it) and validates what comes back — a refusing door's own `error` sentence is the one shown.

## Deliberately not here yet

- **A row on a KEYLESS table cannot be selected in this version.** The design calls for a "within-version marked point" — a selection on `<version>#<index>` that a bookmark records as valid only inside that version — and the library port does not express one yet: `ViewQueryResult` carries the positional row id but nothing consumes it as a clause. **That is a pending library decision**, not an oversight here; until it lands the sheet says so in words rather than inventing an identity.
- **The REST of the arrangement.** `sort` lands (see "The sort is an act" above); `hidden`, `order`, `frozen` and `firstRow` do not yet. They belong under the same identity and the same prop grammar — one `navigate` note per prop on `layout:sheet:<viewId>` — so each is a small packet on a road that is already built, not a new decision. `firstRow` is the one to think twice about: a scroll position is a READ by this folder's own law, and it would be here only as a place to RESUME, never as a claim about an order.
- **A profile per column** — the quality bar, the distribution mini-bar, the distinct count, the absence tally. They come from ONE fold per (table, version, visible overlay set), which does not exist yet; a header that guessed them from the rendered window would be lying about 90,300 rows while showing 30.
- **Find (Ctrl+F), copy and export**, the formula bar, the why panel, cell edits, and the AG Grid adapter — each is its own packet. (Derived columns arrived: see "Add a column" above.)
