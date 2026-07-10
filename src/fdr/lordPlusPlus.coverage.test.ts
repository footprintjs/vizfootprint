/**
 * lordPlusPlus.coverage.test.ts — closes the remaining gaps in
 * `createLordPlusPlus`:
 *  - the two input-guard RangeErrors (`alpha`, `w0`).
 *  - eq. (5)'s tau_1 term AND the `for` loop over tau_2..tau_k (only
 *    exercised once at least TWO prior rejections exist — a4-invariants.test.ts's
 *    random streams at alpha=0.05 essentially never reject, so that branch is
 *    otherwise untouched by this packet's own tests).
 */

import { describe, it, expect } from 'vitest';
import { createLordPlusPlus, lordPlusPlus } from './lordPlusPlus.js';
import type { HypothesisRecord } from './types.js';

describe('createLordPlusPlus — alpha guard: 0 < alpha < 1', () => {
  it('throws for alpha = 0', () => {
    expect(() => createLordPlusPlus({ alpha: 0 })).toThrow(
      new RangeError('alpha must be in (0,1), got 0'),
    );
  });

  it('throws for alpha = 1', () => {
    expect(() => createLordPlusPlus({ alpha: 1 })).toThrow(
      new RangeError('alpha must be in (0,1), got 1'),
    );
  });
});

describe('createLordPlusPlus — w0 guard: 0 <= w0 <= alpha', () => {
  it('throws for a negative w0', () => {
    expect(() => createLordPlusPlus({ alpha: 0.5, w0: -0.1 })).toThrow(
      new RangeError('w0 must satisfy 0 <= w0 <= alpha, got -0.1'),
    );
  });

  it('throws for w0 > alpha', () => {
    expect(() => createLordPlusPlus({ alpha: 0.5, w0: 0.6 })).toThrow(
      new RangeError('w0 must satisfy 0 <= w0 <= alpha, got 0.6'),
    );
  });

  it('does not throw for w0 = 0 (closed lower bound)', () => {
    expect(() => createLordPlusPlus({ alpha: 0.3, w0: 0 })).not.toThrow();
  });
});

describe('createLordPlusPlus eq.(5) — the tau_1 term AND the k>=2 loop, with TWO prior rejections', () => {
  it('step 3 threshold, with rejections at steps 1 and 2, matches the hand-derived eq.(5) sum EXACTLY', () => {
    // alpha=0.5, w0=0.25; p=0 forces a reject at steps 1 and 2 regardless of
    // the (tiny) threshold, so by step 3 taus = [1, 2] — length 2, which is
    // required to enter BOTH the tau_1 branch (taus.length >= 1) and the
    // `for (k=1; k<taus.length; k++)` loop body (needs taus.length >= 2).
    const stream: HypothesisRecord[] = [
      { hypothesisId: 'h1', pValue: 0, timestamp: 1 },
      { hypothesisId: 'h2', pValue: 0, timestamp: 2 },
      { hypothesisId: 'h3', pValue: 1, timestamp: 3 },
    ];
    const run = lordPlusPlus(stream, { alpha: 0.5, w0: 0.25 });

    expect(run.audit).toHaveLength(3);
    const [s1, s2, s3] = run.audit;

    // Step 1: alpha_1 = w0*gamma(1); first rejection (taus was empty).
    expect(s1!.alphaThreshold).toBeCloseTo(0.012511306609107013, 12);
    expect(s1!.reject).toBe(true);
    expect(s1!.firstRejection).toBe(true);
    expect(s1!.wealthAfter).toBeCloseTo(0.48748869339089296, 12);

    // Step 2: alpha_2 = w0*gamma(2) + (alpha-w0)*gamma(2-tau_1=1); reject
    // again, but NOT the "first" rejection anymore.
    expect(s2!.alphaThreshold).toBeCloseTo(0.015232120261486437, 12);
    expect(s2!.reject).toBe(true);
    expect(s2!.firstRejection).toBe(false);
    expect(s2!.wealthAfter).toBeCloseTo(0.9722565731294065, 12);

    // Step 3: taus = [1, 2] going in. alpha_3 = w0*gamma(3)
    //   + (alpha-w0)*gamma(3-tau_1=2)      <- the tau_1 term (line 92)
    //   + alpha*gamma(3-tau_2=1)           <- the k=1 loop body (line 94)
    expect(s3!.alphaThreshold).toBeCloseTo(0.030060799715872888, 12);

    expect(run.discoveries).toEqual(['h1', 'h2']);
  });

  it('the streaming stepper (createLordPlusPlus) agrees with the fold, step by step', () => {
    const { step } = createLordPlusPlus({ alpha: 0.5, w0: 0.25 });
    const s1 = step({ hypothesisId: 'h1', pValue: 0, timestamp: 1 });
    const s2 = step({ hypothesisId: 'h2', pValue: 0, timestamp: 2 });
    const s3 = step({ hypothesisId: 'h3', pValue: 1, timestamp: 3 });
    expect(s1.alphaThreshold).toBeCloseTo(0.012511306609107013, 12);
    expect(s2.alphaThreshold).toBeCloseTo(0.015232120261486437, 12);
    expect(s3.alphaThreshold).toBeCloseTo(0.030060799715872888, 12);
  });
});
