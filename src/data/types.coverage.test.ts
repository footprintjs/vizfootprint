/**
 * types.coverage.test.ts — closes the one gap in types.ts: `reject()`'s
 * no-`detail` branch. Every production call site always passes a `detail`
 * string; `reject` is exported directly, so this exercises the omitted-arg
 * path a caller of the public API is free to take.
 */

import { describe, it, expect } from 'vitest';
import { isRejection, reject } from './types.js';

describe('reject() — detail is optional', () => {
  it('omitting detail produces a rejection object with NO detail key at all (not detail: undefined)', () => {
    const r = reject('memory', 'evaluate', 'unknown-table');
    expect(r).toEqual({ ok: false, engine: 'memory', operation: 'evaluate', reason: 'unknown-table' });
    expect('detail' in r).toBe(false);
    expect(isRejection(r)).toBe(true);
  });

  it('passing detail includes it verbatim', () => {
    const r = reject('wasm', 'columns', 'not-implemented', 'no backend wired');
    expect(r).toEqual({
      ok: false,
      engine: 'wasm',
      operation: 'columns',
      reason: 'not-implemented',
      detail: 'no backend wired',
    });
  });
});

describe('isRejection', () => {
  it('is false for a plain value that merely has ok:false somewhere unrelated (non-object) or is a normal result', () => {
    expect(isRejection({ ok: true })).toBe(false);
    expect(isRejection(null)).toBe(false);
    expect(isRejection(42)).toBe(false);
  });
});
