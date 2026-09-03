/**
 * THE TIMELINE RAIL — a FIXED strip whose bars share it, so the header never
 * grows and the dashboard beneath it never jumps.
 *
 * The law: the rail's width is the header's, not the commits' — it neither
 * grows nor shrinks with the count. The count only decides how the bars
 * SHARE that width: with N commits each bar is `(width − the gaps) / N`. One
 * commit fills the rail, two take half each, four a quarter each, and so on,
 * with NO upper limit — a lone bar is as wide as the rail.
 *
 * Two floors keep it usable as commits pile up: a bar's id hides once the bar
 * is narrower than {@link TICK_LABELLED} (dense), and a bar never goes under
 * {@link TICK_MIN} — past that the rail scrolls instead. A bar is never
 * dropped: every commit stays reachable.
 */
import { useCallback, useLayoutEffect, useState } from 'react';

export interface RailTicks {
  /** One bar's width in CSS pixels — the share of the fixed rail this count earns. */
  readonly tick: number;
  /** True when the bars are too narrow to carry their ids. */
  readonly dense: boolean;
}

/** The width a bar is drawn at before the rail has been measured (no layout yet, or nothing to draw). NOT a maximum: a measured rail with one commit gives that commit the whole width. */
export const TICK_UNMEASURED = 28;
/** The narrowest a bar ever gets; past it the bars keep this width and the rail scrolls. */
export const TICK_MIN = 6;
/** The width beneath which a bar can no longer carry its id (dense). */
export const TICK_LABELLED = 18;
/** The space between two bars, in pixels — the rail's own `gap`. */
const TICK_GAP = 4;

/**
 * The bar width for `count` bars sharing a FIXED rail of `width` pixels:
 * `(width − the gaps) / count`, floored — one bar fills the rail, two take
 * half each, four a quarter each. No upper limit; {@link TICK_MIN} is the
 * floor, and a bar narrower than {@link TICK_LABELLED} is `dense` (its id
 * hides). Before layout (`width` 0) or with nothing to draw (`count` 0) the
 * answer is the unmeasured placeholder, labelled.
 */
export function railTick(width: number, count: number): RailTicks {
  if (count <= 0 || width <= 0) return { tick: TICK_UNMEASURED, dense: false };
  const share = Math.floor((width - (count - 1) * TICK_GAP) / count);
  const tick = Math.max(TICK_MIN, share);
  return { tick, dense: tick < TICK_LABELLED };
}

/** What the rail is showing, for {@link railScope} to put into words. */
export interface RailScope {
  /** Bars on the rail — the lineage it drew. */
  readonly shown: number;
  /** Steps in the whole story, every path counted. */
  readonly total: number;
  /** The named path the rail's bars belong to, when the host knows it names THESE bars. */
  readonly pathName?: string;
  /** How many named paths the story has. */
  readonly pathCount?: number;
  /** True when the rail is drawing a lane the HEAD is not on — "now" is elsewhere. */
  readonly offLane?: boolean;
}

/**
 * WHAT THE RAIL IS SHOWING, in words — the sentence beside the bars.
 *
 * The rail draws ONE path (the lineage the cursor is standing on), not the
 * whole story. Fork from a past cursor and it honestly redraws: fifty-three
 * bars become eleven. Said out loud that is a new path; said in silence it
 * reads as data loss, which is exactly how it read before this line existed.
 *
 * When the cursor has walked onto a lane the HEAD is not on, no bar can wear
 * the head marker — so the sentence says where "now" went, instead of leaving
 * a reader to notice that the mark they navigate by has quietly gone missing.
 *
 * `null` when there is nothing to explain — one path, every step of it on the
 * rail, the head among them — because a note that is always there stops being
 * read.
 */
export function railScope(scope: RailScope): string | null {
  const { shown, total, pathName, pathCount = 1, offLane = false } = scope;
  if (shown >= total && pathCount <= 1 && !offLane) return null;
  const path = pathName !== undefined && pathName !== '' ? `path “${pathName}”` : 'this path';
  const of = pathCount > 1 ? ` of ${String(pathCount)}` : '';
  const now = offLane ? ' · now is on another path' : '';
  return `${String(shown)} of ${String(total)} steps · ${path}${of}${now}`;
}

/** The rail's CONTENT width: what the bars may share — the padding is the rail's, not theirs. */
function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return Math.max(0, Math.floor(el.clientWidth - pad));
}

/**
 * The rail's bar width, re-measured whenever the rail's content box changes (a
 * ResizeObserver, when the environment has one). The rail may mount later
 * than the component that asks (Present mode has no rail until a bookmark is
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
