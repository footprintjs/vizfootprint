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
 *
 * TL-1 adds the three LIFECYCLE events — `archive`, `restore`, `discard`. Each
 * carries the principal that asked for it (`by`), because hiding or rewinding
 * a line of work is an act with an author, unlike the bookkeeping above which
 * is a mechanical consequence of a commit landing. NOTHING here deletes: an
 * archived ref keeps its name and tip, a discarded future is re-named and
 * archived, and every commit stays in the log forever.
 */
export type RefEvent =
  | { readonly type: 'create'; readonly name: string; readonly at: string; readonly auto: boolean; readonly ts: number }
  | { readonly type: 'advance'; readonly name: string; readonly at: string; readonly ts: number }
  | { readonly type: 'switch'; readonly to: string | null; readonly at: string | null; readonly ts: number }
  | { readonly type: 'rename'; readonly from: string; readonly to: string; readonly ts: number }
  /** The path is hidden from the default listing — its name and tip are kept. */
  | { readonly type: 'archive'; readonly name: string; readonly at: string; readonly by: string; readonly ts: number }
  /** The exact inverse of `archive` — the path is visible again, unchanged. */
  | { readonly type: 'restore'; readonly name: string; readonly at: string; readonly by: string; readonly ts: number }
  /**
   * A path's ref moved BACK to an earlier commit (`from` → `to`); the abandoned
   * future was kept under the new archived path `kept`, whose tip is `from`.
   */
  | {
      readonly type: 'discard';
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly kept: string;
      readonly by: string;
      readonly ts: number;
    };

/**
 * A plain snapshot of the refs: `{name → tipCommitId}` plus where HEAD is.
 * `branches` lists the VISIBLE refs only; `archived` names the hidden ones
 * (their tips are still resolvable through `tipOf` — hidden, not erased).
 */
export interface RefState {
  readonly branches: Readonly<Record<string, string>>;
  readonly head: Head;
  /** TL-1: the archived ref names (hidden from `branches`, never deleted). */
  readonly archived: readonly string[];
}

// ── the folded state key-space (last-wins per key, from the log ALONE) ───────

/**
 * One folded state entry. The key-space mirrors the session's synthetic-viewId
 * wire convention (selection = `(viewId)`, encoding = `(viewId, channel)`,
 * analysis = `(analysis id)`); `commitId` names the LAST WRITER of the key.
 */
/**
 * Layer 4: the value a `link` commit carries — the edge as data. Typed
 * STRUCTURALLY here (this layer imports only the log; `src/links` owns the
 * real `LinkDecl`, which is assignable to this shape and narrows it back).
 */
export interface LinkValue {
  readonly source: string;
  readonly kind: string;
  readonly target: string;
  readonly response: string;
  readonly mapping?: readonly { readonly from: string; readonly to: string }[];
  readonly onClear?: string;
}

/** A prose record as the log layer sees it — structural, the prose plane narrows it back (this layer imports only the log). */
export type ProseValue = Readonly<Record<string, unknown>>;

export type FoldEntry =
  | {
      readonly kind: 'selection';
      readonly viewId: string;
      readonly clause: {
        readonly kind: 'point' | 'interval' | 'cell' | 'match';
        /** For kind:'cell' this is the display-only joint label; the pair rides `fields` (D30). */
        readonly field: string;
        readonly value: unknown;
        /** kind:'cell' only — the two selected fields, x side then y side. */
        readonly fields?: readonly [string, string];
      };
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
      readonly kind: 'prose';
      readonly viewId: string;
      readonly slot: string;
      readonly record: ProseValue;
      readonly commitId: string;
    }
  | {
      readonly kind: 'analysis';
      readonly analysisId: string;
      readonly field: string;
      readonly value: unknown;
      readonly commitId: string;
    }
  /** Layer 4: an edited edge (`link` verb), last-wins per edge id. */
  | {
      readonly kind: 'link';
      readonly edgeId: string;
      readonly link: LinkValue;
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
  | {
      readonly apply: 'selection';
      readonly viewId: string;
      readonly kind: 'point' | 'interval' | 'cell' | 'match';
      readonly field: string;
      readonly value: unknown;
      /** kind:'cell' only — the two selected fields (D30); the executor re-lands the compound. */
      readonly fields?: readonly [string, string];
    }
  | {
      readonly apply: 'clear-selection';
      readonly viewId: string;
      readonly field: string;
      /** The kind of the commit being cleared — the executor clears KIND-FAITHFULLY (a cleared point/match/interval of the same view). */
      readonly kind?: 'point' | 'interval' | 'cell' | 'match';
      /** Present when the commit being cleared was a cell — the executor clears kind-faithfully (a cleared CELL commit). */
      readonly fields?: readonly [string, string];
    }
  | { readonly apply: 'encoding'; readonly viewId: string; readonly channel: string; readonly field: string }
  | { readonly apply: 'clear-encoding'; readonly viewId: string; readonly channel: string }
  /** Encoding plane: re-land a binding SET in one act; a null field means "the view's declared initial" for that channel. */
  | { readonly apply: 'encoding-set'; readonly viewId: string; readonly bindings: Readonly<Record<string, string | null>> }
  | { readonly apply: 'analysis'; readonly analysisId: string }
  | { readonly apply: 'annotation'; readonly target: string; readonly note: string }
  /** A story beat re-named on the target path (`checkpoint` verb) — a position is named again, never copied. */
  | { readonly apply: 'beat'; readonly label: string }
  /** LY-1: re-land a cockpit-layout prop (`navigate` verb, `layout:${scope}` identity). */
  | { readonly apply: 'layout'; readonly scope: string; readonly prop: string; readonly value: string }
  /** Layer 4: re-land an edited edge (`link` verb). */
  | { readonly apply: 'link'; readonly link: LinkValue }
  /** The prose plane: re-land a slot's record, or null = back to the def's own words. */
  | { readonly apply: 'prose'; readonly viewId: string; readonly slot: string; readonly record: ProseValue | null }
  /** Layer 4: un-declare an edit — the edge falls back to the def's rule (`link` verb with response null). */
  | { readonly apply: 'clear-link'; readonly link: LinkValue };

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
