/**
 * Pure logic for PRESENT mode — bookmark-only traversal. Present mode ignores
 * ordinary commits: it walks the NAMED bookmarks along ONE lineage. The
 * "current bookmark" is the bookmark sitting on (or, failing an exact match,
 * the most recent one reached along) the cursor's ancestry.
 *
 * ── Bookmarks are ordered by LINEAGE, never by arrival ──────────────────────
 * A bookmark names a position (`at`). Two bookmarks named on two different
 * branches are not "earlier" and "later" — they are elsewhere. Ordering every
 * bookmark by the time it was named (the old behaviour) spliced bookmarks from
 * abandoned branches into a story the cursor never walked. So, given the
 * commits and the TIP of the lineage being presented (normally the head), the
 * ordered bookmarks are exactly the ones whose NAMED position lies on the
 * tip's path to the root, in root→tip order — which keeps a bookmark named at
 * a commit on every lineage that runs through that commit (a fork below it
 * does not lose it), and includes bookmarks AHEAD of the cursor (that is what
 * "next bookmark" walks to). Seeking a bookmark goes to the named position.
 * Without commits or a tip, arrival order is the honest fallback; a bookmark
 * with no `at` (an older wire) names itself.
 */
import type { BookmarkView, CommitView } from '../adapter/types.js';
import { pathToRoot } from '../adapter/stepNav.js';

/**
 * Bookmarks that point at a real commit, ordered along the lineage that ends
 * at `tip` (root first). Falls back to arrival order when no commits/tip are given.
 */
/** The position a bookmark names — its parent when known, else the bookmark commit itself (older wires). */
export function bookmarkTarget(c: BookmarkView): string | null {
  return c.at !== undefined && c.at !== null ? c.at : c.commitId;
}

export function orderedBookmarks(
  bookmarks: readonly BookmarkView[],
  commits?: readonly CommitView[],
  tip?: string | null,
): BookmarkView[] {
  const named = bookmarks.filter((c) => bookmarkTarget(c) != null);
  if (commits === undefined || !tip) return named.slice().sort((a, b) => a.ts - b.ts);
  // root→tip position of every commit on the lineage (pathToRoot is root-first)
  const position = new Map<string, number>();
  pathToRoot(commits, tip).forEach((r, i) => position.set(r.id, i));
  const pos = (c: BookmarkView): number => position.get(bookmarkTarget(c) as string) as number;
  return named
    .filter((c) => position.has(bookmarkTarget(c) as string))
    // same named position ⇒ the earlier bookmark first
    .sort((a, b) => pos(a) - pos(b) || a.ts - b.ts);
}

/**
 * The index (into {@link orderedBookmarks} for the same `tip`) of the bookmark
 * the cursor is at, or the most recent bookmark on the cursor's ancestry; `-1`
 * when no bookmark is reached (including a null cursor — nothing is "reached"
 * from nowhere). `tip` defaults to the cursor, i.e. the lineage that ends
 * where the cursor stands.
 */
export function currentBookmarkIndex(
  bookmarks: readonly BookmarkView[],
  commits: readonly CommitView[],
  cursor: string | null,
  tip: string | null = cursor,
): number {
  if (!cursor) return -1;
  const ordered = orderedBookmarks(bookmarks, commits, tip);
  if (ordered.length === 0) return -1;
  // standing ON the named position, or on the bookmark commit itself, is "at this bookmark"
  const exact = ordered.findIndex((c) => bookmarkTarget(c) === cursor || c.commitId === cursor);
  if (exact >= 0) return exact;
  const ancestors = new Set(pathToRoot(commits, cursor).map((r) => r.id));
  let best = -1;
  ordered.forEach((c, i) => {
    if (ancestors.has(bookmarkTarget(c) as string)) best = i; // ordered root→tip, so the last hit is the nearest ancestor
  });
  return best;
}
