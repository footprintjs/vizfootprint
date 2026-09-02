/**
 * Notes: the prose plane's other non-view subjects. A fresh `note:<id>` is
 * created by its first describe, judged by the same laws as the dashboard's
 * words, served on the overview while it has words, and gone when its last
 * slot goes back to nothing — its commits stay.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, validateDashboardDef } from '../def/index.js';
import { vizAsTools } from '../agent/vizAsTools.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { ProseRecord } from '../prose/index.js';
import { isNoteSubject } from '../prose/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

describe('notes', () => {
  it('a first describe creates the note; it rides the overview with its words, its refs and its status; null on every slot removes it', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    expect((await s.overview()).notes).toEqual([]);
    const sel = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick formal') });
    const selId = sel.ok ? sel.commit!.id : '';
    const beat = await s.dispatch({ verb: 'checkpoint', label: 'Formal wear', cause: userCause() });
    expect(beat.ok).toBe(true);
    const body: ProseRecord = { text: 'Formal wear dominates — see #sel and the @beat.', author: { kind: 'human', by: 'sanjay' }, refs: [{ span: [26, 30], commit: selId, label: 'pick formal' }, { span: [39, 44], beat: 'Formal wear', label: 'Formal wear' }] };
    const first = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: body, cause: userCause('write a note') });
    expect(first.ok).toBe(true);
    expect(first.ok && first.commit?.viewId).toBe('prose:note:n1');
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'title', record: { text: 'What formal wear does', author: { kind: 'human' } }, cause: userCause() });
    const o = await s.overview();
    expect(o.notes.map((n) => n.id)).toEqual(['n1']);
    expect(o.notes[0]!.prose.map((p) => [p.slot, p.status, p.text])).toEqual([
      ['title', 'current', 'What formal wear does'],
      ['caption', 'current', 'Formal wear dominates — see #sel and the @beat.'],
    ]);
    expect(o.notes[0]!.prose[1]!.refs).toHaveLength(2);
    expect(o.views.map((v) => v.viewId)).not.toContain('note:n1'); // a note is not a view
    // a second note keeps its own order; removing every slot of the first drops it from the overview, its commits stay
    await s.dispatch({ verb: 'describe', viewId: 'note:n2', slot: 'caption', record: { text: 'Second.', author: { kind: 'human' } }, cause: userCause() });
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'caption', record: null, cause: userCause('clear the body') });
    await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'title', record: null, cause: userCause('clear the title') });
    const after = await s.overview();
    expect(after.notes.map((n) => n.id)).toEqual(['n2']);
    expect(s.log.records.filter((r) => r.viewId === 'prose:note:n1')).toHaveLength(4);
    // seeking back before the clears shows the note again — words are commits like any act
    await s.seek(first.ok ? first.commit!.id : '');
    expect((await s.overview()).notes.map((n) => n.id)).toEqual(['n1']);
  });

  it('a note is judged like the dashboard: nothing derived, no encodings in a basis, a ref must point at a commit or beat that exists; a bad id is still a missing view', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const derived = await s.dispatch({ verb: 'describe', viewId: 'note:x', slot: 'caption', record: { author: { kind: 'derived' } }, cause: userCause() });
    expect(!derived.ok && derived.rejection.detail).toContain("a note's caption cannot be derived");
    const bound = await s.dispatch({ verb: 'describe', viewId: 'note:x', slot: 'caption', record: { text: 'x', author: { kind: 'agent' }, basis: { encodings: { x: 'price' } } }, cause: userCause() });
    expect(!bound.ok && bound.rejection.detail).toContain("a note's caption states encodings in its basis");
    const ghostRef = await s.dispatch({ verb: 'describe', viewId: 'note:x', slot: 'caption', record: { text: 'see #ghost', author: { kind: 'human' }, refs: [{ span: [4, 10], commit: 'ghost' }] }, cause: userCause() });
    expect(!ghostRef.ok && ghostRef.rejection.detail).toContain('points at a commit the log does not hold');
    const bare = await s.dispatch({ verb: 'describe', viewId: 'note:', slot: 'caption', record: { text: 'x', author: { kind: 'human' } }, cause: userCause() });
    expect(!bare.ok && bare.rejection.code).toBe('needs-view'); // "note:" with no id is not a note
    expect((await s.overview()).notes).toEqual([]);
  });

  it('an agent proposes a note like it proposes words; a person accepts it; the def door refuses a view in the note namespace', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const draft: ProseRecord = { text: 'Prices rise with rating.', author: { kind: 'agent', model: 'm' }, levels: ['trend'], basis: { filters: {} } };
    const proposed = await s.dispatch({ verb: 'describe', viewId: 'note:reply-1', slot: 'caption', record: draft, proposal: true, cause: userCause('draft a note') });
    expect(proposed.ok).toBe(true);
    const pending = await s.overview();
    expect(pending.notes).toEqual([]); // a proposal is not yet words on the dashboard
    const proposalId = proposed.ok ? proposed.commit!.id : '';
    const accepted = await s.dispatch({ verb: 'describe', viewId: 'note:reply-1', slot: 'caption', record: null, accept: proposalId, cause: userCause('add to the dashboard') });
    expect(accepted.ok).toBe(true);
    const o = await s.overview();
    expect(o.notes.map((n) => [n.id, n.prose[0]!.text, n.prose[0]!.record.author.kind])).toEqual([['reply-1', 'Prices rise with rating.', 'agent']]);
    expect(validateDashboardDef({ ...makeDashboardDef(), actors: { ...makeDashboardDef().actors, 'note:x': { actor: 'user' } } })).toEqual(['actors["note:x"]: a view id may not start with "note:" — the session lands its own commits under that namespace, so a view there would be inert in the fold and silently skipped when a path is adopted']);
    const tools = vizAsTools(s);
    const desc = (tools.tools().find((t) => t.name === 'viz.dispatch')!.inputSchema as { properties: { viewId: { description: string } } }).properties.viewId.description;
    expect(desc).toContain('"note:<id>"');
    const here = (await tools.call('viz.whats_here')) as { notes: { id: string }[] };
    expect(here.notes.map((n) => n.id)).toEqual(['reply-1']);
  });
  it('a note carries a title and a caption only — another slot is refused with that sentence, so nothing can sit on a note the cell cannot show or remove', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const r = await s.dispatch({ verb: 'describe', viewId: 'note:n1', slot: 'howToRead', record: { text: 'read me', author: { kind: 'agent' } }, cause: userCause() });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.rejection.detail).toBe('a note carries a title and a caption — "howToRead" is not a note slot');
    expect((await s.overview()).notes).toEqual([]);
  });
  it('a note id is id-shaped: blank, spaced or oddly-punctuated ids are not notes (they are refused as no declared view)', async () => {
    expect(isNoteSubject('note:n1')).toBe(true);
    expect(isNoteSubject('note:a.b-c_9')).toBe(true);
    for (const bad of ['note:', 'note:   ', 'note:a b', 'note:a/b', 'note:a:b']) expect(isNoteSubject(bad)).toBe(false);
    const s = buildDashboard(makeDashboardDef()).createSession();
    const r = await s.dispatch({ verb: 'describe', viewId: 'note:   ', slot: 'caption', record: { text: 'x', author: { kind: 'human' } }, cause: userCause() });
    expect(!r.ok && r.rejection.code).toBe('needs-view');
  });
});
