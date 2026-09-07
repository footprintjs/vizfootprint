/**
 * types.coverage.test.ts — the arms of types.ts no other test reaches:
 * `reject()`'s no-`detail` branch (every production call site passes one, and
 * `reject` is exported, so a caller of the public API is free to omit it), and
 * the two display labels + `clauseFields`, which every consumer reads THROUGH
 * a provider or a port rather than calling by name.
 */

import { describe, it, expect } from 'vitest';
import { cellFieldLabel, clauseFields, isRejection, neighbourhoodFieldLabel, reject } from './types.js';

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

describe('the joint-field labels and the columns a clause reads', () => {
  it('a cell is spelled with ×, a neighbourhood with ↔ — display-only, and the two never collide', () => {
    expect(cellFieldLabel(['price', 'category'])).toBe('price × category');
    // the arrow says "one edge", whose BOTH ends the predicate asks about
    expect(neighbourhoodFieldLabel(['from', 'to'])).toBe('from ↔ to');
    expect(neighbourhoodFieldLabel(['from', 'to'])).not.toBe(cellFieldLabel(['from', 'to']));
  });

  it('clauseFields answers ONE column for the single-field kinds and BOTH for the two-field kinds', () => {
    expect(clauseFields({ kind: 'point', field: 'price', value: 1 })).toEqual(['price']);
    expect(clauseFields({ kind: 'interval', field: 'price', value: [1, 2] })).toEqual(['price']);
    expect(clauseFields({ kind: 'match', field: 'category', values: ['Formal'] })).toEqual(['category']);
    expect(clauseFields({ kind: 'cell', fields: ['price', 'category'], value: null })).toEqual(['price', 'category']);
    expect(clauseFields({ kind: 'neighbourhood', fields: ['from', 'to'], ids: ['Lyme'] })).toEqual(['from', 'to']);
  });
});
