/**
 * The adapter contract — the ONE normalized shape every vizfootprint-ui
 * component consumes. It is deliberately framework-neutral: a plain object tree
 * with pre-derived flags, so a React hook, a Svelte store, or a vanilla render
 * loop can all read it the same way. The two supported SOURCES (an in-process
 * {@link SessionLike} or a polled state endpoint) both normalize INTO this.
 *
 * `Actor`, `ColumnFacet`, `FdrStep`, and the raw session/log shapes are imported
 * from `../../../src` (the packet's rule — import src types, never modify src),
 * but the public `SessionViewState` re-declares its own view-models so the
 * contract stays self-contained and stable even as src evolves.
 */

import type { Actor } from '../../../src/cause/index.js';

export type { Actor };

/** One commit in the append-only, cause-tagged, branching provenance log. */
export interface CommitView {
  readonly id: string;
  readonly parent: string | null;
  readonly viewId: string;
  readonly kind: 'point' | 'interval';
  readonly field: string;
  readonly value: unknown;
  /** The principal that authored the commit (`cause.requestedBy`). */
  readonly actor: Actor;
  /** The human-facing intent string, if the cause carried one. */
  readonly intent?: string;
  /** Cross-tier join key (R10), if stamped. */
  readonly correlationId?: string;
  /** A short, safe label for a chip/dot — never a raw value dump. */
  readonly label: string;
  // ── derived per build (so components stay dumb) ──
  /** On the active head→root path. */
  readonly onBranch: boolean;
  /** The read-only cursor sits here. */
  readonly isCursor: boolean;
  /** The active branch head sits here. */
  readonly isHead: boolean;
}

/** One column facet — name + type. VALUES never ride here (schema only). */
export interface ColumnView {
  readonly field: string;
  readonly type: string;
}

/** A view (chart) the session exposes, with its clause-kind capabilities. */
export interface ViewView {
  readonly viewId: string;
  readonly actor: Actor;
  readonly label?: string;
  /** Which point/interval SELECTION kinds this view can emit (R3 capability). */
  readonly selectionKinds: readonly ('point' | 'interval')[];
  readonly canProbe: boolean;
  readonly mounted: boolean;
  /** The current channel→field visual-encoding map at the cursor (the `reencode` fold; UI-0). */
  readonly encoding: Readonly<Record<string, string>>;
  /** Columns available to encode onto, branch-scoped at the cursor (names+types only). */
  readonly columns: readonly ColumnView[];
}

/** A live DATA-space selection (never pixels). */
export interface SelectionView {
  readonly viewId: string;
  readonly field: string;
  readonly kind: 'point' | 'interval';
  readonly value: unknown;
}

/** A branch tip in the DAG (a leaf lineage). */
export interface BranchView {
  readonly tip: string;
  readonly length: number;
  readonly actor: Actor;
  readonly active: boolean;
}

/** A named log position (checkpoint) — a story beat in present mode. */
export interface CheckpointView {
  readonly label: string;
  readonly commitId: string | null;
  readonly ts: number;
}

/** One online-FDR ledger row. */
export interface LedgerStep {
  readonly step: number;
  readonly hypothesisId: string;
  readonly pValue: number;
  readonly alphaThreshold: number;
  readonly reject: boolean;
  readonly wealthAfter: number;
}

/** The two-truths FDR ledger: cursor-local vs global, with the honesty line. */
export interface LedgerView {
  readonly procedure: string;
  readonly alpha: number;
  /** GLOBAL test count (all branches, monotone, never refunded). */
  readonly tests: number;
  readonly discoveries: number;
  readonly wealth: number;
  readonly steps: readonly LedgerStep[];
  /** CURSOR-LOCAL truth: tests visible on this branch at the cursor. */
  readonly cursorTests: number;
  /** The verbatim honesty line rendered under the two truths. */
  readonly honesty: string;
}

/** An unmet request, filed with a taxonomy code (never dropped). */
export interface GapView {
  readonly code: string;
  readonly op: string;
  readonly detail: string;
  readonly target?: string;
}

/** A declared analysis's readiness at the current cursor. */
export interface ReadinessView {
  readonly id: string;
  readonly kind: string;
  readonly produces: string;
  readonly ready: boolean;
  readonly blockedBy?: string;
  readonly missingColumns?: readonly string[];
  readonly selectedRows?: number;
  readonly minPoints?: number;
}

/** Per-view visual-channel → field map (UI-0's `reencode` surface). */
export type ViewEncoding = Readonly<Record<string, string>>;

/** The normalized dashboard state — the single render source. */
export interface SessionViewState {
  readonly defaultTable: string;
  readonly views: readonly ViewView[];
  /** viewId → { channel: field } — the `reencode` fold (Overview.encodings). */
  readonly encodings: Readonly<Record<string, ViewEncoding>>;
  /** table → column facets (schema). */
  readonly columns: Readonly<Record<string, readonly ColumnView[]>>;
  readonly selections: readonly SelectionView[];
  readonly commits: readonly CommitView[];
  readonly branches: readonly BranchView[];
  readonly checkpoints: readonly CheckpointView[];
  readonly cursor: string | null;
  readonly head: string | null;
  /** root→head commit ids (the active lineage). */
  readonly activePathIds: readonly string[];
  readonly viewingPast: boolean;
  readonly ledger: LedgerView;
  readonly gaps: readonly GapView[];
  readonly readiness: readonly ReadinessView[];
  /** Optional provider/mode label for a status readout. */
  readonly mode?: string;
}

/** The verbatim honesty line (single-sourced here). */
export const HONESTY_LINE = 'alpha spent on abandoned branches is never refunded';

/** An empty, render-safe state (before the first snapshot resolves). */
export function emptyState(defaultTable = 'data'): SessionViewState {
  return {
    defaultTable,
    views: [],
    encodings: {},
    columns: {},
    selections: [],
    commits: [],
    branches: [],
    checkpoints: [],
    cursor: null,
    head: null,
    activePathIds: [],
    viewingPast: false,
    ledger: { procedure: 'LORD++', alpha: 0.05, tests: 0, discoveries: 0, wealth: 0, steps: [], cursorTests: 0, honesty: HONESTY_LINE },
    gaps: [],
    readiness: [],
  };
}
