# time — the time-travel bar

`<TimeTravelBar>` is the cockpit's strip over the commit log: Explore walks every commit, Present walks the named bookmarks. It renders a `TimeTravelModel` and nothing else.

## Three layers, one door

| layer | file | job |
|---|---|---|
| data logic | `model.ts` · `timeTravelModel` | Everything the bar shows, derived once from commits, cursor, head and bookmarks. No React, no styling, no words. It composes the step rules (`adapter/stepNav.ts`) and the bookmark rules (`presentBookmark.ts`) and restates neither. |
| door | `useTimeTravel.ts` · `TimeTravel`, `useTimeTravel`, `timeTravelOf` | `TimeTravel` is the interface: a model, `viewingPast` and five actions, each handing back what the session said. `useTimeTravel(view)` is the adapter that fills it from a session view. |
| component | `TimeTravelBar.tsx` | Draws the model. It imports no rule and derives nothing from the log. |

Why: a consumer can keep the data logic and draw their own bar, or keep the bar
and feed it from their own store. Before this split the bar worked out the
lineage, the step targets and the bookmark order inside its render function, so
neither half could be replaced without forking the other.

### Use the bar over a session view

```tsx
const time = useTimeTravel(view);
<TimeTravelBar {...time} compact />
```

### Keep the data logic, draw your own bar

```tsx
const { model, onSeek } = useTimeTravel(view);
<ol>
  {model.explore.bars.map((bar) => (
    <li key={bar.id} aria-current={bar.cursor ? 'step' : undefined} onClick={() => onSeek(bar.id)}>{bar.label}</li>
  ))}
</ol>
```

### Keep the bar, bring your own store

```tsx
const model = timeTravelModel({ commits, cursor, head, bookmarks, pathCount, pathName });
<TimeTravelBar model={model} onSeek={mySeek} onStepBack={myBack} onStepForward={myForward} />
```

### What the model will not pretend

- **A cursor that is not in the log.** The model draws the head's lineage, marks
  no bar as the cursor, and sets `coverage.cursorMissing`. The rail's sentence
  then says "the cursor is not among the recorded steps". The bar used to draw
  no bars at all and say "no commits yet" over a log that had some.
- **A cursor with no bookmark at or behind it, in Present mode.** The first
  bookmark is shown as current and `present.exact` is false; the bar adds
  "(nearest to cursor)". Known limit, kept from before this split: the first
  stop is not computed to be the nearest, it is still drawn as the current
  one, and "next" therefore skips it. Making no stop current in that state is
  a behaviour change and is left for its own pull request.
- **A log with steps and no lineage to draw** (no head, no cursor). The rail
  says so. "No commits yet" is said only of an empty log.

## The rail law

The compact strip is **one row, always** (above phone widths). **The rail's width is FIXED** — the rail owns it (`--vzf-rail-w`, 360px unless a host tunes the dial); the header does not hand it out, the bars cannot change it, and the commits never change it. (A rail that took its width from the header was content-sized wherever the header cell was, and shrink-wrapped the bars.) The count only decides how the bars *share* that width: with N commits each bar is `(width − the gaps) / N`, so **one commit fills the rail, two take half each, four take a quarter each**, and so on, with no upper limit. Two floors keep it usable as commits pile up: a bar's id hides once the bar is narrower than 18px (dense), and a bar never goes under 6px — past that the rail scrolls instead. A bar is never dropped: every commit stays reachable. `railTick(width, count)` is the pure rule; `useRailTicks` re-measures on resize and sets `--vzf-tick` on the rail. Back and forward sit side by side before the rail, so a hand never crosses it.

Each commit is a **rectangle**, not a dot: full-width in its share, 2px radius, 4px gap, one 1px border. The rail's height is fixed too — the flag row and the id row are fixed boxes and the bar takes what is left, so a dense rail (ids hidden) is exactly as tall as a labelled one and the dashboard beneath never jumps.

The bars are **grey on purpose** — no chart on the dashboard draws in these tones, so the rail never competes with the data. The one distinction a bar carries is *who did it*: a commit the person made is the light grey, a commit that was not theirs (the analyst, the system) is the darker grey. The cursor's bar is filled near-black — the rail's one strong mark; the head keeps a thin neutral rim, and bars ahead of the cursor (the future one is looking back from) go dimmer still. Only the ⚑ on a bookmark keeps a colour. The greys are the `--vzf-tl-bar*` custom properties on `.vzf-timeline`; tune them there.

"Viewing the past" is a small clock mark in the compact strip (the sentence rides its title and its accessible name) and a banner in the full bar — a banner in one row would squeeze the rail to nothing.

## One keyboard stop

A rail is one stop in the tab order, however many bars it draws. Every bar used to be a stop, so a history of two hundred steps put two hundred stops between the mode switch and the bookmark button, and a screen reader heard `#s14 select` with no word on where in the history that was.

- **Tab** lands on one bar: the cursor's, or the head's when the cursor is on no bar, or the last one. The model names it (`explore.stop`); the component does not work it out.
- **The stop follows the focus while the keyboard is inside the rail** (`railTabStop(ids, focused, stop)`). A browser's Tab moves on from the focused element, so a stop left behind on the cursor's bar would be a second stop on the way out. Once the focus leaves the rail the stop is the model's again, so coming back lands on the cursor.
- **Left / Right** move along the bars, **Home / End** jump to the ends, and the ends do not wrap. With Alt, Ctrl or Meta held a key is the browser's or the system's and the rail leaves it alone. A key the rail handles goes no further, so a host's own arrow-key handler does not also act on it. The rule is `railKeyTarget(count, at, key)` in `railKeys.ts`: an index in, an index out, no React.
- **Moving is not travelling.** Arrow keys move the focus only. **Enter** or **Space** on a bar goes there, as a click does. A person can read along a history without changing where they stand.
- **Each bar says where it stands:** `step 3 of 40: #c2 select c2, bookmarked`, and `now` on the head. The cursor's bar is `aria-current="step"`. Present mode does the same over the bookmarks (`bookmark 2 of 3: middle`); when the cursor stands on no bookmark and has none behind it, the first bookmark takes the stop and none is called current. How the keys work is the rail's description (`aria-describedby`), not part of its name.

```tsx
import { railKeyTarget, railTabStop, timeTravelModel } from 'vizfootprint-ui';

// your own rail, the same keys
const { bars, stop } = timeTravelModel(input).explore;
const tabStop = railTabStop(bars.map((b) => b.id), focusedId, stop);   // focusedId: your own state, null outside the rail
<div role="group" onKeyDown={(e) => { const to = railKeyTarget(bars.length, focusedIndex, e.key); if (to !== null) focusBar(to); }}>
  {bars.map((b) => <button key={b.id} tabIndex={b.id === tabStop ? 0 : -1} aria-current={b.cursor ? 'step' : undefined}>…</button>)}
</div>
```

It is deliberately not `role="slider"`: a slider's arrow keys change its value at once, and here that would travel through history on every key press. The two step buttons beside the rail keep doing exactly that, one step at a time.

## Present mode

Bookmarks are ordered along the presented lineage (root → tip, see `presentBookmark.ts`), never by arrival; prev and next seek the session to the position a bookmark names.

**Which commit a bookmark names is answered in exactly one place**, and `presentBookmark.ts` is it: `bookmarkTarget(record)` for a record you already hold, `bookmarkRefTarget(bookmarks, ref)` for the id a note's `@[bookmark]` link carries (a label is accepted second, for words written before bookmarks had ids). They are one rule called two ways. A consumer that finds the record itself and reads `.commitId` off it has written a second, different resolver: for a legacy `bookmark:` commit `commitId` is the ACT of naming and `at` is the moment NAMED, so the slideshow and a note anchor would seek two different commits for one bookmark. That is not hypothetical — it is what the demo shipped until this rule was written down. `onPlay` hands the host the slideshow — see `layout/README.md`.

## Not here, on purpose

The bar never records anything itself: every gesture is a call the host turns into a commit through the adapter.
