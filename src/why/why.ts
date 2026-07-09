/**
 * L6 — the composed `why(target)`. A JOIN over the three tier-resolvers, NOT a
 * new algorithm (SPEC §8). Returns the MINIMAL commit set the target depends on
 * as flat `{tier, id, kind}` records + per-tier honest misses — machine-shaped,
 * never prose.
 *
 * Generalised off the spike's hard-coded `'rowCount'` (adjudication C2): the
 * same `why()` answers a materialised COLUMN (`kind:'column'`) and a
 * SCALAR/hypothesis ledger row (`kind:'hypothesis'`) — two proven target kinds.
 */

import { isMiss, resolveAgentTier, resolveKernelTier, resolveVizTier } from './resolvers.js';
import type {
  CrossTierMiss,
  CrossTierSlice,
  TierCommit,
  WhyResult,
  WhySources,
  WhyTarget,
} from './types.js';

/**
 * "Why is this value what it is?" — traverse viz → agent → kernel via the
 * threaded `correlationId` and return the composed minimal commit set.
 *
 * The VIZ tier is the anchor: if the declaring commit cannot be located, the
 * target itself is unlocatable → `WhyTargetMiss`. The agent + kernel tiers each
 * degrade to a typed {@link CrossTierMiss} when unthreaded (A4) — the answer is
 * still returned, honestly partial.
 */
export function why(target: WhyTarget, sources: WhySources): WhyResult {
  // ── viz (anchor) ────────────────────────────────────────────────────────────
  const viz = resolveVizTier(sources.correlationId, sources.declaringCommitId, sources.vizRecords);
  if (isMiss(viz)) return { ok: false, missing: 'no-such-target', target };

  const commits: TierCommit[] = [{ tier: 'viz', id: viz.commitId, kind: 'declaring' }];
  const misses: CrossTierMiss[] = [];

  // Input-selection viz commits — the selects/filters that formed the analysis
  // input. Validated against the log so a stale id never enters the set.
  for (const selId of sources.inputSelectionCommitIds) {
    if (sources.vizRecords.some((r) => r.id === selId)) {
      commits.push({ tier: 'viz', id: selId, kind: 'input-selection' });
    }
  }

  // ── agent ─────────────────────────────────────────────────────────────────────
  const agentRes = resolveAgentTier(sources.correlationId, sources.agentEventLog);
  let agent: CrossTierSlice['agent'] = null;
  if (isMiss(agentRes)) {
    misses.push(agentRes.miss);
  } else {
    agent = { toolCallId: agentRes.toolCallId, runtimeStageId: agentRes.runtimeStageId, runId: agentRes.runId };
    commits.push({ tier: 'agent', id: agentRes.toolCallId, kind: 'agent-frame' });
  }

  // ── kernel ────────────────────────────────────────────────────────────────────
  const kernelRes = resolveKernelTier(sources.kernelKey, sources.kernelSnapshot);
  let kernel: CrossTierSlice['kernel'] = null;
  if (isMiss(kernelRes)) {
    misses.push(kernelRes.miss);
  } else {
    kernel = {
      writerId: kernelRes.writerId,
      commitIds: kernelRes.commitIds,
      stageIds: kernelRes.stageIds,
      runId: kernelRes.runId,
    };
    kernelRes.commitIds.forEach((id, i) => {
      commits.push({ tier: 'kernel', id, stageId: kernelRes.stageIds[i]!, kind: 'kernel-stage' });
    });
  }

  const key = sources.kernelKey ?? (target.kind === 'column' ? target.column : target.analysisId);
  const threaded = sources.correlationId !== undefined && agent !== null;

  return {
    ok: true,
    targetKind: target.kind,
    key,
    ...(sources.correlationId !== undefined ? { correlationId: sources.correlationId } : {}),
    threaded,
    viz: { commitId: viz.commitId },
    agent,
    kernel,
    commits,
    misses,
    flags: { kernelRunIdAvailable: kernel?.runId != null },
    ...(sources.fdrStep ? { fdr: { step: sources.fdrStep.step, reject: sources.fdrStep.reject } } : {}),
  };
}
