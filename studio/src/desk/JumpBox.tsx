/**
 * THE JUMP BOX — "go to #34" when the timeline has ninety commits.
 *
 * Every commit on a desk has an id of the shape `<prefix><n>`; the box takes the
 * number, finds the commit on the ACTIVE lineage, and SEEKS — a cursor move,
 * never a rewrite. An id that is not on this lineage is refused in a sentence
 * (it may be on another path — switch paths to reach it), because a jump box
 * that silently did nothing would read as a broken box rather than as a commit
 * that is somewhere else.
 *
 * The prefix is deliberately not this box's business: it matches on the NUMBER,
 * so a desk whose ids are `c12` and one whose ids are `s12` both work.
 */
import { useState, type ReactNode } from 'react';
import { T } from './tokens.js';

export function JumpBox(props: { readonly commitIds: readonly string[]; readonly onSeek: (id: string) => void }): ReactNode {
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const go = (): void => {
    const n = text.trim().replace(/^#/, '').replace(/^\D+/, '');
    if (n === '' || !/^\d+$/.test(n)) {
      setNote('type a commit number, e.g. 34');
      return;
    }
    const id = props.commitIds.find((c) => c.replace(/^\D+/, '') === n);
    if (id === undefined) {
      setNote(`#${n} is not on this lineage — it may be on another path`);
      return;
    }
    setNote(null);
    props.onSeek(id);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: T.gapSm, marginLeft: T.gap, fontSize: T.textSm }}
      title="Seek to a commit by its number (a cursor move — never a rewrite)"
    >
      <label style={{ opacity: 0.7 }}>go to #</label>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="34" style={{ width: 52, padding: '3px 6px', font: 'inherit' }} aria-label="commit number" />
      <button type="submit" style={{ font: 'inherit', padding: '3px 8px' }}>
        seek
      </button>
      {note === null ? null : (
        <span role="status" style={{ color: T.danger }}>
          {note}
        </span>
      )}
    </form>
  );
}
