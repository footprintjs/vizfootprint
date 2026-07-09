/**
 * A1 — "the reviewer number".
 *
 * An agent brushes N=40 subsets of pure-noise data and runs a correlation test
 * on each (seeded => reproducible). The FIRST test has p* = 0.03, which is
 * "significant" uncorrected at nominal alpha = 0.05. We print the exact online
 * thresholds at n=1 vs n=40 for LORD++ and alpha-investing, and show that once
 * the multiplicity of brushing 40 noise subsets is accounted for, the SAME
 * p* = 0.03 is REJECTED AS A DISCOVERY (its discovery claim is thrown out).
 *
 * Serves R6 (declared brushes) + R7 (online correction).
 */

import { describe, it, expect } from 'vitest';
import { lordPlusPlus, alphaInvesting, lordGamma } from '../../src/fdr/index.js';
import { buildBrushStream } from './scenario.js';

const ALPHA = 0.05;
const N = 40;
const LEN = 32; // df = 30
const SEED = 12345;
const P_STAR = 0.03;

describe('A1 — reviewer number: p*=0.03 significant uncorrected, not a discovery online', () => {
  it('prints exact thresholds at n=1 vs n=40 and rejects the discovery claim', () => {
    const { stream, pValues } = buildBrushStream({
      seed: SEED,
      n: N,
      len: LEN,
      firstPValue: P_STAR,
    });

    // Uncorrected: a single test at nominal alpha.
    const uncorrectedThreshold = ALPHA;
    const uncorrectedSignificant = P_STAR <= uncorrectedThreshold;

    const lord = lordPlusPlus(stream, { alpha: ALPHA }); // W0 = alpha/2
    const ai = alphaInvesting(stream, { alpha: ALPHA }); // W0 = omega = alpha

    const lordN1 = lord.audit[0]!.alphaThreshold;
    const lordN40 = lord.audit[N - 1]!.alphaThreshold;
    const aiN1 = ai.audit[0]!.alphaThreshold;
    const aiN40 = ai.audit[N - 1]!.alphaThreshold;

    // Closed-form LORD++ threshold "after 39 non-rejections" = W0 * gamma(40).
    const lordN40ClosedForm = (ALPHA / 2) * lordGamma(N);

    // eslint-disable-next-line no-console
    console.log(
      '\n================= A1: THE REVIEWER NUMBER =================\n' +
        `scenario: agent brushes N=${N} pure-noise subsets, correlation test each\n` +
        `seed=${SEED}, noise vector length=${LEN} (df=${LEN - 2})\n` +
        `first p-value forced to p* = ${P_STAR}\n` +
        `stream p-values[0..4] = [${pValues.slice(0, 5).map((p) => p.toFixed(4)).join(', ')}, ...]\n` +
        `total discoveries over the 40 brushes: LORD++=${lord.discoveries.length}, ` +
        `alpha-investing=${ai.discoveries.length}\n` +
        '\n--- exact thresholds for p* = 0.03 ---\n' +
        `UNCORRECTED (n=1)          threshold = ${uncorrectedThreshold}  ` +
        `=> p*=0.03 ${uncorrectedSignificant ? 'SIGNIFICANT' : 'not significant'}\n` +
        `LORD++            (n=1)    threshold = ${lordN1.toExponential(4)}  ` +
        `=> p*=0.03 ${P_STAR <= lordN1 ? 'DISCOVERY' : 'NOT a discovery'}\n` +
        `LORD++            (n=40)   threshold = ${lordN40.toExponential(4)}  ` +
        `(closed form W0*gamma(40) = ${lordN40ClosedForm.toExponential(4)})  ` +
        `=> p*=0.03 ${P_STAR <= lordN40 ? 'DISCOVERY' : 'NOT a discovery'}\n` +
        `alpha-investing   (n=1)    threshold = ${aiN1.toExponential(4)}  ` +
        `=> p*=0.03 ${P_STAR <= aiN1 ? 'DISCOVERY' : 'NOT a discovery'}\n` +
        `alpha-investing   (n=40)   threshold = ${aiN40.toExponential(4)}  ` +
        `=> p*=0.03 ${P_STAR <= aiN40 ? 'DISCOVERY' : 'NOT a discovery'}\n` +
        `\nreviewer takeaway: to count as a discovery among 40 brushes, LORD++ ` +
        `needs p <= ${lordN40ClosedForm.toExponential(2)} (~${Math.round(
          uncorrectedThreshold / lordN40ClosedForm,
        )}x stricter than 0.05); p*=0.03 is far too weak.\n` +
        '==========================================================\n',
    );

    // Uncorrected calls it significant; both online procedures do not.
    expect(uncorrectedSignificant).toBe(true);
    expect(lord.audit[0]!.reject).toBe(false);
    expect(ai.audit[0]!.reject).toBe(false);
    // Pure noise + strict online thresholds => no false discoveries at all.
    expect(lord.discoveries.length).toBe(0);
    // Online thresholds are far below the uncorrected 0.05.
    expect(lordN1).toBeLessThan(uncorrectedThreshold);
    expect(lordN40).toBeLessThan(lordN1);
  });
});
