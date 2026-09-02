/**
 * The binding-set commit in the branches layer: one record, one key per
 * channel — fold, keys, undo, bring-over and conflicts all see every channel.
 */
import { describe, expect, it } from 'vitest';
import type { CommitRecord } from '../log/index.js';
import { ENCODING_SET_FIELD, encodingSetOf, foldStateAt, isEncodingSet, keyOf, keysOf, planBringOver, planUndo } from './index.js';

function rec(id: string, parent: string | null, over: Partial<CommitRecord> = {}): CommitRecord {
  return {
    id,
    parent,
    viewId: 'bar',
    actorMeta: { actor: 'user' },
    kind: 'point',
    field: 'category',
    value: 'Formal',
    clientViewIds: ['bar'],
    predicateSQL: '',
    cause: { requestedBy: 'user', computedBy: 'user' },
    ts: 0,
    ...over,
  };
}
const single = (id: string, parent: string | null, channel: string, field: string) => rec(id, parent, { viewId: 'encoding:scatter', field: channel, value: field });
const set = (id: string, parent: string | null, bindings: Record<string, string>) => rec(id, parent, { viewId: 'encoding:scatter', field: ENCODING_SET_FIELD, value: bindings });

describe('the set record', () => {
  it('is recognized by its marker; its map is read defensively', () => {
    expect(isEncodingSet(set('a', null, { x: 'p' }))).toBe(true);
    expect(isEncodingSet(single('a', null, 'x', 'p'))).toBe(false);
    expect(isEncodingSet(rec('a', null, { field: '*' }))).toBe(false); // the marker only means it under encoding:
    expect(encodingSetOf(set('a', null, { x: 'p', y: 'r' }))).toEqual({ x: 'p', y: 'r' });
    expect(encodingSetOf(rec('a', null, { value: 'p' }))).toEqual({});
    expect(encodingSetOf(rec('a', null, { value: ['p'] }))).toEqual({});
    expect(encodingSetOf(rec('a', null, { value: { x: 'p', y: 2 } }))).toEqual({ x: 'p' });
  });
  it('touches one key per channel; keyOf still names its own compound key; inert commits touch none', () => {
    const s = set('a', null, { x: 'p', y: 'r' });
    expect(keysOf(s)).toEqual(['encoding:scatter:x', 'encoding:scatter:y']);
    expect(keyOf(s)).toBe('encoding:scatter:*');
    expect(keysOf(single('b', null, 'x', 'p'))).toEqual(['encoding:scatter:x']);
    expect(keysOf(rec('c', null, { viewId: 'annotation:user' }))).toEqual([]);
  });
  it('folds into a per-channel entry each, all pointing at the one commit; a later single rebinding overrides its channel only', () => {
    const records = [set('a', null, { x: 'p', y: 'r' }), single('b', 'a', 'x', 'q')];
    const at = foldStateAt(records, 'b');
    expect(at.get('encoding:scatter:x')).toEqual({ kind: 'encoding', viewId: 'scatter', channel: 'x', field: 'q', commitId: 'b' });
    expect(at.get('encoding:scatter:y')).toEqual({ kind: 'encoding', viewId: 'scatter', channel: 'y', field: 'r', commitId: 'a' });
  });
});

describe('plans over a set', () => {
  it('undo restores every channel to its value at the parent — prior binding or null (the declared initial)', () => {
    const records = [single('a', null, 'y', 'z'), set('b', 'a', { x: 'p', y: 'r' })];
    const plan = planUndo(records, 'b', 'b');
    expect(plan.ok && plan.recipe).toEqual({ apply: 'encoding-set', viewId: 'scatter', bindings: { x: null, y: 'z' } });
  });
  it('bring-over re-lands the same set, and a commit on the target path touching ANY of its channels is a conflict', () => {
    const records = [rec('root', null), set('a', 'root', { x: 'p', y: 'r' }), single('b', 'root', 'y', 'z'), single('c', 'b', 'color', 'k')];
    const plan = planBringOver(records, 'a', 'c');
    expect(plan.ok && plan.recipe).toEqual({ apply: 'encoding-set', viewId: 'scatter', bindings: { x: 'p', y: 'r' } });
    expect(plan.ok && plan.conflicts).toEqual(['b']);
    // and a set on the target path conflicts with a single-channel source that hits one of its channels
    const reverse = planBringOver([rec('root', null), single('s', 'root', 'y', 'q'), set('t', 'root', { x: 'p', y: 'r' })], 's', 't');
    expect(reverse.ok && reverse.conflicts).toEqual(['t']);
  });
});
