/**
 * SAVED SELECTIONS ARE SAVED LOGIC: a named picture — one condition per view —
 * beside the log, never a commit and never a pointer to one. Saving lands
 * nothing; applying is the ordinary act, one commit per condition under one
 * cause and one correlation id, replacing the other live filters (or layering
 * onto them), honest per condition about what could not land; renaming and
 * forgetting change the store with the author kept; an older log's
 * annotation-saved selections still read as one-condition pictures; a note's
 * `@[name]` ref names one.
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

  it('a rename or a forget is refused while words on screen link the name — a note or the dashboard\'s caption — and allowed once the link is gone', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(s.saveSelection('coastal', { live: 'all' }).ok).toBe(true);
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[coastal]', author: { kind: 'human' }, refs: [{ span: [4, 14], saved: 'coastal' }] }, cause: userCause() });
    await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: '@[coastal] matters', author: { kind: 'human' }, refs: [{ span: [0, 10], saved: 'coastal' }] }, cause: userCause() });
    expect(s.renameSaved('coastal', 'coast')).toEqual({ ok: false, rejected: '"coastal" is linked from note n1, dashboard — change the link in the words first' });
    expect(s.forgetSaved('coastal')).toEqual({ ok: false, rejected: '"coastal" is linked from note n1, dashboard — change the link in the words first' });
    expect(s.renameSaved('coastal', 'coastal').ok).toBe(true); // a rename to itself breaks nothing
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: null, cause: userCause('drop the note') });
    await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: 'plain', author: { kind: 'human' } }, cause: userCause() });
    expect(s.renameSaved('coastal', 'coast').ok).toBe(true);
    expect(s.forgetSaved('coast').ok).toBe(true);
  });

  it('a forgotten store entry never comes back from a legacy annotation under the same name', async () => {
    const s = fresh().createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    await s.dispatch({ verb: 'annotate', target: pick.ok ? pick.commit!.id : '', note: 'same', cause: userCause() });
    expect(s.saved().map((c) => c.name)).toEqual(['same']); // the legacy one
    expect(s.renameSaved('same', 'mine').ok).toBe(true); // taken over into the store under a new name
    expect(s.forgetSaved('mine').ok).toBe(true);
    expect(s.saved()).toEqual([]); // neither "mine" nor the legacy "same" is back
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
    expect(s.saved()[1]).toEqual(newer); // whole: by, at, on kept, not re-stamped
    expect(dash.saved().map((c) => c.name)).toEqual(['newer', 'older']);
    expect(dash.restoreSaved([older]).refused).toHaveLength(1);
    // copies: a consumer cannot reach into the store — through the session or the dashboard
    (s.saved()[0]!.conditions as unknown as unknown[]).push('x');
    (dash.saved()[0]!.conditions as unknown as unknown[]).push('y');
    expect(s.saved()[0]!.conditions).toHaveLength(1);
    expect(dash.saved()[0]!.conditions).toHaveLength(1);
    // a rename keeps `on` and `from`; an apply reads the copy
    expect(s.renameSaved('newer', 'newest')).toMatchObject({ ok: true, saved: { on: { version: 'v3' } } });
    const applied = await s.applySaved('newest', userCause());
    expect(applied.ok && applied.applied[0]!.value).toBe('Formal');
  });

  it('renaming keeps the picture and stamps the new author and time; forgetting removes it; both refuse an unknown name and a taken name', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(s.saveSelection('a', { live: 'all' }).ok).toBe(true);
    expect(s.saveSelection('b', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Party' }] }).ok).toBe(true);
    expect(s.renameSaved('a', ' ')).toEqual({ ok: false, rejected: 'a saved selection needs a name' });
    expect(s.renameSaved('zzz', 'y')).toEqual({ ok: false, rejected: 'no saved selection "zzz" — the saved ones are "a", "b"' });
    expect(s.renameSaved('a', 'b')).toEqual({ ok: false, rejected: '"b" is already saved — rename or forget it first' });
    const renamed = s.renameSaved('a', 'formal', 'agent');
    expect(renamed).toMatchObject({ ok: true, saved: { name: 'formal', conditions: [{ value: 'Formal' }], by: 'agent' } });
    expect(s.renameSaved('formal', 'formal').ok).toBe(true); // a rename to itself is allowed
    expect(s.saved().map((c) => c.name).sort()).toEqual(['b', 'formal']); // a rename re-stamps the time, so it may sort after 'b'
    expect(s.forgetSaved('b')).toMatchObject({ ok: true, saved: { name: 'b' } });
    expect(s.forgetSaved('b')).toEqual({ ok: false, rejected: 'no saved selection "b" — the saved ones are "formal"' });
    expect(s.forgetSaved('formal').ok).toBe(true);
    expect(s.saveSelection('formal', { live: 'all' }).ok).toBe(true); // the name is free again
    expect(s.renameSaved('formal', 'x').ok).toBe(true);
    expect(s.forgetSaved('x').ok).toBe(true);
    expect(s.forgetSaved('x')).toEqual({ ok: false, rejected: 'no saved selection "x" — the saved ones are none' });
  });

  it('an older log\'s annotation-saved selections still read as one-condition pictures (newest per commit and per name), a store name shadows a legacy one, and a forgotten legacy one stays forgotten', async () => {
    const s = fresh().createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const pickId = pick.ok ? pick.commit!.id : '';
    await s.dispatch({ verb: 'annotate', target: pickId, note: 'coastal', cause: userCause('save it the old way') });
    await s.dispatch({ verb: 'annotate', target: pickId, note: 'coastal again', cause: userCause('renamed the old way') }); // newest per commit wins
    await s.dispatch({ verb: 'annotate', target: 'scatter', note: 'a note on a view, not a save', cause: userCause() });
    const legacy = s.saved();
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ name: 'coastal again', conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }], by: 'user', from: [pickId] });
    expect(typeof legacy[0]!.at).toBe('string');
    const applied = await s.applySaved('coastal again', userCause());
    expect(applied.ok && applied.applied[0]!.value).toBe('Formal');
    expect(s.renameSaved('coastal again', 'coast')).toMatchObject({ ok: true, saved: { name: 'coast' } }); // taken over into the store; the log keeps its annotation
    expect(s.saved().map((c) => c.name)).toEqual(['coast']);
    expect(s.forgetSaved('coast').ok).toBe(true);
    expect(s.saved()).toEqual([]); // forgetting the store copy does not resurrect the legacy name
    await s.dispatch({ verb: 'annotate', target: pickId, note: 'shadowed', cause: userCause() });
    expect(s.saved().map((c) => c.name)).toEqual(['shadowed']);
    expect(s.forgetSaved('shadowed').ok).toBe(true);
    expect(s.saved()).toEqual([]);
    await s.dispatch({ verb: 'annotate', target: pickId, note: 'twice', cause: userCause() });
    expect(s.saveSelection('twice', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Party' }] })).toMatchObject({ ok: false });
    expect(s.forgetSaved('twice').ok).toBe(true);
    expect(s.saveSelection('twice', { conditions: [{ viewId: 'bar', kind: 'point', field: 'category', value: 'Party' }] })).toMatchObject({ ok: true });
    expect(s.saved().map((c) => [c.name, c.conditions[0]!.value])).toEqual([['twice', 'Party']]);
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

  it('a note may link a saved selection by name: the ref is judged against the saved names', async () => {
    const s = fresh().createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(s.saveSelection('coastal', { live: 'all' }).ok).toBe(true);
    const ok = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: { text: 'see @[coastal]', author: { kind: 'human' }, refs: [{ span: [4, 14], saved: 'coastal', label: 'coastal' }] }, cause: userCause('note') });
    expect(ok.ok).toBe(true);
    const bad = await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'see @[ghost]', author: { kind: 'human' }, refs: [{ span: [4, 12], saved: 'ghost' }] }, cause: userCause('note') });
    expect(!bad.ok && bad.rejection.detail).toContain('points at a saved selection that does not exist: "ghost"');
    const two = await s.dispatch({ verb: 'describe', viewId: 'note:n3', slot: 'caption', record: { text: 'x', author: { kind: 'human' }, refs: [{ span: [0, 1], saved: 'coastal', beat: 'b' }] }, cause: userCause('note') });
    expect(!two.ok && two.rejection.detail).toContain('must name exactly one of commit, beat, saved');
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

  it('a legacy annotation on a CELL selection reads as a cell condition with its pair', async () => {
    const s = fresh().createSession();
    const cell = await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [[50, 60], [1, 2]], cause: userCause() });
    await s.dispatch({ verb: 'annotate', target: cell.ok ? cell.commit!.id : '', note: 'old corner', cause: userCause() });
    expect(s.saved()[0]).toMatchObject({ name: 'old corner', conditions: [{ viewId: 'scatter', kind: 'cell', fields: ['price', 'rating'], value: [[50, 60], [1, 2]] }] });
    const applied = await s.applySaved('old corner', userCause());
    expect(applied.ok && applied.applied[0]!.kind).toBe('cell');
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
});
