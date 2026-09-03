/**
 * A bookmark NAMES its parent — present mode orders, matches and seeks by that
 * named position, so a fork below a named commit keeps the bookmark on both
 * lineages, and a bookmark named on another path stays on that path's tour.
 */
import { describe, it, expect } from 'vitest';
import { mapPollState } from '../adapter/sessionView.js';
import { bookmarkRefTarget, bookmarkTarget, currentBookmarkIndex, orderedBookmarks } from './presentBookmark.js';

const rec = (id: string, parent: string | null, viewId = 'bar') => ({
  id,
  parent,
  viewId,
  kind: 'point',
  field: 'category',
  value: 'x',
  cause: { requestedBy: 'user', computedBy: 'user' },
});

// r → a → (bookmark b1 names a) → t → (bookmark b2 names t)   ← the original path
//       └→ f (a fork from a; the presented head)
const S = mapPollState({
  records: [rec('r', null), rec('a', 'r'), rec('b1', 'a', 'bookmark:0'), rec('t', 'b1'), rec('b2', 't', 'bookmark:1'), rec('f', 'a')],
  defaultTable: 'data',
  cursor: 'f',
  head: 'f',
  bookmarks: [
    { label: 'named at a', commitId: 'b1', at: 'a', ts: 2 },
    { label: 'named at t', commitId: 'b2', at: 't', ts: 4 },
  ],
} as unknown as Parameters<typeof mapPollState>[0]);

describe('bookmarkTarget', () => {
  it('is the named position when known, the bookmark itself on an older wire, and null when neither is known', () => {
    expect(bookmarkTarget({ label: 'x', commitId: 'b', at: 'a', ts: 0 })).toBe('a');
    expect(bookmarkTarget({ label: 'x', commitId: 'b', at: null, ts: 0 })).toBe('b');
    expect(bookmarkTarget({ label: 'x', commitId: 'b', ts: 0 })).toBe('b');
    expect(bookmarkTarget({ label: 'x', commitId: null, at: null, ts: 0 })).toBeNull();
  });
});

describe('bookmarkRefTarget — a note links a bookmark by ID, and lands on the same commit the slideshow does', () => {
  const BOOKMARKS = [
    { id: 'b1', label: 'the spike week', commitId: 'c7', at: 'c7', ts: 1 },
    { label: 'an older bookmark', commitId: 'c3', ts: 2 }, // a wire that predates bookmark ids
  ];

  it('resolves the bookmark ID a note actually carries', () => {
    expect(bookmarkRefTarget(BOOKMARKS, 'b1')).toBe('c7');
  });

  it('still resolves a NAME, so words written before bookmark ids keep working', () => {
    expect(bookmarkRefTarget(BOOKMARKS, 'an older bookmark')).toBe('c3');
    expect(bookmarkRefTarget(BOOKMARKS, 'the spike week')).toBe('c7');
  });

  it('an id wins over a same-named label, and an unknown ref resolves to nothing (a click that does nothing, never a wrong seek)', () => {
    expect(bookmarkRefTarget([{ id: 'b2', label: 'b1', commitId: 'cA', ts: 1 }, { id: 'b1', label: 'x', commitId: 'cB', ts: 2 }], 'b1')).toBe('cB');
    expect(bookmarkRefTarget(BOOKMARKS, 'b9')).toBeNull();
    expect(bookmarkRefTarget([{ id: 'b1', label: 'floating', commitId: null, ts: 1 }], 'b1')).toBeNull();
  });

  it('a legacy `bookmark:` commit lands on the moment NAMED, never on the act of naming — the drift a second resolver produced', () => {
    // `commitId` is the bookmark commit; `at` is the moment it names. A resolver
    // that reached for `commitId` sent a note anchor one commit past where the
    // slideshow's own seek goes.
    const legacy = [{ id: 'b1', label: 'named at a', commitId: 'b1c', at: 'a', ts: 2 }];
    expect(bookmarkRefTarget(legacy, 'b1')).toBe('a');
    expect(bookmarkRefTarget(legacy, 'b1')).toBe(bookmarkTarget(legacy[0]!));
  });
});

describe('a fork below a named commit keeps the bookmark', () => {
  it('the bookmark named at `a` is on the fork lineage (r→a→f); the bookmark named at `t` belongs to the other path', () => {
    expect(orderedBookmarks(S.bookmarks, S.commits, 'f').map((c) => c.label)).toEqual(['named at a']);
    // standing on the named position, or on the bookmark commit itself, is "at this bookmark"
    expect(currentBookmarkIndex(S.bookmarks, S.commits, 'a', 'f')).toBe(0);
    expect(currentBookmarkIndex(S.bookmarks, S.commits, 'b1', 'f')).toBe(0);
    // on the original path both bookmarks present, in lineage order
    expect(orderedBookmarks(S.bookmarks, S.commits, 'b2').map((c) => c.label)).toEqual(['named at a', 'named at t']);
  });

  it('two bookmarks naming the SAME position keep their naming order', () => {
    const twice = [...S.bookmarks, { label: 'named at a, again', commitId: 'b3', at: 'a', ts: 9 }];
    expect(orderedBookmarks(twice, S.commits, 'f').map((c) => c.label)).toEqual(['named at a', 'named at a, again']);
  });
});
