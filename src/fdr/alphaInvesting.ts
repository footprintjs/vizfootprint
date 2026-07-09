/**
 * Alpha-investing — online control of mFDR (Foster & Stine, 2008,
 * "alpha-investing: a procedure for sequential control of expected false
 * discoveries", J. R. Statist. Soc. B 70(2):429-444). Implemented from the
 * authors' free full text (Wharton), retrieved 2026-07-09 from
 * http://www-stat.wharton.upenn.edu/~stine/research/mfdr.pdf.
 *
 * Section 3, "Alpha-Investing Rules":
 *
 *   - alpha-wealth W(k) >= 0, W(0) the initial wealth ("conventionally
 *     W(0) = 0.05 or 0.10"); "the rule must ensure that its wealth never goes
 *     negative" (p. 7).
 *
 *   - decision  R_j = 1{ p_j <= alpha_j }                                        (6)
 *
 *   - the investing rule sets the level from wealth + prior outcomes
 *       alpha_j = I_{W(0)}( {R_1, ..., R_{j-1}} )                                (7)
 *
 *   - wealth update (pay-out omega on rejection, cost alpha_j/(1-alpha_j) else):
 *       W(j) - W(j-1) = {  omega                if p_j <= alpha_j
 *                       { -alpha_j / (1-alpha_j) if p_j >  alpha_j               (8)
 *     with pay-out omega < 1; "we typically set alpha = omega = W(0)".
 *
 * Concrete investing rule implemented here is the paper's own worked example,
 * eq. (9): with k* the index of the most recently rejected hypothesis (k* = 0
 * when testing H_1), for j > k*,
 *
 *       I_{W(0)}( {R_1, ..., R_{j-1}} ) = W(j-1) / ( 1 + j - k* ).               (9)
 *
 * i.e. invest heavily right after a rejection (denominator 2) and taper while
 * discoveries dry up. This is a genuine, distinct procedure from LORD++: the
 * wealth mechanics (multiplicative cost alpha/(1-alpha), pay-out on rejection)
 * and the level rule differ from LORD's gamma-convolution.
 *
 * Control guarantee: an alpha-investing rule with omega = alpha and W(0) <=
 * alpha*eta controls mFDR_eta = E(V)/(E(R)+eta) <= alpha (eq. (1); Theorem 1
 * gives E V(T_r) <= alpha(r+1)). NOTE mFDR is a *ratio of expectations*, weaker
 * than the FDR that LORD++ controls; see the caveats in the packet report.
 */

import type { FdrRun, FdrStep, HypothesisRecord } from './types.js';

export interface AlphaInvestingOptions {
  /** Target mFDR level alpha in (0, 1). */
  readonly alpha: number;
  /** Initial alpha-wealth W(0), 0 < W(0) <= alpha. Default alpha (= omega). */
  readonly w0?: number;
  /** Pay-out omega earned per rejection, 0 < omega < 1. Default alpha. */
  readonly omega?: number;
}

/** Mutable state of a running alpha-investing procedure. */
export interface AlphaInvestingState {
  readonly alpha: number;
  readonly w0: number;
  readonly omega: number;
  /** Steps taken so far (j). */
  j: number;
  /** alpha-wealth W(j). */
  wealth: number;
  /** Index k* of the most recent rejection; 0 until the first rejection. */
  kStar: number;
}

/**
 * Create a streaming alpha-investing stepper. Call `step` once per declared
 * analysis, in arrival order.
 */
export function createAlphaInvesting(options: AlphaInvestingOptions): {
  readonly state: AlphaInvestingState;
  step: (h: HypothesisRecord) => FdrStep;
} {
  const alpha = options.alpha;
  if (!(alpha > 0 && alpha < 1)) {
    throw new RangeError(`alpha must be in (0,1), got ${alpha}`);
  }
  const w0 = options.w0 ?? alpha;
  if (!(w0 > 0 && w0 <= alpha)) {
    throw new RangeError(`w0 must satisfy 0 < w0 <= alpha, got ${w0}`);
  }
  const omega = options.omega ?? alpha;
  if (!(omega > 0 && omega < 1)) {
    throw new RangeError(`omega must satisfy 0 < omega < 1, got ${omega}`);
  }

  const state: AlphaInvestingState = {
    alpha,
    w0,
    omega,
    j: 0,
    wealth: w0,
    kStar: 0,
  };

  function step(h: HypothesisRecord): FdrStep {
    const j = state.j + 1;
    const wealthBefore = state.wealth;

    // ---- investing rule eq. (9): alpha_j = W(j-1) / (1 + j - k*) ----------
    // j > k* always (k* is a strictly earlier index), so the denominator is
    // >= 2 and alpha_j < 1; the cost alpha_j/(1-alpha_j) <= W(j-1), so wealth
    // stays >= 0 (paper's "wealth never goes negative" requirement).
    const alphaJ = wealthBefore / (1 + j - state.kStar);

    const reject = h.pValue <= alphaJ;
    const isFirstRejection = reject && state.kStar === 0;

    // ---- wealth update eq. (8) -------------------------------------------
    const wealthAfter = reject
      ? wealthBefore + omega
      : wealthBefore - alphaJ / (1 - alphaJ);

    state.j = j;
    state.wealth = wealthAfter;
    if (reject) state.kStar = j;

    return {
      step: j,
      hypothesisId: h.hypothesisId,
      pValue: h.pValue,
      timestamp: h.timestamp,
      branchId: h.branchId,
      alphaThreshold: alphaJ,
      reject,
      wealthBefore,
      wealthAfter,
      firstRejection: isFirstRejection,
    };
  }

  return { state, step };
}

/** Run alpha-investing over a whole stream (a fold of the stepper). Pure. */
export function alphaInvesting(
  stream: readonly HypothesisRecord[],
  options: AlphaInvestingOptions,
): FdrRun {
  const { state, step } = createAlphaInvesting(options);
  const audit: FdrStep[] = [];
  const discoveries: string[] = [];
  for (const h of stream) {
    const s = step(h);
    audit.push(s);
    if (s.reject) discoveries.push(s.hypothesisId);
  }
  return {
    procedure: 'alpha-investing',
    alpha: state.alpha,
    w0: state.w0,
    audit,
    discoveries,
    finalWealth: state.wealth,
  };
}
