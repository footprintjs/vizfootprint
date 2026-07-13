/**
 * `<CheckpointModal>` — the small frosted-glass prompt the ⚑ button opens: one
 * autofocused name field, Enter (or the Save button) commits the checkpoint
 * through the caller's `onSave` (which routes to the existing adapter action),
 * Esc / Cancel / backdrop click cancel, and it shows WHICH commit the flag will
 * mark. An empty name falls back to `defaultName` (the bar passes `cp-N`).
 */
import { useEffect, useState } from 'react';
import { VizModal } from '../layout/VizModal.js';

export interface CheckpointModalProps {
  readonly open: boolean;
  /** The commit the checkpoint will mark (the current cursor). */
  readonly commitId: string | null;
  /** Optional short label of that commit, shown beside its id. */
  readonly commitLabel?: string;
  /** Used when the field is left empty (e.g. `cp-3`). */
  readonly defaultName?: string;
  readonly onSave: (label: string) => void;
  readonly onClose: () => void;
}

export function CheckpointModal(props: CheckpointModalProps): JSX.Element | null {
  const { open, onSave, onClose } = props;
  const [name, setName] = useState('');

  // a fresh field every time the prompt opens
  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const save = (): void => {
    onSave(name.trim() || props.defaultName || 'checkpoint');
    onClose();
  };

  return (
    <VizModal
      open={open}
      onClose={onClose}
      size="small"
      name="checkpoint"
      title="⚑ Name this checkpoint"
      initialFocus=".vzf-ckpt-name"
      footer={
        <>
          <button type="button" className="vzf-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="vzf-btn vzf-btn-primary" data-vzf="checkpoint-save" onClick={save}>
            Save checkpoint
          </button>
        </>
      }
    >
      <div className="vzf-ckpt-form">
        <input
          className="vzf-input vzf-ckpt-name"
          type="text"
          placeholder={props.defaultName ?? 'name this point'}
          aria-label="checkpoint name"
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
        <div className="vzf-ckpt-target">
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
