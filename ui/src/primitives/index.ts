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
 *                             handling (`epochOf`/`dayOf`).
 *   • `<AxisLabel>`         — the interactive axis label (the re-encode
 *                             affordance) + `useReencodePicker` (host-mode vs
 *                             built-in-picker dispatch) + `defaultCompat`
 *                             (honest disabled-with-reason).
 *   • `useHorizontalBrush`  — drag→interval with the completion discipline
 *                             (sub-4px = clear/tap; snap-to-data or nothing)
 *                             + `<BrushOverlay>`.
 *   • pointSelect           — `pointEmission`/`togglePointEmission`
 *                             (click-again-clears) + `keyActivates`.
 *   • useSelection          — `useKeepPredicate` (the self-excluded fold),
 *                             `selectedValue`, `dimClass` (dim, never hide).
 *
 * The selection derivation itself (`selectionForView`, `keepPredicate`,
 * `selfSelectedValue`, `selfSelectedInterval`) is the contract layer's —
 * import it from the package root alongside these.
 */

export { ChartFrame } from './ChartFrame.js';
export type { ChartFrameProps, ChartSize } from './ChartFrame.js';

export { linearScale, extent, ticks, epochOf, dayOf } from './scales.js';
export type { LinearScale } from './scales.js';

export { AxisLabel } from './AxisLabel.js';
export type { AxisLabelProps } from './AxisLabel.js';

export { defaultCompat } from './compat.js';
export type { Compatibility } from './compat.js';

export { useHorizontalBrush, BrushOverlay } from './brush.js';
export type { BrushGeometry, BrushHandlers, BrushOverlayProps, HorizontalBrush, HorizontalBrushOptions } from './brush.js';

export { pointEmission, togglePointEmission, keyActivates } from './pointSelect.js';

export { useKeepPredicate, selectedValue, dimClass } from './useSelection.js';

export { useReencodePicker } from './reencode.js';
export type { ReencodePicker } from './reencode.js';
