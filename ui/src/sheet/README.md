# sheet — the read-only Sheet

The rows the charts see, in a scrollable grid. Every visible window is one question the engine answered; nothing here holds a copy of the table.

```tsx
import { Sheet, httpSheetData, sessionSheetData } from 'vizfootprint-ui';

// in process
const data = useMemo(() => sessionSheetData(session, { table: 'cells' }), [session]);
// or over a door that answers the session's ViewQueryResult JSON verbatim
const data = useMemo(() => httpSheetData({ endpoint: '/api/window', table: 'cells', columns: facets }), [facetsKey]);

<Sheet data={data} viewId="sheet" table="cells" height={480} version={version} cursor={state.cursor} selectedRowId={pickedRowId} onSelect={(field, value) => view.emit('sheet', { rawValue: value, encoding: { kind: 'point', field } })} readOnly={presenting} />
```

## The laws

- **The grid is virtualized over the engine.** A window is `viewQuery({ viewId, sort, offset, limit })` — sorted, offset, with a row identity per row — and it answers `{columns, rows, rowIds, positional, key, count, start, version, cursor}`. The count is the engine's, so the scrollbar is never a guess.
- **Whose eyes.** `viewId` is the consumer: the session excludes the sheet's own clause and applies each edge's response, so selecting a row never makes the sheet's other rows vanish. Rows that failed the incoming clauses are already absent — the engine filtered them; the sheet did not hide them.
- **The window names the key.** `SheetWindow.key` is the declared row key's column: what the grid moves to the front, freezes, and selects on. A host never has to hand it in (the facets are still worth handing in, for types and roles).
- **The capped canvas keeps both ends exact.** 1M rows × 28px is 28 million pixels, past what a browser will lay out, so the canvas is capped at `canvasMax` (10,000,000 px) and the scrollbar becomes a shorter ruler. The map is between what can be *scrolled* and what can be *shown* — `scrollTop ∈ [0, canvasHeight − bodyHeight]` ↔ `first row ∈ [0, count − visibleRows]` — so **the last row is always reachable** and a row → scroll → row round trip returns the row it started from. The rows layer is drawn from the viewport's top edge (scrolling is row-quantized by construction) and is never allowed to reach past the canvas, which would invent scrollable space below the last row.
- **One block cache, two keys.** The **question** (table, viewId, columns, sort) says which rows in what order; change it and the blocks are forgotten. The **stamp** (version, cursor) rides beside it: the blocks wear the stamp of the ANSWER that filled them, never of the ask. A host whose polled cursor is one poll behind therefore asks with the old stamp, gets an answer stamped with the live one, and it applies — no refusal — and the next ask (with the caught-up prop) is a hit. Only an answer whose own stamp differs from the blocks' replaces them: two versions never share a grid. An answer to a question the cache has since LEFT is dropped rather than written into the new question's blocks — the cache enforces its own law, so a host driving it directly (a future AG Grid adapter) gets the same guarantee the `<Sheet>` does. Blocks are `blockRows` (100) rows, at most `maxBlocks` (50), evicted least-recently-served first. A miss is fetched as ONE range, never one call per block.
- **Answers apply in request order.** Every ask takes a sequence number; an answer below the last applied one is dropped silently — a fresher answer is already on screen, and there is nothing to tell.
- **Nothing breaks quietly.** A data layer that throws, a door that cannot be reached, a 200 that is not a window, a schema that fails — each becomes a sentence in the status line beside the rows already on screen, which keep the version they were read at. A refused window never clears the grid.
- **Headers carry the name, the type** the tally settled on, and a **role badge** when the role changes what the column is (`identifier`, `measure`, `absence` — a plain dimension gets none). The sort toggle (none → ascending → descending → none) appears **only when `capabilities.sort` is true**; when it is false the header grows a second line and says why, as readable text — a tooltip is not an answer. And an engine that refuses a sort it was sent takes the sort back, so the readout never claims an order the rows are not in.
- **A row click is a selection, or a refusal.** On a keyed table it emits a `point` on the key column through `onSelect`, and `selectedRowId` marks the row the session's own clause holds. **The second click of a double-click never selects** — the first one already did, exactly as a spreadsheet behaves. On a **positional** table the click is refused in the status line: *"this table declares no row key — a row cannot be selected; declare `key` on the table"*. `readOnly` (Present mode) closes the door.
- **A cell edit is refused with a next action.** Double-click a cell and the status line says *"‹column› is a source column — the sheet is read-only in this version; annotate the row instead"*. `capabilities.edit` is `false` by construction: the unit is the column, never the cell.
- **Adding a column is an ACT, not an edit.** `<AddColumn>` is a form beside the grid, never a control inside it, and the grid it sits beside stays exactly as read-only as it was. See "Add a column" below.
- **The status strip is two regions.** The readout (`rows a–b of N · version v · sorted by x ↓`, never a range past the count) is `aria-live="off"` because it changes on every scroll; the refusals sit in their own `role="status" aria-live="polite"` and are the only thing announced.
- **Memoize the adapter.** `data` is part of the question: a new `httpSheetData(…)` built on every render is a new data layer every render. Build it in a `useMemo` keyed on the facts (endpoint, table, the schema's values — not the poll's object identity).
- **Mount it once the state knows the version**, or the first paint asks once for the unknown version and again when it arrives. The gallery's sheet page shows the pattern.
- **Height.** Give `height` (the OUTER height, frame included) and the sheet uses it; leave it out and the sheet measures the box it was given with a `ResizeObserver` and follows it. A host without one keeps the first measurement.
- **Keyboard: APG grid keys.** Arrow keys move the focused cell, Home/End move to the first/last column of the row, PageUp/PageDown move a page of rows; the scroll follows the focus. A move onto a row this window does not hold yet KEEPS the intent until the row arrives, then takes the DOM focus — it is never dropped on a render that could not honour it. **The intent never outlives its own ask**: a newer ask, a refused window, focus leaving the grid, or any pointer press anywhere drops it, so a window that lands minutes later can never reach across the page and steal focus from whatever a person is typing in. The focus is taken only after a keyboard move, never on first paint.
- **A refused sort is remembered.** When the engine says `unsupported-sort` at runtime the sort is taken back AND the sentence is kept for the life of this sheet: the header shows it on its own line from then on, the toggles go, and the status strip keeps it instead of flashing once and vanishing.

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

## The port

`SheetData` (`./types.ts`) is React-free and core-free at the type level — only TYPES come from `src`. It is three things: `capabilities` (each `false` naming its refusal sentence), `columns()` (name, type, role), and `rows(window, { signal })` answering a window **or** a refusal. There is no third arm: an empty grid never stands in for an answer nobody gave.

Two adapters ship. `sessionSheetData` is in process: a translation and a refusal pass-through over `session.viewQuery`, which turns a throw into a sentence and drops a window whose signal was aborted. `httpSheetData` speaks `GET <endpoint>?table=&viewId=&columns=&sort=&offset=&limit=` with `columns` and `sort` as **JSON** (a column may be called `a,b`; a joined list could not carry it) and validates what comes back — a refusing door's own `error` sentence is the one shown.

## Deliberately not here yet

- **A row on a KEYLESS table cannot be selected in this version.** The design calls for a "within-version marked point" — a selection on `<version>#<index>` that a bookmark records as valid only inside that version — and the library port does not express one yet: `ViewQueryResult` carries the positional row id but nothing consumes it as a clause. **That is a pending library decision**, not an oversight here; until it lands the sheet says so in words rather than inventing an identity.
- **Arrangement as a commit.** Sort is LOCAL component state: it is not recorded, does not survive a reload, and time travel does not restore it. Arrangement (`sort`, `hidden`, `order`, `frozen`, `firstRow`) lands as a `navigate` note on `layout:sheet:<viewId>` **with the column verb**, and the window's sort is then derived from that commit at read — never two sources.
- **A profile per column** — the quality bar, the distribution mini-bar, the distinct count, the absence tally. They come from ONE fold per (table, version, visible overlay set), which does not exist yet; a header that guessed them from the rendered window would be lying about 90,300 rows while showing 30.
- **Find (Ctrl+F), copy and export**, the formula bar, the why panel, cell edits, and the AG Grid adapter — each is its own packet. (Derived columns arrived: see "Add a column" above.)
