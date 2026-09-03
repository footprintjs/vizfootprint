/**
 * The sheet's window on the memory engine: `sort` (a cached permutation,
 * stable, absent values at one end), `offset` + `limit` (a window with an
 * honest `start` and the full `count`), and `indices` (the source-order
 * index of each returned row — what a positional row identity is made of).
 * Both layouts answer byte-identically.
 */
import { describe, it, expect } from 'vitest';
import { memoryProvider } from './memoryProvider.js';
import { wasmProvider } from './wasmProvider.js';
import { serverProvider } from './serverProvider.js';
import { isRejection } from './types.js';
import type { Row, EvaluateResult } from './types.js';

const ROWS: Row[] = [
  { id: 'a', n: 3, s: 'pear', ok: true },
  { id: 'b', n: null, s: 'apple', ok: false },
  { id: 'c', n: 1, s: 'fig', ok: true },
  { id: 'd', n: 3, s: 'Apple', ok: false },
  { id: 'e', n: Number.NaN, s: 'date', ok: true },
  { id: 'f', n: 2, s: 'kiwi', ok: true },
];
const ids = (r: EvaluateResult | { reason: string }): string => (isRejection(r as never) ? 'rejected' : ((r as EvaluateResult).rows ?? []).map((x) => x['id']).join(''));

describe.each(['row', 'column'] as const)('memoryProvider.evaluate — sort, offset, indices (%s layout)', (layout) => {
  const p = () => memoryProvider(ROWS, { layout });

  it('declares it can sort, and sorts stably with absent values (null, undefined, NaN) last by default, first when asked, at the same end in either direction', async () => {
    const prov = p();
    expect(prov.capabilities.canSort).toBe(true);
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'n', dir: 'asc' }] }))).toBe('cfadbe'); // ties (a, d) keep source order; b, e absent last
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'n', dir: 'desc' }] }))).toBe('adfcbe'); // descending, absent still last
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'n', dir: 'asc', absent: 'first' }] }))).toBe('becfad');
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'n', dir: 'desc', absent: 'first' }] }))).toBe('beadfc');
  });

  it('sorts strings by their string order (equal strings keep source order), booleans false before true, and a second key breaks the first key\'s ties', async () => {
    const prov = p();
    const tied = memoryProvider([{ id: 'x', s: 'same' }, { id: 'y', s: 'same' }, { id: 'z', s: 'other' }], { layout });
    expect(ids(await tied.evaluate('data', null, { sort: [{ field: 's', dir: 'asc' }] }))).toBe('zxy');
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 's', dir: 'asc' }] }))).toBe('dbecfa'); // 'Apple' < 'apple' < 'date' < 'fig' < 'kiwi' < 'pear'
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'ok', dir: 'asc' }] }))).toBe('bdacef');
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'ok', dir: 'desc' }, { field: 'n', dir: 'desc' }] }))).toBe('afcedb'); // true first, then n desc within, absent e last among the trues
  });

  it('a mixed column has ONE total order — numbers, then dates, then booleans, then text — so 2, 10, "100" never loop; two infinities and two invalid dates tie and let the next key speak; a value that cannot say itself sorts last without throwing', async () => {
    const mixed = memoryProvider([{ id: 'a', v: 10 }, { id: 'b', v: '100' }, { id: 'c', v: 2 }, { id: 'd', v: new Date(2020, 0, 2) }, { id: 'e', v: true }, { id: 'f', v: new Date(2020, 0, 1) }, { id: 'g', v: false }, { id: 'h', v: 'Zed' }], { layout });
    expect(ids(await mixed.evaluate('data', null, { sort: [{ field: 'v', dir: 'asc' }] }))).toBe('cafdgebh'); // 2, 10 | Jan 1, Jan 2 | false, true | "100", "Zed"
    expect(ids(await mixed.evaluate('data', null, { sort: [{ field: 'v', dir: 'desc' }] }))).toBe('hbegdfac');
    const ties = memoryProvider([{ id: 'a', v: Infinity, t: 2 }, { id: 'b', v: Infinity, t: 1 }, { id: 'c', v: -Infinity, t: 2 }, { id: 'd', v: -Infinity, t: 1 }], { layout });
    expect(ids(await ties.evaluate('data', null, { sort: [{ field: 'v', dir: 'asc' }, { field: 't', dir: 'asc' }] }))).toBe('dcba'); // -∞ before ∞; the second key decides within each tie
    const beside = memoryProvider([{ id: 'a', v: 5 }, { id: 'b', v: 1 }, { id: 'c', v: Infinity }, { id: 'd', v: 3 }, { id: 'e', v: -Infinity }, { id: 'f', v: 2 }], { layout });
    expect(ids(await beside.evaluate('data', null, { sort: [{ field: 'v', dir: 'asc' }] }))).toBe('ebfdac'); // an infinity beside finite numbers never scrambles them
    expect(ids(await beside.evaluate('data', null, { sort: [{ field: 'v', dir: 'desc' }] }))).toBe('cadfbe');
    const dates = memoryProvider([{ id: 'a', v: new Date(2020, 0, 2) }, { id: 'b', v: new Date(NaN) }, { id: 'c', v: new Date(2020, 0, 1) }], { layout });
    expect(ids(await dates.evaluate('data', null, { sort: [{ field: 'v', dir: 'asc' }] }))).toBe('cab'); // an invalid date is absent: last
    expect(ids(await dates.evaluate('data', null, { sort: [{ field: 'v', dir: 'desc', absent: 'first' }] }))).toBe('bac');
    const mute = Object.create(null) as object;
    const throwing = { toString: () => { throw new Error('no words'); } };
    const odd = memoryProvider([{ id: 'a', v: mute }, { id: 'b', v: 'text' }, { id: 'c', v: throwing }, { id: 'd', v: 1 }, { id: 'e', v: { k: 1 } }], { layout });
    expect(ids(await odd.evaluate('data', null, { sort: [{ field: 'v', dir: 'asc' }] }))).toBe('debac'); // a plain object says "[object Object]" and sorts by that text; the two that cannot say themselves tie at the end, in source order
  });

  it('a window: offset + limit over the sorted matches, with start clamped to the count and the count untouched; indices come back when asked', async () => {
    const prov = p();
    const clause = { kind: 'point' as const, field: 'ok', value: true };
    const all = await prov.evaluate('data', clause, { sort: [{ field: 'n', dir: 'asc' }], offset: 0, indices: true });
    expect(all).toMatchObject({ count: 4, start: 0, indices: [2, 5, 0, 4] }); // c, f, a, e in source-order indices
    const page = await prov.evaluate('data', clause, { sort: [{ field: 'n', dir: 'asc' }], offset: 1, limit: 2, indices: true, columns: ['id'] });
    expect(page).toEqual({ sql: expect.any(String), count: 4, start: 1, rows: [{ id: 'f' }, { id: 'a' }], indices: [5, 0] });
    const past = await prov.evaluate('data', clause, { offset: 99, limit: 2 });
    expect(past).toMatchObject({ count: 4, start: 4, rows: [] });
    const noOffset = await prov.evaluate('data', clause, { limit: 1 });
    expect(noOffset).not.toHaveProperty('start'); // no offset asked = no start stated
    expect(noOffset).not.toHaveProperty('indices');
    expect(await prov.evaluate('data', clause, { mode: 'count', offset: 99, limit: 1 })).toEqual({ sql: expect.any(String), count: 4 }); // count mode: the window does not change the count
    expect(await prov.evaluate('data', clause, { mode: 'count', sort: [{ field: 'ghost', dir: 'asc' }] })).toMatchObject({ reason: 'unknown-column' }); // ...but a bad sort or window is refused the same way in both modes
    expect(await prov.evaluate('data', clause, { mode: 'count', offset: -1 })).toMatchObject({ reason: 'bad-window' });
    // a window collects only what it can show, and still counts everything
    const tiny = await prov.evaluate('data', null, { limit: 2, indices: true });
    expect(tiny).toMatchObject({ count: 6, indices: [0, 1] });
    expect(await prov.evaluate('data', null, { limit: 0 })).toMatchObject({ count: 6, rows: [] });
  });

  it('refuses a sort by a column the table lacks, and a negative or fractional offset or limit — never a silently clamped window', async () => {
    const prov = p();
    const ghost = await prov.evaluate('data', null, { sort: [{ field: 'ghost', dir: 'asc' }] });
    expect(ghost).toMatchObject({ reason: 'unknown-column', detail: 'table "data" has no column "ghost" to sort by' });
    for (const [bad, said] of [
      [{ offset: -1 }, 'offset must be a whole number at or above zero (got -1)'],
      [{ offset: 1.5 }, 'offset must be a whole number at or above zero (got 1.5)'],
      [{ limit: -2 }, 'limit must be a whole number at or above zero (got -2)'],
      [{ limit: 0.5 }, 'limit must be a whole number at or above zero (got 0.5)'],
    ] as const) {
      expect(await prov.evaluate('data', null, bad)).toMatchObject({ reason: 'bad-window', detail: said }); // only the wrong value is named
    }
  });

  it('the stub engines refuse a sort with the one sentence every engine keeps — never an answer in source order', async () => {
    for (const stub of [wasmProvider(), serverProvider()]) {
      expect(stub.capabilities.canSort).toBeUndefined();
      const r = await stub.evaluate('data', null, { sort: [{ field: 'x', dir: 'asc' }] });
      expect(r).toMatchObject({ reason: 'unsupported-sort', detail: `the ${stub.engine} engine cannot sort. Ask for this window without a sort` });
      expect((await stub.evaluate('data', null, { sort: [] })) as { reason: string }).not.toMatchObject({ reason: 'unsupported-sort' }); // an empty sort is no sort
    }
  });

  it('keeps the permutations a person comes back to: a hit is fresh again, the least recently used goes first, the cap is a dial', async () => {
    const prov = memoryProvider(ROWS, { layout, sortCache: 2 });
    const byN = [{ field: 'n', dir: 'asc' as const }];
    const byS = [{ field: 's', dir: 'asc' as const }];
    const byOk = [{ field: 'ok', dir: 'asc' as const }];
    expect(ids(await prov.evaluate('data', null, { sort: byN }))).toBe('cfadbe');
    expect(ids(await prov.evaluate('data', null, { sort: byS }))).toBe('dbecfa');
    expect(ids(await prov.evaluate('data', null, { sort: byN }))).toBe('cfadbe'); // a hit: byN is now the most recent, byS the least
    expect(ids(await prov.evaluate('data', null, { sort: byOk }))).toBe('bdacef'); // evicts byS, keeps byN
    expect(ids(await prov.evaluate('data', null, { sort: byN }))).toBe('cfadbe');
    expect(ids(await prov.evaluate('data', null, { sort: byS }))).toBe('dbecfa'); // rebuilt on demand, the same answer
  });

  it('caches the permutation per sort spec (a filter does not rebuild it), evicts the oldest past the cap, and forgets it when a column is materialised', async () => {
    const prov = p();
    const spec = [{ field: 'n', dir: 'asc' as const }];
    const first = await prov.evaluate('data', null, { sort: spec });
    const filtered = await prov.evaluate('data', { kind: 'point', field: 'ok', value: true }, { sort: spec });
    expect(ids(first)).toBe('cfadbe');
    expect(ids(filtered)).toBe('cfae'); // the same order, walked with the predicate
    // more specs than the cache keeps: the oldest is evicted and rebuilt on demand, answers unchanged
    const fields = ['s', 'ok', 'id', 'n'] as const;
    for (let i = 0; i < 12; i++) await prov.evaluate('data', null, { sort: [{ field: fields[i % 4]!, dir: i < 4 ? 'asc' : 'desc', absent: i < 8 ? 'last' : 'first' }] }); // 12 distinct specs: the cache holds 8, so the first ones are evicted
    expect(ids(await prov.evaluate('data', null, { sort: spec }))).toBe('cfadbe');
    // materialising a column drops the table's cached orders: a sort by the new column works, the old spec still answers
    const mat = await prov.materializeColumn('data', 'm', [6, 5, 4, 3, 2, 1]);
    expect(isRejection(mat)).toBe(false);
    expect(ids(await prov.evaluate('data', null, { sort: [{ field: 'm', dir: 'asc' }] }))).toBe('fedcba');
    expect(ids(await prov.evaluate('data', null, { sort: spec }))).toBe('cfadbe');
  });
});
