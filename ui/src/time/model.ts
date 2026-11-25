/**
 * THE TIME-TRAVEL MODEL — everything the time-travel bar shows, derived once.
 *
 * Data logic only: no React, no styling, no words. `timeTravelModel` reads the
 * commits, the cursor, the head and the bookmarks, and answers every question
 * the bar asks: which bars are on the rail, which one is the cursor, where a
 * step lands, which bookmark is current. A component draws the answer and
 * derives nothing. A consumer who wants a different bar keeps this file and
 * replaces the component.
 *
 * The step rules and the bookmark rules are not restated here. They live in
 * `adapter/stepNav.ts` and `presentBookmark.ts`; this file composes them.
 */
import type { Actor, BookmarkView, CommitView } from '../adapter/types.js';
import { pathToRoot, stepBackTarget, stepForwardTarget } from '../adapter/stepNav.js';
import { bookmarkTarget, currentBookmarkIndex, orderedBookmarks } from './presentBookmark.js';

/** What the model is derived from. All of it is on `SessionViewState`. */
export interface TimeTravelInput {
  readonly commits: readonly CommitView[];
  readonly cursor: string | null;
  readonly head: string | null;
  readonly bookmarks?: readonly BookmarkView[];
  /** How many named paths the story has. */
  readonly pathCount?: number;
  /** The name of the HEAD's path, when the host knows it. Never shown over another lane's bars. */
  readonly pathName?: string;
}

/** One commit on the rail. */
export interface RailBar {
  readonly id: string;
  readonly label: string;
  readonly actor: Actor;
  readonly intent?: string;
  /** The cursor stands here. */
  readonly cursor: boolean;
  /** This is the tip of the head's lineage: "now". */
  readonly head: boolean;
  /** After the cursor on this lineage: the future one is looking back from. */
  readonly ahead: boolean;
  /** A bookmark's commit. */
  readonly bookmarked: boolean;
}

/** What the rail is showing — the inputs of the sentence beside the bars (`railScope`). */
export interface RailCoverage {
  /** Bars on the rail: the lineage it drew. */
  readonly shown: number;
  /** Steps in the whole story, every path counted. */
  readonly total: number;
  readonly pathCount: number;
  /** Present only when it names THESE bars. */
  readonly pathName?: string;
  /** The rail is drawing a lane the head is not on: "now" is elsewhere. */
  readonly offLane: boolean;
  /**
   * The cursor names a commit that is not in the log the model was given, so
   * no bar can carry it. The rail then draws the head's lineage and says so.
   */
  readonly cursorMissing: boolean;
}

/** Explore mode: every commit of one lineage. */
export interface ExploreModel {
  /** The lineage the CURSOR stands on, root first. The head's lineage when the cursor is on it or there is no cursor. */
  readonly bars: readonly RailBar[];
  /** Where a step back lands, or null when there is nowhere to go. */
  readonly back: string | null;
  /** Where a step forward lands, or null. */
  readonly forward: string | null;
  readonly coverage: RailCoverage;
}

/** One bookmark in present mode. */
export interface PresentStop {
  /** The commit a seek to this bookmark lands on (`bookmarkTarget`). */
  readonly target: string;
  /** The bookmark's own commit: a stable key, and what the bar prints. */
  readonly commitId: string | null;
  readonly label: string;
  readonly current: boolean;
}

/** Present mode: the bookmarks of the presented lineage, in story order. */
export interface PresentModel {
  readonly stops: readonly PresentStop[];
  /** The current stop's index, or -1 when there are no stops. */
  readonly index: number;
  /**
   * False when the cursor stands on no bookmark and has none behind it (or
   * there is no cursor). The FIRST stop is then the current one — it is not
   * computed to be the nearest — and the bar marks the reading as not exact.
   */
  readonly exact: boolean;
  readonly previous: string | null;
  readonly next: string | null;
}

export interface TimeTravelModel {
  readonly cursor: string | null;
  /** The cursor's commit label; absent when there is no cursor or the commit is not in the log the model was given. */
  readonly cursorLabel?: string;
  readonly explore: ExploreModel;
  readonly present: PresentModel;
  /** A name to offer for the next bookmark. */
  readonly suggestedBookmarkName: string;
}

function exploreModel(input: TimeTravelInput, bookmarks: readonly BookmarkView[]): ExploreModel {
  const { commits, cursor, head } = input;
  const headLineage = pathToRoot(commits, head);
  // The rail draws the lineage the CURSOR stands on. Normally that is the head's;
  // when the cursor has travelled onto another lane, following it keeps the
  // cursor's bar on the rail, and `coverage.offLane` says "now" is elsewhere.
  // A cursor that names no commit in this log has no lineage to follow. The
  // rail used to draw NO bars for it and say "no commits yet" over a log that
  // had some; it draws the head's lineage now and `cursorMissing` says why no
  // bar is marked.
  // an empty id is no cursor, as the step rules and the bookmark rules already read it
  const cursorMissing = cursor !== null && cursor !== '' && !commits.some((c) => c.id === cursor);
  const onHeadLineage = cursor === null || cursor === '' || cursorMissing || headLineage.some((c) => c.id === cursor);
  const lineage = onHeadLineage ? headLineage : pathToRoot(commits, cursor);
  const cursorAt = lineage.findIndex((c) => c.id === cursor);
  const flagged = new Set(bookmarks.map((b) => b.commitId).filter((id): id is string => id !== null && id !== ''));
  return {
    bars: lineage.map((c, i) => ({
      id: c.id,
      label: c.label,
      actor: c.actor,
      ...(c.intent !== undefined && c.intent !== '' ? { intent: c.intent } : {}),
      cursor: c.id === cursor,
      head: c.id === head,
      // -1 = the cursor is on no bar of this lineage, so nothing here is ahead of it
      ahead: cursorAt >= 0 && i > cursorAt,
      bookmarked: flagged.has(c.id),
    })),
    back: stepBackTarget(commits, cursor),
    forward: stepForwardTarget(commits, cursor, head),
    coverage: {
      shown: lineage.length,
      total: commits.length,
      pathCount: input.pathCount ?? 0,
      ...(onHeadLineage && input.pathName !== undefined ? { pathName: input.pathName } : {}),
      offLane: !onHeadLineage,
      cursorMissing,
    },
  };
}

function presentModel(input: TimeTravelInput, bookmarks: readonly BookmarkView[]): PresentModel {
  const { commits, cursor, head } = input;
  // the presented lineage ends at the HEAD: bookmarks ahead of the cursor are what "next" walks to
  const tip = head ?? cursor;
  const ordered = orderedBookmarks(bookmarks, commits, tip);
  if (ordered.length === 0) return { stops: [], index: -1, exact: false, previous: null, next: null };
  const found = currentBookmarkIndex(bookmarks, commits, cursor, tip);
  const index = found < 0 ? 0 : found;
  // `orderedBookmarks` keeps only bookmarks that name a commit, so a target is always a string here
  const stops = ordered.map((b, i) => ({ target: bookmarkTarget(b) as string, commitId: b.commitId, label: b.label, current: i === index }));
  return {
    stops,
    index,
    exact: found >= 0,
    previous: index > 0 ? stops[index - 1]!.target : null,
    next: index < stops.length - 1 ? stops[index + 1]!.target : null,
  };
}

/** Derive everything the time-travel bar shows. Pure: the same input gives an equal model. */
export function timeTravelModel(input: TimeTravelInput): TimeTravelModel {
  const bookmarks = input.bookmarks ?? [];
  const cursorLabel = input.commits.find((c) => c.id === input.cursor)?.label;
  return {
    cursor: input.cursor,
    ...(cursorLabel !== undefined ? { cursorLabel } : {}),
    explore: exploreModel(input, bookmarks),
    present: presentModel(input, bookmarks),
    suggestedBookmarkName: `bookmark-${bookmarks.length + 1}`,
  };
}
