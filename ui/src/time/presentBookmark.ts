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
 *
 * ── One answer to "which commit does this bookmark name" ────────────────────
 * `bookmarkTarget` is that answer for a RECORD and `bookmarkRefTarget` for a
 * REF (the id a note's `@[bookmark]` link carries, or — for words written
 * before bookmarks had ids — its label). They are one function called two
 * ways on purpose: a consumer that has a ref and reads `.commitId` off the
 * record it found has quietly written a second, different resolver, and for a
 * legacy `bookmark:` commit the two land on different commits — `commitId` is
 * the act of naming, `at` is the moment named. The slideshow seeks one and a
 * note anchor the other, so a dashboard would seek two places for one
 * bookmark. That is why the ref lookup lives here rather than in the caller.
 */
import type { BookmarkView, CommitView } from '../adapter/types.js';
import { pathToRoot } from '../adapter/stepNav.js';

/** The position a bookmark names — `at` when the wire carried it, else the bookmark commit itself (older wires). */
export function bookmarkTarget(c: BookmarkView): string | null {
  return c.at !== undefined && c.at !== null ? c.at : c.commitId;
}

/**
 * The position named by the bookmark a REF points at — the one resolver every
 * bookmark anchor uses (a view's words, a dashboard summary, a note, an
 * agent's reply).
 *
 * A note's `@[bookmark]` link carries the bookmark's ID (`b1`, …), never its
 * name, so that renaming a bookmark leaves every note working; a label is
 * still accepted second, because words written before bookmark ids carry one.
 * `null` when nothing matches — a click that does nothing at all, rather than
 * a seek somewhere arbitrary.
 */
export function bookmarkRefTarget(bookmarks: readonly BookmarkView[], ref: string): string | null {
  const found = bookmarks.find((c) => c.id === ref) ?? bookmarks.find((c) => c.label === ref);
  return found === undefined ? null : bookmarkTarget(found);
}

/**
 * Bookmarks that point at a real commit, ordered along the lineage that ends
 * at `tip` (root first). Falls back to arrival order when no commits/tip are given.
 */
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
