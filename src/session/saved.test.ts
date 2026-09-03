/**
 * SAVED SELECTIONS ARE SAVED LOGIC: a named picture — one condition per view —
 * beside the log, never a commit and never a pointer to one. Saving lands
 * nothing; applying is the ordinary act, one commit per condition under one
 * cause and one correlation id, replacing the other live filters (or layering
 * onto them), honest per condition about what could not land; renaming and
 * forgetting change the store with the author kept; a note's `@[name]` ref
 * names one.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef());

describe('saved selections — saved logic beside the log', () => {
  it('saving the whole picture lands NO commit: one condition per live view, the author, the time, the data it was made on, and the commits it was named from', async () => {
    const s = fresh().createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick formal') });
    const brush = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause('brush') });
    const before = s.log.records.length;
    const r = s.saveSelection('coastal', { live: 'all' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saved).toMatchObject({
      name: 'coastal',
      conditions: [
        { viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' },
        { viewId: 'scatter', kind: 'interval', field: 'price', value: [60, 100] },
      ],
      by: 'user',
      on: { table: 'data', version: null }, // an inline table has no version
      from: [pick.ok ? pick.commit!.id : 'never', brush.ok ? brush.commit!.id : 'never'],
    });
    expect(Number.isNaN(Date.parse(r.saved.at))).toBe(false);
    expect(s.log.records).toHaveLength(before); // nothing on the rail
    expect((await s.overview()).saved).toEqual([r.saved]);
    // one view's clause alone; a match and a cell save their own shapes
    expect(s.saveSelection('just the bar', { viewId: 'bar' })).toMatchObject({ ok: true, saved: { conditions: [{ viewId: 'bar', value: 'Formal' }], from: [pick.ok ? pick.commit!.id : 'never'] } });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], exclude: true, cause: userCause('not these') });
    expect(s.saveSelection('not formal or party', { viewId: 'bar' })).toMatchObject({ ok: true, saved: { conditions: [{ kind: 'match', value: { values: ['Formal', 'Party'], exclude: true } }] } });
    await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[50, 60], [1, 2]], cause: userCause('cell') });
    expect(s.saveSelection('a cell', { viewId: 'scatter' })).toMatchObject({ ok: true, saved: { conditions: [{ kind: 'cell', fields: ['price', 'rating'], field: 'price × rating', value: [[50, 60], [1, 2]] }] } });
    expect((await s.overview()).saved.map((c) => c.name)).toEqual(['coastal', 'just the bar', 'not formal or party', 'a cell']);
  });

  it('refuses in words: a blank or taken name, nothing selected, an undeclared view, a view with nothing selected, an explicit condition missing its field, fields or value, no conditions at all', async () => {
    const s = fresh().createSession();
    expect(s.saveSelection('   ', { live: 'all' })).toEqual({ ok: false, rejected: 'a saved selection needs a name' });
    expect(s.saveSelection('x', { live: 'all' })).toEqual({ ok: false, rejected: 'nothing is selected to save' });
    expect(s.saveSelection('x', { viewId: 'ghost' })).toEqual({ ok: false, rejected: 'no declared view "ghost" — the views are scatter, bar, cluster, display' });
    expect(s.saveSelection('x', { viewId: 'bar' })).toEqual({ ok: false, rejected: '"bar" has nothing selected to save' });
    expect(s.saveSelection('x', { conditions: [] })).toEqual({ ok: false, rejected: 'a saved selection needs at least one condition' });
    expect(s.saveSelection('x', { conditions: [{ viewId: 'ghost', kind: 'point', field: 'category', value: 'Formal' }] })).toMatchObject({ ok: false, rejected: expect.stringContaining('no declared view "ghost"') });
    expect(s.saveSelection('c', { conditions: [{ viewId: 'scatter', kind: 'cell', field: '', value: [[1, 2], [3, 4]] }] })).toEqual({ ok: false, rejected: 'a cell condition on "scatter" needs its two fields' });
    expect(s.saveSelection('p', { conditions: [{ viewId: 'bar', kind: 'point', field: '', value: 'Formal' }] })).toEqual({ ok: false, rejected: 'a point condition on "bar" needs a field' });
    expect(s.saveSelection('v', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: undefined }] })).toEqual({ ok: false, rejected: 'the condition on "bar" needs a value — an interval its bounds, a match its values, a point its value' });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(s.saveSelection('one', { live: 'all' }).ok).toBe(true);
    expect(s.saveSelection(' one ', { live: 'all' })).toEqual({ ok: false, rejected: '"one" is already saved — rename or forget it first' });
    // explicit conditions are the store's own copies, and may name the agent
    const value = [40, 70];
    expect(s.saveSelection('twice on one view', { conditions: [{ viewId: 'scatter', kind: 'interval', field: 'price', value }, { viewId: 'scatter', kind: 'cell', field: 'x', fields: ['price', 'rating'], value: [[50, 60], [1, 2]] }] })).toEqual({ ok: false, rejected: 'the picture already has a condition on "scatter" — one condition per view' });
    expect(s.saveSelection('not a list', { conditions: 'x' as unknown as [] })).toEqual({ ok: false, rejected: 'a saved selection needs at least one condition' });
    const explicit = s.saveSelection('cheap', { conditions: [{ viewId: 'scatter', kind: 'interval', field: 'price', value }, { viewId: 'cluster', kind: 'cell', field: 'x', fields: ['price', 'rating'], value: [[50, 60], [1, 2]] }] }, 'agent');
    value.push(999);
    expect(explicit).toMatchObject({ ok: true, saved: { by: 'agent', conditions: [{ kind: 'interval', value: [40, 70] }, { viewId: 'cluster', kind: 'cell', field: 'price × rating', fields: ['price', 'rating'] }] } });
  });

  it('applying replaces the picture by default: the other live filters are cleared, each condition lands as its own commit, all under one cause and one correlation id; layer keeps what is selected', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause() });
    expect(s.saveSelection('coastal', { live: 'all' }).ok).toBe(true);
    // a different picture is live now: the bar cleared, a cell on the scatter, a match on the bar
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear') });
    await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[50, 60], [1, 2]], cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Party'], cause: userCause() });
    expect(s.saveSelection('other', { live: 'all' }).ok).toBe(true);
    const before = s.log.records.length;
    const r = await s.applySaved('coastal', userCause());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('coastal');
    expect(r.refused).toEqual([]);
    expect(r.cleared).toEqual([]); // both live views are named by the picture: nothing to clear
    expect(r.applied.map((c) => [c.viewId, c.kind, c.value])).toEqual([
      ['bar', 'point', 'Formal'],
      ['scatter', 'interval', [60, 100]],
    ]);
    expect(r.applied.every((c) => c.cause.intent === 'applied saved selection coastal' && c.correlationId === r.correlationId)).toBe(true);
    expect(s.log.records).toHaveLength(before + 2);
    expect((await s.overview()).selectedRowCount).toBe(4); // Formal AND 60 ≤ price ≤ 100
    // replace clears a view the picture does not name — kind-faithfully — under the same correlation id
    await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('a third view') });
    const again = await s.applySaved('coastal', userCause('bring it back'));
    expect(again.ok && again.cleared.map((c) => [c.viewId, c.value])).toEqual([['cluster', undefined]]);
    expect(again.ok && again.cleared[0]!.correlationId).toBe(again.ok ? again.correlationId : 'never');
    expect(again.ok && again.applied[0]!.cause.intent).toBe('bring it back — applied saved selection coastal'); // the name always rides the cause
    expect((await s.overview()).activeSelections.map((a) => a.viewId).sort()).toEqual(['bar', 'scatter']);
    // layer keeps the third view's clause and the actor can be the agent
    await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause() });
    const layered = await s.applySaved('other', userCause(), { mode: 'layer', as: 'agent' });
    expect(layered.ok && layered.cleared).toEqual([]);
    expect(layered.ok && layered.applied.map((c) => c.cause.requestedBy)).toEqual(['agent', 'agent']);
    expect((await s.overview()).activeSelections.map((a) => a.viewId).sort()).toEqual(['bar', 'cluster', 'scatter']);
    expect(await s.applySaved('nope', userCause())).toEqual({ ok: false, rejected: 'no saved selection "nope" — the saved ones are "coastal", "other"' });
  });

  it('judges first, clears second: a condition on a missing column or a vanished view is refused before anything is touched; a picture that could land nothing clears nothing and answers ok: false', async () => {
    const dash = fresh();
    const s = dash.createSession();
    expect(s.saveSelection('mixed', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }, { viewId: 'scatter', kind: 'interval', field: 'ghost', value: [1, 2] }] }).ok).toBe(true);
    expect(s.saveSelection('only ghost', { conditions: [{ viewId: 'scatter', kind: 'cell', field: 'x', fields: ['price', 'ghost'], value: [[1, 2], [3, 4]] }] }).ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause('the analyst\'s own picture') });
    const before = s.log.records.length;
    // nothing could land: refused whole, the live picture untouched, no commit
    const none = await s.applySaved('only ghost', userCause());
    expect(none).toEqual({ ok: false, rejected: '"only ghost" cannot be applied here — table "data" no longer has the column "ghost"' });
    expect(s.log.records).toHaveLength(before);
    expect((await s.overview()).activeSelections.map((a) => a.viewId)).toEqual(['cluster']);
    // partly: the bar lands, the ghost is refused with the table's sentence, the cluster is cleared to make room
    const r = await s.applySaved('mixed', userCause());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.applied.map((c) => c.viewId)).toEqual(['bar']);
    expect(r.cleared.map((c) => c.viewId)).toEqual(['cluster']);
    expect(r.refused).toEqual([{ viewId: 'scatter', rejected: 'table "data" no longer has the column "ghost"' }]);
    // a view that is gone: the store keeps the condition; applying names the loss
    const store = (s as unknown as { runtime: { views: Map<string, unknown> } }).runtime;
    store.views.delete('scatter');
    const gone = await s.applySaved('mixed', userCause());
    expect(gone.ok && gone.refused).toEqual([{ viewId: 'scatter', rejected: '"scatter" is no longer on the dashboard' }]);
    expect(s.saved().find((c) => c.name === 'mixed')!.conditions).toHaveLength(2);
  });

  it('a replace never leaves a ghost: the clears it makes are marked as making room, so a link\'s onClear "leave" does not remember the old picture', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', onClear: 'leave', cause: userCause('leave it') });
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause() });
    expect(s.saveSelection('mid', { live: 'all' }).ok).toBe(true);
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: null, cause: userCause('clear') });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('a pick the picture does not name') });
    const r = await s.applySaved('mid', userCause());
    expect(r.ok && r.cleared.map((c) => [c.viewId, c.cause.replacedBy])).toEqual([['bar', 'mid']]);
    expect(s.clausesFor('scatter')).toEqual([]); // no remembered "Party" filters the scatter
    expect((await s.overview()).clearedSelections ?? []).toEqual([]);
    // a person's own clear on the same edge IS remembered — the rule is about who cleared, not the edge
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause() });
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('a real clear') });
    expect(s.clausesFor('scatter')).toMatchObject([{ from: 'bar', clause: { value: 'Party' } }]);
  });

  it('renaming is FREE while words on screen link the picture (they link its id, not its name); forgetting is still refused until the link is gone', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const made = s.saveSelection('coastal', { live: 'all' });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const id = made.saved.id;
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[coastal]', author: { kind: 'human' }, refs: [{ span: [4, 14], saved: id, label: 'coastal' }] }, cause: userCause() });
    await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: '@[coastal] matters', author: { kind: 'human' }, refs: [{ span: [0, 10], saved: id, label: 'coastal' }] }, cause: userCause() });
    // the rename lands: the words still point at the same picture, and only the label they show is now stale
    expect(s.renameSaved('coastal', 'coast')).toMatchObject({ ok: true, saved: { id, name: 'coast' } });
    expect(s.saved().map((c) => [c.id, c.name])).toEqual([[id, 'coast']]);
    // forgetting really would break the link, so it is refused — naming the words that hold it
    expect(s.forgetSaved('coast')).toEqual({ ok: false, rejected: '"coast" is linked from note n1, dashboard — change the link in the words first' });
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: null, cause: userCause('drop the note') });
    await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: 'plain', author: { kind: 'human' } }, cause: userCause() });
    expect(s.forgetSaved('coast').ok).toBe(true);
  });

  it('restoreSaved puts pictures back whole — who, when and on-what kept, judged, refused in words — and the list reads oldest first by the time saved; a consumer gets copies', async () => {
    const dash = fresh();
    const s = dash.createSession();
    const newer = { name: 'newer', conditions: [{ viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal' }], by: 'agent' as const, at: '2021-05-05T00:00:00.000Z', on: { table: 'data', version: 'v3' } };
    const older = { name: 'older', conditions: [{ viewId: 'scatter', kind: 'interval' as const, field: 'price', value: [1, 2] }], by: 'user' as const, at: '2020-01-01T00:00:00.000Z' };
    const r = s.restoreSaved([
      newer,
      older,
      { ...older, name: '  ' },
      { ...older, name: 'older' },
      { ...older, name: 'empty', conditions: [] },
      { ...older, name: 'no who', by: undefined as unknown as 'user' },
      { ...older, name: 'ghost view', conditions: [{ viewId: 'ghost', kind: 'point', field: 'category', value: 1 }] },
      { ...older, name: 'twice', conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 1 }, { viewId: 'bar', kind: 'point', field: 'category', value: 2 }] },
      { ...older, name: 'bad kind', conditions: [{ viewId: 'bar', kind: 'wobble' as never, field: 'category', value: 1 }] },
      { ...older, name: 'no field', conditions: [{ viewId: 'bar', kind: 'point', field: '', value: 1 }] },
      { ...older, name: 'no pair', conditions: [{ viewId: 'bar', kind: 'cell', field: 'x', value: 1 }] },
      { ...older, name: 'no value', conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: undefined }] },
      { ...older, name: 5 as unknown as string },
      { ...older, name: 'one of a pair', conditions: [{ viewId: 'bar', kind: 'cell', field: 'x', fields: ['price'] as unknown as [string, string], value: 1 }] },
      { ...older, name: 'view is a number', conditions: [{ viewId: 7 as unknown as string, kind: 'point', field: 'category', value: 1 }] },
    ]);
    expect(r.restored).toEqual(['newer', 'older']);
    expect(r.reidentified).toEqual([{ name: 'newer', id: 'p1' }, { name: 'older', id: 'p2' }]); // neither carried an id, so the store named them — and said so
    expect(r.refused).toEqual([
      { name: '(unnamed)', rejected: 'a saved selection needs a name' },
      { name: 'older', rejected: '"older" is already saved — rename or forget it first' },
      { name: 'empty', rejected: 'a saved selection needs at least one condition' },
      { name: 'no who', rejected: 'a saved selection carries who saved it and when' },
      { name: 'ghost view', rejected: 'no declared view "ghost"' },
      { name: 'twice', rejected: 'the picture already has a condition on "bar" — one condition per view' },
      { name: 'bad kind', rejected: '"wobble" is not a condition kind' },
      { name: 'no field', rejected: 'a point condition on "bar" needs a field' },
      { name: 'no pair', rejected: 'a cell condition on "bar" needs its two fields' },
      { name: 'no value', rejected: 'the condition on "bar" needs a value' },
      { name: '(unnamed)', rejected: 'a saved selection needs a name' },
      { name: 'one of a pair', rejected: 'a cell condition on "bar" needs its two fields' },
      { name: 'view is a number', rejected: 'no declared view "7"' },
    ]);
    expect(s.saved().map((c) => c.name)).toEqual(['older', 'newer']); // oldest first by `at`, whatever order they were put back in
    expect(s.saved()[1]).toEqual({ ...newer, id: 'p1' }); // whole: by, at, on kept, not re-stamped — with the id the store gave it
    expect(dash.saved().map((c) => c.name)).toEqual(['newer', 'older']);
    expect(dash.restoreSaved([older]).refused).toHaveLength(1);
    // copies: a consumer cannot reach into the store — through the session or the dashboard
    (s.saved()[0]!.conditions as unknown as unknown[]).push('x');
    (dash.saved()[0]!.conditions as unknown as unknown[]).push('y');
    expect(s.saved()[0]!.conditions).toHaveLength(1);
    expect(dash.saved()[0]!.conditions).toHaveLength(1);
    // a rename keeps the id, `on` and `from`, and the creation stamp — the edit is recorded beside it
    expect(s.renameSaved('newer', 'newest')).toMatchObject({ ok: true, saved: { id: 'p1', on: { version: 'v3' }, by: 'agent', at: newer.at, editedBy: 'user' } });
    const applied = await s.applySaved('newest', userCause());
    expect(applied.ok && applied.applied[0]!.value).toBe('Formal');
  });

  it('renaming keeps the picture, its id and its creation stamp — the edit is recorded beside them, so the list never reorders; forgetting removes it; both refuse an unknown name and a taken name', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const a = s.saveSelection('a', { live: 'all' });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(s.saveSelection('b', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Party' }] }).ok).toBe(true);
    expect(s.renameSaved('a', ' ')).toEqual({ ok: false, rejected: 'a saved selection needs a name' });
    expect(s.renameSaved('zzz', 'y')).toEqual({ ok: false, rejected: 'no saved selection "zzz" — the saved ones are "a", "b"' });
    expect(s.renameSaved('a', 'b')).toEqual({ ok: false, rejected: '"b" is already saved — rename or forget it first' });
    const renamed = s.renameSaved('a', 'formal', 'agent');
    expect(renamed).toMatchObject({ ok: true, saved: { id: 'p1', name: 'formal', conditions: [{ value: 'Formal' }], by: 'user', editedBy: 'agent' } }); // who SAVED it stays 'user'; the renamer rides `editedBy`
    expect(renamed.ok && renamed.saved.at).toBe(a.saved.at); // the time it was saved, untouched
    expect(renamed.ok && Number.isNaN(Date.parse(renamed.saved.editedAt!))).toBe(false);
    const untouched = s.saved().find((c) => c.name === 'b')!;
    expect(s.renameSaved('b', 'b')).toEqual({ ok: true, saved: untouched }); // a rename to itself is allowed AND records nothing: no editedBy, no editedAt
    expect(s.renameSaved('formal', 'formal').ok).toBe(true);
    expect(s.saved().map((c) => c.name)).toEqual(['formal', 'b']); // the order the pictures were saved in — a rename cannot move a row
    expect(s.forgetSaved('b')).toMatchObject({ ok: true, saved: { name: 'b' } });
    expect(s.forgetSaved('b')).toEqual({ ok: false, rejected: 'no saved selection "b" — the saved ones are "formal"' });
    expect(s.forgetSaved('formal').ok).toBe(true);
    expect(s.saveSelection('formal', { live: 'all' }).ok).toBe(true); // the NAME is free again
    expect(s.saved().map((c) => c.id)).toEqual(['p3']); // the NUMBER is not: p1 and p2 are spent for the life of the store, so no words anywhere in the history can be re-pointed
    expect(s.renameSaved('formal', 'x').ok).toBe(true);
    expect(s.forgetSaved('x').ok).toBe(true);
    expect(s.forgetSaved('x')).toEqual({ ok: false, rejected: 'no saved selection "x" — the saved ones are none' });
  });

  it('the store is the dashboard\'s, shared by every session, and read off the dashboard too', async () => {
    const dash = fresh();
    const a = dash.createSession();
    const b = dash.createSession();
    await a.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(a.saveSelection('formal', { live: 'all' }).ok).toBe(true);
    expect(b.saved().map((c) => c.name)).toEqual(['formal']);
    expect(dash.saved().map((c) => c.name)).toEqual(['formal']);
    const applied = await b.applySaved('formal', userCause());
    expect(applied.ok && applied.applied[0]!.value).toBe('Formal');
  });

  it('a note links a saved selection by its ID: the ref is judged against the ids, and the refusal names the words the ref shows (its id when it shows none)', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const made = s.saveSelection('coastal', { live: 'all' });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const ok = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[coastal]', author: { kind: 'human' }, refs: [{ span: [4, 14], saved: made.saved.id, label: 'coastal' }] }, cause: userCause('note') });
    expect(ok.ok).toBe(true);
    const bad = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see @[ghost]', author: { kind: 'human' }, refs: [{ span: [4, 12], saved: 'p9', label: 'ghost' }] }, cause: userCause('note') });
    expect(!bad.ok && bad.rejection.detail).toBe('"note:n2".caption.refs[0] points at a saved selection that does not exist: "ghost" (p9)');
    const bare = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see it', author: { kind: 'human' }, refs: [{ span: [4, 6], saved: 'p9' }] }, cause: userCause('note') });
    expect(!bare.ok && bare.rejection.detail).toBe('"note:n2".caption.refs[0] points at a saved selection that does not exist: "p9" — the pictures are "coastal"'); // no words to show: the id, and what DOES exist
    // the words a ref shows can name a picture that exists while the id it links does not — the sentence must not read as if the picture were missing
    expect(s.saveSelection('ghost', { live: 'all' }).ok).toBe(true);
    const both = await s.dispatch({ verb: 'describe', viewId: 'note:n4', slot: 'caption', record: { text: 'see @[ghost]', author: { kind: 'human' }, refs: [{ span: [4, 12], saved: 'p9', label: 'ghost' }] }, cause: userCause('note') });
    expect(!both.ok && both.rejection.detail).toBe('"note:n4".caption.refs[0] points at a saved selection that does not exist: "ghost" (p9)'); // "ghost" is right there in the list; p9 is what the words link
    const two = await s.dispatch({ verb: 'describe', viewId: 'note:n3', slot: 'caption', record: { text: 'x', author: { kind: 'human' }, refs: [{ span: [0, 1], saved: made.saved.id, bookmark: 'b' }] }, cause: userCause('note') });
    expect(!two.ok && two.rejection.detail).toContain('must name exactly one of commit, bookmark, saved');
  });

  it('a restored picture KEEPS the id it carries when the store has room for it, and is renamed only when it must be — never silently', async () => {
    const s = fresh().createSession();
    const one = { name: 'one', conditions: [{ viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal' }], by: 'user' as const, at: '2020-01-01T00:00:00.000Z' };
    // a host's own ids come back untouched, and the store's next number is one past the highest it can see
    expect(s.restoreSaved([{ ...one, id: 'p7' }, { ...one, name: 'two', id: 'p3', editedBy: 'agent' as const, editedAt: '2021-02-02T00:00:00.000Z' }])).toEqual({ restored: ['one', 'two'], refused: [], reidentified: [] });
    expect(s.saved().map((c) => [c.id, c.name, c.editedBy])).toEqual([['p7', 'one', undefined], ['p3', 'two', 'agent']]);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(s.saveSelection('fresh', { live: 'all' })).toMatchObject({ ok: true, saved: { id: 'p8' } });
    // an id another record already holds cannot be kept: the store names the record and says what it arrived with
    const clash = s.restoreSaved([{ ...one, name: 'three', id: 'p7' }]);
    expect(clash.reidentified).toEqual([{ name: 'three', id: 'p9', was: 'p7' }]);
    expect(s.saved().find((c) => c.name === 'three')!.id).toBe('p9');
    // a shape that is not an id, and an edit stamp that is not who-and-when, are refused in words
    expect(s.restoreSaved([{ ...one, name: 'bad id', id: '  ' }, { ...one, name: 'worse id', id: 5 as unknown as string }, { ...one, name: 'bad edit', editedAt: 7 as unknown as string }]).refused).toEqual([
      { name: 'bad id', rejected: "a saved selection's id, when it carries one, is a short name" },
      { name: 'worse id', rejected: "a saved selection's id, when it carries one, is a short name" },
      { name: 'bad edit', rejected: 'a saved selection that was edited carries who edited it and when' },
    ]);
  });

  it('every kind lands and every kind clears: an excluding match and a cell apply through their own doors; replace clears a cell, a match and an interval it does not name', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], exclude: true, cause: userCause() });
    expect(s.saveSelection('not these', { live: 'all' }).ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[50, 60], [1, 2]], cause: userCause() });
    expect(s.saveSelection('corner', { viewId: 'scatter' }).ok).toBe(true);
    expect(s.saveSelection('cluster only', { conditions: [{ viewId: 'cluster', kind: 'point', field: 'category', value: 'Work' }] }).ok).toBe(true);
    // live now: a match on the bar, a cell on the scatter — apply the cluster-only picture: both are cleared kind-faithfully
    const r = await s.applySaved('cluster only', userCause());
    expect(r.ok && r.cleared.map((c) => [c.viewId, c.kind, c.value])).toEqual([
      ['bar', 'match', null],
      ['scatter', 'cell', null],
    ]);
    expect(r.ok && r.applied.map((c) => c.viewId)).toEqual(['cluster']);
    // an interval is cleared too, and the excluding match and the cell apply
    await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 100], cause: userCause() });
    const notThese = await s.applySaved('not these', userCause());
    expect(notThese.ok && notThese.cleared.map((c) => [c.viewId, c.kind])).toEqual([['cluster', 'point'], ['scatter', 'interval']]);
    expect(notThese.ok && notThese.applied[0]).toMatchObject({ viewId: 'bar', kind: 'match', value: { values: ['Formal', 'Party'], exclude: true } });
    const corner = await s.applySaved('corner', userCause(), { mode: 'layer' });
    expect(corner.ok && corner.applied[0]).toMatchObject({ viewId: 'scatter', kind: 'cell' });
    expect((await s.overview()).activeSelections.map((a) => a.viewId).sort()).toEqual(['bar', 'scatter']);
  });

  it('the pre-flight also judges a view\'s capability: a condition on a view that cannot be probed is refused before anything is cleared', async () => {
    const s = fresh().createSession();
    expect(s.saveSelection('on display', { conditions: [{ viewId: 'display', kind: 'point', field: 'category', value: 'Formal' }] }).ok).toBe(true);
    expect(s.saveSelection('display and bar', { conditions: [{ viewId: 'display', kind: 'point', field: 'category', value: 'Formal' }, { viewId: 'bar', kind: 'point', field: 'category', value: 'Party' }] }).ok).toBe(true);
    await s.dispatch({ verb: 'select', viewId: 'cluster', field: 'category', value: 'Work', cause: userCause() });
    const before = s.log.records.length;
    const alone = await s.applySaved('on display', userCause());
    expect(!alone.ok && alone.rejected).toContain('declares no-probe capability');
    expect(s.log.records).toHaveLength(before); // nothing cleared, nothing landed
    const mixed = await s.applySaved('display and bar', userCause());
    expect(mixed.ok && mixed.applied.map((c) => c.viewId)).toEqual(['bar']);
    expect(mixed.ok && mixed.refused.map((r) => r.viewId)).toEqual(['display']);
    expect(mixed.ok && mixed.cleared.map((c) => c.viewId)).toEqual(['cluster']);
  });

  it('an engine that cannot list columns refuses the whole apply before anything is cleared — the same answer the select door would give, said first', async () => {
    const s = buildDashboard(makeDashboardDef({ engine: 'wasm' })).createSession();
    expect(s.saveSelection('on a stub', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }] }).ok).toBe(true);
    const before = s.log.records.length;
    const r = await s.applySaved('on a stub', userCause());
    expect(!r.ok && r.rejected.startsWith('"on a stub" cannot be applied here — ')).toBe(true);
    expect(s.log.records).toHaveLength(before);
  });

  it('the number a picture carried is SPENT: time travel gets past the words-on-screen guard, but the freed number never comes back', async () => {
    const s = fresh().createSession();
    const first = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const beforeTheNote = first.ok ? first.commit!.id : '';
    expect(s.saveSelection('coastal', { live: 'all' })).toMatchObject({ ok: true, saved: { id: 'p1' } });
    const note = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[coastal]', author: { kind: 'human' }, refs: [{ span: [4, 14], saved: 'p1', label: 'coastal' }] }, cause: userCause('note') });
    const atTheNote = note.ok ? note.commit!.id : '';
    // at the note the guard holds: the words on screen link the picture
    expect(s.forgetSaved('coastal')).toEqual({ ok: false, rejected: '"coastal" is linked from note n1 — change the link in the words first' });
    // one seek and the note is off screen — the guard folds the prose to the CURSOR, so it cannot see the link, and the forget goes through
    s.seek(beforeTheNote);
    expect(s.forgetSaved('coastal').ok).toBe(true);
    // THE FIX: the next picture gets a NEW number. Before it, this saved 'inland' as p1 and the note came back
    // pointing at a different picture — a wrong filter nobody could see.
    expect(s.saveSelection('inland', { live: 'all' })).toMatchObject({ ok: true, saved: { id: 'p2' } });
    s.seek(atTheNote);
    expect(s.saved().map((c) => [c.id, c.name])).toEqual([['p2', 'inland']]);
    // the note's ref is now a DEAD link, and the validator says so in words — the honest failure, not a silent one
    const dead = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see @[coastal]', author: { kind: 'human' }, refs: [{ span: [4, 14], saved: 'p1', label: 'coastal' }] }, cause: userCause('note') });
    expect(!dead.ok && dead.rejection.detail).toBe('"note:n2".caption.refs[0] points at a saved selection that does not exist: "coastal" (p1)');
  });

  it('a restored id names a number only when it is DIGITS, and a restored number is spent even after the record is forgotten', async () => {
    const s = fresh().createSession();
    const one = { name: 'one', conditions: [{ viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal' }], by: 'user' as const, at: '2020-01-01T00:00:00.000Z' };
    // `Number('1e3')` is 1000 and `Number('0x10')` is 16 — neither is a number of this store's, so a host restoring one cannot jump the numbering
    expect(s.restoreSaved([{ ...one, name: 'exponent', id: 'p1e3' }, { ...one, name: 'hex', id: 'p0x10' }]).restored).toEqual(['exponent', 'hex']);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(s.saveSelection('fresh', { live: 'all' })).toMatchObject({ ok: true, saved: { id: 'p1' } });
    // a restored `p7` raises the counter, so `p7` is never minted again — even once the record that carried it is gone from the list
    expect(s.restoreSaved([{ ...one, name: 'seven', id: 'p7' }]).reidentified).toEqual([]);
    expect(s.forgetSaved('seven').ok).toBe(true);
    expect(s.saveSelection('after', { live: 'all' })).toMatchObject({ ok: true, saved: { id: 'p8' } });
  });

  it('a restored picture carries only the fields a picture has — a host cannot smuggle anything else into the store, and its own arrays are copied', () => {
    const s = fresh().createSession();
    const conditions = [{ viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal' }];
    const from = ['s1'];
    const smuggled = { name: '  spaced  ', conditions, by: 'user' as const, at: '2020-01-01T00:00:00.000Z', on: { table: 'data', version: 'v1' }, from, editedBy: 'agent' as const, editedAt: '2021-02-02T00:00:00.000Z', secret: 'not a picture field', id: 'p2' };
    expect(s.restoreSaved([smuggled as never]).restored).toEqual(['spaced']); // the name is trimmed, as the bookmark restore trims its own
    expect(s.saved()[0]).toEqual({ id: 'p2', name: 'spaced', conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }], by: 'user', at: '2020-01-01T00:00:00.000Z', on: { table: 'data', version: 'v1' }, from: ['s1'], editedBy: 'agent', editedAt: '2021-02-02T00:00:00.000Z' });
    conditions.push({ viewId: 'scatter', kind: 'point', field: 'category', value: 'Party' });
    from.push('s2');
    expect(s.saved()[0]!.conditions).toHaveLength(1); // the store took copies: the host's later push cannot reach it
    expect(s.saved()[0]!.from).toEqual(['s1']);
  });
});
