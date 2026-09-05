/**
 * `<SelectionChips>` — every LIVE selection in words, each one removable, each
 * keep/exclude-flippable (SET-1). The deselection affordance the charts alone
 * cannot give: clicking empty space is ambiguous under linked views, so the
 * chips are the one place a person sees what is filtering what and takes any
 * of it away — as a commit, like any act. Words come from `formatCommitValue`
 * (the same spelling the commit log uses), never a second vocabulary.
 */
import type { ClearedSelectionView, LinkGraphView, SelectionView } from '../adapter/types.js';
import { formatCommitValue } from './format.js';

export interface SelectionChipsProps {
  readonly selections: readonly SelectionView[];
  /** Layer 4 `onClear`: views whose selection was cleared and what it was — shown as a KEPT chip wherever an edge's policy keeps it in force. */
  readonly cleared?: readonly ClearedSelectionView[];
  /** The link graph, to know which cleared clauses an edge still keeps (`leave` / `excludeAll`); without it no kept chip shows. */
  readonly links?: LinkGraphView;
  /** viewId → display label (the def's `label`), optional. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Clear ONE view's selection (kind-faithful) — wire to `view.clear(viewId)`. */
  readonly onClear?: (viewId: string) => void;
  /** Clear every selection — wire to `view.clearAll()`. */
  readonly onClearAll?: () => void;
  /** Flip a point/match between keep and exclude — wire to `view.setPolarity(viewId, exclude)`. */
  readonly onSetPolarity?: (viewId: string, exclude: boolean) => void;
  /** Save a view's live selection under a name — the host asks for the name and calls `view.saveSelection(name, { viewId })`. */
  readonly onSave?: (viewId: string) => void;
  /** Present mode: read the chips, act on none. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

/** One chip's words: "<view>: <field> = A" / "<field> in {A, B}" / "<field> 100 – 150" / the cell's two sides. */
export function chipWords(s: SelectionView): string {
  if (s.kind === 'cell') return formatCommitValue(s);
  if (s.kind === 'match') return `${s.field} ${formatCommitValue(s)}`;
  if (s.kind === 'interval') return `${s.field} ${formatCommitValue(s)}`;
  return `${s.field} = ${formatCommitValue(s)}`;
}

/** Whether a selection has a polarity to flip (a live point or match — `live` already dropped the cleared ones). */
function flippable(s: SelectionView): boolean {
  return s.kind === 'point' || s.kind === 'match';
}

function isExcluded(s: SelectionView): boolean {
  return s.kind === 'match' && (s.value as { readonly exclude?: boolean } | null)?.exclude === true;
}

/** The cleared clauses some edge still keeps in force — each with the targets and the policy, so the chip can say so. */
export function keptClauses(cleared: readonly ClearedSelectionView[], links: LinkGraphView | undefined, live: readonly SelectionView[]): { readonly clause: ClearedSelectionView; readonly kept: readonly { readonly target: string; readonly policy: 'leave' | 'excludeAll' }[] }[] {
  if (links === undefined) return [];
  const selecting = new Set(live.map((s) => s.viewId));
  return cleared.flatMap((c) => {
    if (selecting.has(c.viewId)) return [];
    const kept = links.edges.flatMap((e) => (e.source === c.viewId && e.kind === c.kind && e.response !== 'none' && e.response !== 'follow' && (e.onClear === 'leave' || e.onClear === 'excludeAll') ? [{ target: e.target, policy: e.onClear }] : []));
    return kept.length > 0 ? [{ clause: c, kept }] : [];
  });
}

export function SelectionChips({ selections, cleared = [], links, labels = {}, onClear, onClearAll, onSetPolarity, onSave, readOnly = false, className }: SelectionChipsProps): JSX.Element {
  // a cleared clause is not a chip, and cleared has ONE spelling for every kind: `null` (src/session/README.md, beside law 6)
  const live = selections.filter((s) => s.value !== null);
  // … unless an edge KEEPS it in force after the clear — then a person must see why a target is still filtered
  const kept = keptClauses(cleared, links, live);
  return (
    <div className={`vzf vzf-selchips${className ? ' ' + className : ''}`} role="group" aria-label={kept.length > 0 ? 'selections, live and kept' : 'live selections'} data-vzf="selection-chips">
      {kept.map(({ clause: c, kept: edges }) => (
        <span
          key={`kept:${c.viewId}`}
          className="vzf-selchip vzf-selchip-kept"
          data-view={c.viewId}
          data-kind={c.kind}
          data-kept="true"
          title={`cleared by commit ${c.clearedBy}; ${edges.map((k) => `${labels[k.target] ?? k.target} ${k.policy === 'leave' ? 'keeps it' : 'shows nothing'}`).join(', ')} — select on ${labels[c.viewId] ?? c.viewId} again, or change the edge in the matrix`}
        >
          <span className="vzf-selchip-view">{labels[c.viewId] ?? c.viewId}</span>
          <span className="vzf-selchip-words">{chipWords(c)} — kept after clearing for {edges.map((k) => labels[k.target] ?? k.target).join(', ')}</span>
          <span className="vzf-sr-only">
            {' '}cleared by commit {c.clearedBy}; {edges.map((k) => `${labels[k.target] ?? k.target} ${k.policy === 'leave' ? 'keeps it' : 'shows nothing'}`).join(', ')}. To release it, select on {labels[c.viewId] ?? c.viewId} again or change the edge in the matrix.
          </span>
        </span>
      ))}
      {live.length === 0 && kept.length === 0 ? (
        <span className="vzf-soft vzf-selchips-empty">no selection — click a mark, shift-click to add, drag across bars for a run</span>
      ) : live.length === 0 ? null : (
        live.map((s) => {
          const excluded = isExcluded(s);
          return (
            <span key={s.viewId} className={`vzf-selchip${excluded ? ' vzf-selchip-exclude' : ''}`} data-view={s.viewId} data-kind={s.kind}>
              <span className="vzf-selchip-view">{labels[s.viewId] ?? s.viewId}</span>
              <span className="vzf-selchip-words">{chipWords(s)}</span>
              {onSetPolarity !== undefined && flippable(s) && (
                <button
                  type="button"
                  className="vzf-selchip-flip"
                  disabled={readOnly}
                  aria-label={`${excluded ? 'keep' : 'exclude'} these ${s.field} values instead`}
                  title={excluded ? 'keep only these instead' : 'exclude these instead (everything but them)'}
                  onClick={() => onSetPolarity(s.viewId, !excluded)}
                >
                  {excluded ? 'keep' : 'exclude'}
                </button>
              )}
              {onSave !== undefined && s.commitId !== undefined && (
                <button type="button" className="vzf-selchip-save" disabled={readOnly} aria-label={`save the ${labels[s.viewId] ?? s.viewId} selection under a name`} title="save under a name (a note on this commit)" onClick={() => onSave(s.viewId)}>
                  save
                </button>
              )}
              {onClear !== undefined && (
                <button type="button" className="vzf-selchip-clear" disabled={readOnly} aria-label={`clear the ${labels[s.viewId] ?? s.viewId} selection`} title="clear (a commit, like any act)" onClick={() => onClear(s.viewId)}>
                  ✕
                </button>
              )}
            </span>
          );
        })
      )}
      {live.length > 1 && onClearAll !== undefined && (
        <button type="button" className="vzf-selchips-clearall" disabled={readOnly} onClick={onClearAll} aria-label="clear all selections">
          clear all
        </button>
      )}
    </div>
  );
}
