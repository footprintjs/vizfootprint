/**
 * The default gamma-spending sequence for LORD-family online FDR procedures.
 *
 * Ramdas, Yang, Wainwright & Jordan (2017), "Online control of the false
 * discovery rate with decaying memory", NeurIPS 30. arXiv:1710.00499
 * (retrieved 2026-07-09 from https://arxiv.org/pdf/1710.00499).
 *
 * Section 3.1, immediately after eq. (5), states the default verbatim:
 *
 *     "Reasonable default choices include W0 = alpha/2, and
 *      gamma_j = 0.0722 * log(j v 2) / ( j * e^{ sqrt(log j) } ),
 *      the latter derived in the context of testing if a Gaussian is zero
 *      mean [9]."
 *
 * where (j v 2) = max(j, 2). Reference [9] is Javanmard & Montanari (2018),
 * "Online rules for control of false discovery rate and false discovery
 * exceedance", Annals of Statistics 46(2), where it appears as equation (31).
 *
 * The published leading constant 0.0722 is a rounded value chosen so the
 * infinite sequence sums (approximately) to one; the requirement the proof
 * actually uses is that {gamma_j} be a nonincreasing sequence of positive
 * constants summing to one (Section 3.1). See `sumGamma` /
 * `normalizingConstant` below for the exact numeric check, and the A4 test for
 * the reported sum under the published constant.
 *
 * ---- Q10 (RESOLVED — docs/RESEARCH_STATE.md canonical Q10 / SPEC.md §6) ----
 * A second, independently-published leading constant exists for this SAME
 * shape g(j): the R/Bioconductor package `onlineFDR` (which implements LORD,
 * LOND and alpha-investing) defaults its gamma sequence to
 * `gamma_j = 0.07720838 * log(j v 2) / (j * e^{sqrt(log j)})` — i.e. the
 * identical shape, citing the identical source (Javanmard & Montanari 2018,
 * eq. 31) ("The theory behind onlineFDR",
 * https://bioconductor.org/packages/devel/bioc/vignettes/onlineFDR/inst/doc/theory.html,
 * retrieved 2026-07-09).
 *
 * Because gamma_j = C * g(j) is LINEAR in C, swapping the constant scales
 * EVERY LORD++ threshold alpha_t by the SAME ratio, for any shared rejection
 * history (eq. 5 in `../lordPlusPlus.ts` is a sum of gamma terms, each
 * linear in C). Measured (`gamma.q10.test.ts`) at j in {1,2,5,10,20,40,60,100}
 * — the realistic per-session range — the ratio is a CONSTANT
 * 0.07720838 / 0.0722 = 1.06937: `onlineFDR`'s constant is uniformly ~6.94%
 * LOOSER (more powerful, marginally less conservative) than the published
 * paper constant, at every step, with no crossover.
 *
 * Both are, at any horizon a real session will ever reach, deeply
 * conservative relative to their own "sums to one" design target: the
 * partial sum sum_{j=1..100} gamma_j is 0.194 under 0.0722 and 0.208 under
 * 0.07720838 — nowhere near 1 (convergence is brutally slow: even at
 * j=2,000,000 the sums are only 0.504 / 0.539 respectively — see I2 in
 * `a4-invariants.test.ts`). Neither constant is "more correct" than the
 * other; the choice is a conservative-vs-calibrated POWER tradeoff, not a
 * validity one — every A4 invariant (positive, nonincreasing, wealth >= 0,
 * monotone) holds identically under either.
 *
 * DECIDED DEFAULT: 0.0722 stays the shipped default — it is the number
 * printed in the primary source this package implements "EXACTLY from" (see
 * every file header in this directory), it is horizon-independent, and it is
 * the (marginally) more conservative of the two known published choices, which
 * matches this package's honesty-first posture (SPEC.md R14). Callers who
 * want parity with `onlineFDR`'s calibration (~6.94% more power, still
 * provably conservative at any realistic horizon) can pass
 * `{ gamma: lordGammaOnlineFDR }` to `createLordPlusPlus` / `lordPlusPlus` —
 * the override seam already on `LordPlusPlusOptions.gamma`; nothing new to
 * wire.
 */

/** The leading constant printed in Ramdas et al. (2017), Section 3.1. Shipped default (Q10). */
export const LORD_GAMMA_CONSTANT = 0.0722;

/**
 * The R/Bioconductor package `onlineFDR`'s default leading constant for the
 * SAME gamma shape (Q10) — an available, NOT default, alternative. ~6.94%
 * looser thresholds than `LORD_GAMMA_CONSTANT` at every step (see the Q10
 * note above); still conservative at any realistic session horizon. Pass
 * `{ gamma: lordGammaOnlineFDR }` to opt in.
 */
export const LORD_GAMMA_CONSTANT_ONLINEFDR = 0.0772_0838;

/**
 * The unnormalized LORD gamma *shape* g(j) = log(j v 2) / ( j e^{ sqrt(log j) } ).
 * gamma_j = C * g(j). Exposed so tests can normalize numerically.
 */
export function lordGammaShape(j: number): number {
  if (!Number.isInteger(j) || j < 1) {
    throw new RangeError(`gamma index must be a positive integer, got ${j}`);
  }
  const logj = Math.log(j);
  const numer = Math.log(Math.max(j, 2)); // log(j v 2)
  const denom = j * Math.exp(Math.sqrt(logj)); // j * e^{ sqrt(log j) }; sqrt(log 1)=0
  return numer / denom;
}

/**
 * The default LORD++ gamma sequence exactly as published (constant 0.0722):
 *   gamma_j = 0.0722 * log(j v 2) / ( j e^{ sqrt(log j) } ).
 */
export function lordGamma(j: number): number {
  return LORD_GAMMA_CONSTANT * lordGammaShape(j);
}

/**
 * The `onlineFDR`-calibrated gamma sequence (Q10, see the header note above):
 *   gamma_j = 0.07720838 * log(j v 2) / ( j e^{ sqrt(log j) } ).
 * Same shape as `lordGamma`, ~6.94% looser at every step. Opt in via
 * `{ gamma: lordGammaOnlineFDR }`; not the shipped default.
 */
export function lordGammaOnlineFDR(j: number): number {
  return LORD_GAMMA_CONSTANT_ONLINEFDR * lordGammaShape(j);
}

/** Partial sum sum_{j=1..upTo} gamma_j, for verifying the sum-to-one property. */
export function sumGamma(gamma: (j: number) => number, upTo: number): number {
  let s = 0;
  for (let j = 1; j <= upTo; j++) s += gamma(j);
  return s;
}

/**
 * The constant C such that sum_{j=1..upTo} C * lordGammaShape(j) = 1, computed
 * numerically over a finite horizon. Handy for a horizon-normalized variant;
 * the shipped default uses the published constant 0.0722 instead so thresholds
 * do not depend on horizon.
 */
export function normalizingConstant(upTo: number): number {
  return 1 / sumGamma(lordGammaShape, upTo);
}
