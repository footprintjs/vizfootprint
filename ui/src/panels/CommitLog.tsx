/**
 * `<CommitLog>` — the append-only, cause-tagged history as click-to-seek chips.
 * Each chip is badged by its authoring principal (a coloured left rail + badge),
 * dims when it is OFF the active branch, and rings when the cursor sits on it.
 * BR-2: a commit whose cause carries `replayedFrom` / `revertOf` wears a small
 * provenance tag (↷ brought over from #x · ⎌ undoes #x · ⚠ n overridden) so a
 * bring-over or undo reads as its own story, not an anonymous step.
 * Controlled: it renders the adapter's `commits` (which already carry the
 * onBranch / isCursor flags) and calls `onSeek` on click.
 */
import type { CommitView } from '../adapter/types.js';
import { formatCommitValue } from './format.js';

export interface CommitLogProps {
  readonly commits: readonly CommitView[];
  readonly onSeek?: (commitId: string) => void;
  readonly emptyText?: string;
  readonly className?: string;
}

export function CommitLog(props: CommitLogProps): JSX.Element {
  const { commits, onSeek } = props;
  return (
    <div className={`vzf-commitlog${props.className ? ' ' + props.className : ''}`} data-vzf="commit-log">
      {commits.length === 0 ? (
        <div className="vzf-empty">{props.emptyText ?? 'no commits yet — brush the scatter, click a bar, or ask the analyst'}</div>
      ) : (
        commits.map((c) => (
          <button
            key={c.id}
            className={`vzf-chip${c.onBranch ? '' : ' vzf-offbranch'}${c.isCursor ? ' vzf-cursor' : ''}`}
            data-actor={c.actor}
            data-commit={c.id}
            title={c.intent ?? ''}
            onClick={() => onSeek?.(c.id)}
          >
            <span className={`vzf-badge vzf-${c.actor}`}>{c.actor}</span>
            <span className="vzf-mono vzf-soft" style={{ fontSize: '0.72em' }}>
              {c.kind}
            </span>
            <span className="vzf-chip-body">
              {/* D30: a cell's plain words already carry both field names
                  ("price 100 – 150 and category = Formal") — prefixing the
                  joint label would say everything twice */}
              {c.kind === 'cell' ? formatCommitValue(c) : c.kind === 'match' ? `${c.field} ${formatCommitValue(c)}` : c.viewId.startsWith('link:') ? formatCommitValue(c) : `${c.field} = ${formatCommitValue(c)}`}
            </span>
            {c.intent && <span className="vzf-cause">{c.intent}</span>}
            {c.replayedFrom !== undefined && (
              <span className="vzf-cause vzf-replay" data-replayed-from={c.replayedFrom}>
                ↷ brought over from #{c.replayedFrom}
              </span>
            )}
            {c.revertOf !== undefined && (
              <span className="vzf-cause vzf-revert" data-revert-of={c.revertOf}>
                ⎌ undoes #{c.revertOf}
              </span>
            )}
            {c.conflicts !== undefined && c.conflicts.length > 0 && (
              <span className="vzf-cause vzf-conflict" title={`overrode: #${c.conflicts.join(', #')}`}>
                ⚠ {c.conflicts.length} overridden
              </span>
            )}
            <span className="vzf-cid">#{c.id}</span>
          </button>
        ))
      )}
    </div>
  );
}
