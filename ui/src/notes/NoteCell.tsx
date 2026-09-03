/**
 * THE TEXT TOOL — a note on the dashboard as a cockpit cell.
 *
 * A note is words with an author and refs: the prose plane's `note:<id>`
 * subject. Reading it shows the title, the body with its links as anchors
 * (a click seeks the commit or the bookmark), and whether the words went stale.
 * Editing it is typing: `#s12`, `@coastal` or `@[Formal wear]` become links
 * when the note is saved, and the picker inserts a mention for anything the
 * session holds. A mention that resolves to nothing is refused with its
 * sentence — the words are never saved with a link silently missing.
 * Saving is a describe: one commit with a cause, like every other act — and
 * the editor stays open, words intact, until the session says it landed.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { mentionsToRefs } from '../../../src/prose/index.js';
import type { MentionWorld } from '../../../src/prose/index.js';
import type { NoteView, ProseStatusView } from '../adapter/types.js';
import { ProseText } from '../panels/ProseText.js';
import type { Linkable } from './linkables.js';

/** What a save came back with: landed, or refused with the session's sentence. */
export type NoteSaveOutcome = { readonly ok: true } | { readonly ok: false; readonly sentence: string };

export interface NoteCellProps {
  readonly note: NoteView;
  /** The mention grammar's world (see `mentionWorldOf`). */
  readonly world: MentionWorld;
  /** The picker's list (see `linkablesOf`). */
  readonly linkables: readonly Linkable[];
  /** Who is writing — stamped as the record's `by`. */
  readonly by?: string;
  /** Save one slot (null = back to nothing; a note whose slots are all nothing is gone). The answer decides whether the editor closes. */
  readonly onDescribe: (noteId: string, slot: 'title' | 'caption', record: Readonly<Record<string, unknown>> | null) => Promise<NoteSaveOutcome> | NoteSaveOutcome;
  /** A note not yet saved: it opens writing, and Cancel discards it (see `onDiscard`) — nothing is committed until the first Save. */
  readonly fresh?: boolean;
  /** Cancel on a fresh note: the host drops the unsaved cell. */
  readonly onDiscard?: () => void;
  readonly onSeek?: (commitId: string) => void;
  /** A ref to a bookmark, by its ID (`b1`, …) — never its name, so a renamed bookmark keeps working. The host resolves the id and goes to the moment. */
  readonly onBookmark?: (bookmarkId: string) => void;
  /**
   * A ref to a saved selection, by its ID (`p1`, …) — never its name, so a
   * renamed picture keeps working. Clicking it APPLIES the saved logic (the
   * same act the panel's apply button performs, `view.applySaved(id)`); it
   * never seeks, because a picture is logic, not a moment.
   */
  readonly onSaved?: (savedId: string) => void;
  readonly describeCommit?: (commitId: string) => string | undefined;
  /** Present mode: the words stay, the doors close. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

/** A person's record for the note's words: a human edit of the agent's words keeps the agent's basis and model; fresh words are the person's. */
export function noteRecord(text: string, refs: readonly { readonly span: readonly [number, number]; readonly commit?: string; readonly bookmark?: string; readonly saved?: string; readonly label?: string }[], current: ProseStatusView | undefined, by: string | undefined): Record<string, unknown> {
  const fromAgent = current?.author.kind === 'agent' || current?.author.kind === 'humanEdited';
  return {
    text,
    author: { kind: fromAgent ? 'humanEdited' : 'human', ...(by !== undefined ? { by } : {}), ...(fromAgent && current?.author.model !== undefined ? { model: current.author.model } : {}) },
    ...(refs.length > 0 ? { refs } : {}),
    ...(current !== undefined && current.levels.length > 0 ? { levels: current.levels } : {}),
    ...(fromAgent && current?.basis !== undefined ? { basis: current.basis } : {}),
  };
}

const GLYPH: Record<Linkable['kind'], string> = { saved: '💾', bookmark: '⚑', selection: '◎', commit: '#' };

export function NoteCell({ note, world, linkables, by, onDescribe, fresh = false, onDiscard, onSeek, onBookmark, onSaved, describeCommit, readOnly = false, className }: NoteCellProps): JSX.Element {
  const title = note.prose.find((p) => p.slot === 'title');
  const caption = note.prose.find((p) => p.slot === 'caption');
  const [editing, setEditing] = useState(fresh);
  const [draftTitle, setDraftTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  // where the writer last was IN THE WORDS — null until the textarea has been touched. Clicking Insert moves the
  // focus to the picker, so the live selection cannot be asked at insert time: it is remembered as it is made.
  const caret = useRef<{ readonly start: number; readonly end: number } | null>(null);
  const problemsId = useId();
  const remember = (e: { readonly currentTarget: HTMLTextAreaElement }): void => {
    caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd };
  };

  // the caret lands after an inserted mention once React has written the new value — no timer, no stale caret between two quick picks
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null) return;
    pendingCaret.current = null;
    caret.current = { start: at, end: at }; // a second pick with no click in between lands after the first
    const ta = area.current!; // a caret is pending only after an insert, and an insert happens only while the textarea is mounted
    ta.focus();
    ta.setSelectionRange(at, at);
  }, [draft]);

  // Present mode can start while a note is open: the doors close, so the editor closes with them — and an unsaved fresh note goes back to the host
  useEffect(() => {
    if (readOnly && editing) close();
  }, [readOnly, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (): void => {
    setDraftTitle(title?.text ?? '');
    setDraft(caption?.text ?? '');
    setProblems([]);
    setEditing(true);
  };
  const close = (): void => {
    setProblems([]);
    setEditing(false);
    if (fresh) onDiscard?.();
  };
  /** Put a mention at the caret the writer last had in the words, else at the end — a textarea never touched has no caret to go back to. */
  const insert = (mention: string): void => {
    const at = caret.current;
    const before = draft.slice(0, at !== null ? at.start : draft.length);
    const after = at !== null ? draft.slice(at.end) : '';
    const pad = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    setDraft(`${before}${pad}${mention} ${after}`);
    pendingCaret.current = before.length + pad.length + mention.length + 1;
  };
  const refuse = (sentences: readonly string[]): void => {
    setProblems(sentences);
    /* v8 ignore next -- the cell unmounted while its save was in flight: there is no textarea left to put the writer back in */
    area.current?.focus(); // refused while writing: the writer's place is in the words
  };
  const save = async (): Promise<void> => {
    if (saving) return; // one save at a time — Enter in the title while the first is on its way is not a second one
    const { refs, unresolved } = mentionsToRefs(draft, world);
    if (unresolved.length > 0) {
      refuse(unresolved.map((u) => u.sentence)); // refused with the sentence — a link is never silently missing
      return;
    }
    if (draft.trim().length === 0) {
      refuse(['a note needs words — remove it instead, if it has nothing to say']);
      return;
    }
    setSaving(true);
    try {
      const body = await onDescribe(note.id, 'caption', noteRecord(draft, refs, caption, by));
      if (!body.ok) {
        refuse([body.sentence]); // the words stay in the editor: nothing typed is lost to a refusal
        return;
      }
      const t = draftTitle.trim();
      if (t !== (title?.text ?? '')) {
        const head = await onDescribe(note.id, 'title', t.length === 0 ? null : { text: t, author: { kind: 'human', ...(by !== undefined ? { by } : {}) } });
        if (!head.ok) {
          refuse([`the words were saved; the title was not — ${head.sentence}`]);
          return;
        }
      }
      setProblems([]);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  // one removal at a time: the button is out while the slots go, so a second click cannot send the same null describes twice
  const remove = async (): Promise<void> => {
    setRemoving(true);
    try {
      for (const slot of ['caption', 'title'] as const) {
        if (note.prose.find((p) => p.slot === slot) === undefined) continue;
        const r = await onDescribe(note.id, slot, null);
        if (!r.ok) {
          setProblems([r.sentence]);
          return;
        }
      }
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={`vzf vzf-note${className ? ' ' + className : ''}`} role="article" aria-label={title?.text ?? `note ${note.id}`} data-vzf="note" data-note={note.id}>
      {!editing ? (
        <>
          {title !== undefined && <h3 className="vzf-note-title">{title.text}</h3>}
          {caption !== undefined ? (
            <div className={`vzf-note-body${caption.status === 'stale' ? ' vzf-note-stale' : ''}`}>
              {/* the light marks a model writes (**bold**, `code`) are formatting here too — a reply added to the dashboard reads the way it read in the panel */}
              <ProseText markdown text={caption.text} refs={caption.refs} describeCommit={describeCommit} onSeek={onSeek} onBookmark={onBookmark} onSaved={onSaved} />
            </div>
          ) : (
            <div className="vzf-note-body vzf-soft">(no words yet)</div>
          )}
          <div className="vzf-note-meta">
            {caption !== undefined && caption.author.kind === 'agent' && <span className="vzf-note-tag">by the analyst</span>}
            {caption !== undefined && caption.author.kind === 'humanEdited' && <span className="vzf-note-tag">the analyst's words, edited</span>}
            {caption !== undefined && caption.status === 'stale' && <span className="vzf-note-tag vzf-note-tag-stale">stale · {caption.changed.join(', ')} moved</span>}
            {!readOnly && (
              <span className="vzf-note-actions">
                <button type="button" className="vzf-note-btn" onClick={begin} aria-label={`edit note ${note.id}`}>
                  Edit
                </button>
                <button type="button" className="vzf-note-btn" disabled={removing} onClick={() => void remove()} aria-label={`remove note ${note.id}`} title="Take the words off the dashboard — the commits stay">
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </span>
            )}
          </div>
        </>
      ) : (
        <form
          className="vzf-note-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input className="vzf-note-title-input" aria-label="note title" placeholder="a title (optional)" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
          <textarea
            ref={area}
            className="vzf-note-textarea"
            aria-label="note words"
            aria-invalid={problems.length > 0}
            aria-describedby={problems.length > 0 ? problemsId : undefined}
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onSelect={remember}
            onKeyUp={remember}
            onClick={remember}
            onBlur={remember}
            placeholder="Write here. #s12 links a commit, @[a saved selection] or @[a bookmark] links by name — or pick one below and press Insert."
          />
          <div className="vzf-note-linker">
            <label className="vzf-soft">
              Link{' '}
              <select aria-label="a link to insert" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">to a selection, bookmark or commit…</option>
                {linkables.map((l) => (
                  <option key={`${l.kind}:${l.mention}`} value={l.mention}>
                    {GLYPH[l.kind]} {l.label} — {l.description}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="vzf-note-btn"
              disabled={pick === ''}
              aria-label="insert the link"
              onClick={() => {
                // the pick is the MENTION, never a position in the list: a poll between the pick and this click reorders
                // the offers (a new commit shifts every one of them), and a position would then insert somebody else's link
                const row = linkables.find((l) => l.mention === pick);
                if (row === undefined) {
                  setProblems(['that link is no longer offered — pick again']);
                  setPick('');
                  return;
                }
                setProblems([]);
                insert(row.mention);
                setPick('');
              }}
            >
              Insert
            </button>
          </div>
          <div className="vzf-note-actions">
            <button type="submit" className="vzf-note-btn vzf-note-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="vzf-note-btn" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {problems.length > 0 && (
        <ul id={problemsId} className="vzf-note-problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
