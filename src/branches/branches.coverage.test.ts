/**
 * BR-1 — COVERAGE PACKET (raw-log corner cases).
 *
 * branches.test.ts pins the approved semantics; this file drives the corners
 * a RAW `CommitRecord[]` (legacy / hand-carried, never session-authored) can
 * reach: dangling parent pointers, cyclic corruption mid-conflict-walk,
 * disjoint-root walks, `undefined` commit values, and the small read-only
 * ref accessors the session surface consumes.
 */
import { describe, it, expect } from 'vitest';
import type { CommitRecord } from '../log/index.js';
import { BranchRefs, foldDiff, foldStateAt, planBringOver } from './index.js';
import { isClearedSelection } from './fold.js';

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

describe('BranchRefs — read-only accessors (the session surface reads these)', () => {
  it('has / tipOf / state reflect the live refs', () => {
    const refs = new BranchRefs({ defaultName: 'trunk' });
    expect(refs.state()).toEqual({ branches: {}, head: { branch: 'trunk' }, archived: [] });
    expect(refs.has('trunk')).toBe(false); // unborn — no tip yet
    expect(refs.tipOf('trunk')).toBeUndefined();

    refs.noteCommit(rec('c1', null));
    expect(refs.has('trunk')).toBe(true);
    expect(refs.tipOf('trunk')).toBe('c1');
    expect(refs.state()).toEqual({ branches: { trunk: 'c1' }, head: { branch: 'trunk' }, archived: [] });
  });
});

describe('raw-log honesty — dangling parents and cycles terminate, never spin', () => {
  it('foldStateAt walks as far as a DANGLING parent pointer allows, then stops', () => {
    // t2's parent "t1" is not in the records — a truncated hand-carried log.
    const log = [rec('t2', 't1', { value: 'Party' })];
    const state = foldStateAt(log, 't2');
    expect(state.size).toBe(1); // t2 itself folded; the walk stopped at the hole
    expect(state.get('selection:bar')).toMatchObject({ commitId: 't2' });
  });

  it('a conflict walk over a truncated target path stops at the hole (plan still returned)', () => {
    // Source lane: s (root). Target lane: t2 whose parent t1 is MISSING → the
    // LCA is null (no shared history reachable) and the walk breaks at t1.
    const log = [rec('s', null, { viewId: 'scatter', field: 'price', value: 1 }), rec('t2', 't1')];
    const plan = planBringOver(log, 's', 't2');
    expect(plan).toMatchObject({ ok: true, conflicts: [] }); // scatter key untouched on the reachable path
  });

  it('a conflict walk across DISJOINT roots covers the whole target lane to its root', () => {
    // Two roots; the source touches the SAME key the target lane touches — the
    // walk (LCA null) scans the full target lane and names both touches.
    const log = [
      rec('s', null), // root lane A — selection:bar
      rec('r', null, { value: 'Casual' }), // root lane B — selection:bar
      rec('r2', 'r', { value: 'Party' }), // selection:bar again
    ];
    const plan = planBringOver(log, 's', 'r2');
    expect(plan).toMatchObject({ ok: true, conflicts: ['r', 'r2'] }); // oldest→newest
  });

  it('a CYCLIC target path exits via the seen-guard (loop-safe conflict walk)', () => {
    const log = [rec('z', null, { viewId: 'scatter', field: 'price', value: 1 }), rec('a', 'b'), rec('b', 'a')];
    const plan = planBringOver(log, 'z', 'a');
    expect(plan).toMatchObject({ ok: true, conflicts: [] }); // walked a → b → (a seen) → stop
  });
});

describe('foldDiff — a cleared point drops out of the fold, a valued one stands', () => {
  it('a point value of null is a CLEAR (absent from the fold); a concrete value is a live clause — distinct, never an identity', () => {
    const log = [
      rec('c1', null, { viewId: 'scatter', field: 'price', value: 5 }),
      rec('x', 'c1', { value: null }), // point clear — ONE spelling: the key is DROPPED, like a cleared interval
      rec('y', 'c1', { value: 'Formal' }), // a live point clause
    ];
    const d = foldDiff(log, 'x', 'y');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.changed).toEqual([]);
    expect(d.onlyA).toEqual([]);
    expect(d.onlyB.map((c) => c.key)).toEqual(['selection:bar']);
  });
});

describe('isClearedSelection — ONE clearing rule, and ONE spelling, for every selection kind', () => {
  it('every kind clears with null — the only spelling that survives JSON (src/session/README.md, beside law 6)', () => {
    expect(isClearedSelection({ kind: 'point', value: null })).toBe(true);
    expect(isClearedSelection({ kind: 'interval', value: null })).toBe(true);
    expect(isClearedSelection({ kind: 'cell', value: null })).toBe(true);
    expect(isClearedSelection({ kind: 'match', value: null })).toBe(true);
    expect(isClearedSelection({ kind: 'point', value: 'Formal' })).toBe(false);
    expect(isClearedSelection({ kind: 'match', value: { values: [] } })).toBe(false); // an empty keep-list is a live clause (matches nothing)
  });
  it('the fold keeps a match clause, value and all, and drops the key on a cleared match', () => {
    const log = [
      rec('m1', null, { kind: 'match', value: { values: ['Formal', 'Party'], exclude: true } }),
      rec('m2', 'm1', { kind: 'match', value: null }),
    ];
    const at1 = foldStateAt(log, 'm1').get('selection:bar');
    expect(at1).toEqual({ kind: 'selection', viewId: 'bar', clause: { kind: 'match', field: 'category', value: { values: ['Formal', 'Party'], exclude: true } }, commitId: 'm1' });
    expect(foldStateAt(log, 'm2').has('selection:bar')).toBe(false);
  });
});

describe('layer 4 — link commits in the branch fold', () => {
  const link = (v: unknown) => ({ viewId: 'link:map:point→bar', field: 'response', value: v });
  it('folds an edit last-wins per edge id, drops the key on an un-declare (null), fingerprints the edge, and reads a malformed id honestly', () => {
    const log = [
      rec('l1', null, link({ source: 'map', kind: 'point', target: 'bar', response: 'highlight' })),
      rec('l2', 'l1', link({ source: 'map', kind: 'point', target: 'bar', response: 'mirror' })),
      rec('l3', 'l2', link(null)),
    ];
    expect(foldStateAt(log, 'l1').get('link:map:point→bar')).toEqual({ kind: 'link', edgeId: 'map:point→bar', link: { source: 'map', kind: 'point', target: 'bar', response: 'highlight' }, commitId: 'l1' });
    expect(foldStateAt(log, 'l2').get('link:map:point→bar')?.commitId).toBe('l2');
    expect(foldStateAt(log, 'l3').has('link:map:point→bar')).toBe(false);
    const d = foldDiff(log, 'l1', 'l2');
    expect(d.ok && d.changed.map((c) => c.key)).toEqual(['link:map:point→bar']); // two edits of one edge are a CHANGE, not an identity
    // a bring-over of an un-declare whose id is malformed (no arrow, no colon) still yields a clear-link recipe, never a throw
    const odd = [rec('o1', null, { viewId: 'link:garbage', field: 'response', value: null })];
    const plan = planBringOver(odd, 'o1', null);
    expect(plan.ok && plan.recipe).toEqual({ apply: 'clear-link', link: { source: '', kind: 'garbage', target: '', response: 'none' } });
  });
});
