/**
 * THE TEXT TOOL — notes as cells on the dashboard.
 *
 * A note is prose on a subject the session mints for it (`note:<id>`), so every
 * save is a `describe` the session answers and every link inside it is a
 * mention resolved against what the session holds. The desk owns this outright:
 * nothing about a note is definition-specific.
 *
 * The one rule worth writing down: **a new note is OPENED, not committed.**
 * Nothing lands until its first Save, so the log never holds words nobody
 * wrote — and once it has been saved it is the SESSION's note, not a local id,
 * which is what stops a seek back before its first commit from re-opening a
 * blank editor beside words that are simply not there yet.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  NoteCell,
  linkablesOf,
  mentionWorldOf,
  type CockpitChart,
  type SessionView,
  type SessionViewState,
} from 'vizfootprint-ui';
import type { ProseAnchors } from './prose.js';

/** A note id only has to be unique on this desk; `crypto.randomUUID` is secure-context only, so a plain-http host falls back. */
export function freshNoteId(): string {
  return `n${typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
}

export interface DeskNotes {
  /** The note cells, saved ones first, then the ones still being written. */
  readonly cells: readonly CockpitChart[];
  /** Open a blank note — the Text tool. */
  readonly open: () => void;
  /** Drop every unsaved note (a reset: they were opened against a log that no longer exists). */
  readonly clear: () => void;
}

export function useNoteCells(input: {
  readonly state: SessionViewState;
  readonly view: SessionView;
  readonly readOnly: boolean;
  /** Who is writing — stamped on the record. The desk always says; there is no anonymous note. */
  readonly by: string;
  readonly anchors: ProseAnchors;
}): DeskNotes {
  const { state, view, readOnly, by, anchors } = input;
  // the world and the picker list are keyed on the slices they read, so an idle poll does not rebuild them
  const world = useMemo(() => mentionWorldOf(state), [state.commits, state.bookmarks, state.saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkables = useMemo(() => linkablesOf(state), [state.commits, state.bookmarks, state.saved, state.selections]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fresh, setFresh] = useState<readonly string[]>([]);

  const describeNote = (id: string, slot: 'title' | 'caption', record: Readonly<Record<string, unknown>> | null) =>
    view.describe(`note:${id}`, slot, record, record === null ? `clear the ${slot} of note ${id}` : `write note ${id}`);

  const shared = { world, linkables, readOnly, by, describeCommit: anchors.describeCommit, onSeek: anchors.onSeek, onBookmark: anchors.onBookmark, onSaved: anchors.onSaved };
  const saved = new Set((state.notes ?? []).map((n) => n.id));

  const cells: CockpitChart[] = [
    ...(state.notes ?? []).map((note) => ({ id: `note:${note.id}`, render: (): ReactNode => <NoteCell note={note} onDescribe={describeNote} {...shared} /> })),
    ...fresh
      .filter((id) => !saved.has(id))
      .map((id) => ({
        id: `note:${id}`,
        render: (): ReactNode => (
          <NoteCell
            note={{ id, prose: [], proposals: [] }}
            fresh
            onDiscard={() => setFresh((f) => f.filter((x) => x !== id))}
            {...shared}
            onDescribe={async (noteId, slot, record) => {
              const r = await describeNote(noteId, slot, record);
              if (r.ok) setFresh((f) => f.filter((x) => x !== id));
              return r;
            }}
          />
        ),
      })),
  ];

  return { cells, open: () => setFresh((f) => [...f, freshNoteId()]), clear: () => setFresh([]) };
}
