// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { CommitView, CheckpointView } from '../adapter/types.js';
import { currentBeatIndex } from './presentBeat.js';

function commit(id: string, parent: string | null): CommitView {
  return {
    id,
    parent,
    viewId: 'scatter',
    kind: 'interval',
    field: 'price',
    value: null,
    actor: 'user',
    label: 'price',
    onBranch: true,
    isCursor: false,
    isHead: false,
  };
}

describe('presentBeat.currentBeatIndex — null cursor', () => {
  it('returns -1 when checkpoints exist but the cursor is null (no exact match, no ancestry to walk)', () => {
    const commits: CommitView[] = [commit('r', null)];
    const checkpoints: CheckpointView[] = [{ label: 'start', commitId: 'r', ts: 10 }];
    expect(currentBeatIndex(checkpoints, commits, null)).toBe(-1);
  });
});
