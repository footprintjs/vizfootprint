/**
 * x3 — `whyRowCount()`: the cross-tier `why(x)` composition (R10 / H2).
 *
 * This is NOT a new algorithm. It is a JOIN over slicers that already exist:
 *   - kernel: footprintjs `sliceForKey(commitLog,'rowCount', reads)` → the
 *     MINIMAL kernel commit set rowCount causally depends on (R9);
 *   - agent:  the tool-call frame recorded in the join table (its runtimeStageId
 *     is the agentfootprint slicer's address for that step);
 *   - viz:    the cause-tagged commit, addressed by its FIRST-CLASS
 *     `CommitRecord.correlationId` field (D20/P3 — the log is scanned for
 *     that field; the commit `id` is identity-only, never the join key).
 * The correlationId is the join key that stitches them. If it cannot be
 * recovered from the kernel's COMMITTED state, the whole thesis is invalidated
 * for that run — reported honestly as `threaded: false`, never faked.
 *
 * The return is deliberately MACHINE-SHAPED (ids + tier tags), not prose — the
 * hcifootprint lesson: a triage surface consumes structure, not a paragraph.
 */

import { sliceForKey, keysReadFromExecutionTree, sliceToJSON } from 'footprintjs/trace';
import type { Chain } from './chain.js';

/** One commit in the composed cross-tier set. Pure id + tier tag. */
export interface TierCommit {
  readonly tier: 'viz' | 'agent' | 'kernel';
  /** The tier-native identifier (viz commit id / agent runtimeStageId / kernel runtimeStageId). */
  readonly id: string;
  /** Stable stage id for kernel commits (assertable, index-free). Absent off-kernel. */
  readonly stageId?: string;
}

/** The composed minimal set across all three tiers for one `rowCount` question. */
export interface CrossTierSlice {
  readonly correlationId: string;
  readonly key: 'rowCount';
  /** Did the join key actually thread into the kernel's committed state? */
  readonly threaded: boolean;
  /** Kernel slicer output. `writerId` = the anchor (last writer of rowCount). */
  readonly kernel: {
    readonly writerId: string;
    readonly commitIds: readonly string[]; // runtimeStageIds
    readonly stageIds: readonly string[]; // stable stage ids
  };
  /** Agent decision frame that dispatched the run. */
  readonly agent: { readonly toolCallId: string; readonly runtimeStageId: string; readonly runId: string };
  /** Viz commit that originated the interaction. */
  readonly viz: { readonly commitId: string };
  /** Flat, tier-tagged union of every commit in the composed set (A3 shape). */
  readonly commits: readonly TierCommit[];
}

/** Honest miss: no join row / no viz commit carries this correlationId. */
export interface CrossTierMiss {
  readonly correlationId: string;
  readonly key: 'rowCount';
  readonly missing: 'no-join-key' | 'no-viz-commit';
}

/**
 * "Why is rowCount what it is?" — traverse viz → agent → kernel via the
 * correlationId and return the composed minimal commit set.
 */
export function whyRowCount(correlationId: string, chain: Chain): CrossTierSlice | CrossTierMiss {
  const rec = chain.joinTable.get(correlationId);
  if (!rec) return { correlationId, key: 'rowCount', missing: 'no-join-key' };

  // Viz tier — resolve the commit by its first-class correlationId field
  // (D20/P3). Before the field existed, this lookup was `id === key` (an
  // overload). Honest miss if no commit carries the key.
  const vizRecord = chain.vizRecords.find((r) => r.correlationId === correlationId);
  if (!vizRecord) return { correlationId, key: 'rowCount', missing: 'no-viz-commit' };

  // Kernel slicer — the R9 minimal set for rowCount.
  const slice = sliceForKey(
    rec.kernel.snapshot.commitLog,
    'rowCount',
    keysReadFromExecutionTree(rec.kernel.snapshot.executionTree),
  );
  const json = sliceToJSON(slice);
  const nodes = json.nodes ?? {};
  const commitIds = Object.keys(nodes);
  const stageIds = commitIds.map((id) => nodes[id]!.stageId);

  // The join-key honesty gate: did correlationId survive into committed state?
  const threaded = rec.kernel.committedCorrelationId === correlationId;

  // Agent-tier id = toolCallId (unambiguous). NOTE: runtimeStageId COLLIDES
  // across independent agent runs (each is a fresh executor over the same
  // chart → same execution index, e.g. 'tool-calls#22'), so it is NOT a
  // globally-unique commit id — the unique address is (runId, runtimeStageId).
  const commits: TierCommit[] = [
    // viz commit id comes from the FIELD-resolved record (never from an
    // id===key assumption; `rec.viz.commitId` recorded at commit time must
    // agree — both point at the same commit).
    { tier: 'viz', id: vizRecord.id },
    { tier: 'agent', id: rec.agent.toolCallId },
    ...commitIds.map((id) => ({ tier: 'kernel' as const, id, stageId: nodes[id]!.stageId })),
  ];

  return {
    correlationId,
    key: 'rowCount',
    threaded,
    kernel: { writerId: json.writerId ?? '', commitIds, stageIds },
    agent: { toolCallId: rec.agent.toolCallId, runtimeStageId: rec.agent.runtimeStageId, runId: rec.agent.runId },
    viz: { commitId: vizRecord.id },
    commits,
  };
}
