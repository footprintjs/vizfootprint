/**
 * `<TimeTravelBar>` — two modes over the same branching history.
 *
 *   EXPLORE  — the commit-bar timeline for the lineage THE CURSOR IS ON (the
 *              head's, unless time travel took the cursor onto another lane —
 *              the rail follows it so "where am I?" always has a mark), with a
 *              plain-words note saying which path those bars are and how much
 *              of the story they are, plus ⟵/⟶ step
 *              semantics (the fork-safe tree rule, not a slider), a ⚑
 *              bookmark button, and a "return to now" when viewing the past.
 *   PRESENT  — bookmark-ONLY traversal: prev/next walk the NAMED bookmarks, the
 *              current bookmark's title shows LARGE, and ACTING is disabled. This is
 *              the read-only storytelling mode; it reports `readOnly` up via
 *              `onReadOnlyChange` so the shell can dim its acting inputs.
 *
 * RENDERING ONLY. Everything the bar shows arrives in `model`
 * (`timeTravelModel`, or the `useTimeTravel` door over a session view): which
 * bars, which is the cursor, where a step lands, which bookmark is current.
 * The bar derives nothing from the log. `mode` is controllable (pass
 * `mode`+`onModeChange`) or self-managed. Every navigation is a callback — the
 * bar never mutates state itself.
 *
 * COCKPIT dial: `compact` folds the bar into one slim strip (for the
 * {@link VizCockpit} top row). Naming a bookmark always rides the
 * ⚑-triggered {@link BookmarkModal} — the inline text-field composer (the
 * old demo-agent dashboard's only consumer) is gone now that every consumer
 * has adopted the cockpit.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { ExploreModel, PresentModel, TimeTravelModel } from './model.js';
import { useRailTicks, railScope } from './rail.js';
import { railKeyTarget } from './railKeys.js';
import { BookmarkModal } from './BookmarkModal.js';

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
  /** What to draw: `timeTravelModel(…)`, or `useTimeTravel(view).model`. */
  readonly model: TimeTravelModel;
  readonly viewingPast?: boolean;
  readonly onSeek?: (commitId: string) => void;
  readonly onStepBack?: () => void;
  readonly onStepForward?: () => void;
  readonly onNameBookmark?: (label: string) => void;
  readonly onReturnToNow?: () => void;
  /** Present mode: play the bookmarks as a fullscreen slideshow — the host owns the show (see `VizCockpit`'s `slideshow`). */
  readonly onPlay?: () => void;
}

export function TimeTravelBar(props: TimeTravelBarProps): JSX.Element {
  const { model, viewingPast = false, onSeek, onStepBack, onStepForward, onNameBookmark, onReturnToNow, onModeChange, onReadOnlyChange } = props;

  const [internalMode, setInternalMode] = useState<TimeMode>(props.defaultMode ?? 'explore');
  const mode = props.mode ?? internalMode;
  const [bookmarkModalOpen, setBookmarkModalOpen] = useState(false);
  const compact = props.compact ?? false;

  const setMode = (next: TimeMode): void => {
    if (props.mode === undefined) setInternalMode(next);
    onModeChange?.(next);
  };
  const readOnly = mode === 'present';
  useEffect(() => {
    onReadOnlyChange?.(readOnly);
  }, [readOnly, onReadOnlyChange]);

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
          explore={model.explore}
          cursor={model.cursor}
          onSeek={onSeek}
          onStepBack={onStepBack}
          onStepForward={onStepForward}
          viewingPast={viewingPast}
          onReturnToNow={onReturnToNow}
          openBookmarkModal={() => setBookmarkModalOpen(true)}
        />
      ) : (
        <PresentBody present={model.present} onSeek={onSeek} onPlay={props.onPlay} />
      )}

      <BookmarkModal
        open={bookmarkModalOpen}
        commitId={model.cursor}
        commitLabel={model.cursorLabel}
        defaultName={model.suggestedBookmarkName}
        onSave={(label) => onNameBookmark?.(label)}
        onClose={() => setBookmarkModalOpen(false)}
      />
    </div>
  );
}

/**
 * Move the keyboard along a rail: the bars are the rail's buttons, in order,
 * and `railKeyTarget` says which one a key lands on. Focus moves; nothing is
 * sought until the bar is pressed.
 */
function walkRail(event: KeyboardEvent<HTMLElement>): void {
  const bars = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.vzf-tl-dot'));
  const to = railKeyTarget(bars.length, bars.indexOf(event.target as HTMLElement), event.key);
  if (to === null) return;
  event.preventDefault();
  bars[to]!.focus();
}

// ── explore body ────────────────────────────────────────────────────────────────
interface ExploreBodyProps {
  explore: ExploreModel;
  cursor: string | null;
  onSeek?: (id: string) => void;
  onStepBack?: () => void;
  onStepForward?: () => void;
  viewingPast: boolean;
  onReturnToNow?: () => void;
  openBookmarkModal: () => void;
}
function ExploreBody(p: ExploreBodyProps): JSX.Element {
  const { bars, back, forward, coverage, stop } = p.explore;
  const { rail, tick, dense } = useRailTicks(bars.length);
  // what the rail is showing, in words; null = it shows the whole story
  const scope = railScope(coverage);
  return (
    <>
      <div className="vzf-timeline-row">
        {/* back and forward side by side, so a hand never crosses the rail */}
        <div className="vzf-step-group" role="group" aria-label="step">
          <button className="vzf-btn" data-step="back" disabled={back === null} onClick={() => p.onStepBack?.()} title="Seek to the cursor's parent (ArrowLeft)">
            ⟵
          </button>
          <button className="vzf-btn" data-step="forward" disabled={forward === null} onClick={() => p.onStepForward?.()} title="Seek to the next commit on this lane (ArrowRight)">
            ⟶
          </button>
        </div>
        <div
          className="vzf-timeline"
          data-vzf="timeline"
          ref={rail}
          data-dense={dense ? 'true' : undefined}
          style={{ '--vzf-tick': `${tick}px` } as CSSProperties}
          role="group"
          aria-label="steps on this path — arrow keys move along them, Enter goes to one"
          onKeyDown={walkRail}
        >
          {bars.length === 0 ? (
            // "no commits yet" is only true of an empty log; a log with steps and no lineage to draw says that instead
            <span className="vzf-tl-empty">
              {coverage.total === 0 ? 'no commits yet — brush, click a bar, or ask the analyst to start the timeline' : `none of the ${coverage.total} recorded steps is on a path that can be drawn here`}
            </span>
          ) : (
            bars.map((c) => (
              <button
                key={c.id}
                className={`vzf-tl-dot${c.cursor ? ' vzf-cursor' : ''}${c.head ? ' vzf-head' : ''}${c.ahead ? ' vzf-ahead' : ''}`}
                data-actor={c.actor}
                data-commit={c.id}
                title={`#${c.id} ${c.label} (${c.actor})${c.intent !== undefined ? ': ' + c.intent : ''}`}
                aria-label={`step ${c.position} of ${bars.length}: #${c.id} ${c.label}${c.bookmarked ? ', bookmarked' : ''}${c.head ? ', now' : ''}`}
                aria-current={c.cursor ? 'step' : undefined}
                tabIndex={c.id === stop ? 0 : -1}
                onClick={() => p.onSeek?.(c.id)}
              >
                {c.bookmarked ? <span className="vzf-tl-flag">⚑</span> : <span className="vzf-tl-flagslot" aria-hidden="true" />}
                <span className="vzf-tl-node" />
                {!dense && <span className="vzf-tl-cid">#{c.id}</span>}
              </button>
            ))
          )}
        </div>
        {scope !== null && (
          <span
            className="vzf-tl-scope"
            data-vzf="rail-scope"
            title="The rail draws the path you are standing on. The other steps are on other paths — open Paths to see them all."
          >
            {scope}
          </span>
        )}
      </div>
      <div className="vzf-time-controls">
        <button className="vzf-btn" data-vzf="bookmark-open" title="Name a bookmark at the cursor" onClick={p.openBookmarkModal}>
          ⚑ Bookmark
        </button>
        {p.viewingPast && (
          <button className="vzf-btn" data-vzf="return-now" onClick={() => p.onReturnToNow?.()}>
            ⏭ Return to now
          </button>
        )}
        <span className="vzf-muted" style={{ fontSize: '0.8em' }}>
          {coverage.pathCount} branch{coverage.pathCount === 1 ? '' : 'es'} · cursor {p.cursor ? '#' + p.cursor : '—'}
        </span>
      </div>
    </>
  );
}

// ── present body (bookmark-only, read-only) ────────────────────────────────────
interface PresentBodyProps {
  present: PresentModel;
  onSeek?: (id: string) => void;
  onPlay?: () => void;
}
function PresentBody(p: PresentBodyProps): JSX.Element {
  const { stops, index, exact, previous, next } = p.present;
  const { rail, tick, dense } = useRailTicks(stops.length);
  const bookmark = stops[index];
  if (bookmark === undefined) {
    return <div className="vzf-present-empty">No bookmarks on this lineage yet — name one in Explore mode to build the guided tour.</div>;
  }
  return (
    <div data-vzf="present">
      <div className="vzf-timeline-row">
        <div className="vzf-step-group" role="group" aria-label="bookmarks">
          <button className="vzf-btn" data-bookmark="prev" disabled={previous === null} onClick={() => previous !== null && p.onSeek?.(previous)} aria-label="previous bookmark">
            ⟵
          </button>
          <button className="vzf-btn" data-bookmark="next" disabled={next === null} onClick={() => next !== null && p.onSeek?.(next)} aria-label="next bookmark">
            ⟶
          </button>
        </div>
        <div className="vzf-present-bookmark">
          <div className="vzf-bookmark-title">{bookmark.label}</div>
          <div className="vzf-bookmark-meta">
            bookmark {index + 1} of {stops.length}
            {exact ? '' : ' · (nearest to cursor)'} · #{bookmark.commitId}
          </div>
        </div>
        <div
          className="vzf-timeline vzf-bookmark-rail"
          data-vzf="bookmark-rail"
          ref={rail}
          data-dense={dense ? 'true' : undefined}
          style={{ '--vzf-tick': `${tick}px` } as CSSProperties}
          role="group"
          aria-label="bookmarks — arrow keys move along them, Enter goes to one"
          onKeyDown={walkRail}
        >
          {stops.map((c) => (
            <button key={c.commitId} className={`vzf-tl-dot${c.current ? ' vzf-cursor' : ''}`} data-bookmark-dot={c.commitId} title={c.label} aria-label={`bookmark ${c.position} of ${stops.length}: ${c.label}`} aria-current={c.current ? 'step' : undefined} tabIndex={c.current ? 0 : -1} onClick={() => p.onSeek?.(c.target)}>
              <span className="vzf-tl-flag">⚑</span>
              <span className="vzf-tl-node" />
              {!dense && <span className="vzf-tl-cid">{c.label}</span>}
            </button>
          ))}
        </div>
        {p.onPlay !== undefined && (
          <button className="vzf-btn vzf-play" data-vzf="play" onClick={() => p.onPlay?.()} title="Play the bookmarks as a fullscreen slideshow — interactions stay off">
            ▶ Play
          </button>
        )}
      </div>
    </div>
  );
}
