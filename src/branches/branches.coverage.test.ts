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

describe('foldDiff — `undefined` and `null` commit values are DISTINCT states (Mosaic clause semantics)', () => {
  it('a point value of undefined vs null on siblings is a CHANGE, not an identity', () => {
    const log = [
      rec('c1', null, { viewId: 'scatter', field: 'price', value: 5 }),
      rec('x', 'c1', { value: undefined }), // point clear (inactive filter)
      rec('y', 'c1', { value: null }), // point IS NULL (matches nulls)
    ];
    const d = foldDiff(log, 'x', 'y');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.changed.map((c) => c.key)).toEqual(['selection:bar']);
  });
});
