/**
 * BOOKMARKS ARE NAMES ON MOMENTS: a name (and words) on a commit, plus who made
 * it and when — kept beside the log, never in it. Bookmarking lands no commit,
 * starts no branch and saves no state; several bookmarks may sit on one commit;
 * a name points at one moment. `bookmarkViews()` is the wire's view of them.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef());

describe('bookmarks — names on moments beside the log', () => {
  it('bookmarks the cursor by default or a named commit, with words; lands nothing; several bookmarks may sit on one commit; the list is oldest first and made of copies', async () => {
    const s = fresh().createSession();
    expect(s.bookmark('too early')).toEqual({ ok: false, rejected: 'nothing to bookmark yet — act first' });
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const b = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause() });
    const bId = b.ok ? b.commit!.id : '';
    const before = s.log.records.length;
    const one = s.bookmark('formal', undefined, 'user', '  the formal picture  ');
    expect(one).toMatchObject({ ok: true, bookmark: { name: 'formal', commitId: bId, description: 'the formal picture', by: 'user' } });
    const two = s.bookmark(' early ', aId, 'agent');
    expect(two).toMatchObject({ ok: true, bookmark: { name: 'early', commitId: aId, by: 'agent' } });
    expect(two.ok && two.bookmark).not.toHaveProperty('description');
    expect(s.bookmark('also formal', bId, 'user', '   ').ok).toBe(true); // blank words = no words; a second name on the same moment is fine
    expect(s.log.records).toHaveLength(before); // nothing on the rail
    expect(s.bookmarks().map((t) => [t.name, t.commitId])).toEqual([['formal', bId], ['early', aId], ['also formal', bId]]);
    expect(s.bookmarks().every((t) => !Number.isNaN(Date.parse(t.at)))).toBe(true);
    (s.bookmarks()[0] as { name: string }).name = 'hacked';
    expect(s.bookmarks()[0]!.name).toBe('formal');
    expect((await s.overview()).bookmarks.map((t) => t.name)).toEqual(['formal', 'early', 'also formal']);
    expect((await s.overview()).time.bookmarks).toBe(3);
  });

  it('refuses in words: a blank or overlong name or description, an unknown commit, a name that already names a moment (its own, or another)', async () => {
    const s = fresh().createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    expect(s.bookmark('  ')).toEqual({ ok: false, rejected: 'a bookmark needs a name' });
    expect(s.bookmark('x'.repeat(201))).toEqual({ ok: false, rejected: 'a bookmark name is at most 200 characters' });
    expect(s.bookmark('ghost', 'nope')).toEqual({ ok: false, rejected: 'no commit "nope" in the log' });
    expect(s.bookmark('wordy', aId, 'user', 'y'.repeat(2001))).toEqual({ ok: false, rejected: 'a bookmark description is at most 2000 characters' });
    expect(s.bookmark('here').ok).toBe(true);
    expect(s.bookmark('here')).toEqual({ ok: false, rejected: '"here" already names this moment' });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    expect(s.bookmark('here')).toEqual({ ok: false, rejected: `"here" already names #${aId} — a bookmark is one moment; rename or forget it first` });
  });

  it('the bookmark verb names the cursor: no commit lands, the wire\'s bookmark view answers, refusals come back as typed gaps', async () => {
    const s = fresh().createSession();
    const none = await s.dispatch({ verb: 'bookmark', label: 'nothing yet', cause: userCause() });
    expect(!none.ok && none.rejection.detail).toBe('nothing to bookmark yet — act first');
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const cp = await s.dispatch({ verb: 'bookmark', label: 'start', cause: userCause('mark') }, { as: 'agent' });
    expect(cp.ok).toBe(true);
    if (!cp.ok) return;
    expect(cp.commit).toBeUndefined();
    expect(cp.bookmark).toEqual({ id: 'b1', label: 'start', commitId: aId, at: aId, ts: 0 });
    expect(s.bookmarks()[0]).toMatchObject({ name: 'start', commitId: aId, by: 'agent' });
    expect(s.log.records).toHaveLength(1);
  });

  it('words change through describeBookmark and renaming keeps the moment — both record the edit and leave who bookmarked it and when alone, so the list never reorders; renaming is free even under a link, forgetting is not', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const first = s.bookmark('start');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(s.bookmark('other').ok).toBe(true);
    expect(s.describeBookmark('nope', 'x')).toEqual({ ok: false, rejected: 'no bookmark "nope" — the bookmarks are "start", "other"' });
    expect(s.describeBookmark('start', 'y'.repeat(2001))).toEqual({ ok: false, rejected: 'a bookmark description is at most 2000 characters' });
    const worded = s.describeBookmark('start', ' where it began ', 'agent');
    expect(worded).toMatchObject({ ok: true, bookmark: { id: first.bookmark.id, name: 'start', description: 'where it began', by: 'user', at: first.bookmark.at, editedBy: 'agent' } }); // who BOOKMARKED the moment is untouched; the writer of the words rides `editedBy`
    expect(worded.ok && Number.isNaN(Date.parse(worded.bookmark.editedAt!))).toBe(false);
    expect(s.describeBookmark('start', null)).toMatchObject({ ok: true });
    expect(s.bookmarks()[0]).not.toHaveProperty('description');
    expect(s.renameBookmark('start', ' ')).toEqual({ ok: false, rejected: 'a bookmark needs a name' });
    expect(s.renameBookmark('start', 'x'.repeat(201))).toEqual({ ok: false, rejected: 'a bookmark name is at most 200 characters' });
    expect(s.renameBookmark('nope', 'y')).toEqual({ ok: false, rejected: 'no bookmark "nope" — the bookmarks are "start", "other"' }); // the order is the order they were made: describeBookmark cannot move a row
    expect(s.renameBookmark('start', 'other')).toEqual({ ok: false, rejected: '"other" is already a bookmark — rename or forget it first' });
    const untouched = s.bookmarks().find((t) => t.name === 'start')!;
    expect(s.renameBookmark('start', 'start')).toEqual({ ok: true, bookmark: untouched }); // the name it already has: allowed, and nothing is recorded — not even the edit stamp
    // a note links the bookmark's ID, so renaming is free — only forgetting would leave the words pointing at nothing
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[start]', author: { kind: 'human' }, refs: [{ span: [4, 12], bookmark: first.bookmark.id, label: 'start' }] }, cause: userCause() });
    expect(s.renameBookmark('start', 'begin', 'agent')).toMatchObject({ ok: true, bookmark: { id: first.bookmark.id, name: 'begin', by: 'user', editedBy: 'agent' } });
    expect(s.forgetBookmark('begin')).toEqual({ ok: false, rejected: '"begin" is linked from note n1 — change the link in the words first' });
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: null, cause: userCause() });
    expect(s.bookmarkViews().map((c) => [c.id, c.label])).toEqual([[first.bookmark.id, 'begin'], ['b2', 'other']]); // the order they were made, unmoved by two renames and a describe
    expect(s.forgetBookmark('begin')).toMatchObject({ ok: true, bookmark: { name: 'begin' } });
    expect(s.forgetBookmark('begin')).toEqual({ ok: false, rejected: 'no bookmark "begin" — the bookmarks are "other"' });
    expect(s.forgetBookmark('other').ok).toBe(true);
    expect(s.forgetBookmark('other')).toEqual({ ok: false, rejected: 'no bookmark "other" — the bookmarks are none' });
    expect(s.bookmark('begin')).toMatchObject({ ok: true, bookmark: { id: 'b3' } }); // the NAME is free again; the NUMBERS b1 and b2 are spent for the life of the store
  });

  it('a note links a bookmark by its ID (the prose world holds bookmark ids); the refusal names the words the ref shows, or the id when it shows none; a bookmark off the cursor\'s path still lists', async () => {
    const s = fresh().createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    const party = s.bookmark('party');
    expect(party.ok).toBe(true);
    if (!party.ok) return;
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause('a branch') });
    expect(s.bookmark('work').ok).toBe(true);
    expect(s.bookmarks().map((t) => [t.id, t.name])).toEqual([['b1', 'party'], ['b2', 'work']]); // both, across branches
    const ok = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[party]', author: { kind: 'human' }, refs: [{ span: [4, 12], bookmark: party.bookmark.id, label: 'party' }] }, cause: userCause() });
    expect(ok.ok).toBe(true);
    const bad = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see @[ghost]', author: { kind: 'human' }, refs: [{ span: [4, 12], bookmark: 'b9', label: 'ghost' }] }, cause: userCause() });
    expect(!bad.ok && bad.rejection.detail).toBe('"note:n2".caption.refs[0] points at a bookmark that does not exist: "ghost" (b9)'); // the words AND the id behind them
    const bare = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see it', author: { kind: 'human' }, refs: [{ span: [4, 6], bookmark: 'b9' }] }, cause: userCause() });
    expect(!bare.ok && bare.rejection.detail).toBe('"note:n2".caption.refs[0] points at a bookmark that does not exist: "b9" — the bookmarks are "party", "work"'); // no words to show: the id, and what DOES exist
  });

  it('restoreBookmarks puts bookmarks back whole — judged, never re-stamped, refusing a commit the log does not hold — through the session or the dashboard; the store is shared', async () => {
    const dash = fresh();
    const s = dash.createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const older = { name: 'older', commitId: aId, by: 'agent' as const, at: '2020-01-01T00:00:00.000Z', description: 'kept' };
    const r = s.restoreBookmarks([
      older,
      { ...older, name: '  ' },
      null as unknown as typeof older, // not a record at all — judged, never thrown on
      { ...older, name: 'x'.repeat(201) },
      { ...older, name: 'older' },
      { ...older, name: 'no commit', commitId: '' },
      { ...older, name: 'gone', commitId: 'zzz' },
      { ...older, name: 'no who', by: undefined as unknown as 'user' },
      { ...older, name: 'bad words', description: 5 as unknown as string },
    ]);
    expect(r.restored).toEqual(['older']);
    expect(r.reidentified).toEqual([{ name: 'older', id: 'b1' }]); // it carried no id, so the store named it — and said so
    expect(r.refused).toEqual([
      { name: '(unnamed)', rejected: 'a bookmark needs a name' },
      { name: '(unnamed)', rejected: 'a bookmark needs a name' },
      { name: 'x'.repeat(201), rejected: 'a bookmark name is at most 200 characters' },
      { name: 'older', rejected: '"older" is already a bookmark — rename or forget it first' },
      { name: 'no commit', rejected: 'a bookmark names a commit' },
      { name: 'gone', rejected: 'no commit "zzz" in the log' },
      { name: 'no who', rejected: 'a bookmark carries who made it and when' },
      { name: 'bad words', rejected: "a bookmark's description is words" },
    ]);
    expect(s.bookmark('newer').ok).toBe(true);
    expect(s.bookmarks().map((t) => t.name)).toEqual(['older', 'newer']); // oldest first by `at`
    expect(s.bookmarks()[0]).toEqual({ ...older, id: 'b1' });
    expect(dash.bookmarks().map((t) => t.name)).toEqual(['older', 'newer']);
    expect(dash.restoreBookmarks([{ ...older, name: 'from the host' }]).restored).toEqual(['from the host']); // the dashboard cannot check the commit: a host's own truth
    const b = dash.createSession();
    expect(b.bookmarks().map((t) => t.name)).toEqual(['older', 'from the host', 'newer']); // the host's record kept its 2020 time
    // a host's bookmark with NO words, on a moment this session's log does not hold: the dashboard cannot check the commit,
    // so it lists — and the wire's bookmark view says its position is -1, honestly outside this log.
    const hostOnly = { name: 'host only', commitId: 'unknown-commit', by: 'user' as const, at: '2021-06-01T00:00:00.000Z' };
    expect(dash.restoreBookmarks([hostOnly]).restored).toEqual(['host only']);
    expect(s.bookmarks().find((t) => t.name === 'host only')).toEqual({ ...hostOnly, id: 'b4' }); // no description property invented
    expect(s.bookmarkViews().find((c) => c.label === 'host only')).toEqual({ id: 'b4', label: 'host only', commitId: 'unknown-commit', at: 'unknown-commit', ts: -1 });
    (dash.bookmarks()[0] as { name: string }).name = 'hacked';
    expect(dash.bookmarks()[0]!.name).toBe('older');
  });

  it('a restored bookmark KEEPS the id it carries when the store has room for it, and is renamed only when it must be — never silently', async () => {
    const s = fresh().createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const one = { commitId: aId, by: 'user' as const, at: '2020-01-01T00:00:00.000Z' };
    // a host's own ids come back untouched, edit stamps and all; the store's next number is one past the highest it can see
    // …including ids that are not this store's shape at all (another system's names): they are kept, and skipped when the next number is worked out
    expect(s.restoreBookmarks([{ ...one, name: 'one', id: 'b7' }, { ...one, name: 'two', id: 'b3', editedBy: 'agent' as const, editedAt: '2021-02-02T00:00:00.000Z' }, { ...one, name: 'odd', id: 'x9' }, { ...one, name: 'odder', id: 'b-old' }])).toEqual({ restored: ['one', 'two', 'odd', 'odder'], refused: [], reidentified: [] });
    expect(s.bookmarks().map((t) => [t.id, t.name, t.editedBy])).toEqual([['b7', 'one', undefined], ['b3', 'two', 'agent'], ['x9', 'odd', undefined], ['b-old', 'odder', undefined]]);
    expect(s.bookmark('fresh')).toMatchObject({ ok: true, bookmark: { id: 'b8' } }); // one past the highest `b` number — "x9" and "b-old" name no number of this store's
    // an id another bookmark already holds cannot be kept: the store names the record and says what it arrived with
    const clash = s.restoreBookmarks([{ ...one, name: 'three', id: 'b7' }]);
    expect(clash.reidentified).toEqual([{ name: 'three', id: 'b9', was: 'b7' }]);
    expect(s.bookmarks().find((t) => t.name === 'three')!.id).toBe('b9');
    // a shape that is not an id, and an edit stamp that is not who-and-when, are refused in words
    expect(s.restoreBookmarks([{ ...one, name: 'bad id', id: '  ' }, { ...one, name: 'worse id', id: 5 as unknown as string }, { ...one, name: 'bad edit', editedBy: 7 as unknown as 'user' }]).refused).toEqual([
      { name: 'bad id', rejected: "a bookmark's id, when it carries one, is a short name" },
      { name: 'worse id', rejected: "a bookmark's id, when it carries one, is a short name" },
      { name: 'bad edit', rejected: 'a bookmark that was edited carries who edited it and when' },
    ]);
  });
});
