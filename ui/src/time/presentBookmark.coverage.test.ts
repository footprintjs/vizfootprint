// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { CommitView, BookmarkView } from '../adapter/types.js';
import { currentBookmarkIndex } from './presentBookmark.js';

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

describe('presentBookmark.currentBookmarkIndex — null cursor', () => {
  it('returns -1 when bookmarks exist but the cursor is null (no exact match, no ancestry to walk)', () => {
    const commits: CommitView[] = [commit('r', null)];
    const bookmarks: BookmarkView[] = [{ label: 'start', commitId: 'r', ts: 10, by: 'user' as const, madeAt: '2026-01-01T00:00:00.000Z' }];
    expect(currentBookmarkIndex(bookmarks, commits, null)).toBe(-1);
  });
});
