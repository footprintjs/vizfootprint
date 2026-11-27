/** A pure linear scale with an inverse (data ⇄ pixel), no chart-library dep. */
export interface LinearScale {
  (v: number): number;
  invert(px: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

export function linearScale(d0: number, d1: number, r0: number, r1: number): LinearScale {
  const m = (r1 - r0) / (d1 - d0 || 1);
  const f = ((v: number) => r0 + (v - d0) * m) as ((v: number) => number) & {
    invert(px: number): number;
    domain: [number, number];
    range: [number, number];
  };
  f.invert = (px: number) => d0 + (px - r0) / m;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

/**
 * THE VALUE UNDER A POINTER: the scale's own inverse of the pixel, as it is —
 * never snapped to a mark and never rounded, because a bound that has moved
 * either drops a mark the pointer covered or claims one it did not.
 *
 * A POINTER HELD AT AN END OF THE SCALE'S RANGE (a drag that reached the edge
 * of the plot, where a brush holds it) is at the axis's own end, and that end
 * is answered EXACTLY. The inverse of the edge pixel can differ from it in the
 * last bit, which is enough to leave the smallest or the largest value outside
 * a drag across everything.
 *
 * ONE OWNER, for every chart that reads a value off a pointer (the scatter's
 * and the numeric line's drags, the histogram's tap).
 */
export function pointerValue(scale: LinearScale, px: number): number {
  // A DOMAIN WITH NO LENGTH HAS NO ENDS TO ANSWER. A scale built over one value (5 … 5) still draws,
  // one unit wide, and reports the same number for both ends, so "the end of the domain" is not what
  // stands at the far end of its range. There the scale's own inverse is the only honest answer.
  if (scale.domain[0] === scale.domain[1]) return scale.invert(px);
  const [r0, r1] = scale.range;
  const [first, last] = r0 <= r1 ? [0, 1] : [1, 0];
  if (px <= Math.min(r0, r1)) return scale.domain[first]!;
  if (px >= Math.max(r0, r1)) return scale.domain[last]!;
  return scale.invert(px);
}

/** The [min, max] extent of a numeric accessor over rows, padded by `pad`. */
export function extent<T>(rows: readonly T[], get: (r: T) => number, pad = 0): [number, number] {
  if (rows.length === 0) return [0 - pad, 1 + pad];
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = get(r);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0 - pad, 1 + pad];
  if (lo === hi) return [lo - pad - 1, hi + pad + 1];
  return [lo - pad, hi + pad];
}

/** `n+1` evenly-spaced tick values across [lo, hi]. */
export function ticks(lo: number, hi: number, n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(lo + ((hi - lo) * k) / n);
  return out;
}

// ── the shared date handling (ISO-8601 strings, lexicographic == chronological) ──

/**
 * An ISO-8601 date string's epoch milliseconds, or null when unparseable —
 * a chart positions dates on a linear scale through this and SKIPS what it
 * cannot place (never guessed; the VizLine/VizHistogram discipline).
 */
export function epochOf(iso: string): number | null {
  const epoch = Date.parse(iso);
  return Number.isNaN(epoch) ? null : epoch;
}

/** The date-part of an ISO string — tick labels stay short even for full timestamps. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** The largest epoch a `Date` can hold, either side of 1970 (ECMAScript's time range). */
const DATE_RANGE_MS = 8.64e15;

/**
 * An epoch as a date axis writes a bound: the day where it is a day's start (UTC midnight), the whole
 * instant otherwise, so two bounds inside one day are not written as the same day twice. An epoch no
 * `Date` can hold is written as its number, never thrown on.
 */
export function dateOfEpoch(epoch: number): string {
  if (!(Math.abs(epoch) <= DATE_RANGE_MS)) return String(epoch);
  const iso = new Date(epoch).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? dayOf(iso) : iso;
}

// ── the shared sequential-ramp step (the map's magnitude scale, D30 reused) ──

/** How many steps the quantized `--vzf-seq-*` sequential ramp has. */
export const SEQ_RAMP_STEPS = 5;

/**
 * The fill of the EMPTY state. `--vzf-map-empty` has no value of its own: it
 * follows the raised surface wherever that changes (a forced mode, a nested
 * theme) unless a theme names it — see `FOLLOWING_TOKENS` in `src/theme/tokens.ts`.
 */
export const EMPTY_FILL = 'var(--vzf-map-empty, var(--vzf-surface-2))';

/**
 * Ramp step 1..{@link SEQ_RAMP_STEPS} for a value in (0, max]. A 0/absent
 * value is the EMPTY state (`--vzf-map-empty`, the honest neutral), never
 * step 1 — step 1 means "low", not "none". Shared by VizMap and VizHeatmap
 * so magnitude reads identically across both.
 */
export function rampStep(value: number, max: number): number {
  return Math.min(SEQ_RAMP_STEPS, Math.max(1, Math.ceil((value / max) * SEQ_RAMP_STEPS)));
}

// ── the frame's scales (protocol 1.5) — a chart's domain is swappable ─────────

/**
 * A CHART'S SCALES ARE SWAPPABLE. Every 2D chart takes a `domain` and an
 * `axes` prop: it draws its OWN extent by default and is byte-identical to the
 * chart that existed before these props, and given a `domain` it scales to THAT
 * instead — the numbers folded by `frameDomains` over every layer of a frame,
 * so two charts stacked on one frame put equal values at equal pixels. With
 * `axes={false}` a chart draws no guide at all, because the frame is drawing
 * one for the whole stack (`guide: 'merged'`).
 *
 * WHY props and not a context: a chart with a domain prop is still a standalone
 * chart, testable and usable with no frame in sight — and the host that folded
 * the domain is the one that knows which rows it folded.
 */
/**
 * The scale domains a frame hands a chart, in the DATA UNITS that chart's axis
 * already reads — which is per chart, and each says so at its own prop:
 * `VizLine`'s x is epoch milliseconds, `VizBar` has no quantitative x at all
 * (its x is a band per category), `VizHeatmap`'s x is epoch milliseconds and
 * its rows are categories. A chart ignores an axis it has no quantitative
 * scale for; it never invents one to fit the prop.
 *
 * NUMBERS, so a TEMPORAL domain is converted by the caller: `frameDomains`
 * folds a date channel to a pair of ISO strings (`ResolvedDomain`), and a chart
 * that positions dates on a linear scale reads epoch milliseconds — `epochOf`
 * (this module, exported) is the bridge, and it is the same function the charts
 * use on their own rows, so a converted domain and the marks agree. A
 * CATEGORICAL domain rides on `categories` instead of `x`: a band chart has no
 * quantitative x to scale, and what a frame can honestly give it is the ORDER
 * its slots sit in ({@link bandOrder}).
 *
 * ONE LAW ACROSS EVERY CHART, for a value outside the domain: it is DRAWN, at
 * its true position, and nothing is dropped or clamped. A domain says what the
 * axis MEANS; a row outside it is a data fact, not an overflow, and a chart
 * that silently rescaled or hid it would be answering a question nobody asked.
 * The only clip is the SVG viewport itself, so a mark far outside simply falls
 * outside the picture — which is what a shared frame is FOR: the reader sees
 * that this layer runs past what the frame was folded over.
 */
export interface ChartDomain {
  readonly x?: readonly [number, number];
  readonly y?: readonly [number, number];
  /**
   * WHICH OF THE TWO PAIRS ABOVE IS A DECLARATION — what the quantity CAN be
   * (`ChannelResolution.bounds`), and not a span folded from the rows.
   *
   * A chart needs to know to speak truly about a mark outside its span. Past
   * DECLARED bounds, either the bounds are wrong or the data is, and the chart
   * says so. Past a FOLDED span nothing was claimed: a fold is not always a
   * union that holds every mark (it is taken over one bound column, and may
   * read a cell differently from the chart), so the chart says only that the
   * mark stands outside the span it was given. Absent = not declared, which is
   * the honest reading of a pair handed over with no word about where it came
   * from ({@link declaredOn}).
   */
  readonly declared?: { readonly x?: boolean; readonly y?: boolean };
  /** The frame's BAND ORDER for a shared categorical channel — see {@link bandOrder}. A chart with no band ignores it. */
  readonly categories?: readonly string[];
  /**
   * WHICH CURVE EACH AXIS IS DRAWN ON (protocol 1.6) — the renderer's half of
   * the library's `ChannelResolution.transform`, read through {@link scaleFor}.
   * Absent (or `'linear'`) is the axis every chart drew before this key, so a
   * chart with no transform is byte-identical to the one that existed before.
   *
   * ONE KEY PER CHANNEL, grouped under `transform` rather than spelled as two
   * more flat siblings, because it is the AXIS'S OWN NATURE and not a bound of
   * it: `x` says what the axis spans, `transform.x` says how the span is
   * traversed, and the two are read at different moments (the domain is folded
   * over the data, the curve is declared once and never folded).
   *
   * THE SAME LAW `x`/`y`/`categories` already keep: a chart ignores the entry
   * for a channel it has no quantitative scale for, and never invents one to
   * fit the prop. Per chart, the channels that honour it — `VizScatter` x and
   * y, `VizLine` y (its x is a date, and a date has no logarithm),
   * `VizHistogram` and `VizHeatmap` x (their bin edges, so log-spaced bins are
   * legitimate). `VizBar`, `VizBoxPlot` and `VizNetwork` honour NEITHER
   * channel: a bar's x is a band and its y is a count read from a baseline, a
   * box's y is that SAME shape (its extent read whisker-to-whisker, which is
   * why the def door refuses `'boxplot'` right alongside `'bar'` in law 11c —
   * `zeroAnchorsChannel` treats the two identically), and a node-link's x and
   * y are one spatial substrate with one px-per-unit, which a factor axis
   * would turn into a spiral.
   *
   * A COUNT AXIS (VizBar's and VizHistogram's y, VizHeatmap's colour ramp) is
   * drawn from zero and is deliberately NOT logarithmic here: it is a magnitude
   * read as a length, and on a logarithmic axis a bar four times as long is not
   * four times the value.
   */
  readonly transform?: { readonly x?: ScaleKind; readonly y?: ScaleKind };
  /**
   * DRAW THE LINE WHERE THIS AXIS CROSSES ZERO (law 12) — the renderer's half
   * of the library's `ChannelResolution.zeroGuide`, answered by
   * {@link zeroGuideFor} (`./zeroGuide.ts`, the one owner of both the verdict
   * and the words). Absent is the picture every chart drew before this key, so
   * a chart with no zero guide is byte-identical to the one that existed before.
   *
   * ONE KEY PER CHANNEL, grouped the way `transform` is and for the same
   * reason: it is the AXIS'S OWN NATURE and not a bound of it. It is the ASK
   * and never the verdict — whether zero is actually ON the axis is decided
   * where the numbers are, by the chart, against the domain it drew on (which
   * is its OWN extent when no frame handed it one, and only the chart has
   * that).
   *
   * NAMED FOR ZERO AND NOT FOR THE CENTRE: the middle of a domain is not zero
   * unless the domain happens to be symmetric, and a line down the middle of an
   * all-positive axis would be a quiet lie. DECLARED AND NOT AUTOMATIC: a guide
   * that appeared by itself whenever a domain happened to include zero would
   * draw the same view differently at two cursors with nothing in the record
   * saying why.
   *
   * THE SAME LAW `x`/`y`/`categories`/`transform` already keep: a chart ignores
   * the entry for a channel it has no axis for, and never invents one to fit
   * the prop. Per chart, the channels that honour it — `VizScatter` x and y (a
   * Ramachandran plot's φ and ψ are the figure that asked for it), `VizLine` y
   * (its x is a run of dates or a band of categories, and neither has a zero),
   * and `VizFrame` on each axis of the merged guide it draws. Every other chart
   * draws NONE, and a def that asks one of them is refused BY NAME at the def
   * door and by the frame (`drawsZeroGuide` / `zeroGuideKindRefusal`,
   * `vizfootprint/def`) rather than quietly ignored.
   *
   * A COUNT AXIS (VizBar's and VizHistogram's y) and a box's whisker-to-whisker
   * extent are read from a baseline that IS zero, so the line would be drawn
   * over the axis that already says it — which is why those marks refuse the
   * key instead of drawing furniture twice.
   */
  readonly zeroGuide?: { readonly x?: boolean; readonly y?: boolean };
}

/**
 * The domain a chart scales by: the frame's when it was given one, its own
 * extent otherwise.
 *
 * Two guards, both because a linear scale divides by the span. A FLAT domain
 * (`lo === hi`) is widened by one on each side — exactly what `extent` does
 * with data that holds one distinct value — and a domain that is not two finite
 * numbers is not a domain at all, so the chart keeps its own rather than
 * drawing marks at NaN.
 *
 * ON A LOGARITHMIC AXIS (`kind: 'log'`) a flat domain is handed on FLAT. A
 * logarithm measures in factors, so its widening is a decade each side, and
 * that rule has one owner, {@link logDomain}, which `scaleFor` applies. Widened
 * by one here first, a single value of 0.001 became −0.999 … 1.001, the clamp
 * lifted the low end to 0.1, and the value itself was drawn far outside the
 * plot with nothing said. A chart on a logarithmic channel must pass its kind.
 */
export function domainOr(given: readonly [number, number] | undefined, own: readonly [number, number], kind?: ScaleKind): [number, number] {
  if (given === undefined || !Number.isFinite(given[0]) || !Number.isFinite(given[1])) return [own[0], own[1]];
  const [lo, hi] = [Math.min(given[0], given[1]), Math.max(given[0], given[1])];
  return lo === hi && kind !== 'log' ? [lo - 1, hi + 1] : [lo, hi];
}

/**
 * THE SPAN A COUNT IS DRAWN ON: from ZERO up to its ceiling, and never a
 * ceiling below one. A bar's and a histogram bin's length is read from zero,
 * so the floor is zero whatever a frame folded, and a column of zeroes still
 * gets a plot one unit tall with its bars on the floor.
 *
 * ONE OWNER, because three things must agree to the pixel: the bars, the
 * histogram's bins, and the guide a frame draws for a stack that holds them.
 * (A mark that is not a count scales by {@link domainOr}.)
 */
export function countSpan(given: readonly [number, number] | undefined, own: readonly [number, number]): [number, number] {
  return [0, Math.max(1, domainOr(given, own)[1])];
}

/**
 * THE BAND ORDER a frame hands a band chart: the categories, in the order the
 * frame folded them (`frameDomains`' categorical union — first-seen across the
 * layers in declaration order). A bar layer and a bar layer over two different
 * tables put "Casual" over the same slot only if one list decides the slots, and
 * that list is this one.
 *
 * It rides on {@link ChartDomain} beside `x`/`y` rather than in a prop of its
 * own because it IS the x domain when the shared channel is categorical — a
 * band chart has no quantitative x to scale, so `domain.x` is dead there and
 * `domain.categories` is what a frame can honestly give it.
 *
 * NOT read through `domainOr`: that one holds the guards a LINEAR scale needs
 * (two finite numbers, a widened flat span, divide-by-zero), and a category
 * list has none of them — {@link bandOrder} is its sibling, and the two are
 * deliberately separate so neither has to ask what kind of thing it was given.
 */
/**
 * The bands to lay out, left to right: the frame's list, then any category the
 * chart's own rows carry that the frame's list does not name, in the chart's
 * own order.
 *
 * TWO LAWS, both the same law the numeric domains keep:
 *
 *   1. NOTHING IS DROPPED. A category outside the frame's list is APPENDED, not
 *      hidden — the band-axis spelling of "a value outside the domain is drawn
 *      at its true position". A frame folded over the whole table and a layer
 *      drawing rows that reach past it is a data fact the reader should see.
 *   2. A BAND WITH NO ROW IS EMPTY, never a zero. The chart draws no mark in
 *      it, because "this layer has no row for Formal" and "this layer counted
 *      none" are two different sentences, and a zero-height bar with a tooltip
 *      saying 0 tells the second one.
 *
 * With no frame list the answer is the chart's own order, unchanged — which is
 * what every band chart did before a frame existed.
 */
export function bandOrder(given: readonly string[] | undefined, own: readonly string[]): readonly string[] {
  if (given === undefined) return own;
  return [...given, ...own.filter((category) => !given.includes(category))];
}

/**
 * THE SLOT GEOMETRY OF A BAND AXIS — and its ONE owner. A band axis divides its
 * plot width into equal slots, one per category in {@link bandOrder}'s order;
 * every mark that stands on a band places itself off these three numbers, so a
 * bar's slot and a line's point for one category sit at ONE x by construction
 * rather than by two charts agreeing on an arithmetic (`VizBar` draws its rect
 * inside `bandStart`..`+bandWidth`, `VizLine` puts a band point at
 * `bandCentre`, and `VizFrame`'s merged guide puts the tick there too).
 *
 * `bandWidth` is clamped at zero — a cell pushed narrower than its own margins
 * never draws a negative width — and divides by at least 1, so an empty band has
 * a width without a divide-by-zero (it is never read: no category, no slot).
 */
export function bandWidth(from: number, to: number, count: number): number {
  return Math.max(0, (to - from) / Math.max(1, count));
}

/** Where slot `index` begins: the axis's start plus `index` slots. */
export function bandStart(from: number, width: number, index: number): number {
  return from + width * index;
}

/** The middle of slot `index` — where a band point sits, and where its tick is drawn. */
export function bandCentre(from: number, width: number, index: number): number {
  return bandStart(from, width, index) + width / 2;
}

/**
 * WHICH SLOTS A PIXEL RANGE COVERS — the ONE owner of that question, and the
 * band's half of the drag gesture (`VizLine`'s band brush, handed to
 * `useHorizontalBrush` through its `select` arm).
 *
 * A SLOT IS COVERED WHEN ITS CENTRE IS IN THE RANGE, because the centre is
 * where the mark stands ({@link bandCentre} — a line's point, a bar's tick,
 * the frame's merged tick). A slot whose mark the drag never reached would be
 * a category the reader did not touch, and a band's edges are SLOTS and not
 * pixels: which pixel a drag stopped on inside a slot says nothing, and only
 * whether it got past the mark does.
 *
 * THE ANSWER IS IN THE BAND'S OWN ORDER, ascending by slot index, whichever
 * way the drag ran — so a right-to-left drag and a left-to-right one over the
 * same slots are the same selection. The order is the band's
 * ({@link bandOrder}) and never the pixel order of a pointer.
 *
 * EMPTY IS AN ANSWER: a drag that covers no slot's centre covers NO slot, and
 * its caller says so ({@link noSlotsCoveredNote}) rather than emitting a
 * clause over an empty list — an empty keep-list matches nothing
 * (`matchEmission`'s own law).
 *
 * WHY THIS IS NOT `VizBar`'s arithmetic: a bar asks a different question —
 * which BARS did the pointer press and release on (`VizBar` · `bandAt`, one
 * pixel to the slot it is inside, clamped into the band) — and the run between
 * two marks the reader actually pressed is the honest answer there. This is
 * the question a BRUSH asks: which marks does this span reach. The two
 * questions share their CLAUSE (`matchEmission` over the slot names, the one
 * owner of those words), which is what keeps two charts over one band from
 * meaning two different things.
 */
export function slotsCovered(from: number, to: number, count: number, aPx: number, bPx: number): readonly number[] {
  const width = bandWidth(from, to, count);
  const lo = Math.min(aPx, bPx);
  const hi = Math.max(aPx, bPx);
  const covered: number[] = [];
  for (let index = 0; index < count; index++) {
    const centre = bandCentre(from, width, index);
    if (centre >= lo && centre <= hi) covered.push(index);
  }
  return covered;
}

/**
 * WHICH SLOT ONE PIXEL IS INSIDE — the ONE owner of that question, and the
 * other half of a band's pointer arithmetic ({@link slotsCovered} answers it
 * for a RANGE). A press is a point, not a span: the slot it lands in is the
 * one whose territory holds it, and a press outside the band clamps to the
 * nearest end slot, because a pointer that fell in the axis margin still
 * pressed the chart and the nearest slot is the only honest answer.
 *
 * ASKED BY BOTH CHARTS THAT STAND ON A BAND, which is why it is here and not
 * in either of them: `VizBar` · `bandAt` (one pixel to the bar its drag-run
 * ends on) and `VizLine`'s band TAP (one pixel to the slot a click selects).
 * The two used to be one arithmetic spelled once and quoted in a comment;
 * they are one function now, so a bar's slot and a line's slot cannot drift.
 *
 * THE SLOTS TILE THE AXIS, which is the whole reason a press can be answered
 * at all when the marks are 5px apart — and also the reason a pointer TARGET
 * may never be wider than one ({@link pointerTargetWidth}): overlapping
 * targets would make a press land on a neighbour.
 *
 * `count === 0` answers `-1` — no slot, because there is no band. Its caller
 * reads that as "nothing was pressed" rather than as slot 0.
 */
export function slotAt(from: number, to: number, count: number, px: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor((px - from) / bandWidth(from, to, count))));
}

/**
 * THE WORDS FOR A DRAG THAT COVERED NO SLOT — the band brush's own sentence,
 * owned here beside {@link slotsCovered} exactly as {@link excludedNote} owns
 * the words for what a transform could not place. Said out loud by the chart
 * (`announce`, the library's one polite live region), because a gesture that
 * selected nothing is news a sighted reader sees and a screen-reader user
 * would otherwise meet as silence.
 */
export function noSlotsCoveredNote(): string {
  return 'a drag selects the slots whose points it crosses — this one crossed none, so nothing was selected';
}

/**
 * THE VALUES A NUMERIC SPAN COVERS — {@link slotsCovered}'s twin for a RUN of
 * numbers, and the one owner of that question, asked in DATA space so the
 * caller's own scale stays the only thing that inverts a pixel (`VizLine`'s
 * numeric brush inverts through its `linearScale` and asks this).
 *
 * WHY A RUN NEEDS ONE AT ALL, when the clause it lands is the span itself: a
 * drag that covers no value is not a selection — an interval nothing can
 * answer is the empty keep-list one layer along, and the band arm already
 * refuses that shape ({@link noSlotsCoveredNote}). So the chart asks what the
 * span reached before it emits, and says {@link noValuesCoveredNote} when the
 * answer is nothing.
 *
 * INCLUSIVE at both ends, and ORDER-FREE in its bounds, exactly as
 * {@link slotsCovered} is: a right-to-left drag and a left-to-right one over
 * one span are one selection. The answer keeps the order it was GIVEN — the
 * caller's positions are the axis's own order, never the pointer's.
 */
export function valuesCovered(values: readonly number[], a: number, b: number): readonly number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return values.filter((v) => v >= lo && v <= hi);
}

/**
 * THE WORDS FOR A DRAG OVER A RUN THAT COVERED NO VALUE — the numeric brush's
 * own sentence, owned here beside {@link noSlotsCoveredNote} for the reason
 * that one is: a gesture that selected nothing is news, and one owner means
 * two charts cannot word it two ways. Its own words, not the band's: a run has
 * no slots, and a reader told about slots on an axis of numbers would go
 * looking for something that is not there.
 */
export function noValuesCoveredNote(): string {
  return 'a drag selects the values its span covers — this one covered none, so nothing was selected';
}

// ── which side a y axis stands on — the second axis of a frame ────────────────

/** Where a chart's y axis stands: the left edge (every chart's default), or the right — the SECOND axis of a two-scale frame (`VizFrame`, law 1). */
export type AxisSide = 'left' | 'right';

/**
 * A chart's margin box with its y-axis room on the side its axis stands on.
 * A chart keeps tick-and-label room on the LEFT (`PAD.l`) and only breathing
 * room on the right; a right axis needs the same room on the right, so the two
 * horizontal margins swap and the vertical ones stand. ONE owner of that swap:
 * the chart reads it to place its own plot, and the frame reads it to place
 * the chart's svg and to union the layers' margins — so the room the frame
 * keeps and the room the chart draws in can never be two numbers. `'left'`
 * returns the very object it was given, so a chart without the prop is
 * byte-identical to the chart before sides existed.
 */
export function padOnSide<P extends { readonly l: number; readonly r: number; readonly t: number; readonly b: number }>(pad: P, side: AxisSide | undefined): P {
  return side === 'right' ? { ...pad, l: pad.r, r: pad.l } : pad;
}

// ── the logarithmic axis (protocol 1.6) — a transform is not a resolution ─────

/**
 * WHICH CURVE A CHANNEL IS DRAWN ON. The renderer's half of the library's
 * `ChannelResolution.transform`: an axis is linear (the default, and the word
 * is spellable so a def can say it out loud) or logarithmic, base 10.
 */
export type ScaleKind = 'linear' | 'log';

/**
 * A BASE-10 LOGARITHMIC SCALE, the same shape {@link linearScale} returns
 * (data ⇄ pixel with an inverse) so a chart's positioning code never branches
 * on which one it holds.
 *
 * IT NEVER ACCEPTS A NON-POSITIVE BOUND, and refuses loudly rather than
 * returning a scale that answers NaN: a logarithm has no answer for 0 or a
 * negative number, and an axis whose bounds are NaN draws every mark at the
 * same wrong pixel — a drawn lie, which is the one thing this repo refuses to
 * ship. Deciding what a non-positive bound MEANS is the caller's job because
 * only the caller's channel knows; {@link scaleFor} is the caller every chart
 * uses, and {@link logDomain} is the decision it makes.
 *
 * A VALUE outside the domain is still placed (the ChartDomain law: nothing is
 * clamped), but a value ≤ 0 has no logarithm and so has no position at all —
 * ask {@link placeable} before drawing it, and count what you did not draw
 * ({@link excludedNote}).
 */
export function logScale(d0: number, d1: number, r0: number, r1: number): LinearScale {
  if (!(d0 > 0) || !(d1 > 0)) {
    throw new RangeError(`logScale: a logarithmic axis has no place for ${d0 > 0 ? d1 : d0} — clamp the domain to positive numbers first (scaleFor does)`);
  }
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const m = (r1 - r0) / (l1 - l0 || 1);
  const f = ((v: number) => r0 + (Math.log10(v) - l0) * m) as ((v: number) => number) & {
    invert(px: number): number;
    domain: [number, number];
    range: [number, number];
  };
  f.invert = (px: number) => 10 ** (l0 + (px - r0) / m);
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

/**
 * THE DOMAIN A LOGARITHMIC SCALE CAN BE BUILT OVER: the pair, lifted to
 * strictly positive bounds and widened by a decade when it is flat.
 *
 * Three decisions, each the log spelling of something {@link domainOr} and
 * `extent` already do linearly:
 *
 *   1. a FLAT domain gets a decade either side — `extent`'s ±1, in the units a
 *      logarithm measures in (a factor, not a difference).
 *   2. a low bound ≤ 0 is lifted to one decade below the high bound, because a
 *      logarithm cannot reach it and a reader still needs an axis under the
 *      marks that ARE placeable.
 *   3. NOTHING POSITIVE AT ALL gets the placeholder decade [1, 10]. No mark can
 *      be drawn on it — every cell was excluded — so the axis labels nothing,
 *      and the chart's words carry the whole story ({@link excludedNote}).
 *      Invented, and only ever under a picture with no marks in it.
 */
export function logDomain(d0: number, d1: number): [number, number] {
  // both ends kept INSIDE what a number can hold, on the way in and on the way out: an infinite end is
  // the largest number, a decade below the smallest numbers rounds to zero (which a logarithm cannot
  // take), and a decade above the largest to infinity
  const lo = Math.min(Number.MAX_VALUE, Math.min(d0, d1));
  const hi = Math.min(Number.MAX_VALUE, Math.max(d0, d1));
  if (!(hi > 0)) return [1, 10];
  const below = Math.max(Number.MIN_VALUE, hi / 10);
  if (lo === hi) return [below, Math.min(Number.MAX_VALUE, hi * 10)];
  return [lo > 0 ? lo : below, hi];
}

/**
 * {@link extent}, LOG-AWARE: what a chart's OWN (undeclared) domain falls back
 * to when it has NO data at all.
 *
 * `extent([])` answers `[0, 1]` (widened by `pad`) — a fine LINEAR default, an
 * axis has to span something — but `padFor` already zeroes `pad` for a
 * logarithmic channel, so that default collapses to EXACTLY `[0, 1]`. Handed
 * to {@link logDomain}, `1` is a positive high bound, so it reads as clamp 2
 * ("lift the low bound") rather than clamp 3 ("nothing is placeable at all") —
 * the WRONG one of the two, because there was never a real span here, only
 * `extent`'s own placeholder.
 *
 * WHY `[0, 0]` is the right substitute: every row this function is ever
 * called with has already been filtered through {@link placeable} (a chart's
 * `drawable`/`placed` arrays), so a NON-EMPTY result can never touch zero
 * either — `padFor('log', …)` is 0, so nothing pads a real minimum down to it.
 * `[0, 0]` therefore never collides with a genuine positive extent; it only
 * ever stands for "there was nothing to measure", which is exactly what
 * `logDomain`'s own placeholder decade is for. Rows that hold nothing finite
 * get the same answer.
 *
 * AND ONE DISTINCT VALUE IS LEFT AS IT IS, `[v, v]`: on a logarithmic channel
 * the widening of a flat extent is `logDomain`'s (a decade each side), never
 * `extent`'s plus and minus one.
 */
export function extentFor<T>(rows: readonly T[], get: (r: T) => number, pad: number, kind: ScaleKind | undefined): [number, number] {
  if (kind !== 'log') return extent(rows, get, pad);
  // A LOGARITHMIC channel: the raw extent, with NO widening of a single value. `extent` widens one
  // distinct value by one each side, which is a linear idea; here it is {@link logDomain}'s to widen,
  // by a decade each side, so the value stands in the middle of its axis.
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = get(r);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // `pad` is kept for the caller that passes one (a logarithmic channel's is 0, `padFor`)
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo - pad, hi + pad] : [0, 0];
}

/**
 * A ROUND STEP for about `target` intervals across `span`: 1, 2 or 5 times a
 * power of ten, the steps a person counts in. 0 when there is no span to step
 * across.
 */
export function roundStep(span: number, target: number): number {
  const parts = stepParts(span, target);
  return parts === undefined ? 0 : stepValue(parts, 1);
}

/** A round step as the two whole numbers it is made of: `lead` (1, 2 or 5) times ten to the `exponent`. */
interface StepParts {
  readonly lead: number;
  readonly exponent: number;
}

function stepParts(span: number, target: number): StepParts | undefined {
  if (!(span > 0) || !Number.isFinite(span) || !(target > 0)) return undefined;
  const raw = span / target;
  const exponent = Math.floor(Math.log10(raw));
  const lead = raw / 10 ** exponent; // about 1 ≤ lead < 10
  // the cut points are the geometric middles between 1, 2, 5 and 10 (the usual rule)
  if (lead < Math.SQRT2) return { lead: 1, exponent };
  if (lead < Math.sqrt(10)) return { lead: 2, exponent };
  if (lead < Math.sqrt(50)) return { lead: 5, exponent };
  return { lead: 1, exponent: exponent + 1 };
}

/**
 * `index` steps, as a number. WHOLE-NUMBER ARITHMETIC, on purpose: a step
 * below one is reached by DIVIDING by a whole power of ten, never by
 * multiplying by a fractional one. A whole power of ten is an exact number and
 * a division is rounded once, so every JavaScript engine gives the same tick;
 * `10 ** -4` is not exact, differs in its last bit between engine versions,
 * and that bit decided whether an axis starting at 12,345 had a tick there.
 */
function stepValue({ lead, exponent }: StepParts, index: number): number {
  return exponent < 0 ? (index * lead) / 10 ** -exponent : index * lead * 10 ** exponent;
}

/** How many steps `value` is from zero: the inverse of {@link stepValue}, by the same arithmetic. */
function stepIndex({ lead, exponent }: StepParts, value: number): number {
  return exponent < 0 ? (value * 10 ** -exponent) / lead : value / (lead * 10 ** exponent);
}

/** How many decimals a step needs to be written exactly: 0.2 → 1, 0.05 → 2, 25 → 0. Capped, so a step with float noise in it cannot ask for sixteen. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d <= 12; d++) {
    const scaled = step * 10 ** d;
    // a whole number of at least one: a step far below one must not read as "a whole number, zero"
    if (Math.round(scaled) >= 1 && Math.abs(scaled - Math.round(scaled)) < 1e-9 * scaled) return d;
  }
  return 12;
}

/** More ticks than this is not an axis a person can read; no call may make more. */
const MAX_TICKS = 100;
/** The most significant digits a run of ticks may need to be told apart. */
const MAX_TICK_DIGITS = 13;

/** One tick on a linear axis: where it is, and what it says. */
export interface RoundTick {
  readonly value: number;
  readonly label: string;
}

const SUFFIXES: readonly (readonly [number, string])[] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/**
 * THE TICKS OF A LINEAR AXIS: the multiples of a round step that lie inside
 * `[lo, hi]`, each with its label.
 *
 * WHY multiples of a step, and not `n` even cuts of the span ({@link ticks}):
 * even cuts land wherever the data's extent happens to put them (4.3, 5.8,
 * 7.3), and the labels then have to be rounded to be readable — which is how a
 * −0.5…0.5 axis came to read "0 0 0 0 1": five different places, rounded to
 * two numbers. A tick at a round value needs no rounding, so its label is
 * the value.
 *
 * THE LABEL IS WRITTEN TO THE STEP'S PRECISION, the same for every tick on the
 * axis: a step of 0.2 gives one decimal, 0.05 two, 25 none; zero is always
 * "0", and only the tick AT zero is. Large values are
 * written against ONE unit for the whole axis (k, M, B, T — the largest one
 * the biggest tick reaches), to the precision the step has in that unit:
 * −3,710,000…−3,704,000 in steps of 2,000 reads −3.710M … −3.704M. An axis
 * whose ticks are all below 10,000 in size is written in full.
 *
 * A step finer than a thousandth of the unit, or a magnitude decimals cannot
 * carry (below a ten-thousandth, from 1e15 up), changes the way of writing
 * rather than drop digits: in full, or in exponent form with as many digits as it
 * takes to tell one tick from the next. No two ticks of an axis read alike.
 *
 * A flat span has one tick, at the value. A span that is not finite has none.
 * A span no run of round ticks can honestly cover has two, its ends, written
 * in full (the function body lists the cases).
 */
export function roundTicks(lo: number, hi: number, target: number): RoundTick[] {
  // `String` writes a number so that it reads back as itself: two different ends never read alike
  return roundRun(lo, hi, target) ?? [Math.min(lo, hi), Math.max(lo, hi)].map((value) => ({ value, label: String(value) }));
}

/** `roundTicks` without its last resort: `undefined` where no honest run of round ticks exists, so a caller that can do better than the two ends knows to. */
function roundRun(lo: number, hi: number, target: number): RoundTick[] | undefined {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  if (a === b) return [{ value: a, label: String(a) }];
  const parts = stepParts(b - a, target);
  const step = parts === undefined ? 0 : stepValue(parts, 1);
  // a bound that IS a multiple of the step must count as one, whatever the last bit of the division
  // says: the allowance grows with the index (its rounding does), and at the thirteen digits a run of
  // ticks may need it is still only a fiftieth of a step
  const fromIndex = parts === undefined ? Number.NaN : stepIndex(parts, a);
  const toIndex = parts === undefined ? Number.NaN : stepIndex(parts, b);
  const first = Math.ceil(fromIndex - (1e-9 + Math.abs(fromIndex) * 2e-15));
  const count = Math.floor(toIndex + (1e-9 + Math.abs(toIndex) * 2e-15)) - first;
  // how many significant digits it takes to tell one tick from the next
  const largestBound = Math.max(Math.abs(a), Math.abs(b));
  const digits = Math.ceil(Math.log10(largestBound / step) + 1e-9) + 1;
  // THE ENDS, WRITTEN IN FULL, when no honest run of round ticks exists:
  //  - the span overflowed, or no step could be found for it;
  //  - A COUNT, NEVER A WALK TO A BOUND: a span tiny beside its own offset (1e16 … 1e16 + 2) gives
  //    indices past the largest exact integer, where adding one changes nothing, and a loop that
  //    counted up to the last index would never end;
  //  - more ticks were asked for than an axis can hold, or no round value lies inside the span;
  //  - the ticks would differ only past the thirteenth digit: a number here holds fifteen or
  //    sixteen, and two are kept back so a tick's own rounding stays far below one step.
  if (parts === undefined || !(step > 0) || !Number.isFinite(step) || !Number.isSafeInteger(first) || !Number.isSafeInteger(first + count) || count < 0 || count > MAX_TICKS || digits > MAX_TICK_DIGITS) {
    return undefined;
  }
  // a round step is 1, 2 or 5 times a power of ten: its decimals are that power's
  const power = parts.exponent;
  const decimals = Math.max(0, -power);
  const largest = Math.max(Math.abs(first), Math.abs(first + count)) * step;
  // ONE WAY OF WRITING FOR THE WHOLE AXIS, chosen so that neighbouring ticks never read alike:
  //  - a unit (k, M, B, T) from ten thousand up, when the step is no finer than a thousandth of it;
  //  - the value in full, to the step's decimals, for an axis whose largest tick is between a
  //    ten-thousandth and 1e15;
  //  - otherwise (very small or very large) exponent form, carrying as many digits as it takes to
  //    tell one tick from the next.
  const unit = largest >= 10_000 && largest < 1e15 ? SUFFIXES.find(([size]) => largest >= size)! : undefined;
  const unitDecimals = unit === undefined ? 0 : Math.max(0, Math.log10(unit[0]) - power);
  const write: (value: number) => string =
    unit !== undefined && unitDecimals <= 3
      ? (value) => `${(value / unit[0]).toFixed(unitDecimals)}${unit[1]}`
      : largest >= 1e-4 && largest < 1e15
        ? (value) => value.toFixed(decimals)
        : (value) => value.toExponential(Math.max(0, digits - 1));
  const ticks: RoundTick[] = [];
  for (let i = 0; i <= count; i++) {
    const index = first + i;
    // the multiple at index zero IS zero, and is written "0" whatever the axis's way of writing
    const value = stepValue(parts, index);
    ticks.push(index === 0 ? { value: 0, label: '0' } : { value, label: write(value) });
  }
  return ticks;
}

/** The fewest significant digits a pointer's value keeps on a logarithmic axis. */
const LOG_POINTER_DIGITS = 4;
/** A number holds fifteen digits it can be trusted with. */
const MAX_POINTER_DIGITS = 15;

/**
 * A POINTER'S VALUE ON AN AXIS, rounded to what the axis can show: a hundredth,
 * or a thousandth of the span's own decade when that is finer. A drag across an
 * axis from 0 to 0.001 used to be rounded to a hundredth like every other, and
 * recorded the range [0, 0]. An axis of ten or more is still rounded to a
 * hundredth. The one difference there is a value that sits exactly on a half
 * (2.675): it is now rounded by the number's true value, where the older
 * arithmetic rounded the product. A pointer's value is practically never one.
 *
 * FOR SHOWING A VALUE, NOT FOR RECORDING ONE. A chart records the value under
 * the pointer as it is (`VizScatter`, `VizLine`): rounding a recorded bound
 * moves it, and a moved bound either drops a mark the pointer covered or
 * claims one it did not. This is for the place a person reads the number.
 *
 * A LOGARITHMIC axis (`kind: 'log'`) is rounded to significant digits and
 * `span` is not read: enough digits to tell one pixel from the next at this
 * value (`pixel`, what one pixel is worth there), and never fewer than four.
 */
export function roundToAxis(value: number, span: number, kind?: ScaleKind, pixel?: number): number {
  // ON A LOGARITHMIC AXIS a value is rounded to SIGNIFICANT DIGITS, never to a number of decimals:
  // decimals are a linear idea (a drag around 0.001 rounded to a hundredth is [0, 0]), and such an
  // axis has no one span to choose them by, because a pixel is worth more the further along it is.
  // HOW MANY DIGITS is what it takes to tell this pixel from the next one, and two more: `pixel` is
  // what one pixel is worth at this value. Never fewer than four. A fixed four was tried and on a
  // narrow axis (1000 … 1001) one step of the fourth digit is the whole axis, so a drag over one
  // point recorded a range that held every point.
  if (kind === 'log') {
    if (!Number.isFinite(value) || value === 0) return value;
    // a pixel worth NOTHING a number can hold (an axis narrower than one part in about 1e13) needs
    // every digit there is; a pixel nobody measured gets the four
    const needed = pixel === undefined || !Number.isFinite(pixel) || pixel < 0 ? LOG_POINTER_DIGITS : pixel === 0 ? MAX_POINTER_DIGITS : Math.ceil(Math.log10(Math.abs(value) / pixel)) + 2;
    return Number(value.toPrecision(Math.min(MAX_POINTER_DIGITS, Math.max(LOG_POINTER_DIGITS, needed))));
  }
  const fine = span > 0 && Number.isFinite(span) ? 3 - Math.floor(Math.log10(span) + 1e-9) : 2;
  const decimals = Math.min(100, Math.max(2, fine));
  return Number(value.toFixed(decimals));
}

/** The width one character of a tick label takes, in CSS pixels: the stylesheet draws ticks in the mono font at 10px. An estimate, used only to decide whether labels fit. */
export const TICK_CHAR_PX = 6;
/** The height of one line of tick label, and the least gap two labels keep between them. */
export const TICK_LINE_PX = 10;
export const TICK_GAP_PX = 4;
/** A tick label that does not fit level is drawn on this slant, in degrees, ending at its tick… */
export const TICK_SLANT_DEG = 40;
/** …with that end this far below the axis line, in pixels. The room a slanted label has is counted from here. */
export const TICK_SLANT_DROP = 12;

/** The two edges of the drawing a horizontal label must stay between, in pixels. */
export type LabelEdges = readonly [min: number, max: number];

/**
 * WHERE A HORIZONTAL LABEL IS CENTRED: under its tick, unless that would put
 * part of it outside the drawing, in which case it is moved in by just enough
 * to be whole. The tick mark stays where the value is; only the words move.
 *
 * THE CONVENTION: Highcharts calls this `overflow: 'justify'` and Vega
 * `labelFlush`; both keep the end labels of an axis inside the chart. Without
 * it the last label of an axis ran past the right edge and lost a character.
 * A label wider than the whole drawing is centred in it.
 */
export function labelCentre(at: number, label: string, edges?: LabelEdges): number {
  if (edges === undefined) return at;
  const half = (label.length * TICK_CHAR_PX) / 2;
  const [min, max] = edges;
  if (max - min < half * 2) return (min + max) / 2;
  return Math.min(max - half, Math.max(min + half, at));
}

/** The stretch of the axis one label takes, in pixels: its width about its centre on a horizontal axis, a line of text on a vertical one. */
function labelSpan(tick: RoundTick, place: (value: number) => number, along: 'width' | 'height', edges?: LabelEdges): readonly [number, number] {
  const at = place(tick.value);
  if (along === 'height') return [at - TICK_LINE_PX / 2, at + TICK_LINE_PX / 2];
  const half = (tick.label.length * TICK_CHAR_PX) / 2;
  const centre = labelCentre(at, tick.label, edges);
  return [centre - half, centre + half];
}

/** Do these two labels stand too close? The same test whichever way the axis runs. A place that is not a number is never "too close": there is nothing to judge by. */
function touch(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.max(b[0] - a[1], a[0] - b[1]) < TICK_GAP_PX;
}

/** Does every label keep its gap from the next? Each label is measured by its own width. */
export function labelsFit(ticks: readonly RoundTick[], place: (value: number) => number, along: 'width' | 'height', edges?: LabelEdges): boolean {
  for (let i = 1; i < ticks.length; i++) {
    if (touch(labelSpan(ticks[i - 1]!, place, along, edges), labelSpan(ticks[i]!, place, along, edges))) return false;
  }
  return true;
}

/**
 * ROUND TICKS AN AXIS HAS ROOM TO LABEL: `roundTicks` for the most ticks, up
 * to `target`, whose labels do not touch. An axis that has two round ticks to
 * show always shows at least two, because one label does not give a scale.
 *
 * In order, the first that holds:
 *
 *   1. A COARSER ROUND STEP. Fewer ticks are asked for until two or more
 *      labels fit. This is how the tick count is chosen where it follows the
 *      room (Observable Plot's `tickSpacing`; the D3 habit `ticks(width / 80)`):
 *      the scale picks the step, so the labels stay multiples of 1, 2 or 5.
 *   2. EVERY SECOND (third, …) of the finest round ticks, counted FROM ZERO,
 *      when no round step leaves two labels that fit. This is Vega's
 *      `labelOverlap: 'parity'`, anchored so the labels are still multiples of
 *      one step.
 *   3. ZERO AND ONE END of those ticks, when zero is among them and the pair
 *      fits: a zero line keeps its label for as long as any second label fits
 *      beside it.
 *   4. THE FIRST AND THE LAST of those ticks. Vega keeps two the same way.
 *      They may touch, on an axis too short for any two labels.
 *
 * "The finest round ticks" are `roundTicks` for the highest count, up to
 * `target`, that HAS a run of round ticks. The two ends written in full, which
 * `roundTicks` gives when there is no such run, are used only when no count
 * has one: a rounder answer is never passed over for them.
 *
 * Under 1 and 2 zero, a multiple of every step, is never the label that goes.
 */
export function roundTicksThatFit(lo: number, hi: number, target: number, place: (value: number) => number, along: 'width' | 'height', edges?: LabelEdges): readonly RoundTick[] {
  const most = Number.isFinite(target) ? Math.min(MAX_TICKS, Math.max(1, Math.floor(target))) : target > 0 ? MAX_TICKS : 1;
  let finest: readonly RoundTick[] | undefined;
  for (let count = most; count >= 1; count--) {
    const ticks = roundRun(lo, hi, count);
    if (ticks === undefined) continue;
    finest ??= ticks;
    if (ticks.length >= 2 && labelsFit(ticks, place, along, edges)) return ticks;
  }
  if (finest === undefined) return roundTicks(lo, hi, most);
  if (finest.length < 3) return finest;
  // which multiple of the step each tick is: the step is the distance between two neighbours
  const step = finest[1]!.value - finest[0]!.value;
  const multiple = (tick: RoundTick): number => Math.round(tick.value / step);
  const fits = (ticks: readonly RoundTick[]): boolean => ticks.length >= 2 && labelsFit(ticks, place, along, edges);
  for (let every = 2; every < finest.length; every++) {
    const ticks = finest.filter((tick) => multiple(tick) % every === 0);
    if (fits(ticks)) return ticks;
  }
  const [first, last] = [finest[0]!, finest[finest.length - 1]!];
  const zero = finest.find((tick) => tick.value === 0);
  if (zero !== undefined && zero !== first && zero !== last) {
    // a pair with the further end was already tried above, as every k-th from zero: what is left is zero beside a near end
    for (const pair of [[zero, last], [first, zero]]) if (fits(pair)) return pair;
  }
  return [first, last];
}

/**
 * THE TICKS AN AXIS HAS ROOM TO LABEL, for ticks that are GIVEN and not evenly
 * spaced (a logarithmic axis's decades and its 1-2-5 run). It walks the axis
 * from the first tick and keeps each one whose label does not touch the last
 * one kept. Each label is measured by its own width. Labels that all fit are
 * returned as the same array.
 *
 * THE CONVENTION: Vega's `labelOverlap: 'greedy'`, which Vega-Lite uses for
 * logarithmic axes for the same reason: their ticks crowd at one end only, so
 * dropping every second label everywhere throws away labels that had room.
 * The walk can drop the last tick. When it would leave fewer than three
 * labels, the axis shows its first and its last instead, as Vega does, so a
 * two-label axis always names both ends.
 *
 * A tick that is dropped takes its mark with it, so nothing is drawn unlabelled.
 */
export function ticksThatFit<T extends RoundTick>(ticks: readonly T[], place: (value: number) => number, along: 'width' | 'height', edges?: LabelEdges): readonly T[] {
  if (ticks.length < 3) return ticks;
  const kept: T[] = [];
  let lastSpan: readonly [number, number] | undefined;
  for (const tick of ticks) {
    const span = labelSpan(tick, place, along, edges);
    if (lastSpan !== undefined && touch(lastSpan, span)) continue;
    kept.push(tick);
    lastSpan = span;
  }
  if (kept.length === ticks.length) return ticks;
  return kept.length < 3 ? [ticks[0]!, ticks[ticks.length - 1]!] : kept;
}

/**
 * THE LENGTH A LABEL MUST BE SQUEEZED TO so that all of it is drawn, or
 * `undefined` when it fits as written. `room` is the pixels between where the
 * label is anchored and the edge of the drawing.
 *
 * A LABEL IS SHOWN WHOLE OR NOT AT ALL. A label wider than the margin used to
 * be cut off by the edge of the drawing: "12345.0010" was drawn as "345.0010",
 * which is another number. Squeezed, it is harder to read and still says what
 * it says. (A margin that grows with its labels is the better answer and is
 * not this one: a chart's margin is also read by the frame that stacks charts.)
 */
export function squeezedLength(label: string, room: number): number | undefined {
  const natural = label.length * TICK_CHAR_PX;
  return room > 0 && natural > room ? room : undefined;
}

/** The share of its own span a chart leaves empty at each end of an axis it sizes itself. */
export const EXTENT_ROOM = 0.05;

/**
 * THE DOMAIN A CHART GIVES ITSELF when the host declared none: the data's
 * extent, with room at each end so no mark sits on the plot's edge.
 *
 * THE ROOM IS A SHARE OF THE SPAN, never a number of data units. It used to be
 * a fixed 5 units on a scatter's x axis and 0.5 on y, which suits data in the
 * hundreds and swamps data near zero: points between −0.5 and 0.5 were drawn
 * on an axis from −5.5 to 5.5, a thin blob in the middle of the plot. A share
 * keeps the same picture whatever units the data is in.
 *
 *  - a span: `share` of it at each end (5% by default, the usual figure);
 *  - ONE value (a flat span): the same share of the value's own size at each
 *    side, or ±1 around zero, so a single point still gets an axis to sit on;
 *  - nothing to measure: `[0, 1]`, the placeholder an empty linear axis has
 *    always had;
 *  - a LOGARITHMIC axis: no room at all, as before ({@link padFor} says why),
 *    and the log-aware empty answer of {@link extentFor}.
 */
export function roomyExtent<T>(rows: readonly T[], get: (r: T) => number, kind: ScaleKind | undefined, share: number = EXTENT_ROOM): [number, number] {
  if (kind === 'log') return extentFor(rows, get, 0, kind);
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = get(r);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  // a share that is not a share (negative, not a number) is no room; so is room that would overflow
  const part = share >= 0 && Number.isFinite(share) ? share : 0;
  const room = lo === hi ? (lo === 0 ? 1 : Math.abs(lo) * part) : (hi - lo) * part;
  const [from, to] = [lo - room, hi + room];
  return Number.isFinite(from) && Number.isFinite(to) ? [from, to] : [lo, hi];
}

/** The shape {@link scaleFor} hands back: the same signature `linearScale` has. */
export type ScaleBuilder = (d0: number, d1: number, r0: number, r1: number) => LinearScale;

/**
 * THE ONE OWNER OF "WHICH SCALE BUILDER FOR THIS CHANNEL". Every chart
 * positions through this, so no chart holds its own answer and no two charts
 * can drift on it.
 *
 * The logarithmic builder clamps through {@link logDomain} on the way in, which
 * is why {@link logScale} itself can stay strict: the strictness catches a
 * caller who bypassed this owner, and this owner makes sure no chart ever does.
 *
 * WHAT A TRANSFORM MAY MEAN is the def door's judgement (`src/def/layers.ts`
 * law 11: no zero, numbers only, and never a bar's or a box's extent), not a
 * second fence here — the same division of labour the zero policy already
 * keeps, where a chart takes the domain it is given and never re-decides
 * whether it should have reached zero.
 */
export function scaleFor(kind: ScaleKind | undefined): ScaleBuilder {
  if (kind !== 'log') return linearScale;
  return (d0, d1, r0, r1) => logScale(...logDomain(d0, d1), r0, r1);
}

/**
 * CAN A SCALE OF THIS KIND PLACE THIS VALUE? A linear scale places every finite
 * number; a logarithm places only the positive ones. Asked before a mark is
 * drawn, so what cannot be placed is left out of the picture AND out of the
 * extent the axis is folded from — a 0 in a logarithmic column must not drag
 * the low bound down to a value the axis cannot label.
 */
export function placeable(kind: ScaleKind | undefined, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  return kind === 'log' ? v > 0 : true;
}

/**
 * THE ADDITIVE PADDING AN AXIS OF THIS KIND TAKES — the breathing room a chart
 * puts around its OWN extent so the marks are not drawn on the plot's edge.
 *
 * A LOGARITHMIC AXIS TAKES NONE. Additive room is a linear idea (a difference),
 * and adding it to a logarithmic domain does not widen the axis, it breaks it:
 * `extent`'s ±0.5 around [10, 1000] is a rounding error nobody asked for, and a
 * box plot's 8%-of-span pushes the low bound of [10, 1000] to −69, which no
 * logarithm can place at all — so the clamp would then invent a domain a decade
 * under the high bound and every box would fall off the picture. The decade
 * ticks are a logarithmic axis's breathing room.
 */
export function padFor(kind: ScaleKind | undefined, pad: number): number {
  return kind === 'log' ? 0 : pad;
}

/**
 * DECADE TICKS across [lo, hi] — the powers of ten inside the span, thinned to
 * at most `max` while both ends are kept, so a reader of a logarithmic axis
 * always meets a labelled power of ten.
 *
 * WITH FEWER THAN TWO DECADES IN VIEW the decades alone would label almost
 * nothing, so the ticks fall back to the 1-2-5 mantissas of every decade the
 * span touches — the classic log minor ticks, and the decade itself is among
 * them whenever it is in range.
 *
 * An empty answer for a span no logarithm can describe (a non-positive bound,
 * or a reversed pair): no ticks at all, never an invented one.
 */
export function logTicks(lo: number, hi: number, max = 6): number[] {
  // a span that is not finite has no decades to walk: none, never a loop with no end
  if (!(lo > 0) || !(hi > lo) || !Number.isFinite(hi)) return [];
  const decades: number[] = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) decades.push(10 ** e);
  if (decades.length >= 2) {
    const step = Math.ceil(decades.length / max);
    return decades.filter((_, i) => i % step === 0 || i === decades.length - 1);
  }
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) {
    for (const mantissa of [1, 2, 5]) {
      const v = mantissa * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

/**
 * A LOGARITHMIC TICK'S LABEL. The linear axes round to whole numbers, which on
 * a logarithmic axis would print the 0.1 decade as "0" — a wrong axis, not a
 * short one. So: the value as written for the readable middle, exponential
 * notation once the decades run past what a reader can count zeroes in.
 */
export function logTickLabel(v: number): string {
  if (v >= 10000 || v < 0.001) return v.toExponential(0);
  return String(Number(v.toPrecision(6)));
}

/**
 * THE WORDS FOR WHAT A TRANSFORM COULD NOT PLACE — the sentence the library's
 * fold points at (`src/encoding/frame.ts`, `quantitative`), because the CHART
 * is where a reader meets the number: it is the picture the marks are missing
 * from.
 *
 * Returned WITH its leading separator and empty for nothing excluded, so a
 * chart appends it to the accessible name it already builds in one expression
 * and a chart with no transform is byte-identical to the one that existed
 * before this key.
 */
export function excludedNote(n: number): string {
  if (!(n > 0)) return '';
  return ` — ${n} ${n === 1 ? 'value is' : 'values are'} not drawn: a logarithmic axis has no place for zero or a negative number`;
}

/** What {@link outsideNotes} is asked about one axis: its name for the sentence, the pair it was GIVEN, and the values it places. */
export interface OutsideAsk {
  /** The channel as a reader knows it (`'x'`, `'y'`) — it is quoted in the sentence. */
  readonly channel: string;
  /** `ChartDomain.x` / `.y` — the pair the chart was GIVEN, or nothing where it drew its own extent. */
  readonly given: readonly [number, number] | undefined;
  /**
   * The values this axis places, as the chart holds them. A non-finite cell is an ABSENCE, not a value
   * outside an extent, and is not counted. A mark with WIDTH along the axis (a histogram bin, a heat-map
   * column, a box with its whiskers) is its two ends, and reaches outside when either end does.
   */
  readonly values: readonly (number | readonly [number, number])[];
  /**
   * THE CHART WAS NOT TOLD THIS SPAN WAS DECLARED. A `ChartDomain` pair is declared bounds or a span a
   * frame folded (or widened), and `ChartDomain.declared` says which ({@link declaredOn}). A fold is
   * not always a union that holds every mark: it is taken over one bound column, and a fold that
   * reads a cell differently from the chart leaves that mark outside. So for a pair not known to be
   * declared the sentence says only what is true either way, the span the axis was GIVEN, and blames
   * nobody.
   *
   * A MARK WITH WIDTH ALWAYS GETS THIS SENTENCE, declared or not, as a count does. Its ends are not
   * data: a bin's edge and a column's edge are the binning's choice, and a box reaches as far as its
   * farthest outlier while the box itself may stand inside. "Either the bounds are wrong or the data
   * is" would blame the data for an edge nobody measured. "Reaches outside the span" is true.
   * Absent = the sentence for DECLARED bounds ("declared bounds … either they are wrong or this data
   * is"), which a chart asks for only where it was told the pair is a declaration
   * (`ChartDomain.declared`, {@link declaredOn}).
   */
  readonly undeclared?: true;
  /** The curve the axis is drawn on. On a logarithmic one a flat declared pair is a decade either side, as it is drawn (`logDomain`), not one either side. */
  readonly kind?: ScaleKind;
  /**
   * This axis is a COUNT, read from zero: it is drawn on {@link countSpan} of the pair it was given
   * (zero up to the ceiling), so a mark is outside only above the ceiling, and where the given pair
   * is not that span the sentence names both. A count axis always says the sentence that blames
   * nobody ({@link OutsideAsk.undeclared}), asked for or not.
   */
  readonly count?: true;
  /** What one mark on this axis is called, singular then plural. Absent = `['value', 'values']`. */
  readonly noun?: readonly [string, string];
  /** How a bound is written in the sentence (a date axis holds epoch milliseconds, and says days). Absent = the number. */
  readonly format?: (bound: number) => string;
}

/** Was the pair a chart was handed for this axis DECLARED (`ChartDomain.declared`)? Absent reads as no. */
export function declaredOn(domain: ChartDomain | undefined, axis: 'x' | 'y'): boolean {
  return domain?.declared?.[axis] === true;
}

/**
 * THE WORDS FOR A VALUE OUTSIDE THE AXIS IT WAS DECLARED ON — owned here beside
 * {@link excludedNote} because the two are one register: a thing the chart was
 * asked to draw and cannot show honestly, COUNTED AND SAID rather than dropped
 * in silence.
 *
 * A DECLARED EXTENT SAYS WHAT THE QUANTITY CAN BE (`ChannelResolution.bounds`,
 * `vizfootprint/def`) — a torsion angle is −180…180, a percentage 0…100, a
 * probability 0…1. So a value outside it is not a drawing problem, it is a
 * CLAIM problem: either the data is wrong or the declaration is, and the reader
 * is the only person who can tell which. Nothing is hidden — the mark is still
 * placed at its true position, the same law the band axis keeps — but a mark
 * past the plot edge is invisible, so the count is the only thing that says it
 * is there.
 *
 * ONLY FOR AN AXIS THE CHART WAS GIVEN, and only for a pair a linear scale can
 * be read from ({@link domainOr}'s own guard, asked here so the two can never
 * drift about which pair was actually drawn on): a chart drawing its OWN extent
 * has nothing outside it by construction. The first sentence was written on the
 * belief that a frame's fold is a union over the layers' rows, so a count above
 * zero means a DECLARATION. That does not always hold (see
 * {@link OutsideAsk.undeclared}), so a chart asks for it only where it was told
 * the pair is declared ({@link declaredOn}), and otherwise for the second
 * sentence, which names the span the axis was given and blames nobody.
 *
 * Bare sentences, in the order the axes were asked and empty for a chart with
 * nothing outside — the caller appends them exactly as it appends the zero
 * guide's (`zeroGuideNotes`, `./zeroGuide.ts`), so a chart with no declared
 * extent is byte-identical to the one that existed before this key.
 */
export function outsideNotes(asks: readonly OutsideAsk[]): readonly string[] {
  return asks.flatMap((ask) => {
    if (ask.given === undefined || !ask.given.every((bound) => Number.isFinite(bound))) return [];
    // counted against the bounds AS THE AXIS DRAWS THEM, so what is counted as outside is what stands
    // outside the plot. Those can differ from the pair that was declared: on a logarithmic axis (a flat
    // pair is a decade either side; a low bound a logarithm cannot take is lifted) and on a count axis
    // (read from zero, whatever low end was given). Then the sentence names both. In the FIRST
    // sentence the words "declared bounds" are followed by the pair that was declared, in order (a
    // LINEAR flat pair is still printed widened by one each side, as it always was).
    const linear = domainOr(ask.given, ask.given);
    const said = ask.kind === 'log' ? domainOr(ask.given, ask.given, 'log') : linear;
    const [lo, hi] = ask.count === true ? countSpan(ask.given, ask.given) : ask.kind === 'log' ? logDomain(...said) : linear;
    const beyond = (v: number): boolean => Number.isFinite(v) && (v < lo || v > hi);
    const n = ask.values.filter((v) => (typeof v === 'number' ? beyond(v) : beyond(v[0]) || beyond(v[1]))).length;
    if (n === 0) return [];
    const write = ask.format ?? String;
    const [one, many] = ask.noun ?? ['value', 'values'];
    // a count axis and a mark with width always say the second sentence, declared or not (see `OutsideAsk.undeclared`)
    const wide = ask.values.some((v) => typeof v !== 'number');
    if (ask.undeclared === true || ask.count === true || wide) {
      // the pair AS GIVEN, then the pair as drawn where they differ: a count from zero, a logarithmic
      // axis, or a flat or backwards pair the axis had to open or put in order. The REASON is said only
      // where it is the whole reason. A pair merely put in order is the same span, whatever the axis.
      // "Read from zero" explains a low end moved to zero and nothing else: a ceiling that moved (a
      // flat pair opened, a ceiling lifted to one) is not zero's doing, so then no reason is given.
      const [low, high] = [Math.min(...ask.given), Math.max(...ask.given)];
      const reason = ask.count === true ? (low !== lo && high === hi ? ' because a count is read from zero' : '') : ask.kind === 'log' && (low !== lo || high !== hi) ? ' on a logarithmic axis' : '';
      const opened = ask.given[0] === lo && ask.given[1] === hi ? '' : `, drawn as [${write(lo)}, ${write(hi)}]${reason}`;
      const reach = wide ? (n === 1 ? `${one} that reaches` : `${many} that reach`) : n === 1 ? one : many;
      return [`${ask.channel} has ${n} ${reach} outside the span this axis was given [${write(ask.given[0])}, ${write(ask.given[1])}]${opened}`];
    }
    const drawn = said[0] === lo && said[1] === hi ? '' : `, drawn as [${write(lo)}, ${write(hi)}] on a logarithmic axis`;
    return [`${ask.channel} has ${n} ${n === 1 ? one : many} outside its declared bounds [${write(said[0])}, ${write(said[1])}]${drawn} — bounds say what the quantity CAN be, so either they are wrong or this data is`];
  });
}

// ── a mark a reader is meant to press must be REACHABLE (the pointer target) ──

/**
 * THE SMALLEST PRESSABLE TARGET, and the number is NOT ours: **24**. Its
 * source is WCAG 2.2 Success Criterion 2.5.8 *Target Size (Minimum)*, Level AA,
 * a W3C Recommendation (<https://www.w3.org/TR/WCAG22/#target-size-minimum>),
 * which puts the floor of a pointer target at 24 by 24 CSS pixels. The enhanced
 * criterion (2.5.5, Level AAA) asks 44, and the platform guidelines sit near
 * it (Apple 44pt, Material 48dp); AA is the floor a library may impose on
 * every host's picture, and a host that wants the enhanced one widens its pane.
 *
 * IN VIEWBOX UNITS, which is the honest way to say it here: a chart draws in
 * its own viewBox and CSS scales the result. Under `<ChartFrame>` — how every
 * first-party chart is sized, viewBox == the measured CSS box — one unit IS
 * one CSS pixel and the floor is literally the criterion's. A host that scales
 * a chart's svg down is scaling the targets with it, which is the host's own
 * floor to keep (`ui/README.md`, "what this does not promise").
 *
 * THE MEASURED DEFECT it exists for: 185 bars across a 940px pane, about 5px
 * each, and a browser driver refused to click one — the target was not a
 * target at all.
 */
export const MIN_POINTER_TARGET = 24;

/**
 * HOW WIDE A MARK'S POINTER TARGET MAY BE on a band of this slot width: the
 * minimum, or the SLOT when the slot is narrower.
 *
 * A HIT AREA IS NOT A MARK — widen the target, never the drawing: a bar whose
 * width lied about its category would be worse than a bar that is hard to
 * press. So the target is a transparent surface OVER the mark and the mark
 * keeps the geometry the data gave it.
 *
 * AND WHEN THE TARGETS WOULD OVERLAP THEY CANNOT ALL BE HONOURED. At 185 slots
 * in 940px the minimum is five times the slot, and targets that overlapped
 * would make a press land on a NEIGHBOUR — a click that selects the wrong
 * residue is worse than a click that misses. The slots TILE the axis
 * ({@link bandStart}), so bounding the target by the slot is exactly the
 * bound that keeps them disjoint, and what the chart owes the reader then is
 * to SAY SO ({@link crowdedMarksNote}) rather than to promise a reach it does
 * not have.
 *
 * Never negative: {@link bandWidth}, the one owner of a slot's width, clamps
 * at zero before this ever sees it.
 */
export function pointerTargetWidth(slot: number): number {
  return Math.min(MIN_POINTER_TARGET, slot);
}

/**
 * THE WORDS FOR MARKS TOO CLOSE TOGETHER TO PRESS ONE AT A TIME — said out
 * loud in the picture and in the accessible name, exactly as {@link
 * excludedNote} says what a transform could not place, and owned here beside
 * it for the same reason: it is the same kind of fact (something the reader
 * can see is there but cannot fully get at), and one owner means two charts
 * cannot word it two ways.
 *
 * DERIVED FROM THE MEASURED SLOT, never from the row count: the reader's
 * problem is pixels, and the same 185 marks in a 3000px pane have no problem
 * at all. Returned WITH its leading separator and EMPTY when the slots are
 * wide enough, so a chart appends it in one expression and an uncrowded chart
 * is byte-identical to the one that existed before this key.
 *
 * THE BOUNDARY, decided and pinned: a slot of EXACTLY {@link
 * MIN_POINTER_TARGET} is not crowded. The minimum is honoured there in full —
 * `pointerTargetWidth(24)` is 24 — so there is nothing to confess, and the
 * predicate is `slot < MIN_POINTER_TARGET` rather than `<=`.
 */
export function crowdedMarksNote(slot: number): string {
  if (!(slot < MIN_POINTER_TARGET)) return '';
  return ` — the marks are closer together than a pointer can separate: each slot is ${String(Math.round(slot * 10) / 10)}px wide where a pointer target needs ${String(MIN_POINTER_TARGET)}px, so a press may land on a neighbouring mark`;
}
