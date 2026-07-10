/**
 * L3 — pure, deterministic numeric kernels (promoted from `spikes/l3-channels/stats.ts`).
 *
 * Total, seed-free pure functions: same numbers in, same numbers out, no
 * Math.random / Date / global state — so an analysis flowchart produces
 * byte-identical committed state on every run.
 *
 * NOT a stats library. `normalApproxPValue` is a closed-form approximation
 * offered only as a DEFAULT the caller may pass as its p-value judge; L3 never
 * computes a p-value itself (SPEC §5 non-goal — the judge is caller-supplied).
 */

/** Population mean of a non-empty numeric array. */
export function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Quantile-bin `values` into `k` deterministic clusters (equal-frequency
 * binning; the spike's "clustering"). Returns a cluster id in `[0,k)` per input
 * value; a pure function of the multiset of values (ties broken by index).
 */
export function quantileBins(values: readonly number[], k: number): number[] {
  if (k < 1) throw new Error('quantileBins: k must be >= 1');
  const n = values.length;
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v || a.i - b.i);
  const rankOf = new Array<number>(n);
  order.forEach((o, rank) => {
    rankOf[o.i] = rank;
  });
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
  /* v8 ignore next -- `phi` is module-private; its ONLY call site (below, `normalApproxPValue`)
   * always passes `Math.abs(t)`, so `z < 0` is structurally unreachable via the public API. The
   * sign-handling stays (rather than hardcoding `sign = 1`) so `phi` remains a correct, honest
   * standard-normal CDF in its own right, not one silently coupled to how its one caller uses it. */
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
 * a DEFAULT judge, not a claim to statistical rigor.
 */
export function normalApproxPValue(r: number, n: number): number {
  if (!Number.isFinite(r) || n < 3 || Math.abs(r) >= 1) return Number.isFinite(r) ? 0 : 1;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - phi(Math.abs(t)));
}
