/**
 * `<VizHistogram>` — a responsive SVG histogram over HOST-COMPUTED buckets,
 * with a bucket-snapping interval brush. THE PROOF CHART for the primitives
 * tier: it is composed ONLY from the public pieces its five siblings already
 * ride (`../primitives`) — scales + date handling, `useHorizontalBrush` /
 * `BrushOverlay` (the gesture machinery + completion discipline),
 * `AxisLabel` / `useReencodePicker` / `defaultCompat` (the re-encode seam),
 * `keyActivates`, and the contract's `selfSelectedInterval` — no forked
 * internals anywhere.
 *
 * TRANSFORM OWNERSHIP (the load-bearing rule): the chart receives READY bins
 * (`{ x0, x1, count }`, numeric or ISO-date edges — `src/data`'s
 * `equalWidthBins`/`recountBins` is the canonical host helper) and NEVER
 * bins, counts, or re-buckets. Under a crossfilter the HOST recomputes the
 * counts against the same fixed edges (the VizBar recompute pattern) — the
 * edges must stay stable while this chart's own brush is live, or the
 * gesture would move its own target.
 *
 * GESTURES (all through the shared brush primitive — one pointer surface, no
 * competing click handlers):
 *   - drag across buckets → ONE interval emission `[firstBucket.x0,
 *     lastBucket.x1]` — SNAPPED to bucket boundaries, so the filter names
 *     edges the host actually computed (the VizLine snap-to-data
 *     discipline); a drag over no bucket emits nothing (never fabricate);
 *   - click a single bar (the brush primitive's sub-4px tap arm) → that
 *     bucket's interval `[x0, x1]`;
 *   - click the selected bucket AGAIN → the CLEARED interval (`rawValue:
 *     null`), releasing the filter — derived honestly from the fold's own
 *     clause (`selfSelectedInterval`), never from local state.
 * Buckets inside the view's own live interval wear the selection outline.
 * The emitted interval is edge-INCLUSIVE at both ends (the session's own
 * interval rule): a row exactly on a shared edge counts in the right-hand
 * bucket but is kept by a left-bucket selection ending there.
 *
 * The x axis label is the re-encode affordance (contract mode asks the HOST);
 * the built-in picker rides `defaultCompat`, so the x channel honestly
 * restricts to numeric/date columns. Counts have no axis and no picker —
 * they are the host's aggregate, not an encodable channel.
 *
 * DATE edges ride the same rail VizLine uses: ISO-8601 strings positioned by
 * epoch (`epochOf` — an unparseable edge's bucket is SKIPPED, never guessed)
 * and emitted through the one documented numeric-tuple cast.
 */
import { useMemo } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { selfSelectedInterval } from '../contract/selection.js';
import { linearScale, epochOf, dayOf } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { keyActivates } from '../primitives/pointSelect.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { EncodingPicker } from './EncodingPicker.js';

/** One HOST-computed bucket: edges (numeric, or ISO-date strings) + its count. */
export interface HistogramBinDatum {
  /** Inclusive lower edge. */
  readonly x0: number | string;
  /** Upper edge (the host's counting is right-open except the last bucket). */
  readonly x1: number | string;
  readonly count: number;
}

export interface VizHistogramProps {
  readonly viewId?: string;
  /** READY bins, in edge order — host-computed (the chart never bins or counts). */
  readonly data: readonly HistogramBinDatum[];
  /** The DATA field the buckets divide (also the brush emit field). */
  readonly field?: string;
  readonly label?: string;
  /** The unit word for tooltips (default `'rows'`). */
  readonly countLabel?: string;
  /** The clause-addressable crossfilter selection (RP-1) — the own-interval outline + click-again-clear derive from it. */
  readonly selection?: RenderSelection;
  /** Columns offered by the encoding picker (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** The encoding plane's verdicts per channel (`views[].fits` on the wire) — the built-in picker greys with the session's own sentences. */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  /** Current channel→field map for the picker's highlight. */
  readonly encoding?: ViewEncoding;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  /** Contract mode (RP-1 `reencodeRequest`): an axis click asks the HOST instead of opening the built-in picker. */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const PAD = { l: 30, r: 30, t: 20, b: 48 };

/** A bucket edge's position on the linear axis — numbers as-is, ISO dates by epoch. */
function edgePos(edge: number | string): number | null {
  return typeof edge === 'number' ? edge : epochOf(edge);
}

/** A bucket edge's short label — numbers to ≤2 decimals, dates to their day. */
function edgeLabel(edge: number | string): string {
  return typeof edge === 'number' ? String(Math.round(edge * 100) / 100) : dayOf(edge);
}

interface BinGeom extends HistogramBinDatum {
  readonly p0: number;
  readonly p1: number;
}

/** Positionable bins in edge order — a bin whose edge cannot be placed is skipped, never guessed. */
function toGeoms(data: readonly HistogramBinDatum[]): BinGeom[] {
  const geoms: BinGeom[] = [];
  for (const b of data) {
    const p0 = edgePos(b.x0);
    const p1 = edgePos(b.x1);
    if (p0 === null || p1 === null) continue;
    geoms.push({ ...b, p0, p1 });
  }
  return geoms;
}

export function VizHistogram(props: VizHistogramProps): JSX.Element {
  const {
    viewId = 'histogram',
    data,
    field = 'value',
    label = field,
    countLabel = 'rows',
    selection,
    columns = [],
    fits,
    encoding = {},
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 420,
    height = 340,
  } = props;

  const geoms = useMemo(() => toGeoms(data), [data]);
  const d0 = geoms.length > 0 ? geoms[0]!.p0 : 0;
  const d1 = geoms.length > 0 ? geoms[geoms.length - 1]!.p1 : 1;
  const x = linearScale(d0, d1, PAD.l, width - PAD.r);

  const max = Math.max(1, ...geoms.map((g) => g.count));
  const plot = height - PAD.t - PAD.b;
  const plotBottom = height - PAD.b;

  // the view's OWN live interval, from the addressable fold — the outline and
  // the click-again-clear comparison both ride it (never local state)
  const own = selection ? selfSelectedInterval(selection) : null;
  const ownLo = own && own[0] !== null ? edgePos(own[0]) : null;
  const ownHi = own && own[1] !== null ? edgePos(own[1]) : null;
  const isSelected = (g: BinGeom): boolean => ownLo !== null && ownHi !== null && g.p0 >= ownLo && g.p1 <= ownHi;

  const clearedEmission = (): ChartEmission => ({ rawValue: null, encoding: { kind: 'interval', field } });
  const emitBin = (g: BinGeom): void => {
    if (own && own[0] === g.x0 && own[1] === g.x1) {
      // clicking the selected bucket again CLEARS the interval — releasing the filter
      onEmit?.(clearedEmission());
      return;
    }
    // date edges on the interval rail: src/mosaic's ChartEmission tuple is
    // typed numerically (predates date intervals); src/data's IntervalClause
    // types + evaluates [string, string] — the same documented cast VizLine carries.
    onEmit?.({ rawValue: [g.x0, g.x1] as unknown as [number, number], encoding: { kind: 'interval', field } });
  };

  // ONE gesture surface — the shared brush primitive; its sub-4px tap arm IS
  // the bar click (no competing per-bar click handlers, no double emissions)
  const { svgRef, brush, handlers } = useHorizontalBrush({
    plotLeft: PAD.l,
    plotRight: width - PAD.r,
    width,
    field,
    snap: (loPx, hiPx) => {
      const lo = x.invert(loPx);
      const hi = x.invert(hiPx);
      const covered = geoms.filter((g) => g.p1 > lo && g.p0 < hi);
      // a drag over no bucket has nothing to snap to — never fabricate
      if (covered.length === 0) return null;
      const first = covered[0]!;
      const last = covered[covered.length - 1]!;
      // one interval spanning the covered buckets, snapped to their edges
      return [first.x0, last.x1] as unknown as [number, number];
    },
    onTap: (px) => {
      const v = x.invert(px);
      const hit = geoms.find((g, i) => v >= g.p0 && (v < g.p1 || (i === geoms.length - 1 && v <= g.p1)));
      if (!hit) {
        // a click beside every bucket — clear, the scatter/line tap discipline
        onEmit?.(clearedEmission());
        return;
      }
      emitBin(hit);
    },
    onEmit,
  });

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  // edge ticks, thinned by the pixels actually available (a narrow cockpit
  // cell fits 2-3 labels, a wide one all of them). The LAST edge always shows;
  // a stepped label that would crowd it is dropped instead (stepping already
  // spaces the stepped labels ≥ labelW apart, so the final edge is the one
  // remaining collision to guard).
  const edges: { pos: number; label: string }[] = [];
  if (geoms.length > 0) {
    const labelW = typeof geoms[0]!.x0 === 'string' ? 68 : 44; // date labels are wider than numbers
    const fit = Math.max(2, Math.floor((width - PAD.l - PAD.r) / labelW));
    const step = Math.max(1, Math.ceil((geoms.length + 1) / fit));
    const last = geoms[geoms.length - 1]!;
    for (let i = 0; i < geoms.length; i += step) {
      if (Math.abs(x(geoms[i]!.p0) - x(last.p1)) < labelW) continue; // would collide with the final edge label
      edges.push({ pos: geoms[i]!.p0, label: edgeLabel(geoms[i]!.x0) });
    }
    edges.push({ pos: last.p1, label: edgeLabel(last.x1) });
  }

  return (
    <>
      <svg
        ref={svgRef}
        className={`vzf-chart vzf-histogram${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`histogram of ${label}`}
        {...handlers}
      >
        {/* baseline */}
        <line className="vzf-axis" x1={PAD.l} y1={plotBottom} x2={width - PAD.r} y2={plotBottom} />
        {/* buckets: a full-height HIT area (keyboard + tooltip) + the count bar */}
        {geoms.map((g) => {
          const px0 = x(g.p0);
          const px1 = x(g.p1);
          const h = (g.count / max) * plot;
          const barY = plotBottom - h;
          const sel = isSelected(g);
          const range = `${edgeLabel(g.x0)}–${edgeLabel(g.x1)}`;
          return (
            <g key={`${g.x0}`}>
              <rect
                className={`vzf-histbar${sel ? ' vzf-selected' : ''}`}
                x={px0 + 1}
                y={barY}
                width={Math.max(1, px1 - px0 - 2)}
                height={h}
                fill="var(--vzf-brand)"
                aria-hidden="true"
              />
              {g.count > 0 && (
                <text className="vzf-barval" x={(px0 + px1) / 2} y={barY - 5} textAnchor="middle" aria-hidden="true">
                  {g.count}
                </text>
              )}
              {/* the full-height transparent HIT area rides on top: hover
                  tooltips + keyboard focus for the whole bucket, empty or not
                  (pointer gestures still bubble to the svg's brush surface) */}
              <rect
                className="vzf-hist-hit"
                x={px0}
                y={PAD.t}
                width={Math.max(1, px1 - px0)}
                height={plot}
                role="button"
                tabIndex={0}
                aria-pressed={sel}
                aria-label={`${label} ${range} (${g.count} ${countLabel})`}
                data-bucket={`${g.x0}`}
                onKeyDown={keyActivates(() => emitBin(g))}
              >
                <title>{`${range} · ${g.count} ${countLabel} · click to ${sel ? 'clear' : 'select'}`}</title>
              </rect>
            </g>
          );
        })}
        {/* bucket-edge ticks — the brush snaps to exactly these values */}
        {edges.map((e, i) => (
          <g key={`e${i}`}>
            <line className="vzf-axis" x1={x(e.pos)} y1={plotBottom} x2={x(e.pos)} y2={plotBottom + 4} />
            <text className="vzf-tick" x={x(e.pos)} y={plotBottom + 16} textAnchor="middle">
              {e.label}
            </text>
          </g>
        ))}
        {/* brush */}
        <BrushOverlay brush={brush} y={PAD.t} height={plot} />
        {/* the interactive x axis label — the re-encode affordance */}
        <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={label} channel="x" onOpen={openPicker} />
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        fits={fits}
        currentField={pickerChannel ? encoding[pickerChannel] ?? field : undefined}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
