/**
 * L5 — session (`vizfootprint/agent`, the live half) · shared types.
 *
 * An {@link InteractionSession} is the container that wires ALL layers together:
 * one live Mosaic `Selection` + branch-capable commit log (L1), the source
 * registry + cause-clauses (L2), the data providers (D24), the declared
 * analyses (L3), and the online-FDR stepper (L4). `dispatch(action, {as})` is
 * THE single semantic entry point (R4) — the agent never synthesizes a raw
 * input event; there is no such path.
 */

import type { Actor, Cause } from '../cause/index.js';
import type { CommitRecord } from '../log/index.js';
import type { CauseClause } from '../mosaic/index.js';
import type { AnalysisKind, AnalysisOutput, AnalysisResult } from '../analysis/index.js';
import type { FdrStep, HypothesisRecord } from '../fdr/index.js';
import type { ColumnType } from '../data/index.js';
import type { DispatchVerb, IntentClass } from '../def/types.js';

// ── The gap ledger (D14 taxonomy) — every unmet request, typed, never dropped. ─

/** The D14 gap taxonomy codes. */
export type GapCode =
  | 'needs-column'
  | 'needs-analysis-kind'
  | 'needs-view'
  | 'guard-failed'
  | 'needs-backend-data';

/** The operation a gap was filed against. */
export type GapOp = DispatchVerb | 'declareAnalysis' | 'mountView';

/** One unmet request, filed with a taxonomy code. `detail`/`target` are INERT data (R12). */
export interface GapRow {
  readonly code: GapCode;
  readonly op: GapOp;
  /** Human-facing detail. INERT — never parsed, never dispatched on. */
  readonly detail: string;
  /** The data-space target the request named (viewId / field / analysisId). */
  readonly target?: string;
  /** Logical arrival time (monotone within a session). */
  readonly ts: number;
}

// ── The dispatch action vocabulary (SPEC §9). ──────────────────────────────────

export type DispatchAction =
  | { readonly verb: 'select'; readonly viewId: string; readonly field: string; readonly value: unknown; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'filter'; readonly viewId: string; readonly field: string; readonly range: readonly [number, number] | null; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'annotate'; readonly target: string; readonly note: string; readonly cause: Cause }
  | { readonly verb: 'navigate'; readonly viewId: string; readonly cause: Cause }
  | { readonly verb: 'analyze'; readonly analysisId: string; readonly input?: readonly Record<string, unknown>[]; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'fork'; readonly fromCommitId: string; readonly cause: Cause }
  | { readonly verb: 'checkpoint'; readonly label: string; readonly cause: Cause };

/** A named log position (the `checkpoint` verb). */
export interface Checkpoint {
  readonly label: string;
  readonly commitId: string | null;
  readonly ts: number;
}

/** The typed record of a declared-analysis invocation (the L3-flags landing spot). */
export interface AnalysisCommit {
  readonly analysisId: string;
  readonly kind: AnalysisKind;
  /** The typed, value-bearing output, or a typed degenerate flag (R14). */
  readonly result: AnalysisResult<AnalysisOutput>;
  /** The cause-tagged L1 record landed for this invocation (absent when degenerate — nothing lands). */
  readonly commit?: CommitRecord;
  /** kind:'test' only — the emitted HypothesisRecord (absent for transforms / degenerate). */
  readonly hypothesis?: HypothesisRecord;
  /** kind:'test' + non-degenerate — the online-FDR stepper's decision for this test. */
  readonly fdrStep?: FdrStep;
  /** Columns landed back into the data space (columns-channel transforms; R11). */
  readonly materialized?: readonly string[];
  /** A materialize/backend rejection filed as a gap (R14) instead of silently dropped. */
  readonly gap?: GapRow;
}

export type DispatchResult =
  | {
      readonly ok: true;
      readonly verb: DispatchVerb;
      readonly intent: IntentClass;
      readonly commit?: CommitRecord;
      readonly analysis?: AnalysisCommit;
      readonly checkpoint?: Checkpoint;
      readonly annotated?: { readonly target: string; readonly note: string };
      readonly navigatedTo?: string;
    }
  | {
      readonly ok: false;
      readonly verb: DispatchVerb;
      readonly intent: IntentClass;
      readonly rejection: GapRow;
    };

// ── The R3 symmetric view adapter (over L2's emission types). ──────────────────

/** What a view can do — declared per adapter (R14: honest capability, typed rejection). */
export interface AdapterCapabilities {
  /** Can this view emit selections at all? `false` → every probe is a `guard-failed` gap. */
  readonly canProbe: boolean;
  /** Which emission kinds it produces. Absent = both point and interval. */
  readonly encodings?: readonly ('point' | 'interval')[];
  /** Which data fields it encodes (informational). */
  readonly fields?: readonly string[];
}

/**
 * The symmetric adapter contract (R3) over L2's emission types. INBOUND: the
 * session hands a resolved cause-clause to `applyClause` so the view re-renders
 * under it (optional — a display-only sink). OUTBOUND is `dispatch` itself:
 * a view drives the session through the SAME semantic verbs, never a raw event.
 */
export interface ViewAdapter {
  readonly capabilities: AdapterCapabilities;
  applyClause?(clause: CauseClause): void;
}

// The L6 `why(target)` result types now live in `../why` (promoted P3-L6); the
// session re-exports them from its barrel for family symmetry.

// ── Session construction + the whats_here projection. ──────────────────────────

export interface SessionOptions {
  /** Default acting principal for dispatches / the tool port. Default `'agent'`. */
  readonly as?: Actor;
  /** Override the runtime default table. Must be a declared table. */
  readonly defaultTable?: string;
}

export interface ViewInfo {
  readonly viewId: string;
  readonly actor: Actor;
  readonly label?: string;
  readonly encodings: readonly ('point' | 'interval')[];
  readonly canProbe: boolean;
  readonly mounted: boolean;
}

/** An active DATA-space selection (never pixels; R5). */
export interface SelectionInfo {
  readonly viewId: string;
  readonly field: string;
  readonly kind: 'point' | 'interval';
  readonly value: unknown;
}

/** An analysis's readiness (D12 guards+skills framing): can it run at the current cursor? */
export interface AnalysisReadiness {
  readonly id: string;
  readonly kind: AnalysisKind;
  readonly produces: AnalysisOutput['as'];
  readonly ready: boolean;
  /** The taxonomy code that blocks it, if not ready. */
  readonly blockedBy?: GapCode;
  /** Input columns not (yet) present in the table. */
  readonly missingColumns?: readonly string[];
  /** The honesty floor, if declared. */
  readonly minPoints?: number;
  /** Rows under the current selection (the analysis input size). */
  readonly selectedRows?: number;
}

export interface FdrSummary {
  readonly procedure: 'LORD++' | 'alpha-investing';
  readonly alpha: number;
  readonly tests: number;
  readonly discoveries: number;
  readonly wealth: number;
  readonly ledger: readonly FdrStep[];
}

/** One column facet — names/types are schema; VALUES never ride here (Q8). */
export interface ColumnFacet {
  readonly field: string;
  readonly type: ColumnType;
}

/** The structured payload `whats_here` projects. All app content lives in DATA fields. */
export interface Overview {
  readonly defaultTable: string;
  readonly views: readonly ViewInfo[];
  readonly activeSelections: readonly SelectionInfo[];
  readonly analyses: readonly AnalysisReadiness[];
  readonly fdr: FdrSummary;
  readonly columns: Readonly<Record<string, readonly ColumnFacet[]>>;
  readonly gaps: number;
  readonly currentView: string | null;
  readonly engines: Readonly<Record<string, string>>;
}

/** Options for a direct `declareAnalysis` invocation. */
export interface DeclareAnalysisOptions {
  /** Register (and validate) a def/module under `id` before running it (SPEC §7 `declareAnalysis(id, def)`). */
  readonly def?: import('../def/types.js').AnalysisSlot;
  /** Explicit input rows. Absent = the current selection (or the FULL table for a columns-channel analysis). */
  readonly input?: readonly Record<string, unknown>[];
  /** Which table to read input from / materialize into. Default: the session default table. */
  readonly table?: string;
  /** The two-slot cause. `computedBy` is ALWAYS forced to 'system' (R1). */
  readonly cause?: Cause;
  /** Acting principal (sets `requestedBy`). Default: the session default. */
  readonly as?: Actor;
  /** Cross-tier join key stamped on the landed commit (R10). */
  readonly correlationId?: string;
}
