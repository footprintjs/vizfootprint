/**
 * `<BranchPill>` — the always-visible "which path am I on?" chip for the
 * cockpit's top strip. Three honest states:
 *
 *   on-path      — the named path HEAD rides (violet, the provenance spine).
 *   viewing-past — HEAD is detached at a commit (the cursor travelled into the
 *                  past). Amber, matching the past banner: acting from here
 *                  starts a NEW named path automatically.
 *   empty        — no commits yet; the first step starts the default path.
 *
 * Clicking opens the PathsModal (the caller owns that state) — the pill itself
 * never mutates anything.
 */
import type { PathsView } from '../adapter/types.js';

export interface BranchPillProps {
  readonly paths: PathsView;
  /** Open the Paths modal. */
  readonly onClick?: () => void;
  readonly className?: string;
}

export function BranchPill(props: BranchPillProps): JSX.Element {
  const { paths } = props;
  const state = paths.current !== null ? 'on-path' : paths.detachedAt !== null ? 'viewing-past' : 'empty';
  const label = state === 'on-path' ? paths.current : state === 'viewing-past' ? 'viewing past' : 'no paths yet';
  const title =
    state === 'on-path'
      ? `You are on the path "${paths.current}" — click to see all paths`
      : state === 'viewing-past'
        ? `You are viewing the past (at #${paths.detachedAt}) — acting here starts a new path automatically`
        : 'Your first step starts the main path';
  return (
    <button
      type="button"
      className={`vzf-branch-pill${props.className ? ' ' + props.className : ''}`}
      data-vzf="branch-pill"
      data-state={state}
      title={title}
      aria-haspopup="dialog"
      onClick={() => props.onClick?.()}
    >
      <span aria-hidden="true">{state === 'viewing-past' ? '⏱' : '⎇'}</span>
      <span className="vzf-branch-pill-name">{label}</span>
    </button>
  );
}
