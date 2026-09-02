/**
 * A beat NAMES its parent — present mode orders, matches and seeks by that
 * named position, so a fork below a named commit keeps the beat on both
 * lineages, and a beat named on another path stays on that path's tour.
 */
import { describe, it, expect } from 'vitest';
import { mapPollState } from '../adapter/sessionView.js';
import { beatTarget, currentBeatIndex, orderedCheckpoints } from './presentBeat.js';

const rec = (id: string, parent: string | null, viewId = 'bar') => ({
  id,
  parent,
  viewId,
  kind: 'point',
  field: 'category',
  value: 'x',
  cause: { requestedBy: 'user', computedBy: 'user' },
});

// r → a → (beat b1 names a) → t → (beat b2 names t)   ← the original path
//       └→ f (a fork from a; the presented head)
const S = mapPollState({
  records: [rec('r', null), rec('a', 'r'), rec('b1', 'a', 'beat:0'), rec('t', 'b1'), rec('b2', 't', 'beat:1'), rec('f', 'a')],
  defaultTable: 'data',
  cursor: 'f',
  head: 'f',
  checkpoints: [
    { label: 'named at a', commitId: 'b1', at: 'a', ts: 2 },
    { label: 'named at t', commitId: 'b2', at: 't', ts: 4 },
  ],
} as unknown as Parameters<typeof mapPollState>[0]);

describe('beatTarget', () => {
  it('is the named position when known, the beat itself on an older wire, and null when neither is known', () => {
    expect(beatTarget({ label: 'x', commitId: 'b', at: 'a', ts: 0 })).toBe('a');
    expect(beatTarget({ label: 'x', commitId: 'b', at: null, ts: 0 })).toBe('b');
    expect(beatTarget({ label: 'x', commitId: 'b', ts: 0 })).toBe('b');
    expect(beatTarget({ label: 'x', commitId: null, at: null, ts: 0 })).toBeNull();
  });
});

describe('a fork below a named commit keeps the beat', () => {
  it('the beat named at `a` is on the fork lineage (r→a→f); the beat named at `t` belongs to the other path', () => {
    expect(orderedCheckpoints(S.checkpoints, S.commits, 'f').map((c) => c.label)).toEqual(['named at a']);
    // standing on the named position, or on the beat commit itself, is "at this beat"
    expect(currentBeatIndex(S.checkpoints, S.commits, 'a', 'f')).toBe(0);
    expect(currentBeatIndex(S.checkpoints, S.commits, 'b1', 'f')).toBe(0);
    // on the original path both beats present, in lineage order
    expect(orderedCheckpoints(S.checkpoints, S.commits, 'b2').map((c) => c.label)).toEqual(['named at a', 'named at t']);
  });

  it('two beats naming the SAME position keep their naming order', () => {
    const twice = [...S.checkpoints, { label: 'named at a, again', commitId: 'b3', at: 'a', ts: 9 }];
    expect(orderedCheckpoints(twice, S.commits, 'f').map((c) => c.label)).toEqual(['named at a', 'named at a, again']);
  });
});
