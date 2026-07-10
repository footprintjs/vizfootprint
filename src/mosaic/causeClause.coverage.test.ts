/**
 * Coverage packet (COV-trace) — closes the one branch `causeClause.test.ts`
 * never needed: `causeClause`'s `clause.meta ?? { type: spec.kind }` fallback
 * (causeClause.ts). The installed `@uwdata/mosaic-core` `clausePoint` /
 * `clauseInterval` ALWAYS set `meta` on the object they return
 * (dist/src/SelectionClause.js — `clausePoint` returns `{ meta: { type:
 * 'point' }, ... }` unconditionally; `clauseInterval` likewise), so this
 * fallback is genuinely unreachable through any real call. It defensively
 * guards a future/duck-typed clause factory whose `meta` might be absent.
 *
 * Reached (not ignored) by mocking the `@uwdata/mosaic-core` BOUNDARY (never
 * our own code) so `clausePoint` returns a real, otherwise-correct clause
 * with `meta` stripped — proving `causeClause` really does synthesize
 * `{ type: spec.kind }` and still merges the cause on top.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('causeClause — meta fallback when the clause factory omits meta', () => {
  afterEach(() => {
    vi.doUnmock('@uwdata/mosaic-core');
    vi.resetModules();
  });

  it('falls back to {type: spec.kind} and still merges the cause on top', async () => {
    vi.resetModules();
    vi.doMock('@uwdata/mosaic-core', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@uwdata/mosaic-core')>();
      return {
        ...actual,
        clausePoint: (...args: Parameters<typeof actual.clausePoint>) => {
          const real = actual.clausePoint(...args);
          const { meta: _drop, ...rest } = real;
          return rest; // a clause with NO meta at all
        },
      };
    });

    const { causeClause } = await import('./causeClause.js');
    const { SourceRegistry } = await import('./SourceRegistry.js');

    const registry = new SourceRegistry();
    const source = registry.register('v1', { actor: 'user' });
    const clause = causeClause({
      kind: 'point',
      source,
      field: 'category',
      value: 'Data',
      cause: { requestedBy: 'user', computedBy: 'user' },
    });

    // the synthesized fallback base, with cause merged on top — not a crash,
    // not a bare {cause} with the factory's type info silently dropped.
    expect(clause.meta).toEqual({ type: 'point', cause: { requestedBy: 'user', computedBy: 'user' } });
  });
});
