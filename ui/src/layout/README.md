# layout — the cockpit

`<VizCockpit>` is the shell: the time-travel strip pinned on top, the charts band filling the rest, report chips and a status readout on the bottom, an aside that pushes the charts rather than covering them.

## The laws

- **The cockpit fills the window and never scrolls.** The band's rows are `1fr`; a dashboard that does not fit is a layout bug to find, not a scrollbar to hide it behind. The top strip is a fixed number of rows, so the charts never jump.
- **The menu (☰)** holds the host's acts in the host's words (`menu`): one popover, Escape or a click outside closes it, disabled items carry a hint that says why.
- **Every editable chart wears its own ✎** (`CockpitChart.onEdit`), shown on hover and focus, always on touch — never a floating button over the cockpit. Present mode hides it.
- **Present mode as a slideshow** (`slideshow`): the dashboard itself is the slide. The host seeks the session to each named checkpoint and hands the cockpit the beat's title and the dashboard's words at that moment; the cockpit takes the screen (fullscreen when the browser allows; the show still runs in the window when it refuses), hides every strip but a slim slide bar, and walks prev/next on the arrow keys and space, leaving on Escape. Nothing is recorded in a slideshow: the host keeps the cockpit read-only.
- **Arrangement is a commit.** Flow, grid and focus, drag-to-reorder and the focused chart land through `onLayoutChange` as layout notes on the log, so a beat reproduces the arrangement a person saw.

## Not here, on purpose

The cockpit renders no chart and knows no data: charts are render props sized by their cell; reports are the host's panels; the menu's items are the host's.
