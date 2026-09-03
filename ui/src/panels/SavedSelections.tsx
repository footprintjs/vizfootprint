/**
 * `<SavedSelections>` — the named pictures the library's store holds, in words,
 * each applicable with one click.
 *
 * A saved selection is saved LOGIC, not a moment: one condition per view, kept
 * beside the log. So a row shows every condition it carries (a picture may name
 * several charts), and applying it is `applySaved(id)` — one ordinary commit per
 * condition, judged first — never a replay of one commit. The row is keyed by
 * the store's `id`, which is also what a note's words link, so a rename moves
 * the name on screen and breaks nothing.
 *
 * A picture whose conditions are ALL live already reads as live and offers
 * nothing: there is nothing to apply.
 */
import type { SavedSelectionView, SelectionView } from '../adapter/types.js';
import { chipWords } from './SelectionChips.js';

export interface SavedSelectionsProps {
  readonly saved: readonly SavedSelectionView[];
  /** The live selections, to mark a picture that is already on screen. */
  readonly selections?: readonly SelectionView[];
  /** viewId → display label (the def's `label`), optional. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Apply one — wire to `view.applySaved(id)`. The id, never the name: a rename must not break the button. */
  readonly onApply?: (savedId: string) => void;
  /** Present mode: read, act on none. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Is this whole picture on screen right now? Every condition of it, matched by a live clause on its own view. */
function allLive(picture: SavedSelectionView, selections: readonly SelectionView[]): boolean {
  return picture.conditions.length > 0 && picture.conditions.every((c) => selections.some((l) => l.viewId === c.viewId && l.kind === c.kind && l.field === c.field && same(l.value, c.value)));
}

export function SavedSelections({ saved, selections = [], labels = {}, onApply, readOnly = false, className }: SavedSelectionsProps): JSX.Element {
  return (
    <div className={`vzf vzf-saved${className ? ' ' + className : ''}`} role="group" aria-label="saved selections" data-vzf="saved-selections">
      {saved.length === 0 ? (
        <span className="vzf-soft vzf-saved-empty">no saved selection — name a live one to keep it</span>
      ) : (
        <ul className="vzf-saved-list">
          {saved.map((s) => {
            const live = allLive(s, selections);
            return (
              <li key={s.id} className={`vzf-saved-item${live ? ' vzf-saved-live' : ''}`} data-saved={s.id}>
                <span className="vzf-saved-name">{s.name}</span>
                <span className="vzf-saved-conditions">
                  {s.conditions.map((c, i) => (
                    <span key={i} className="vzf-saved-condition">
                      <span className="vzf-saved-view">{labels[c.viewId] ?? c.viewId}</span>
                      <span className="vzf-saved-words">{chipWords(c)}</span>
                    </span>
                  ))}
                </span>
                {live ? (
                  <span className="vzf-saved-badge">live</span>
                ) : onApply !== undefined ? (
                  <button type="button" className="vzf-saved-apply" disabled={readOnly} aria-label={`apply the saved selection ${s.name}`} title="apply the saved logic — one commit per condition, judged first" onClick={() => onApply(s.id)}>
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
