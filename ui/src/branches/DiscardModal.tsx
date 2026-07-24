/**
 * `<DiscardModal>` — the small confirm behind "Discard from here…" (TL-1).
 *
 * Discarding drops everything AFTER a step on your own path. It is the one
 * lifecycle gesture that changes where your path ends, so it asks first — and
 * the copy states exactly what does and does not happen, with the honesty line
 * verbatim: **"Hidden, not erased — the statistics remember."** The abandoned
 * part is kept as an archived path you can restore from the Paths list, every
 * step stays in the log, and the FDR ledger is untouched (alpha already spent
 * is never refunded).
 *
 * The modal is DUMB: it renders the question and calls back. The session owns
 * the rules, so a refusal (pointing at another path's commit, a fork point with
 * two futures, the tip you already stand on) comes back as a typed gap in the
 * next snapshot — the Gaps panel shows the reason.
 */
import { VizModal } from '../layout/VizModal.js';
import { HIDDEN_NOT_ERASED } from '../adapter/types.js';

export interface DiscardModalProps {
  /** The commit to keep — everything after it goes; null closes the modal. */
  readonly commitId: string | null;
  readonly onClose: () => void;
  /** How many steps come after `commitId` on the active path, when known. */
  readonly stepsAfter?: number;
  readonly onConfirm: (commitId: string) => void;
}

export function DiscardModal(props: DiscardModalProps): JSX.Element | null {
  const { commitId, onClose, stepsAfter, onConfirm } = props;
  if (commitId === null) return null;
  const count =
    stepsAfter === undefined ? 'Everything after this step' : `${stepsAfter} step${stepsAfter === 1 ? '' : 's'} after this one`;

  return (
    <VizModal
      open
      onClose={onClose}
      size="small"
      name="discard"
      title="Discard from here?"
      initialFocus="[data-vzf='discard-cancel']"
      footer={
        <>
          <button type="button" className="vzf-btn vzf-btn-ghost" data-vzf="discard-cancel" onClick={onClose}>
            Keep everything
          </button>
          <button
            type="button"
            className="vzf-btn vzf-btn-danger"
            data-vzf="discard-confirm"
            onClick={() => {
              onConfirm(commitId);
              onClose();
            }}
          >
            Discard from here
          </button>
        </>
      }
    >
      <div className="vzf-discard" data-vzf="discard-body">
        <p className="vzf-discard-lead">
          {count} will leave this path. Your path will end at <span className="vzf-mono">#{commitId}</span>, and the part
          you drop is kept as an <strong>archived path</strong> you can restore from the Paths list.
        </p>
        <p className="vzf-discard-honesty" data-vzf="discard-honesty">
          {HIDDEN_NOT_ERASED}
        </p>
        <p className="vzf-discard-detail">
          Every step stays in the log and still explains itself. Any test you already ran stays in the FDR ledger — alpha
          spent on a line of work you walk away from is never refunded.
        </p>
      </div>
    </VizModal>
  );
}
