/**
 * SAVED SELECTIONS, END TO END — a real dashboard, a real session, the cockpit's
 * own store on top of it. These are written from the user's side: what a person
 * does in the cockpit and what they see afterwards.
 *
 * The scar these pin: the cockpit used to DERIVE its saved list by scanning the
 * log for `annotation:` commits that named a selection commit, while the library
 * kept the real pictures in its own store. The two never saw each other, and
 * every `@` mention of a picture was refused at save because the ids did not
 * match. Nothing here reads the log.
 */
import { describe, it, expect } from 'vitest';
import { createSessionView, sessionSource } from './sessionView.js';
import { buildDashboard } from '../../../src/def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../../../src/session/dashboard.fixture.js';
import { mentionsToRefs } from '../../../src/prose/index.js';
import { linkablesOf, mentionWorldOf } from '../notes/linkables.js';
import { noteRecord } from '../notes/NoteCell.js';

const cause = { requestedBy: 'user', computedBy: 'user' } as const;

function open() {
  const dash = buildDashboard({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });
  const session = dash.createSession();
  return { session, view: createSessionView(sessionSource(session), { as: 'user' }) };
}

/** Type the note's words, resolve its mentions the way the cell does, and save it. */
async function writeNote(view: ReturnType<typeof open>['view'], noteId: string, text: string) {
  const { refs, unresolved } = mentionsToRefs(text, mentionWorldOf(view.getState()));
  const outcome = await view.describe(`note:${noteId}`, 'caption', noteRecord(text, refs, undefined, 'you'));
  return { refs, unresolved, outcome };
}

describe('a saved selection made through the library', () => {
  it('is on screen in the cockpit, with its own id and its logic — not a commit somebody named', async () => {
    const { session, view } = open();
    await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    expect(session.saveSelection('coastal', { live: 'all' }).ok).toBe(true);

    await view.refresh();
    const [picture] = view.getState().saved;
    expect(picture?.id).toBe('p1');
    expect(picture?.name).toBe('coastal');
    expect(picture?.conditions).toEqual([{ viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' }]);
    expect(picture?.by).toBe('user');
    view.dispose();
  });
});

describe('a saved selection made through the cockpit', () => {
  it('is the LIBRARY\'s picture — the same record, through the same door', async () => {
    const { session, view } = open();
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Formal' } as never);
    expect(await view.saveSelection('coastal')).toEqual({ ok: true });

    expect(session.saved().map((c) => [c.id, c.name])).toEqual([['p1', 'coastal']]);
    expect(view.getState().saved.map((c) => c.id)).toEqual(['p1']);
    // naming a picture lands NO commit: only the selection is on the rail
    expect(session.log.records.map((r) => r.viewId)).toEqual(['bar']);
    view.dispose();
  });
});

describe('a note that mentions a saved selection', () => {
  it('saves — the mention resolves to the PICTURE\'s id, which is what the library judges refs against', async () => {
    const { session, view } = open();
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Formal' } as never);
    await view.saveSelection('coastal');

    const world = mentionWorldOf(view.getState());
    expect(world.saved.get('coastal')).toBe('p1'); // the picture, never the commit it was named from

    const { refs, unresolved, outcome } = await writeNote(view, 'n1', 'the @[coastal] picture is the one');
    expect(unresolved).toEqual([]);
    expect(refs[0]).toMatchObject({ saved: 'p1', label: 'coastal' });
    expect(outcome).toEqual({ ok: true });
    view.dispose();
  });

  it('keeps working after the picture is RENAMED — the words link the id, so only the anchor\'s words go stale', async () => {
    const { session, view } = open();
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Formal' } as never);
    await view.saveSelection('coastal');
    await writeNote(view, 'n1', 'the @[coastal] picture is the one');

    expect(await view.renameSaved('p1', 'the coastal band')).toEqual({ ok: true });
    await view.refresh();

    // the picture kept its id and its creation stamp; the rename is recorded beside them
    const [picture] = view.getState().saved;
    expect([picture?.id, picture?.name, picture?.editedBy]).toEqual(['p1', 'the coastal band', 'user']);

    // the note still points at a picture that exists — the link did not break
    const note = view.getState().notes?.find((n) => n.id === 'n1');
    const ref = note?.prose.find((p) => p.slot === 'caption')?.refs?.[0];
    expect(ref?.saved).toBe('p1');
    expect(ref?.label).toBe('coastal'); // the WORDS are as they were typed: the library never rewrites prose

    // and the words can still be edited and re-saved, ref and all
    const again = await view.describe('note:n1', 'caption', noteRecord('still the @[coastal] one', [{ span: [10, 20], saved: 'p1', label: 'coastal' }], undefined, 'you'));
    expect(again).toEqual({ ok: true });

    // the picker now offers the NEW name (and the world resolves it)
    expect(linkablesOf(view.getState()).find((l) => l.kind === 'saved')?.mention).toBe('@[the coastal band]');
    expect(mentionWorldOf(view.getState()).saved.get('the coastal band')).toBe('p1');
    view.dispose();
  });
});

  it('a rename onto a name already taken is refused IN THE LIBRARY\'s words, and moves nothing', async () => {
    // The store is what refuses a duplicate, not the cockpit. The adapter's job
    // is to carry that sentence back unchanged — inventing a friendlier one
    // would be the cockpit claiming a decision it did not make.
    const { view } = open();
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Formal' } as never);
    await view.saveSelection('coastal');
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Casual' } as never);
    await view.saveSelection('inland');

    const outcome = await view.renameSaved('p2', 'coastal');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.sentence).toContain('coastal');
    await view.refresh();
    expect(view.getState().saved.map((p) => [p.id, p.name])).toEqual([['p1', 'coastal'], ['p2', 'inland']]);
    view.dispose();
  });

describe('applying a saved selection', () => {
  it('lands one ordinary commit per condition, under the library\'s own cause', async () => {
    const { session, view } = open();
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Formal' } as never);
    await view.saveSelection('coastal');
    await view.clear('bar');
    expect(view.getState().selections).toEqual([]);

    expect(await view.applySaved('p1')).toEqual({ ok: true, name: 'coastal', applied: 1, cleared: 0, refused: [] });
    await view.refresh();
    expect(view.getState().selections.map((s) => [s.viewId, s.value])).toEqual([['bar', 'Formal']]);
    expect(session.log.records.at(-1)?.cause.intent).toBe('applied saved selection coastal');
    view.dispose();
  });

  it('a picture that could land NOTHING here says why, and clears nothing — judge first, clear second', async () => {
    const { session, view } = open();
    // a picture naming a column this table does not have: it saves fine (the store keeps logic), and cannot land
    expect(session.saveSelection('gone', { conditions: [{ viewId: 'bar', kind: 'point', field: 'no_such_column', value: 'x' }] }).ok).toBe(true);
    await view.emit('bar', { encoding: { kind: 'point', field: 'category' }, rawValue: 'Formal' } as never);
    await view.refresh();

    const outcome = await view.applySaved('p1');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.sentence).toBe('"gone" cannot be applied here — table "data" no longer has the column "no_such_column"');

    // the live picture is untouched: a replace that could land nothing cleared nothing
    await view.refresh();
    expect(view.getState().selections.map((s) => s.viewId)).toEqual(['bar']);
    view.dispose();
  });
});
