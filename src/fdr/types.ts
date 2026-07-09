/**
 * Online false-discovery-rate control — shared types.
 *
 * vizfootprint declares analyses up front (invariant R6: hypotheses are
 * *declared*, never inferred post hoc) and corrects for multiplicity ONLINE
 * (invariant R7), because in an agentic session hypotheses arrive adaptively —
 * the agent decides what to test next after seeing earlier results. Batch
 * procedures (Benjamini-Hochberg) assume a fixed, pre-specified family and are
 * therefore the wrong tool here (Zhao et al., "Controlling False Discoveries
 * During Interactive Data Exploration", SIGMOD 2017, DOI 10.1145/3035918.3064019).
 *
 * A dead end (an abandoned analysis branch) stays in the denominator
 * (invariant R8): the wealth it spent is never refunded. That falls out of the
 * design here for free — every test in the stream draws down wealth via the
 * penalty phi_t regardless of its branchId, and no procedure exposes a refund
 * operation.
 */

/** One declared analysis in the arrival stream. */
export interface HypothesisRecord {
  /** Stable id of the declared analysis (a node in the provenance graph). */
  readonly hypothesisId: string;
  /** The test's p-value, in [0, 1]. */
  readonly pValue: number;
  /** Logical arrival time (monotone within a run). */
  readonly timestamp: number;
  /**
   * The provenance branch this analysis lives on. A branch that is later
   * abandoned (a dead end) still consumed wealth: see invariant R8. Optional
   * so the FDR layer never *requires* provenance to run.
   */
  readonly branchId?: string;
}

/** Per-step audit row — the full trail the papers' guarantees are stated over. */
export interface FdrStep {
  /** 1-indexed position t in the stream (the "t" in the papers). */
  readonly step: number;
  readonly hypothesisId: string;
  readonly pValue: number;
  readonly timestamp: number;
  readonly branchId?: string;
  /** The test level alpha_t computed for this step (the rejection threshold). */
  readonly alphaThreshold: number;
  /** Decision R_t = 1{ p_t <= alpha_t }. */
  readonly reject: boolean;
  /** alpha-wealth W(t-1) available *before* this test. */
  readonly wealthBefore: number;
  /** alpha-wealth W(t) after applying the update. */
  readonly wealthAfter: number;
  /**
   * True iff this step was a rejection AND, for LORD++, it was the *first*
   * rejection (the step that earns the reduced reward b_t = alpha - W0).
   * Informational; drives no control decision.
   */
  readonly firstRejection: boolean;
}

/** Result of running a procedure over a whole stream (a fold of the stepper). */
export interface FdrRun {
  readonly procedure: 'LORD++' | 'alpha-investing';
  readonly alpha: number;
  readonly w0: number;
  /** Per-step audit trail, one row per declared analysis, in arrival order. */
  readonly audit: readonly FdrStep[];
  /** hypothesisIds of the discoveries (rejections). */
  readonly discoveries: readonly string[];
  /** Final alpha-wealth W(T). Guaranteed >= 0. */
  readonly finalWealth: number;
}

/** A nonincreasing sequence {gamma_j}, j >= 1, summing (ideally) to one. */
export type GammaSequence = (j: number) => number;
