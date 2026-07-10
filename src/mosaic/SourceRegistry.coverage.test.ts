/**
 * Coverage packet (COV-trace) — closes branches `SourceRegistry.test.ts`
 * never needed to exercise:
 *
 *   - `validateActorMeta`'s "not an object" guard (null AND a primitive —
 *     two distinct branches of `meta === null || typeof meta !== 'object'`);
 *   - `validateActorMeta`'s "label present but not a string" guard;
 *   - `SourceRegistry.size`, never asserted anywhere.
 */

import { describe, expect, it } from 'vitest';
import { SourceRegistry, SourceRegistryError } from './index.js';

describe('SourceRegistry.register — validateActorMeta rejects a non-object meta', () => {
  it('null meta throws (meta === null arm)', () => {
    const r = new SourceRegistry();
    // @ts-expect-error deliberately malformed at the boundary
    expect(() => r.register('v', null)).toThrow(SourceRegistryError);
    // @ts-expect-error deliberately malformed at the boundary
    expect(() => r.register('v', null)).toThrow('actorMeta must be an object');
  });

  it('a primitive meta (not null, but typeof !== "object") throws (the other arm of the ||)', () => {
    const r = new SourceRegistry();
    // @ts-expect-error deliberately malformed at the boundary
    expect(() => r.register('v', 'not-an-object')).toThrow(SourceRegistryError);
    // @ts-expect-error deliberately malformed at the boundary
    expect(() => r.register('v', 42)).toThrow(SourceRegistryError);
  });
});

describe('SourceRegistry.register — validateActorMeta rejects a non-string label', () => {
  it('a numeric label throws, even though actor itself is valid', () => {
    const r = new SourceRegistry();
    expect(() =>
      // @ts-expect-error deliberately malformed label
      r.register('v', { actor: 'user', label: 123 }),
    ).toThrow(SourceRegistryError);
    expect(() =>
      // @ts-expect-error deliberately malformed label
      r.register('v', { actor: 'user', label: 123 }),
    ).toThrow('actorMeta.label, if present, must be a string');
  });

  it('a string label is accepted (the other arm, for contrast — label rebuilt data-only)', () => {
    const r = new SourceRegistry();
    const source = r.register('v', { actor: 'user', label: 'Category picker' });
    expect(source.meta).toEqual({ actor: 'user', label: 'Category picker' });
  });
});

describe('SourceRegistry.size', () => {
  it('reports the count of distinct registered ids, growing only on NEW ids', () => {
    const r = new SourceRegistry();
    expect(r.size).toBe(0);
    r.register('A', { actor: 'user' });
    expect(r.size).toBe(1);
    r.register('B', { actor: 'agent' });
    expect(r.size).toBe(2);
    r.register('A', { actor: 'user' }); // idempotent re-register of the SAME id+meta
    expect(r.size).toBe(2);
  });
});
