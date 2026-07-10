/**
 * Pure logic for PRESENT mode — checkpoint-only traversal. Present mode ignores
 * ordinary commits: it walks the NAMED checkpoints (story beats) in time order.
 * The "current beat" is the checkpoint sitting on (or, failing an exact match,
 * the most recent one reached along) the cursor's lineage.
 */
import type { CheckpointView, CommitView } from '../adapter/types.js';
import { pathToRoot } from '../adapter/stepNav.js';

/** Checkpoints that point at a real commit, ordered by arrival time. */
export function orderedCheckpoints(checkpoints: readonly CheckpointView[]): CheckpointView[] {
  return checkpoints.filter((c) => c.commitId != null).slice().sort((a, b) => a.ts - b.ts);
}

/**
 * The index (into {@link orderedCheckpoints}) of the beat the cursor is at, or
 * the most recent beat on the cursor's ancestry; `-1` when no beat is reached.
 */
export function currentBeatIndex(checkpoints: readonly CheckpointView[], commits: readonly CommitView[], cursor: string | null): number {
  const ordered = orderedCheckpoints(checkpoints);
  if (ordered.length === 0) return -1;
  const exact = ordered.findIndex((c) => c.commitId === cursor);
  if (exact >= 0) return exact;
  if (!cursor) return -1;
  const ancestors = new Set(pathToRoot(commits, cursor).map((r) => r.id));
  let best = -1;
  let bestTs = -Infinity;
  ordered.forEach((c, i) => {
    if (c.commitId && ancestors.has(c.commitId) && c.ts > bestTs) {
      best = i;
      bestTs = c.ts;
    }
  });
  return best;
}
