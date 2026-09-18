/**
 * `<VizLine>` — a responsive SVG series (mean of a numeric column per x
 * bucket, optionally split into coloured series) with a horizontal BRUSH.
 *
 * THREE KINDS OF X, AND THE KIND DECIDES THE CLAUSE (see `xKindOf`, the one
 * owner of "which x am I on"): a RUN OF DATES emits an interval of ISO dates,
 * a RUN OF NUMBERS emits an interval of NUMBERS, and a BAND emits the match
 * its slots speak. An interval addresses the axis it was drawn on or the
 * gesture is decoration.
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
 * A RUN OVER NUMBERS EMITS NUMBERS — the numeric arm, and the defect that
 * bought it. On a consumer's page two line charts invited a drag over a
 * residue-number axis. The brush DREW, the gesture FIRED, and nothing
 * happened: 162 marks before the drag and 162 after, with the session's own
 * refusal ledger climbing once per drag (3 at boot, 4 after one). The cause
 * was HERE: this chart positioned every run through `epochOf` — date
 * semantics — and snapped each endpoint to the nearest distinct data DATE, so
 * a numeric axis was handed a clause of date-shaped STRINGS, which a numeric
 * column cannot answer.
 *
 * THE EARLIER RECORDED CAUSE WAS WRONG, twice: two briefs before this one said
 * the x was a BAND and the band brush was built on that reading. The band arm
 * below earns its place (it shipped law 13's door and the `declared-delivered`
 * conformance step) but it never addressed this, and it is recorded here
 * because a wrong recorded cause is worse than none — the next reader builds
 * on it. What a numbers axis was actually doing before this arm, measured over
 * residues 1…241 through `Date.parse`: 1–12 landed in the twelve months of
 * 2001, 13–31 were UNPARSEABLE and silently dropped (19 residues gone from the
 * picture), 32–68 became 2032–2068, 69–99 became 1969–1999 and 100–241 became
 * the years 0100–0241 — four blocks in the wrong order, so residue 107 was
 * drawn to the LEFT of residue 99. The line a reader was reading was not the
 * data's shape at all.
 *
 * Its three rules, each of them a test. THE BOUNDS ARE THE AXIS'S, NOT THE
 * MARKS': a numeric drag emits the span the pointer COVERED — `[x.invert(lo),
 * x.invert(hi)]`, never snapped to a mark and never rounded. The date arm
 * snaps because its rail is STRINGS (an invented ISO string can be a format
 * the column never uses, and lexicographic order then disagrees with
 * chronology); numbers have no such hazard — the interval predicate compares
 * numerically — and a declared `bounds` lets a reader drag where no mark sits,
 * where snapping would move the clause to a distant mark, or collapse both
 * ends onto ONE mark: a clause the reader did not make. ORDER IS THE AXIS'S:
 * the bounds come back ascending whichever way the pointer went. EMPTY IS AN
 * ANSWER: a span that covers no data value emits NOTHING and says so
 * (`valuesCovered` + `noValuesCoveredNote`, the band arm's own shape, its own
 * words). A TAP clears, exactly as on a run of dates — the brush primitive's
 * default arm, untouched: a band's tap selects a SLOT because a slot is a
 * tiled target a drag alone could barely reach, and a run has no tiles, so the
 * nearest-mark guess would be the very clause the bounds rule refuses.
 *
 * AND IT ROUND-TRIPS: the numeric interval comes back through the read door
 * and this chart outlines the points inside it (`selfSelectedInterval`, the
 * one owner — the histogram's own law for the same clause).
 *
 * BRUSH → EMISSION on a run of DATES (design call): dates are ISO-8601 STRINGS and the brush
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
 * A ZERO GUIDE ON THE VALUE AXIS (`ChartDomain.zeroGuide.y`, law 12), when the
 * chart is told to draw one: a difference, a log ratio or a z-score over time
 * crosses zero and the SIGN is the reading. Its x takes none — a run of dates
 * has no zero a sign is read from and a band of categories has none at all —
 * which is the same channel the logarithm is honoured on here, for the same
 * reason.
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
 * The navigate window is a run's: a band has no between to window.
 *
 * A BAND IS A RANGE TOO (law 13) — the BAND BRUSH. Dragging across slots is a
 * meaningful gesture and this chart draws it, on a band exactly as on a run;
 * only the CLAUSE differs, because an interval has no meaning on a band (the
 * string interval predicate compares lexicographically, not in slot order). A
 * drag selects THE SLOTS WHOSE POINTS IT CROSSES — `slotsCovered`
 * (`../primitives/scales.ts`, the one owner of that question, which reads the
 * same `bandCentre` the points are drawn at) — and lands them as the MATCH a
 * band already speaks (`matchEmission`), which is the very clause `VizBar`'s
 * own drag over one band lands, so two charts over one band cannot mean two
 * different things. The order is the BAND'S (`bandOrder`), so a right-to-left
 * drag and a left-to-right one over the same slots are one selection. A drag
 * that crosses no point selects nothing and SAYS SO (`noSlotsCoveredNote`,
 * announced) rather than emitting an empty keep-list.
 *
 * A MARK A READER IS MEANT TO PRESS MUST BE REACHABLE — the sub-4px release (the
 * brush's TAP arm) SELECTS THE SLOT UNDER THE POINTER on a band (`tapSlot`),
 * landing the clause `VizBar`'s own click lands (`clickEmission` against this
 * view's live set). It used to release the match, which left a 5px slot
 * reachable by nothing but a drag; the release now lives where every other
 * chart puts it — click the selected slot AGAIN and it clears. No geometry
 * moved for it: a band line's hit surface is the svg-level brush, whose slots
 * TILE the plot, so the slot IS the target and two targets can never overlap.
 * What a narrow slot cannot promise is WHICH slot a press lands in, and that
 * the chart says out loud (`crowdedMarksNote`) instead of pretending.
 */
import { useMemo } from 'react';
import type { ChartEmission } from 'vizfootprint/selection';
import type { ColumnView, ViewEncoding, FitView } from '../adapter/types.js';
import type { RenderSelection } from '../contract/types.js';
import { linearScale, extent, ticks, epochOf, dayOf, domainOr, scaleFor, placeable, padFor, extentFor, logTicks, logTickLabel, excludedNote, outsideNotes, bandOrder, bandWidth, bandCentre, slotsCovered, slotAt, noSlotsCoveredNote, valuesCovered, noValuesCoveredNote, crowdedMarksNote, padOnSide, type ChartDomain, type AxisSide } from '../primitives/scales.js';
import { TICK_ANGLE, fitTick } from './tickFit.js';
import { AxisLabel } from '../primitives/AxisLabel.js';
import { zeroGuideFor, zeroGuideNotes } from '../primitives/zeroGuide.js';
import { scaleHueStyle } from '../primitives/scaleHue.js';
import { useHorizontalBrush, BrushOverlay } from '../primitives/brush.js';
import { matchEmission, clickEmission } from '../primitives/pointSelect.js';
import { slotValues, slotPress, noSlotValuesNote, type SlotRow } from '../primitives/slotValues.js';
import { selfSelectedInterval } from '../contract/selection.js';
import { markClass, selectedSet } from '../primitives/useSelection.js';
import { announce } from '../primitives/announce.js';
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
  /**
   * THE X CELL AS THE ROW HOLDS IT, when the label is not it — `true` under
   * the slot `"true"`, `63` under the slot `"63"`. A band's labels are
   * `String(cell)` all the way down, and a clause carries the COLUMN's own
   * value, so this is what the drag and the tap land (`../primitives/slotValues.ts`,
   * the one owner). Absent = the label IS the value, which is every band over
   * a string column and keeps that band byte-identical.
   */
  readonly cell?: unknown;
  readonly value: number;
  /** Optional series split (coloured via `colorOf`). */
  readonly series?: string;
}

/**
 * A point on a RUN OF NUMBERS: positioned at its own value on a linear axis.
 * WHY a third arm of one shape rather than a third component, and why `at`
 * rather than a second meaning for `date`: run-of-numbers versus run-of-dates
 * versus band is a property of the x COLUMN, and the honest way to carry that
 * is for the point to say which quantity it holds. A date that is really a
 * number cannot be told apart from a year (`Date.parse('107')` answers 0107
 * and `Date.parse('13')` answers nothing at all), so the two runs cannot share
 * one key.
 */
export interface NumericLinePoint {
  /** Where this point sits on the axis — the x column's own number. */
  readonly at: number;
  readonly value: number;
  /** Optional series split (coloured via `colorOf`). */
  readonly series?: string;
}

/** One point of the line, on a date, on a number or in a category — discriminated on which it carries, never by a prop. */
export type LinePoint = DatedLinePoint | BandLinePoint | NumericLinePoint;

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
  /**
   * Display a dated x tick and point tooltip in the host's chosen time format.
   * Default: the ISO date only. Use compact labels that fit the chart width.
   * Formatting never changes positions, date identities or brush emissions;
   * category/band labels keep their literal names.
   */
  readonly formatDate?: (iso: string) => string;
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
   * The clause-addressable crossfilter selection (RP-1) — read for the view's
   * OWN live clause, in the one form the x it stands on can draw:
   *
   *   - on a BAND, which slots its match/point holds, outlined on their points
   *     (`selectedSet`/`markClass`, `VizBar`'s own two);
   *   - on a RUN OF NUMBERS, which points its own INTERVAL contains
   *     (`selfSelectedInterval`, the one owner — the histogram's own law for
   *     the same clause).
   *
   * Either way it closes the brush's round trip: the clause a drag emits comes
   * back through the read door and the chart draws it over the SAME range it
   * selected.
   *
   * A RUN OF DATES reads nothing from it and is byte-identical with or without
   * the prop. Not because a date interval is unreadable — it is the same
   * clause one type along — but because that arm is PINNED byte-identical
   * (`VizLine.test.tsx`, the date-arm identity test): giving it the outline is
   * a change to a picture nothing asked to change. Recorded as owed, not as
   * law.
   */
  readonly selection?: RenderSelection;
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
  /**
   * THE INK OF THIS SCALE — the hue a two-scale frame handed this layer
   * (`FrameLayerDraw.scaleHue`, `VizFrame` its one owner; a CSS variable
   * reference such as `var(--vzf-scale-left)`). This chart's OWN y axis — its
   * line, its ticks and its label — is drawn in it, and so are its marks WHEN
   * THEY ARE UNSPLIT: a chart split into series by `colorOf` keeps its series
   * colours, because identity is never colour-alone and a scale may not take a
   * hue that already names something. Absent = the ink token and
   * `var(--vzf-brand)`, byte-identical to this chart before the prop existed.
   */
  readonly scaleHue?: string;
}

/**
 * The line chart's channel/column compatibility: x takes a DATE-capable
 * column (reported type `'date'`, or vouched for via `dateFields`), a CATEGORY
 * column (`'string'`/`'boolean'`) or a NUMBER — the three x kinds this chart
 * draws ({@link xKindOf}), which is exactly what the session's own door admits
 * (`CHART_REQUIREMENTS.line.x`, `src/encoding/requirements.ts`), so the two no
 * longer disagree. The number used to be REFUSED here, and that refusal was
 * honest while it stood: the chart had no numeric-run arm and every x it drew
 * was a date or a band. It has one now, so the veto goes — a picker that greys
 * a column the chart can draw is the same lie in the other direction.
 *
 * y takes only numeric ones — each refusal names its reason (honest
 * affordance). Other channels (color …) fall through to {@link defaultCompat}.
 */
export function lineCompat(dateFields: readonly string[] = []) {
  return (channel: string, column: ColumnView): Compatibility => {
    if (channel === 'x') {
      if (column.type === 'date' || column.type === 'string' || column.type === 'boolean' || column.type === 'number' || dateFields.includes(column.field)) return { ok: true };
      return { ok: false, reason: `the x of a line needs a date, a number or a category column — "${column.field}" is ${column.type}` };
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

/** …and a point on a run of NUMBERS carries the number it sits at — the third arm of the same discriminant. */
function isNumericPoint(p: LinePoint): p is NumericLinePoint {
  return 'at' in p;
}

/** The x KEY a point is bucketed under: its category on a band, its number's own text on a numeric run, its ISO date on a run of dates. */
function keyOf(p: LinePoint): string {
  if (isBandPoint(p)) return p.category;
  return isNumericPoint(p) ? String(p.at) : p.date;
}

/**
 * ONE POINT AS THE SLOT OWNER READS IT — its key (the slot it is drawn under)
 * and the CELL its column holds there, handed to `slotValues`/`slotPress`
 * (`../primitives/slotValues.ts`, the one owner of what a slot's name stands
 * for). A dated point offers no cell because its ISO string IS its value; a
 * NUMERIC point handed to a band offers `at` — which is the whole first-party
 * shape of this defect, since `xKindOf` lets a band win over the points' own
 * quantity and `keyOf` then names that slot `String(p.at)`.
 */
function slotRowOf(p: LinePoint): SlotRow {
  if (isBandPoint(p)) return { name: p.category, cell: p.cell };
  return isNumericPoint(p) ? { name: String(p.at), cell: p.at } : { name: p.date };
}

/**
 * WHERE A POINT SITS ON A RUN, or null when this axis cannot place it: the
 * EPOCH of its date, or the number itself. One owner, asked by the navigate
 * window and by the run's geometry alike, so the two can never disagree about
 * which points exist — and the reason the two runs are ONE arm with two
 * readers rather than two geometries.
 */
function runPositionOf(p: LinePoint): number | null {
  if (!isNumericPoint(p)) return epochOf(keyOf(p));
  return Number.isFinite(p.at) ? p.at : null;
}

/** WHICH X THIS CHART IS ON — three answers, one owner. */
type XKind = 'band' | 'numbers' | 'dates';

/**
 * THE ONE OWNER OF "WHAT KIND IS THIS AXIS" for this chart's own positioning,
 * and it reads only what the chart was HANDED — the band order a frame merged
 * (or a point carrying a category, through {@link bandOf}) and then the points
 * themselves. Never a prop: the x column's type is a fact the definition and
 * the fold already carry (`frameScaleOf`, `src/encoding/frame.ts`), and a prop
 * would be a second owner that could disagree with them (`ui/src/contract/README.md`
 * records that refusal by name).
 *
 * A BAND WINS, because a band is an order a frame declared and the points'
 * own quantity cannot outvote it — a number handed to a band becomes a slot
 * named by its number, exactly as a date does. Otherwise ONE numeric point
 * makes the axis numbers, which is `bandOf`'s own `some` discipline: a mixed
 * bag has to land on one axis, and the run that can place a number is the
 * only one that can place it honestly.
 */
function xKindOf(band: readonly string[] | undefined, data: readonly LinePoint[]): XKind {
  if (band !== undefined) return 'band';
  return data.some(isNumericPoint) ? 'numbers' : 'dates';
}

/**
 * Is a position inside the view's own live interval? An OPEN side claims
 * everything on it; a bound that is not this axis's own quantity claims
 * NOTHING — the read door's no-cross-type-coercion law (`../contract/selection.ts`
 * · `intervalPredicate`), asked here so a string interval landed by someone
 * else cannot outline a numeric point it could never keep.
 */
function inSpan(span: readonly [number | string | null, number | string | null], at: number): boolean {
  const [lo, hi] = span;
  if (typeof lo === 'string' || typeof hi === 'string') return false;
  return (lo === null || at >= lo) && (hi === null || at <= hi);
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

/**
 * A RUN's geometry — dates or numbers, ONE arm: every distinct POSITIONABLE x
 * in the axis's own order, and the series over exactly those points. A value
 * the axis cannot place is skipped and never guessed (an unparseable date, a
 * number that is not finite) — which is the date arm's own law, now asked
 * through {@link runPositionOf} so a numeric run keeps it for free.
 */
function runGeometry(data: readonly LinePoint[]): { series: SeriesGeom[]; positions: XPosition[] } {
  const placed = data.filter((p) => runPositionOf(p) !== null);
  const ats = new Map<string, number>();
  for (const p of placed) ats.set(keyOf(p), runPositionOf(p)!);
  const positions = [...ats.entries()].map(([key, at]) => ({ key, at })).sort((a, b) => a.at - b.at);
  return { series: seriesOf(placed, positions), positions };
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
  const formatDate = props.formatDate ?? dayOf;

  // WHICH X THIS CHART DRAWS — a band or a run — read off what it was handed (the frame's band order, or
  // points that carry a category) and never off a prop: the x column's type is a fact the definition and
  // the fold already carry, and a prop would be a second owner that could disagree with them.
  const givenBand = props.domain?.categories;
  const band = useMemo(() => bandOf(givenBand, data), [givenBand, data]);
  // …and WHICH x that makes this: a band, a run of numbers or a run of dates (`xKindOf`, the one owner
  // — every branch below reads this one answer and none of them re-derives it)
  const kind = useMemo(() => xKindOf(band, data), [band, data]);
  // WHAT THIS CHART'S SLOTS STAND FOR — its own rows as the one owner of that question reads them
  // (`slotRowOf` → `slotValues`/`slotPress`), folded once per data change and asked by BOTH band
  // gestures below, so a drag and a tap over one slot can never name two different values.
  const slotRows = useMemo(() => data.map(slotRowOf), [data]);
  const xDomain = props.xDomain;
  // the navigate window: keep only the points inside it — drawn extent follows the window, the data stays whole.
  // A TIME window, so a band (no between to window) keeps every point.
  const scoped = useMemo(() => {
    if (xDomain === undefined || band !== undefined) return data;
    // A BOUND IS READ IN THE AXIS'S OWN QUANTITY — an epoch on a run of dates, the number itself on a
    // run of numbers — and a bound this axis cannot read leaves that side OPEN, which is the date arm's
    // own law (an unparseable ISO string has always answered `null` here) rather than a guess.
    const bound = (b: string | number | null): number | null =>
      kind === 'numbers' ? (Number.isFinite(b) ? (b as number) : null) : b === null ? null : typeof b === 'number' ? b : epochOf(b);
    const lo = bound(xDomain[0]);
    const hi = bound(xDomain[1]);
    return data.filter((p) => {
      const at = runPositionOf(p);
      return at !== null && (lo === null || at >= lo) && (hi === null || at <= hi);
    });
  }, [data, xDomain, band, kind]);
  const { series, positions } = useMemo(() => (band === undefined ? runGeometry(scoped) : bandGeometry(scoped, band)), [scoped, band]);
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
  // MARKS CLOSER TOGETHER THAN A POINTER CAN SEPARATE, said out loud. A tap reaches every slot however
  // narrow it is (`tapSlot` below), but WHICH slot a press lands in is the slot's own width: at 185
  // residues in a 940px pane that is under 5px, and a press a few pixels off lands on a NEIGHBOUR. So the
  // chart confesses it (`crowdedMarksNote`, ../primitives/scales.ts — the one owner of the words and of
  // the WCAG floor they name), in its accessible name and in the picture, in the same register it says a
  // value is not drawn. A RUN takes none: its x is a continuum with no slots to crowd, and its own gesture
  // is the interval brush — so a dated line is byte-identical to the chart before this packet.
  const crowded = band === undefined ? '' : crowdedMarksNote(slot);
  // WHICH CURVE THE VALUE AXIS IS DRAWN ON. Only y: this chart's x is a DATE (epoch milliseconds)
  // and a date has no logarithm, so `transform.x` is ignored here — the same law ChartDomain already
  // keeps for a channel a chart has no quantitative scale for.
  const yKind = props.domain?.transform?.y;
  // a mean the transform cannot place has NO position: it is left out of the picture AND out of the
  // extent, and COUNTED (`excludedNote`).
  // GUARDED ON A LOGARITHM and not on the key's presence: `'linear'` is the axis this chart already drew
  // (`ChartDomain.transform`'s own law), so a def that declares it out loud must filter nothing — and the
  // sentence this count is said in names a logarithm, so nothing else may be counted into it.
  const placed = yKind === 'log' ? series.map((s) => ({ ...s, points: s.points.filter((p) => placeable(yKind, p.mean)) })) : series;
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
  // THE INK OF THIS SCALE, on the parts of the y axis this chart draws: one inherited variable the
  // stylesheet spends per element (`scaleHueStyle`), and nothing at all when no hue was handed
  const hueStyle = scaleHueStyle(props.scaleHue);
  // what an UNSPLIT mark is drawn with: the hue its scale was handed, the brand where there is none
  // (a chart split into series keeps `colorOf`'s answer — identity is never colour-alone)
  const markInk = props.scaleHue ?? 'var(--vzf-brand)';
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

  /**
   * A DRAG OVER A RUN OF NUMBERS: the span the pointer covered, in the axis's own quantity — the
   * inverted pixels themselves, never snapped to a mark and never rounded (the header's argument: a
   * snap or an outward round claims a value the reader did not drag over). `null` when the span covers
   * no data value at all, which is the brush primitive's own NOTHING — the brush clears, no emission
   * fires, and the reader is told out loud rather than meeting silence or a clause no row can answer.
   */
  const numericSpan = (loPx: number, hiPx: number): [number, number] | null => {
    const lo = x.invert(loPx);
    const hi = x.invert(hiPx);
    if (valuesCovered(positions.map((d) => d.at), lo, hi).length === 0) {
      announce(noValuesCoveredNote());
      return null;
    }
    return [lo, hi];
  };

  /** The distinct data date NEAREST an epoch (positions are chronological on a run, monotone in their argument). */
  const snapToDate = (epoch: number): XPosition | null => {
    if (positions.length === 0) return null;
    let best = positions[0]!;
    for (const d of positions) {
      if (Math.abs(d.at - epoch) < Math.abs(best.at - epoch)) best = d;
    }
    return best;
  };

  // THE VIEW'S OWN SET — read for the band's outlines and for the POLARITY a band drag keeps (`VizBar` ·
  // `endRun` passes the same `set.exclude`: a drag inside an exclude-set removes from it, it never flips).
  // With no `selection` it is the empty keep-set, so `markClass` returns '' and a run is untouched.
  const set = selectedSet(undefined, props.selection);
  // …AND THE RUN'S OWN LIVE INTERVAL, which closes the numeric arm's round trip: the clause a numeric
  // drag emitted comes back through the read door and the points inside it wear the outline
  // (`selfSelectedInterval`, the ONE owner of "what interval does this view itself hold" — the very
  // function `VizHistogram` reads for the same clause). A run of DATES asks for none, which is what
  // keeps that arm byte-identical with or without the prop.
  const ownSpan = kind === 'numbers' && props.selection !== undefined ? selfSelectedInterval(props.selection) : null;
  /** The outline a point earns from the view's OWN clause: its slot on a band, its place in the interval on a numeric run, nothing on a run of dates. */
  const outlineOf = (p: SeriesPoint): string => {
    if (band !== undefined) return markClass(p.key, set);
    if (ownSpan === null) return '';
    return inSpan(ownSpan, p.at) ? ' vzf-selected' : '';
  };
  // A BAND DRAG IS A RUN OF SLOTS, NOT AN INTERVAL (law 13): the slots whose POINTS the drag crossed
  // (`slotsCovered`, the one owner), named in the BAND's order, landed as the match `VizBar` lands over the
  // same band. No slot crossed ⇒ NOTHING, said out loud — never an empty keep-list, which matches nothing.
  const selectSlots = (names: readonly string[], loPx: number, hiPx: number): ChartEmission | null => {
    const covered = slotsCovered(pad.l, width - pad.r, names.length, loPx, hiPx);
    if (covered.length === 0) {
      announce(noSlotsCoveredNote());
      return null;
    }
    // …AND A SLOT IS A NAME FOR A VALUE, so the clause carries what the ROWS hold under those slots
    // and never the labels they are drawn with (`slotValues`, the one owner — a band over a column of
    // numbers selects `63`, not `"63"`). On a band of strings the names ARE the values and nothing
    // moves. Every covered slot skipped ⇒ NOTHING, said out loud in the owner's own words: the rows
    // name no value there, and an empty keep-list would match everything's opposite — nothing at all.
    const values = slotValues(covered.map((at) => names[at]!), slotRows);
    if (values.length === 0) {
      announce(noSlotValuesNote());
      return null;
    }
    return matchEmission(dateField, values, set.exclude);
  };

  // A TAP ON A BAND SELECTS ITS SLOT. It used to RELEASE the match, which left a 5px slot reachable by
  // nothing but a drag — the measured defect: 185 residues across a 940px pane, and a browser driver
  // refused to click one as unstable. So a tap now lands the slot the pointer is inside (`slotAt`, the one
  // owner of that question — `VizBar` · `bandAt` asks it for the same pixel, so a bar's slot and this
  // line's slot can never be two different slots), spelled as the clause the BAR's own click lands
  // (`clickEmission` against this view's live set, byte for byte) — so two charts over one band cannot
  // mean two different things on the same gesture, and an exclude-set keeps its polarity here exactly as
  // it does under the drag. THE RELEASE IS STILL REACHABLE, in the place every other chart puts it:
  // clicking the SELECTED slot again clears it (`clickEmission` → `togglePointEmission`, the
  // click-again-clears arm `VizBar`'s click and the histogram's click-a-bucket-again both ride).
  const tapSlot = (names: readonly string[], px: number): void => {
    const at = slotAt(pad.l, width - pad.r, names.length, px);
    // NO SLOT AT ALL — a band a frame declared with no categories and no point to name one. Nothing was
    // pressed and there is nothing to release, so nothing is emitted: the same NOTHING an uncovered drag
    // lands, and never a fabricated clause.
    if (at < 0) return;
    // WHAT THAT SLOT STANDS FOR is the drag's own question asked for one slot (`slotPress` — literally
    // `slotValues` over a one-name list, so a press and a drag cannot read one band two ways). A slot
    // the rows name no value for, and a slot naming SEVERAL (a point addresses one), land nothing and
    // say why — never a clause spelled from the label, which is the defect this whole arm exists for.
    const pressed = slotPress(names[at]!, slotRows);
    if ('note' in pressed) {
      announce(pressed.note);
      return;
    }
    onEmit?.(clickEmission(dateField, pressed.value, set));
  };

  // drag→interval on the run — the brush primitive's completion discipline (a
  // sub-4px release clears, on BOTH runs: a run has no tiled target for a tap
  // to land in, so the nearest-mark guess is the clause the reader did not
  // make). WHICH interval is the axis's: the span covered on a run of NUMBERS
  // (`numericSpan`), and on a run of dates snap-to-data = the nearest DISTINCT
  // data date per endpoint, so the emitted bounds are actual column values (or
  // nothing). One `snap` slot, the kind picks the arm.
  const { svgRef, brush, handlers } = useHorizontalBrush({
    plotLeft: pad.l,
    plotRight: width - pad.r,
    width,
    field: dateField,
    snap: kind === 'numbers' ? numericSpan : (loPx, hiPx) => {
      const lo = snapToDate(x.invert(loPx));
      const hi = snapToDate(x.invert(hiPx));
      // no dated rows at all — nothing to snap to; never fabricate an interval
      if (lo === null || hi === null) return null;
      // ISO strings on the interval rail: src/selection/emission.ts's ChartEmission tuple is
      // typed numerically (predates date intervals); src/data's IntervalClause
      // types + evaluates [string, string] — the documented cast, nowhere else.
      return [lo.key, hi.key] as unknown as [number, number];
    },
    // the two BAND arms, absent on a run so a dated line is byte-identical to the chart before law 13: the
    // drag lands its slots, and the sub-4px release SELECTS THE SLOT UNDER THE POINTER (`tapSlot` — the
    // reachability law; the brush's default tap arm is the run's cleared interval, a clause this x cannot
    // hold at all)
    ...(band === undefined ? {} : { select: (loPx: number, hiPx: number) => selectSlots(band, loPx, hiPx), onTap: (px: number): void => tapSlot(band, px) }),
    onEmit,
  });

  const { pickerChannel, openPicker, closePicker } = useReencodePicker(onReencodeRequest);

  // ≤3 ticks on a RUN (either kind): first (start-anchored), last (end-anchored), and the middle
  // position ONLY when its label physically fits between the edge labels — data values land where they
  // land, so the middle can crowd an edge under uneven gaps. Date labels are ~10 mono chars ≈ 62
  // viewBox units, which a number's own text never exceeds, so the fit test is conservative for it.
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
  /**
   * What a point is called in its tick and its tooltip: its day on a run of dates, and its own literal
   * text on a band or a run of numbers. `formatDate` is a DATE formatter and never sees a number — a
   * number spelled by a date formatter is a lie about what the axis holds.
   */
  const nameOf = (key: string): string => (kind === 'dates' ? formatDate(key) : key);
  // the chart's OWN y extent is padded by 0.5, so its ticks step inside that padding; a frame's
  // domain carries no padding of ours, so its ticks span exactly what the axis claims
  const yPad = props.domain?.y === undefined ? 0.5 : 0;
  // a LOGARITHMIC value axis is ticked at decades instead, read off the scale's own clamped domain
  // (the span the marks were actually placed on) rather than the raw pair
  const yTickVals = yKind === 'log' ? logTicks(y.domain[0], y.domain[1], 4) : ticks(vlo + yPad, vhi - yPad, 3);

  // ZERO IS A PLACE ON THE AXIS (law 12), and on a line it is a place on the VALUE axis only: a difference,
  // a log ratio or a z-score over time crosses zero and the sign is the reading. Its x does not take one —
  // a run of dates has no zero a reader reads a sign from (an epoch's is 1970, an accident of the encoding)
  // and a band of categories has no zero at all — which is the same channel list `transform` already keeps
  // here, and the def door refuses a `zeroGuide` on a line's x by name (`drawsZeroGuide`).
  //
  // IT IS NOT GATED ON `drawY`, AND THE OLD RULE THAT GATED IT WAS WRONG — the argument is written out
  // once, at `VizScatter`'s own guide: `axes: false` is a DENSITY decision (no room for tick labels), not
  // "this chart has no axis", and a tick label needs room to be legible where a line at zero needs one
  // pixel. Who ELSE might draw it is decided where that is known — a frame drawing the merged guide does
  // not ASK its layers (`layerDomain`, `../contract/renderers.tsx`).
  const zeroY = zeroGuideFor({ channel: 'y', asked: props.domain?.zeroGuide?.y, domain: [vlo, vhi], ...(yKind === undefined ? {} : { transform: yKind }), place: y });
  const zeroNotes = zeroGuideNotes(zeroY);
  // …and the words for a mean outside the extent the value axis was DECLARED on (`outsideNotes`, the one
  // owner) — counted off the means this chart PLACED, so one a logarithm already excluded is not said twice
  const outside = outsideNotes([{ channel: 'y', given: props.domain?.y, values: allMeans.map((p) => p.mean) }]);

  // one answer, read by path, dot and legend swatch alike: the series' colour where the chart is split, `markInk` where it is not
  const seriesColor = (name: string | undefined): string => (colorOf ? colorOf(name) : markInk);
  const showLegend = series.length >= 2;

  return (
    <>
      <svg
        ref={svgRef}
        className={`vzf-chart vzf-line${props.className ? ' ' + props.className : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={(props.ariaLabel ?? `${yLabel} over ${xLabel}`) + excludedNote(excluded) + [...zeroNotes, ...outside].map((note) => ` — ${note}`).join('') + crowded}
        {...handlers}
      >
        {/* axes frame — absent while the FRAME draws one merged guide for the stack; the x half absent
            while the frame draws x once and this chart draws only its own y (`axes: 'y'`) */}
        {drawX && <line className="vzf-axis" x1={pad.l} y1={bottom} x2={width - pad.r} y2={bottom} />}
        {drawY && <line className="vzf-axis" x1={yAxisX} y1={top} x2={yAxisX} y2={bottom} style={hueStyle} />}
        {/* the zero guide — furniture, edge to edge across the plot, under the series and over the axis;
            drawn by whoever draws this axis, so a layer under a merged guide draws none */}
        {zeroY !== undefined && 'at' in zeroY && <line className="vzf-zero" x1={pad.l} y1={zeroY.at} x2={width - pad.r} y2={zeroY.at} />}
        {/* x ticks on a RUN — actual data dates; the edge labels anchor inward so they
            never clip at the plot edges or collide with each other */}
        {drawX && tickSpecs.map((d) => (
          <g key={`xt${d.key}`}>
            <line className="vzf-axis" x1={x(d.at)} y1={bottom} x2={x(d.at)} y2={bottom + 4} />
            <text className="vzf-tick" x={x(d.at)} y={bottom + 16} textAnchor={d.anchor}>
              {nameOf(d.key)}
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
          <g key={`yt${i}`} style={hueStyle}>
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
              <circle key={p.key} className={`vzf-line-dot${outlineOf(p)}`} cx={xOf(p.at)} cy={y(p.mean)} r={3.5} fill={seriesColor(s.name)}>
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
        {/* the live drag rectangle — the SAME overlay on a run and on a band (law 13): what differs is the
            clause the release lands, never whether a reader can see the drag they are making */}
        <BrushOverlay brush={brush} y={top} height={height - top - pad.b} />
        {/* interactive axis labels — the re-encode affordance rides the guide, so the frame owns both or neither;
            the y label faces its edge: rotated to read upward on the left, downward on the right */}
        {drawX && <AxisLabel x={(pad.l + width - pad.r) / 2} y={height - 8} text={xLabel} channel="x" onOpen={openPicker} />}
        {drawY && <AxisLabel x={props.axisSide === 'right' ? width - 14 : 14} y={height / 2} text={yLabel} channel="y" anchor="middle" rotate={props.axisSide === 'right' ? 90 : -90} hue={props.scaleHue} onOpen={openPicker} />}
        {/* the words for what a transform could not place, IN THE PICTURE (`excludedNote` already
            carries it into the accessible name for a screen reader). Bottom-right, clear of the
            legend band the top carries for ≥2 series. */}
        {excluded > 0 && (
          <text className="vzf-excluded-note" x={width - pad.r} y={bottom - 6} textAnchor="end">
            {excludedNote(excluded).replace(/^ — /, '')}
          </text>
        )}
        {/* the words for marks a pointer cannot separate — bottom-right beside the excluded note, one
            line above it when both are there (they are two different facts about the same picture and
            neither may cover the other), and in the accessible name above */}
        {crowded !== '' && (
          <text className="vzf-crowded-note" x={width - pad.r} y={bottom - 6 - (excluded > 0 ? 11 : 0)} textAnchor="end">
            {crowded.replace(/^ — /, '')}
          </text>
        )}
        {/* a zero guide this value axis has no place for, REFUSED IN WORDS — bottom-LEFT, opposite the
            excluded note, and in the accessible name above; never a line clamped to an edge */}
        {zeroNotes.map((note, i) => (
          <text key={`zn${i}`} className="vzf-zero-note" x={pad.l} y={bottom - 6 - i * 11} textAnchor="start">
            {note}
          </text>
        ))}
        {/* …and a mean outside the extent the value axis was DECLARED on, in the same register and
            continuing the same stack upwards: the point IS placed, at its true position, which at that
            position is off the plot — so the count is the only thing that says it exists */}
        {outside.map((note, i) => (
          <text key={`on${i}`} className="vzf-outside-note" x={pad.l} y={bottom - 6 - (zeroNotes.length + i) * 11} textAnchor="start">
            {note}
          </text>
        ))}
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
