/**
 * `<CommitLog>` — the append-only, cause-tagged history as click-to-seek chips.
 * Each chip is badged by its authoring principal (a coloured left rail + badge),
 * dims when it is OFF the active branch, and rings when the cursor sits on it.
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
              {c.field} = {formatCommitValue(c)}
            </span>
            {c.intent && <span className="vzf-cause">{c.intent}</span>}
            <span className="vzf-cid">#{c.id}</span>
          </button>
        ))
      )}
    </div>
  );
}
