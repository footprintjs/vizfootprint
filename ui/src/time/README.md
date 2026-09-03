# time — the time-travel bar

`<TimeTravelBar>` is the cockpit's strip over the commit log: Explore walks every commit, Present walks the named bookmarks.

## The rail law

The compact strip is **one row, always** (above phone widths). **The rail's width is FIXED** — the rail owns it (`--vzf-rail-w`, 360px unless a host tunes the dial); the header does not hand it out, the bars cannot change it, and the commits never change it. (A rail that took its width from the header was content-sized wherever the header cell was, and shrink-wrapped the bars.) The count only decides how the bars *share* that width: with N commits each bar is `(width − the gaps) / N`, so **one commit fills the rail, two take half each, four take a quarter each**, and so on, with no upper limit. Two floors keep it usable as commits pile up: a bar's id hides once the bar is narrower than 18px (dense), and a bar never goes under 6px — past that the rail scrolls instead. A bar is never dropped: every commit stays reachable. `railTick(width, count)` is the pure rule; `useRailTicks` re-measures on resize and sets `--vzf-tick` on the rail. Back and forward sit side by side before the rail, so a hand never crosses it.

Each commit is a **rectangle**, not a dot: full-width in its share, 2px radius, 4px gap, one 1px border. The rail's height is fixed too — the flag row and the id row are fixed boxes and the bar takes what is left, so a dense rail (ids hidden) is exactly as tall as a labelled one and the dashboard beneath never jumps.

The bars are **grey on purpose** — no chart on the dashboard draws in these tones, so the rail never competes with the data. The one distinction a bar carries is *who did it*: a commit the person made is the light grey, a commit that was not theirs (the analyst, the system) is the darker grey. The cursor's bar is filled near-black — the rail's one strong mark; the head keeps a thin neutral rim, and bars ahead of the cursor (the future one is looking back from) go dimmer still. Only the ⚑ on a bookmark keeps a colour. The greys are the `--vzf-tl-bar*` custom properties on `.vzf-timeline`; tune them there.

"Viewing the past" is a small clock mark in the compact strip (the sentence rides its title and its accessible name) and a banner in the full bar — a banner in one row would squeeze the rail to nothing.

## Present mode

Bookmarks are ordered along the presented lineage (root → tip, see `presentBookmark.ts`), never by arrival; prev and next seek the session to the position a bookmark names.

**Which commit a bookmark names is answered in exactly one place**, and `presentBookmark.ts` is it: `bookmarkTarget(record)` for a record you already hold, `bookmarkRefTarget(bookmarks, ref)` for the id a note's `@[bookmark]` link carries (a label is accepted second, for words written before bookmarks had ids). They are one rule called two ways. A consumer that finds the record itself and reads `.commitId` off it has written a second, different resolver: for a legacy `bookmark:` commit `commitId` is the ACT of naming and `at` is the moment NAMED, so the slideshow and a note anchor would seek two different commits for one bookmark. That is not hypothetical — it is what the demo shipped until this rule was written down. `onPlay` hands the host the slideshow — see `layout/README.md`.

## Not here, on purpose

The bar never records anything itself: every gesture is a call the host turns into a commit through the adapter.
