/**
 * Pure logic for PRESENT mode — checkpoint-only traversal. Present mode ignores
 * ordinary commits: it walks the NAMED checkpoints (story beats) along ONE
 * lineage. The "current beat" is the checkpoint sitting on (or, failing an
 * exact match, the most recent one reached along) the cursor's ancestry.
 *
 * ── Beats are ordered by LINEAGE, never by arrival ──────────────────────────
 * A checkpoint names a commit. Two beats named on two different branches are
 * not "earlier" and "later" — they are elsewhere. Ordering every beat by the
 * time it was named (the old behaviour) spliced beats from abandoned branches
 * into a story the cursor never walked. So, given the commits and the TIP of
 * the lineage being presented (normally the head), the ordered beats are
 * exactly the checkpoints whose commit lies on the tip's path to the root, in
 * root→tip order — which includes beats AHEAD of the cursor on that lineage
 * (that is what "next beat" walks to). Without commits or a tip, arrival order
 * is the only order available and is used as the honest fallback.
 */
import type { CheckpointView, CommitView } from '../adapter/types.js';
import { pathToRoot } from '../adapter/stepNav.js';

/**
 * Checkpoints that point at a real commit, ordered along the lineage that ends
 * at `tip` (root first). Falls back to arrival order when no commits/tip are given.
 */
export function orderedCheckpoints(
  checkpoints: readonly CheckpointView[],
  commits?: readonly CommitView[],
  tip?: string | null,
): CheckpointView[] {
  const named = checkpoints.filter((c) => c.commitId != null);
  if (commits === undefined || !tip) return named.slice().sort((a, b) => a.ts - b.ts);
  // root→tip position of every commit on the lineage (pathToRoot is root-first)
  const position = new Map<string, number>();
  pathToRoot(commits, tip).forEach((r, i) => position.set(r.id, i));
  return named
    .filter((c) => position.has(c.commitId as string))
    .sort((a, b) => (position.get(a.commitId as string) as number) - (position.get(b.commitId as string) as number));
}

/**
 * The index (into {@link orderedCheckpoints} for the same `tip`) of the beat
 * the cursor is at, or the most recent beat on the cursor's ancestry; `-1`
 * when no beat is reached (including a null cursor — nothing is "reached"
 * from nowhere). `tip` defaults to the cursor, i.e. the lineage that ends
 * where the cursor stands.
 */
export function currentBeatIndex(
  checkpoints: readonly CheckpointView[],
  commits: readonly CommitView[],
  cursor: string | null,
  tip: string | null = cursor,
): number {
  if (!cursor) return -1;
  const ordered = orderedCheckpoints(checkpoints, commits, tip);
  if (ordered.length === 0) return -1;
  const exact = ordered.findIndex((c) => c.commitId === cursor);
  if (exact >= 0) return exact;
  const ancestors = new Set(pathToRoot(commits, cursor).map((r) => r.id));
  let best = -1;
  ordered.forEach((c, i) => {
    if (ancestors.has(c.commitId as string)) best = i; // ordered root→tip, so the last hit is the nearest ancestor
  });
  return best;
}
