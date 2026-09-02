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
import { useMemo } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { ColumnView, ViewEncoding } from '../adapter/types.js';
import { linearScale, extent, ticks, epochOf, dayOf } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { EncodingPicker } from './EncodingPicker.js';
import { defaultCompat, type Compatibility } from '../primitives/compat.js';

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
  /** Contract mode (RP-1 `reencodeRequest`): an axis click asks the HOST instead of opening the built-in picker. */
  readonly onReencodeRequest?: (channel: string) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
  /**
   * Layer 4 `navigate`: the time window to SHOW, `[lo, hi]` as ISO dates or
   * epochs (either side null = open). Points outside are not drawn; nothing is
   * filtered — a viewport is not a data claim. Absent = the data's own extent.
   */
  readonly xDomain?: readonly [string | number | null, string | number | null];
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
    const epoch = epochOf(p.date);
    if (epoch === null) continue; // an unparseable date cannot be positioned — skipped, never guessed
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
    onReencodeRequest,
    width = 520,
    height = 340,
  } = props;

  const xDomain = props.xDomain;
  // the navigate window: keep only the points inside it — drawn extent follows the window, the data stays whole
  const scoped = useMemo(() => {
    if (xDomain === undefined) return data;
    const bound = (b: string | number | null): number | null => (b === null ? null : typeof b === 'number' ? b : epochOf(b));
    const lo = bound(xDomain[0]);
    const hi = bound(xDomain[1]);
    return data.filter((p) => {
      const e = epochOf(p.date);
      return e !== null && (lo === null || e >= lo) && (hi === null || e <= hi);
    });
  }, [data, xDomain]);
  const { series, dates } = useMemo(() => aggregate(scoped), [scoped]);
  const compat = useMemo(() => lineCompat(dateFields ?? [dateField]), [dateFields, dateField]);

  const [elo, ehi] = extent(dates, (d) => d.epoch, 0);
  const x = linearScale(elo, ehi, PAD.l, width - PAD.r);
  const allMeans = series.flatMap((s) => s.points);
  const [vlo, vhi] = extent(allMeans, (p) => p.mean, 0.5);
  const y = linearScale(vlo, vhi, height - PAD.b, PAD.t);

  /** The distinct data date NEAREST an epoch (dates is chronological, monotone in its argument). */
  const snapToDate = (epoch: number): { date: string; epoch: number } | null => {
    if (dates.length === 0) return null;
    let best = dates[0]!;
    for (const d of dates) {
      if (Math.abs(d.epoch - epoch) < Math.abs(best.epoch - epoch)) best = d;
    }
    return best;
  };

  // drag→interval on time — the brush primitive's completion discipline (a
  // sub-4px release clears); snap-to-data = the nearest DISTINCT data date per
  // endpoint, so the emitted bounds are actual column values (or nothing).
  const { svgRef, brush, handlers } = useHorizontalBrush({
    plotLeft: PAD.l,
    plotRight: width - PAD.r,
    width,
    field: dateField,
    snap: (loPx, hiPx) => {
      const lo = snapToDate(x.invert(loPx));
      const hi = snapToDate(x.invert(hiPx));
      // no dated rows at all — nothing to snap to; never fabricate an interval
      if (lo === null || hi === null) return null;
      // ISO strings on the interval rail: src/mosaic's ChartEmission tuple is
      // typed numerically (predates date intervals); src/data's IntervalClause
      // types + evaluates [string, string] — the documented cast, nowhere else.
      return [lo.date, hi.date] as unknown as [number, number];
    },
    onEmit,
  });

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

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
        {...handlers}
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
        <BrushOverlay brush={brush} y={PAD.t} height={height - PAD.t - PAD.b} />
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
        onClose={closePicker}
      />
    </>
  );
}
