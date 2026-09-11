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

import type { ProseSlot } from '../prose/types.js';
import type { CommitRecord } from '../log/index.js';
import type { FdrStep } from '../fdr/index.js';
// type-only: the response vocabulary is the LINK layer's (one owner), so a fifth
// response there widens this type instead of being cast into a lie here
import type { LINK_RESPONSES } from '../links/index.js';

// Re-exported so downstream types resolve without a footprintjs import here.
import type { RuntimeSnapshot } from 'footprintjs';

/** The three provenance tiers a value can depend on. */
export type Tier = 'viz' | 'agent' | 'kernel';

/**
 * The ROLE a commit plays in a target's provenance (machine tag, never prose),
 * documented in the order a reader walks them: the anchor, its inputs, the two
 * other tiers, then the roles each target kind adds.
 */
export type TierCommitKind =
  | 'declaring' // the viz commit that declared/produced the target
  | 'input-selection' // a viz select/filter that formed the analysis input — and, for a chart, the view's OWN live clause (it draws its own brush)
  | 'kernel-stage' // a footprintjs stage the target's value flows through
  | 'agent-frame' // the agent tool-call that dispatched the run
  | 'proposal' // prose: the proposing commit the words were accepted from
  | 'basis' // prose: the commit the words state they were written at
  | 'ref' // prose: a commit the words cite by a span
  | 'reaching-clause' // chart: a selection on ANOTHER view that reaches this one through the link graph — the {@link TierCommit.response} says what it does here, and {@link TierCommit.narrowed} says when it did NOTHING here
  | 'binding' // chart: a `reencode` that changed which column one of this view's channels draws
  | 'arrangement' // chart: a layout note on this view's own scope (a sheet's sort, a preset)
  | 'link-edit' // chart: an edit of a link edge INTO this view (its response, mapping or onClear)
  | 'derived-column' // chart: the act that COMPUTED a column this view's encoding draws — so "why does it look like this" reaches the arithmetic
  | 'origin' // selection: the commit an undo reverted to put this selection back (`cause.revertOf`)
  | 'replaced' // selection: the clear that made room for this selection when a saved picture was applied (`cause.replacedBy`)
  | 'sibling'; // selection: another commit of the same batch — one `correlationId`, e.g. one `applySaved` landing several conditions

/**
 * The responses a reaching selection can carry into a consumer — today
 * `filter | highlight | navigate | mirror`. WHY a FIELD and not four kinds: a
 * clause reaching a chart plays ONE role (`reaching-clause`) with four
 * meanings — filtering its rows is not the same act as lighting them up — and
 * a role that needs a qualifier takes a qualifier.
 *
 * Derived from `LINK_RESPONSES` rather than spelled again: `none` is excluded
 * by construction (an edge carrying it does not reach a consumer at all, and
 * nor does an encoding edge's `follow`, which is not a selection response), and
 * a fifth link response widens this type the day it is added instead of being
 * quietly cast into a value the type says is impossible.
 */
export type CommitResponse = Exclude<(typeof LINK_RESPONSES)[number], 'none'>;

/** One commit in the composed cross-tier set. Pure ids + tier/role tags. */
export interface TierCommit {
  readonly tier: Tier;
  /** The tier-native id (viz commit id / agent toolCallId / kernel runtimeStageId). */
  readonly id: string;
  /** Stable, index-free stage id for kernel commits (assertable). Absent off-kernel. */
  readonly stageId?: string;
  /** The role this commit plays. */
  readonly kind: TierCommitKind;
  /** The qualifier a `reaching-clause` needs — what the receiving view DOES with the selection. Absent on every other role. */
  readonly response?: CommitResponse;
  /**
   * Present exactly when this `reaching-clause` reached the view and the
   * DEFINITION says the table it reads has no such column: the column, and the
   * sentence saying so (`../session/clausesReaching.ts` · `unjudgeableWords`,
   * the one owner — the same words a read door reports on
   * `ReachingClause.narrowed`).
   *
   * Such a clause filtered NOTHING, so it is never the ANCHOR of a chart's
   * answer — "the commit that shaped what you see" would be a false credit.
   * It is still listed, because a clause nobody mentions reads as a clause
   * nobody sent: **omit, never deny**. Absent = it was judged, or the
   * definition does not declare the table's columns and therefore says nothing
   * either way (`columnStanding` · `undeclared`).
   */
  readonly narrowed?: {
    readonly column: string;
    readonly reason: string;
  };
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

/**
 * The five target kinds one `why()` answers. `column` = a materialised column;
 * `hypothesis` = a scalar/ledger row (C2); `prose` = a view's words;
 * `selection` and `chart` = what a view HOLDS and what a view SHOWS.
 *
 * R1: the two view-shaped targets ride the SAME join — nothing here is a second
 * algorithm. What differs is how the session builds {@link WhySources} for them:
 * each kind has its own ANCHOR law, stated at the target and in
 * `src/why/README.md`.
 */
export type WhyTarget =
  | { readonly kind: 'column'; readonly column: string }
  | { readonly kind: 'hypothesis'; readonly analysisId: string }
  /** A view's words: the `describe` commit that landed them, the selections they were written under, the proposal they were accepted from, the commits they cite, and the analysis they quote. */
  | { readonly kind: 'prose'; readonly viewId: string; readonly slot: ProseSlot }
  /**
   * What a view HOLDS: its live selection. The anchor is the commit that LANDED
   * it (R2); the other views' clauses live at that moment are the input (the
   * neighbourhood a walk was taken under); `origin` / `replaced` / `sibling`
   * name the act that put it there. No live clause at this cursor → an honest
   * `nothing-live` — a cleared selection is not a selection.
   */
  | { readonly kind: 'selection'; readonly viewId: string }
  /**
   * What a view SHOWS: its picture. The anchor is the LAST commit on the branch
   * that shaped it (R3) — a reaching clause, a binding, an arrangement, a link
   * edit, or its own live clause — and every one of those rides as a related
   * commit, together with the act that computed each derived column the
   * encoding draws. Nothing shaped it → `declared-in-def`: the chart looks the
   * way the definition says.
   */
  | { readonly kind: 'chart'; readonly viewId: string };

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

/**
 * One commit the target NAMED that this answer could not honour, so the reader
 * learns it was named. The law it discloses (`src/session/README.md`, law 5)
 * is *refuse what the author can fix, disclose what they cannot*: an authored
 * `refs[]` citation to another branch is REFUSED at the describe door, where
 * the writer can seek and repair it — but `basis.atCommit` is inert data that
 * door does not judge, so an off-branch one lands, and a log restored from the
 * wire can carry either. Those are dropped from the commit set (never faked as
 * provenance) and named here instead of vanishing.
 */
export interface DroppedRef {
  /** The commit id the target named. */
  readonly id: string;
  /** The role it was named in — the same tag it would have carried in `commits`. */
  readonly kind: TierCommitKind;
  /**
   * Why it could not be honoured. `off-branch`: the log holds this commit, but
   * on another branch — the words stand at a moment that never saw it, so the
   * fix is to seek there (or bring the step over) and write them again.
   * `unverified`: this answer could not find the commit at all — a ghost id, or
   * a caller that supplied only the branch and not the rest of the log.
   */
  readonly reason: 'off-branch' | 'unverified';
}

/**
 * The roles a RELATED commit may be named in: every kind EXCEPT the four
 * `why()` assigns itself — `declaring` (it resolves the anchor),
 * `input-selection` (it reads that list), and the two off-viz tiers.
 */
export type RelatedCommitKind = Exclude<TierCommitKind, 'declaring' | 'input-selection' | 'kernel-stage' | 'agent-frame'>;

/** One commit the target names, with the role it is named in and (for a reaching clause) its qualifiers. */
export interface RelatedCommit {
  readonly id: string;
  readonly kind: RelatedCommitKind;
  readonly response?: CommitResponse;
  /** {@link TierCommit.narrowed} — carried through to the row unchanged, so a caller marks a clause once and `why()` never re-judges it. */
  readonly narrowed?: {
    readonly column: string;
    readonly reason: string;
  };
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
  /**
   * Commits the target named that this answer could not honour — absent when
   * none was (so an answer with nothing to disclose costs nothing to say so).
   * Dropping them is the law and stays; being SILENT about them was the defect.
   *
   * **What a surface owes this field.** A disclosure that reaches the wire and
   * no reader is not a disclosure, so a surface that shows a `why` answer says
   * what was named — quietly, once — and it keeps the two {@link DroppedRef}
   * reasons APART, because they send a reader to different places: *on another
   * branch* means the log really holds that commit and these words stand at a
   * moment that never saw it; *unverified* means the answer could not find it
   * at all. It offers no repair and links no commit — this answer declined to
   * vouch for that citation, and a link would hand it back.
   *
   * The words themselves stay out of here: this composed answer is
   * machine-shaped and carries no prose (A2), so each surface writes its own.
   */
  readonly dropped?: readonly DroppedRef[];
  readonly flags: WhyFlags;
  /** kind:'hypothesis' only — the online-FDR ledger row for the test (machine context). */
  readonly fdr?: { readonly step: number; readonly reject: boolean };
}

/**
 * No provenance to walk. `no-such-target`: the target could not be located in
 * the session (an unknown column / analysis / slot / view). `declared-in-def`:
 * the target EXISTS — a view's words, or its picture, are the declaration's
 * own — but no commit landed them. `nothing-live`: the view is here and holds
 * NOTHING at this cursor, so there is no selection to be the reason for; it is
 * kept apart from `declared-in-def` because a selection has no declaration to
 * fall back to, and apart from `no-such-target` because the view is real — a
 * reader who cleared a brush should be told the brush is gone, not that the
 * view does not exist. A consumer must not read `ok: false` as "unknown
 * target" without looking at `missing`.
 */
export interface WhyTargetMiss {
  readonly ok: false;
  readonly missing: 'no-such-target' | 'declared-in-def' | 'nothing-live';
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
  /**
   * The QUALIFIER for the anchor row, when the anchor is itself a reaching
   * clause (a chart whose newest shaping act is another view's brush).
   *
   * WHY it exists: `why()` reports one row per commit and the first role wins,
   * so a commit that is BOTH the anchor and a reaching clause is reported once
   * — as `declaring`. Without this field its `response` would be dropped
   * precisely where a reader needs it most (the act you just made is usually
   * the newest one), and an answer must not gain or lose the meaning with the
   * data. Absent for every other target, so every pre-existing answer is
   * byte-identical.
   */
  readonly declaringResponse?: CommitResponse;
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
  /**
   * The commits the TARGET ITSELF points at — a view's words at the proposal
   * they were accepted from, a selection at the act that put it there, a chart
   * at everything that shaped it — each validated against the log before it
   * enters the set. A `reaching-clause` may carry its `response` qualifier and,
   * when it filtered nothing, its `narrowed` marker.
   */
  readonly relatedCommits?: readonly RelatedCommit[];
  /**
   * The commit ids this log holds that are NOT in {@link vizRecords} — every
   * other branch. Supplied ONLY so a dropped citation can say *"it is on
   * another branch"* rather than the untrue *"the log does not hold it"*; not
   * one of these may ever enter the commit set. It is the same courtesy
   * `proseWorld` pays at the describe door (`src/session/README.md`, law 5).
   * Absent, a drop is honestly reported as `unverified` — all a caller that
   * offered only the branch has said.
   */
  readonly commitsElsewhere?: readonly string[];
}

export type { RuntimeSnapshot };
