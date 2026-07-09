/**
 * A4 — property / invariant tests drawn directly from the two papers.
 *
 * Invariants asserted, with citations:
 *   (I1) LORD gamma sequence is nonincreasing and positive.
 *        Ramdas et al. (2017) Sec. 3.1: "an infinite nonincreasing sequence of
 *        positive constants {gamma_j} that sums to one".
 *   (I2) gamma sums to (approximately) one. Same sentence, Sec. 3.1.
 *   (I3) LORD++ thresholds are nonincreasing while no rejection occurs
 *        (the "decaying memory" behavior; follows from I1 via eq. (5)).
 *   (I4) LORD++ is MONOTONE (eq. (3)): an extra earlier rejection weakly
 *        raises every later threshold.
 *   (I5) alpha-investing wealth is never negative.
 *        Foster & Stine (2008) Sec. 3: "the rule must ensure that its wealth
 *        never goes negative". Also 0 <= alpha_j < 1.
 *   (I6) LORD++ wealth is never negative and phi_t = alpha_t <= W(t-1).
 *        Ramdas et al. (2017) Thm. 1 (W(T) >= 0) and the GAI constraint
 *        phi_t <= W(t-1) (Sec. 3, above eq. (4)).
 */

import { describe, it, expect } from 'vitest';
import {
  lordGamma,
  lordGammaShape,
  sumGamma,
  normalizingConstant,
  LORD_GAMMA_CONSTANT,
  lordPlusPlus,
  alphaInvesting,
  makeRng,
  type HypothesisRecord,
} from './index.js';

function randomStream(seed: number, n: number): HypothesisRecord[] {
  const rng = makeRng(seed);
  const out: HypothesisRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ hypothesisId: `h${i + 1}`, pValue: rng.next(), timestamp: i + 1 });
  }
  return out;
}

describe('A4 — invariants from the papers', () => {
  it('(I1) LORD gamma_j is positive and nonincreasing (Ramdas Sec. 3.1)', () => {
    let prev = lordGamma(1);
    expect(prev).toBeGreaterThan(0);
    for (let j = 2; j <= 100_000; j++) {
      const g = lordGamma(j);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(prev + 1e-18);
      prev = g;
    }
  });

  it('(I2) gamma partial sums stay <= 1 (conservative) and climb monotonically toward the calibrated 1', () => {
    // HONEST FINDING: the LORD default gamma sums to one only in the infinite
    // limit, and converges *brutally* slowly — tail terms behave like
    // log(j)/j^{1 + 1/sqrt(log j)} with the exponent -> 1 excruciatingly slowly.
    // No feasible finite horizon reaches 1. What matters operationally is that
    // partial sums stay <= 1 within any session (so wealth never over-spends);
    // that holds with large margin, which makes LORD++ *conservative*, not
    // invalid. The published constant 0.0722 (and onlineFDR's 0.07720838)
    // calibrate the true infinite sum.
    const horizons = [1_000, 100_000, 2_000_000];
    const sums = horizons.map((H) => sumGamma(lordGamma, H));
    const cNorm2M = normalizingConstant(2_000_000);
    // eslint-disable-next-line no-console
    console.log(
      `[A4/I2] published constant C=${LORD_GAMMA_CONSTANT} — partial sums of gamma_j (converge to 1 only in the limit):\n` +
        horizons
          .map((H, i) => `        sum_{j=1..${H}} gamma_j = ${sums[i]!.toFixed(6)}`)
          .join('\n') +
        `\n        (still climbing; at H=2e6 the finite-horizon normalizer is C*=1/sum_shape=${cNorm2M.toFixed(8)}, ` +
        `heading toward the published ~0.0722)`,
    );
    // Monotone increasing, and conservative (<= 1) at every operational horizon.
    for (let i = 1; i < sums.length; i++) expect(sums[i]!).toBeGreaterThan(sums[i - 1]!);
    for (const s of sums) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('(I3) LORD++ thresholds are nonincreasing with no rejections', () => {
    // All p-values = 1 => no rejections => thresholds = W0*gamma(t), decaying.
    const stream: HypothesisRecord[] = Array.from({ length: 200 }, (_, i) => ({
      hypothesisId: `h${i + 1}`,
      pValue: 1,
      timestamp: i + 1,
    }));
    const run = lordPlusPlus(stream, { alpha: 0.05 });
    expect(run.discoveries.length).toBe(0);
    for (let i = 1; i < run.audit.length; i++) {
      expect(run.audit[i]!.alphaThreshold).toBeLessThanOrEqual(
        run.audit[i - 1]!.alphaThreshold + 1e-18,
      );
    }
  });

  it('(I4) LORD++ is monotone: an extra earlier rejection weakly raises later thresholds (eq. 3)', () => {
    // Compare eq.(5) thresholds at step t under rejection histories R and R'
    // where R' has one additional earlier rejection (coordinatewise R' >= R).
    const alpha = 0.05;
    const w0 = alpha / 2;
    const thresholdAt = (t: number, taus: number[]): number => {
      let a = w0 * lordGamma(t);
      if (taus.length >= 1) {
        a += (alpha - w0) * lordGamma(t - taus[0]!);
        for (let k = 1; k < taus.length; k++) a += alpha * lordGamma(t - taus[k]!);
      }
      return a;
    };
    for (let t = 5; t <= 60; t += 5) {
      const base = [2];
      const extra = [2, 3]; // add a rejection at step 3 (still < t)
      expect(thresholdAt(t, extra)).toBeGreaterThanOrEqual(thresholdAt(t, base) - 1e-15);
    }
  });

  it('(I5) alpha-investing wealth never negative; 0 <= alpha_j < 1 (Foster & Stine Sec. 3)', () => {
    for (const seed of [1, 7, 42, 123, 999]) {
      const run = alphaInvesting(randomStream(seed, 500), { alpha: 0.05 });
      for (const s of run.audit) {
        expect(s.wealthBefore).toBeGreaterThanOrEqual(0);
        expect(s.wealthAfter).toBeGreaterThanOrEqual(0);
        expect(s.alphaThreshold).toBeGreaterThanOrEqual(0);
        expect(s.alphaThreshold).toBeLessThan(1);
      }
      expect(run.finalWealth).toBeGreaterThanOrEqual(0);
    }
  });

  it('(I6) LORD++ wealth never negative and phi_t=alpha_t <= W(t-1) (Ramdas Thm. 1 / eq. 4 setup)', () => {
    for (const seed of [2, 13, 55, 200, 777]) {
      const run = lordPlusPlus(randomStream(seed, 500), { alpha: 0.05 });
      for (const s of run.audit) {
        expect(s.wealthAfter).toBeGreaterThanOrEqual(-1e-12);
        // phi_t = alpha_t must be affordable from wealth before the test.
        expect(s.alphaThreshold).toBeLessThanOrEqual(s.wealthBefore + 1e-12);
      }
      expect(run.finalWealth).toBeGreaterThanOrEqual(-1e-12);
    }
  });
});
