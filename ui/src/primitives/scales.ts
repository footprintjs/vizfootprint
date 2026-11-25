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
 */
export function domainOr(given: readonly [number, number] | undefined, own: readonly [number, number]): [number, number] {
  if (given === undefined || !Number.isFinite(given[0]) || !Number.isFinite(given[1])) return [own[0], own[1]];
  const [lo, hi] = [Math.min(given[0], given[1]), Math.max(given[0], given[1])];
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
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
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  if (!(hi > 0)) return [1, 10];
  if (lo === hi) return [hi / 10, hi * 10];
  return [lo > 0 ? lo : hi / 10, hi];
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
 * `logDomain`'s own placeholder decade is for.
 */
export function extentFor<T>(rows: readonly T[], get: (r: T) => number, pad: number, kind: ScaleKind | undefined): [number, number] {
  if (kind === 'log' && rows.length === 0) return [0, 0];
  return extent(rows, get, pad);
}

/**
 * A ROUND STEP for about `target` intervals across `span`: 1, 2 or 5 times a
 * power of ten, the steps a person counts in. 0 when there is no span to step
 * across.
 */
export function roundStep(span: number, target: number): number {
  if (!(span > 0) || !Number.isFinite(span) || !(target > 0)) return 0;
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / power; // 1 ≤ lead < 10
  // the cut points are the geometric middles between 1, 2, 5 and 10 (the usual rule)
  return (lead < Math.SQRT2 ? 1 : lead < Math.sqrt(10) ? 2 : lead < Math.sqrt(50) ? 5 : 10) * power;
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
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  if (a === b) return [{ value: a, label: String(a) }];
  const step = roundStep(b - a, target);
  const first = Math.ceil(a / step - 1e-9);
  const count = Math.floor(b / step + 1e-9) - first;
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
  // `String` writes a number so that it reads back as itself: two different ends never read alike.
  if (!(step > 0) || !Number.isFinite(step) || !Number.isSafeInteger(first) || !Number.isSafeInteger(first + count) || count < 0 || count > MAX_TICKS || digits > MAX_TICK_DIGITS) {
    return [a, b].map((value) => ({ value, label: String(value) }));
  }
  // a round step is 1, 2 or 5 times a power of ten: its decimals are that power's
  const power = Math.floor(Math.log10(step) + 1e-9);
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
    ticks.push(index === 0 ? { value: 0, label: '0' } : { value: index * step, label: write(index * step) });
  }
  return ticks;
}

/**
 * A POINTER'S VALUE ON AN AXIS, rounded to what the axis can show: a hundredth,
 * or a thousandth of the span's own decade when that is finer. A drag across an
 * axis from 0 to 0.001 used to be rounded to a hundredth like every other, and
 * recorded the range [0, 0]. An axis of ten or more is rounded exactly as
 * before, so what a drag records there has not moved.
 */
export function roundToAxis(value: number, span: number): number {
  const fine = span > 0 && Number.isFinite(span) ? 3 - Math.floor(Math.log10(span) + 1e-9) : 2;
  const decimals = Math.min(100, Math.max(2, fine));
  return Number(value.toFixed(decimals));
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
  if (!(lo > 0) || !(hi > lo)) return [];
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
  /** The values this axis places, as the chart holds them. A non-finite cell is an ABSENCE, not a value outside an extent, and is not counted. */
  readonly values: readonly number[];
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
 * has nothing outside it by construction, and a frame's fold is a union over
 * the layers' rows, so a count above zero means a DECLARATION.
 *
 * Bare sentences, in the order the axes were asked and empty for a chart with
 * nothing outside — the caller appends them exactly as it appends the zero
 * guide's (`zeroGuideNotes`, `./zeroGuide.ts`), so a chart with no declared
 * extent is byte-identical to the one that existed before this key.
 */
export function outsideNotes(asks: readonly OutsideAsk[]): readonly string[] {
  return asks.flatMap((ask) => {
    if (ask.given === undefined || !ask.given.every((bound) => Number.isFinite(bound))) return [];
    const [lo, hi] = domainOr(ask.given, ask.given);
    const n = ask.values.filter((v) => Number.isFinite(v) && (v < lo || v > hi)).length;
    if (n === 0) return [];
    return [`${ask.channel} has ${n} ${n === 1 ? 'value' : 'values'} outside its declared bounds [${lo}, ${hi}] — bounds say what the quantity CAN be, so either they are wrong or this data is`];
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
