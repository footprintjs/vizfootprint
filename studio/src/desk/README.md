# `src/desk` — how the shell is put together

The argument for the desk is in [`../../README.md`](../../README.md). This is the
map of the files, for whoever is about to change one.

| file | one job |
|---|---|
| `types.ts` | THE CONTRACT — `DeskProps`, `DeskProjection`, `DeskChart`, and the law they encode. Read this first; every other file here is an implementation of a line in it. |
| `Desk.tsx` | the shell: the session's lifetime, the top strip, the band, the aside, the menu, the reports, present mode. The only file that knows the whole. |
| `projection.tsx` | the session → `DeskProjection`. Every field is a projection or an act; nothing here re-derives a fact from the log. |
| `prose.tsx` | the words plane, drawn: a view's slots with their author and staleness, the dashboard summary, the drafts. |
| `notes.tsx` | the Text tool: notes as cells, opened-not-committed. |
| `figure.tsx` | the pinned figure — `pickFigureCells`, its refusal sentence, `FigureGrid`, `DeskFigure`. Shared by the Story tab and the story page. |
| `tokens.ts` | the seventeen names, their defaults, and why they are inline rather than a stylesheet. |
| `JumpBox.tsx` | "go to #34". |
| `WindowReadout.tsx` | the default status line — a screenshot that answers its own layout question. |
| `panels/` | the four report bodies whose words are the desk's: `SilencesPanel`, `ProposalsPanel`, `DataPanel`, `PathsPanel`, plus `StoryPanel` and the post it memoizes. |

## Three rules for changing anything in here

1. **Before adding a prop, ask which session call already answers it.** If one
   does, the desk should be reading it, not being told it. `types.ts`'s header
   says why.
2. **A panel whose words are about the DATA belongs to the host.** The silences
   panel is the line: the desk draws the groups and owns the restraint (a group
   with nothing in it says "none this week" rather than vanishing), and the host
   supplies both the groups and the sentence explaining what its own vocabulary
   means, because no shell can know that.
3. **A new report or menu item goes into `ownReports` / `ownMenu` in
   `Desk.tsx`**, in the position it should hold by default — the host combinator
   receives that list and may reorder it, so the default order is a real design
   decision and not an accident of insertion.
