/**
 * The horizontal BRUSH primitive — the drag→interval gesture machinery that
 * VizScatter, VizLine, and VizHistogram share, extracted verbatim so a
 * consumer-built chart is BORN CONFORMANT:
 *
 *   - the emission is the R3 interval shape `{ rawValue, encoding }` in DATA
 *     space (the chart's `snap` resolves pixels through its OWN scale — the
 *     hook never emits pixels and never builds a clause);
 *   - the completion discipline: a sub-4px release is a CLICK, not a drag —
 *     by default it emits the CLEARED interval (`rawValue: null`), releasing
 *     the filter (the scatter/line gesture); a chart with its own tap
 *     semantics (the histogram's click-a-bucket) passes `onTap`;
 *   - snap-to-data honesty: `snap` returning `null` means there is nothing
 *     real to snap to — the brush clears and NO emission fires (an interval
 *     is never fabricated);
 *   - A BAND IS A RANGE TOO (law 13): a scale whose span is not an interval
 *     passes `select` instead, and the chart maps the same clamped range to
 *     its own emission — `VizLine`'s band brush lands the MATCH a drag across
 *     slots means (`slotsCovered` + `matchEmission`, the two owners of which
 *     slots and which words). It shares the completion discipline byte for
 *     byte: `null` is the same nothing a `null` snap is;
 *   - pointer capture, CSS-scale correction (viewBox units vs on-screen
 *     pixels), plot-bounds clamping, and the axis-label guard (a click on a
 *     `.vzf-axis-group` opens the encoding picker and must never start —
 *     or, on release, clear — a brush) all ride along.
 *
 * `<BrushOverlay>` renders the live drag rectangle with the shared
 * `.vzf-brush` styling hook (theme-token fill, both palettes).
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ChartEmission } from 'vizfootprint/selection';

/** The live drag rectangle, in viewBox units. */
export interface BrushGeometry {
  readonly x: number;
  readonly w: number;
}

export interface HorizontalBrushOptions {
  /** The plot's left pixel bound (viewBox units) — drags clamp into it. */
  readonly plotLeft: number;
  /** The plot's right pixel bound (viewBox units). */
  readonly plotRight: number;
  /** The svg's viewBox width — pointer coordinates rescale by `width / rect.width`. */
  readonly width: number;
  /** The DATA field the interval emission names. */
  readonly field: string;
  /**
   * Map a completed drag (clamped pixel `lo < hi`) to the emission's
   * DATA-space rawValue — the chart's own snap discipline (scale invert,
   * snap-to-date, snap-to-bucket-edges). Return `null` when there is nothing
   * to snap to: the brush clears and NO emission fires (never fabricate).
   */
  snap(loPx: number, hiPx: number): [number, number] | null;
  /**
   * THE SECOND COMPLETION ARM — what a completed drag selects on a scale whose
   * span is NOT an interval, and the whole of "a band is a range too" (law 13).
   * A band has no BETWEEN: a drag across its slots is a RUN of them, which is
   * the match language every band already speaks, so the chart maps the
   * clamped pixel range to its own emission through the primitives that own
   * those words (`slotsCovered` for which slots, `matchEmission` for the
   * clause — the hook still builds no clause and still never sees a pixel it
   * did not clamp itself).
   *
   * Given, it WINS over {@link HorizontalBrushOptions.snap}: one drag, one
   * answer. `null` means the drag selected nothing real — the brush clears and
   * NO emission fires, exactly as a `null` from `snap` does (never fabricate).
   * Absent, every byte of this hook's behaviour is the one it always had.
   */
  select?(loPx: number, hiPx: number): ChartEmission | null;
  /**
   * A sub-4px release (a click, not a drag). Default: emit the CLEARED
   * interval `{ rawValue: null }` — the scatter/line discipline. A chart
   * with its own tap gesture (the histogram's click-a-bucket) overrides it.
   */
  onTap?(px: number): void;
  onEmit?(emission: ChartEmission): void;
}

/** The svg-level pointer handlers — spread them onto the chart's `<svg>`. */
export interface BrushHandlers {
  onPointerDown(ev: ReactPointerEvent<SVGSVGElement>): void;
  onPointerMove(ev: ReactPointerEvent<SVGSVGElement>): void;
  onPointerUp(ev: ReactPointerEvent<SVGSVGElement>): void;
  onPointerCancel(ev: ReactPointerEvent<SVGSVGElement>): void;
}

export interface HorizontalBrush {
  /** Attach to the chart's `<svg>` — the CSS-scale correction reads its box. */
  readonly svgRef: React.MutableRefObject<SVGSVGElement | null>;
  /** The live drag rectangle, or null while idle — feed it to {@link BrushOverlay}. */
  readonly brush: BrushGeometry | null;
  readonly handlers: BrushHandlers;
}

/** A snapped range as the R3 interval emission — or the same NOTHING a `null` snap has always meant. */
function intervalOf(rawValue: [number, number] | null, field: string): ChartEmission | null {
  return rawValue === null ? null : { rawValue, encoding: { kind: 'interval', field } };
}

export function useHorizontalBrush(options: HorizontalBrushOptions): HorizontalBrush {
  const { plotLeft, plotRight, width, field, snap, select, onTap, onEmit } = options;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x0: number } | null>(null);
  const [brush, setBrush] = useState<BrushGeometry | null>(null);

  const clampX = (px: number): number => Math.max(plotLeft, Math.min(plotRight, px));
  const pxFromEvent = (ev: ReactPointerEvent): number => {
    const svg = svgRef.current;
    /* v8 ignore next -- pxFromEvent is only called from the pointer handlers, all four
       bound directly to this same ref'd <svg>; React attaches the ref before any pointer
       event can reach them, so svgRef.current is never null here in practice */
    if (!svg) return plotLeft;
    const rect = svg.getBoundingClientRect();
    const scale = width / (rect.width || width);
    return clampX((ev.clientX - rect.left) * scale);
  };

  const onPointerDown = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    // the axis labels live inside this svg — a click there opens the encoding
    // picker and must NOT start (or, on release, clear) a brush
    const target = ev.target as Element;
    if (typeof target.closest === 'function' && target.closest('.vzf-axis-group')) return;
    const px = pxFromEvent(ev);
    dragRef.current = { x0: px };
    svgRef.current?.setPointerCapture?.(ev.pointerId);
    setBrush({ x: px, w: 0 });
  };
  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    if (!dragRef.current) return;
    const px = pxFromEvent(ev);
    setBrush({ x: Math.min(dragRef.current.x0, px), w: Math.abs(px - dragRef.current.x0) });
  };
  const onPointerUp = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const px = pxFromEvent(ev);
    if (Math.abs(px - drag.x0) < 4) {
      // a click, not a drag — the completion discipline's tap arm
      setBrush(null);
      if (onTap) onTap(px);
      else onEmit?.({ rawValue: null, encoding: { kind: 'interval', field } });
      return;
    }
    const lo = Math.min(drag.x0, px);
    const hi = Math.max(drag.x0, px);
    // ONE completion, two arms: the interval this hook has always snapped, or — on a scale whose span is
    // not an interval — whatever the chart's own `select` makes of the same clamped range (law 13)
    const emission = select === undefined ? intervalOf(snap(lo, hi), field) : select(lo, hi);
    if (emission === null) {
      // nothing to snap to, or no slot covered — never fabricate a selection
      setBrush(null);
      return;
    }
    onEmit?.(emission);
  };

  return {
    svgRef,
    brush,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

export interface BrushOverlayProps {
  readonly brush: BrushGeometry | null;
  /** The plot's top edge (viewBox units). */
  readonly y: number;
  /** The plot's height (viewBox units). */
  readonly height: number;
}

/** The live drag rectangle — the shared `.vzf-brush` styling hook. */
export function BrushOverlay(props: BrushOverlayProps): JSX.Element | null {
  const { brush, y, height } = props;
  if (!brush || brush.w <= 0) return null;
  return <rect className="vzf-brush" x={brush.x} y={y} width={brush.w} height={height} rx={2} />;
}
