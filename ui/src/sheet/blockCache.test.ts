/**
 * The block cache: overlapping scroll windows cost ONE fetch, the blocks wear
 * the stamp of the ANSWER that filled them (so a host one poll behind is not
 * refused), answers apply in REQUEST order, and the least recently served
 * block is the one that goes.
 */
import { describe, expect, it, vi } from 'vitest';
import { blockKey, blockRange, createBlockCache, questionKey, sliceWindow, splitBlocks, SHEET_BLOCK_ROWS, SHEET_MAX_BLOCKS } from './blockCache.js';
import type { SheetRefusal, SheetWindow } from './types.js';

const KEY = { table: 'cells', viewId: 'sheet', version: 'v1', cursor: 'c1' };

/** One answer the way an engine gives it: rows `start … start+size`, of `count` in all. */
function windowOf(start: number, size: number, count: number, stamp: { version?: string | null; cursor?: string | null; key?: string } = {}): SheetWindow {
  const n = Math.max(0, Math.min(size, count - start));
  return {
    ok: true,
    columns: ['id', 'cases'],
    rows: Array.from({ length: n }, (_, i) => ({ id: `r${String(start + i)}`, cases: start + i })),
    rowIds: Array.from({ length: n }, (_, i) => `r${String(start + i)}`),
    positional: false,
    ...(stamp.key !== undefined ? { key: stamp.key } : {}),
    count,
    start,
    version: stamp.version === undefined ? 'v1' : stamp.version,
    cursor: stamp.cursor === undefined ? 'c1' : stamp.cursor,
  };
}

/** Narrow an answer the test expects to be a window. */
function ok(answer: SheetWindow | SheetRefusal | null): SheetWindow {
  if (answer === null || !answer.ok) throw new Error(`expected a window, got ${JSON.stringify(answer)}`);
  return answer;
}

const never = (): never => {
  throw new Error('the cache asked when it should have been a hit');
};

describe('the two keys', () => {
  it('the QUESTION is which rows in what order; the stamp rides beside it, not inside it', () => {
    expect(questionKey(KEY)).toBe(questionKey({ ...KEY, version: 'v9', cursor: 'c9' }));
    expect(questionKey({ ...KEY, sort: [{ field: 'cases', dir: 'desc' }] })).not.toBe(questionKey(KEY));
    expect(questionKey({ ...KEY, viewId: 'other' })).not.toBe(questionKey(KEY));
    expect(questionKey({ version: null, cursor: null })).toBe(questionKey({}));
    // JSON, so a column named `a,b` can never collide with a delimiter-joined pair
    expect(questionKey({ ...KEY, columns: ['a,b'] })).not.toBe(questionKey({ ...KEY, columns: ['a', 'b'] }));
    // the whole ask — question AND stamp — is what a host uses to tell two asks apart
    expect(blockKey(KEY)).toBe(blockKey({ ...KEY }));
    expect(blockKey({ ...KEY, cursor: 'c2' })).not.toBe(blockKey(KEY));
    expect(blockKey({ version: null, cursor: null })).toBe(blockKey({}));
  });

  it('blockRange names the blocks a window touches, and sliceWindow cuts a caller\'s part out of one answer', () => {
    expect(blockRange(0, 40, 100)).toEqual({ first: 0, last: 0 });
    expect(blockRange(90, 40, 100)).toEqual({ first: 0, last: 1 });
    expect(blockRange(200, 100, 100)).toEqual({ first: 2, last: 2 });
    const cut = sliceWindow(windowOf(0, 200, 500), 30, 5);
    expect(cut.start).toBe(30);
    expect(cut.rows.map((r) => r['id'])).toEqual(['r30', 'r31', 'r32', 'r33', 'r34']);
    expect(cut.rowIds).toEqual(['r30', 'r31', 'r32', 'r33', 'r34']);
  });
});

describe('splitBlocks keeps only the complete blocks', () => {
  it('a full block and the table\'s short tail are kept; a half-filled block is not (it would serve a gap that is not in the data)', () => {
    const full = splitBlocks(windowOf(0, 250, 250), 100);
    expect([...full.keys()]).toEqual([0, 1, 2]);
    expect(full.get(2)).toHaveLength(50); // the tail is complete because the count says so
    const short: SheetWindow = { ...windowOf(0, 100, 500), rows: windowOf(0, 40, 500).rows, rowIds: windowOf(0, 40, 500).rowIds };
    expect([...splitBlocks(short, 100).keys()]).toEqual([]); // 40 of 100 — never held
  });

  it('an empty answer past the end of an empty table is still a complete block', () => {
    expect([...splitBlocks(windowOf(0, 100, 0), 100).keys()]).toEqual([0]);
  });

  it('a wire that carried fewer identities than rows gives the unnamed rows an empty id — never another row\'s', () => {
    const answer: SheetWindow = { ...windowOf(0, 3, 3), rowIds: ['r0'] };
    expect(splitBlocks(answer, 100).get(0)?.map((e) => e.id)).toEqual(['r0', '', '']);
  });
});

describe('the cache', () => {
  it('N overlapping windows over the same blocks cost ONE fetch — the minimum', async () => {
    const fetch = vi.fn(async (offset: number, limit: number) => windowOf(offset, limit, 900, { key: 'id' }));
    const cache = createBlockCache({ blockRows: 100 });
    const first = await cache.window(KEY, 0, 30, fetch);
    expect(ok(first).rows).toHaveLength(30);
    expect(ok(first).key).toBe('id'); // the key the window named rides back out of the blocks
    for (let scroll = 1; scroll <= 20; scroll++) await cache.window(KEY, scroll * 3, 30, fetch);
    expect(fetch).toHaveBeenCalledTimes(1); // every one of those windows lives in block 0
    expect(fetch).toHaveBeenCalledWith(0, 100);
    expect(cache.size).toBe(1);
    // crossing into block 1 is exactly one more fetch, of one more block
    await cache.window(KEY, 95, 30, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(0, 200);
  });

  it('serves the rows themselves out of the blocks, clipped at the count', async () => {
    const fetch = vi.fn(async (offset: number, limit: number) => windowOf(offset, limit, 120));
    const cache = createBlockCache({ blockRows: 100 });
    await cache.window(KEY, 0, 30, fetch);
    const tail = await cache.window(KEY, 100, 30, fetch); // block 1 — a fetch
    expect(ok(tail).rows).toHaveLength(20); // 120 rows in all: the window stops at the count
    const back = await cache.window(KEY, 10, 5, fetch);
    expect(ok(back).rows.map((r) => r['id'])).toEqual(['r10', 'r11', 'r12', 'r13', 'r14']);
    expect(ok(back).start).toBe(10);
    expect(ok(back).key).toBeUndefined(); // a positional-ish window names no key, and none is invented
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a new QUESTION forgets the blocks; a moved stamp only asks again', async () => {
    const fetch = vi.fn(async (offset: number, limit: number) => windowOf(offset, limit, 900));
    const cache = createBlockCache({ blockRows: 100 });
    await cache.window(KEY, 0, 30, fetch);
    expect(cache.size).toBe(1);
    await cache.window({ ...KEY, sort: [{ field: 'cases', dir: 'asc' }] }, 0, 30, fetch); // other rows, other order
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it('a host one poll behind is NOT refused: the answer\'s own stamp is what the blocks wear, and the caught-up ask is a hit', async () => {
    const cache = createBlockCache({ blockRows: 100 });
    // the host still believes it is at c1; the engine answers from c2
    const late = await cache.window({ ...KEY, cursor: 'c1' }, 0, 30, async (o, l) => windowOf(o, l, 900, { cursor: 'c2' }));
    expect(ok(late).cursor).toBe('c2'); // applied, and the readout will say c2
    expect(ok(late).rows).toHaveLength(30);
    // the prop catches up: the same question at the stamp the blocks wear is served without asking
    const caught = await cache.window({ ...KEY, cursor: 'c2' }, 0, 30, never);
    expect(ok(caught).cursor).toBe('c2');
    // and a genuinely moved stamp asks again and replaces the blocks
    const moved = await cache.window({ ...KEY, cursor: 'c3' }, 0, 30, async (o, l) => windowOf(o, l, 400, { cursor: 'c3' }));
    expect(ok(moved).cursor).toBe('c3');
    expect(ok(moved).count).toBe(400);
    expect(cache.size).toBe(1); // the c2 blocks are gone: two versions never share a grid
  });

  it('a version the host has not heard about yet behaves the same way', async () => {
    const cache = createBlockCache({ blockRows: 100 });
    const late = await cache.window({ ...KEY, version: 'v1' }, 0, 30, async (o, l) => windowOf(o, l, 900, { version: 'v2' }));
    expect(ok(late).version).toBe('v2');
    expect(ok(await cache.window({ ...KEY, version: 'v2' }, 0, 30, never)).version).toBe('v2');
  });

  it('answers apply in REQUEST order: an earlier ask that lands late is dropped silently', async () => {
    const cache = createBlockCache({ blockRows: 100 });
    let releaseFirst: ((w: SheetWindow) => void) | null = null;
    const first = cache.window({ ...KEY, cursor: 'c1' }, 0, 30, () => new Promise<SheetWindow>((resolve) => { releaseFirst = resolve; }));
    await vi.waitFor(() => expect(releaseFirst).not.toBeNull());
    const second = await cache.window({ ...KEY, cursor: 'c2' }, 0, 30, async (o, l) => windowOf(o, l, 900, { cursor: 'c2' }));
    expect(ok(second).cursor).toBe('c2');
    releaseFirst!(windowOf(0, 100, 500, { cursor: 'c1' }));
    expect(await first).toBeNull(); // nothing to show, nothing to say
    expect(cache.size).toBe(1);
    expect(ok(await cache.window({ ...KEY, cursor: 'c2' }, 0, 30, never)).count).toBe(900); // the blocks still speak c2
  });

  it('an answer to a QUESTION the cache has left is dropped — never written into the new question\'s blocks', async () => {
    const cache = createBlockCache({ blockRows: 100 });
    let releaseOld: ((w: SheetWindow) => void) | null = null;
    const old = cache.window(KEY, 0, 30, () => new Promise<SheetWindow>((resolve) => { releaseOld = resolve; }));
    await vi.waitFor(() => expect(releaseOld).not.toBeNull());
    // a different question entirely: other rows, in another order
    const sorted = { ...KEY, sort: [{ field: 'cases' as const, dir: 'asc' as const }] };
    expect(ok(await cache.window(sorted, 0, 30, async (o, l) => windowOf(o, l, 42))).count).toBe(42);
    releaseOld!(windowOf(0, 100, 900));
    expect(await old).toBeNull(); // the unsorted answer never joins the sorted blocks
    expect(ok(await cache.window(sorted, 0, 30, never)).count).toBe(42);
    expect(cache.size).toBe(1);
  });

  it('a refusal passes straight through and is never cached — the engine\'s own version-moved included', async () => {
    const refusal: SheetRefusal = { ok: false, reason: 'version-moved', rejected: 'table "cells" was refreshed while the window was read — ask again' };
    const fetch = vi.fn(async () => refusal);
    const cache = createBlockCache({ blockRows: 100 });
    expect(await cache.window(KEY, 0, 30, fetch)).toBe(refusal);
    expect(cache.size).toBe(0);
    await cache.window(KEY, 0, 30, fetch);
    expect(fetch).toHaveBeenCalledTimes(2); // a refusal is not an answer to remember
  });

  it('an incomplete block is refetched rather than served short', async () => {
    const fetch = vi.fn(async (offset: number) => ({ ...windowOf(offset, 100, 500), rows: windowOf(offset, 40, 500).rows, rowIds: windowOf(offset, 40, 500).rowIds }));
    const cache = createBlockCache({ blockRows: 100 });
    expect(ok(await cache.window(KEY, 0, 30, fetch)).rows).toHaveLength(30); // the answer is sliced and shown
    expect(cache.size).toBe(0); // but a 40-of-100 block is never held
    await cache.window(KEY, 0, 30, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('holds at most maxBlocks and drops the LEAST RECENTLY SERVED — a block being read is never the one that goes', async () => {
    const fetch = vi.fn(async (offset: number, limit: number) => windowOf(offset, limit, 100_000));
    const cache = createBlockCache({ blockRows: 100, maxBlocks: 3 });
    for (let b = 0; b < 3; b++) await cache.window(KEY, b * 100, 30, fetch);
    expect(cache.size).toBe(3);
    await cache.window(KEY, 0, 30, never); // block 0 is read again: it is now the newest
    await cache.window(KEY, 300, 30, fetch); // block 3 arrives — block 1, the oldest UNREAD one, goes
    expect(cache.size).toBe(3);
    expect(ok(await cache.window(KEY, 0, 30, never)).rows).toHaveLength(30); // block 0 survived
    await cache.window(KEY, 100, 30, fetch); // block 1 was the one dropped
    expect(fetch).toHaveBeenCalledTimes(5);
    // a window spanning two blocks touches both
    await cache.window(KEY, 290, 20, fetch);
    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it('the placeholders are the documented ones', () => {
    expect(SHEET_BLOCK_ROWS).toBe(100);
    expect(SHEET_MAX_BLOCKS).toBe(50);
    expect(createBlockCache().size).toBe(0);
  });
});
