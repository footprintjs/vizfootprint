/**
 * Coverage packet (COV-trace) — direct unit tests of the three tier-resolvers
 * plus the `isMiss` guard, closing branches no acceptance test needed:
 *
 *   - `isMiss` is a runtime type guard on a UNION that is always object-typed
 *     from inside footprintjs code, but it is exported as public API — a
 *     caller can hand it anything at runtime. Its own `typeof`/`null`/`in`
 *     branches are exercised directly with degenerate values.
 *   - `resolveVizTier`'s correlationId-FIELD resolution path (D20): the
 *     "declaring commit not found" and "declaring found but carries a
 *     DIFFERENT key" routes that both fall through to the field-carrier
 *     lookup (the documented "x3 brush case") — every other test file only
 *     ever exercises the "declaring commit itself carries the key" route.
 *   - `resolveKernelTier`'s `key === undefined` (distinct from a
 *     never-written key) miss.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CauseSelectionSession } from '../log/index.js';
import { isMiss, resolveKernelTier, resolveVizTier } from './resolvers.js';
import { runKernel } from './kernel.fixture.js';

const cause = { requestedBy: 'user' as const, computedBy: 'user' as const };

describe('isMiss — runtime guard branches (typeof / null / "miss" in r)', () => {
  it('non-object values are never a miss (typeof short-circuits false)', () => {
    expect(isMiss(42 as never)).toBe(false);
    expect(isMiss('x' as never)).toBe(false);
    expect(isMiss(undefined as never)).toBe(false);
  });

  it('null is typeof "object" in JS but explicitly excluded', () => {
    expect(isMiss(null as never)).toBe(false);
  });

  it('a plain resolved object without a "miss" key is not a miss', () => {
    expect(isMiss({ commitId: 'x' } as never)).toBe(false);
  });

  it('an object carrying "miss" IS a miss', () => {
    expect(isMiss({ miss: { tier: 'viz', missing: 'no-viz-commit' } } as never)).toBe(true);
  });
});

describe('resolveVizTier — correlationId-FIELD resolution (D20), the field-carrier fallback routes', () => {
  it('declaring commit id not in the log AND no record carries the key → no-viz-commit', () => {
    const s = new CauseSelectionSession();
    s.commit({
      id: 'unrelated', parent: null, viewId: 'A', actorMeta: { actor: 'user' },
      kind: 'point', field: 'category', value: 'X', cause,
    });
    const res = resolveVizTier('corr-ghost', 'never-committed', s.records);
    expect(isMiss(res)).toBe(true);
    expect('miss' in res && res.miss).toEqual({ tier: 'viz', missing: 'no-viz-commit' });
  });

  it('declaring commit id not in the log, but ANOTHER record carries the key → resolves via the FIELD (x3 brush case)', () => {
    const s = new CauseSelectionSession();
    const carrier = s.commit({
      id: 'carrier', parent: null, correlationId: 'corr-1', viewId: 'B',
      actorMeta: { actor: 'agent' }, kind: 'interval', field: 'amount', value: [1, 2], cause,
    }).record;
    const res = resolveVizTier('corr-1', 'declaring-does-not-exist', s.records);
    expect(isMiss(res)).toBe(false);
    if (isMiss(res)) throw new Error('expected a resolution');
    expect(res.commitId).toBe(carrier.id);
  });

  it('declaring commit EXISTS but carries a DIFFERENT (or no) correlationId → falls through to the field-carrier, not the declaring id', () => {
    const s = new CauseSelectionSession();
    const declaring = s.commit({
      id: 'declaring', parent: null, correlationId: 'corr-other', viewId: 'A',
      actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Data', cause,
    }).record;
    const carrier = s.commit({
      id: 'carrier', parent: declaring.id, correlationId: 'corr-1', viewId: 'B',
      actorMeta: { actor: 'agent' }, kind: 'interval', field: 'amount', value: [1, 2], cause,
    }).record;
    const res = resolveVizTier('corr-1', declaring.id, s.records);
    expect(isMiss(res)).toBe(false);
    if (isMiss(res)) throw new Error('expected a resolution');
    // resolved via the correlationId FIELD carrier, NOT the (mismatched) declaring id.
    expect(res.commitId).toBe(carrier.id);
    expect(res.commitId).not.toBe(declaring.id);
  });

  it('declaring commit EXISTS, carries a DIFFERENT key, and no record carries the asked-for key → no-viz-commit', () => {
    const s = new CauseSelectionSession();
    const declaring = s.commit({
      id: 'declaring', parent: null, correlationId: 'corr-other', viewId: 'A',
      actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Data', cause,
    }).record;
    const res = resolveVizTier('corr-nobody-carries-this', declaring.id, s.records);
    expect('miss' in res && res.miss).toEqual({ tier: 'viz', missing: 'no-viz-commit' });
  });

  it('no correlationId supplied, declaringCommitId absent from the log → no-viz-commit (the plain byId path)', () => {
    const res = resolveVizTier(undefined, 'ghost', []);
    expect('miss' in res && res.miss).toEqual({ tier: 'viz', missing: 'no-viz-commit' });
  });
});

describe('resolveKernelTier — key===undefined is a DISTINCT miss reason from a never-written key', () => {
  it('a real snapshot but no key named at all → kernel-key-unresolved (not no-kernel-snapshot)', async () => {
    const kernel = await runKernel({ correlationId: 'k-undef', field: 'amount', range: [10, 20] });
    const res = resolveKernelTier(undefined, kernel.snapshot);
    expect('miss' in res && res.miss).toEqual({ tier: 'kernel', missing: 'kernel-key-unresolved' });
  });
});

describe('resolveKernelTier — writerId defensive fallback (`json.writerId ?? \'\'`)', () => {
  afterEach(() => {
    vi.doUnmock('footprintjs/trace');
    vi.resetModules();
  });

  it('a resolved slice whose JSON projection omits writerId still resolves, falling back to \'\'', async () => {
    // The installed footprintjs `sliceToJSON` always sets `writerId` whenever
    // `slice.root` exists (source: dist/esm/lib/slice/serialize.js) — so this
    // defensive fallback is genuinely unreachable through any real slice. It
    // guards a hypothetical future `SliceJSON` shape (the field is documented
    // "Absent when missing" — i.e. a caller must not assume it always rides
    // along with a non-empty `nodes` set). Reached here by mocking the
    // `footprintjs/trace` BOUNDARY (not our own code) to strip `writerId`
    // from an otherwise-real, otherwise-resolved slice.
    vi.resetModules();
    vi.doMock('footprintjs/trace', async (importOriginal) => {
      const actual = await importOriginal<typeof import('footprintjs/trace')>();
      return {
        ...actual,
        sliceToJSON: (slice: unknown) => {
          const real = actual.sliceToJSON(slice as Parameters<typeof actual.sliceToJSON>[0]);
          const { writerId: _drop, ...rest } = real;
          return rest;
        },
      };
    });

    const { resolveKernelTier: resolveKernelTierMocked } = await import('./resolvers.js');
    const { runKernel: runKernelFresh } = await import('./kernel.fixture.js');
    const kernel = await runKernelFresh({ correlationId: 'k-no-writer-id', field: 'amount', range: [10, 20] });

    const res = resolveKernelTierMocked('rowCount', kernel.snapshot);
    expect(isMiss(res)).toBe(false);
    if (isMiss(res)) throw new Error('expected a resolution');
    expect(res.writerId).toBe(''); // the fallback, not undefined and not a crash
    expect(res.commitIds.length).toBeGreaterThan(0); // the slice itself still resolved fine
  });
});
