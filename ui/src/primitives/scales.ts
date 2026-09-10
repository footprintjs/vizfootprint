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
