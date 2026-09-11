# sheet — the read-only Sheet

The rows the charts see, in a scrollable grid. Every visible window is one question the engine answered; nothing here holds a copy of the table.

```tsx
import { Sheet, httpSheetData, sessionSheetData, sheetFrozenOf, sheetHiddenOf, sheetOrderOf, sheetSortOf } from 'vizfootprint-ui';

// in process
const data = useMemo(() => sessionSheetData(session, { table: 'cells' }), [session]);
// or over a door that answers the session's ViewQueryResult JSON verbatim
const data = useMemo(() => httpSheetData({ endpoint: '/api/window', table: 'cells', columns: facets }), [facetsKey]);

// the ARRANGEMENT is the TRACE's, not the component's: read each prop at the cursor, land it as an act
<Sheet
  data={data}
  viewId="sheet"
  table="cells"
  height={480}
  version={version}
  cursor={state.cursor}
  selectedRowId={pickedRowId}
  onSelect={(field, value) => view.emit('sheet', { rawValue: value, encoding: { kind: 'point', field } })}
  sort={sheetSortOf(state.layouts, 'sheet')}
  onSort={(next) => void view.setSheetSort('sheet', next)}
  hidden={sheetHiddenOf(state.layouts, 'sheet')}
  order={sheetOrderOf(state.layouts, 'sheet')}
  frozen={sheetFrozenOf(state.layouts, 'sheet')}
  onArrange={(prop, value) => void view.setSheetArrangement('sheet', prop, value)}
  readOnly={presenting}
/>
```

## The laws

- **The grid is virtualized over the engine.** A window is `viewQuery({ viewId, sort, offset, limit })` — sorted, offset, with a row identity per row — and it answers `{columns, rows, rowIds, positional, key, count, start, version, cursor}`. The count is the engine's, so the scrollbar is never a guess.
- **Whose eyes.** `viewId` is the consumer: the session excludes the sheet's own clause and applies each edge's response, so selecting a row never makes the sheet's other rows vanish. Rows that failed the incoming clauses are already absent — the engine filtered them; the sheet did not hide them.
- **The window names the key.** `SheetWindow.key` is the declared row key's column: what the grid moves to the front, freezes **first**, and selects on. It is never hidden and never moved out of first place — it is the row's identity. A host never has to hand it in (the facets are still worth handing in, for types and roles).
- **The capped canvas keeps both ends exact.** 1M rows × 28px is 28 million pixels, past what a browser will lay out, so the canvas is capped at `canvasMax` (10,000,000 px) and the scrollbar becomes a shorter ruler. The map is between what can be *scrolled* and what can be *shown* — `scrollTop ∈ [0, canvasHeight − bodyHeight]` ↔ `first row ∈ [0, count − visibleRows]` — so **the last row is always reachable** and a row → scroll → row round trip returns the row it started from. The rows layer is drawn from the viewport's top edge (scrolling is row-quantized by construction) and is never allowed to reach past the canvas, which would invent scrollable space below the last row.
- **One block cache, two keys.** The **question** (table, viewId, columns, sort) says which rows in what order; change it and the blocks are forgotten. The **stamp** (version, cursor) rides beside it: the blocks wear the stamp of the ANSWER that filled them, never of the ask. A host whose polled cursor is one poll behind therefore asks with the old stamp, gets an answer stamped with the live one, and it applies — no refusal — and the next ask (with the caught-up prop) is a hit. Only an answer whose own stamp differs from the blocks' replaces them: two versions never share a grid. An answer to a question the cache has since LEFT is dropped rather than written into the new question's blocks — the cache enforces its own law, so a host driving it directly (a future AG Grid adapter) gets the same guarantee the `<Sheet>` does. Blocks are `blockRows` (100) rows, at most `maxBlocks` (50), evicted least-recently-served first. A miss is fetched as ONE range, never one call per block.
- **Answers apply in request order.** Every ask takes a sequence number; an answer below the last applied one is dropped silently — a fresher answer is already on screen, and there is nothing to tell.
- **Nothing breaks quietly.** A data layer that throws, a door that cannot be reached, a 200 that is not a window, a schema that fails — each becomes a sentence in the status line beside the rows already on screen, which keep the version they were read at. A refused window never clears the grid.
- **Headers carry the name, the type** the tally settled on, and a **role badge** when the role changes what the column is (`identifier`, `measure`, `absence` — a plain dimension gets none). The sort toggle (none → ascending → descending → none) appears **only when `capabilities.sort` is true, the host wired `onSort`, and this is not Present mode** — sorting is an act: an act with nowhere to land is not offered, and reading never rearranges. When the ENGINE is the reason, the header grows a second line and says why, as readable text — a tooltip is not an answer; when the host simply wired no door there is no sentence, because nothing is claimed and nothing is hidden (see "The sort is an act" below). And an engine that refuses a sort it was sent hands it back to the host to clear, so the readout never claims an order the rows are not in.
- **A row click is a selection, or a refusal.** On a keyed table it emits a `point` on the key column through `onSelect`, and `selectedRowId` marks the row the session's own clause holds. **The second click of a double-click never selects** — the first one already did, exactly as a spreadsheet behaves. On a **positional** table the click is refused in the status line: *"this table declares no row key — a row cannot be selected; declare `key` on the table"*. `readOnly` (Present mode) closes the door.
- **A cell edit is refused with a next action.** Double-click a cell and the status line says *"‹column› is a source column — the sheet is read-only in this version; annotate the row instead"*. `capabilities.edit` is `false` by construction: the unit is the column, never the cell.
- **Adding a column is an ACT, not an edit.** `<AddColumn>` is a form beside the grid, never a control inside it, and the grid it sits beside stays exactly as read-only as it was. See "Add a column" below.
- **The status strip is two regions.** The readout (`rows a–b of N · version v · sorted by x ↓ · 3 hidden`, never a range past the count) is `aria-live="off"` because it changes on every scroll; the refusals sit in their own `role="status" aria-live="polite"` and are the only thing announced. The hidden **count** is a fact about the *table*, not about the window — a grid missing a column looks exactly like a table that never had one, and a person who cannot see that something is hidden cannot ask for it back.
- **Every header carries an arrange menu** — hide, move left, move right, move first, freeze up to here / unfreeze — when the host wired `onArrange` and this is not Present mode. One item is one act. It opens as a strip below the rows (paid for out of the body's height, exactly as the find strip is), takes the focus, walks under the arrows, and closes on Esc with the focus back on the header it came from. An item that would change nothing is not offered.
- **Memoize the adapter.** `data` is part of the question: a new `httpSheetData(…)` built on every render is a new data layer every render. Build it in a `useMemo` keyed on the facts (endpoint, table, the schema's values — not the poll's object identity).
- **Mount it once the state knows the version**, or the first paint asks once for the unknown version and again when it arrives. The gallery's sheet page shows the pattern.
- **Height.** Give `height` (the OUTER height, frame included) and the sheet uses it; leave it out and the sheet measures the box it was given with a `ResizeObserver` and follows it. A host without one keeps the first measurement.
- **Keyboard: APG grid keys.** Arrow keys move the focused cell, Home/End move to the first/last column of the row, PageUp/PageDown move a page of rows; the scroll follows the focus. A move onto a row this window does not hold yet KEEPS the intent until the row arrives, then takes the DOM focus — it is never dropped on a render that could not honour it. **The intent never outlives its own ask**: a newer ask, a refused window, focus leaving the grid, or any pointer press anywhere drops it, so a window that lands minutes later can never reach across the page and steal focus from whatever a person is typing in. The focus is taken only after a keyboard move, never on first paint.
- **Find (Ctrl+F) is a READ, and only the engine can answer it.** The strip asks the port where the next match is — in the same order and through the same eyes the window was read with — and the grid then STANDS there: the focused cell moves and the scroll follows. Nothing is filtered, nothing lands, and `readOnly` does not close it (see "Find (Ctrl+F) is a read too" below).
- **A clause that filtered nothing SAYS so.** A selection on another view can reach this sheet naming a column this table does not have. The rows come back whole and correct — which is the problem: someone brushed another view and is looking at a sheet that ignored them. The engine states the fact on the window (`ReachingClause.narrowed`, from `src/session/clausesReaching.ts`); `narrowedSaid` reads it out in the polite region, one sentence per narrowed clause: *"the selection from ‹view› filtered nothing here · ‹the library's reason, quoted›"*. The reason is **never re-worded** — it is the same sentence the export receipt and `why()` carry — and all the grid adds is which view's gesture it was, which is a fact about the window and not about the table.

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

### …and so are `hidden`, `order` and `frozen`

**One law, four props, one road.** Each is one `(scope, prop)` pair under `layout:sheet:<viewId>` — last-wins, inert, restored per cursor, **no new verb**. Two of them earn the act as plainly as the sort does: **hiding** a column changes what the next window is even *asked for*, and **order** changes what "the first column" means to every later reader. `frozen` moves no data, but a story page that came back with three columns unstuck from the left edge would be showing a different sheet than the one a person left.

```tsx
// ONE act per gesture, through one door — the host lands it and hands it back
<Sheet
  hidden={sheetHiddenOf(state.layouts, 'sheet')}
  order={sheetOrderOf(state.layouts, 'sheet')}
  frozen={sheetFrozenOf(state.layouts, 'sheet')}
  onArrange={(prop, value) => void view.setSheetArrangement('sheet', prop, value)}
/>

// "hide" on the `cases` header lands exactly one commit:
//   viewId  layout:sheet:sheet   field  hidden   value  ["cases"]
//   cause   "sheet: hid cases"
// "move first" on `region`:      field  order    value  ["region"]
//   cause   "sheet: moved region first"
// "freeze up to here" on the second column:
//                                field  frozen   value  2
//   cause   "sheet: froze 2 columns"
// and "show all" in the status strip:  value  ""  ·  cause "sheet: showed every column"
```

Six rulings ride with them, each one a test:

- **R1 — three more props on the same scope, the same door, no verb.** `hidden` is a JSON list of column names, `order` a JSON list (the *leading* order — columns it does not name follow in the engine's own), `frozen` a JSON number (how many leading columns stay put under horizontal scroll). One JSON grammar reads all four, so there are never four parsers to disagree about a blank value or a poll's `null` leaf. `sheetHiddenOf(state.layouts, 'sheet')` → `['cases']`.
- **R2 — one act is one prop.** `setSheetArrangement(viewId, prop, value)` generalises `setSheetSort` (kept as a one-line wrapper, so nothing public broke), and the plain words are written by ONE owner, `arrangementWords`, beside `sortWords`: `sheet: hid cases` · `sheet: showed cases` · `sheet: hid 3 columns` (a whole list landed at once — the menu only ever changes one) · `sheet: moved region first` · `sheet: order region, date, cases` · `sheet: froze 2 columns` · `sheet: unfroze`. The **before** comes off the fold the view already holds at the cursor, never from the caller: "hid cases" and "showed cases" are the same act with the sign reversed, and only the trace can say which one this is.
- **R3 — the key is never hidden and always frozen first.** It is the row's identity: a row click selects on it, the window names it, and a grid whose identity column had scrolled away or vanished could still be scrolled but no longer read. Its header therefore offers nothing to hide and nothing to move, `frozen` counts *from* it (so there is no zero — `frozen: 1` and no arrangement at all are the same arrangement), and a trace that names it in `hidden` anyway is refused in the status line — *"the key column id is the row's identity — it cannot be hidden"* — with the column still on screen and not counted as hidden.
- **R4 — a hidden column is not read.** The window request's `columns` **is** the arranged visible projection, so the engine never ships a column nobody is looking at, and `<ExportRows>` handed the same projection walks the same ones (its receipt says which). **This is why `hidden` is worth an act at all**: like the sort, it changes what the next question is asked *of*. (An arrangement that names columns is applied only once the sheet knows which columns the table has; the ask before the schema lands is the same one it always was.) **The one read it does not narrow is FIND**, and deliberately: the port's default is the text columns of the projection *at the cursor*, and which columns are "text" is the library's judgment — naming the visible ones here would search the numbers among them too (`findInView`: "a number column is searched only when it is named") and put a second judge of the same question in the grid. So a find can still land on a row whose matching cell is hidden; the position and the count stay honest, and the way to see the match is the "show all" beside the readout.
- **R5 — Present mode closes the door**, and a sheet given no `onArrange` offers nothing: no menus, no "show all", and nothing said about a door that is not there — the sort's law, applied to the other three. What the trace holds is still *honoured*: reading a story page shows the sheet a person left, frozen columns and all.
- **R6 — a prop the trace holds for a column the table no longer has** (a branch without the derived column, a refreshed schema) is ignored for that column and said once — *"the arrangement names rate, which this table does not have"*. Never a broken grid, and never a silent rewrite of the trace: rewriting it to match would be forging the record of an act.

One corollary the rulings do not name: an arrangement *can* hide every column (no menu will do it — the key is never hidden — but a hand-landed act on a keyless table could). The sheet then asks for **no window at all** and says *"the arrangement hides every column — show one to read the rows"*, because an empty projection would come back as the whole table: the opposite of what the trace says.

**The frozen columns have one mechanism.** The key was already sticky on its own CSS rule; now every frozen cell is `position: sticky` at the *cumulative* offset of the columns before it, which is why `SHEET_COLUMN_WIDTH` exists — a copy of the stylesheet's one cell width, pinned against `styles.css` in `Sheet.test.tsx`, because `sticky` needs a `left` in pixels and only the layout knows one.

**Why the value is JSON** and not a joined string like the cockpit's `order`: this folder already ruled on it one file over. `httpSheetData` sends `columns` and `sort` as JSON because *"a column may be called `a,b`; a joined list could not carry it"* — the same hazard, already decided. JSON also round-trips `absent` and a multi-key spec exactly, so nothing is silently truncated. The plain words a reader sees ride the cause's **intent**, exactly as `setLayout`'s do: the value is for the machine, the intent is for the reader. Reading one back is **total** — a blank value, a leaf that is not text at all (a poll's JSON can carry `null` there), text that is not JSON, a half-written key, or a key carrying a slot this version does not know all read as *no sort*, never a guessed one. That last one matters most: the window port silently drops a prop it cannot name, so honouring the rest of a newer wire's key would put the grid in an order nobody asked for.

**The alternative was considered and refused.** "Sort is a read, like scrolling — so lift it into view state a bookmark and the story payload carry" fails on the library's own laws: a bookmark is a name on a moment that explicitly *saves no state*, and the story payload carries the log, the bookmarks and the saved pictures — the trace and the stores beside it. Making a sort survive that way means inventing a second persistence channel next to the trace, which is the one thing this library exists not to do. The trace already had a place for it.

### Where the code lives

| file | what it owns |
|---|---|
| `arrangement.ts` | the identity (`layout:sheet:<viewId>`), the ONE JSON grammar and the four codecs, one reader per prop (`sheetSortOf` / `sheetHiddenOf` / `sheetOrderOf` / `sheetFrozenOf`, all over `sheetArrangementOf`), `arrangeColumns` (the visible projection + the names the table lacks), `arrangeItems` (what a header's menu offers), `arrangementSaid` (what the status line says about the arrangement itself), and every word an act is said in — `sortArrow`, `sortPhraseOf`, `sortedByWords`, `sortWords`, `arrangementWords`. Pure — no React, no session |
| `Sheet.tsx` | renders the arrangement, asks through `onSort` / `onArrange` (both closed in Present mode), owns `noSortWords` — why a header has no toggle, when the answer is the engine's — and owns the geometry: `SHEET_COLUMN_WIDTH` (the frozen columns' offsets) and `SHEET_ARRANGE_HEIGHT` (the menu strip, paid for out of the body). It spends `arrangement.ts`'s words rather than writing its own |
| `../adapter/sessionView.ts` | `setSheetArrangement` (the act, one prop at a time, over both sources), `setSheetSort` (its one-line wrapper) and `SessionViewState.layouts` (every layout scope, not only the cockpit's) |
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

## Copy and export are reads

```tsx
<ExportRows data={sheetData} table="cells" viewId="sheet" columns={visible} sort={sortAtCursor} />
```

**A copy is a READ, so nothing lands on the log — and `readOnly` does not close
this door.** Every other door in this folder is an act: adding a column, cutting
a table, landing a sort. This one is not. Downloading the rows does not change
what the dashboard says, so there is no cause to stamp, no commit to write, and
nothing to replay. Present mode is *reading*, and this is reading — which is
exactly why Ctrl+C works in Present mode where a cell edit never will.

**What leaves carries its ADDRESS.** The download is two files: the rows, and a
receipt naming the table, the view, the version, the cursor, the sort, the
columns, the count, how many rows actually left, whether it truncated, and the
clauses that reached the view. The receipt is there so a reader can come back to
the exact state the file was read at — the cursor is the address, the clauses are
the courtesy copy. Both files, and the walk that builds them, are the LIBRARY's
(`vizfootprint/session`'s `exportWindows`; the laws are in
[`src/session/README.md`](../../../src/session/README.md), "Export is a read that
carries its address"). This component places a form beside the grid, the way
`<AddColumn>` does, and hands the files somewhere — nothing more.

Two examples, and they are the two halves of the law:

```tsx
// the whole window, with its address. Nothing is written to the log; the offer says
// what will leave BEFORE anything leaves:
//   "Download 2,431 rows as CSV, as they read at version 12 — with the receipt that names the cursor"
<ExportRows data={sheetData} table="cells" onDeliver={(files) => files.forEach(save)} />
// → cells.csv + cells.receipt.json, and the sentence
//   "downloaded cells.csv and cells.receipt.json (2,431 rows)"
```

```tsx
// one cell, from the grid itself. Ctrl+C / Cmd+C copies the FOCUSED cell —
// in Present mode too, because it is a read:
//   "copied jurisdiction of row 1"
// and when the browser says no, it says so where every other refusal is said:
//   "the browser refused the clipboard: document is not focused"
<Sheet data={sheetData} readOnly />
```

Two laws hold that one cell to the same standard as the window:

- **What leaves is written by the LIBRARY.** The clipboard gets
  `cellString(value)` — the same formatter the CSV body is built with — so a date
  copies as its ISO instant and an object as its JSON, never as
  `[object Object]`. `cellText` in `Sheet.tsx` stays the DISPLAY's formatter; a
  display may shorten what a copy must not.
- **The browser's own copy is never swallowed for nothing.** `preventDefault()`
  fires only when there IS a focused cell to copy; on an empty or refused window
  the key is left to the browser and the note says why the cell did not go. The
  clipboard door itself is `./clipboard.ts` — `writeClipboard`, `NO_CLIPBOARD`,
  `clipboardRefusal` — shared by the form and the grid, so a copy never reads two
  ways and a `<Sheet>` never reaches through the export form to find a clipboard.

Three more things it owns, and nothing else:

- **The format choice** (CSV or TSV) for the download; a **Copy** always writes TSV,
  because that is what a spreadsheet reads from a paste.
- **The count before the click**, from one probe window of a single row — the
  smallest window every door answers (`limit: 0` is legal in the library, but a
  door on the far side of HTTP may refuse a window asking for no rows). The offer
  is a courtesy; the receipt is the record, written from the walk's own first page.
- **The ceiling said out loud.** Past `EXPORT_ROW_CEILING` (200,000 — a policy
  number, not a measurement) the offer reads *"the first 200,000 of 1,285,614
  rows"* and the receipt carries `truncated: true`. Omit, never deny.

A version or cursor that moves between pages refuses the WHOLE export
(*"the table moved while exporting (version v1 → v2) — export again"*): two
versions never share a file. Pinned by `ExportRows.test.tsx` and, for the grid's
one-cell copy, by `Sheet.test.tsx`.

## Find (Ctrl+F) is a read too — it moves where you STAND

```tsx
<Sheet data={sheetData} readOnly />   // Ctrl+F works here too: reading is what a find is
```

**Nothing is filtered and nothing lands.** Ctrl+F / Cmd+F opens a strip between
the rows and the readout; typing and pressing Enter moves the sheet's focused
cell to the next matching row and scrolls it into view. The rows are the same
rows before and after — a find changes where a person is standing, exactly as a
scroll does. An agent that wants fewer rows FILTERS, which is an act with a
cause; this is a read, so `readOnly` does not close the door (the same law
Ctrl+C follows above).

**The engine answers, not the grid.** The strip asks
`SheetData.find({ text, from, direction, sort?, viewId? })` and the port asks the
session, which asks the engine — "the position of the next match in THIS order"
cannot be answered without walking the table, so the grid never walks it. The
`sort` and `viewId` it asks with are the ones the WINDOW was read with, which is
what makes the answer's `position` the `offset` the grid then opens at. The laws
of the answer itself are the library's:
[`src/data/README.md`](../../../src/data/README.md), "A find is a READ, and it is
a TEXT question", and
[`src/session/README.md`](../../../src/session/README.md), "Find is a read too".

**Four sentences, and each one is said in the status line:**

| what happened | what it says |
|---|---|
| a match | `match 3 of 12 · row 1,204` |
| the walk ran out and came round | `match 1 of 12 · row 3 · wrapped to the top` |
| nothing in the view holds it | `no cell contains “zebra”` |
| the port refused (empty text, a moved version, an engine that cannot) | the port's OWN sentence, unedited |

**Where a walk starts, and the one place it wraps.** "Next" starts at the row
AFTER the one you are standing on and "previous" at the one before it, so
pressing next twice never lands twice on the same row. Both ends round: previous
on row 0 asks from the last row, and next on the last row asks from 0 — `from: -1`
is a MALFORMED ask, and a person pressing previous at the top means "wrap", not
"show me a refusal". When a walk runs out mid-table (the door answers
`position: null` with `matches > 0`) the grid asks **once** more from the other
end and says that it wrapped. The door itself never wraps; wrapping is a
decision, and the grid makes it out loud.

**Focus, and why Esc exists.** A found row is MARKED (the focused cell moves to
it) and scrolled to, but the DOM focus stays in the input — a person mid-search
is going to press Enter again. **Esc** closes the strip and hands the focus to
the row the find landed on, through the same keep-until-it-arrives intent a
keyboard move uses, so it works even when that row's window has not arrived yet.
Shift+Enter is "previous"; the strip also has next / previous / close buttons.
Ctrl+F pressed again — from the input or from the rows — puts the caret back in
the input with the text selected to type over, because a key whose default was
swallowed must always do something.

**A port that cannot find shows the sentence and no input — and leaves the
browser's own find alone.** `capabilities.find` is the claim and `find` is the
door; a port missing either is treated as refusing, and the strip renders
`capabilities.findRefusal` (or `SHEET_CANNOT_FIND`) where the input would have
been — an input that cannot answer is worse than no input. Ctrl+F's default is
**prevented only when the port can actually answer** (the same law Ctrl+C
follows: prevented only because a cell IS going to the clipboard), so on such a
port the person gets the sentence AND keeps the find their browser already gave
them. `httpSheetData` without a `findEndpoint` says
*"this door answers windows only — no find door was given"*; a stub-engine table
says the session's own *"the server engine cannot find — filter instead"*.

## The port

`SheetData` (`./types.ts`) is React-free and core-free at the type level — only TYPES come from `src`. It is four things: `capabilities` (each `false` naming its refusal sentence), `columns()` (name, type, role), `rows(window, { signal })` answering a window **or** a refusal, and the OPTIONAL `find(ask, { signal })` answering where the next match is **or** a refusal. There is no third arm on either read: an empty grid never stands in for an answer nobody gave, and neither does an unmoved cursor.

Two adapters ship. `sessionSheetData` is in process: a translation and a refusal pass-through over `session.viewQuery`, which turns a throw into a sentence and drops a window whose signal was aborted. `httpSheetData` speaks `GET <endpoint>?table=&viewId=&columns=&sort=&offset=&limit=` with `columns` and `sort` as **JSON** (a column may be called `a,b`; a joined list could not carry it) and validates what comes back — a refusing door's own `error` sentence is the one shown. Its find door is `POST <findEndpoint>` with the `FindQuery` as the body: a person's typing and a sort spec do not belong in a URL a proxy logs, and a query string that changes on every keystroke is a cache key per keystroke. It is a read all the same.

## Deliberately not here yet

- **A row on a KEYLESS table cannot be selected in this version.** The design calls for a "within-version marked point" — a selection on `<version>#<index>` that a bookmark records as valid only inside that version — and the library port does not express one yet: `ViewQueryResult` carries the positional row id but nothing consumes it as a clause. **That is a pending library decision**, not an oversight here; until it lands the sheet says so in words rather than inventing an identity.
- **`firstRow`** — the last of the arrangement props, and the one to think twice about. `sort`, `hidden`, `order` and `frozen` all land (see "The sort is an act" and the section after it); a scroll position is a READ by this folder's own law, and it would be here only as a place to RESUME, never as a claim about an order.
- **A profile per column** — the quality bar, the distribution mini-bar, the distinct count, the absence tally. They come from ONE fold per (table, version, visible overlay set), which does not exist yet; a header that guessed them from the rendered window would be lying about 90,300 rows while showing 30.
- **The formula bar**, the why panel, cell edits, and the AG Grid adapter — each is its own packet. (Derived columns arrived: see "Add a column" above; copy and export arrived: see "Copy and export are reads"; find arrived: see "Find (Ctrl+F) is a read too".)
