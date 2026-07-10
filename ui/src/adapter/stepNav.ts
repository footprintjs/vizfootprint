/**
 * Pure tree-navigation over the branching commit DAG — no DOM, no fetch, fully
 * unit-testable. Adapted from `demo-agent/src/stepNav.ts` (the orchestrator's
 * fork-safe replacement for a linear drag-slider) and extended with the
 * branch-map lane layout the git-graph needs. History is a TREE: acting from a
 * past cursor branches, so back/forward get an explicit rule, not slider math.
 *
 *   BACK    = the cursor's parent (null at the root / with no cursor).
 *   FORWARD = the next commit along the cursor's lane — the child on the ACTIVE
 *             branch path if the cursor is on it, else the earliest-created
 *             child (the lineage's own original continuation). null at a leaf.
 */

/** The minimal shape tree-walking needs from a commit record. */
export interface StepNode {
  readonly id: string;
  readonly parent: string | null;
}

/**
 * The root→`id` ancestor chain (a branch path), cycle-guarded. `records` must be
 * in append order (a parent precedes its children — true of every log here).
 */
export function pathToRoot<T extends StepNode>(records: readonly T[], id: string | null): T[] {
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

/** The set of ids on the active (root→head) path. */
export function activePath<T extends StepNode>(records: readonly T[], head: string | null): Set<string> {
  return new Set(pathToRoot(records, head).map((r) => r.id));
}

/** Step back: the cursor's parent, or null at the root (or with no cursor). */
export function stepBackTarget<T extends StepNode>(records: readonly T[], cursor: string | null): string | null {
  if (!cursor) return null;
  return records.find((r) => r.id === cursor)?.parent ?? null;
}

/**
 * Step forward: see the file header. `records` must be in append order so the
 * off-active-path fallback (`children[0]`) is the earliest-created child.
 */
export function stepForwardTarget<T extends StepNode>(
  records: readonly T[],
  cursor: string | null,
  head: string | null,
): string | null {
  if (!cursor) return null;
  const children = records.filter((r) => r.parent === cursor);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!.id;
  const active = activePath(records, head);
  const onActive = children.find((c) => active.has(c.id));
  return (onActive ?? children[0]!).id;
}

// ── branch-map lane layout (the git-graph geometry, pure) ──────────────────────

export interface LaidOutNode<T extends StepNode> {
  readonly node: T;
  readonly depth: number;
  readonly lane: number;
}
export interface LaidOutEdge {
  readonly from: string;
  readonly to: string;
}
export interface BranchLayout<T extends StepNode> {
  readonly nodes: readonly LaidOutNode<T>[];
  readonly edges: readonly LaidOutEdge[];
  readonly maxDepth: number;
  readonly maxLane: number;
}

/**
 * Assign each commit a (depth, lane): depth = distance from root; lane = a row,
 * with the ACTIVE lineage on lane 0 (top) and each divergent leaf claiming the
 * next free lane along its unclaimed ancestry. Deterministic and append-order
 * stable — the same geometry the demo's branch map draws, extracted to be pure.
 */
export function layoutBranches<T extends StepNode>(records: readonly T[], head: string | null): BranchLayout<T> {
  const byId = new Map(records.map((r) => [r.id, r]));
  const childCount = new Map<string, number>();
  for (const r of records) if (r.parent) childCount.set(r.parent, (childCount.get(r.parent) ?? 0) + 1);
  const active = activePath(records, head);
  // leaves: the active tip first (top lane), then by arrival order
  const leaves = records
    .filter((r) => !childCount.get(r.id))
    .sort((a, b) => (active.has(b.id) ? 1 : 0) - (active.has(a.id) ? 1 : 0) || records.indexOf(a) - records.indexOf(b));
  const lane = new Map<string, number>();
  let nextLane = 0;
  for (const leaf of leaves) {
    let laneForThis: number | null = null;
    for (const r of pathToRoot(records, leaf.id)) {
      if (lane.has(r.id)) continue;
      if (laneForThis === null) laneForThis = nextLane++;
      lane.set(r.id, laneForThis);
    }
  }
  const depthOf = (id: string): number => pathToRoot(records, id).length - 1;
  const nodes: LaidOutNode<T>[] = records.map((node) => ({ node, depth: depthOf(node.id), lane: lane.get(node.id) ?? 0 }));
  const edges: LaidOutEdge[] = [];
  for (const r of records) if (r.parent && byId.has(r.parent)) edges.push({ from: r.parent, to: r.id });
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  const maxLane = Math.max(0, ...lane.values());
  return { nodes, edges, maxDepth, maxLane };
}
