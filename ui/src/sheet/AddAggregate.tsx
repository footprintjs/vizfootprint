/**
 * CUT A TABLE — the second thing a person may write into the Sheet, and it is
 * not a cell either.
 *
 * `AddColumn` beside it lands a formula ON the rows in front of you. This lands
 * a TABLE beside them: one row per group, cut from the rows visible at this
 * cursor, with the measures it names as its columns. It is an ACT for exactly
 * the reasons a derived column is — it belongs to the commit that made it, it
 * carries the data version it was cut from, and it replays — so this is a door
 * onto the session, drawn beside the grid because that is where a person is
 * looking when they want one.
 *
 * It judges NOTHING. Whether the name is free, whether those columns exist,
 * whether `sum` may read that column, whether an act may cut a table at all are
 * the library's to answer, and the sentence it answers with is the sentence
 * shown. What this file owns is: what is picked, whether an act is in flight,
 * and the last thing the session said.
 *
 * The one vocabulary it does not own either: the REDUCERS come from the library
 * (`REDUCER_OPS`, read off the op table itself), so this picker can never offer
 * a fold the grammar does not have.
 */
import { useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { REDUCER_OPS } from 'vizfootprint/def';
import type { AggregatePick, MeasurePick } from '../adapter/types.js';
import type { AddColumnOutcome } from './AddColumn.js';

/** What landing an act answered with — the shape every door beside the grid answers in, and {@link AddColumnOutcome} owns it. */
export type AddAggregateOutcome = AddColumnOutcome;

export interface AddAggregateProps {
  /**
   * The columns a group or a measure may read, by name — the columns this table
   * has at the cursor. Listed, never enforced here: a name that is not among
   * them, or a column a reducer cannot fold, is refused by the session in the
   * session's words.
   */
  readonly columns: readonly string[];
  /** Land the act. The host wires this to the session's own door. */
  readonly onAdd: (name: string, pick: AggregatePick) => Promise<AddAggregateOutcome>;
  /** Present mode: the door is closed, and says so. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

/** What the strip says when nothing has been tried yet. */
export const ADD_AGGREGATE_HINT = 'A table of one row per group, cut from the rows you can see here. It lands as an act, and it gets a sheet of its own.';
/** What it says in Present mode. */
export const ADD_AGGREGATE_PRESENTING = 'Present mode is reading — cutting a table is an act, and acts are closed here.';
/** What it says when the table has nothing to group by or fold. */
export const ADD_AGGREGATE_NO_COLUMNS = 'this table has no columns to group by or fold';
/** What the group strip says when nothing is picked — the empty group is a real answer, not a missing one. */
export const ADD_AGGREGATE_WHOLE_TABLE = 'no group column — one row for the whole table';

/** A fresh measure row: the first reducer, the first column, and a name for the person to write. */
function blankMeasure(columns: readonly string[]): MeasurePick {
  return { as: '', op: REDUCER_OPS[0]!, of: columns[0] ?? '' };
}

/** One measure row while it is being edited — the id is React's, never the act's. */
interface MeasureRow extends MeasurePick {
  readonly rowId: number;
}

export function AddAggregate({ columns, onAdd, readOnly = false, className }: AddAggregateProps): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState('');
  const [groupBy, setGroupBy] = useState<readonly string[]>([]);
  // a counter, never a clock and never a random: two runs of this form make the
  // same ids, so a test and a person see the same page
  const nextRowId = useRef(1);
  const [measures, setMeasures] = useState<readonly MeasureRow[]>([{ ...blankMeasure(columns), rowId: 0 }]);
  const [busy, setBusy] = useState(false);
  /** The last thing the SESSION said — a refusal's sentence, or what landed. */
  const [said, setSaid] = useState<{ readonly refused: boolean; readonly words: string } | null>(null);

  const toggleGroup = (column: string): void => setGroupBy((picked) => (picked.includes(column) ? picked.filter((c) => c !== column) : [...picked, column]));
  const editMeasure = (rowId: number, part: Partial<MeasurePick>): void => setMeasures((rows) => rows.map((row) => (row.rowId === rowId ? { ...row, ...part } : row)));
  const dropMeasure = (rowId: number): void => setMeasures((rows) => rows.filter((row) => row.rowId !== rowId));
  const oneMore = (): void => setMeasures((rows) => [...rows, { ...blankMeasure(columns), rowId: nextRowId.current++ }]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || readOnly) return;
    setBusy(true);
    // A THROW from the host's door is a sentence too: a form that froze on a
    // rejected promise with nothing said would be the silence this library
    // exists to remove.
    try {
      const outcome = await onAdd(name, { groupBy, measures: measures.map(({ as, op, of }) => ({ as, op, of })) });
      if (outcome.ok) {
        setSaid({ refused: false, words: `${name} is a table now — it has a sheet of its own` });
        setName('');
        setGroupBy([]);
        setMeasures([{ ...blankMeasure(columns), rowId: nextRowId.current++ }]);
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
      className={`vzf vzf-addagg${className !== undefined ? ' ' + className : ''}`}
      data-vzf="add-aggregate"
      onSubmit={(event) => void submit(event)}
    >
      <div className="vzf-addagg-row">
        <label className="vzf-addagg-field" htmlFor={nameId}>
          <span className="vzf-addagg-label">cut</span>
          <input id={nameId} className="vzf-input vzf-addagg-name" value={name} disabled={readOnly} placeholder="by_region" aria-label="the new table's name" onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="vzf-btn vzf-btn-primary" disabled={readOnly || busy}>
          {busy ? 'cutting…' : 'Cut this table'}
        </button>
      </div>

      <fieldset className="vzf-addagg-groups" data-vzf="add-aggregate-groups">
        <legend className="vzf-addagg-label">grouped by</legend>
        {columns.map((column) => (
          <label key={column} className="vzf-addagg-group">
            <input type="checkbox" checked={groupBy.includes(column)} disabled={readOnly} aria-label={`group by ${column}`} onChange={() => toggleGroup(column)} />
            <span>{column}</span>
          </label>
        ))}
        <p className="vzf-addagg-hint" data-vzf="add-aggregate-group-said">{groupBy.length === 0 ? ADD_AGGREGATE_WHOLE_TABLE : `one row per ${groupBy.join(' · ')}`}</p>
      </fieldset>

      <fieldset className="vzf-addagg-measures" data-vzf="add-aggregate-measures">
        <legend className="vzf-addagg-label">measuring</legend>
        {measures.map((row) => (
          <div key={row.rowId} className="vzf-addagg-measure">
            <input className="vzf-input vzf-addagg-as" value={row.as} disabled={readOnly} placeholder="total" aria-label="the measure's column name" onChange={(e) => editMeasure(row.rowId, { as: e.target.value })} />
            <span className="vzf-addagg-label">=</span>
            <select className="vzf-input vzf-addagg-op" value={row.op} disabled={readOnly} aria-label="the fold" onChange={(e) => editMeasure(row.rowId, { op: e.target.value })}>
              {REDUCER_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <span className="vzf-addagg-label">of</span>
            <select className="vzf-input vzf-addagg-of" value={row.of} disabled={readOnly} aria-label="the column it folds" onChange={(e) => editMeasure(row.rowId, { of: e.target.value })}>
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
            {measures.length > 1 && (
              <button type="button" className="vzf-btn vzf-addagg-drop" disabled={readOnly} aria-label={`drop the measure ${row.as === '' ? row.op : row.as}`} onClick={() => dropMeasure(row.rowId)}>
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" className="vzf-btn vzf-addagg-more" disabled={readOnly} onClick={oneMore}>
          one more measure
        </button>
      </fieldset>

      <p className="vzf-addagg-hint" data-vzf="add-aggregate-hint">{readOnly ? ADD_AGGREGATE_PRESENTING : ADD_AGGREGATE_HINT}</p>
      <p className="vzf-addagg-hint" data-vzf="add-aggregate-columns">
        {columns.length === 0 ? ADD_AGGREGATE_NO_COLUMNS : `the columns it may read: ${columns.join(', ')}`}
      </p>
      <p className={`vzf-addagg-said${said?.refused === true ? ' vzf-addagg-refused' : ''}`} role="status" aria-live="polite">
        {said === null ? '' : said.words}
      </p>
    </form>
  );
}
