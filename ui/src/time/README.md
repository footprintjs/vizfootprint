# time — the time-travel bar

`<TimeTravelBar>` is the cockpit's strip over the commit log: Explore walks every commit, Present walks the named checkpoints (the beats).

## The rail law

The compact strip is **one row, always** (above phone widths). The timeline rail is given a width by the header and its ticks share it: a comfortable 28px with the commit's id beneath while there is room, narrower as commits pile up, ids hidden first (dense, under 18px), never under 6px — past the minimum the rail scrolls. A tick is never dropped: every commit stays reachable. `railTick(width, count)` is the pure rule; `useRailTicks` re-measures on resize and sets `--vzf-tick` on the rail. Back and forward sit side by side before the rail, so a hand never crosses it.

"Viewing the past" is a small clock mark in the compact strip (the sentence rides its title and its accessible name) and a banner in the full bar — a banner in one row would squeeze the rail to nothing.

## Present mode

Beats are ordered along the presented lineage (root → tip, see `presentBeat.ts`), never by arrival; prev and next seek the session to the position a beat names. `onPlay` hands the host the slideshow — see `layout/README.md`.

## Not here, on purpose

The bar never records anything itself: every gesture is a call the host turns into a commit through the adapter.
