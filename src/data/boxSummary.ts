/**
 * boxSummary — the HOST-side box-plot summary-statistics helper (v1), the
 * bins.ts sibling: STATISTICS AS RENDER DATA. `<VizBoxPlot>` draws a box,
 * median, whiskers, and outlier dots from a READY summary — it never touches
 * a raw value array or a quantile formula (the transform-ownership rule, one
 * step past counting/binning: this is the host's aggregate opinion about a
 * distribution, not the chart's).
 *
 * PLACEMENT (the bins.ts precedent, applied identically): src/data, not ui.
 * The renderer contract refuses a chart that declares its own transforms
 * (`transforms-not-owned`), and `vizfootprint-ui`'s own rule is "import src
 * TYPES, never src values" — so quantile math belongs where the host's row
 * semantics already live, UI-free, reachable by every consumer tier (gallery
 * host, demo hosts, agent-side analyses) without pulling React.
 *
 * SHAPE (deliberately UNGROUPED, the equalWidthBins precedent): this function
 * summarizes ONE array of values — one category's worth — exactly like
 * `equalWidthBins` buckets one column. Grouping by category is the HOST's
 * loop (see the heatmap's `CATEGORIES.flatMap(...)` wiring for the same
 * discipline): `CATEGORIES.map((c) => ({ category: c, ...boxSummary(valuesFor(c)) }))`.
 *
 * INTERPOLATION METHOD (stated, deterministic): linear interpolation between
 * order statistics — "type 7" in Hyndman & Fan's taxonomy, R's `quantile()`
 * default and NumPy's `'linear'` default. For sorted ascending values of
 * length n and a quantile p ∈ [0, 1]: h = (n − 1) × p; the result is
 * `sorted[⌊h⌋] + (h − ⌊h⌋) × (sorted[⌈h⌉] − sorted[⌊h⌋])`.
 *
 * WHISKERS (the standard Tukey rule — R's `boxplot.stats()`, matplotlib's
 * default): the fence is `[q1 − k×IQR, q3 + k×IQR]` (k defaults 1.5, the
 * classic constant); a whisker is NOT drawn at the raw fence value — it lands
 * on the most extreme ACTUAL data point still inside the fence, so it is
 * naturally "clamped to the data extent" (a whisker is always a real
 * observation, never a fabricated number past where data exists). Values
 * outside the fence are the outliers, listed ascending.
 *
 * DATES: ISO-8601 strings (lexicographic == chronological, the repo rail).
 * Quantiles interpolate on epoch milliseconds; an edge lands back as a
 * day-precision ISO string (`YYYY-MM-DD`) when it falls exactly on a UTC
 * midnight (comparable with date-only column values, the bins.ts rule),
 * full ISO otherwise. Mixing numbers and dates in one call is an error (like
 * `equalWidthBins`: summarize one column at a time). Unusable values (NaN,
 * non-finite numbers, unparseable date strings) are skipped, never guessed.
 *
 * EMPTY INPUT: no usable values → `null` (an honest "nothing to summarize" —
 * unlike `equalWidthBins`'s empty-array-of-buckets, ONE summary can't degrade
 * to an empty list, so the absent case is typed as absent, not zeroed-out).
 *
 * Pure functions, no state, no imports (the bins.ts discipline — this module
 * duplicates the tiny epoch⇄edge conversion rather than importing bins.ts,
 * so the two summarizers stay independently reasoned about).
 */

/** One distribution's box-plot summary: quartiles, whiskers, and outliers. */
export interface BoxSummary {
  /** Which domain the values resolved to — numeric or ISO-date. */
  readonly domain: 'number' | 'date';
  readonly q1: number | string;
  readonly median: number | string;
  readonly q3: number | string;
  /** The lowest ACTUAL data value still inside the fence (never fabricated — see the file header). */
  readonly whiskerLo: number | string;
  /** The highest ACTUAL data value still inside the fence. */
  readonly whiskerHi: number | string;
  /** Values outside the fence, ascending. */
  readonly outliers: readonly (number | string)[];
  /** How many usable values (NaN/unparseable ones already skipped) this summary covers. */
  readonly count: number;
}

export interface BoxSummaryOptions {
  /** The whisker fence multiplier on the IQR (default 1.5, the classic Tukey constant; clamped ≥ 0). */
  readonly whiskerK?: number;
}

const DAY_MS = 86_400_000;

/** An ISO string's epoch, or null when unparseable. */
function parseEpoch(value: string): number | null {
  const epoch = Date.parse(value);
  return Number.isNaN(epoch) ? null : epoch;
}

/**
 * An epoch back to an ISO edge string: day-precision when it lands exactly on
 * a UTC midnight (comparable with date-only column values), full ISO otherwise.
 */
function epochToEdge(epoch: number): string {
  const iso = new Date(epoch).toISOString();
  return ((epoch % DAY_MS) + DAY_MS) % DAY_MS === 0 ? iso.slice(0, 10) : iso;
}

interface UsableValues {
  readonly domain: 'number' | 'date';
  /** The usable values, as their numeric position (dates as epochs) — NOT yet sorted. */
  readonly positions: readonly number[];
}

/** Split raw values into usable numeric positions; junk skipped; mixing throws. */
function usable(values: readonly (number | string)[]): UsableValues {
  const nums: number[] = [];
  const epochs: number[] = [];
  for (const v of values) {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) nums.push(v);
      continue;
    }
    const epoch = parseEpoch(v);
    if (epoch !== null) epochs.push(epoch);
  }
  if (nums.length > 0 && epochs.length > 0) {
    throw new TypeError('boxSummary: mixed numeric and date values — summarize one column at a time');
  }
  if (epochs.length > 0) return { domain: 'date', positions: epochs };
  return { domain: 'number', positions: nums };
}

/** A position back to a value in the domain's own vocabulary. */
function toValue(domain: 'number' | 'date', position: number): number | string {
  return domain === 'date' ? epochToEdge(position) : position;
}

/**
 * Type-7 linear-interpolation quantile over SORTED ascending positions (see
 * the file header for the formula). `sorted` must be non-empty.
 */
function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Summarize ONE array of values (numeric or ISO-date, not mixed) into a
 * box-plot-ready `BoxSummary` — quartiles, Tukey whiskers, and outliers, in
 * the domain's own vocabulary. `null` when nothing usable survives (empty
 * input, or every value is junk).
 */
export function boxSummary(values: readonly (number | string)[], options: BoxSummaryOptions = {}): BoxSummary | null {
  const k = Math.max(0, options.whiskerK ?? 1.5);
  const { domain, positions } = usable(values);
  if (positions.length === 0) return null;

  const sorted = [...positions].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const fenceLo = q1 - k * iqr;
  const fenceHi = q3 + k * iqr;

  // the whisker rule (file header): the most extreme REAL data point still
  // inside the fence. This set is never empty: fenceLo <= q1 <= q3 <= fenceHi
  // (k >= 0), and q1/q3 themselves interpolate between real neighbouring
  // sorted values that bracket the array's own central block — so at least
  // the values nearest the median always qualify.
  const inliers = sorted.filter((v) => v >= fenceLo && v <= fenceHi);
  const outliers = sorted.filter((v) => v < fenceLo || v > fenceHi);

  return {
    domain,
    q1: toValue(domain, q1),
    median: toValue(domain, median),
    q3: toValue(domain, q3),
    whiskerLo: toValue(domain, inliers[0]!),
    whiskerHi: toValue(domain, inliers[inliers.length - 1]!),
    outliers: outliers.map((v) => toValue(domain, v)),
    count: positions.length,
  };
}
