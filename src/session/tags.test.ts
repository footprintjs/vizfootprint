/**
 * TAGS ARE NAMES ON MOMENTS: a checkpoint is a tag — a name (and words) on a
 * commit, who tagged it and when — beside the log, like a git tag. Tagging
 * lands no commit and starts no branch; several tags may sit on one commit; a
 * name is one moment. `checkpoints()` is the wire's view of the tags.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef());

describe('tags — names on moments beside the log', () => {
  it('tags the cursor by default or a named commit, with words; lands nothing; several tags may sit on one commit; the list is oldest first and made of copies', async () => {
    const s = fresh().createSession();
    expect(s.tag('too early')).toEqual({ ok: false, rejected: 'nothing to tag yet — act first' });
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const b = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause() });
    const bId = b.ok ? b.commit!.id : '';
    const before = s.log.records.length;
    const one = s.tag('formal', undefined, 'user', '  the formal picture  ');
    expect(one).toMatchObject({ ok: true, tag: { name: 'formal', commitId: bId, description: 'the formal picture', by: 'user' } });
    const two = s.tag(' early ', aId, 'agent');
    expect(two).toMatchObject({ ok: true, tag: { name: 'early', commitId: aId, by: 'agent' } });
    expect(two.ok && two.tag).not.toHaveProperty('description');
    expect(s.tag('also formal', bId, 'user', '   ').ok).toBe(true); // blank words = no words; a second name on the same moment is fine
    expect(s.log.records).toHaveLength(before); // nothing on the rail
    expect(s.tags().map((t) => [t.name, t.commitId])).toEqual([['formal', bId], ['early', aId], ['also formal', bId]]);
    expect(s.tags().every((t) => !Number.isNaN(Date.parse(t.at)))).toBe(true);
    (s.tags()[0] as { name: string }).name = 'hacked';
    expect(s.tags()[0]!.name).toBe('formal');
    expect((await s.overview()).tags.map((t) => t.name)).toEqual(['formal', 'early', 'also formal']);
    expect((await s.overview()).time.checkpoints).toBe(3);
  });

  it('refuses in words: a blank or overlong name or description, an unknown commit, a name that already names a moment (its own, or another)', async () => {
    const s = fresh().createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    expect(s.tag('  ')).toEqual({ ok: false, rejected: 'a tag needs a name' });
    expect(s.tag('x'.repeat(201))).toEqual({ ok: false, rejected: 'a tag name is at most 200 characters' });
    expect(s.tag('ghost', 'nope')).toEqual({ ok: false, rejected: 'no commit "nope" in the log' });
    expect(s.tag('wordy', aId, 'user', 'y'.repeat(2001))).toEqual({ ok: false, rejected: 'a tag description is at most 2000 characters' });
    expect(s.tag('here').ok).toBe(true);
    expect(s.tag('here')).toEqual({ ok: false, rejected: '"here" already names this moment' });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    expect(s.tag('here')).toEqual({ ok: false, rejected: `"here" already names #${aId} — a tag is one moment; rename or forget it first` });
  });

  it('the checkpoint verb is the same act by its old name: no commit, the cursor tagged, the wire\'s checkpoint view answered, refusals as typed gaps', async () => {
    const s = fresh().createSession();
    const none = await s.dispatch({ verb: 'checkpoint', label: 'nothing yet', cause: userCause() });
    expect(!none.ok && none.rejection.detail).toBe('nothing to tag yet — act first');
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const cp = await s.dispatch({ verb: 'checkpoint', label: 'start', cause: userCause('mark') }, { as: 'agent' });
    expect(cp.ok).toBe(true);
    if (!cp.ok) return;
    expect(cp.commit).toBeUndefined();
    expect(cp.checkpoint).toEqual({ id: 't1', label: 'start', commitId: aId, at: aId, ts: 0 });
    expect(s.tags()[0]).toMatchObject({ name: 'start', commitId: aId, by: 'agent' });
    expect(s.log.records).toHaveLength(1);
  });

  it('words change through describeTag and renaming keeps the moment — both record the edit and leave who tagged it and when alone, so the list never reorders; renaming is free even under a link, forgetting is not', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const first = s.tag('start');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(s.tag('other').ok).toBe(true);
    expect(s.describeTag('nope', 'x')).toEqual({ ok: false, rejected: 'no tag "nope" — the tags are "start", "other"' });
    expect(s.describeTag('start', 'y'.repeat(2001))).toEqual({ ok: false, rejected: 'a tag description is at most 2000 characters' });
    const worded = s.describeTag('start', ' where it began ', 'agent');
    expect(worded).toMatchObject({ ok: true, tag: { id: first.tag.id, name: 'start', description: 'where it began', by: 'user', at: first.tag.at, editedBy: 'agent' } }); // who TAGGED the moment is untouched; the writer of the words rides `editedBy`
    expect(worded.ok && Number.isNaN(Date.parse(worded.tag.editedAt!))).toBe(false);
    expect(s.describeTag('start', null)).toMatchObject({ ok: true });
    expect(s.tags()[0]).not.toHaveProperty('description');
    expect(s.renameTag('start', ' ')).toEqual({ ok: false, rejected: 'a tag needs a name' });
    expect(s.renameTag('start', 'x'.repeat(201))).toEqual({ ok: false, rejected: 'a tag name is at most 200 characters' });
    expect(s.renameTag('nope', 'y')).toEqual({ ok: false, rejected: 'no tag "nope" — the tags are "start", "other"' }); // the order is the order they were made: describeTag cannot move a row
    expect(s.renameTag('start', 'other')).toEqual({ ok: false, rejected: '"other" is already a tag — rename or forget it first' });
    const untouched = s.tags().find((t) => t.name === 'start')!;
    expect(s.renameTag('start', 'start')).toEqual({ ok: true, tag: untouched }); // the name it already has: allowed, and nothing is recorded — not even the edit stamp
    // a note links the tag's ID, so renaming is free — only forgetting would leave the words pointing at nothing
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[start]', author: { kind: 'human' }, refs: [{ span: [4, 12], beat: first.tag.id, label: 'start' }] }, cause: userCause() });
    expect(s.renameTag('start', 'begin', 'agent')).toMatchObject({ ok: true, tag: { id: first.tag.id, name: 'begin', by: 'user', editedBy: 'agent' } });
    expect(s.forgetTag('begin')).toEqual({ ok: false, rejected: '"begin" is linked from note n1 — change the link in the words first' });
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: null, cause: userCause() });
    expect(s.checkpoints().map((c) => [c.id, c.label])).toEqual([[first.tag.id, 'begin'], ['t2', 'other']]); // the order they were made, unmoved by two renames and a describe
    expect(s.forgetTag('begin')).toMatchObject({ ok: true, tag: { name: 'begin' } });
    expect(s.forgetTag('begin')).toEqual({ ok: false, rejected: 'no tag "begin" — the tags are "other"' });
    expect(s.forgetTag('other').ok).toBe(true);
    expect(s.forgetTag('other')).toEqual({ ok: false, rejected: 'no tag "other" — the tags are none' });
    expect(s.tag('begin')).toMatchObject({ ok: true, tag: { id: 't3' } }); // the NAME is free again; the NUMBERS t1 and t2 are spent for the life of the store
  });

  it('a note links a tag by its ID (the prose world\'s beats are the tag ids); the refusal names the words the ref shows, or the id when it shows none; a tag off the cursor\'s path still lists', async () => {
    const s = fresh().createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    const party = s.tag('party');
    expect(party.ok).toBe(true);
    if (!party.ok) return;
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Work', cause: userCause('a branch') });
    expect(s.tag('work').ok).toBe(true);
    expect(s.tags().map((t) => [t.id, t.name])).toEqual([['t1', 'party'], ['t2', 'work']]); // both, across branches
    const ok = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[party]', author: { kind: 'human' }, refs: [{ span: [4, 12], beat: party.tag.id, label: 'party' }] }, cause: userCause() });
    expect(ok.ok).toBe(true);
    const bad = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see @[ghost]', author: { kind: 'human' }, refs: [{ span: [4, 12], beat: 't9', label: 'ghost' }] }, cause: userCause() });
    expect(!bad.ok && bad.rejection.detail).toBe('"note:n2".caption.refs[0] points at a beat that was never named: "ghost" (t9)'); // the words AND the id behind them
    const bare = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see it', author: { kind: 'human' }, refs: [{ span: [4, 6], beat: 't9' }] }, cause: userCause() });
    expect(!bare.ok && bare.rejection.detail).toBe('"note:n2".caption.refs[0] points at a beat that was never named: "t9" — the beats are "party", "work"'); // no words to show: the id, and what DOES exist
  });

  it('restoreTags puts tags back whole — judged, never re-stamped, refusing a commit the log does not hold — through the session or the dashboard; the store is shared', async () => {
    const dash = fresh();
    const s = dash.createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const older = { name: 'older', commitId: aId, by: 'agent' as const, at: '2020-01-01T00:00:00.000Z', description: 'kept' };
    const r = s.restoreTags([
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
    expect(r.reidentified).toEqual([{ name: 'older', id: 't1' }]); // it carried no id, so the store named it — and said so
    expect(r.refused).toEqual([
      { name: '(unnamed)', rejected: 'a tag needs a name' },
      { name: '(unnamed)', rejected: 'a tag needs a name' },
      { name: 'x'.repeat(201), rejected: 'a tag name is at most 200 characters' },
      { name: 'older', rejected: '"older" is already a tag — rename or forget it first' },
      { name: 'no commit', rejected: 'a tag names a commit' },
      { name: 'gone', rejected: 'no commit "zzz" in the log' },
      { name: 'no who', rejected: 'a tag carries who made it and when' },
      { name: 'bad words', rejected: "a tag's description is words" },
    ]);
    expect(s.tag('newer').ok).toBe(true);
    expect(s.tags().map((t) => t.name)).toEqual(['older', 'newer']); // oldest first by `at`
    expect(s.tags()[0]).toEqual({ ...older, id: 't1' });
    expect(dash.tags().map((t) => t.name)).toEqual(['older', 'newer']);
    expect(dash.restoreTags([{ ...older, name: 'from the host' }]).restored).toEqual(['from the host']); // the dashboard cannot check the commit: a host's own truth
    const b = dash.createSession();
    expect(b.tags().map((t) => t.name)).toEqual(['older', 'from the host', 'newer']); // the host's record kept its 2020 time
    // a host's tag with NO words, on a moment this session's log does not hold: the dashboard cannot check the commit,
    // so it lists — and the wire's checkpoint view says its position is -1, honestly outside this log.
    const hostOnly = { name: 'host only', commitId: 'unknown-commit', by: 'user' as const, at: '2021-06-01T00:00:00.000Z' };
    expect(dash.restoreTags([hostOnly]).restored).toEqual(['host only']);
    expect(s.tags().find((t) => t.name === 'host only')).toEqual({ ...hostOnly, id: 't4' }); // no description property invented
    expect(s.checkpoints().find((c) => c.label === 'host only')).toEqual({ id: 't4', label: 'host only', commitId: 'unknown-commit', at: 'unknown-commit', ts: -1 });
    (dash.tags()[0] as { name: string }).name = 'hacked';
    expect(dash.tags()[0]!.name).toBe('older');
  });

  it('a restored tag KEEPS the id it carries when the store has room for it, and is renamed only when it must be — never silently', async () => {
    const s = fresh().createSession();
    const a = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const one = { commitId: aId, by: 'user' as const, at: '2020-01-01T00:00:00.000Z' };
    // a host's own ids come back untouched, edit stamps and all; the store's next number is one past the highest it can see
    // …including ids that are not this store's shape at all (another system's names): they are kept, and skipped when the next number is worked out
    expect(s.restoreTags([{ ...one, name: 'one', id: 't7' }, { ...one, name: 'two', id: 't3', editedBy: 'agent' as const, editedAt: '2021-02-02T00:00:00.000Z' }, { ...one, name: 'odd', id: 'x9' }, { ...one, name: 'odder', id: 't-old' }])).toEqual({ restored: ['one', 'two', 'odd', 'odder'], refused: [], reidentified: [] });
    expect(s.tags().map((t) => [t.id, t.name, t.editedBy])).toEqual([['t7', 'one', undefined], ['t3', 'two', 'agent'], ['x9', 'odd', undefined], ['t-old', 'odder', undefined]]);
    expect(s.tag('fresh')).toMatchObject({ ok: true, tag: { id: 't8' } }); // one past the highest `t` number — "x9" and "t-old" name no number of this store's
    // an id another tag already holds cannot be kept: the store names the record and says what it arrived with
    const clash = s.restoreTags([{ ...one, name: 'three', id: 't7' }]);
    expect(clash.reidentified).toEqual([{ name: 'three', id: 't9', was: 't7' }]);
    expect(s.tags().find((t) => t.name === 'three')!.id).toBe('t9');
    // a shape that is not an id, and an edit stamp that is not who-and-when, are refused in words
    expect(s.restoreTags([{ ...one, name: 'bad id', id: '  ' }, { ...one, name: 'worse id', id: 5 as unknown as string }, { ...one, name: 'bad edit', editedBy: 7 as unknown as 'user' }]).refused).toEqual([
      { name: 'bad id', rejected: "a tag's id, when it carries one, is a short name" },
      { name: 'worse id', rejected: "a tag's id, when it carries one, is a short name" },
      { name: 'bad edit', rejected: 'a tag that was edited carries who edited it and when' },
    ]);
  });
});
