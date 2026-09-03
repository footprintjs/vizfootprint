import { describe, expect, it } from 'vitest';
import { deepFreeze } from './deepFreeze.js';

describe('deepFreeze', () => {
  it('returns primitives untouched (nothing to freeze)', () => {
    expect(deepFreeze(1)).toBe(1);
    expect(deepFreeze('a')).toBe('a');
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
    expect(deepFreeze(true)).toBe(true);
  });

  it('freezes a plain object and every plain object under it', () => {
    const o = deepFreeze({ a: 1, nested: { b: { c: 2 } } });
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.nested)).toBe(true);
    expect(Object.isFrozen(o.nested.b)).toBe(true);
    expect(() => {
      (o.nested.b as { c: number }).c = 99;
    }).toThrow(TypeError);
  });

  it('freezes arrays, including objects inside them', () => {
    const a = deepFreeze([{ x: 1 }, { x: 2 }]);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a[0])).toBe(true);
    expect(() => a.push({ x: 3 })).toThrow(TypeError);
  });

  it('freezes a null-prototype object (what a JSON `__proto__` key parses to)', () => {
    const bare = Object.create(null) as { smuggled?: string };
    bare.smuggled = 'yes';
    deepFreeze(bare);
    expect(Object.isFrozen(bare)).toBe(true);
  });

  it('leaves functions alone — a def carries author functions', () => {
    const fn = (): number => 1;
    expect(deepFreeze(fn)).toBe(fn);
    expect(Object.isFrozen(fn)).toBe(false);
  });

  it('leaves class instances alone — a live analysis module still writes to itself', () => {
    class Counter {
      n = 0;
    }
    const c = deepFreeze(new Counter());
    expect(Object.isFrozen(c)).toBe(false);
    c.n = 1;
    expect(c.n).toBe(1);
  });

  it('does not recurse INTO a class instance held by a frozen object (the stated limit)', () => {
    class Live {
      n = 0;
    }
    const held = new Live();
    const o = deepFreeze({ held });
    expect(Object.isFrozen(o)).toBe(true);
    held.n = 7; // documented: fields on a class instance are not protected
    expect(o.held.n).toBe(7);
  });

  it('stops at an already-frozen object (the cheap re-freeze path)', () => {
    const inner = { untouched: 1 };
    const outer = { inner };
    Object.freeze(outer); // shallow, on purpose
    deepFreeze(outer);
    expect(Object.isFrozen(inner)).toBe(false); // the documented short-circuit
  });

  it('survives a cycle', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    expect(() => deepFreeze(a)).not.toThrow();
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it('is idempotent', () => {
    const o = { a: { b: 1 } };
    expect(deepFreeze(deepFreeze(o))).toBe(o);
  });
});
