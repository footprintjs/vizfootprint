import { describe, expect, it } from 'vitest';
import type { CommitRecord } from '../log/index.js';
import { PROSE_VIEW_PREFIX, foldDiff, foldStateAt, keyOf, keysOf, planBringOver, planUndo } from './index.js';

function rec(id: string, parent: string | null, over: Partial<CommitRecord> = {}): CommitRecord {
  return { id, parent, viewId: 'bar', actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Formal', clientViewIds: ['bar'], predicateSQL: '', cause: { requestedBy: 'user', computedBy: 'user' }, ts: 0, ...over };
}
const words = (id: string, parent: string | null, slot: string, value: unknown) => rec(id, parent, { viewId: `${PROSE_VIEW_PREFIX}map`, field: slot, value });

describe('the prose namespace in the log', () => {
  it('keys per (view, slot); folds last-wins; null drops the key so the def shows through', () => {
    const a = words('a', null, 'title', { text: 'A', author: { kind: 'human' } });
    expect(keyOf(a)).toBe('prose:map:title');
    expect(keysOf(a)).toEqual(['prose:map:title']);
    const b = words('b', 'a', 'title', { text: 'B', author: { kind: 'human' } });
    const c = words('c', 'b', 'caption', { text: 'C', author: { kind: 'human' } });
    const gone = words('d', 'c', 'title', null);
    expect(foldStateAt([a, b, c, gone], 'c').get('prose:map:title')).toEqual({ kind: 'prose', viewId: 'map', slot: 'title', record: { text: 'B', author: { kind: 'human' } }, commitId: 'b' });
    expect(foldStateAt([a, b, c, gone], 'd').has('prose:map:title')).toBe(false);
    expect(foldStateAt([a, b, c, gone], 'd').get('prose:map:caption')!.kind).toBe('prose');
  });
  it('undo restores the prior words or null; bring-over re-lands the same record (or the same un-declare)', () => {
    const a = words('a', null, 'title', { text: 'A', author: { kind: 'human' } });
    const b = words('b', 'a', 'title', { text: 'B', author: { kind: 'human' } });
    const gone = words('d', 'b', 'title', null);
    expect(planUndo([a, b], 'b', 'b')).toMatchObject({ ok: true, recipe: { apply: 'prose', viewId: 'map', slot: 'title', record: { text: 'A', author: { kind: 'human' } } } });
    expect(planUndo([a, b], 'a', 'b')).toMatchObject({ ok: true, recipe: { apply: 'prose', viewId: 'map', slot: 'title', record: null } });
    expect(planBringOver([rec('root', null), a, b], 'b', 'root')).toMatchObject({ ok: true, recipe: { apply: 'prose', viewId: 'map', slot: 'title', record: { text: 'B', author: { kind: 'human' } } } });
    expect(planBringOver([rec('root', null), a, b, gone], 'd', 'root')).toMatchObject({ ok: true, recipe: { apply: 'prose', viewId: 'map', slot: 'title', record: null } });
  });
});

describe('compare sees the words', () => {
  it('two paths that said different things differ by the slot', () => {
    const root = rec('root', null);
    const a = words('a', 'root', 'title', { text: 'A', author: { kind: 'human' } });
    const b = words('b', 'root', 'title', { text: 'B', author: { kind: 'human' } });
    const diff = foldDiff([root, a, b], 'a', 'b');
    expect(JSON.stringify(diff)).toContain('prose');
  });
});
