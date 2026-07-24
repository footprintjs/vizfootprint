/**
 * `<AdoptToast>` — what an "Adopt this path" run actually did (TL-1).
 *
 * Adopting replays another path's steps onto yours, so the result is a COUNT,
 * not a yes/no: how many landed, how many were honestly skipped (each with its
 * reason), and how many collided with work this path had already done. A
 * refused adopt shows its reason instead — the toast never says "adopted" when
 * nothing happened.
 *
 * Same manners as the ForkToast: `role="status"` (polite), dismissible,
 * auto-hides, entrance animation obeys `prefers-reduced-motion` (CSS).
 */
import { useEffect, useState } from 'react';
import type { AdoptSummaryView } from '../adapter/types.js';

export interface AdoptToastProps {
  /** The run to report; null renders nothing. The caller clears it on dismiss. */
  readonly summary: AdoptSummaryView | null;
  readonly onDismiss: () => void;
  /** ms until it hides itself. Default 9000 (there is more to read than a fork); 0 disables. */
  readonly autoHideMs?: number;
}

export function AdoptToast(props: AdoptToastProps): JSX.Element | null {
  const { summary, onDismiss, autoHideMs = 9000 } = props;
  const [showWhy, setShowWhy] = useState(false);

  // a fresh run always starts collapsed
  useEffect(() => setShowWhy(false), [summary]);

  useEffect(() => {
    if (summary === null || autoHideMs <= 0) return;
    const t = setTimeout(onDismiss, autoHideMs);
    return () => clearTimeout(t);
    // onDismiss is a stable caller callback in every call site; keyed on the run
  }, [summary, autoHideMs, onDismiss]);

  if (summary === null) return null;

  return (
    <div className="vzf-toast" data-vzf="adopt-toast" role="status" data-ok={summary.ok ? 'true' : 'false'}>
      {summary.ok ? (
        <span className="vzf-toast-text">
          ⤵ Adopted <strong>“{summary.path}”</strong> — {summary.applied} step{summary.applied === 1 ? '' : 's'} landed here
          {summary.skipped > 0 && <>, {summary.skipped} skipped</>}
          {summary.conflicts > 0 && (
            <>
              , {summary.conflicts} overlapped what you had already done
            </>
          )}
          . That path is untouched.
        </span>
      ) : (
        <span className="vzf-toast-text">
          ⤵ Could not adopt <strong>“{summary.path}”</strong> — {summary.reason}
        </span>
      )}
      {summary.skippedReasons.length > 0 && (
        <button
          type="button"
          className="vzf-btn vzf-btn-ghost vzf-toast-action"
          data-vzf="adopt-toast-why"
          aria-expanded={showWhy}
          onClick={() => setShowWhy(!showWhy)}
        >
          {showWhy ? 'Hide why' : 'Why skipped?'}
        </button>
      )}
      {showWhy && (
        <ul className="vzf-toast-list" data-vzf="adopt-toast-reasons">
          {summary.skippedReasons.map((reason, i) => (
            <li key={`${i}-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}
      <button type="button" className="vzf-btn vzf-btn-ghost" data-vzf="adopt-toast-dismiss" aria-label="dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
