/**
 * vizfootprint/why (L6) — the cross-tier `why(target)` join. Promoted from
 * `spikes/x3-why-join/` (retired into `src/why/*.test.ts` + fixtures).
 *
 * `why(target)` traverses viz → agent → kernel and returns the MINIMAL commit
 * set the target depends on as a machine-shaped answer (ids + tier/role tags,
 * never prose). It is a JOIN over slicers that already exist — footprintjs
 * `sliceForKey` (kernel), a caller-supplied `EventMeta`-shaped frame log
 * (agent), and the cause-tagged commit log's first-class `correlationId` field
 * (viz) — stitched by one correlationId.
 */

export { why } from './why.js';
export { resolveVizTier, resolveAgentTier, resolveKernelTier, isMiss } from './resolvers.js';
export type { KernelResolution } from './resolvers.js';
export type {
  AgentEventFrame,
  CorrelationEnvelope,
  CrossTierMiss,
  CrossTierSlice,
  Tier,
  TierCommit,
  TierCommitKind,
  WhyFlags,
  WhyResult,
  WhySources,
  WhyTarget,
  WhyTargetMiss,
} from './types.js';
