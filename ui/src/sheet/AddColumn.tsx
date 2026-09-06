/**
 * ADD A COLUMN — the one thing a person may write into the Sheet, and it is
 * not a cell.
 *
 * The Sheet is read-only and stays read-only. A cell edit is refused with a
 * next action, because a cell is not a unit anything on this dashboard could be
 * derived from. A COLUMN is: a formula over the columns that are already there
 * is an ACT — it lands a commit with a cause, it belongs to that commit, and it
 * replays. So this form is not an editor bolted onto the grid; it is a door
 * onto the session, drawn beside the grid because that is where a person is
 * looking when they want one.
 *
 * It judges NOTHING. The name, the expression, whether the columns exist and
 * whether they are numbers are all the library's to answer, and the sentence it
 * answers with is the sentence shown — a second opinion here would be a second
 * set of rules to keep in step, and the one on screen would be the one nobody
 * tested. What this file owns is: what is typed, whether an act is in flight,
 * and the last thing the session said.
 */
import { useId, useState, type FormEvent, type JSX } from 'react';

/** What landing an act answered with: it happened, or here is the session's own sentence. */
export type AddColumnOutcome = { readonly ok: true } | { readonly ok: false; readonly sentence: string };

export interface AddColumnProps {
  /**
   * The columns a formula may read, by name — the NUMBER columns this table has
   * at the cursor. Listed, never enforced here: a name that is not among them
   * is refused by the session, in the session's words.
   */
  readonly columns: readonly string[];
  /** Land the act. The host wires this to the session's own door. */
  readonly onAdd: (name: string, expression: string) => Promise<AddColumnOutcome>;
  /** Present mode: the door is closed, and says so. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

/** What the strip says when nothing has been tried yet. */
export const ADD_COLUMN_HINT = 'A new column, worked out from the ones you have. It lands as an act, like every other change here.';
/** What it says in Present mode. */
export const ADD_COLUMN_PRESENTING = 'Present mode is reading — adding a column is an act, and acts are closed here.';
/** What it says when the table has no numbers to read. */
export const ADD_COLUMN_NO_NUMBERS = 'this table has no number columns — a formula reads numbers';

export function AddColumn({ columns, onAdd, readOnly = false, className }: AddColumnProps): JSX.Element {
  const nameId = useId();
  const formulaId = useId();
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [busy, setBusy] = useState(false);
  /** The last thing the SESSION said — a refusal's sentence, or what landed. */
  const [said, setSaid] = useState<{ readonly refused: boolean; readonly words: string } | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || readOnly) return;
    setBusy(true);
    // A THROW from the host's door is a sentence too: a form that froze on a
    // rejected promise with nothing said would be the silence this library
    // exists to remove.
    try {
      const outcome = await onAdd(name, expression);
      if (outcome.ok) {
        setSaid({ refused: false, words: `${name} is on the sheet` });
        setName('');
        setExpression('');
      } else {
        setSaid({ refused: true, words: outcome.sentence });
      }
    } catch (error: unknown) {
      setSaid({ refused: true, words: `the session did not answer: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={`vzf vzf-addcol${className !== undefined ? ' ' + className : ''}`}
      data-vzf="add-column"
      onSubmit={(event) => void submit(event)}
    >
      <div className="vzf-addcol-row">
        <label className="vzf-addcol-field" htmlFor={nameId}>
          <span className="vzf-addcol-label">called</span>
          <input id={nameId} className="vzf-input vzf-addcol-name" value={name} disabled={readOnly} aria-label="the new column's name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="vzf-addcol-field vzf-addcol-wide" htmlFor={formulaId}>
          <span className="vzf-addcol-label">=</span>
          <input id={formulaId} className="vzf-input vzf-addcol-formula" value={expression} disabled={readOnly} placeholder="cases / 1000" aria-label="the formula" onChange={(e) => setExpression(e.target.value)} />
        </label>
        <button type="submit" className="vzf-btn vzf-btn-primary" disabled={readOnly || busy}>
          {busy ? 'adding…' : 'Add this column'}
        </button>
      </div>
      <p className="vzf-addcol-hint">{readOnly ? ADD_COLUMN_PRESENTING : ADD_COLUMN_HINT}</p>
      <p className="vzf-addcol-hint" data-vzf="add-column-columns">
        {columns.length === 0 ? ADD_COLUMN_NO_NUMBERS : `the numbers it may read: ${columns.join(', ')}`}
      </p>
      <p className={`vzf-addcol-said${said?.refused === true ? ' vzf-addcol-refused' : ''}`} role="status" aria-live="polite">
        {said === null ? '' : said.words}
      </p>
    </form>
  );
}
