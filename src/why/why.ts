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
  DroppedRef,
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
  // A commit the target named that this answer may not report as provenance is
  // DROPPED — that law stands (see DroppedRef) — but it is no longer dropped
  // SILENTLY: it is named here, with the most it can honestly be told apart as.
  const dropped: DroppedRef[] = [];
  const elsewhere = new Set(sources.commitsElsewhere ?? []); // never admitted; read only to tell 'another branch' from 'not found'
  // a MINIMAL set, on BOTH lists: one row per viz commit, the first role it was
  // named in wins — a commit named twice is one commit, whether it was honoured
  // or dropped, so `seen` records the DECISION about an id, not just an entry.
  const seen = new Set<string>([viz.commitId]);
  const addViz = (id: string, kind: TierCommit['kind']): void => {
    if (seen.has(id)) return; // already decided under an earlier role — not a second loss
    seen.add(id);
    if (!sources.vizRecords.some((r) => r.id === id)) {
      // validated against the target's own branch so a stale id never enters — and said so
      dropped.push({ id, kind, reason: elsewhere.has(id) ? 'off-branch' : 'unverified' });
      return;
    }
    commits.push({ tier: 'viz', id, kind });
  };

  // Input-selection viz commits — the selects/filters that formed the analysis input.
  for (const selId of sources.inputSelectionCommitIds) addViz(selId, 'input-selection');

  // Prose: the commits the words themselves name — a proposal accepted, a basis
  // stated, a span's citation.
  for (const rel of sources.relatedCommits ?? []) addViz(rel.id, rel.kind);

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

  const key = sources.kernelKey ?? (target.kind === 'column' ? target.column : target.kind === 'hypothesis' ? target.analysisId : `${target.viewId}.${target.slot}`);
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
    ...(dropped.length > 0 ? { dropped } : {}),
    flags: { kernelRunIdAvailable: kernel?.runId != null },
    ...(sources.fdrStep ? { fdr: { step: sources.fdrStep.step, reject: sources.fdrStep.reject } } : {}),
  };
}
