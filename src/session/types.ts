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
import type { CellClause, ColumnType, IntervalClause } from '../data/index.js';
import type { DispatchVerb, IntentClass } from '../def/types.js';
import type { DiffChange, DiffOnly, PlanRecipe, RefEvent } from '../branches/index.js';

// ── The gap ledger (D14 taxonomy) — every unmet request, typed, never dropped. ─

/**
 * The D14 gap taxonomy codes. The `chart-*` codes (RP-3) are the four governed
 * `proposeChart` pipeline refusals — each a stage of schema-valid →
 * capability-check → hypothesis, landed instead of a silent drop so the agent
 * reads the reason back and repairs.
 */
export type GapCode =
  | 'needs-column'
  | 'needs-analysis-kind'
  | 'needs-view'
  | 'guard-failed'
  | 'needs-backend-data'
  // ── RP-3: agent-authored chart pipeline refusals ──
  | 'chart-invalid-spec'
  | 'chart-transforms-not-owned'
  | 'chart-unsupported-composition'
  | 'chart-hypothesis-rejected';

/** The operation a gap was filed against. */
export type GapOp =
  | DispatchVerb
  | 'declareAnalysis'
  | 'proposeChart'
  | 'mountView'
  | 'seek'
  | 'switchPath'
  | 'renamePath'
  | 'newPathAt'
  | 'compare'
  | 'bringOver'
  | 'undo'
  // ── TL-1: the trail lifecycle ──
  | 'archivePath'
  | 'restorePath'
  | 'discardFromHere'
  | 'adoptPath';

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

/**
 * The `filter` verb's interval shape — single-sourced from `src/data`'s
 * `IntervalClause` (the seam that actually EVALUATES it), so this type and
 * the data layer's own can never drift: `[lo, hi]`, a half-open pair with one
 * bound `null` (e.g. `[150, null]` — "150 or more"), numeric or ISO-8601
 * date-string bounds (never mixed), or `null` to clear the filter entirely.
 */
export type FilterRange = IntervalClause['value'];

/**
 * The cell-select value pair — single-sourced from `src/data`'s `CellClause`
 * (the seam that actually EVALUATES it), the `FilterRange` precedent exactly:
 * `[x side, y side]` where each side is an interval `[lo, hi]` (half-open
 * allowed, numeric or ISO-date-string bounds) or a point value; or `null` to
 * clear the whole cell.
 */
export type CellValues = CellClause['value'];

export type DispatchAction =
  | { readonly verb: 'select'; readonly viewId: string; readonly field: string; readonly value: unknown; readonly cause: Cause; readonly correlationId?: string }
  /**
   * The CELL form of `select` (D30): one heatmap-cell gesture selects on TWO
   * fields at once ("price 100–150 AND category Formal") and lands ONE
   * commit whose predicate is the AND of both sides — never two
   * correlationId-linked commits. Same verb, same intent class, same fold key
   * (`selection:${viewId}`, last-wins per view) — the vocabulary stays at 8
   * verbs. `values: null` clears the cell (the cleared-interval rule).
   */
  | { readonly verb: 'select'; readonly viewId: string; readonly fields: readonly [string, string]; readonly values: CellValues; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'filter'; readonly viewId: string; readonly field: string; readonly range: FilterRange; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'annotate'; readonly target: string; readonly note: string; readonly cause: Cause }
  /**
   * `navigate` — record a VIEW-state move; deliberately NON-filtering (a
   * viewport or an arrangement is not a data claim). Two shapes share the verb:
   *   • a declared view (pan/zoom): the verb itself is the record — no commit
   *     lands; the view state rides `cause.intent` as inert data (RP-1).
   *   • the `layout:${scope}` synthetic identity (LY-1 — e.g.
   *     `layout:dashboard`): `field` names the arrangement prop (`preset` /
   *     `order` / `focus`), `value` its plain-string value, and ONE
   *     cause-tagged commit LANDS so the session fold carries the arrangement
   *     through seek / switchPath / fork (time-travel restores the layout).
   */
  | { readonly verb: 'navigate'; readonly viewId: string; readonly field?: string; readonly value?: string; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'analyze'; readonly analysisId: string; readonly input?: readonly Record<string, unknown>[]; readonly cause: Cause; readonly correlationId?: string }
  | { readonly verb: 'fork'; readonly fromCommitId: string; readonly cause: Cause }
  | { readonly verb: 'checkpoint'; readonly label: string; readonly cause: Cause }
  /**
   * The 8th verb (Q6 completeness gap, orchestrator-adjudicated): rebind a
   * view's visual CHANNEL (e.g. `x`) to a different data `field` — a
   * state-changing transition (R1: lands a cause-tagged commit; R2: replays;
   * time-travel: the fold carries the encoding, so `seek` restores the old one).
   */
  | { readonly verb: 'reencode'; readonly viewId: string; readonly channel: string; readonly field: string; readonly cause: Cause; readonly correlationId?: string };

/** A named log position (the `checkpoint` verb). A NAMED pointer to a commit — stored as inert data, listable. */
export interface Checkpoint {
  readonly label: string;
  /** The beat commit itself — the recorded act of naming. */
  readonly commitId: string | null;
  /**
   * The position the beat NAMES — the beat commit's parent. Present mode
   * orders and seeks by this: a beat named at a commit stays on every
   * lineage that runs through that commit, even after a fork below it.
   */
  readonly at: string | null;
  /** The beat commit's index in the log. */
  readonly ts: number;
}

/**
 * One divergent lineage in the append-only branch DAG (R8), identified by its
 * TIP — the leaf commit that terminates it. Branches are never stored; they are
 * DERIVED from the parent-pointer topology (a commit with no children is a tip).
 * Old branches stay intact and replayable; a branch-on-act only ever adds a new
 * sibling leaf, it never rewrites or removes an existing lineage.
 */
export interface BranchInfo {
  /** The leaf commit id that terminates this lineage. */
  readonly tip: string;
  /** Commits from the root down to (and including) the tip. */
  readonly length: number;
  /** The principal that authored the tip commit (for badging in a branch map). */
  readonly actor: Actor;
  /** True iff this is the ACTIVE branch (its tip === the current branch head). */
  readonly active: boolean;
}

/**
 * The time-travel position (Phase A): a read-only CURSOR distinct from the
 * active branch HEAD. `seek()`/`fork` move the cursor and rebuild the resolved
 * fold there; the head only moves when an act LANDS a commit (a branch-on-act
 * from a past cursor makes the new sibling lineage active). Rendered by the
 * dashboard's two-truths ledger and time-travel bar (Phase B).
 */
export interface TimeState {
  /** The read-only cursor — the root of the fold and the parent the next act commits from. */
  readonly cursor: string | null;
  /** The active branch head — the tip of the lineage linear commits extend. */
  readonly head: string | null;
  /** Number of divergent lineages (leaves) currently in the log. */
  readonly branches: number;
  /** Number of named checkpoints. */
  readonly checkpoints: number;
  /**
   * Test-analog commits visible on the cursor's branch path — the CURSOR-LOCAL
   * truth ("tests visible at this point on this branch"). The GLOBAL truth (all
   * tests across all branches, monotone, never refunded) lives in {@link FdrSummary}.
   */
  readonly cursorTests: number;
  /** True iff the cursor is behind the active head (you are viewing the past). */
  readonly viewingPast: boolean;
}

/** The result of a `seek(commitId)` navigation — read-only, never a mutation. */
export type SeekResult =
  | { readonly ok: true; readonly cursor: string }
  | { readonly ok: false; readonly gap: GapRow };

// ── Named paths (BR-1: git-style refs + HEAD, beside the log). ─────────────────

/** One NAMED path (branch): its ref name, tip commit, and quick stats. */
export interface PathInfo {
  readonly name: string;
  /** The tip commit id this ref points at. */
  readonly tip: string;
  /** Commits from the root down to (and including) the tip. */
  readonly steps: number;
  /** The tip commit's logical timestamp (the log's own `ts`). */
  readonly lastTs: number;
  /** True iff HEAD rides this path. */
  readonly active: boolean;
  /**
   * TL-1: present (and always `true`) only on an ARCHIVED path — hidden from
   * the default listing, never deleted. Absent on a visible path, so a
   * plain listing keeps the shape it always had.
   */
  readonly archived?: true;
}

/** What `paths()` lists — visible paths by default; archived ones are hidden, not gone. */
export interface PathsListOptions {
  /** TL-1: also list the archived paths, each flagged `archived: true`. Default false. */
  readonly includeArchived?: boolean;
}

/** The refs surface `overview()` exposes (BR-1): names, HEAD, and the ref-event journal. */
export interface PathsState {
  /** The named path HEAD rides, or null while detached (cursor travelled by id). */
  readonly current: string | null;
  /** The commit id HEAD is detached at (null when attached — or detached pre-commit). */
  readonly detachedAt: string | null;
  /** The VISIBLE paths (archived ones are hidden here — ask `paths({includeArchived:true})`). */
  readonly list: readonly PathInfo[];
  /** TL-1: how many paths are archived — hidden, not erased; the statistics still count them. */
  readonly archived: number;
  /** The ref-event journal: create/advance/switch/rename/archive/restore/discard — auditable, never commits. */
  readonly events: readonly RefEvent[];
}

// ── TL-1: the trail lifecycle (archive / restore / discard-from-here / adopt) ──

export type ArchivePathResult =
  | {
      readonly ok: true;
      readonly name: string;
      /** The tip the archived path keeps (it is still resolvable — hidden, not erased). */
      readonly tip: string;
      /** True when HEAD rode this path and therefore detached at its tip. */
      readonly detached: boolean;
    }
  | { readonly ok: false; readonly gap: GapRow };

export type RestorePathResult =
  | { readonly ok: true; readonly name: string; readonly tip: string }
  | { readonly ok: false; readonly gap: GapRow };

/**
 * What `discardFromHere()` did: the path's ref moved back to `at`, and the
 * abandoned future was KEPT as an archived path named `kept` (tip `keptTip`).
 * Nothing was deleted — `keptTip` still folds to exactly the same state.
 */
export type DiscardResult =
  | {
      readonly ok: true;
      /** The path whose ref moved. */
      readonly path: string;
      /** The commit the path now ends at (the new tip). */
      readonly at: string;
      /** The system-named archived path holding the abandoned future. */
      readonly kept: string;
      /** That path's tip — the commit the discarded line used to end at. */
      readonly keptTip: string;
      /** How many steps were hidden (commits after `at`, through `keptTip`). */
      readonly steps: number;
    }
  | { readonly ok: false; readonly gap: GapRow };

/** One replayed step of an {@link InteractionSession.adoptPath} run — applied or honestly skipped. */
export interface AdoptStep {
  /** The SOURCE commit this step replays. */
  readonly commitId: string;
  readonly applied: boolean;
  /** What it replayed as (present when applied). */
  readonly recipe?: PlanRecipe;
  /** The new commit it landed as here (absent when the replay landed nothing, e.g. a degenerate analysis). */
  readonly landedAs?: string;
  /** Commit ids on THIS path that already touched the same state since the common ancestor. */
  readonly conflicts: readonly string[];
  /** Why it was not applied — honest, never a silent drop. */
  readonly skippedReason?: string;
}

export type AdoptPathResult =
  | {
      readonly ok: true;
      /** The source path adopted from — left completely untouched. */
      readonly path: string;
      /** The common ancestor the replay started after (null for disjoint roots). */
      readonly ancestor: string | null;
      readonly steps: readonly AdoptStep[];
      readonly applied: number;
      readonly skipped: number;
      /** Every conflict noted across the run (each also stamped into its own landed commit). */
      readonly conflicts: readonly string[];
    }
  | { readonly ok: false; readonly gap: GapRow };

export type SwitchPathResult =
  | { readonly ok: true; readonly name: string; readonly cursor: string }
  | { readonly ok: false; readonly gap: GapRow };

export type RenamePathResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly gap: GapRow };

export type NewPathResult =
  | { readonly ok: true; readonly name: string; readonly cursor: string }
  | { readonly ok: false; readonly gap: GapRow };

/** One side of a `compare()`: how it was named, the tip it resolved to, and its row count. */
export interface CompareSide {
  readonly ref: string;
  readonly tip: string;
  /** Rows under this side's folded selections (default table) — null when the backend cannot count (honest, never 0-faked). */
  readonly rows: number | null;
}

/**
 * The structured diff between two positions (path names or commit ids): the
 * `branches/` foldDiff enriched with per-side row counts via the data provider.
 */
export type CompareResult =
  | {
      readonly ok: true;
      readonly a: CompareSide;
      readonly b: CompareSide;
      /** The common-ancestor commit id, or null for disjoint roots. */
      readonly ancestor: string | null;
      readonly changed: readonly DiffChange[];
      readonly onlyA: readonly DiffOnly[];
      readonly onlyB: readonly DiffOnly[];
    }
  | { readonly ok: false; readonly gap: GapRow };

/**
 * The result of `bringOver()` / `undo()`: the plan that ran (recipe +
 * conflicts) and the ordinary dispatch result it landed through. `commit` is
 * the landed record when one landed (an analyze recipe surfaces its commit
 * from the AnalysisCommit).
 */
export type BringOverResult =
  | {
      readonly ok: true;
      readonly recipe: PlanRecipe;
      /** Overriding commit ids on the target path since the LCA — also stamped into the commit's cause. */
      readonly conflicts: readonly string[];
      readonly commit?: CommitRecord;
      readonly result: DispatchResult;
    }
  | { readonly ok: false; readonly gap: GapRow };

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

// ── RP-3: agent-authored charts (the ledger-gated proposeChart pipeline). ──────

/** What a caller hands `proposeChart` — the chart's id, its VL spec, and its claim. */
export interface ProposeChartInput {
  /** Stable chart id; the view lands under `chart:${id}`. Non-empty. */
  readonly id: string;
  /**
   * The proposed Vega-Lite spec, as opaque JSON (the core library never imports
   * Vega-Lite — see `src/renderer/specShapeGate.ts`). Must round-trip JSON.
   */
  readonly spec: unknown;
  /** The chart's inferential CLAIM (e.g. "price vs rating reveals a relationship"). INERT data (R12). */
  readonly claim?: string;
  /** Agent-authored provenance. `computedBy` is respected (a chart is agent-computed, not system). */
  readonly cause?: Cause;
  /** Cross-tier join key stamped on the landed commits (R10). */
  readonly correlationId?: string;
}

/**
 * A proposed chart's LEDGERED HYPOTHESIS — the honest record shape (RP-3 / D28).
 * A chart is an inferential claim, so it is registered in the SAME LORD++
 * ledger that governs every other claim. But it carries NO computed statistic:
 * it is an UNTESTED visual claim, entered at p = 1.0 (the null-est value) so it
 * COSTS multiplicity budget — an agent cannot fish through charts for free — yet
 * can NEVER be counted as a discovery (an unaudited chart must never register as
 * a confirmed finding). `tested` is always false and `reject` on the step is
 * always false in v1.
 */
export interface ChartHypothesis {
  readonly chartId: string;
  /** The chart's inferential claim (INERT data). */
  readonly claim: string;
  /** Who authored the proposal (agent-authored provenance — `cause.computedBy`). */
  readonly authoredBy: Actor;
  /** Always false in v1: a proposed chart carries no computed statistic. */
  readonly tested: false;
  /** The conventional p-value the untested claim enters the ledger at (always 1). */
  readonly pValueUsed: 1;
  /** The online-FDR stepper's row for this hypothesis (its `reject` is always false at p=1). */
  readonly fdrStep: FdrStep;
}

/** A registered agent-authored chart — a real session view under `chart:${id}`. */
export interface ChartView {
  readonly chartId: string;
  /** The synthetic view identity: `chart:${chartId}`. */
  readonly viewId: string;
  /** The gated spec (host owns the data channel; inline data is noted, never rendered). */
  readonly spec: unknown;
  readonly claim: string;
  readonly authoredBy: Actor;
  /** The spec-registration commit id (the one carrying the spec). */
  readonly commitId: string;
  /** This chart's row position in the FDR ledger (its `FdrStep.step`). */
  readonly ledgerStep: number;
}

/** The `whats_here` projection of one agent-authored chart + its ledger status. */
export interface ChartInfo {
  readonly chartId: string;
  readonly viewId: string;
  readonly claim: string;
  readonly authoredBy: Actor;
  /** true — a registered chart passed every gate (a rejected one is never registered). */
  readonly ledgered: true;
  /** Its FDR-ledger row position. */
  readonly ledgerStep: number;
}

export type ProposeChartResult =
  | {
      readonly ok: true;
      readonly chartId: string;
      /** The registered agent-authored chart view. */
      readonly view: ChartView;
      /** The ledgered hypothesis (its FDR step + honest untested marker). */
      readonly hypothesis: ChartHypothesis;
      /** The spec-registration commit (the render source). */
      readonly commit: CommitRecord;
      /** The FDR-ledger row this proposal landed. */
      readonly fdrStep: FdrStep;
    }
  | { readonly ok: false; readonly gap: GapRow };

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
      readonly reencoded?: { readonly viewId: string; readonly channel: string; readonly field: string };
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
  /**
   * Which emission kinds it produces. Absent = every kind is allowed
   * (declare the list to narrow honestly — e.g. a heatmap is `['cell']`).
   */
  readonly encodings?: readonly ('point' | 'interval' | 'cell')[];
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
  /**
   * Which point/interval/cell SELECTION kinds this view can emit (R3
   * capability — renamed from the old `encodings` to free that name for the
   * visual-channel sense below; nothing shipped ever read the old name off
   * `Overview`).
   */
  readonly selectionKinds: readonly ('point' | 'interval' | 'cell')[];
  readonly canProbe: boolean;
  readonly mounted: boolean;
  /**
   * The current CHANNEL→field visual-encoding map at the cursor (the
   * `reencode` verb's fold; SPEC Q6 8th-verb). Empty if the view declares no
   * encoding surface. Seeking the cursor back in time restores the OLD map.
   */
  readonly encodings: Readonly<Record<string, string>>;
  /**
   * The columns available to encode onto, branch-scoped at the cursor (D14
   * token-lean discipline: names + types only, never values — Q8). Currently
   * every view reads the session's single default table, so this mirrors
   * `Overview.columns[defaultTable]`; surfaced per-view so a chat agent can
   * answer "what can I put on x?" from one `whats_here` entry.
   */
  readonly columns: readonly ColumnFacet[];
}

/** An active DATA-space selection (never pixels; R5). */
export interface SelectionInfo {
  readonly viewId: string;
  /** For kind:'cell' this is the display-only joint label; the pair rides `fields` (D30). */
  readonly field: string;
  readonly kind: 'point' | 'interval' | 'cell';
  /** For kind:'cell': the two-sided pair `[x side, y side]`. */
  readonly value: unknown;
  /** kind:'cell' only — the two selected fields, x side then y side. */
  readonly fields?: readonly [string, string];
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
  /**
   * Present when the def declared this column as the table's ABSENCE column
   * (`DataSourceDef.absence`): the vocabulary it speaks, verbatim. An agent
   * reading `whats_here` learns that "unavailable" here is a kind of silence,
   * not a category like any other — and never a number.
   */
  readonly absence?: readonly string[];
}

/** The structured payload `whats_here` projects. All app content lives in DATA fields. */
export interface Overview {
  readonly defaultTable: string;
  readonly views: readonly ViewInfo[];
  readonly activeSelections: readonly SelectionInfo[];
  readonly analyses: readonly AnalysisReadiness[];
  readonly fdr: FdrSummary;
  readonly columns: Readonly<Record<string, readonly ColumnFacet[]>>;
  /**
   * viewId → the same channel→field map as `views[].encodings` (SPEC Q6 8th
   * verb), flattened to a lookup for a caller that wants one view's mapping
   * without scanning `views`. Redundant with `views[].encodings` by design —
   * a convenience projection, not a second source of truth (both are read
   * off the identical `activeEncodings` fold in the same `overview()` call).
   */
  readonly encodings: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * LY-1: scope → prop → value — the cockpit-layout fold (`navigate` verb,
   * `layout:${scope}` synthetic identity), branch-scoped at the cursor exactly
   * like `encodings`. Empty until a layout note lands; seeking the cursor back
   * in time restores the OLD arrangement. Values are plain inert strings
   * (e.g. `{ dashboard: { preset: 'focus', focus: 'scatter' } }`).
   */
  readonly layouts: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly gaps: number;
  readonly currentView: string | null;
  readonly engines: Readonly<Record<string, string>>;
  /** Time-travel position: cursor vs active head, branch/checkpoint counts, cursor-local test count (Phase A). */
  readonly time: TimeState;
  /** Named paths (BR-1): the refs, where HEAD is, and the ref-event journal. */
  readonly paths: PathsState;
  /** RP-3: the agent-authored charts registered this session + their ledger status. */
  readonly charts: readonly ChartInfo[];
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
