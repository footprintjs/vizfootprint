/**
 * l3-channels spike — pure, deterministic numeric kernels.
 *
 * Every function here is a total, seed-free pure function of its inputs: same
 * numbers in, same numbers out, no Math.random, no Date, no global state. That
 * is what lets the FOUR analyses (clustering / correlation / regression /
 * groupby) run as footprintjs flowcharts and produce byte-identical committed
 * state on every run — the "deterministic, seeded" requirement of the spike.
 *
 * Deliberately NOT a stats library. `normalApproxPValue` is a closed-form
 * approximation used only so the spike's CALLER can supply a deterministic
 * p-value (SPEC §5 non-goal: "test.pValue is caller-supplied — the package
 * brings the machinery, the consumer brings the judge"). L3 never computes a
 * p-value itself; the analysis def carries a caller-supplied `pValue` fn.
 */

/** Population mean of a non-empty numeric array. */
export function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Quantile-bin `values` into `k` deterministic clusters (the spike's
 * "clustering": equal-frequency binning, order-stable, no randomness). Returns
 * a cluster id in `[0, k)` per input value. Ties are assigned by sorted rank,
 * so the mapping is a pure function of the multiset of values.
 */
export function quantileBins(values: readonly number[], k: number): number[] {
  if (k < 1) throw new Error('quantileBins: k must be >= 1');
  const n = values.length;
  // Rank each index by value (stable: ties broken by original index).
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v - b.v) || (a.i - b.i));
  const rankOf = new Array<number>(n);
  order.forEach((o, rank) => {
    rankOf[o.i] = rank;
  });
  // Equal-frequency: rank r → bin floor(r * k / n), clamped to [0, k-1].
  return rankOf.map((r) => Math.min(k - 1, Math.floor((r * k) / n)));
}

/** Pearson correlation r and sample size n over paired numeric arrays. */
export function pearson(xs: readonly number[], ys: readonly number[]): { r: number; n: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { r: NaN, n };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  if (denom === 0) return { r: NaN, n };
  return { r: sxy / denom, n };
}

/** Ordinary least-squares line over paired numeric arrays. */
export function ols(
  xs: readonly number[],
  ys: readonly number[],
): { slope: number; intercept: number; domain: [number, number] } {
  const n = Math.min(xs.length, ys.length);
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let xmin = Infinity;
  let xmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) * (x - mx);
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
  }
  const slope = sxx === 0 ? NaN : sxy / sxx;
  const intercept = my - slope * mx;
  return { slope, intercept, domain: [xmin, xmax] };
}

/** Standard-normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation. */
function phi(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * A deterministic two-sided p-value for a Pearson correlation via the
 * large-sample normal approximation of the t-statistic. Closed-form, no deps —
 * a stand-in for the caller-supplied judge, NOT a claim to statistical rigor.
 */
export function normalApproxPValue(r: number, n: number): number {
  if (!Number.isFinite(r) || n < 3 || Math.abs(r) >= 1) return Number.isFinite(r) ? 0 : 1;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - phi(Math.abs(t)));
}
