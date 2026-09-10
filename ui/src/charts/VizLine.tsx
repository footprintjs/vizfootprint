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
 * matching {@link VizScatter}. `src/selection/emission.ts`'s `ChartEmission` types the
 * interval tuple numerically (it predates date intervals); the ISO pair rides
 * the same rail via one documented cast — the src/data seam (`IntervalClause`)
 * types and evaluates `[string, string]` correctly.
 *
 * Axis labels open the {@link EncodingPicker}: x offers only DATE-capable
 * columns, y only numeric ones — disabled-with-reason via {@link lineCompat}.
 */
import { useMemo } from 'react';
import type { ChartEmission } from 'vizfootprint/selection';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import { linearScale, extent, ticks, epochOf, dayOf, domainOr, scaleFor, placeable, padFor, extentFor, logTicks, logTickLabel, excludedNote, type ChartDomain } from '../primitives/scales.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { boundField } from './binding.js';
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
  /** The chart's accessible name — the prose plane's `altShort` lands here; absent = the chart names itself from its bindings. */
  readonly ariaLabel?: string;
  readonly viewId?: string;
  /** RAW points, already crossfiltered by the consumer — the chart aggregates (mean per date per series). */
  readonly data: readonly LinePoint[];
  /** The DATA field the time axis encodes (also the brush emit field) — a default, overridden by `encoding.x`. */
  readonly dateField?: string;
  /** The DATA field the y axis encodes — a default, overridden by `encoding.y`. */
  readonly valueField?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly colorOf?: (series: string | undefined) => string;
  /** Columns offered by the encoding picker (from adapter state). */
  readonly columns?: readonly ColumnView[];
  /** The encoding plane's verdicts per channel (`views[].fits` on the wire) — the built-in picker greys with the session's own sentences. */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  /**
   * The session's live channel→field map at the cursor. A channel it names
   * WINS over the field props below — see {@link boundField}: one binding,
   * named on the axis and emitted on a gesture alike.
   */
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
  /**
   * THE FRAME'S SCALES (protocol 1.5): the domains to draw against instead of
   * this chart's own extent, so a layer of a frame sits on the shared scale —
   * `x` in EPOCH MILLISECONDS (this chart positions dates on a linear scale),
   * `y` in the value column's own units. Absent = the chart's own extent, and
   * every mark is byte-identical to the chart before the prop existed.
   *
   * NOT a viewport and NOT a filter: unlike {@link VizLineProps.xDomain} it
   * drops no point — a domain says what the axis MEANS, and the points outside
   * it are simply drawn outside it.
   *
   * `transform` (protocol 1.6) is honoured on **y only**: this chart's x is a
   * date, and a date has no logarithm. A mean a logarithm cannot place has no
   * position, so it is not drawn and is counted in the chart's accessible name.
   */
  readonly domain?: ChartDomain;
  /**
   * Draw this chart's own axes (lines, ticks and the interactive axis labels).
   * Default `true`. `false` while the FRAME draws one merged guide for the
   * whole stack — including the re-encode affordance, which is the axis label.
   */
  readonly axes?: boolean;
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

/**
 * THE MARGIN BOX this chart draws inside — and its ONE owner. EXPORTED so a
 * frame can put this chart's plot box exactly where every other layer's is
 * (`VizFrame`): the frame offsets each layer by its own pad, so an alignment
 * computed there can never drift from the box drawn here.
 */
export const PAD = { l: 52, r: 18, t: 18, b: 44 };
/** One legend row's height, and the width the tick font takes per character (a measure, not a rule — SVG cannot ask before it draws). */
const LEGEND_ROW = 14;
const LEGEND_CHAR = 6.4;
const LEGEND_GAP = 14;

/** Lay the legend's names out in rows that fit `maxWidth`, left to right; one name alone on a row may exceed it (never dropped). */
function layoutLegend(names: readonly string[], maxWidth: number): { readonly items: readonly { readonly x: number; readonly row: number }[]; readonly height: number } {
  if (names.length < 2) return { items: [], height: 0 };
  const items: { x: number; row: number }[] = [];
  let x = 0;
  let row = 0;
  for (const name of names) {
    const w = 12 + name.length * LEGEND_CHAR;
    if (x > 0 && x + w > maxWidth) {
      x = 0;
      row++;
    }
    items.push({ x, row });
    x += w + LEGEND_GAP;
  }
  return { items, height: (row + 1) * LEGEND_ROW + 4 };
}

export function VizLine(props: VizLineProps): JSX.Element {
  const {
    viewId = 'line',
    data,
    colorOf,
    columns = [],
    fits,
    encoding = {},
    dateFields,
    onEmit,
    onReencode,
    onReencodeRequest,
    width = 520,
    height = 340,
  } = props;
  // ONE binding per channel — the session's when it named one, this chart's own
  // field prop otherwise; label, accessible name, tooltip and emit all use these.
  const dateField = boundField(encoding, 'x', props.dateField ?? 'date');
  const valueField = boundField(encoding, 'y', props.valueField ?? 'value');
  const xLabel = props.xLabel ?? dateField;
  const yLabel = props.yLabel ?? valueField;

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

  // the frame's domain when a frame gave one, this chart's own extent otherwise (../primitives/scales.ts)
  const [elo, ehi] = domainOr(props.domain?.x, extent(dates, (d) => d.epoch, 0));
  const x = linearScale(elo, ehi, PAD.l, width - PAD.r);
  // WHICH CURVE THE VALUE AXIS IS DRAWN ON. Only y: this chart's x is a DATE (epoch milliseconds)
  // and a date has no logarithm, so `transform.x` is ignored here — the same law ChartDomain already
  // keeps for a channel a chart has no quantitative scale for.
  const yKind = props.domain?.transform?.y;
  // a mean the transform cannot place has NO position: it is left out of the picture AND out of the
  // extent, and COUNTED (`excludedNote`). Guarded on a transform being declared, so a chart with
  // none filters nothing and stays byte-identical to the one that existed before this key.
  const placed = yKind === undefined ? series : series.map((s) => ({ ...s, points: s.points.filter((p) => placeable(yKind, p.mean)) }));
  const allMeans = placed.flatMap((s) => s.points);
  const excluded = series.reduce((n, s) => n + s.points.length, 0) - allMeans.length;
  // the chart's own breathing room, which a LOGARITHMIC axis takes none of (`padFor`); `extentFor` is
  // LOG-AWARE about an empty `allMeans` (see its own doc) so an all-excluded series gets the
  // placeholder decade rather than `extent`'s plain [0,1] default read as a real low bound to lift
  const [vlo, vhi] = domainOr(props.domain?.y, extentFor(allMeans, (p) => p.mean, padFor(yKind, 0.5), yKind));
  const axes = props.axes ?? true;
  // ≥2 series carry a legend ABOVE the plot, never over it: the band's rows are laid out first and the plot starts
  // below them, so a legend of nine regions cannot sit on top of nine spiky lines (identity is never colour-alone).
  const legend = layoutLegend(series.map((s) => s.name ?? 'all'), width - PAD.l - PAD.r);
  const top = PAD.t + legend.height;
  const y = scaleFor(yKind)(vlo, vhi, height - PAD.b, top);

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
      // ISO strings on the interval rail: src/selection/emission.ts's ChartEmission tuple is
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
  // the chart's OWN y extent is padded by 0.5, so its ticks step inside that padding; a frame's
  // domain carries no padding of ours, so its ticks span exactly what the axis claims
  const yPad = props.domain?.y === undefined ? 0.5 : 0;
  // a LOGARITHMIC value axis is ticked at decades instead, read off the scale's own clamped domain
  // (the span the marks were actually placed on) rather than the raw pair
  const yTickVals = yKind === 'log' ? logTicks(y.domain[0], y.domain[1], 4) : ticks(vlo + yPad, vhi - yPad, 3);

  const seriesColor = (name: string | undefined): string => (colorOf ? colorOf(name) : 'var(--vzf-brand)');
  const showLegend = series.length >= 2;

  return (
    <>
      <svg
        ref={svgRef}
        className={`vzf-chart vzf-line${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={(props.ariaLabel ?? `${yLabel} over ${xLabel}`) + excludedNote(excluded)}
        {...handlers}
      >
        {/* axes frame — absent while the FRAME draws one merged guide for the stack */}
        {axes && <line className="vzf-axis" x1={PAD.l} y1={height - PAD.b} x2={width - PAD.r} y2={height - PAD.b} />}
        {axes && <line className="vzf-axis" x1={PAD.l} y1={top} x2={PAD.l} y2={height - PAD.b} />}
        {/* x ticks — actual data dates; the edge labels anchor inward so they
            never clip at the plot edges or collide with each other */}
        {axes && tickSpecs.map((d) => (
          <g key={`xt${d.date}`}>
            <line className="vzf-axis" x1={x(d.epoch)} y1={height - PAD.b} x2={x(d.epoch)} y2={height - PAD.b + 4} />
            <text className="vzf-tick" x={x(d.epoch)} y={height - PAD.b + 16} textAnchor={d.anchor}>
              {dayOf(d.date)}
            </text>
          </g>
        ))}
        {/* y ticks */}
        {axes && yTickVals.map((v, i) => (
          <g key={`yt${i}`}>
            <line className="vzf-axis" x1={PAD.l - 4} y1={y(v)} x2={PAD.l} y2={y(v)} />
            <text className="vzf-tick" x={PAD.l - 8} y={y(v) + 3} textAnchor="end">
              {yKind === 'log' ? logTickLabel(v) : Math.round(v * 10) / 10}
            </text>
          </g>
        ))}
        {/* one path + dots per series — the placeable points; see `placed` above */}
        {placed.map((s) => (
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
        {/* the legend band above the plot — identity is never color-alone across ≥2 series */}
        {showLegend && (
          <g className="vzf-line-legend" aria-hidden="true">
            {series.map((s, i) => (
              <g key={s.name ?? '__single__'} transform={`translate(${PAD.l + legend.items[i]!.x}, ${PAD.t + legend.items[i]!.row * LEGEND_ROW})`}>
                <rect width={8} height={8} rx={2} fill={seriesColor(s.name)} />
                <text className="vzf-tick" x={12} y={7.5}>
                  {s.name ?? 'all'}
                </text>
              </g>
            ))}
          </g>
        )}
        {/* brush */}
        <BrushOverlay brush={brush} y={top} height={height - top - PAD.b} />
        {/* interactive axis labels — the re-encode affordance rides the guide, so the frame owns both or neither */}
        {axes && <AxisLabel x={(PAD.l + width - PAD.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />}
        {axes && <AxisLabel x={14} y={height / 2} text={yLabel} channel="y" anchor="middle" rotate={-90} onOpen={openPicker} />}
        {/* the words for what a transform could not place, IN THE PICTURE (`excludedNote` already
            carries it into the accessible name for a screen reader). Bottom-right, clear of the
            legend band the top carries for ≥2 series. */}
        {excluded > 0 && (
          <text className="vzf-excluded-note" x={width - PAD.r} y={height - PAD.b - 6} textAnchor="end">
            {excludedNote(excluded).replace(/^ — /, '')}
          </text>
        )}
      </svg>
      <EncodingPicker
        open={pickerChannel !== null}
        viewId={viewId}
        channel={pickerChannel ?? 'x'}
        columns={columns}
        fits={fits}
        compatible={compat}
        currentField={pickerChannel === null ? undefined : pickerChannel === 'x' ? dateField : boundField(encoding, pickerChannel, valueField)}
        onReencode={(v, c, f) => onReencode?.(v, c, f)}
        onClose={closePicker}
      />
    </>
  );
}
