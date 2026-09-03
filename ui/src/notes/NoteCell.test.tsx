// @vitest-environment jsdom
/**
 * The Text tool: a note reads with its links as anchors, edits by typing or
 * picking a mention, refuses a link that resolves to nothing, saves as a
 * describe with refs, and can be taken off the dashboard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { NoteCell, linkablesOf, mentionWorldOf, noteRecord, bracketSafe } from './index.js';
import { mentionsToRefs } from '../../../src/prose/index.js';
import { mapPollState } from '../adapter/sessionView.js';
import type { RawPollState } from '../adapter/sessionView.js';
import type { NoteView } from '../adapter/types.js';
import type { NoteSaveOutcome } from './index.js';

afterEach(cleanup);

const RAW: RawPollState = {
  defaultTable: 'data',
  records: [
    { id: 's1', parent: null, viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user', intent: 'pick formal' } },
    { id: 's2', parent: 's1', viewId: 'annotation:bar', kind: 'point', field: 's1', value: 'coastal', cause: { requestedBy: 'user', intent: 'save it' } }, // a saved selection = an annotation whose field is the selection's commit and whose value is the name
    { id: 's3', parent: 's2', viewId: 'bookmark:0', kind: 'point', field: '__bookmark__', value: 'Start', cause: { requestedBy: 'user' } },
  ],
  activeSelections: [
    { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', commitId: 's1' },
    { viewId: 'scatter', field: 'price', kind: 'interval', value: [1, 2] }, // a live selection with no commit id cannot be linked
  ],
  bookmarks: [
    { id: 'b1', label: 'Start', commitId: 's3', at: 's2', ts: 3 },
    { id: 'b2', label: 'Older', commitId: null, at: 's1', ts: 1 }, // an older wire's bookmark: no commit of its own
  ],
  head: 's3',
  cursor: 's3',
};

const NOTE: NoteView = {
  id: 'n1',
  prose: [
    { slot: 'title', text: 'Formal wear', status: 'current', changed: [], author: { kind: 'human', by: 'me' }, levels: [] },
    { slot: 'caption', text: 'See #s1 and @[coastal].', status: 'stale', changed: ['filters'], author: { kind: 'agent', model: 'm' }, levels: ['statistic'], refs: [{ span: [4, 7], commit: 's1', label: 'pick formal' }, { span: [12, 22], commit: 's1', label: 'coastal' }] },
  ],
  proposals: [],
};

describe('linkables and the mention world', () => {
  it('list saved selections, bookmarks, live selections and recent commits with the mention to type; the world resolves the same names', () => {
    const state = mapPollState(RAW);
    const list = linkablesOf(state);
    expect(list.map((l) => [l.kind, l.mention])).toEqual([
      ['saved', '@[coastal]'],
      ['bookmark', '@[Start]'],
      ['bookmark', '@[Older]'],
      ['selection', '#s1'],
      ['commit', '#s3'],
      ['commit', '#s2'],
      ['commit', '#s1'],
    ]);
    expect(list[0]!.description).toContain('saved selection');
    expect(list[1]!.description).toBe('bookmark · #s3');
    expect(list[2]!.description).toBe('bookmark');
    expect(list[4]!.description).toBe('user'); // no intent on the bookmark commit
    expect(list[6]!.description).toBe('pick formal · user');
    const world = mentionWorldOf(state);
    expect(world.saved.get('coastal')).toBe('s1'); // name → the id a ref carries: on this wire a named selection IS its commit
    expect(world.bookmarks.get('Start')).toBe('b1'); // name → the bookmark's id
    expect(world.commits.get('s1')).toBe('category — pick formal');
    expect(linkablesOf(mapPollState({ ...RAW, records: [RAW.records[0]!], bookmarks: [], activeSelections: [] })).map((l) => l.kind)).toEqual(['commit']);
  });
});

describe('NoteCell', () => {
  const state = mapPollState(RAW);
  const world = mentionWorldOf(state);
  const linkables = linkablesOf(state);

  it('reads: title, the words with their links as anchors, the stale mark and the author tag; the doors close in present mode', () => {
    const onSeek = vi.fn();
    const { container, rerender } = render(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={vi.fn()} onSeek={onSeek} />);
    expect(container.querySelector('.vzf-note-title')!.textContent).toBe('Formal wear');
    expect(container.querySelector('[role="article"]')!.getAttribute('aria-label')).toBe('Formal wear');
    expect(container.querySelector('.vzf-note-body')!.classList.contains('vzf-note-stale')).toBe(true);
    expect(container.querySelector('.vzf-note-meta')!.textContent).toContain('by the analyst');
    expect(container.querySelector('.vzf-note-meta')!.textContent).toContain('stale · filters moved');
    const anchors = container.querySelectorAll('.vzf-note-body button, .vzf-note-body a');
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(anchors[0]!);
    expect(onSeek).toHaveBeenCalledWith('s1');
    expect(container.querySelectorAll('.vzf-note-btn')).toHaveLength(2);
    rerender(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={vi.fn()} readOnly />);
    expect(container.querySelectorAll('.vzf-note-btn')).toHaveLength(0);
    const empty = render(<NoteCell note={{ id: 'e', prose: [], proposals: [] }} world={world} linkables={linkables} onDescribe={vi.fn()} />).container;
    expect(empty.querySelector('[role="article"]')!.getAttribute('aria-label')).toBe('note e');
    expect(empty.textContent).toContain('(no words yet)');
  });

  it("the analyst's light marks read as formatting here too, so a reply added to the dashboard looks the way it looked in the panel", () => {
    const note: NoteView = { id: 'n2', prose: [{ slot: 'caption', text: '**South Atlantic** leads at `19.09`.', status: 'current', changed: [], author: { kind: 'agent', model: 'm' }, levels: [], refs: [{ span: [2, 16], commit: 's1', label: 'pick formal' }] }], proposals: [] };
    const { container } = render(<NoteCell note={note} world={world} linkables={linkables} onDescribe={vi.fn()} />);
    const body = container.querySelector('.vzf-note-body')!;
    expect(body.textContent).toBe('South Atlantic1 leads at 19.09.'); // no asterisks, no backticks
    expect(body.querySelector('strong')!.textContent).toBe('South Atlantic'); // the linked words are the bold ones
    expect(body.querySelector('code')!.textContent).toBe('19.09');
  });

  /** A session that says yes — typed like `onDescribe`, so `mock.calls` is the describe's own tuple and not `[]`. */
  const landed = () => vi.fn(async (_id: string, _slot: 'title' | 'caption', _record: Readonly<Record<string, unknown>> | null) => ({ ok: true as const }));

  it('edits: the picker inserts a mention at the caret the writer last had in the words (the Insert button has the focus by then), a mention that resolves to nothing is refused with its sentence, a good one saves refs and a changed title', async () => {
    const onDescribe = landed();
    const { container } = render(<NoteCell note={NOTE} world={world} linkables={linkables} by="you" onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note n1"]')!);
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('See #s1 and @[coastal].');
    fireEvent.change(area, { target: { value: 'Nothing here @ghost' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onDescribe).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('@ghost is neither a saved selection nor a bookmark');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(area.getAttribute('aria-describedby')).toBe(alert.id); // the refusal is tied to the field it is about
    expect(document.activeElement).toBe(area); // and the writer is put back in the words
    // the picker: choose, then Insert — choosing alone inserts nothing (arrowing a closed select fires change per option)
    fireEvent.change(area, { target: { value: 'Start was here' } });
    area.focus();
    area.setSelectionRange(9, 9);
    fireEvent.select(area); // the caret is remembered as it is made — it cannot be asked for once the picker has the focus
    const select = container.querySelector('select') as HTMLSelectElement;
    const insertBtn = container.querySelector('[aria-label="insert the link"]') as HTMLButtonElement;
    expect(insertBtn.disabled).toBe(true);
    fireEvent.change(select, { target: { value: '@[Start]' } }); // the bookmark — by its MENTION, never by a row number
    expect(area.value).toBe('Start was here');
    expect(insertBtn.disabled).toBe(false);
    insertBtn.focus(); // as a real click does: the writer is no longer in the words when Insert runs
    expect(document.activeElement).toBe(insertBtn);
    fireEvent.click(insertBtn);
    expect(area.value).toBe('Start was @[Start]  here'); // at the caret they last had, padded on the left, one space after
    expect(area.selectionStart).toBe('Start was @[Start] '.length);
    expect(select.value).toBe(''); // the picker is back on its placeholder
    fireEvent.change(container.querySelector('input.vzf-note-title-input')!, { target: { value: 'Renamed' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(container.querySelector('form')).toBeNull()); // back to reading — once the session said yes
    expect(onDescribe).toHaveBeenCalledTimes(2);
    const [id, slot, record] = onDescribe.mock.calls[0]!;
    expect([id, slot]).toEqual(['n1', 'caption']);
    expect(record).toEqual({
      text: 'Start was @[Start]  here',
      author: { kind: 'humanEdited', by: 'you', model: 'm' }, // the analyst's words, edited: the model and the basis are kept
      refs: [{ span: [10, 18], bookmark: 'b1', label: 'Start' }], // the ref carries the bookmark's id; the words the writer typed ride as the label
      levels: ['statistic'],
    });
    expect(onDescribe.mock.calls[1]).toEqual(['n1', 'title', { text: 'Renamed', author: { kind: 'human', by: 'you' } }]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('a refused save keeps the editor open with the session\'s sentence and the words intact; a refused title says the words landed', async () => {
    const onDescribe = vi.fn(async (_id: string, slot: string) => (slot === 'caption' ? { ok: false as const, sentence: 'basis.columns names "ghost" — not a column here' } : { ok: true as const }));
    const { container } = render(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note n1"]')!);
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'my careful words' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(container.querySelector('.vzf-note-save')!.textContent).toBe('Saving…');
    await waitFor(() => expect(container.querySelector('[role="alert"]')!.textContent).toBe('basis.columns names "ghost" — not a column here'));
    expect(container.querySelector('form')).not.toBeNull();
    expect(area.value).toBe('my careful words');
    expect(container.querySelector('.vzf-note-save')!.textContent).toBe('Save');
    // now the words land but the title is refused
    onDescribe.mockImplementation(async (_id: string, slot: string) => (slot === 'title' ? { ok: false as const, sentence: 'no' } : { ok: true as const }));
    fireEvent.change(container.querySelector('input.vzf-note-title-input')!, { target: { value: 'New title' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(container.querySelector('[role="alert"]')!.textContent).toBe('the words were saved; the title was not — no'));
    expect(container.querySelector('form')).not.toBeNull();
  });

  it('one save at a time: a second submit while the first is on its way is not a second describe', async () => {
    let release: (v: { ok: true }) => void = () => {};
    const onDescribe = vi.fn(() => new Promise<{ ok: true }>((r) => (release = r)));
    const { container } = render(<NoteCell note={{ id: 'q', prose: [], proposals: [] }} world={world} linkables={linkables} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note q"]')!);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'once' } });
    fireEvent.submit(container.querySelector('form')!);
    fireEvent.submit(container.querySelector('form')!);
    expect(onDescribe).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true }));
    await waitFor(() => expect(container.querySelector('form')).toBeNull());
  });

  it('refuses empty words, clears a title with null, cancels without saving, and Remove takes every slot off — stopping at a refusal, shown while reading', async () => {
    const onDescribe = landed();
    const { container } = render(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note n1"]')!);
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '   ' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onDescribe).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('a note needs words');
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'plain words' } });
    fireEvent.change(container.querySelector('input.vzf-note-title-input')!, { target: { value: '' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(container.querySelector('form')).toBeNull());
    expect(onDescribe.mock.calls[0]![2]).toEqual({ text: 'plain words', author: { kind: 'humanEdited', model: 'm' }, levels: ['statistic'] }); // no refs key when there are none, no `by` when none given
    expect(onDescribe.mock.calls[1]).toEqual(['n1', 'title', null]);
    fireEvent.click(container.querySelector('[aria-label="edit note n1"]')!);
    fireEvent.click([...container.querySelectorAll('.vzf-note-btn')].find((b) => b.textContent === 'Cancel')!);
    expect(container.querySelector('form')).toBeNull();
    expect(onDescribe).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('[aria-label="remove note n1"]')!);
    await waitFor(() => expect(onDescribe).toHaveBeenCalledTimes(4));
    expect(onDescribe.mock.calls.slice(2)).toEqual([
      ['n1', 'caption', null],
      ['n1', 'title', null],
    ]);
    // a note without a title removes only its body
    const bare = render(<NoteCell note={{ id: 'b', prose: [NOTE.prose[1]!], proposals: [] }} world={world} linkables={linkables} onDescribe={onDescribe} />).container;
    fireEvent.click(bare.querySelector('[aria-label="remove note b"]')!);
    await waitFor(() => expect(onDescribe).toHaveBeenCalledTimes(5));
    expect(onDescribe.mock.calls[4]).toEqual(['b', 'caption', null]);
    // a refused removal stops at the first slot and says why, right there in the reading cell
    const refusing = vi.fn(async (_id: string, _slot: 'title' | 'caption', _record: Readonly<Record<string, unknown>> | null) => ({ ok: false as const, sentence: 'the log is read-only here' }));
    const stuck = render(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={refusing} />).container;
    fireEvent.click(stuck.querySelector('[aria-label="remove note n1"]')!);
    await waitFor(() => expect(stuck.querySelector('[role="alert"]')!.textContent).toBe('the log is read-only here'));
    expect(refusing).toHaveBeenCalledTimes(1);
  });

  it('a fresh note opens writing with nothing committed; Cancel hands it back to the host to drop; without a host hook it simply closes', () => {
    const onDescribe = landed();
    const onDiscard = vi.fn();
    const { container } = render(<NoteCell note={{ id: 'f', prose: [], proposals: [] }} world={world} linkables={linkables} fresh onDiscard={onDiscard} onDescribe={onDescribe} />);
    expect(container.querySelector('form')).not.toBeNull();
    expect(onDescribe).not.toHaveBeenCalled();
    fireEvent.click([...container.querySelectorAll('.vzf-note-btn')].find((b) => b.textContent === 'Cancel')!);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    const alone = render(<NoteCell note={{ id: 'g', prose: [], proposals: [] }} world={world} linkables={linkables} fresh onDescribe={onDescribe} />).container;
    fireEvent.click([...alone.querySelectorAll('.vzf-note-btn')].find((b) => b.textContent === 'Cancel')!);
    expect(alone.querySelector('form')).toBeNull();
    expect(alone.textContent).toContain('(no words yet)');
  });

  it('the empty note edits from blank drafts, a picked mention lands at the start without a pad, a pick made before touching the words appends at the end, and an unchanged title is not re-saved', async () => {
    const onDescribe = landed();
    const { container } = render(<NoteCell note={{ id: 'e', prose: [], proposals: [] }} world={world} linkables={linkables} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note e"]')!);
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('');
    expect((container.querySelector('input.vzf-note-title-input') as HTMLInputElement).value).toBe('');
    const select = container.querySelector('select') as HTMLSelectElement;
    const insertBtn = container.querySelector('[aria-label="insert the link"]') as HTMLButtonElement;
    fireEvent.change(select, { target: { value: '@[coastal]' } }); // the saved selection, into words never touched: at the end, and no pad before it
    insertBtn.focus();
    fireEvent.click(insertBtn);
    expect(area.value).toBe('@[coastal] ');
    expect(document.activeElement).toBe(area); // and the writer is handed back the words, after the mention
    expect(area.selectionStart).toBe('@[coastal] '.length);
    // a second pick with no click in between lands after the first: the remembered caret moved with the insert
    fireEvent.change(area, { target: { value: 'first words' } });
    fireEvent.change(select, { target: { value: '@[Start]' } });
    insertBtn.focus();
    fireEvent.click(insertBtn);
    expect(area.value).toBe('first words @[Start] ');
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(container.querySelector('form')).toBeNull());
    expect(onDescribe).toHaveBeenCalledTimes(1); // the title stayed blank: no title describe
    expect(onDescribe.mock.calls[0]).toEqual(['e', 'caption', { text: 'first words @[Start] ', author: { kind: 'human' }, refs: [{ span: [12, 20], bookmark: 'b1', label: 'Start' }] }]);
    // a current, human-edited caption reads without the stale mark and says whose words they were
    const edited: NoteView = { id: 'h', prose: [{ slot: 'caption', text: 'ok', status: 'current', changed: [], author: { kind: 'humanEdited', by: 'me', model: 'm' }, levels: [] }], proposals: [] };
    const read = render(<NoteCell note={edited} world={world} linkables={linkables} onDescribe={vi.fn()} />).container;
    expect(read.querySelector('.vzf-note-body')!.classList.contains('vzf-note-stale')).toBe(false);
    expect(read.querySelector('.vzf-note-meta')!.textContent).toContain("the analyst's words, edited");
  });

  it('a title saved without a writer carries no `by`; a className rides the cell', async () => {
    const onDescribe = landed();
    const { container } = render(<NoteCell note={{ id: 't', prose: [], proposals: [] }} world={world} linkables={linkables} onDescribe={onDescribe} className="mine" />);
    expect(container.querySelector('.vzf-note.mine')).not.toBeNull();
    fireEvent.click(container.querySelector('[aria-label="edit note t"]')!);
    fireEvent.change(container.querySelector('input.vzf-note-title-input')!, { target: { value: 'Titled' } });
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'words' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onDescribe).toHaveBeenCalledTimes(2));
    expect(onDescribe.mock.calls[1]).toEqual(['t', 'title', { text: 'Titled', author: { kind: 'human' } }]);
  });

  it('the pick is a MENTION, never a row number: the list is rebuilt under a made pick, and the link the writer chose is the one that lands', () => {
    const onDescribe = landed();
    const { container, rerender } = render(<NoteCell note={{ id: 'p', prose: [], proposals: [] }} world={world} linkables={linkables} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note p"]')!);
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    const select = container.querySelector('select') as HTMLSelectElement;
    const insertBtn = container.querySelector('[aria-label="insert the link"]') as HTMLButtonElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', ...linkables.map((l) => l.mention)]); // the option's value IS the mention
    // the writer picks the bookmark — then a poll lands a new commit and every row of the list shifts
    fireEvent.change(select, { target: { value: '@[Start]' } });
    const shifted = [linkables[1]!, linkables[0]!, linkables[3]!]; // the same bookmark, at another position
    rerender(<NoteCell note={{ id: 'p', prose: [], proposals: [] }} world={world} linkables={shifted} onDescribe={onDescribe} />);
    insertBtn.focus();
    fireEvent.click(insertBtn);
    expect(area.value).toBe('@[Start] '); // the bookmark they chose, not whatever now sits where it used to be
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // and when the pick is no longer offered at all, nothing is inserted: it is said, and the picker goes back to its placeholder
    rerender(<NoteCell note={{ id: 'p', prose: [], proposals: [] }} world={world} linkables={shifted} onDescribe={onDescribe} />);
    fireEvent.change(select, { target: { value: '@[Start]' } });
    rerender(<NoteCell note={{ id: 'p', prose: [], proposals: [] }} world={world} linkables={[linkables[0]!]} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="insert the link"]')!);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('that link is no longer offered — pick again');
    expect(area.value).toBe('@[Start] '); // unchanged
    expect((container.querySelector('[aria-label="insert the link"]') as HTMLButtonElement).disabled).toBe(true);
    expect(onDescribe).not.toHaveBeenCalled();
  });

  it('Remove goes once: the button is out while the slots go, so a second click cannot send the same null describes twice', async () => {
    let release: (v: NoteSaveOutcome) => void = () => {};
    const onDescribe = vi.fn((_id: string, _slot: 'title' | 'caption', _record: Readonly<Record<string, unknown>> | null) => new Promise<NoteSaveOutcome>((r) => (release = r)));
    const { container } = render(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={onDescribe} />);
    const btn = container.querySelector('[aria-label="remove note n1"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Removing…');
    fireEvent.click(btn); // the impatient second click
    expect(onDescribe).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true })); // the caption went; the title's null is on its way
    expect(onDescribe).toHaveBeenCalledTimes(2);
    expect(btn.disabled).toBe(true);
    await act(async () => release({ ok: true }));
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toBe('Remove');
    expect(onDescribe.mock.calls).toEqual([
      ['n1', 'caption', null],
      ['n1', 'title', null],
    ]);
  });

  it('Present mode closes an open editor: the doors close with it, and a fresh note nobody saved goes back to the host', () => {
    const onDescribe = landed();
    const onDiscard = vi.fn();
    const { container, rerender } = render(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={onDescribe} />);
    fireEvent.click(container.querySelector('[aria-label="edit note n1"]')!);
    expect(container.querySelector('form')).not.toBeNull();
    rerender(<NoteCell note={NOTE} world={world} linkables={linkables} onDescribe={onDescribe} readOnly />);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('.vzf-note-body')!.textContent).toContain('See #s1'); // the saved words are still read
    expect(container.querySelectorAll('.vzf-note-btn')).toHaveLength(0);
    expect(onDescribe).not.toHaveBeenCalled(); // closing is not a save
    const fresh = render(<NoteCell note={{ id: 'z', prose: [], proposals: [] }} world={world} linkables={linkables} fresh onDiscard={onDiscard} onDescribe={onDescribe} />);
    expect(fresh.container.querySelector('form')).not.toBeNull();
    fresh.rerender(<NoteCell note={{ id: 'z', prose: [], proposals: [] }} world={world} linkables={linkables} fresh onDiscard={onDiscard} onDescribe={onDescribe} readOnly />);
    expect(fresh.container.querySelector('form')).toBeNull();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('noteRecord: fresh words are the person\'s; an edit of the analyst\'s keeps its basis', () => {
    expect(noteRecord('x', [], undefined, 'me')).toEqual({ text: 'x', author: { kind: 'human', by: 'me' } });
    const agent = { ...NOTE.prose[1]!, basis: { filters: {} } };
    expect(noteRecord('y', [{ span: [0, 1], commit: 's1' }], agent, undefined)).toEqual({ text: 'y', author: { kind: 'humanEdited', model: 'm' }, refs: [{ span: [0, 1], commit: 's1' }], levels: ['statistic'], basis: { filters: {} } });
  });

  it('every mention the picker offers resolves: a name the brackets cannot carry, or an older save under a taken name, is offered by its commit id; a bookmark with neither is not offered', () => {
    expect(['coastal', 'Formal wear'].map(bracketSafe)).toEqual([true, true]);
    expect(['', ' coastal', 'coastal ', 'Formal] wear', 'two\nlines'].map(bracketSafe)).toEqual([false, false, false, false, false]);
    const raw: RawPollState = {
      ...RAW,
      records: [
        ...RAW.records,
        { id: 's4', parent: 's3', viewId: 'bar', kind: 'point', field: 'category', value: 'Casual', cause: { requestedBy: 'user' } },
        { id: 's5', parent: 's4', viewId: 'annotation:bar', kind: 'point', field: 's4', value: 'coastal', cause: { requestedBy: 'user' } }, // a NEWER save under the same name
        { id: 's6', parent: 's5', viewId: 'bar', kind: 'point', field: 'category', value: 'Semi', cause: { requestedBy: 'user' } },
        { id: 's7', parent: 's6', viewId: 'annotation:bar', kind: 'point', field: 's6', value: 'Formal] wear', cause: { requestedBy: 'user' } }, // a name with a `]` in it
      ],
      bookmarks: [
        ...(RAW.bookmarks ?? []),
        { id: 'b3', label: 'Bad]label', commitId: 's3', at: 's3', ts: 4 },
        { id: 'b4', label: 'Also]bad', commitId: null, at: 's3', ts: 5 },
        { label: 'No bookmark id', commitId: 's2', at: 's2', ts: 2 }, // a wire that predates bookmark ids: nothing to link by name
        { label: 'No bookmark id at all', commitId: null, at: 's2', ts: 2 }, // …and no commit either: not offered
      ],
      head: 's7',
      cursor: 's7',
    };
    const st = mapPollState(raw);
    const saved = linkablesOf(st).filter((l) => l.kind === 'saved');
    expect(saved.map((l) => [l.label, l.mention])).toEqual([
      ['Formal] wear', '#s6'],
      ['coastal', '@[coastal]'], // the newest owns the name
      ['coastal', '#s1'], // the older is reached by its id
    ]);
    expect(saved[2]!.description).toContain('an older save, #s1');
    const bookmarks = linkablesOf(st).filter((l) => l.kind === 'bookmark');
    expect(bookmarks.map((l) => [l.label, l.mention])).toEqual([
      ['Start', '@[Start]'],
      ['Older', '@[Older]'],
      ['Bad]label', '#s3'],
      ['No bookmark id', '#s2'], // no id to link by name, so it is reached by its commit
    ]);
    const w = mentionWorldOf(st);
    expect(w.saved.get('coastal')).toBe('s4'); // the NEWEST save owns the name — the one the picker offers `@[coastal]`
    expect(w.saved.get('Formal] wear')).toBe('s6');
    expect(w.bookmarks.get('No bookmark id')).toBeUndefined(); // nothing to link: the picker offered its commit instead
    // and every offered mention resolves against that world
    for (const l of linkablesOf(st)) expect(mentionsToRefs(l.mention, w).unresolved).toEqual([]);
  });
});
