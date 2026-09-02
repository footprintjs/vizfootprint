/**
 * THE TIMELINE RAIL — ticks that shrink as commits accumulate, so the strip
 * never grows and the dashboard beneath it never jumps.
 *
 * The law: the rail is given a width by the header (flex, one row, never
 * wrapping); the ticks share it. With few commits a tick is a comfortable
 * 28px with its id beneath; as commits pile up the tick narrows down to a
 * minimum, its id hides first (dense), and only past the minimum does the
 * rail scroll. A tick is never dropped: every commit stays reachable.
 */
import { useCallback, useLayoutEffect, useState } from 'react';

export interface RailTicks {
  /** One tick's width in CSS pixels. */
  readonly tick: number;
  /** True when the ticks are too narrow to carry their ids. */
  readonly dense: boolean;
}

/** Placeholder dials — a comfortable tick, the narrowest tick, the width beneath which an id no longer fits. */
export const TICK_MAX = 28;
export const TICK_MIN = 6;
export const TICK_LABELLED = 18;
const TICK_GAP = 4;

/** The tick width for `count` ticks sharing `width` pixels: comfortable when there is room, narrower as they pile up, never under the minimum. */
export function railTick(width: number, count: number): RailTicks {
  if (count <= 0 || width <= 0) return { tick: TICK_MAX, dense: false };
  const share = Math.floor((width - (count - 1) * TICK_GAP) / count);
  const tick = Math.max(TICK_MIN, Math.min(TICK_MAX, share));
  return { tick, dense: tick < TICK_LABELLED };
}

/** The rail's CONTENT width: what the ticks may share — the padding is the rail's, not theirs. */
function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(0, Math.floor(el.clientWidth - pad));
}

/**
 * The rail's ticks, re-measured whenever the rail's content box changes (a
 * ResizeObserver, when the environment has one). The rail may mount later
 * than the component that asks (Present mode has no rail until a beat is
 * named), so the node is held in state through a callback ref and the
 * observer attaches when the rail appears.
 */
export function useRailTicks(count: number): RailTicks & { readonly rail: (el: HTMLElement | null) => void } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const rail = useCallback((el: HTMLElement | null) => setNode(el), []);
  useLayoutEffect(() => {
    if (node === null) return;
    setWidth(contentWidth(node));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]!.contentRect.width))); // an observer always delivers the observed element's entry
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { rail, ...railTick(width, count) };
}
