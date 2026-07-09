import { describe, it, expect } from 'vitest';
import { SourceRegistry, SourceRegistryError } from './index.js';

describe('SourceRegistry — identity stability within a registry', () => {
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
  });

  it('validates viewId and actorMeta', () => {
    const r = new SourceRegistry();
    expect(() => r.register('', { actor: 'user' })).toThrow(SourceRegistryError);
    // @ts-expect-error bad actor
    expect(() => r.register('v', { actor: 'robot' })).toThrow(SourceRegistryError);
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

  it('require throws for an unregistered id', () => {
    const r = new SourceRegistry();
    expect(() => r.require('nope')).toThrow(SourceRegistryError);
    expect(r.get('nope')).toBeUndefined();
    expect(r.has('nope')).toBe(false);
  });
});
