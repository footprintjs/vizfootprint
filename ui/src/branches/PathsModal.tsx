/**
 * `<PathsModal>` — the glass list of NAMED paths (the BranchPill opens it).
 * Each row: the name (with an inline ✎ rename), the step count, the tip
 * commit, and a "current" marker on the path you are on. Clicking a row
 * SWITCHES to that path (and closes — the intent is complete). The footer's
 * "New path from here" starts a fresh named path at the CURSOR.
 *
 * Present mode (`readOnly`) keeps the list viewable but pauses every action —
 * switching, renaming, and new-path all disappear behind honest notes.
 * Ordering: the current path first, then most recent activity first (the tip's
 * logical timestamp — never a fabricated wall-clock).
 */
import { useEffect, useState } from 'react';
import { VizModal } from '../layout/VizModal.js';
import type { PathsView, PathView } from '../adapter/types.js';

export interface PathsModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly paths: PathsView;
  /** Where the cursor sits — the "from here" a new path starts at. */
  readonly cursor: string | null;
  /** Present mode: viewing only, every action paused. */
  readonly readOnly?: boolean;
  readonly onSwitch?: (name: string) => void;
  readonly onRename?: (from: string, to: string) => void;
  readonly onNewPath?: (commitId: string) => void;
}

export function PathsModal(props: PathsModalProps): JSX.Element | null {
  const { open, onClose, paths, cursor, readOnly = false } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // a fresh (non-renaming) list every time the modal opens
  useEffect(() => {
    if (open) setRenaming(null);
  }, [open]);

  const ordered: PathView[] = [...paths.list].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.lastTs - a.lastTs);

  const saveRename = (from: string): void => {
    const to = draft.trim();
    if (to.length > 0 && to !== from) props.onRename?.(from, to);
    setRenaming(null);
  };

  return (
    <VizModal open={open} onClose={onClose} size="small" name="paths" title="⎇ Paths">
      <div className="vzf-paths" data-vzf="paths-list">
        {paths.current === null && paths.detachedAt !== null && (
          <div className="vzf-past-banner" role="status">
            ⏱ Viewing the past (at #{paths.detachedAt}) — acting here starts a new path automatically.
          </div>
        )}
        {readOnly && <div className="vzf-paths-note">Present mode — viewing only; switch to Explore to act.</div>}
        {ordered.length === 0 ? (
          <div className="vzf-empty">No named paths yet — your first step starts one.</div>
        ) : (
          ordered.map((p) => (
            <div key={p.name} className={`vzf-path-row${p.active ? ' vzf-active' : ''}`} data-path={p.name}>
              {renaming === p.name ? (
                <input
                  className="vzf-input vzf-path-rename-input"
                  aria-label={`new name for ${p.name}`}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveRename(p.name);
                    } else if (e.key === 'Escape') {
                      e.stopPropagation(); // cancel the rename, keep the modal open
                      setRenaming(null);
                    }
                  }}
                  onBlur={() => saveRename(p.name)}
                />
              ) : (
                <button
                  type="button"
                  className="vzf-path-switch"
                  data-vzf="path-switch"
                  disabled={p.active || readOnly}
                  title={p.active ? 'you are on this path' : readOnly ? 'Present mode — switching is paused' : `switch to "${p.name}"`}
                  onClick={() => {
                    props.onSwitch?.(p.name);
                    onClose();
                  }}
                >
                  <span className="vzf-path-name">{p.name}</span>
                  {p.active && <span className="vzf-path-current">● current</span>}
                  <span className="vzf-path-meta">
                    {p.steps} step{p.steps === 1 ? '' : 's'} · latest <span className="vzf-mono">#{p.tip}</span>
                  </span>
                </button>
              )}
              {!readOnly && renaming !== p.name && (
                <button
                  type="button"
                  className="vzf-btn vzf-btn-ghost vzf-path-rename"
                  data-vzf="path-rename"
                  aria-label={`rename ${p.name}`}
                  title={`rename "${p.name}"`}
                  onClick={() => {
                    setRenaming(p.name);
                    setDraft(p.name);
                  }}
                >
                  ✎
                </button>
              )}
            </div>
          ))
        )}
        {!readOnly && (
          <div className="vzf-paths-foot">
            <button
              type="button"
              className="vzf-btn"
              data-vzf="path-new"
              disabled={cursor === null}
              title={cursor === null ? 'no steps yet — act first, then fork from any point' : `start a new path at #${cursor}`}
              onClick={() => {
                props.onNewPath?.(cursor!);
                onClose();
              }}
            >
              ⎇ New path from here {cursor !== null && <span className="vzf-mono">(#{cursor})</span>}
            </button>
          </div>
        )}
      </div>
    </VizModal>
  );
}
