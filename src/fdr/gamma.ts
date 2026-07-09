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
 */

/** The leading constant printed in Ramdas et al. (2017), Section 3.1. */
export const LORD_GAMMA_CONSTANT = 0.0722;

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
