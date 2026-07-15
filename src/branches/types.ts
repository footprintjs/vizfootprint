/**
 * BR-1 — `vizfootprint/branches` · shared types.
 *
 * Git-style NAMED branching over the append-only commit log. Everything here
 * lives BESIDE the log, never in it: commits stay frozen (R8 untouched); the
 * refs are the one thing allowed to move. This subpath imports ONLY the log
 * layer (`src/log` types) — no session, no data providers, no engines — so
 * anyone can use it against a raw `CommitRecord[]`.
 */

// ── refs & HEAD ─────────────────────────────────────────────────────────────

/**
 * Where HEAD is: attached to a named branch (commits advance its ref), or
 * detached at a commit id (the cursor travelled into the past — the next
 * commit auto-creates a NAMED ref; today's branch-on-act, now named).
 * `detached: null` = detached before any commit exists.
 */
export type Head =
  | { readonly branch: string }
  | { readonly detached: string | null };

/**
 * One entry in the ref-event journal: even branch bookkeeping is auditable.
 * Ref-events are lightweight records, NOT commits — they never enter the log.
 * `ts` is a logical clock (monotone journal position), mirroring the log's
 * own `ts: input.ts ?? records.length` precedent (src/log/log.ts).
 */
export type RefEvent =
  | { readonly type: 'create'; readonly name: string; readonly at: string; readonly auto: boolean; readonly ts: number }
  | { readonly type: 'advance'; readonly name: string; readonly at: string; readonly ts: number }
  | { readonly type: 'switch'; readonly to: string | null; readonly at: string | null; readonly ts: number }
  | { readonly type: 'rename'; readonly from: string; readonly to: string; readonly ts: number };

/** A plain snapshot of the refs: `{name → tipCommitId}` plus where HEAD is. */
export interface RefState {
  readonly branches: Readonly<Record<string, string>>;
  readonly head: Head;
}

// ── the folded state key-space (last-wins per key, from the log ALONE) ───────

/**
 * One folded state entry. The key-space mirrors the session's synthetic-viewId
 * wire convention (selection = `(viewId)`, encoding = `(viewId, channel)`,
 * analysis = `(analysis id)`); `commitId` names the LAST WRITER of the key.
 */
export type FoldEntry =
  | {
      readonly kind: 'selection';
      readonly viewId: string;
      readonly clause: { readonly kind: 'point' | 'interval'; readonly field: string; readonly value: unknown };
      readonly commitId: string;
    }
  | {
      readonly kind: 'encoding';
      readonly viewId: string;
      readonly channel: string;
      readonly field: string;
      readonly commitId: string;
    }
  | {
      readonly kind: 'analysis';
      readonly analysisId: string;
      readonly field: string;
      readonly value: unknown;
      readonly commitId: string;
    };

/** The folded state at a tip: state key → its last-wins entry. */
export type FoldState = ReadonlyMap<string, FoldEntry>;

// ── foldDiff ────────────────────────────────────────────────────────────────

/** A key present on BOTH sides with different values. */
export interface DiffChange {
  readonly key: string;
  readonly a: FoldEntry;
  readonly b: FoldEntry;
}

/** A key present on exactly ONE side. */
export interface DiffOnly {
  readonly key: string;
  readonly value: FoldEntry;
}

/**
 * The structured state diff between two tips, computed from the log alone —
 * deliberately NO row counts here (that needs an engine; the session layer
 * enriches per-side row counts on top). Deterministic: entries sort by key.
 */
export type FoldDiffResult =
  | {
      readonly ok: true;
      /** The LCA commit id of the two tips, or null for disjoint roots. */
      readonly ancestor: string | null;
      readonly changed: readonly DiffChange[];
      readonly onlyA: readonly DiffOnly[];
      readonly onlyB: readonly DiffOnly[];
    }
  | { readonly ok: false; readonly reason: 'unknown-commit'; readonly missing: readonly string[] };

// ── commonAncestor ──────────────────────────────────────────────────────────

/** LCA result — missing-id honest; `ancestorId: null` = disjoint roots. */
export type AncestorResult =
  | { readonly ok: true; readonly ancestorId: string | null }
  | { readonly ok: false; readonly reason: 'unknown-commit'; readonly missing: readonly string[] };

// ── plans (plan, don't execute) ─────────────────────────────────────────────

/**
 * What a plan asks the EXECUTOR (the session, through its normal dispatch —
 * commit-on-intent stays in one place) to do. NO new verbs: every recipe maps
 * onto an existing dispatch verb. `clear-encoding` means "restore the view's
 * declared initial binding" — only the session knows the def, so the plan
 * states the intent and the executor resolves it.
 */
export type PlanRecipe =
  | { readonly apply: 'selection'; readonly viewId: string; readonly kind: 'point' | 'interval'; readonly field: string; readonly value: unknown }
  | { readonly apply: 'clear-selection'; readonly viewId: string; readonly field: string }
  | { readonly apply: 'encoding'; readonly viewId: string; readonly channel: string; readonly field: string }
  | { readonly apply: 'clear-encoding'; readonly viewId: string; readonly channel: string }
  | { readonly apply: 'analysis'; readonly analysisId: string }
  | { readonly apply: 'annotation'; readonly target: string; readonly note: string }
  /** LY-1: re-land a cockpit-layout prop (`navigate` verb, `layout:${scope}` identity). */
  | { readonly apply: 'layout'; readonly scope: string; readonly prop: string; readonly value: string };

/**
 * A bring-over (cherry-pick) or undo (revert) plan. A CONFLICT names the
 * commit that touched the same state key on the target path since the LCA —
 * the plan stays executable, the note is explicit. `not-undoable` is honest:
 * an analysis cannot be un-run (the FDR ledger never refunds) and an
 * annotation has no prior state.
 */
export type PlanResult =
  | { readonly ok: true; readonly recipe: PlanRecipe; readonly conflicts: readonly string[] }
  | { readonly ok: false; readonly reason: 'unknown-commit' | 'not-undoable'; readonly detail: string };
