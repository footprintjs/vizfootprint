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
 * Controlled: `commits`, `cursor`, `head`, `bookmarks` come from the adapter;
 * `mode` is controllable (pass `mode`+`onModeChange`) or self-managed. Every
 * navigation is a callback — the bar never mutates state itself.
 *
 * COCKPIT dial: `compact` folds the bar into one slim strip (for the
 * {@link VizCockpit} top row). Naming a bookmark always rides the
 * ⚑-triggered {@link BookmarkModal} — the inline text-field composer (the
 * old demo-agent dashboard's only consumer) is gone now that every consumer
 * has adopted the cockpit.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { CommitView, BookmarkView, BranchView } from '../adapter/types.js';
import { stepBackTarget, stepForwardTarget, activePath, pathToRoot } from '../adapter/stepNav.js';
import { orderedBookmarks, currentBookmarkIndex, bookmarkTarget } from './presentBookmark.js';
import { useRailTicks, railScope } from './rail.js';
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
  /**
   * The NAME of the path the story is on (`state.paths.current`) — the rail
   * says which path its bars belong to, so a fork reads as a fork and not as
   * fifty-three steps that vanished. Absent = "this path".
   *
   * It names the HEAD's path, so the rail uses it only while it is drawing
   * that path. Travel onto another lane and the bars are somebody else's
   * steps: printing a last-known name over them would be a lie, so the rail
   * falls back to "this path" and says where "now" went instead.
   */
  readonly pathName?: string;
  readonly commits: readonly CommitView[];
  readonly cursor: string | null;
  readonly head: string | null;
  readonly bookmarks?: readonly BookmarkView[];
  readonly branches?: readonly BranchView[];
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
  const {
    commits,
    cursor,
    head,
    bookmarks = [],
    branches = [],
    viewingPast = false,
    onSeek,
    onStepBack,
    onStepForward,
    onNameBookmark,
    onReturnToNow,
    onModeChange,
    onReadOnlyChange,
  } = props;

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

  const active = activePath(commits, head);
  // The rail draws the lineage the CURSOR is standing on. Normally that is the
  // head's — but travel onto another lane and the head's path no longer holds
  // the cursor, and the rail used to draw a set of bars with none of them
  // marked (`.vzf-tl-dot.vzf-cursor` matched nothing: "where am I?" had no
  // answer on screen). Following the cursor keeps the mark always drawable;
  // `railScope` below says which path the bars belong to.
  const headLineage = pathToRoot(commits, head); // root→head
  const onHeadLineage = cursor === null || headLineage.some((c) => c.id === cursor);
  const lineage = onHeadLineage ? headLineage : pathToRoot(commits, cursor);
  const bookmarkByCommit = new Map(bookmarks.filter((c) => c.commitId).map((c) => [c.commitId!, c.label]));

  const backDisabled = stepBackTarget(commits, cursor) === null;
  const forwardDisabled = stepForwardTarget(commits, cursor, head) === null;

  const defaultBookmarkName = `bookmark-${bookmarks.length + 1}`;
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
          head={head}
          bookmarkByCommit={bookmarkByCommit}
          backDisabled={backDisabled}
          forwardDisabled={forwardDisabled}
          onSeek={onSeek}
          onStepBack={onStepBack}
          onStepForward={onStepForward}
          viewingPast={viewingPast}
          onReturnToNow={onReturnToNow}
          openBookmarkModal={() => setBookmarkModalOpen(true)}
          branchCount={branches.length}
          scope={railScope({
            shown: lineage.length,
            total: commits.length,
            // the name belongs to the HEAD's path — never printed over another lane's bars
            ...(onHeadLineage && props.pathName !== undefined ? { pathName: props.pathName } : {}),
            pathCount: branches.length,
            offLane: !onHeadLineage,
          })}
        />
      ) : (
        <PresentBody head={head} bookmarks={bookmarks} commits={commits} cursor={cursor} onSeek={onSeek} onPlay={props.onPlay} />
      )}

      <BookmarkModal
        open={bookmarkModalOpen}
        commitId={cursor}
        commitLabel={cursorCommit?.label}
        defaultName={defaultBookmarkName}
        onSave={(label) => onNameBookmark?.(label)}
        onClose={() => setBookmarkModalOpen(false)}
      />
    </div>
  );
}

// ── explore body ────────────────────────────────────────────────────────────────
interface ExploreBodyProps {
  lineage: CommitView[];
  active: Set<string>;
  cursor: string | null;
  /**
   * The tip of the ACTIVE lineage — its bar is marked, so "now" is findable at
   * a glance whenever the rail is drawing that lineage. When the cursor has
   * walked onto another lane, the head is not among these bars and no bar
   * carries the mark: the rail's `scope` sentence says so in words.
   */
  head: string | null;
  bookmarkByCommit: Map<string, string>;
  backDisabled: boolean;
  forwardDisabled: boolean;
  onSeek?: (id: string) => void;
  onStepBack?: () => void;
  onStepForward?: () => void;
  viewingPast: boolean;
  onReturnToNow?: () => void;
  openBookmarkModal: () => void;
  branchCount: number;
  /** What the rail is showing, in words (see `railScope`); null = it shows the whole story. */
  scope: string | null;
}
function ExploreBody(p: ExploreBodyProps): JSX.Element {
  const { rail, tick, dense } = useRailTicks(p.lineage.length);
  // where the cursor stands on this lineage; everything after it is the FUTURE
  // one is looking back from (−1 = the cursor is on another lane, so nothing
  // on this one is "ahead" of it)
  const cursorAt = p.lineage.findIndex((c) => c.id === p.cursor);
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
            p.lineage.map((c, i) => (
              <button
                key={c.id}
                className={`vzf-tl-dot${c.id === p.cursor ? ' vzf-cursor' : ''}${c.id === p.head ? ' vzf-head' : ''}${cursorAt >= 0 && i > cursorAt ? ' vzf-ahead' : ''}`}
                data-actor={c.actor}
                data-commit={c.id}
                title={`#${c.id} ${c.label} (${c.actor})${c.intent ? ': ' + c.intent : ''}`}
                aria-label={`#${c.id} ${c.label}`}
                onClick={() => p.onSeek?.(c.id)}
              >
                {p.bookmarkByCommit.has(c.id) ? <span className="vzf-tl-flag">⚑</span> : <span className="vzf-tl-flagslot" aria-hidden="true" />}
                <span className="vzf-tl-node" />
                {!dense && <span className="vzf-tl-cid">#{c.id}</span>}
              </button>
            ))
          )}
        </div>
        {p.scope !== null && (
          <span
            className="vzf-tl-scope"
            data-vzf="rail-scope"
            title="The rail draws the path you are standing on. The other steps are on other paths — open Paths to see them all."
          >
            {p.scope}
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
          {p.branchCount} branch{p.branchCount === 1 ? '' : 'es'} · cursor {p.cursor ? '#' + p.cursor : '—'}
        </span>
      </div>
    </>
  );
}

// ── present body (bookmark-only, read-only) ────────────────────────────────────
interface PresentBodyProps {
  bookmarks: readonly BookmarkView[];
  commits: readonly CommitView[];
  cursor: string | null;
  /** The tip of the presented lineage (the head); bookmarks ahead of the cursor on it are what "next" walks to. */
  head: string | null;
  onSeek?: (id: string) => void;
  onPlay?: () => void;
}
function PresentBody(p: PresentBodyProps): JSX.Element {
  // The presented lineage is the one that ends at the HEAD (bookmarks ahead of the
  // cursor are what "next bookmark" walks to); the cursor's position is found on it.
  const tip = p.head ?? p.cursor;
  const ordered = orderedBookmarks(p.bookmarks, p.commits, tip);
  const idx = currentBookmarkIndex(p.bookmarks, p.commits, p.cursor, tip);
  const { rail, tick, dense } = useRailTicks(ordered.length);
  if (ordered.length === 0) {
    return <div className="vzf-present-empty">No bookmarks on this lineage yet — name one in Explore mode to build the guided tour.</div>;
  }
  const clamped = idx < 0 ? 0 : idx;
  const bookmark = ordered[clamped]!;
  // `ordered` holds only bookmarks whose commit is on the presented lineage, and
  // the callers (prev/next buttons disabled at the ends, dots mapped over
  // `ordered`) never ask for an index outside it — so a bookmark here always
  // names a commit.
  const go = (to: number): void => {
    p.onSeek?.(bookmarkTarget(ordered[to]!) as string);
  };
  return (
    <div data-vzf="present">
      <div className="vzf-timeline-row">
        <div className="vzf-step-group" role="group" aria-label="bookmarks">
          <button className="vzf-btn" data-bookmark="prev" disabled={clamped <= 0} onClick={() => go(clamped - 1)} aria-label="previous bookmark">
            ⟵
          </button>
          <button className="vzf-btn" data-bookmark="next" disabled={clamped >= ordered.length - 1} onClick={() => go(clamped + 1)} aria-label="next bookmark">
            ⟶
          </button>
        </div>
        <div className="vzf-present-bookmark">
          <div className="vzf-bookmark-title">{bookmark.label}</div>
          <div className="vzf-bookmark-meta">
            bookmark {clamped + 1} of {ordered.length}
            {idx < 0 ? ' · (nearest to cursor)' : ''} · #{bookmark.commitId}
          </div>
        </div>
        <div className="vzf-timeline vzf-bookmark-rail" data-vzf="bookmark-rail" ref={rail} data-dense={dense ? 'true' : undefined} style={{ '--vzf-tick': `${tick}px` } as CSSProperties}>
          {ordered.map((c, i) => (
            <button key={c.commitId} className={`vzf-tl-dot${i === clamped ? ' vzf-cursor' : ''}`} data-bookmark-dot={c.commitId} title={c.label} aria-label={c.label} onClick={() => go(i)}>
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
