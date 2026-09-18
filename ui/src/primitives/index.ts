/**
 * primitives/ — the chart-building tier (visx-style): the pieces the five
 * first-party charts are BUILT FROM, published so a consumer-built chart is
 * BORN CONFORMANT. Every primitive carries the renderer contract inside it —
 * compose a chart from these and it emits honest R3 emissions in DATA space,
 * consumes the clause-addressable `RenderSelection` with self-exclusion,
 * never builds a clause, never owns a transform, and wears the shared theme
 * tokens (light + dark, reduced motion respected by the stylesheet).
 *
 *   • `<ChartFrame>`        — measure a cell, fill it (viewBox == CSS box).
 *   • scales                — `linearScale`/`extent`/`ticks` + the ISO date
 *                             handling (`epochOf`/`dayOf`) + the logarithmic
 *                             axis (`scaleFor`, the one owner of which builder
 *                             a channel gets, with `logScale`/`logTicks`).
 *   • `<AxisLabel>`         — the interactive axis label (the re-encode
 *                             affordance) + `useReencodePicker` (host-mode vs
 *                             built-in-picker dispatch) + `defaultCompat`
 *                             (honest disabled-with-reason).
 *   • `scaleHueStyle`       — the ink of ONE scale: what a layer of a
 *                             two-scale frame does with the hue the frame
 *                             handed it (`scaleHue`).
 *   • `useHorizontalBrush`  — drag→interval with the completion discipline
 *                             (sub-4px = clear/tap; snap-to-data or nothing)
 *                             + `<BrushOverlay>`.
 *   • pointSelect           — `pointEmission`/`togglePointEmission`/`walkEmission`
 *                             (click-again-clears) + `keyActivates`.
 *   • useSelection          — `useKeepPredicate` (the self-excluded fold),
 *                             `useBrightPredicate` (what a chart DIMS by once
 *                             a link graph is on the wire), `selectedValue`,
 *                             `selectedSet`/`inSet`/`markClass` (SET-1: the
 *                             view's own set and the outline it earns),
 *                             `dimClass` (dim, never hide).
 *   • the band's slots      — `bandWidth`/`bandStart`/`bandCentre` (the ONE
 *                             slot geometry), `slotsCovered` (which slots a
 *                             drag's range covers) and `slotAt` (which slot
 *                             one pixel is inside).
 *   • the pointer target    — `MIN_POINTER_TARGET`/`pointerTargetWidth`: a
 *                             mark a reader is meant to press must be
 *                             REACHABLE, and a hit area is not a mark (widen
 *                             the target, never the drawing) — bounded by the
 *                             slot so a press cannot land on a neighbour, with
 *                             `crowdedMarksNote` for the case it cannot honour.
 *   • `announce`            — the ONE polite live region: tell a screen-reader
 *                             user about a change nothing focused reports
 *                             (a re-encode), silently for sighted users.
 *
 * The selection derivation itself (`selectionForView`, `keepPredicate`,
 * `selfSelectedValue`, `selfSelectedInterval`) is the contract layer's —
 * import it from the package root alongside these.
 */

export { ChartFrame } from './ChartFrame.js';
export type { ChartFrameProps, ChartSize } from './ChartFrame.js';

export { linearScale, extent, ticks, epochOf, dayOf, rampStep, SEQ_RAMP_STEPS } from './scales.js';
// the frame's scales (protocol 1.5): the `domain`/`axes` props every 2D chart takes, and the two
// functions that read a given domain — a host putting a chart on a shared scale needs them
// (`domainOr` for a run of numbers, `bandOrder` for a band's slots — and `bandWidth`/`bandStart`/`bandCentre`,
// the ONE slot geometry every mark on a band places itself by)
export { bandOrder, bandWidth, bandStart, bandCentre, domainOr } from './scales.js';
// a band is a range too (law 13): the ONE owner of "which slots does this pixel range cover" — a
// consumer-built band chart brushes its slots by asking it, and says `noSlotsCoveredNote` when a drag
// crossed no mark at all
export { slotsCovered, noSlotsCoveredNote } from './scales.js';
// …and the RUN's twin of it (`VizLine`'s numeric brush): `valuesCovered` answers which data values a
// numeric span reached, in DATA space so the caller's own scale is the only thing that inverts a pixel,
// with `noValuesCoveredNote` for the span that reached none — an interval no row can answer is the
// empty keep-list one layer along, and a run refuses that shape exactly as a band does
export { valuesCovered, noValuesCoveredNote } from './scales.js';
// A MARK A READER IS MEANT TO PRESS MUST BE REACHABLE: `slotAt` is the ONE owner of "which slot is
// this ONE pixel inside" (a tap; `slotsCovered` is its range twin), `pointerTargetWidth` of how wide
// a transparent target over a mark may be (the WCAG floor, or the slot when the slot is narrower —
// overlapping targets would land a press on a neighbour), and `crowdedMarksNote` of the words a chart
// owes the reader when it cannot honour that floor
export { slotAt, pointerTargetWidth, crowdedMarksNote, MIN_POINTER_TARGET } from './scales.js';
// the logarithmic axis (protocol 1.6): `scaleFor` is the ONE owner of which builder a channel gets,
// and the rest are what a host drawing its own guide over a logarithmic channel needs — the ticks,
// their labels, the placeability predicate and the words for what a transform could not place
export { logScale, logDomain, extentFor, scaleFor, placeable, padFor, logTicks, logTickLabel, excludedNote } from './scales.js';
// the second axis of a frame: `padOnSide` is the ONE owner of where a chart keeps its y-axis room
// when that axis stands on the right, read by the chart (its plot) and by `VizFrame` (its margin union)
export { padOnSide } from './scales.js';
export type { LinearScale, ChartDomain, ScaleKind, ScaleBuilder, AxisSide } from './scales.js';
// what the quantity can be (law 14): the words for a value outside the extent an axis was DECLARED on —
// beside `excludedNote` because it is the same register, and exported for the same reason it is (a
// consumer-built chart handed a declared pair owes its reader the same count)
export { outsideNotes } from './scales.js';
export type { OutsideAsk } from './scales.js';
// zero is a place on the axis (law 12): the ONE owner of whether a declared zero guide is drawn, and
// of the words for one that cannot be — a consumer-built chart asks it exactly as `VizScatter` does
export { zeroGuideFor, zeroGuideNotes } from './zeroGuide.js';
export type { ZeroGuide, ZeroGuideAsk } from './zeroGuide.js';

export { AxisLabel } from './AxisLabel.js';
export type { AxisLabelProps } from './AxisLabel.js';

// the ink of one scale (`scaleHue` on a two-scale frame's layer): the ONE owner of the custom
// property the hue is inherited on, so a consumer-built chart put on such a frame draws its own
// axis in the hue the frame handed it instead of guessing which property to paint
export { scaleHueStyle, SCALE_HUE_VAR } from './scaleHue.js';

export { defaultCompat } from './compat.js';
export type { Compatibility } from './compat.js';

export { useHorizontalBrush, BrushOverlay } from './brush.js';
export type { BrushGeometry, BrushHandlers, BrushOverlayProps, HorizontalBrush, HorizontalBrushOptions } from './brush.js';

// point + SET-1 (`matchEmission`/`toggleInSetEmission`/`clickEmission`): the
// whole click language the first-party charts speak. The SET-1 three were
// added to pointSelect.ts and never re-exported here, so a consumer-built
// chart could copy the gesture but not the emission it lands.
// the walk (protocol 1.3) ships in the SAME set for the same reason: a
// consumer-built node-link could otherwise copy the alt-click and have no way
// to spell what it asks.
export { pointEmission, togglePointEmission, matchEmission, toggleInSetEmission, clickEmission, walkEmission, toggleWalkEmission, keyActivates } from './pointSelect.js';

export { useKeepPredicate, useBrightPredicate, selectedValue, selectedSet, inSet, markClass, dimClass } from './useSelection.js';

export { useReencodePicker } from './reencode.js';
export type { ReencodePicker } from './reencode.js';

export { announce } from './announce.js';
