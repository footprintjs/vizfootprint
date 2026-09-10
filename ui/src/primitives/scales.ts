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
