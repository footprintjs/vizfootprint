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
import { useState } from 'react';
import type { CommitView } from '../adapter/types.js';
import { formatCommitValue } from './format.js';

export interface CommitLogProps {
  readonly commits: readonly CommitView[];
  readonly onSeek?: (commitId: string) => void;
  /** Family chips (interaction · design · analysis · story) to hide a family from the list. Shown when more than one family is present; false hides the chips. */
  readonly families?: boolean;
  readonly emptyText?: string;
  readonly className?: string;
}

export const COMMIT_FAMILIES = ['interaction', 'design', 'analysis', 'story'] as const;
export type CommitFamily = (typeof COMMIT_FAMILIES)[number];

export function CommitLog(props: CommitLogProps): JSX.Element {
  const { commits, onSeek } = props;
  // family chips: every family present is on by default; a chip toggles it off (the commits stay in the log, hidden here)
  const [hidden, setHidden] = useState<ReadonlySet<CommitFamily>>(new Set());
  const familyOfCommit = (c: CommitView): CommitFamily => c.family ?? 'interaction';
  const present = COMMIT_FAMILIES.filter((f) => commits.some((c) => familyOfCommit(c) === f));
  const shown = commits.filter((c) => !hidden.has(familyOfCommit(c)));
  return (
    <div className={`vzf-commitlog${props.className ? ' ' + props.className : ''}`} data-vzf="commit-log">
      {props.families !== false && present.length > 1 ? (
        <div className="vzf-commitlog-families" role="group" aria-label="commit families">
          {present.map((f) => {
            const n = commits.filter((c) => familyOfCommit(c) === f).length;
            const on = !hidden.has(f);
            return (
              <button
                key={f}
                type="button"
                className={`vzf-chip vzf-family-chip${on ? '' : ' vzf-off'}`}
                aria-pressed={on}
                data-family={f}
                onClick={() => setHidden((h) => { const next = new Set(h); if (next.has(f)) next.delete(f); else next.add(f); return next; })}
              >
                {f} <span className="vzf-soft">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.length === 0 && commits.length > 0 ? <div className="vzf-empty">every commit here is hidden by the family chips</div> : null}
      {commits.length === 0 ? (
        <div className="vzf-empty">{props.emptyText ?? 'no commits yet — brush the scatter, click a bar, or ask the analyst'}</div>
      ) : (
        shown.map((c) => (
          <button
            key={c.id}
            className={`vzf-chip${c.onBranch ? '' : ' vzf-offbranch'}${c.isCursor ? ' vzf-cursor' : ''}`}
            data-actor={c.actor}
            data-commit={c.id}
            title={c.intent ?? ''}
            onClick={() => onSeek?.(c.id)}
          >
            <span className={`vzf-badge vzf-${c.actor}`}>{c.actor}</span>
            <span className={`vzf-family vzf-family-${familyOfCommit(c)}`} title="commit family">{familyOfCommit(c)}</span>
            {c.dataMoved === true && c.moved !== undefined ? (
              <span className="vzf-data-moved" title={`the data has moved since: ${c.moved.map((m) => `${m.table} was ${m.from}, now ${m.to}`).join('; ')}`}>
                data moved
              </span>
            ) : null}
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
