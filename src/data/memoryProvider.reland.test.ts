/**
 * memoryProvider.reland.test.ts — THE MEMORY ENGINE'S RELAND STRATEGY: today's
 * JavaScript diff moved behind the port, in place, with every cache dropped.
 *
 * The law (src/data/README.md, "A refresh is computed where the rows live"): a
 * refresh is one act with one answer, and the engine that holds the rows
 * computes it. For this engine the answer IS `deltaByKey` over its own rows and
 * the new ones — pinned here as an equality, not a resemblance — and the rows
 * are swapped INSIDE the same provider object, so nothing holding a reference
 * to it goes stale.
 */
import { describe, it, expect } from 'vitest';
import { memoryProvider, type Layout } from './memoryProvider.js';
import { deltaByKey } from './delta.js';
import { isRejection } from './types.js';
import type { Row } from './types.js';

const BEFORE: Row[] = [
  { id: 1, v: 'a', n: 10 },
  { id: 2, v: 'b', n: 20 },
  { id: 3, v: 'c', n: 30 },
  { v: 'no key', n: 0 },
  { id: null, v: 'null key', n: 0 },
];
const AFTER: Row[] = [
  { id: 1, v: 'a', n: 10 },
  { id: 2, v: 'B', n: 20 },
  { id: 4, v: 'd', n: 40 },
  { id: 4, v: 'dup', n: 41 },
];

/** The reland's answer, or a failure that says so. */
async function relanded(provider: ReturnType<typeof memoryProvider>, table: string, rows: readonly Row[], key?: string) {
  const answer = await provider.replaceRows!(table, rows, key === undefined ? {} : { key });
  if (isRejection(answer)) throw new Error(`refused: ${JSON.stringify(answer)}`);
  return answer;
}

describe.each<Layout>(['row', 'column'])('replaceRows on the %s layout', (layout) => {
  it('answers EXACTLY what deltaByKey answers over the same rows — it is deltaByKey — and declares that it can', async () => {
    const provider = memoryProvider(BEFORE, { layout, tableName: 't' });
    expect(provider.capabilities.canReland).toBe(true);
    const answer = await relanded(provider, 't', AFTER, 'id');
    expect(answer.delta).toEqual(deltaByKey(BEFORE, AFTER, 'id'));
    expect(answer.delta).toEqual({ keyed: true, key: 'id', added: 1, updated: 1, removed: 1, sample: { added: ['4'], updated: ['2'], removed: ['3'] }, unkeyed: 3 });
    expect(answer.columns).toEqual([
      { name: 'id', type: 'number' },
      { name: 'v', type: 'string' },
      { name: 'n', type: 'number' },
    ]);
  });

  it('without a key the table is replaced and nothing is guessed; with a key that names no new column it says so', async () => {
    const provider = memoryProvider(BEFORE, { layout, tableName: 't' });
    expect((await relanded(provider, 't', AFTER)).delta).toEqual({ keyed: false, replaced: 4 });
    expect((await relanded(provider, 't', [{ v: 'z' }], 'id')).delta).toEqual({ keyed: false, replaced: 1, keyAbsent: 'id' });
  });

  it('the rows move IN PLACE: the same provider object answers the new rows, in the same layout, and the old ones are gone', async () => {
    const provider = memoryProvider(BEFORE, { layout, tableName: 't' });
    await relanded(provider, 't', AFTER, 'id');
    const read = await provider.evaluate('t', null, { mode: 'rows' });
    if (isRejection(read)) throw new Error(JSON.stringify(read));
    expect(read.rows).toEqual(AFTER);
    expect(read.count).toBe(4);
    // a memory table's rows are CLONED on the way in: the caller's own objects are never this store's
    expect(read.rows?.[0]).not.toBe(AFTER[0]);
  });

  it('a SORTED window after the replace is over the NEW rows — the permutation cached over the old ones is dropped, even when the row count did not change', async () => {
    const provider = memoryProvider([{ id: 1, n: 1 }, { id: 2, n: 2 }, { id: 3, n: 3 }], { layout, tableName: 't' });
    const sort = [{ field: 'n', dir: 'desc' as const }];
    const first = await provider.evaluate('t', null, { sort, limit: 3 });
    if (isRejection(first)) throw new Error(JSON.stringify(first));
    expect(first.rows?.map((r) => r['id'])).toEqual([3, 2, 1]); // the permutation is now cached under this sort
    // the same three keys, the same count, the values REVERSED — the one refresh the row-count check cannot see
    await relanded(provider, 't', [{ id: 1, n: 3 }, { id: 2, n: 2 }, { id: 3, n: 1 }], 'id');
    const again = await provider.evaluate('t', null, { sort, limit: 3 });
    if (isRejection(again)) throw new Error(JSON.stringify(again));
    expect(again.rows?.map((r) => r['id'])).toEqual([1, 2, 3]);
  });

  it('a column the new rows ADD is a change to every row that carries it; the schema answered is the new one', async () => {
    const provider = memoryProvider([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], { layout, tableName: 't' });
    const wider: Row[] = [{ id: 1, v: 'a', extra: true }, { id: 2, v: 'b', extra: false }];
    const answer = await relanded(provider, 't', wider, 'id');
    expect(answer.delta).toEqual(deltaByKey([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], wider, 'id'));
    expect(answer.delta).toMatchObject({ added: 0, updated: 2, removed: 0 });
    expect(answer.columns.map((c) => c.name)).toEqual(['id', 'v', 'extra']);
    expect((await provider.columns('t')) as unknown).toEqual(answer.columns);
  });

  it('a column the new rows DROP — declared or materialised — is stripped before the compare, never read as every row updated', async () => {
    const provider = memoryProvider([{ id: 1, v: 'a', gone: 1 }, { id: 2, v: 'b', gone: 2 }], { layout, tableName: 't' });
    const landed = await provider.materializeColumn('t', 'cluster', ['x', 'y']);
    expect(landed).toEqual({ ok: true });
    const narrower: Row[] = [{ id: 1, v: 'a' }, { id: 2, v: 'B' }];
    const answer = await relanded(provider, 't', narrower, 'id');
    // only the row whose REMAINING bytes changed is updated; the two lost columns say nothing
    expect(answer.delta).toMatchObject({ added: 0, updated: 1, removed: 0, sample: { updated: ['2'] } });
    expect(answer.columns.map((c) => c.name)).toEqual(['id', 'v']);
  });

  it('a table nobody declared is refused in this engine\'s own words, and the rows it holds are untouched', async () => {
    const provider = memoryProvider(BEFORE, { layout, tableName: 't' });
    expect(await provider.replaceRows!('ghost', AFTER, { key: 'id' })).toEqual({ ok: false, engine: 'memory', operation: 'replaceRows', reason: 'unknown-table', detail: 'no such table "ghost"' });
    const read = await provider.evaluate('t', null, { mode: 'count' });
    expect(isRejection(read) ? -1 : read.count).toBe(5);
  });

  it('an EMPTY new version removes every key and keeps nothing', async () => {
    const provider = memoryProvider(BEFORE, { layout, tableName: 't' });
    const answer = await relanded(provider, 't', [], 'id');
    expect(answer.delta).toEqual(deltaByKey(BEFORE, [], 'id'));
    expect(answer.delta).toMatchObject({ keyed: true, added: 0, updated: 0, removed: 3, sample: { removed: ['1', '2', '3'] }, unkeyed: 2 });
    const read = await provider.evaluate('t', null, { mode: 'count' });
    expect(isRejection(read) ? -1 : read.count).toBe(0);
  });
});
