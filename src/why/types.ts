/**
 * L6 — why (`vizfootprint/why`) · shared types.
 *
 * `why(target)` answers "why is this value what it is?" as a MACHINE-SHAPED
 * cross-tier dependency set (ids + tier/role tags, never prose — the
 * hcifootprint lesson: a triage surface consumes structure, not a paragraph).
 * It is NOT a new algorithm — it is a JOIN over slicers that already exist,
 * promoted from `spikes/x3-why-join/whyJoin.ts`:
 *   - viz    : the cause-tagged commit(s), addressed by the FIRST-CLASS
 *              `CommitRecord.correlationId` field (D20 — the commit `id` is
 *              identity-only, never overloaded as the join key);
 *   - agent  : the tool-call frame, addressed by `correlationId` in the
 *              SANCTIONED `EventMeta.correlationId` position (C4). The resolver
 *              consumes a typed RECORD SHAPE ({@link AgentEventFrame}), never
 *              the agentfootprint package — af stays a devDep;
 *   - kernel : footprintjs `sliceForKey` over the analysis flowchart's commit
 *              log — the R9 minimal dependency chain for the anchor key.
 *
 * Generalised off the spike's hard-coded `'rowCount'` (adjudication C2): a
 * {@link WhyTarget} names EITHER a materialised COLUMN or a SCALAR/hypothesis
 * (ledger) row, so `why(target)` is proven over TWO target kinds, not one key.
 */

import type { CommitRecord } from '../log/index.js';
import type { FdrStep } from '../fdr/index.js';

// Re-exported so downstream types resolve without a footprintjs import here.
import type { RuntimeSnapshot } from 'footprintjs';

/** The three provenance tiers a value can depend on. */
export type Tier = 'viz' | 'agent' | 'kernel';

/** The ROLE a commit plays in a target's provenance (machine tag, never prose). */
export type TierCommitKind =
  | 'declaring' // the viz commit that declared/produced the target
  | 'input-selection' // a viz select/filter that formed the analysis input
  | 'kernel-stage' // a footprintjs stage the target's value flows through
  | 'agent-frame'; // the agent tool-call that dispatched the run

/** One commit in the composed cross-tier set. Pure ids + tier/role tags. */
export interface TierCommit {
  readonly tier: Tier;
  /** The tier-native id (viz commit id / agent toolCallId / kernel runtimeStageId). */
  readonly id: string;
  /** Stable, index-free stage id for kernel commits (assertable). Absent off-kernel. */
  readonly stageId?: string;
  /** The role this commit plays. */
  readonly kind: TierCommitKind;
}

/**
 * The SANCTIONED agent-tier record shape (C4) — the subset of agentfootprint's
 * `EventMeta` a caller-supplied event log carries. The resolver reads
 * `correlationId` here (the EventMeta field), NEVER a tool-args echo. Its
 * unique address is `(runId, runtimeStageId)` OR `toolCallId` — `runtimeStageId`
 * alone COLLIDES across independent agent runs (each fresh executor over the
 * same chart reuses execution indices, e.g. `tool-calls#22`; verified in the
 * x3 acceptance + `sanctioned-path.test.ts`).
 */
export interface AgentEventFrame {
  /** Unambiguous per-call id (the join anchor on the agent side). */
  readonly toolCallId: string;
  /** The run this frame belongs to — disambiguates the colliding `runtimeStageId`. */
  readonly runId: string;
  /** footprintjs runtimeStageId of the tool-call stage. Collides across runs (see above). */
  readonly runtimeStageId: string;
  /**
   * The cross-tier join key, from `EventMeta.correlationId` (agentfootprint
   * ≥ 9524460). ABSENT when the installed runtime doesn't populate it — the
   * caller's harvester passes it through verbatim, never fabricates it.
   */
  readonly correlationId?: string;
}

/**
 * The wire join record — one correlationId's cross-tier addresses (adjudication
 * C1: promoted from the spike's `JoinRecord`). Every field is OPTIONAL because a
 * real session may thread only some tiers; an unthreaded tier is an honest
 * {@link CrossTierMiss}, never a fabricated address.
 */
export interface CorrelationEnvelope {
  readonly correlationId: string;
  readonly viz?: { readonly commitId: string };
  readonly agent?: AgentEventFrame;
  readonly kernel?: { readonly snapshot: RuntimeSnapshot; readonly key: string };
}

/** The two proven target kinds (C2). `column` = a materialised column; `hypothesis` = a scalar/ledger row. */
export type WhyTarget =
  | { readonly kind: 'column'; readonly column: string }
  | { readonly kind: 'hypothesis'; readonly analysisId: string };

/** Documented registry gaps the answer surfaces honestly (never faked). */
export interface WhyFlags {
  /**
   * `snapshot.runId` availability (footprintjs fba2886, shipped 9.11.0 —
   * C4 CLOSED). `true` on any snapshot from an installed fp ≥9.11.0.
   * `false` only for a snapshot from an older/duck-typed kernel predating the
   * field — kernel commits then fall back to `runtimeStageId` ONLY, scoped to
   * this snapshot; a runId qualifier is needed to disambiguate the same stage
   * across independent kernel runs (their `runtimeStageId` strings collide by
   * design — execution indices reset per run).
   */
  readonly kernelRunIdAvailable: boolean;
}

/** Per-tier honest miss — an unthreaded/unresolvable tier, typed, never dropped. */
export interface CrossTierMiss {
  readonly tier: Tier;
  readonly missing:
    | 'no-viz-commit' // no commit carries the join key / declaring id
    | 'no-join-key' // no correlationId supplied to thread the agent tier
    | 'no-agent-tier' // no agent event log supplied
    | 'no-agent-frame' // event log supplied but no frame matches the key
    | 'no-kernel-snapshot' // no footprintjs run recorded for the target
    | 'kernel-key-unresolved'; // the anchor key produced no slice
}

/**
 * The composed answer — the MINIMAL commit set the target depends on, as flat
 * `{tier, id, kind}` records plus per-tier honest misses. No prose fields (A2).
 */
export interface CrossTierSlice {
  readonly ok: true;
  readonly targetKind: WhyTarget['kind'];
  /** The anchor key the kernel slice roots at (column name / resolved scalar key). */
  readonly key: string;
  /** The join key, when the target was threaded across tiers. */
  readonly correlationId?: string;
  /** Did the join key actually MATCH an agent frame (the cross-tier join landed)? */
  readonly threaded: boolean;
  /** The viz commit that declared the target (resolved by its correlationId FIELD when threaded). */
  readonly viz: { readonly commitId: string };
  /** The agent tool-call frame, or `null` when the agent tier is an honest miss. */
  readonly agent: { readonly toolCallId: string; readonly runtimeStageId: string; readonly runId: string } | null;
  /** The R9 kernel minimal set, or `null` when the kernel tier is an honest miss. */
  readonly kernel: {
    readonly writerId: string;
    readonly commitIds: readonly string[];
    readonly stageIds: readonly string[];
    /** `snapshot.runId` — `null` only for a pre-9.11.0 snapshot (see {@link WhyFlags.kernelRunIdAvailable}). */
    readonly runId: string | null;
  } | null;
  /** The flat, tier-tagged union of every commit in the composed set. */
  readonly commits: readonly TierCommit[];
  /** Every tier that could not be threaded, typed (A4). */
  readonly misses: readonly CrossTierMiss[];
  readonly flags: WhyFlags;
  /** kind:'hypothesis' only — the online-FDR ledger row for the test (machine context). */
  readonly fdr?: { readonly step: number; readonly reject: boolean };
}

/** The target itself could not be located in the session (unknown column / analysis). */
export interface WhyTargetMiss {
  readonly ok: false;
  readonly missing: 'no-such-target';
  readonly target: WhyTarget;
}

export type WhyResult = CrossTierSlice | WhyTargetMiss;

/**
 * The resolved provenance a caller (the session) hands `why()` — every input the
 * three tier-resolvers need, gathered DURING the run (never post-processed).
 */
export interface WhySources {
  /** The full viz commit log — for correlationId-FIELD resolution + commit validation. */
  readonly vizRecords: readonly CommitRecord[];
  /** The viz commit that declared the target (the analysis's landed commit / kernel's originating brush). */
  readonly declaringCommitId: string;
  /** Viz select/filter commits that formed the analysis input (empty for a full-table transform). */
  readonly inputSelectionCommitIds: readonly string[];
  /** The footprintjs run that computed the target (the kernel tier). Absent → `no-kernel-snapshot`. */
  readonly kernelSnapshot?: RuntimeSnapshot;
  /** The kernel state key the target's value lives under. Absent → `kernel-key-unresolved`. */
  readonly kernelKey?: string;
  /** The cross-tier join key. Absent → the agent tier can't be threaded. */
  readonly correlationId?: string;
  /** Caller-supplied agent event frames (sanctioned EventMeta shape). Absent → `no-agent-tier`. */
  readonly agentEventLog?: readonly AgentEventFrame[];
  /** kind:'hypothesis' — the target's online-FDR ledger row (machine context, not a commit). */
  readonly fdrStep?: FdrStep;
}

export type { RuntimeSnapshot };
