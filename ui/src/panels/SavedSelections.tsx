/**
 * `<SavedSelections>` — every selection somebody NAMED (a note on its commit),
 * in words, each applicable with one click: `bringOver(commitId)`, the same
 * replay any commit gets. A saved selection that equals the view's live one
 * reads as live and offers nothing.
 */
import type { SavedSelectionView, SelectionView } from '../adapter/types.js';
import { chipWords } from './SelectionChips.js';

export interface SavedSelectionsProps {
  readonly saved: readonly SavedSelectionView[];
  /** The live selections, to mark a saved one that is already on screen. */
  readonly selections?: readonly SelectionView[];
  /** viewId → display label (the def's `label`), optional. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Apply one — wire to `view.bringOver(commitId)`. */
  readonly onApply?: (commitId: string) => void;
  /** Present mode: read, act on none. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function SavedSelections({ saved, selections = [], labels = {}, onApply, readOnly = false, className }: SavedSelectionsProps): JSX.Element {
  return (
    <div className={`vzf vzf-saved${className ? ' ' + className : ''}`} role="group" aria-label="saved selections" data-vzf="saved-selections">
      {saved.length === 0 ? (
        <span className="vzf-soft vzf-saved-empty">no saved selection — name a live one to keep it</span>
      ) : (
        <ul className="vzf-saved-list">
          {saved.map((s) => {
            const live = selections.some((l) => l.viewId === s.viewId && l.kind === s.kind && l.field === s.field && same(l.value, s.value));
            return (
              <li key={s.commitId} className={`vzf-saved-item${live ? ' vzf-saved-live' : ''}`} data-commit={s.commitId}>
                <span className="vzf-saved-name">{s.name}</span>
                <span className="vzf-saved-view">{labels[s.viewId] ?? s.viewId}</span>
                <span className="vzf-saved-words">{chipWords(s)}</span>
                {live ? (
                  <span className="vzf-saved-badge">live</span>
                ) : onApply !== undefined ? (
                  <button type="button" className="vzf-saved-apply" disabled={readOnly} aria-label={`apply the saved selection ${s.name}`} title="apply (a bring-over commit, like any act)" onClick={() => onApply(s.commitId)}>
                    apply
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
