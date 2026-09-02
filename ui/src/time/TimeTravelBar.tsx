/**
 * `<TimeTravelBar>` — two modes over the same branching history.
 *
 *   EXPLORE  — the full commit-dot timeline (active lineage) with ⟵/⟶ step
 *              semantics (the fork-safe tree rule, not a slider), a ⚑
 *              checkpoint button, and a "return to now" when viewing the past.
 *   PRESENT  — checkpoint-ONLY traversal: prev/next walk the NAMED beats, the
 *              current beat's title shows LARGE, and ACTING is disabled. This is
 *              the read-only storytelling mode; it reports `readOnly` up via
 *              `onReadOnlyChange` so the shell can dim its acting inputs.
 *
 * Controlled: `commits`, `cursor`, `head`, `checkpoints` come from the adapter;
 * `mode` is controllable (pass `mode`+`onModeChange`) or self-managed. Every
 * navigation is a callback — the bar never mutates state itself.
 *
 * COCKPIT dial: `compact` folds the bar into one slim strip (for the
 * {@link VizCockpit} top row). Naming a checkpoint always rides the
 * ⚑-triggered {@link CheckpointModal} — the inline text-field composer (the
 * old demo-agent dashboard's only consumer) is gone now that every consumer
 * has adopted the cockpit.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { CommitView, CheckpointView, BranchView } from '../adapter/types.js';
import { stepBackTarget, stepForwardTarget, activePath, pathToRoot } from '../adapter/stepNav.js';
import { orderedCheckpoints, currentBeatIndex, beatTarget } from './presentBeat.js';
import { useRailTicks } from './rail.js';
import { CheckpointModal } from './CheckpointModal.js';

export type TimeMode = 'explore' | 'present';

export interface TimeTravelBarProps {
  readonly mode?: TimeMode;
  readonly defaultMode?: TimeMode;
  readonly onModeChange?: (mode: TimeMode) => void;
  /** Fired on mount and whenever read-only-ness changes (present ⇒ true). */
  readonly onReadOnlyChange?: (readOnly: boolean) => void;
  /** Fold the bar into one slim strip (the cockpit's top row). */
  readonly compact?: boolean;
  /**
   * The BR-2 slot for the always-visible `<BranchPill>` — rendered beside the
   * Explore/Present toggle so "which path am I on?" sits with "which mode am I
   * in?" (both answer "where am I?"). Any node fits; the pill is the intent.
   */
  readonly pathPill?: ReactNode;
  readonly commits: readonly CommitView[];
  readonly cursor: string | null;
  readonly head: string | null;
  readonly checkpoints?: readonly CheckpointView[];
  readonly branches?: readonly BranchView[];
  readonly viewingPast?: boolean;
  readonly onSeek?: (commitId: string) => void;
  readonly onStepBack?: () => void;
  readonly onStepForward?: () => void;
  readonly onCheckpoint?: (label: string) => void;
  readonly onReturnToNow?: () => void;
  /** Present mode: play the beats as a fullscreen slideshow — the host owns the show (see `VizCockpit`'s `slideshow`). */
  readonly onPlay?: () => void;
}

export function TimeTravelBar(props: TimeTravelBarProps): JSX.Element {
  const {
    commits,
    cursor,
    head,
    checkpoints = [],
    branches = [],
    viewingPast = false,
    onSeek,
    onStepBack,
    onStepForward,
    onCheckpoint,
    onReturnToNow,
    onModeChange,
    onReadOnlyChange,
  } = props;

  const [internalMode, setInternalMode] = useState<TimeMode>(props.defaultMode ?? 'explore');
  const mode = props.mode ?? internalMode;
  const [ckptModalOpen, setCkptModalOpen] = useState(false);
  const compact = props.compact ?? false;

  const setMode = (next: TimeMode): void => {
    if (props.mode === undefined) setInternalMode(next);
    onModeChange?.(next);
  };
  const readOnly = mode === 'present';
  useEffect(() => {
    onReadOnlyChange?.(readOnly);
  }, [readOnly, onReadOnlyChange]);

  const active = activePath(commits, head);
  const lineage = pathToRoot(commits, head); // root→head, the explore timeline
  const ckptByCommit = new Map(checkpoints.filter((c) => c.commitId).map((c) => [c.commitId!, c.label]));

  const backDisabled = stepBackTarget(commits, cursor) === null;
  const forwardDisabled = stepForwardTarget(commits, cursor, head) === null;

  const defaultCkptName = `cp-${checkpoints.length + 1}`;
  const cursorCommit = commits.find((c) => c.id === cursor);

  return (
    <div className={`vzf-timebar${compact ? ' vzf-compact' : ''}`} data-vzf="time-travel-bar" data-mode={mode}>
      <div className="vzf-timebar-top">
        <span className="vzf-section-head" style={{ margin: 0 }}>
          Time travel
        </span>
        <div className="vzf-timebar-side">
          {props.pathPill}
          <div className="vzf-mode-toggle" role="tablist" aria-label="time-travel mode">
            <button role="tab" aria-selected={mode === 'explore'} className={mode === 'explore' ? 'vzf-active' : ''} onClick={() => setMode('explore')}>
              Explore
            </button>
            <button role="tab" aria-selected={mode === 'present'} className={mode === 'present' ? 'vzf-active' : ''} onClick={() => setMode('present')}>
              Present
            </button>
          </div>
        </div>
      </div>

      {viewingPast &&
        !readOnly &&
        (compact ? (
          // one row, always: in the compact strip the fact is a mark with the sentence on hover and for assistive tech, never a banner that takes the rail's room
          <span className="vzf-past-mark" role="status" data-vzf="past-mark" title="Viewing the past — act now (or step forward) to branch here.">
            <span aria-hidden="true">⏱</span>
            <span className="vzf-sr-only">Viewing the past — act now (or step forward) to branch here.</span>
          </span>
        ) : (
          <div className="vzf-past-banner" role="status">
            ⏱ Viewing the past — act now (or step forward) to branch here.
          </div>
        ))}

      {mode === 'explore' ? (
        <ExploreBody
          lineage={lineage}
          active={active}
          cursor={cursor}
          ckptByCommit={ckptByCommit}
          backDisabled={backDisabled}
          forwardDisabled={forwardDisabled}
          onSeek={onSeek}
          onStepBack={onStepBack}
          onStepForward={onStepForward}
          viewingPast={viewingPast}
          onReturnToNow={onReturnToNow}
          openCheckpointModal={() => setCkptModalOpen(true)}
          branchCount={branches.length}
        />
      ) : (
        <PresentBody head={head} checkpoints={checkpoints} commits={commits} cursor={cursor} onSeek={onSeek} onPlay={props.onPlay} />
      )}

      <CheckpointModal
        open={ckptModalOpen}
        commitId={cursor}
        commitLabel={cursorCommit?.label}
        defaultName={defaultCkptName}
        onSave={(label) => onCheckpoint?.(label)}
        onClose={() => setCkptModalOpen(false)}
      />
    </div>
  );
}

// ── explore body ────────────────────────────────────────────────────────────────
interface ExploreBodyProps {
  lineage: CommitView[];
  active: Set<string>;
  cursor: string | null;
  ckptByCommit: Map<string, string>;
  backDisabled: boolean;
  forwardDisabled: boolean;
  onSeek?: (id: string) => void;
  onStepBack?: () => void;
  onStepForward?: () => void;
  viewingPast: boolean;
  onReturnToNow?: () => void;
  openCheckpointModal: () => void;
  branchCount: number;
}
function ExploreBody(p: ExploreBodyProps): JSX.Element {
  const { rail, tick, dense } = useRailTicks(p.lineage.length);
  return (
    <>
      <div className="vzf-timeline-row">
        {/* back and forward side by side, so a hand never crosses the rail */}
        <div className="vzf-step-group" role="group" aria-label="step">
          <button className="vzf-btn" data-step="back" disabled={p.backDisabled} onClick={() => p.onStepBack?.()} title="Seek to the cursor's parent (ArrowLeft)">
            ⟵
          </button>
          <button className="vzf-btn" data-step="forward" disabled={p.forwardDisabled} onClick={() => p.onStepForward?.()} title="Seek to the next commit on this lane (ArrowRight)">
            ⟶
          </button>
        </div>
        <div className="vzf-timeline" data-vzf="timeline" ref={rail} data-dense={dense ? 'true' : undefined} style={{ '--vzf-tick': `${tick}px` } as CSSProperties}>
          {p.lineage.length === 0 ? (
            <span className="vzf-tl-empty">no commits yet — brush, click a bar, or ask the analyst to start the timeline</span>
          ) : (
            p.lineage.map((c) => (
              <button
                key={c.id}
                className={`vzf-tl-dot${c.id === p.cursor ? ' vzf-cursor' : ''}`}
                data-actor={c.actor}
                data-commit={c.id}
                title={`#${c.id} ${c.label} (${c.actor})${c.intent ? ': ' + c.intent : ''}`}
                aria-label={`#${c.id} ${c.label}`}
                onClick={() => p.onSeek?.(c.id)}
              >
                {p.ckptByCommit.has(c.id) ? <span className="vzf-tl-flag">⚑</span> : <span className="vzf-tl-flagslot" aria-hidden="true" />}
                <span className="vzf-tl-node" />
                {!dense && <span className="vzf-tl-cid">#{c.id}</span>}
              </button>
            ))
          )}
        </div>
      </div>
      <div className="vzf-time-controls">
        <button className="vzf-btn" data-vzf="checkpoint-open" title="Name a checkpoint at the cursor" onClick={p.openCheckpointModal}>
          ⚑ Checkpoint
        </button>
        {p.viewingPast && (
          <button className="vzf-btn" data-vzf="return-now" onClick={() => p.onReturnToNow?.()}>
            ⏭ Return to now
          </button>
        )}
        <span className="vzf-muted" style={{ fontSize: '0.8em' }}>
          {p.branchCount} branch{p.branchCount === 1 ? '' : 'es'} · cursor {p.cursor ? '#' + p.cursor : '—'}
        </span>
      </div>
    </>
  );
}

// ── present body (checkpoint-only, read-only) ────────────────────────────────────
interface PresentBodyProps {
  checkpoints: readonly CheckpointView[];
  commits: readonly CommitView[];
  cursor: string | null;
  /** The tip of the presented lineage (the head); beats ahead of the cursor on it are what "next" walks to. */
  head: string | null;
  onSeek?: (id: string) => void;
  onPlay?: () => void;
}
function PresentBody(p: PresentBodyProps): JSX.Element {
  // The presented lineage is the one that ends at the HEAD (beats ahead of the
  // cursor are what "next beat" walks to); the cursor's position is found on it.
  const tip = p.head ?? p.cursor;
  const ordered = orderedCheckpoints(p.checkpoints, p.commits, tip);
  const idx = currentBeatIndex(p.checkpoints, p.commits, p.cursor, tip);
  const { rail, tick, dense } = useRailTicks(ordered.length);
  if (ordered.length === 0) {
    return <div className="vzf-present-empty">No story beats on this lineage yet — name a checkpoint in Explore mode to build the guided tour.</div>;
  }
  const clamped = idx < 0 ? 0 : idx;
  const beat = ordered[clamped]!;
  // `ordered` holds only beats whose commit is on the presented lineage, and
  // the callers (prev/next buttons disabled at the ends, dots mapped over
  // `ordered`) never ask for an index outside it — so a beat here always
  // names a commit.
  const go = (to: number): void => {
    p.onSeek?.(beatTarget(ordered[to]!) as string);
  };
  return (
    <div data-vzf="present">
      <div className="vzf-timeline-row">
        <div className="vzf-step-group" role="group" aria-label="beats">
          <button className="vzf-btn" data-beat="prev" disabled={clamped <= 0} onClick={() => go(clamped - 1)} aria-label="previous beat">
            ⟵
          </button>
          <button className="vzf-btn" data-beat="next" disabled={clamped >= ordered.length - 1} onClick={() => go(clamped + 1)} aria-label="next beat">
            ⟶
          </button>
        </div>
        <div className="vzf-present-beat">
          <div className="vzf-beat-title">{beat.label}</div>
          <div className="vzf-beat-meta">
            beat {clamped + 1} of {ordered.length}
            {idx < 0 ? ' · (nearest to cursor)' : ''} · #{beat.commitId}
          </div>
        </div>
        <div className="vzf-timeline vzf-beat-rail" data-vzf="beat-rail" ref={rail} data-dense={dense ? 'true' : undefined} style={{ '--vzf-tick': `${tick}px` } as CSSProperties}>
          {ordered.map((c, i) => (
            <button key={c.commitId} className={`vzf-tl-dot${i === clamped ? ' vzf-cursor' : ''}`} data-beat-dot={c.commitId} title={c.label} aria-label={c.label} onClick={() => go(i)}>
              <span className="vzf-tl-flag">⚑</span>
              <span className="vzf-tl-node" />
              {!dense && <span className="vzf-tl-cid">{c.label}</span>}
            </button>
          ))}
        </div>
        {p.onPlay !== undefined && (
          <button className="vzf-btn vzf-play" data-vzf="play" onClick={() => p.onPlay?.()} title="Play the beats as a fullscreen slideshow — interactions stay off">
            ▶ Play
          </button>
        )}
      </div>
    </div>
  );
}
