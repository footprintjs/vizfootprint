/**
 * `<ForkToast>` — the non-blocking "you just forked" notice. It watches the
 * path journal (`state.paths.events`) for AUTO-created refs: acting from a
 * past cursor branches, and BR-1 now NAMES that branch — this toast is how the
 * user learns it happened without being interrupted.
 *
 * Honesty rules:
 *   - the very FIRST ref creation (the default path being born on the first
 *     commit) is not a fork and never toasts;
 *   - journal entries that existed when the component MOUNTED never toast
 *     (a page reload does not replay old forks);
 *   - TL-1: a DISCARD parks the abandoned future under a fresh auto-named ref,
 *     which is a `create` in the journal but is NOT a fork the user made — the
 *     `discard` event names it as its `kept` path, so those creates never toast
 *     (the DiscardModal already told the user what happens to it);
 *   - `role="status"` (polite live region), dismissible, auto-hides, and the
 *     entrance animation obeys `prefers-reduced-motion` (CSS).
 */
import { useEffect, useRef, useState } from 'react';
import type { PathEventView } from '../adapter/types.js';

export interface ForkToastProps {
  /** The path journal (`state.paths.events`). */
  readonly events: readonly PathEventView[];
  /** ms until the toast hides itself. Default 6000; 0 disables the auto-hide. */
  readonly autoHideMs?: number;
  /** Optional "See paths" affordance — opens the Paths modal, then dismisses. */
  readonly onOpenPaths?: () => void;
}

/** AUTO-created refs that are real forks (some path already existed before them). */
function autoForks(events: readonly PathEventView[]): { name: string; ts: number }[] {
  // TL-1: names a discard parked its abandoned future under — created, but never
  // forked into by the user.
  const parked = new Set(events.filter((e) => e.type === 'discard').map((e) => e.kept));
  const out: { name: string; ts: number }[] = [];
  let seenCreate = false;
  for (const e of events) {
    if (e.type !== 'create') continue;
    if (seenCreate && e.auto && !parked.has(e.name)) out.push({ name: e.name, ts: e.ts });
    seenCreate = true;
  }
  return out;
}

function maxTs(events: readonly PathEventView[]): number {
  return events.reduce((m, e) => (e.ts > m ? e.ts : m), -1);
}

export function ForkToast(props: ForkToastProps): JSX.Element | null {
  const { events, autoHideMs = 6000 } = props;
  const [toast, setToast] = useState<{ name: string; ts: number } | null>(null);
  // baseline: everything already in the journal at mount is old news
  const seenRef = useRef<number>(NaN);
  if (Number.isNaN(seenRef.current)) seenRef.current = maxTs(events);

  useEffect(() => {
    const fresh = autoForks(events).filter((f) => f.ts > seenRef.current);
    if (fresh.length === 0) return;
    const latest = fresh[fresh.length - 1]!;
    seenRef.current = maxTs(events);
    setToast(latest);
  }, [events]);

  useEffect(() => {
    if (toast === null || autoHideMs <= 0) return;
    const t = setTimeout(() => setToast(null), autoHideMs);
    return () => clearTimeout(t);
  }, [toast, autoHideMs]);

  if (toast === null) return null;
  return (
    <div className="vzf-toast" data-vzf="fork-toast" role="status">
      <span className="vzf-toast-text">
        ⎇ Forked a new path <strong>“{toast.name}”</strong> — your previous story is safe in Paths.
      </span>
      {props.onOpenPaths !== undefined && (
        <button
          type="button"
          className="vzf-btn vzf-btn-ghost vzf-toast-action"
          data-vzf="fork-toast-paths"
          onClick={() => {
            props.onOpenPaths?.();
            setToast(null);
          }}
        >
          See paths
        </button>
      )}
      <button type="button" className="vzf-btn vzf-btn-ghost" data-vzf="fork-toast-dismiss" aria-label="dismiss" onClick={() => setToast(null)}>
        ✕
      </button>
    </div>
  );
}
