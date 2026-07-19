/**
 * bins — the HOST-side equal-width binning helper (v1), the
 * transform-ownership rule's first real transform beyond counting.
 *
 * PLACEMENT (deliberate): this lives in src/data, NOT in the ui package.
 * The renderer contract's rule is that the HOST owns every bin/aggregate/
 * decimate (a renderer declaring `['bin']` is refused at bind with
 * `transforms-not-owned`), and the ui package's own rule is "import src
 * TYPES, never src values" — so a binning helper inside ui would either ship
 * a transform in the chart library (blurring the exact ownership line the
 * contract enforces) or be unreachable from it anyway. src/data is where the
 * host's row semantics already live (`matchesClause`, the CSV typing), it is
 * UI-free, and every consumer tier (gallery host, demo hosts, agent-side
 * analyses) can use it without pulling React. `<VizHistogram>` receives the
 * READY bins these functions produce and never computes them.
 *
 * SEMANTICS:
 *   - equal-width buckets over a NUMERIC or DATE domain (v1);
 *   - date values are ISO-8601 strings (the repo rail: lexicographic ==
 *     chronological); edges come back as ISO strings — day-precision
 *     (`YYYY-MM-DD`) when the edge lands exactly on a UTC midnight (so edges
 *     compare lexicographically with date-only column values), full ISO
 *     otherwise;
 *   - counting is right-open `[x0, x1)` except the LAST bucket, which is
 *     closed `[x0, x1]` so the maximum lands in a bucket;
 *   - unusable values (NaN, non-finite numbers, unparseable date strings)
 *     are SKIPPED, never guessed; mixing numbers and dates in one call is an
 *     error (bin one column at a time);
 *   - `recountBins` refills FIXED edges with new counts — the crossfilter
 *     recompute (a chart's own brush must never move its own bucket edges);
 *     values outside the edges, or of the other domain's type, are skipped
 *     (the `matchesClause` no-cross-type-coercion rule).
 *
 * Pure functions, no state, no imports.
 */

/** One equal-width bucket: edges (numeric, or ISO-date strings) + its count. */
export interface Bin {
  /** Inclusive lower edge. */
  readonly x0: number | string;
  /** Upper edge — exclusive, except on the last bucket (see header). */
  readonly x1: number | string;
  readonly count: number;
}

/** The binning result: which domain the values resolved to, and the buckets in edge order. */
export interface Bins {
  readonly domain: 'number' | 'date';
  readonly bins: readonly Bin[];
}

export interface EqualWidthBinsOptions {
  /** How many buckets (default 10; fractions floor; minimum 1). */
  readonly buckets?: number;
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
  /** The usable values, as their numeric position (dates as epochs). */
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
    throw new TypeError('equalWidthBins: mixed numeric and date values — bin one column at a time');
  }
  if (epochs.length > 0) return { domain: 'date', positions: epochs };
  return { domain: 'number', positions: nums };
}

/** A position back to a bin edge in the domain's own vocabulary. */
function toEdge(domain: 'number' | 'date', position: number): number | string {
  return domain === 'date' ? epochToEdge(position) : position;
}

/**
 * Equal-width buckets over the values' own [min, max], with counts. Empty
 * usable input → zero buckets; an all-equal input → ONE degenerate bucket
 * `[v, v]` holding everything (width zero, honestly).
 */
export function equalWidthBins(values: readonly (number | string)[], options: EqualWidthBinsOptions = {}): Bins {
  const buckets = Math.max(1, Math.floor(options.buckets ?? 10));
  const { domain, positions } = usable(values);
  if (positions.length === 0) return { domain, bins: [] };

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of positions) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  if (lo === hi) {
    return { domain, bins: [{ x0: toEdge(domain, lo), x1: toEdge(domain, hi), count: positions.length }] };
  }

  const span = hi - lo;
  const counts = new Array<number>(buckets).fill(0);
  for (const p of positions) {
    // right-open buckets; the maximum folds into the last (closed) bucket
    const idx = Math.min(buckets - 1, Math.floor(((p - lo) / span) * buckets));
    counts[idx]! += 1;
  }
  const bins: Bin[] = counts.map((count, i) => ({
    x0: toEdge(domain, lo + (span * i) / buckets),
    // the last upper edge is EXACTLY the maximum (no floating drift)
    x1: toEdge(domain, i === buckets - 1 ? hi : lo + (span * (i + 1)) / buckets),
    count,
  }));
  return { domain, bins };
}

/**
 * Refill FIXED edges with new counts — the crossfilter recompute. The edges
 * (and domain) come from a previous `equalWidthBins` over ALL rows; `values`
 * are the currently-kept rows' values. Values outside the edges, of the other
 * domain's type, or unusable are skipped (no cross-type coercion, edges never
 * move).
 */
export function recountBins(bins: Bins, values: readonly (number | string)[]): Bins {
  if (bins.bins.length === 0) return { domain: bins.domain, bins: [] };
  const edges = bins.bins.map((b) => posOfEdge(bins.domain, b.x0));
  const last = bins.bins[bins.bins.length - 1]!;
  const hi = posOfEdge(bins.domain, last.x1);
  const counts = new Array<number>(bins.bins.length).fill(0);
  for (const v of values) {
    const p = posOf(bins.domain, v);
    if (p === null) continue; // other-type or unusable — skipped, never coerced
    if (p < edges[0]! || p > hi) continue; // outside the fixed edges — skipped
    let idx = bins.bins.length - 1; // p ≥ the last lower edge (incl. p === hi: the closed last bucket)
    for (let i = 1; i < edges.length; i++) {
      if (p < edges[i]!) {
        idx = i - 1;
        break;
      }
    }
    counts[idx]! += 1;
  }
  return { domain: bins.domain, bins: bins.bins.map((b, i) => ({ x0: b.x0, x1: b.x1, count: counts[i]! })) };
}

/** A stored edge's numeric position. Edges are this module's own output, so they always parse. */
function posOfEdge(domain: 'number' | 'date', edge: number | string): number {
  const p = posOf(domain, edge);
  /* v8 ignore next 2 -- edges arrive from equalWidthBins' own toEdge, so a numeric-domain edge is always a number and a date-domain edge always parses; the throw guards a hand-built Bins with corrupted edges rather than silently miscounting */
  if (p === null) throw new TypeError(`recountBins: unusable ${domain} edge ${String(edge)}`);
  return p;
}

/** A value's numeric position under a domain, or null when it does not belong. */
function posOf(domain: 'number' | 'date', value: number | string): number | null {
  if (domain === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : null;
  return typeof value === 'string' ? parseEpoch(value) : null;
}
