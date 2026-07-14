/**
 * `<VegaLiteCell>` — the gallery's proof that a THIRD-PARTY-shaped renderer
 * (mount/update/unmount over the RP-1 contract, never a React component) rides
 * the SAME crossfilter loop as the five first-party charts:
 *
 *   - brushing THIS chart's rating axis lands a REAL interval commit through
 *     `bindRenderer`'s handshake (viewId 'vl'), with its origin in the cause —
 *     the SAME `view.emit(...)` rail the first-party charts use;
 *   - that commit crossfilters the OTHER views (bar/map counts recompute,
 *     the scatter dims outside the rating range);
 *   - brushing ANOTHER view (e.g. the scatter) crossfilters BACK: this
 *     chart's injected `__vzfKeep` opacity encode dims the rows outside the
 *     other view's clause, the same as any first-party chart's dim state.
 *
 * The bridge itself never sees React — `bindRenderer` + `mount`/`update` is
 * the WHOLE integration surface, exactly as an external consumer would use it.
 */
import { useEffect, useRef } from 'react';
import type { TopLevelSpec } from 'vega-lite';
import { vegaLiteRenderer } from 'vizfootprint-vega-lite';
import { bindRenderer } from '../src/index.js';
import type { BoundRenderer, ChartEmission, RenderRow, RenderSelection } from '../src/index.js';

/** One single-view spec: an interval brush on `rating`, positioned against `price`. */
const GALLERY_VL_SPEC: TopLevelSpec = {
  mark: { type: 'circle', size: 60 },
  params: [{ name: 'vzfGalleryBrush', select: { type: 'interval', encodings: ['x'] } }],
  encoding: {
    x: { field: 'rating', type: 'quantitative', title: 'Rating' },
    y: { field: 'price', type: 'quantitative', title: 'Price' },
  },
} as unknown as TopLevelSpec;

export interface VegaLiteCellProps {
  readonly viewId: string;
  readonly rows: readonly RenderRow[];
  readonly selection: RenderSelection;
  readonly theme: Readonly<Record<string, string>>;
  readonly width: number;
  readonly height: number;
  onEmit(emission: ChartEmission): void;
}

export function VegaLiteCell(props: VegaLiteCellProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boundRef = useRef<BoundRenderer | null>(null);
  // the mount effect only runs once — read the LATEST callback through a ref
  // so a re-render never forces a remount of the (expensive) vega view
  const onEmitRef = useRef(props.onEmit);
  onEmitRef.current = props.onEmit;

  useEffect(() => {
    const el = hostRef.current;
    /* v8 ignore next -- the ref rides the div this same render returns; React attaches it before effects run */
    if (!el) return;
    const renderer = vegaLiteRenderer(GALLERY_VL_SPEC);
    const res = bindRenderer(renderer, el, {
      viewId: props.viewId,
      callbacks: {
        emit: (emission) => onEmitRef.current(emission),
        hover: () => {},
        reencodeRequest: () => {},
        navigate: () => {},
      },
      onGap: (gap) => {
        // honest surface, never silent — a bind refusal here is a real bug
        // (an incompatible protocol build, or a spec the gate should have caught)
        console.error('vega-lite gallery cell: contract gap at bind', gap);
      },
    });
    if (!res.ok) return;
    boundRef.current = res.view;
    return () => {
      res.view.unmount();
      boundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.viewId]);

  useEffect(() => {
    if (props.width < 1 || props.height < 1) return;
    boundRef.current?.update({
      rows: props.rows,
      encodings: {},
      selection: props.selection,
      hover: null,
      theme: props.theme,
      size: { width: props.width, height: props.height },
    });
  }, [props.rows, props.selection, props.theme, props.width, props.height]);

  return <div ref={hostRef} className="vzf-vl-cell" style={{ width: '100%', height: '100%' }} />;
}
