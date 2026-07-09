/**
 * X2 spike — a tiny, dependency-free stats kernel so the acceptance-test
 * scenarios run a *real* correlation test on noise rather than fabricating
 * p-values. Pearson r -> Student-t statistic -> exact two-sided p-value via the
 * regularized incomplete beta function I_x(a,b).
 *
 * `betacf` / `gammln` / `betai` follow the standard continued-fraction recipe
 * (Numerical Recipes in C, 2nd ed., Sec. 6.1-6.4). Under the null (independent
 * noise) these p-values are Uniform[0,1], which is exactly the arrival stream
 * the online-FDR procedures assume.
 *
 * This is spike infrastructure; it is NOT part of src/fdr's shipped API.
 */

/** ln Gamma(x) via Lanczos approximation. */
export function gammln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j]! / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction for the incomplete beta function (Lentz's method). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b), in [0,1]. */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Pearson product-moment correlation of two equal-length vectors. */
export function pearsonR(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n !== ys.length || n < 3) {
    throw new RangeError('pearsonR needs equal-length vectors with n >= 3');
  }
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
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
  if (denom === 0) return 0;
  return sxy / denom;
}

/**
 * Two-sided p-value for H0: rho = 0 from a Pearson correlation, via the
 * Student-t transform t = r*sqrt((n-2)/(1-r^2)), df = n-2, and
 * P(|T| > |t|) = I_{df/(df+t^2)}(df/2, 1/2).
 */
export function correlationPValue(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const r = pearsonR(xs, ys);
  const df = n - 2;
  const r2 = Math.min(r * r, 1 - 1e-15);
  const t2 = (r2 * df) / (1 - r2); // t^2
  return betai(df / 2, 0.5, df / (df + t2));
}
