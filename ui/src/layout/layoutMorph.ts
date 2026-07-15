/**
 * `useLayoutMorph` — the cockpit's performant layout morph (LY-1), classic
 * FLIP (First–Last–Invert–Play) over the chart cells:
 *
 *   1. after every paint it SNAPSHOTS each `[data-chart]` cell's rect;
 *   2. when the layout SIGNATURE changes (preset / order / focus), it measures
 *      the new rects, inverts the delta as a `transform`, and plays it back to
 *      identity through the Web Animations API — compositor-only frames.
 *
 * Why FLIP and not the View Transitions API: a view transition RASTERIZES the
 * old and new states and crossfades pixels — mid-morph the charts would be
 * blurry bitmaps. FLIP keeps the live vector cells and animates transform
 * ONLY, so during the animation nothing re-renders per frame; chart internals
 * re-render exactly ONCE per morph — the single ResizeObserver-driven
 * remeasure `ChartFrame` fires when the new layout box lands (the box changes
 * once at the start; the transform never affects layout).
 *
 * Progressive enhancement, honest at every rung:
 *   - `prefers-reduced-motion: reduce` → no animation, the layout just lands;
 *   - no Web Animations API (`el.animate` missing) → same, instant landing;
 *   - a cell without a previous rect (just mounted) or without real layout
 *     (zero-size — jsdom, display:none) is skipped, never faked.
 */
import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** One measured box — the subset of DOMRect the morph needs. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const MORPH_MS = 260;
const MORPH_EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A rect with no real layout (jsdom, display:none) can neither anchor nor land a morph. */
function unlaidOut(b: Box): boolean {
  return b.width < 1 || b.height < 1;
}

export function useLayoutMorph(containerRef: RefObject<HTMLElement | null>, signature: string): void {
  const prev = useRef<{ sig: string; rects: Map<string, Box> } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    /* v8 ignore next 2 -- the ref rides the charts band this same render returns; React attaches it before layout effects run, so it is never null here */
    if (container === null) return;
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-chart]'));
    const before = prev.current;

    if (before !== null && before.sig !== signature && !prefersReducedMotion()) {
      for (const cell of cells) {
        const id = cell.getAttribute('data-chart') as string; // the query selector guarantees the attribute
        const first = before.rects.get(id);
        if (first === undefined) continue; // just mounted — nowhere to morph from
        const last = cell.getBoundingClientRect();
        if (unlaidOut(first) || unlaidOut(last)) continue;
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        const sx = first.width / last.width;
        const sy = first.height / last.height;
        if (dx === 0 && dy === 0 && sx === 1 && sy === 1) continue; // this cell did not move
        if (typeof cell.animate !== 'function') continue; // no WAAPI — the layout lands instantly
        cell.animate(
          [
            { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          { duration: MORPH_MS, easing: MORPH_EASING },
        );
      }
    }

    // snapshot AFTER (possibly) playing, so the next morph anchors on this paint
    const rects = new Map<string, Box>();
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      rects.set(cell.getAttribute('data-chart') as string, { left: r.left, top: r.top, width: r.width, height: r.height });
    }
    prev.current = { sig: signature, rects };
  });
}
