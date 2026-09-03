/**
 * `<BookmarkModal>` — the small frosted-glass prompt the ⚑ button opens: one
 * autofocused name field, Enter (or the Save button) commits the bookmark
 * through the caller's `onSave` (which routes to the existing adapter action),
 * Esc / Cancel / backdrop click cancel, and it shows WHICH commit the flag will
 * mark. An empty name falls back to `defaultName` (the bar passes `bookmark-N`).
 */
import { useEffect, useState } from 'react';
import { VizModal } from '../layout/VizModal.js';

export interface BookmarkModalProps {
  readonly open: boolean;
  /** The commit the bookmark will mark (the current cursor). */
  readonly commitId: string | null;
  /** Optional short label of that commit, shown beside its id. */
  readonly commitLabel?: string;
  /** Used when the field is left empty (e.g. `bookmark-3`). */
  readonly defaultName?: string;
  readonly onSave: (label: string) => void;
  readonly onClose: () => void;
}

export function BookmarkModal(props: BookmarkModalProps): JSX.Element | null {
  const { open, onSave, onClose } = props;
  const [name, setName] = useState('');

  // a fresh field every time the prompt opens
  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const save = (): void => {
    onSave(name.trim() || props.defaultName || 'bookmark');
    onClose();
  };

  return (
    <VizModal
      open={open}
      onClose={onClose}
      size="small"
      name="bookmark"
      title="⚑ Name this bookmark"
      initialFocus=".vzf-bookmark-name"
      footer={
        <>
          <button type="button" className="vzf-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="vzf-btn vzf-btn-primary" data-vzf="bookmark-save" onClick={save}>
            Save bookmark
          </button>
        </>
      }
    >
      <div className="vzf-bookmark-form">
        <input
          className="vzf-input vzf-bookmark-name"
          type="text"
          placeholder={props.defaultName ?? 'name this point'}
          aria-label="bookmark name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // preventDefault matters: closing the modal restores focus to the
              // ⚑ opener DURING this keydown, and Enter's native default action
              // would then "click" that button and instantly reopen the prompt
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="vzf-bookmark-target">
          {props.commitId !== null ? (
            <>
              marks commit <span className="vzf-mono">#{props.commitId}</span>
              {props.commitLabel !== undefined && <span className="vzf-muted"> — {props.commitLabel}</span>}
            </>
          ) : (
            'marks the latest commit'
          )}
        </div>
      </div>
    </VizModal>
  );
}
