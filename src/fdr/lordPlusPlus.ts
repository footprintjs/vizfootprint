/**
 * LORD++ — online FDR control (Ramdas, Yang, Wainwright & Jordan, 2017,
 * "Online control of the false discovery rate with decaying memory",
 * NeurIPS 30; arXiv:1710.00499, retrieved 2026-07-09 from
 * https://arxiv.org/pdf/1710.00499).
 *
 * Implemented EXACTLY as the paper's explicit LORD++ example, eq. (5),
 * Section 3.1 ("Improved monotone GAI rules (GAI++) under independence"):
 *
 *     alpha_t = gamma_t * W0
 *             + (alpha - W0) * gamma_{t - tau_1}
 *             + alpha * sum_{ j : tau_j < t, tau_j != tau_1 } gamma_{t - tau_j}      (5)
 *
 *   where tau_j is the time of the j-th rejection and {gamma_j} is an infinite
 *   nonincreasing sequence of positive constants summing to one.
 *
 * The reward schedule is the GAI++ rule stated just above eq. (5):
 *
 *     b_t = { alpha - W0   when R(t-1) = 0   (i.e. the very first rejection)
 *           { alpha        otherwise                                                 }
 *
 * and the wealth process is the GAI recursion (Section 3, just above eq. (4)):
 *
 *     W(t) = W(t-1) - phi_t + R_t * psi_t,   with, for LORD++,  phi_t = alpha_t
 *     and  psi_t = b_t  (the maximal reward allowed by eq. (4) when phi_t = alpha_t).
 *
 * Guarantee (paper Theorem 1, Section 3.1): any monotone GAI++ rule controls
 * FDR at level alpha under independence, and W(T) >= 0 for all T.
 *
 * Defaults per Section 3.1: W0 = alpha/2 and the gamma sequence in ./gamma.ts.
 * (The R package onlineFDR uses W0 = alpha/10; both satisfy 0 <= W0 <= alpha.)
 */

import type { FdrRun, FdrStep, GammaSequence, HypothesisRecord } from './types.js';
import { lordGamma } from './gamma.js';

export interface LordPlusPlusOptions {
  /** Target FDR level alpha in (0, 1). */
  readonly alpha: number;
  /** Initial alpha-wealth W0, with 0 <= W0 <= alpha. Default alpha/2. */
  readonly w0?: number;
  /** The nonincreasing gamma sequence. Default: published LORD gamma. */
  readonly gamma?: GammaSequence;
}

/** Mutable state of a running LORD++ procedure. */
export interface LordPlusPlusState {
  readonly alpha: number;
  readonly w0: number;
  /** Steps taken so far (t). */
  t: number;
  /** alpha-wealth W(t). */
  wealth: number;
  /** Times (1-indexed steps) of past rejections, in order: tau_1, tau_2, ... */
  readonly rejectionTimes: number[];
}

/**
 * Create a streaming LORD++ stepper. Call `step` once per declared analysis, in
 * arrival order — this is the true online interface L3/L1 drive.
 */
export function createLordPlusPlus(options: LordPlusPlusOptions): {
  readonly state: LordPlusPlusState;
  step: (h: HypothesisRecord) => FdrStep;
} {
  const alpha = options.alpha;
  if (!(alpha > 0 && alpha < 1)) {
    throw new RangeError(`alpha must be in (0,1), got ${alpha}`);
  }
  const w0 = options.w0 ?? alpha / 2;
  if (!(w0 >= 0 && w0 <= alpha)) {
    throw new RangeError(`w0 must satisfy 0 <= w0 <= alpha, got ${w0}`);
  }
  const gamma = options.gamma ?? lordGamma;

  const state: LordPlusPlusState = {
    alpha,
    w0,
    t: 0,
    wealth: w0,
    rejectionTimes: [],
  };

  function step(h: HypothesisRecord): FdrStep {
    const t = state.t + 1;
    const taus = state.rejectionTimes;

    // ---- alpha_t via eq. (5) --------------------------------------------
    let alphaT = w0 * gamma(t);
    if (taus.length >= 1) {
      const tau1 = taus[0]!;
      alphaT += (alpha - w0) * gamma(t - tau1);
      for (let k = 1; k < taus.length; k++) {
        alphaT += alpha * gamma(t - taus[k]!);
      }
    }

    const wealthBefore = state.wealth;
    const reject = h.pValue <= alphaT;
    const isFirstRejection = reject && taus.length === 0;

    // Reward schedule b_t and GAI wealth update W(t) = W(t-1) - phi_t + R_t*psi_t,
    // with phi_t = alpha_t and psi_t = b_t.
    const bT = taus.length === 0 ? alpha - w0 : alpha;
    const wealthAfter = wealthBefore - alphaT + (reject ? bT : 0);

    state.t = t;
    state.wealth = wealthAfter;
    if (reject) taus.push(t);

    return {
      step: t,
      hypothesisId: h.hypothesisId,
      pValue: h.pValue,
      timestamp: h.timestamp,
      branchId: h.branchId,
      alphaThreshold: alphaT,
      reject,
      wealthBefore,
      wealthAfter,
      firstRejection: isFirstRejection,
    };
  }

  return { state, step };
}

/** Run LORD++ over a whole stream (a fold of the stepper). Pure. */
export function lordPlusPlus(
  stream: readonly HypothesisRecord[],
  options: LordPlusPlusOptions,
): FdrRun {
  const { state, step } = createLordPlusPlus(options);
  const audit: FdrStep[] = [];
  const discoveries: string[] = [];
  for (const h of stream) {
    const s = step(h);
    audit.push(s);
    if (s.reject) discoveries.push(s.hypothesisId);
  }
  return {
    procedure: 'LORD++',
    alpha: state.alpha,
    w0: state.w0,
    audit,
    discoveries,
    finalWealth: state.wealth,
  };
}
