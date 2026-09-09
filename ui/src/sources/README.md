# sources — the Sources tab

The data layer's first tab: one row per table VISIBLE AT THE CURSOR — the declared ones, and the ones an act cut — read from records that already exist. Nothing is inferred from the rows.

```tsx
import { Sources } from 'vizfootprint-ui';

<Sources tables={state.tables ?? []} sources={state.sources} columns={state.columns} journal={state.journal} journalTotal={state.journalTotal} checks={checks} checksError={checksError} onRefresh={(t) => post('/api/refresh', { tables: t })} />
```

## What a row shows

- **from** — the declared source (`format via at`, the locator only when it was a string; an inline payload is never repeated), "inline rows carried by the definition", or "not stated" when the wire's entry could not be read (the table still counts).
- **vouched for** — the provenance the carrier gave when the rows were read: rows, version, retrieved at. A table without a source says it has no version to move.
- **row key** — the declared key, or the sentence that says a refresh replaces the table and no row is addressable.
- **grain** and **absence** — as declared, in words; absence not declared means a row that exists is present by construction.
- **last refresh** — the journal's latest answer for this table: unchanged with its version; changed with from → to and the delta by the declared key (added, updated, removed, rows without a usable key) or a plain replace when no key could be used, plus the columns lost with the old rows; refused with the typed reason and the carrier's sentence; or "an answer the wire could not carry". Beyond the journal's tail the row says "no answer in the latest N refreshes", never "never asked".
- **columns** — how many the def declares, and the columns the engine lists with their types, the first 40 with "+N more".
- **cut by** — for a table an ACT made, and only then: which parent it read, the cursor it read at, what it grouped by and what it measured — *"derived from cells — the rows visible at s12, grouped by region, measuring total"*. The clause about the cursor is the whole law said once: an aggregate is computed over the rows VISIBLE at its cursor, so a row that said only "from cells" would be describing a different act.

## A table an act cut is not a declared one, and the tab never pretends otherwise

- The count keeps two words apart — *"3 tables declared · 1 cut by an act"* — because nobody declared the fourth.
- Its **from** says *"computed here — an act cut these rows from another table"*, and its **vouched for** says *"nobody vouched for these rows — an act cut them, and a refresh of the parent drops them"*. Neither is the inline-rows sentence: a carrier could re-read those; nothing can re-read these.
- It is offered **no refresh door**. The one-table button appears only where a carrier holds the rows; the act is the thing to ask, and the row names it.
- Its **row key** is shown like any other, and it is the one the ACT minted from its single group column — which is what lets a selection on the parent reach it.

## The doors

Refresh (all, or one table) calls the host's door; it is a dashboard-level act the library journals, never a branch commit. A waiting or read-only door keeps focus (`aria-disabled`) and does not fire; a hidden status line announces what the last refresh answered. `checks` are `lintData()` sentences the host fetched: undefined means not asked yet, empty means the declarations agree with the data, and `checksError` says why they could not be read.

## Not here, on purpose

No row preview yet (the real Sheet, next packet — a cut table's rows are one tab over, in the Workbook); no editing of declarations (source, key, grain and the absence vocabulary are dashboard acts); no "used by" (only default-table bindings are knowable today; saying nothing beats saying half); no "declared but not opened" state (a build refuses a source it cannot read, so no such table exists yet — the arm is added when a builder keeps one).
