/**
 * `<TimeTravelBar>` — two modes over the same branching history.
 *
 *   EXPLORE  — the full commit-dot timeline (active lineage) with ⟵/⟶ step
 *              semantics (the fork-safe tree rule, not a slider), a checkpoint
 *              composer, and a "return to now" when viewing the past.
 *   PRESENT  — checkpoint-ONLY traversal: prev/next walk the NAMED beats, the
 *              current beat's title shows LARGE, and ACTING is disabled. This is
 *              the read-only storytelling mode; it reports `readOnly` up via
 *              `onReadOnlyChange` so the shell can dim its acting inputs.
 *
 * Controlled: `commits`, `cursor`, `head`, `checkpoints` come from the adapter;
 * `mode` is controllable (pass `mode`+`onModeChange`) or self-managed. Every
 * navigation is a callback — the bar never mutates state itself.
 */
import { useEffect, useState } from 'react';
import type { CommitView, CheckpointView, BranchView } from '../adapter/types.js';
import { stepBackTarget, stepForwardTarget, activePath, pathToRoot } from '../adapter/stepNav.js';
import { orderedCheckpoints, currentBeatIndex } from './presentBeat.js';

export type TimeMode = 'explore' | 'present';

export interface TimeTravelBarProps {
  readonly mode?: TimeMode;
  readonly defaultMode?: TimeMode;
  readonly onModeChange?: (mode: TimeMode) => void;
  /** Fired on mount and whenever read-only-ness changes (present ⇒ true). */
  readonly onReadOnlyChange?: (readOnly: boolean) => void;
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
  const [ckptLabel, setCkptLabel] = useState('');

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

  const submitCheckpoint = (): void => {
    const label = ckptLabel.trim() || `cp-${checkpoints.length + 1}`;
    setCkptLabel('');
    onCheckpoint?.(label);
  };

  return (
    <div className="vzf-timebar" data-vzf="time-travel-bar" data-mode={mode}>
      <div className="vzf-timebar-top">
        <span className="vzf-section-head" style={{ margin: 0 }}>
          Time travel
        </span>
        <div className="vzf-mode-toggle" role="tablist" aria-label="time-travel mode">
          <button role="tab" aria-selected={mode === 'explore'} className={mode === 'explore' ? 'vzf-active' : ''} onClick={() => setMode('explore')}>
            Explore
          </button>
          <button role="tab" aria-selected={mode === 'present'} className={mode === 'present' ? 'vzf-active' : ''} onClick={() => setMode('present')}>
            Present
          </button>
        </div>
      </div>

      {viewingPast && !readOnly && (
        <div className="vzf-past-banner" role="status">
          ⏱ Viewing the past — act now (or step forward) to branch here.
        </div>
      )}

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
          ckptLabel={ckptLabel}
          setCkptLabel={setCkptLabel}
          submitCheckpoint={submitCheckpoint}
          branchCount={branches.length}
        />
      ) : (
        <PresentBody checkpoints={checkpoints} commits={commits} cursor={cursor} onSeek={onSeek} />
      )}
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
  ckptLabel: string;
  setCkptLabel: (v: string) => void;
  submitCheckpoint: () => void;
  branchCount: number;
}
function ExploreBody(p: ExploreBodyProps): JSX.Element {
  return (
    <>
      <div className="vzf-timeline-row">
        <button className="vzf-btn" data-step="back" disabled={p.backDisabled} onClick={() => p.onStepBack?.()} title="Seek to the cursor's parent (ArrowLeft)">
          ⟵
        </button>
        <div className="vzf-timeline" data-vzf="timeline">
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
                onClick={() => p.onSeek?.(c.id)}
              >
                <span className="vzf-tl-flag">{p.ckptByCommit.has(c.id) ? '⚑' : ' '}</span>
                <span className="vzf-tl-node" />
                <span className="vzf-tl-cid">#{c.id}</span>
              </button>
            ))
          )}
        </div>
        <button className="vzf-btn" data-step="forward" disabled={p.forwardDisabled} onClick={() => p.onStepForward?.()} title="Seek to the next commit on this lane (ArrowRight)">
          ⟶
        </button>
      </div>
      <div className="vzf-time-controls">
        <input
          className="vzf-input vzf-ckpt-input"
          type="text"
          placeholder="name this point"
          value={p.ckptLabel}
          onChange={(e) => p.setCkptLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') p.submitCheckpoint();
          }}
        />
        <button className="vzf-btn" onClick={() => p.submitCheckpoint()}>
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
  onSeek?: (id: string) => void;
}
function PresentBody(p: PresentBodyProps): JSX.Element {
  const ordered = orderedCheckpoints(p.checkpoints);
  const idx = currentBeatIndex(p.checkpoints, p.commits, p.cursor);
  if (ordered.length === 0) {
    return <div className="vzf-present-empty">No story beats yet — name a checkpoint in Explore mode to build the guided tour.</div>;
  }
  const clamped = idx < 0 ? 0 : idx;
  const beat = ordered[clamped]!;
  const go = (to: number): void => {
    const t = ordered[to];
    if (t?.commitId) p.onSeek?.(t.commitId);
  };
  return (
    <div data-vzf="present">
      <div className="vzf-timeline-row">
        <button className="vzf-btn" data-beat="prev" disabled={clamped <= 0} onClick={() => go(clamped - 1)} aria-label="previous beat">
          ⟵
        </button>
        <div className="vzf-present-beat">
          <div className="vzf-beat-title">{beat.label}</div>
          <div className="vzf-beat-meta">
            beat {clamped + 1} of {ordered.length}
            {idx < 0 ? ' · (nearest to cursor)' : ''} · #{beat.commitId}
          </div>
        </div>
        <button className="vzf-btn" data-beat="next" disabled={clamped >= ordered.length - 1} onClick={() => go(clamped + 1)} aria-label="next beat">
          ⟶
        </button>
      </div>
      <div className="vzf-time-controls" style={{ justifyContent: 'center' }}>
        {ordered.map((c, i) => (
          <button
            key={c.commitId}
            className={`vzf-tl-dot${i === clamped ? ' vzf-cursor' : ''}`}
            data-beat-dot={c.commitId}
            title={c.label}
            onClick={() => go(i)}
          >
            <span className="vzf-tl-flag">⚑</span>
            <span className="vzf-tl-node" />
            <span className="vzf-tl-cid">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
