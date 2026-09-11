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
 * Axis labels open the {@link EncodingPicker}: x offers DATE-capable columns
 * AND category columns (a string or a boolean — the band arm below), y only
 * numeric ones — disabled-with-reason via {@link lineCompat}.
 *
 * A LINE ON A BAND (the same component, a second arm of {@link LinePoint}):
 * band versus run is a property of the x COLUMN, not of the mark. A point may
 * carry a `category` instead of a `date`, and when the chart is handed a band
 * order (`domain.categories`, the frame's fold) or its points carry categories,
 * its x IS a band: each point sits at its slot's CENTRE in the band's order
 * (`bandOrder` — a category the order did not name is appended, never
 * dropped), the segments between are connectors drawn in slot order, and they
 * claim nothing between slots, because on a band there is no between — a slot
 * with no point is a GAP, and the segments on either side stop at their own
 * points (a line does not invent a value for an empty slot). The axis is the
 * band's labels, fitted the way a bar chart fits its own (`fitTick`). Ticks,
 * padding and the logarithm are y's business only; a band has none of them.
 * The time brush and the navigate window are a run's: an interval has no
 * meaning on a band, so a band line draws no brush.
 */
import { useMemo } from 'react';
import type { ChartEmission } from 'vizfootprint/selection';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import { linearScale, extent, ticks, epochOf, dayOf, domainOr, scaleFor, placeable, padFor, extentFor, logTicks, logTickLabel, excludedNote, bandOrder, bandWidth, bandCentre, padOnSide, type ChartDomain, type AxisSide } from '../primitives/scales.js';
import { TICK_ANGLE, fitTick } from './tickFit.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { useReencodePicker } from '../primitives/reencode.js';
import { boundField } from './binding.js';
import { EncodingPicker } from './EncodingPicker.js';
import { defaultCompat, type Compatibility } from '../primitives/compat.js';

/** A point on a RUN of dates. */
export interface DatedLinePoint {
  /** ISO-8601 date (or timestamp) string — lexicographic == chronological. */
  readonly date: string;
  readonly value: number;
  /** Optional series split (coloured via `colorOf`). */
  readonly series?: string;
}

/**
 * A point on a BAND: positioned at its category's slot centre. WHY a second arm
 * of one shape rather than a second component: band versus run is a property
 * of the x COLUMN, not of the mark — the same line, the same series, the same
 * mean per bucket and the same y; only WHERE a bucket sits differs.
 */
export interface BandLinePoint {
  /** The category whose slot this point sits in (the band's label). */
  readonly category: string;
  readonly value: number;
  /** Optional series split (coloured via `colorOf`). */
  readonly series?: string;
}

/** One point of the line, on a date or on a category — discriminated on which it carries, never by a prop. */
export type LinePoint = DatedLinePoint | BandLinePoint;

export interface VizLineProps {
  /** The chart's accessible name — the prose plane's `altShort` lands here; absent = the chart names itself from its bindings. */
  readonly ariaLabel?: string;
  readonly viewId?: string;
  /** RAW points, already crossfiltered by the consumer — the chart aggregates (mean per date — or per category, on a band — per series). */
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
   *
   * `categories` — the frame's BAND ORDER — makes this chart's x a band (the
   * same field `VizBar` reads through `bandOrder`): every point sits at its
   * slot's centre in that order, and a bar's slot and this line's point for one
   * category are ONE x (`bandCentre`, the one slot geometry). A run's `x` is not
   * read on a band, and a band's `categories` is not read on a run.
   */
  readonly domain?: ChartDomain;
  /**
   * Draw this chart's own axes (lines, ticks and the interactive axis labels).
   * Default `true`. `false` while the FRAME draws one merged guide for the
   * whole stack — including the re-encode affordance, which is the axis label.
   * `'y'`: ONLY the y axis — this chart's y is its own scale on a frame whose
   * x is the frame's, drawn once by the frame (`VizFrame`, the two-axis
   * figure); the x axis, its ticks and its label are the frame's to draw.
   */
  readonly axes?: boolean | 'y';
  /**
   * Which side the y axis stands on. Default `'left'`. `'right'`: the axis
   * line, its ticks (reading rightward) and its label stand on the right edge
   * and the chart keeps its y-axis room there instead (`padOnSide` — one
   * owner, read by `VizFrame` too), so the SECOND scale of a two-scale frame
   * has an edge of its own. The marks are placed exactly as on the left.
   */
  readonly axisSide?: AxisSide;
}

/**
 * The line chart's channel/column compatibility: x takes a DATE-capable
 * column (reported type `'date'`, or vouched for via `dateFields`) OR a
 * CATEGORY column (`'string'`/`'boolean'`) — the door widened
 * (`CHART_REQUIREMENTS.line.x`, `src/encoding/requirements.ts`) and this
 * chart draws the band `lineMark` builds for one (the discriminated
 * `LinePoint` union below), so the veto widens with it. A plain NUMBER stays
 * refused: this chart has no numeric-run arm — every x it draws is a date
 * (`Date.parse`) or a band, never a linear number line — so a column the
 * session's door admits (a line's x also takes a number) can still be one
 * this CHART cannot draw, and says so. y takes only numeric ones — each
 * refusal names its reason (honest affordance). Other channels (color …)
 * fall through to {@link defaultCompat}.
 */
export function lineCompat(dateFields: readonly string[] = []) {
  return (channel: string, column: ColumnView): Compatibility => {
    if (channel === 'x') {
      if (column.type === 'date' || column.type === 'string' || column.type === 'boolean' || dateFields.includes(column.field)) return { ok: true };
      return { ok: false, reason: `the x of a line needs a date or a category column — "${column.field}" is ${column.type}` };
    }
    if (channel === 'y') {
      if (column.type === 'number') return { ok: true };
      return { ok: false, reason: `y needs a numeric column — "${column.field}" is ${column.type}` };
    }
    return defaultCompat(channel, column);
  };
}

/** A band point carries a category, a dated one a date — the discriminant is what the point was given, never a prop. */
function isBandPoint(p: LinePoint): p is BandLinePoint {
  return 'category' in p;
}

/** The x KEY a point is bucketed under: its category on a band, its ISO date on a run. */
function keyOf(p: LinePoint): string {
  return isBandPoint(p) ? p.category : p.date;
}

/**
 * One position along x: its key, and `at` — the EPOCH of a date (placed through
 * the linear scale) or the SLOT INDEX of a category (placed at `bandCentre`).
 * One number in both arms so that ordering, adjacency and placement read it the
 * same way and never ask which kind of x they are on.
 */
interface XPosition {
  readonly key: string;
  readonly at: number;
}

interface SeriesPoint extends XPosition {
  readonly mean: number;
  readonly n: number;
}

interface SeriesGeom {
  readonly name: string | undefined;
  /** Mean value per position this series has a bucket for, in position order. */
  readonly points: readonly SeriesPoint[];
}

/**
 * The band this chart stands on, or `undefined` for a run of dates: the frame's
 * order first, then every key the points carry that it does not name
 * (`bandOrder` — nothing is dropped, a dated point handed to a band becomes a
 * slot named by its date). A band exists when the frame handed one OR any
 * point carries a category; with neither, x is the run it always was.
 */
function bandOf(given: readonly string[] | undefined, data: readonly LinePoint[]): readonly string[] | undefined {
  if (given === undefined && !data.some(isBandPoint)) return undefined;
  return bandOrder(given, [...new Set(data.map(keyOf))]);
}

/** Sum and count per (series, x key), series and keys both in first-seen order. */
function bucketise(data: readonly LinePoint[]): Map<string | undefined, Map<string, { sum: number; n: number }>> {
  const bySeries = new Map<string | undefined, Map<string, { sum: number; n: number }>>();
  for (const p of data) {
    let buckets = bySeries.get(p.series);
    if (!buckets) {
      buckets = new Map();
      bySeries.set(p.series, buckets);
    }
    const key = keyOf(p);
    const b = buckets.get(key);
    if (b) {
      b.sum += p.value;
      b.n += 1;
    } else {
      buckets.set(key, { sum: p.value, n: 1 });
    }
  }
  return bySeries;
}

/** Mean per (series, position): each series' points in position order, only where it has a bucket. */
function seriesOf(data: readonly LinePoint[], positions: readonly XPosition[]): SeriesGeom[] {
  return [...bucketise(data).entries()].map(([name, buckets]) => ({
    name,
    points: positions
      .filter((pos) => buckets.has(pos.key))
      .map((pos) => {
        const b = buckets.get(pos.key)!;
        return { key: pos.key, at: pos.at, mean: b.sum / b.n, n: b.n };
      }),
  }));
}

/** A RUN's geometry: every distinct parseable date, chronological, and the series over exactly those points (an unparseable date cannot be positioned — skipped, never guessed). */
function datedGeometry(data: readonly LinePoint[]): { series: SeriesGeom[]; positions: XPosition[] } {
  const dated = data.filter((p) => epochOf(keyOf(p)) !== null);
  const epochs = new Map<string, number>();
  for (const p of dated) epochs.set(keyOf(p), epochOf(keyOf(p))!);
  const positions = [...epochs.entries()].map(([key, at]) => ({ key, at })).sort((a, b) => a.at - b.at);
  return { series: seriesOf(dated, positions), positions };
}

/** A BAND's geometry: one position per slot, in the band's order, and the series over those slots. */
function bandGeometry(data: readonly LinePoint[], band: readonly string[]): { series: SeriesGeom[]; positions: XPosition[] } {
  const positions = band.map((key, at) => ({ key, at }));
  return { series: seriesOf(data, positions), positions };
}

/**
 * THE RUNS OF ONE SERIES' PATH. On a run of dates every consecutive pair
 * connects — the line joins the data dates it has, as it always did. On a band a
 * slot with no point is a GAP: the segments on either side stop at their own
 * points, because a line does not invent a value for an empty slot, and on a
 * band there is no between for a connector to claim. `adjacent` is that law,
 * spelled by the caller for the x it is on.
 */
function segmentsOf(points: readonly SeriesPoint[], adjacent: (a: SeriesPoint, b: SeriesPoint) => boolean): readonly (readonly SeriesPoint[])[] {
  const out: SeriesPoint[][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last !== undefined && adjacent(last[last.length - 1]!, p)) last.push(p);
    else out.push([p]);
  }
  return out;
}

/**
 * THE MARGIN BOX this chart draws inside — and its ONE owner. EXPORTED so a
 * frame can put this chart's plot box exactly where every other layer's is
 * (`VizFrame`): the frame offsets each layer by its own pad, so an alignment
 * computed there can never drift from the box drawn here.
 */
export const PAD = { l: 52, r: 18, t: 18, b: 44 };
/** Extra bottom room when a band label has to slant (the plot gives it up) — `VizBar`'s law, so a band line and a bar slant alike. */
const SLANT_PAD = 40;
/** Bottom pixels kept for the axis label, beneath the ticks. */
const AXIS_LABEL_ROOM = 24;
/** The plot height a slant may never take the chart below. */
const MIN_PLOT = 40;
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

  // WHICH X THIS CHART DRAWS — a band or a run — read off what it was handed (the frame's band order, or
  // points that carry a category) and never off a prop: the x column's type is a fact the definition and
  // the fold already carry, and a prop would be a second owner that could disagree with them.
  const givenBand = props.domain?.categories;
  const band = useMemo(() => bandOf(givenBand, data), [givenBand, data]);
  const xDomain = props.xDomain;
  // the navigate window: keep only the points inside it — drawn extent follows the window, the data stays whole.
  // A TIME window, so a band (no between to window) keeps every point.
  const scoped = useMemo(() => {
    if (xDomain === undefined || band !== undefined) return data;
    const bound = (b: string | number | null): number | null => (b === null ? null : typeof b === 'number' ? b : epochOf(b));
    const lo = bound(xDomain[0]);
    const hi = bound(xDomain[1]);
    return data.filter((p) => {
      const e = epochOf(keyOf(p));
      return e !== null && (lo === null || e >= lo) && (hi === null || e <= hi);
    });
  }, [data, xDomain, band]);
  const { series, positions } = useMemo(() => (band === undefined ? datedGeometry(scoped) : bandGeometry(scoped, band)), [scoped, band]);
  const compat = useMemo(() => lineCompat(dateFields ?? [dateField]), [dateFields, dateField]);

  // THE MARGIN THIS INSTANCE DRAWS INSIDE: `PAD` with its y-axis room on the side the axis stands
  // on (`padOnSide`, the one owner of that swap). With no side asked it IS `PAD`, so nothing moves.
  const pad = padOnSide(PAD, props.axisSide);
  // the frame's domain when a frame gave one, this chart's own extent otherwise (../primitives/scales.ts)
  const [elo, ehi] = domainOr(props.domain?.x, extent(positions, (d) => d.at, 0));
  const x = linearScale(elo, ehi, pad.l, width - pad.r);
  // ON A BAND, x is the slot geometry every mark on a band shares (`bandWidth`/`bandCentre`, ../primitives/scales.ts):
  // a bar's slot and this line's point for one category are ONE x by construction. `at` is the slot index there.
  const slot = band === undefined ? 0 : bandWidth(pad.l, width - pad.r, band.length);
  const xOf = (at: number): number => (band === undefined ? x(at) : bandCentre(pad.l, slot, at));
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
  // WHICH AXES THIS CHART DRAWS: both (`true`), neither (`false` — the frame's merged guide), or its y
  // alone (`'y'` — its own scale on a frame whose x is drawn once by the frame). Two flags, so the
  // x-side markup below reads one word and the y-side another.
  const drawX = axes === true;
  const drawY = axes !== false;
  // WHERE THE Y AXIS STANDS: the plot edge on its side. The ticks read away from the plot (leftward on
  // the left, rightward on the right) and the label rotates to face its edge — the mirror, nothing else.
  const yAxisX = props.axisSide === 'right' ? width - pad.r : pad.l;
  const yTickDir = props.axisSide === 'right' ? 1 : -1;
  // ≥2 series carry a legend ABOVE the plot, never over it: the band's rows are laid out first and the plot starts
  // below them, so a legend of nine regions cannot sit on top of nine spiky lines (identity is never colour-alone).
  const legend = layoutLegend(series.map((s) => s.name ?? 'all'), width - pad.l - pad.r);
  const top = pad.t + legend.height;
  // A BAND'S LABELS: one tick per slot at its centre, flat when it fits its slot and slanted (with the plot
  // giving up SLANT_PAD, never below MIN_PLOT) when any does not — `VizBar`'s own law, through the same
  // `fitTick`. No ticks, no tick room: with `axes={false}` the guide is the FRAME's, and giving up plot for
  // labels this chart is not drawing would move its baseline off every other layer's. A run keeps PAD.b
  // exactly, so nothing about a dated line moves.
  const bandLabels = drawX && band !== undefined ? band : [];
  const slanted = bandLabels.some((name) => fitTick(name, slot, 0).rotate);
  const padB = slanted ? Math.min(pad.b + SLANT_PAD, Math.max(pad.b, height - top - MIN_PLOT)) : pad.b;
  const tickRoom = Math.max(0, padB - 12 - AXIS_LABEL_ROOM);
  const bottom = height - padB;
  const y = scaleFor(yKind)(vlo, vhi, bottom, top);

  /** The distinct data date NEAREST an epoch (positions are chronological on a run, monotone in their argument). */
  const snapToDate = (epoch: number): XPosition | null => {
    if (positions.length === 0) return null;
    let best = positions[0]!;
    for (const d of positions) {
      if (Math.abs(d.at - epoch) < Math.abs(best.at - epoch)) best = d;
    }
    return best;
  };

  // drag→interval on time — the brush primitive's completion discipline (a
  // sub-4px release clears); snap-to-data = the nearest DISTINCT data date per
  // endpoint, so the emitted bounds are actual column values (or nothing).
  const { svgRef, brush, handlers } = useHorizontalBrush({
    plotLeft: pad.l,
    plotRight: width - pad.r,
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
      return [lo.key, hi.key] as unknown as [number, number];
    },
    onEmit,
  });
  // A BAND LINE DRAWS NO BRUSH: an interval has no meaning on a band (the string interval predicate compares
  // lexicographically, not in slot order), and a run of crossed slots is `VizBar`'s match law — a kind this
  // chart does not claim. So the handlers and the overlay ride only on a run of dates.
  const brushHandlers = band === undefined ? handlers : {};

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  // ≤3 tick dates: first (start-anchored), last (end-anchored), and the middle
  // date ONLY when its label physically fits between the edge labels — data
  // dates land where they land, so the middle can crowd an edge under uneven
  // gaps. Date labels are ~10 mono chars ≈ 62 viewBox units.
  const TICK_LABEL_W = 62;
  const tickSpecs: { key: string; at: number; anchor: 'start' | 'middle' | 'end' }[] = [];
  if (band === undefined && positions.length > 0) {
    const first = positions[0]!;
    const last = positions[positions.length - 1]!;
    tickSpecs.push({ ...first, anchor: positions.length === 1 ? 'middle' : 'start' });
    if (positions.length > 2) {
      const mid = positions[Math.round((positions.length - 1) / 2)]!;
      const fits =
        x(mid.at) - TICK_LABEL_W / 2 > x(first.at) + TICK_LABEL_W + 8 &&
        x(mid.at) + TICK_LABEL_W / 2 < x(last.at) - TICK_LABEL_W - 8;
      if (fits) tickSpecs.push({ ...mid, anchor: 'middle' });
    }
    if (positions.length > 1) tickSpecs.push({ ...last, anchor: 'end' });
  }
  // the gap law (`segmentsOf`): on a run every consecutive pair connects; on a band only ADJACENT slots do
  const adjacent = band === undefined ? (): boolean => true : (a: SeriesPoint, b: SeriesPoint): boolean => b.at === a.at + 1;
  /** What a point is called in its tooltip: its day on a run, its category on a band. */
  const nameOf = (key: string): string => (band === undefined ? dayOf(key) : key);
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
        {...brushHandlers}
      >
        {/* axes frame — absent while the FRAME draws one merged guide for the stack; the x half absent
            while the frame draws x once and this chart draws only its own y (`axes: 'y'`) */}
        {drawX && <line className="vzf-axis" x1={pad.l} y1={bottom} x2={width - pad.r} y2={bottom} />}
        {drawY && <line className="vzf-axis" x1={yAxisX} y1={top} x2={yAxisX} y2={bottom} />}
        {/* x ticks on a RUN — actual data dates; the edge labels anchor inward so they
            never clip at the plot edges or collide with each other */}
        {drawX && tickSpecs.map((d) => (
          <g key={`xt${d.key}`}>
            <line className="vzf-axis" x1={x(d.at)} y1={bottom} x2={x(d.at)} y2={bottom + 4} />
            <text className="vzf-tick" x={x(d.at)} y={bottom + 16} textAnchor={d.anchor}>
              {dayOf(d.key)}
            </text>
          </g>
        ))}
        {/* x ticks on a BAND — one per slot at its centre, the band's own labels (the markup `VizBar` draws) */}
        {bandLabels.map((name, i) => {
          const at = bandCentre(pad.l, slot, i);
          const tick = fitTick(name, slot, tickRoom, at);
          return (
            <g key={`xb${name}`}>
              <line className="vzf-axis" x1={at} y1={bottom} x2={at} y2={bottom + 4} />
              {tick.rotate ? (
                <text className="vzf-tick" x={at} y={bottom + 12} textAnchor="end" transform={`rotate(-${String(TICK_ANGLE)} ${String(at)} ${String(bottom + 12)})`}>
                  {tick.clipped ? <title>{name}</title> : null}
                  {tick.text}
                </text>
              ) : (
                <text className="vzf-tick" x={at} y={bottom + 16} textAnchor="middle">
                  {name}
                </text>
              )}
            </g>
          );
        })}
        {/* y ticks — on the axis's side, reading away from the plot */}
        {drawY && yTickVals.map((v, i) => (
          <g key={`yt${i}`}>
            <line className="vzf-axis" x1={yAxisX + 4 * yTickDir} y1={y(v)} x2={yAxisX} y2={y(v)} />
            <text className="vzf-tick" x={yAxisX + 8 * yTickDir} y={y(v) + 3} textAnchor={yTickDir < 0 ? 'end' : 'start'}>
              {yKind === 'log' ? logTickLabel(v) : Math.round(v * 10) / 10}
            </text>
          </g>
        ))}
        {/* one path per RUN of adjacent points (a run of dates is one run; a band breaks at every empty slot —
            `segmentsOf`) + a dot per point — the placeable points; see `placed` above. A run of one point draws
            its dot and no path: a line needs two points. */}
        {placed.map((s) => (
          <g key={s.name ?? '__single__'} className="vzf-line-series">
            {segmentsOf(s.points, adjacent)
              .filter((segment) => segment.length > 1)
              .map((segment) => (
                <path
                  key={`seg${segment[0]!.key}`}
                  className="vzf-line-path"
                  d={segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.at)},${y(p.mean)}`).join(' ')}
                  stroke={seriesColor(s.name)}
                />
              ))}
            {s.points.map((p) => (
              <circle key={p.key} className="vzf-line-dot" cx={xOf(p.at)} cy={y(p.mean)} r={3.5} fill={seriesColor(s.name)}>
                <title>{`${nameOf(p.key)}${s.name ? ' · ' + s.name : ''} · mean ${yLabel} ${Math.round(p.mean * 100) / 100} (${p.n} row${p.n === 1 ? '' : 's'})`}</title>
              </circle>
            ))}
          </g>
        ))}
        {/* the legend band above the plot — identity is never color-alone across ≥2 series */}
        {showLegend && (
          <g className="vzf-line-legend" aria-hidden="true">
            {series.map((s, i) => (
              <g key={s.name ?? '__single__'} transform={`translate(${pad.l + legend.items[i]!.x}, ${pad.t + legend.items[i]!.row * LEGEND_ROW})`}>
                <rect width={8} height={8} rx={2} fill={seriesColor(s.name)} />
                <text className="vzf-tick" x={12} y={7.5}>
                  {s.name ?? 'all'}
                </text>
              </g>
            ))}
          </g>
        )}
        {/* brush — a run's; a band draws none (see `brushHandlers`) */}
        {band === undefined && <BrushOverlay brush={brush} y={top} height={height - top - pad.b} />}
        {/* interactive axis labels — the re-encode affordance rides the guide, so the frame owns both or neither;
            the y label faces its edge: rotated to read upward on the left, downward on the right */}
        {drawX && <AxisLabel x={(pad.l + width - pad.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />}
        {drawY && <AxisLabel x={props.axisSide === 'right' ? width - 14 : 14} y={height / 2} text={yLabel} channel="y" anchor="middle" rotate={props.axisSide === 'right' ? 90 : -90} onOpen={openPicker} />}
        {/* the words for what a transform could not place, IN THE PICTURE (`excludedNote` already
            carries it into the accessible name for a screen reader). Bottom-right, clear of the
            legend band the top carries for ≥2 series. */}
        {excluded > 0 && (
          <text className="vzf-excluded-note" x={width - pad.r} y={bottom - 6} textAnchor="end">
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
