/**
 * `<ChartFrame>` — the container-measurement wrapper that lets an SVG chart
 * FILL its cell instead of riding a fixed pixel height. It measures its own
 * box (a `ResizeObserver` when the browser has one, a single layout read
 * otherwise) and hands `{ width, height }` to the render prop — pass those
 * straight through as the chart's `width`/`height` so the SVG viewBox matches
 * the on-screen box 1:1 (crisp text and hairlines, no letterboxing). Until a
 * real (non-zero) size is known it renders nothing, so a chart never flashes
 * at a wrong scale.
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
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
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
