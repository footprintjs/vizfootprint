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
import type { ChartEmission } from '../../../src/mosaic/index.js';

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

export function useHorizontalBrush(options: HorizontalBrushOptions): HorizontalBrush {
  const { plotLeft, plotRight, width, field, snap, onTap, onEmit } = options;
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
    const rawValue = snap(Math.min(drag.x0, px), Math.max(drag.x0, px));
    if (rawValue === null) {
      // nothing to snap to — never fabricate an interval
      setBrush(null);
      return;
    }
    onEmit?.({ rawValue, encoding: { kind: 'interval', field } });
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
