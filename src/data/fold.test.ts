/**
 * One pass, many recorders: every question answered from a single walk, each
 * answer typed by the recorder that gave it; empty walks answer honestly.
 */
import { describe, it, expect, vi } from 'vitest';
import { foldOnce, rowCount, total, extent, distinct, groupCount, numbers, columnar, columnTypes, keyedIndex, TypeTally } from './fold.js';
import type { Row, RowRecorder } from './index.js';

const rows: Row[] = [
  { id: 1, price: 40, category: 'Casual', ok: true, when: new Date('2026-01-01') },
  { id: 2, price: 160, category: 'Formal', ok: false, when: new Date('2026-02-01') },
  { id: 3, price: 'n/a', category: 'Formal', ok: null, when: null },
  { id: null, price: 220, category: null, ok: true, when: new Date('2026-03-01'), extra: 'late' },
];

describe('foldOnce', () => {
  it('walks the rows exactly once, stepping every recorder in order, and returns each recorder\'s answer under its key', () => {
    const steps: string[] = [];
    const spy = (id: string): RowRecorder<number> => ({ step: (_r, i) => void steps.push(`${id}${i}`), result: () => steps.length });
    const out = foldOnce(rows, { a: spy('a'), b: spy('b'), n: rowCount() });
    expect(steps).toEqual(['a0', 'b0', 'a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
    expect(out.n).toBe(4);
    expect(out.a).toBe(8);
    const none = foldOnce([], { n: rowCount(), e: extent('price') });
    expect(none).toEqual({ n: 0, e: null });
  });
  it('total and extent see finite numbers only, and say what they skipped', () => {
    const out = foldOnce(rows, { s: total('price'), e: extent('price'), missing: extent('nope') });
    expect(out.s).toEqual({ total: 420, counted: 3, skipped: 1 });
    expect(out.e).toEqual([40, 220]);
    expect(out.missing).toBeNull();
    // a value inside the running extent moves neither bound; a repeat neither
    expect(foldOnce([{ p: 5 }, { p: 1 }, { p: 3 }, { p: 9 }, { p: 9 }], { e: extent('p') }).e).toEqual([1, 9]);
  });
  it('distinct keeps first-seen order with one absence; groupCount keys by String(); numbers keeps every row as a number', () => {
    const out = foldOnce(rows, { d: distinct('category'), g: groupCount('category'), p: numbers('price') });
    expect(out.d).toEqual({ values: ['Casual', 'Formal', null], count: 3 });
    expect([...out.g.entries()]).toEqual([['Casual', 1], ['Formal', 2], ['null', 1]]);
    expect(out.p).toEqual({ values: [40, 160, Number.NaN, 220], notNumbers: 1 });
    // the coercion is kept (the analyses' contract) and COUNTED: a null, a boolean, an empty string and a Date all become numbers, none of them was one
    expect(foldOnce([{ v: 5 }, { v: null }, { v: true }, { v: '' }, { v: 'abc' }, { v: new Date(0) }, {}], { n: numbers('v') }).n).toEqual({ values: [5, 0, 1, 0, Number.NaN, 0, Number.NaN], notNumbers: 6 });
  });
  it('columnar builds every named column in walk order (a name given twice is one column; an absent name is a column of undefined); columnTypes answers the names given and only those, or discovers every column when given none', () => {
    const out = foldOnce(rows, { c: columnar(['id', 'price', 'id', 'nope']), t: columnTypes(['id', 'price', 'category', 'ok', 'when', 'ghost']) });
    expect(out.c).toEqual({ id: [1, 2, 3, null], price: [40, 160, 'n/a', 220], nope: [undefined, undefined, undefined, undefined] });
    expect(out.t).toEqual({ id: 'number', price: 'string', category: 'string', ok: 'boolean', when: 'date', ghost: 'unknown' }); // `extra`, met mid-walk, is not a column here
    expect(foldOnce(rows, { t: columnTypes() }).t['extra']).toBe('string'); // no names: discovered
    expect(foldOnce([{ a: null }], { t: columnTypes() }).t).toEqual({ a: 'unknown' });
    const tally = new TypeTally();
    for (const v of [1, 'x', new Date(), true, 2]) tally.see(v);
    expect(tally.type()).toBe('string'); // settled at the second value; the rest are not looked at
  });
  it('the fold refuses one instance under two keys, walks nothing for no recorders, and lets a throwing recorder abort', () => {
    const shared = rowCount();
    expect(() => foldOnce(rows, { x: shared, y: shared })).toThrow('foldOnce: one recorder instance per key');
    expect(foldOnce([{ a: 1 }], {})).toEqual({});
    expect(() => foldOnce(rows, { boom: { step: () => { throw new Error('bad row'); }, result: () => 0 } })).toThrow('bad row');
  });
  it('keyedIndex keeps the first row per key and counts the rest as unkeyed', () => {
    const out = foldOnce([...rows, { id: 1, price: 0 }], { k: keyedIndex('id') });
    expect([...out.k.map.keys()]).toEqual(['1', '2', '3']);
    expect(out.k.map.get('1')?.['price']).toBe(40);
    expect(out.k.unkeyed).toBe(2); // the null id and the repeated 1
  });
  it('a recorder\'s result may be read more than once and stays the same', () => {
    const n = rowCount();
    foldOnce(rows, { n });
    expect(n.result()).toBe(4);
    expect(n.result()).toBe(4);
    const spyResult = vi.fn(() => 1);
    foldOnce(rows, { r: { step: () => {}, result: spyResult } });
    expect(spyResult).toHaveBeenCalledTimes(1);
  });
});
