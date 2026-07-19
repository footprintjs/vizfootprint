/**
 * `<ChartFrame>` — the container-measurement wrapper that lets an SVG chart
 * FILL its cell instead of riding a fixed pixel height. It measures its own
 * box (a `ResizeObserver` when the browser has one, a single layout read
 * otherwise) and hands `{ width, height }` to the render prop — pass those
 * straight through as the chart's `width`/`height` so the SVG viewBox matches
 * the on-screen box 1:1 (crisp text and hairlines, no letterboxing). Until a
 * real (non-zero) size is known it renders nothing, so a chart never flashes
 * at a wrong scale.
 *
 * It measures the LAYOUT box (`offsetWidth`/`offsetHeight`), never the visual
 * box (`getBoundingClientRect`): the cockpit's FLIP morph (LY-1) plays a
 * transform animation on the ancestor cell in the very frame the layout box
 * changes, and a rect read then would return the OLD box — the inverse
 * transform makes the new layout look exactly like the previous arrangement.
 * Transforms never re-fire a ResizeObserver, so that stale size would FREEZE
 * into the chart's viewBox and letterbox the drawing (the short-charts
 * regression). Layout APIs are transform-proof, so the one observer
 * notification per arrangement change lands the true settled size.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

export interface ChartFrameProps {
  /** Render the chart at the measured size. */
  readonly children: (size: ChartSize) => ReactNode;
  readonly className?: string;
}

export function ChartFrame(props: ChartFrameProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ChartSize | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    /* v8 ignore next -- the ref rides the div this same render returns; React attaches it before layout effects run, so it is never null here */
    if (!el) return;
    const measure = (): void => {
      // offsetWidth/offsetHeight = the UNTRANSFORMED layout border-box (the
      // frame carries no border/padding, so it equals the content box). A
      // getBoundingClientRect() here would include the FLIP morph's live
      // transform and freeze the pre-morph size into the chart (see header).
      const width = Math.floor(el.offsetWidth);
      const height = Math.floor(el.offsetHeight);
      // zero-size (display:none, or an environment without layout) — keep waiting
      if (width < 1 || height < 1) return;
      setSize((prev) => (prev !== null && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`vzf-chart-frame${props.className ? ' ' + props.className : ''}`} data-vzf="chart-frame">
      {size !== null ? props.children(size) : null}
    </div>
  );
}
