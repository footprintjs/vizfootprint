/**
 * The parent chain, read three ways — the substrate under `README.md`'s law 5.
 *
 * The commit log is not a line. It is a tree, and almost every honest question
 * a session asks of it is really a question about ONE lineage: what could this
 * position have seen, what is on this branch and not that one, how far apart
 * are two tips. Those are walks over parent pointers and set arithmetic over
 * the result — no session state, no cursor, no fold. So they live here, taking
 * the whole log as their first argument and the position as their second,
 * exactly the way `foldStateAt`, `planBringOver` and `foldDiff` already do.
 *
 * That argument order is the point rather than a convenience. Law 5's dangerous
 * shape is a read that SOUNDS cursor-scoped and is not; a function that cannot
 * reach a cursor of its own cannot make that mistake, and a caller has to name
 * the position it means in order to call one at all.
 *
 * **Before you change anything here**: these walks are cycle-guarded even
 * though an append-only log cannot form a cycle. That is deliberate — a fold
 * that loops is a hang, not an error, and a log restored from the wire is
 * parsed by `src/log` rather than trusted. Keep the guard.
 */
import type { CommitRecord } from '../log/index.js';

/**
 * The root→`cursorId` ancestor chain (the branch path). Walks parent pointers
 * up to the root and reverses. `null` (no commits yet, or a root-before-any-act
 * cursor) yields the empty path. Cycle-guarded defensively (the append-only log
 * cannot form one, but a fold must never loop).
 */
export function branchPathOf(records: readonly CommitRecord[], cursorId: string | null): CommitRecord[] {
  if (cursorId === null) return [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const chain: CommitRecord[] = [];
  const seen = new Set<string>();
  let cur: string | null = cursorId;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    chain.push(rec);
    cur = rec.parent;
  }
  chain.reverse();
  return chain;
}

/**
 * Every commit id this log holds that is NOT on the given branch. Handed to
 * `why()` for ONE purpose: so a citation it had to drop can be told apart —
 * a commit on another branch, or one nothing in this history holds. Not one
 * of these ids may enter the answer's commit set; it is the same courtesy
 * `proseWorld` pays at the describe door (README, law 5).
 */
export function commitsElsewhereThan(records: readonly CommitRecord[], path: readonly CommitRecord[]): string[] {
  const onPath = new Set(path.map((r) => r.id));
  return records.filter((r) => !onPath.has(r.id)).map((r) => r.id);
}

/**
 * The source path's steps SINCE the common ancestor, oldest→newest, plus that
 * ancestor. Both chains are root-anchored linear ancestries, so their shared
 * commits are a PREFIX of the source chain — the last shared one IS the LCA
 * (null when the two share no root, or when nothing has landed here yet).
 */
export function stepsSinceAncestor(
  records: readonly CommitRecord[],
  sourceTip: string,
  targetCursor: string | null,
): { ancestor: string | null; steps: CommitRecord[] } {
  const sourceChain = branchPathOf(records, sourceTip); // root→tip
  const onTarget = new Set(branchPathOf(records, targetCursor).map((r) => r.id));
  const firstNew = sourceChain.findIndex((r) => !onTarget.has(r.id));
  const ancestorIdx = firstNew === -1 ? sourceChain.length - 1 : firstNew - 1;
  return {
    /* v8 ignore next -- a session-authored log has exactly ONE root (only the first commit has parent null; every later one parents from a non-null cursor), so both chains always share it and `ancestorIdx` is never -1. The `null` mirrors compare()'s honest disjoint-roots case, which only a hand-carried multi-root log could produce. */
    ancestor: ancestorIdx >= 0 ? (sourceChain[ancestorIdx] as CommitRecord).id : null,
    steps: firstNew === -1 ? [] : sourceChain.slice(firstNew),
  };
}
