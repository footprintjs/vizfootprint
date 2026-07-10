/**
 * alphaInvesting.coverage.test.ts — closes the three input-guard gaps in
 * `createAlphaInvesting`: the RangeError thrown for an out-of-range
 * `alpha` / `w0` / `omega`. The happy paths (wealth mechanics, rejection
 * decisions) are already proven by a4-invariants.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createAlphaInvesting } from './alphaInvesting.js';

describe('createAlphaInvesting — alpha guard: 0 < alpha < 1', () => {
  it('throws for alpha = 0', () => {
    expect(() => createAlphaInvesting({ alpha: 0 })).toThrow(
      new RangeError('alpha must be in (0,1), got 0'),
    );
  });

  it('throws for alpha = 1 (open upper bound)', () => {
    expect(() => createAlphaInvesting({ alpha: 1 })).toThrow(
      new RangeError('alpha must be in (0,1), got 1'),
    );
  });

  it('throws for a negative alpha', () => {
    expect(() => createAlphaInvesting({ alpha: -0.2 })).toThrow(
      new RangeError('alpha must be in (0,1), got -0.2'),
    );
  });
});

describe('createAlphaInvesting — w0 guard: 0 < w0 <= alpha', () => {
  it('throws for w0 = 0 (must be strictly positive)', () => {
    expect(() => createAlphaInvesting({ alpha: 0.5, w0: 0 })).toThrow(
      new RangeError('w0 must satisfy 0 < w0 <= alpha, got 0'),
    );
  });

  it('throws for w0 > alpha', () => {
    expect(() => createAlphaInvesting({ alpha: 0.5, w0: 0.6 })).toThrow(
      new RangeError('w0 must satisfy 0 < w0 <= alpha, got 0.6'),
    );
  });

  it('does not throw for w0 === alpha (closed upper bound)', () => {
    expect(() => createAlphaInvesting({ alpha: 0.3, w0: 0.3 })).not.toThrow();
  });
});

describe('createAlphaInvesting — omega guard: 0 < omega < 1', () => {
  it('throws for omega = 0', () => {
    expect(() => createAlphaInvesting({ alpha: 0.5, omega: 0 })).toThrow(
      new RangeError('omega must satisfy 0 < omega < 1, got 0'),
    );
  });

  it('throws for omega = 1 (open upper bound)', () => {
    expect(() => createAlphaInvesting({ alpha: 0.5, omega: 1 })).toThrow(
      new RangeError('omega must satisfy 0 < omega < 1, got 1'),
    );
  });

  it('throws for a negative omega', () => {
    expect(() => createAlphaInvesting({ alpha: 0.5, omega: -0.1 })).toThrow(RangeError);
  });
});
