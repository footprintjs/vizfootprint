import { describe, it, expect } from 'vitest';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { timeTravelModel } from './model.js';
import { timeTravelOf } from './useTimeTravel.js';
import { railScope } from './rail.js';

const at = { by: 'user' as const, madeAt: '2026-01-01T00:00:00.000Z' };
// r → a → b (head); a → c (a sibling leaf)
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent', intent: 'narrow it' } },
    { id: 'b', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
    { id: 'c', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [70, 90], cause: { requestedBy: 'agent' } },
  ],
  bookmarks: [
    { label: 'start', commitId: 'r', ts: 10, ...at },
    { label: 'mid', commitId: 'b', ts: 20, ...at },
  ],
  branches: [
    { tip: 'b', length: 3, actor: 'user', active: true },
    { tip: 'c', length: 3, actor: 'agent', active: false },
  ],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);
const base = { commits: S.commits, head: S.head, bookmarks: S.bookmarks, pathCount: 2 };
const ids = (m: ReturnType<typeof timeTravelModel>): string[] => m.explore.bars.map((b) => b.id);
const marks = (m: ReturnType<typeof timeTravelModel>, key: 'cursor' | 'head' | 'ahead' | 'bookmarked'): string[] => m.explore.bars.filter((b) => b[key]).map((b) => b.id);

describe('timeTravelModel — explore', () => {
  it('draws the head lineage, root first, with the cursor, the head and the bookmarks marked', () => {
    const m = timeTravelModel({ ...base, cursor: 'b' });
    expect(ids(m)).toEqual(['r', 'a', 'b']);
    expect(marks(m, 'cursor')).toEqual(['b']);
    expect(marks(m, 'head')).toEqual(['b']);
    expect(marks(m, 'ahead')).toEqual([]);
    expect(marks(m, 'bookmarked')).toEqual(['r', 'b']);
    expect(m.explore.bars[1]).toMatchObject({ actor: 'agent', intent: 'narrow it' });
    expect('intent' in m.explore.bars[0]!).toBe(false);
    expect(m.cursorLabel).toBe(S.commits[2]!.label);
  });

  it('a cursor behind the head leaves the later bars ahead of it, and says where a step lands', () => {
    const m = timeTravelModel({ ...base, cursor: 'a' });
    expect(marks(m, 'ahead')).toEqual(['b']);
    expect(m.explore.back).toBe('r');
    // a has two children; the one on the head's lineage is the step forward
    expect(m.explore.forward).toBe('b');
  });

  it('follows the cursor onto another lane, keeps the path name off those bars, and reports it', () => {
    const m = timeTravelModel({ ...base, cursor: 'c', pathName: 'main' });
    expect(ids(m)).toEqual(['r', 'a', 'c']);
    expect(marks(m, 'cursor')).toEqual(['c']);
    expect(marks(m, 'head')).toEqual([]);
    expect(m.explore.coverage).toEqual({ shown: 3, total: 4, pathCount: 2, offLane: true, cursorMissing: false });
    expect(railScope(m.explore.coverage)).toBe('3 of 4 steps · this path of 2 · now is on another path');
    expect(timeTravelModel({ ...base, cursor: 'b', pathName: 'main' }).explore.coverage.pathName).toBe('main');
  });

  it('an empty cursor id is no cursor: nothing is reported missing', () => {
    const m = timeTravelModel({ ...base, cursor: '' });
    expect(ids(m)).toEqual(['r', 'a', 'b']);
    expect(m.explore.coverage).toMatchObject({ offLane: false, cursorMissing: false });
  });

  it('an empty intent is no intent', () => {
    const commits = S.commits.map((c) => (c.id === 'a' ? { ...c, intent: '' } : c));
    expect('intent' in timeTravelModel({ ...base, commits, cursor: 'b' }).explore.bars[1]!).toBe(false);
  });

  it('no cursor: the head lineage, no bar marked as the cursor, nowhere to step', () => {
    const m = timeTravelModel({ ...base, cursor: null });
    expect(ids(m)).toEqual(['r', 'a', 'b']);
    expect(marks(m, 'cursor')).toEqual([]);
    expect(marks(m, 'ahead')).toEqual([]);
    expect([m.explore.back, m.explore.forward, m.cursorLabel]).toEqual([null, null, undefined]);
  });

  it('a cursor that is not in the log: the head lineage is still drawn, and the gap is stated', () => {
    const m = timeTravelModel({ ...base, cursor: 'gone' });
    expect(ids(m)).toEqual(['r', 'a', 'b']);
    expect(marks(m, 'cursor')).toEqual([]);
    expect(m.cursor).toBe('gone');
    expect('cursorLabel' in m).toBe(false);
    expect(m.explore.coverage).toMatchObject({ offLane: false, cursorMissing: true });
    expect(railScope(m.explore.coverage)).toBe('3 of 4 steps · this path of 2 · the cursor is not among the recorded steps');
    // and on a single complete path the sentence still appears: the missing mark is the thing to explain
    const one = timeTravelModel({ commits: S.commits.slice(0, 1), head: 'r', cursor: 'gone' });
    expect(railScope(one.explore.coverage)).toBe('1 of 1 steps · this path · the cursor is not among the recorded steps');
  });

  it('an empty log, and a log with no head, draw nothing and count what exists', () => {
    const empty = timeTravelModel({ commits: [], cursor: null, head: null });
    expect(empty.explore).toEqual({ bars: [], back: null, forward: null, coverage: { shown: 0, total: 0, pathCount: 0, offLane: false, cursorMissing: false } });
    expect(empty.present).toEqual({ stops: [], index: -1, exact: false, previous: null, next: null });
    expect(empty.suggestedBookmarkName).toBe('bookmark-1');
    const headless = timeTravelModel({ commits: S.commits, cursor: null, head: null });
    expect(headless.explore.coverage).toMatchObject({ shown: 0, total: 4 });
  });

  it('a parent cycle ends the lineage instead of looping', () => {
    const loop = [
      { ...S.commits[0]!, id: 'x', parent: 'y' },
      { ...S.commits[0]!, id: 'y', parent: 'x' },
    ];
    expect(ids(timeTravelModel({ commits: loop, cursor: 'x', head: 'x' }))).toEqual(['y', 'x']);
  });

  it('a bookmark with no commit, or an empty one, flags no bar', () => {
    const m = timeTravelModel({ ...base, cursor: 'b', bookmarks: [{ label: 'floating', commitId: null, ts: 1, ...at }, { label: 'blank', commitId: '', ts: 2, ...at }] });
    expect(marks(m, 'bookmarked')).toEqual([]);
    expect(m.suggestedBookmarkName).toBe('bookmark-3');
  });

  it('is pure: equal input gives an equal model and the input is untouched', () => {
    const input = Object.freeze({ ...base, cursor: 'a' });
    expect(timeTravelModel(input)).toEqual(timeTravelModel(input));
  });
});

describe('timeTravelModel — present', () => {
  it('orders the bookmarks along the presented lineage and marks the one the cursor stands on', () => {
    const m = timeTravelModel({ ...base, cursor: 'b' });
    expect(m.present.stops).toEqual([
      { target: 'r', commitId: 'r', label: 'start', current: false },
      { target: 'b', commitId: 'b', label: 'mid', current: true },
    ]);
    expect(m.present).toMatchObject({ index: 1, exact: true, previous: 'r', next: null });
  });

  it('between bookmarks the nearest one behind the cursor is current', () => {
    expect(timeTravelModel({ ...base, cursor: 'a' }).present).toMatchObject({ index: 0, exact: true, previous: null, next: 'b' });
  });

  it('a cursor with no bookmark at or behind it shows the first stop and says it is not exact', () => {
    const m = timeTravelModel({ ...base, cursor: 'a', bookmarks: [{ label: 'mid', commitId: 'b', ts: 20, ...at }] });
    expect(m.present).toMatchObject({ index: 0, exact: false, previous: null, next: null });
    expect(m.present.stops[0]!.current).toBe(true);
  });

  it('a bookmark seeks to the moment it NAMES, not to the act of naming it', () => {
    const m = timeTravelModel({ ...base, cursor: 'b', bookmarks: [{ label: 'named', commitId: 'b', at: 'a', ts: 1, ...at }] });
    expect(m.present.stops).toEqual([{ target: 'a', commitId: 'b', label: 'named', current: true }]);
  });

  it('bookmarks off the presented lineage are not stops; with no head the cursor is the tip', () => {
    const off = timeTravelModel({ ...base, cursor: 'b', bookmarks: [{ label: 'elsewhere', commitId: 'c', ts: 1, ...at }] });
    expect(off.present.stops).toEqual([]);
    const headless = timeTravelModel({ commits: S.commits, head: null, cursor: 'c', bookmarks: [{ label: 'elsewhere', commitId: 'c', ts: 1, ...at }] });
    expect(headless.present.stops.map((s) => s.label)).toEqual(['elsewhere']);
  });
});

describe('timeTravelOf — the model of a session state', () => {
  it('reads the commits, cursor, head, bookmarks and path count from the state', () => {
    const m = timeTravelOf(S);
    expect(ids(m)).toEqual(['r', 'a', 'b']);
    expect(m.explore.coverage.pathCount).toBe(2);
    expect('pathName' in m.explore.coverage).toBe(false);
  });

  it('names the path only when the story is on one', () => {
    const named = timeTravelOf({ ...S, paths: { ...S.paths, current: 'main' } });
    expect(named.explore.coverage.pathName).toBe('main');
  });
});
