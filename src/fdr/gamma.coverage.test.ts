/**
 * gamma.coverage.test.ts — closes the one remaining gap in gamma.ts: the
 * `lordGammaShape` input guard (RangeError on a non-positive-integer index).
 * Every valid-input path is already exercised by a4-invariants.test.ts /
 * gamma.q10.test.ts; this file exists only to prove the invalid-input branch.
 */

import { describe, it, expect } from 'vitest';
import { lordGammaShape } from './gamma.js';

describe('lordGammaShape — index guard', () => {
  it('throws RangeError with the exact message for a non-integer index', () => {
    expect(() => lordGammaShape(1.5)).toThrow(
      new RangeError('gamma index must be a positive integer, got 1.5'),
    );
  });

  it('throws for j = 0 (integer, but not >= 1) — the OTHER half of the OR guard', () => {
    expect(() => lordGammaShape(0)).toThrow(
      new RangeError('gamma index must be a positive integer, got 0'),
    );
  });

  it('throws for a negative integer', () => {
    expect(() => lordGammaShape(-3)).toThrow(
      new RangeError('gamma index must be a positive integer, got -3'),
    );
  });

  it('throws for NaN', () => {
    expect(() => lordGammaShape(Number.NaN)).toThrow(RangeError);
  });

  it('does not throw for j = 1 (the boundary valid value)', () => {
    expect(() => lordGammaShape(1)).not.toThrow();
    expect(lordGammaShape(1)).toBeGreaterThan(0);
  });
});
