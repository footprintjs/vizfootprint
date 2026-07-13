/**
 * `<VizLine>` — a responsive SVG time series (mean of a numeric column per
 * date, optionally split into coloured series) with a horizontal TIME BRUSH.
 * Controlled like its siblings: the consumer passes the (already
 * crossfiltered) raw points and the chart renders them — its own line
 * recomputes under other views' selections because the CONSUMER recomputes
 * `data`, exactly the {@link VizBar} pattern.
 *
 * AGGREGATION (design call): the chart takes RAW points and draws the MEAN of
 * `value` per distinct `date` (per series). Raw multi-row-per-date data would
 * zigzag vertically (several y at one x) and a per-bucket SUM would conflate a
 * crossfilter's row-count effect with magnitude; the mean keeps y in data
 * units and lets the line's SHAPE change honestly under selections. The
 * bucket is the data's own date granularity — the chart never invents a
 * coarser bucketing.
 *
 * BRUSH → EMISSION (design call): dates are ISO-8601 STRINGS and the brush
 * emits `{ rawValue: [startISO, endISO], encoding: { kind: 'interval', field } }`
 * with bounds SNAPPED to the data's own date values (nearest distinct date per
 * endpoint) — the emitted strings are actual column values, so the string
 * interval predicate (src/data, lexicographic == chronological for ISO-8601)
 * compares formats that always agree. A sub-4px drag clears (null interval),
 * matching {@link VizScatter}. `src/mosaic`'s `ChartEmission` types the
 * interval tuple numerically (it predates date intervals); the ISO pair rides
 * the same rail via one documented cast — the src/data seam (`IntervalClause`)
 * types and evaluates `[string, string]` correctly.
 *
 * Axis labels open the {@link EncodingPicker}: x offers only DATE-capable
 * columns, y only numeric ones — disabled-with-reason via {@link lineCompat}.
 */
import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding } from '../adapter/types.js';
import { linearScale, extent, ticks } from './scales.js';
import { AxisLabel } from './AxisLabel.js';
import { EncodingPicker } from './EncodingPicker.js';
import { defaultCompat, type Compatibility } from './compat.js';

export interface LinePoint {
  /** ISO-8601 date (or timestamp) string — lexicographic == chronological. */
  readonly date: string;
  readonly value: number;
  /** Optional series split (coloured via `colorOf`). */
  readonly series?: string;
}

export interface VizLineProps {
  readonly viewId?: string;
  /** RAW points, already crossfiltered by the consumer — the chart aggregates (mean per date per series). */
  readonly data: readonly LinePoint[];
  /** The DATA field the time axis encodes (also the brush emit field). */
  readonly dateField?: string;
  /** The DATA field the y axis encodes. */
  readonly valueField?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly colorOf?: (series: string | undefined) => string;
  /** Columns offered by the encoding picker (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** Current channel→field map for the picker's highlight. */
  readonly encoding?: ViewEncoding;
  /**
   * Columns the x picker may treat as date-capable even when their REPORTED
   * type is not `'date'` (providers type ISO-8601 strings as `'string'` —
   * schema alone cannot see the values). Defaults to `[dateField]`: the one
   * column this chart can vouch for, because it is rendering its values as
   * dates right now.
   */
  readonly dateFields?: readonly string[];
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

/**
 * The line chart's channel/column compatibility: x takes only DATE-capable
 * columns (reported type `'date'`, or vouched for via `dateFields`), y takes
 * only numeric ones — each refusal names its reason (honest affordance).
 * Other channels (color …) fall through to {@link defaultCompat}.
 */
export function lineCompat(dateFields: readonly string[] = []) {
  return (channel: string, column: ColumnView): Compatibility => {
    if (channel === 'x') {
      if (column.type === 'date' || dateFields.includes(column.field)) return { ok: true };
      return { ok: false, reason: `the time axis needs a date column — "${column.field}" is ${column.type}` };
    }
    if (channel === 'y') {
      if (column.type === 'number') return { ok: true };
      return { ok: false, reason: `y needs a numeric column — "${column.field}" is ${column.type}` };
    }
    return defaultCompat(channel, column);
  };
}

interface SeriesGeom {
  readonly name: string | undefined;
  /** Mean value per distinct date, in chronological order. */
  readonly points: readonly { date: string; epoch: number; mean: number; n: number }[];
}

/** Mean per (series, date) over parseable dates, series and dates both in first-seen/chronological order. */
function aggregate(data: readonly LinePoint[]): { series: SeriesGeom[]; dates: { date: string; epoch: number }[] } {
  const bySeries = new Map<string | undefined, Map<string, { sum: number; n: number }>>();
  const epochs = new Map<string, number>();
  for (const p of data) {
    const epoch = Date.parse(p.date);
    if (Number.isNaN(epoch)) continue; // an unparseable date cannot be positioned — skipped, never guessed
    epochs.set(p.date, epoch);
    let buckets = bySeries.get(p.series);
    if (!buckets) {
      buckets = new Map();
      bySeries.set(p.series, buckets);
    }
    const b = buckets.get(p.date);
    if (b) {
      b.sum += p.value;
      b.n += 1;
    } else {
      buckets.set(p.date, { sum: p.value, n: 1 });
    }
  }
  const dates = [...epochs.entries()].map(([date, epoch]) => ({ date, epoch })).sort((a, b) => a.epoch - b.epoch);
  const series: SeriesGeom[] = [...bySeries.entries()].map(([name, buckets]) => ({
    name,
    points: dates
      .filter((d) => buckets.has(d.date))
      .map((d) => {
        const b = buckets.get(d.date)!;
        return { date: d.date, epoch: d.epoch, mean: b.sum / b.n, n: b.n };
      }),
  }));
  return { series, dates };
}

/** The date-part of an ISO string — tick labels stay short even for full timestamps. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

const PAD = { l: 52, r: 18, t: 18, b: 44 };

export function VizLine(props: VizLineProps): JSX.Element {
  const {
    viewId = 'line',
    data,
    dateField = 'date',
    valueField = 'value',
    xLabel = dateField,
    yLabel = valueField,
    colorOf,
    columns = [],
    encoding = {},
    dateFields,
    onEmit,
    onReencode,
    width = 520,
    height = 340,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x0: number } | null>(null);
  const [brush, setBrush] = useState<{ x: number; w: number } | null>(null);
  const [pickerChannel, setPickerChannel] = useState<string | null>(null);

  const { series, dates } = useMemo(() => aggregate(data), [data]);
  const compat = useMemo(() => lineCompat(dateFields ?? [dateField]), [dateFields, dateField]);

  const [elo, ehi] = extent(dates, (d) => d.epoch, 0);
  const x = linearScale(elo, ehi, PAD.l, width - PAD.r);
  const allMeans = series.flatMap((s) => s.points);
  const [vlo, vhi] = extent(allMeans, (p) => p.mean, 0.5);
  const y = linearScale(vlo, vhi, height - PAD.b, PAD.t);

  const clampX = (px: number): number => Math.max(PAD.l, Math.min(width - PAD.r, px));
  const pxFromEvent = (ev: ReactPointerEvent): number => {
    const svg = svgRef.current;
    /* v8 ignore next -- mirrors VizScatter: pxFromEvent is only reachable from pointer handlers
       bound to this same ref'd <svg>; React attaches the ref before any pointer event can fire,
       so svgRef.current is never null here in practice */
    if (!svg) return PAD.l;
    const rect = svg.getBoundingClientRect();
    const scale = width / (rect.width || width);
    return clampX((ev.clientX - rect.left) * scale);
  };

  /** The distinct data date NEAREST an epoch (dates is chronological, monotone in its argument). */
  const snapToDate = (epoch: number): { date: string; epoch: number } | null => {
    if (dates.length === 0) return null;
    let best = dates[0]!;
    for (const d of dates) {
      if (Math.abs(d.epoch - epoch) < Math.abs(best.epoch - epoch)) best = d;
    }
    return best;
  };

  const onPointerDown = (ev: ReactPointerEvent<SVGSVGElement>): void => {
    // axis labels live inside this svg — a click there opens the encoding
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
      // a click, not a drag — clear the interval (VizScatter semantics)
      setBrush(null);
      onEmit?.({ rawValue: null, encoding: { kind: 'interval', field: dateField } });
      return;
    }
    const lo = snapToDate(x.invert(Math.min(drag.x0, px)));
    const hi = snapToDate(x.invert(Math.max(drag.x0, px)));
    if (lo === null || hi === null) {
      // no dated rows at all — nothing to snap to; never fabricate an interval
      setBrush(null);
      return;
    }
    // ISO strings on the interval rail: src/mosaic's ChartEmission tuple is
    // typed numerically (predates date intervals); src/data's IntervalClause
    // types + evaluates [string, string] — the documented cast, nowhere else.
    onEmit?.({
      rawValue: [lo.date, hi.date] as unknown as [number, number],
      encoding: { kind: 'interval', field: dateField },
    });
  };

  const openPicker = (channel: string): void => setPickerChannel(channel);

  // ≤3 tick dates: first (start-anchored), last (end-anchored), and the middle
  // date ONLY when its label physically fits between the edge labels — data
  // dates land where they land, so the middle can crowd an edge under uneven
  // gaps. Date labels are ~10 mono chars ≈ 62 viewBox units.
  const TICK_LABEL_W = 62;
  const tickSpecs: { date: string; epoch: number; anchor: 'start' | 'middle' | 'end' }[] = [];
  if (dates.length > 0) {
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    tickSpecs.push({ ...first, anchor: dates.length === 1 ? 'middle' : 'start' });
    if (dates.length > 2) {
      const mid = dates[Math.round((dates.length - 1) / 2)]!;
      const fits =
        x(mid.epoch) - TICK_LABEL_W / 2 > x(first.epoch) + TICK_LABEL_W + 8 &&
        x(mid.epoch) + TICK_LABEL_W / 2 < x(last.epoch) - TICK_LABEL_W - 8;
      if (fits) tickSpecs.push({ ...mid, anchor: 'middle' });
    }
    if (dates.length > 1) tickSpecs.push({ ...last, anchor: 'end' });
  }
  const yTickVals = ticks(vlo + 0.5, vhi - 0.5, 3);

  const seriesColor = (name: string | undefined): string => (colorOf ? colorOf(name) : 'var(--vzf-brand)');
  const showLegend = series.length >= 2;

  return (
    <>
      <svg
        ref={svgRef}
        className={`vzf-chart vzf-line${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yLabel} over ${xLabel}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* axes frame */}
        <line className="vzf-axis" x1={PAD.l} y1={height - PAD.b} x2={width - PAD.r} y2={height - PAD.b} />
        <line className="vzf-axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={height - PAD.b} />
        {/* x ticks — actual data dates; the edge labels anchor inward so they
            never clip at the plot edges or collide with each other */}
        {tickSpecs.map((d) => (
          <g key={`xt${d.date}`}>
            <line className="vzf-axis" x1={x(d.epoch)} y1={height - PAD.b} x2={x(d.epoch)} y2={height - PAD.b + 4} />
            <text className="vzf-tick" x={x(d.epoch)} y={height - PAD.b + 16} textAnchor={d.anchor}>
              {dayOf(d.date)}
            </text>
          </g>
        ))}
        {/* y ticks */}
        {yTickVals.map((v, i) => (
          <g key={`yt${i}`}>
            <line className="vzf-axis" x1={PAD.l - 4} y1={y(v)} x2={PAD.l} y2={y(v)} />
            <text className="vzf-tick" x={PAD.l - 8} y={y(v) + 3} textAnchor="end">
              {Math.round(v * 10) / 10}
            </text>
          </g>
        ))}
        {/* one path + dots per series */}
        {series.map((s) => (
          <g key={s.name ?? '__single__'} className="vzf-line-series">
            {s.points.length > 1 && (
              <path
                className="vzf-line-path"
                d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.epoch)},${y(p.mean)}`).join(' ')}
                stroke={seriesColor(s.name)}
              />
            )}
            {s.points.map((p) => (
              <circle key={p.date} className="vzf-line-dot" cx={x(p.epoch)} cy={y(p.mean)} r={3.5} fill={seriesColor(s.name)}>
                <title>{`${dayOf(p.date)}${s.name ? ' · ' + s.name : ''} · mean ${yLabel} ${Math.round(p.mean * 100) / 100} (${p.n} row${p.n === 1 ? '' : 's'})`}</title>
              </circle>
            ))}
          </g>
        ))}
        {/* inline legend — identity is never color-alone across ≥2 series.
            Top-LEFT inside the plot: a rising series occupies the top-right,
            so the left corner is the collision-free spot for trend data. */}
        {showLegend && (
          <g className="vzf-line-legend" aria-hidden="true">
            {series.map((s, i) => (
              <g key={s.name ?? '__single__'} transform={`translate(${PAD.l + 10}, ${PAD.t + i * 14})`}>
                <rect width={8} height={8} rx={2} fill={seriesColor(s.name)} />
                <text className="vzf-tick" x={12} y={7.5}>
                  {s.name ?? 'all'}
                </text>
              </g>
            ))}
          </g>
        )}
        {/* brush */}
        {brush && brush.w > 0 && (
          <rect className="vzf-brush" x={brush.x} y={PAD.t} width={brush.w} height={height - PAD.t - PAD.b} rx={2} />
        )}
        {/* interactive axis labels */}
        <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />
        <AxisLabel x={14} y={height / 2} text={yLabel} channel="y" anchor="middle" rotate={-90} onOpen={openPicker} />
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        compatible={compat}
        currentField={pickerChannel ? encoding[pickerChannel] ?? (pickerChannel === 'x' ? dateField : valueField) : undefined}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={() => setPickerChannel(null)}
      />
    </>
  );
}
