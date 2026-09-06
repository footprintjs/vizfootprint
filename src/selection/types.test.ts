import { describe, expect, it } from 'vitest';
import { RegisteredSource, SelectionPortError, SourceRegistry, SourceRegistryError, isRejection, reject } from './index.js';

describe('SourceRegistry — identity stability within a registry (law 4: one object per id, ever)', () => {
  it('returns the SAME object for the same id (identity is load-bearing)', () => {
    const r = new SourceRegistry();
    const a1 = r.register('viewA', { actor: 'user' });
    const a2 = r.register('viewA', { actor: 'user' });
    expect(a1).toBe(a2); // reference identity
  });

  it('returns DISTINCT objects for distinct ids', () => {
    const r = new SourceRegistry();
    const a = r.register('viewA', { actor: 'user' });
    const b = r.register('viewB', { actor: 'agent' });
    expect(a).not.toBe(b);
  });

  it('throws on conflicting re-registration (no silent identity fork)', () => {
    const r = new SourceRegistry();
    r.register('viewA', { actor: 'user' });
    expect(() => r.register('viewA', { actor: 'agent' })).toThrow(SourceRegistryError);
    r.register('viewB', { actor: 'user', label: 'one' });
    expect(() => r.register('viewB', { actor: 'user', label: 'two' })).toThrow(/already registered with different actorMeta/);
  });

  it('validates viewId and actorMeta', () => {
    const r = new SourceRegistry();
    expect(() => r.register('', { actor: 'user' })).toThrow(SourceRegistryError);
    // @ts-expect-error bad actor
    expect(() => r.register('v', { actor: 'robot' })).toThrow(SourceRegistryError);
  });

  it('a registered source is a PLAIN class carrying only its id and meta — no engine base class', () => {
    const r = new SourceRegistry();
    const a = r.register('viewA', { actor: 'user', label: 'Category picker' });
    expect(a).toBeInstanceOf(RegisteredSource);
    expect(Object.getPrototypeOf(RegisteredSource.prototype)).toBe(Object.prototype);
    expect(a.viewId).toBe('viewA');
    expect(a.meta).toEqual({ actor: 'user', label: 'Category picker' });
  });
});

describe('SourceRegistry — reconstruction across registries (the replay contract)', () => {
  it('fresh registry rebuilds fresh identity for the same ids', () => {
    const ids = ['viewA', 'viewB'];
    const meta = { viewA: { actor: 'user' as const }, viewB: { actor: 'agent' as const } };

    const r1 = new SourceRegistry();
    const a1 = r1.register('viewA', meta.viewA);
    r1.register('viewB', meta.viewB);

    // serialize just the ids + meta (identity is NOT serialized)
    const wire = ids.map((id) => ({ id, meta: r1.require(id).meta }));

    const r2 = new SourceRegistry();
    for (const w of wire) r2.register(w.id, w.meta);
    const a2 = r2.require('viewA');

    expect(a2).not.toBe(a1); // different object across registries
    expect(a2.viewId).toBe(a1.viewId); // same stable key
    expect(a2.meta).toEqual(a1.meta); // same serializable meta
    expect(r2.ids()).toEqual(ids);
  });

  it('require throws for an unregistered id; get/has answer without throwing', () => {
    const r = new SourceRegistry();
    expect(() => r.require('nope')).toThrow(SourceRegistryError);
    expect(r.get('nope')).toBeUndefined();
    expect(r.has('nope')).toBe(false);
    const a = r.register('yes', { actor: 'system' });
    expect(r.get('yes')).toBe(a);
    expect(r.has('yes')).toBe(true);
  });
});

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

describe('SourceRegistry.register — `does` rides the rebuilt meta and counts in the conflict check', () => {
  it('carries a string `does` through (what the record stamps and the wire parser accepts back), and refuses a non-string one', () => {
    const r = new SourceRegistry();
    const source = r.register('v', { actor: 'user', does: 'filters by category' });
    expect(source.meta).toEqual({ actor: 'user', does: 'filters by category' });
    expect(r.register('w', { actor: 'user', label: 'Bar', does: 'picks a bar' }).meta).toEqual({ actor: 'user', label: 'Bar', does: 'picks a bar' });
    // @ts-expect-error deliberately malformed does
    expect(() => r.register('x', { actor: 'user', does: 7 })).toThrow('actorMeta.does, if present, must be a string');
  });

  it('a re-registration differing only in `does` throws — identity never silently forks on the routing text either', () => {
    const r = new SourceRegistry();
    const first = r.register('v', { actor: 'user', does: 'filters by category' });
    expect(r.register('v', { actor: 'user', does: 'filters by category' })).toBe(first);
    expect(() => r.register('v', { actor: 'user', does: 'something else' })).toThrow(SourceRegistryError);
    expect(() => r.register('v', { actor: 'user' })).toThrow(/different actorMeta/);
  });
});

describe('SelectionPortError — the one typed throw for a clause a port did not mint, on every engine', () => {
  it('reads as the rejection\'s detail, or its bare reason when there is none, and carries the rejection', () => {
    const detailed = new SelectionPortError(reject('builtin', 'update', 'unknown-source', 'why'));
    expect(detailed.message).toBe('why');
    expect(detailed.name).toBe('SelectionPortError');
    expect(detailed.rejection).toEqual({ ok: false, engine: 'builtin', operation: 'update', reason: 'unknown-source', detail: 'why' });
    expect(new SelectionPortError(reject('mosaic', 'skip', 'unknown-source')).message).toBe('unknown-source');
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

describe('reject / isRejection — the one funnel every port answers a problem through', () => {
  it('builds the typed shape, with detail only when given', () => {
    expect(reject('builtin', 'clause', 'unsupported-shape')).toEqual({
      ok: false,
      engine: 'builtin',
      operation: 'clause',
      reason: 'unsupported-shape',
    });
    expect(reject('mosaic', 'native', 'no-live-selection', 'why')).toEqual({
      ok: false,
      engine: 'mosaic',
      operation: 'native',
      reason: 'no-live-selection',
      detail: 'why',
    });
  });

  it('isRejection recognises exactly the { ok: false } shape', () => {
    expect(isRejection(reject('builtin', 'update', 'unknown-source'))).toBe(true);
    expect(isRejection({ ok: true })).toBe(false);
    expect(isRejection(null)).toBe(false);
    expect(isRejection('no')).toBe(false);
    expect(isRejection({ kind: 'point' })).toBe(false);
  });
});
