/**
 * Pure step-navigation over the time-travel commit DAG — no DOM, no fetch,
 * unit-testable in isolation. Orchestrator ruling: history is a TREE (an
 * append-only commit log where acting from a past cursor branches — R8
 * branch-on-act, session.ts), so a linear drag-slider is fork-ambiguous. Back
 * and forward get an explicit rule instead of pixel/slider arithmetic:
 *
 *   BACK    = the cursor's parent commit. `null` at the root (or with no
 *             cursor yet) — the caller disables the button there.
 *
 *   FORWARD = the NEXT commit along the lane the cursor came from — among the
 *   cursor's children, prefer the child on the ACTIVE branch's path (root →
 *   head); if the cursor sits OFF the active path, follow the path toward the
 *   branch tip it belongs to (the EARLIEST-created child — the continuation
 *   this commit's own lineage had before anything else later forked a sibling
 *   off of it). `null` at a leaf (no children) — the caller disables the
 *   button there.
 *
 * `app.ts` wires these against the live `/api/state` shape; this file only
 * needs the two fields that matter for tree-walking.
 */

/** The minimal shape step-navigation needs from a commit record. */
export interface StepRec {
  readonly id: string;
  readonly parent: string | null;
}

/**
 * The root→`id` ancestor chain (a branch path), cycle-guarded. `records` must
 * be in append order (a parent's array index precedes its children's — true
 * of every commit log in this repo; see `CauseSelectionSession.commit`).
 */
export function pathToRoot<T extends StepRec>(records: readonly T[], id: string | null): T[] {
  if (!id) return [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const chain: T[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    chain.push(rec);
    cur = rec.parent;
  }
  return chain.reverse();
}

/** Step back: the cursor's parent, or `null` at the root (or with no cursor). */
export function stepBackTarget<T extends StepRec>(records: readonly T[], cursor: string | null): string | null {
  if (!cursor) return null;
  const rec = records.find((r) => r.id === cursor);
  return rec?.parent ?? null;
}

/**
 * Step forward: see the file-header rule. `records` must be in append order
 * (chronological) — `.filter()` over it preserves creation order, so the
 * off-active-path fallback (`children[0]`) is the earliest-created child.
 */
export function stepForwardTarget<T extends StepRec>(
  records: readonly T[],
  cursor: string | null,
  head: string | null,
): string | null {
  if (!cursor) return null;
  const children = records.filter((r) => r.parent === cursor);
  if (children.length === 0) return null; // a leaf — nothing forward
  if (children.length === 1) return children[0]!.id;
  const activePath = new Set(pathToRoot(records, head).map((r) => r.id));
  const onActive = children.find((c) => activePath.has(c.id));
  return (onActive ?? children[0]!).id;
}
