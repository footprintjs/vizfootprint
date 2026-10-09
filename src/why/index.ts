/**
 * vizfootprint/why (L6) — the cross-tier `why(target)` join. Promoted from
 * `spikes/x3-why-join/` (retired into `src/why/*.test.ts` + fixtures).
 *
 * `why(target)` traverses viz → agent → kernel and returns the MINIMAL commit
 * set the target depends on as a machine-shaped answer (ids + tier/role tags,
 * never prose). It is a JOIN over slicers that already exist — footprintjs
 * `sliceForKey` (kernel), a caller-supplied `EventMeta`-shaped frame log
 * (agent), and the cause-tagged commit log (viz). Exact agent attribution
 * requires the target anchor's persisted native `(runId, toolCallId)` to
 * match exactly one runtime frame. `correlationId` only groups a turn or
 * gesture; missing or ambiguous native evidence is never guessed.
 */

export { why } from './why.js';
export { resolveVizTier, resolveAgentTier, resolveKernelTier, isMiss } from './resolvers.js';
export type { KernelResolution } from './resolvers.js';
export type {
  AgentEventFrame,
  ClauseTravel,
  CommitResponse,
  CorrelationEnvelope,
  CrossTierMiss,
  CrossTierSlice,
  DroppedRef,
  RelatedCommit,
  RelatedCommitKind,
  Tier,
  TierCommit,
  TierCommitKind,
  WhyFlags,
  WhyResult,
  WhySources,
  WhyTarget,
  WhyTargetMiss,
} from './types.js';
