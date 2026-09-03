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

import type { SourceInfo } from '../source/types.js';
import type { Actor, Cause } from '../cause/index.js';
import type { EmissionKind, FieldMapping, LinkEdge, LinkGraph, LinkOnClear, LinkResponse, LinkKind, ChannelPair } from '../links/types.js';
import type { CommitRecord } from '../log/index.js';
import type { CauseClause } from '../mosaic/index.js';
import type { AnalysisKind, AnalysisOutput, AnalysisResult } from '../analysis/index.js';
import type { FdrStep, HypothesisRecord } from '../fdr/index.js';
import type { CellClause, ColumnFacet, ColumnType, Engine, IntervalClause, PredicateClause, Row, SortSpec } from '../data/index.js';
import type { EncodingProblem, Fit, RuleLine, RuleScope } from '../encoding/index.js';
import type { ProseRecord, ProseSlot, ProseStatus, ProposalStatus } from '../prose/index.js';
import type { DispatchVerb, IntentClass, SeriesGrain, SavedClause, SavedSelection, Tag } from '../def/types.js';
import type { RefreshRecord } from '../def/buildDashboard.js';
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
  // ── layer 4 offers: an act named an offer that is not the current one for its node (or none, where one is required) ──
  | 'stale-offer'
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
  | { readonly verb: 'select'; readonly viewId: string; readonly field: string; readonly value: unknown; readonly cause: Cause; readonly correlationId?: string; readonly offerId?: string }
  /**
   * The MATCH form of `select` (SET-1): one field, MANY values — the plural of
   * a point (shift-click adds one, a drag crosses a run). `exclude: true`
   * keeps everything BUT them. Same verb, same intent class, same fold key
   * (`selection:${viewId}`, last-wins per view); `values: null` clears (the
   * cleared-interval rule).
   */
  | { readonly verb: 'select'; readonly viewId: string; readonly field: string; readonly values: readonly unknown[] | null; readonly exclude?: boolean; readonly cause: Cause; readonly correlationId?: string; readonly offerId?: string }
  /**
   * The CELL form of `select` (D30): one heatmap-cell gesture selects on TWO
   * fields at once ("price 100–150 AND category Formal") and lands ONE
   * commit whose predicate is the AND of both sides — never two
   * correlationId-linked commits. Same verb, same intent class, same fold key
   * (`selection:${viewId}`, last-wins per view) — the vocabulary stays at 8
   * verbs. `values: null` clears the cell (the cleared-interval rule).
   */
  | { readonly verb: 'select'; readonly viewId: string; readonly fields: readonly [string, string]; readonly values: CellValues; readonly cause: Cause; readonly correlationId?: string; readonly offerId?: string }
  /** Layer 4: `offerId` names the offer (from whats_here.offers) an act answers; a stale one is refused by naming the current one. */
  | { readonly verb: 'filter'; readonly viewId: string; readonly field: string; readonly range: FilterRange; readonly cause: Cause; readonly correlationId?: string; readonly offerId?: string }
  | { readonly verb: 'annotate'; readonly target: string; readonly note: string; readonly cause: Cause }
  /**
   * Layer 4 `link`: edit ONE edge of the link graph — what `target` does with
   * `source`'s `kind` emission. Validated like a declared edge (a refusal in a
   * sentence); folds last-wins per edge id; `response: null` un-declares the
   * edit so the def's rule shows through again.
   */
  | {
      readonly verb: 'link';
      readonly source: string;
      readonly kind: LinkKind;
      readonly target: string;
      readonly response: LinkResponse | null;
      readonly mapping?: readonly FieldMapping[];
      /** Encoding edges only: which channels follow (absent = every channel both ends share, written out at materialization). */
      readonly channels?: readonly ChannelPair[];
      readonly onClear?: LinkOnClear;
      /** How the emission folds down to the target's rows — required when the edge crosses grains. */
      readonly fold?: string;
      readonly cause: Cause;
      readonly correlationId?: string;
    }
  | {
      /** The prose plane: set one of a view's words — title, caption, altShort, altLong, howToRead — as a record with an author; null = back to the def's own words. */
      readonly verb: 'describe';
      readonly viewId: string;
      readonly slot: ProseSlot;
      readonly record: ProseRecord | null;
      /** Propose the record for a person to accept instead of setting it — it lands in the slot's proposal lane, never as the live words. */
      readonly proposal?: boolean;
      /** Accept the open proposal with this commit id: its record lands on the slot with `author.acceptedFrom`. `record` is ignored. */
      readonly accept?: string;
      /** Decline the open proposal with this commit id, with a reason that stays on the record. `record` is ignored. */
      readonly decline?: { readonly proposal: string; readonly reason: string };
      readonly cause: Cause;
      readonly correlationId?: string;
    }
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
  | { readonly verb: 'reencode'; readonly viewId: string; readonly channel: string; readonly field: string; readonly cause: Cause; readonly correlationId?: string }
  /** Encoding plane: several channels in ONE act — a swap is `{ x: <the y field>, y: <the x field> }` — judged as a whole, landed as one commit. */
  | { readonly verb: 'reencode'; readonly viewId: string; readonly bindings: Readonly<Record<string, string>>; readonly cause: Cause; readonly correlationId?: string };

/**
 * A checkpoint as the wire has always carried it — now a VIEW of a tag (see
 * `Tag`): `label` is the tag's name, `commitId` and `at` are both the tagged
 * commit (the moment), `ts` its position in the log. A legacy beat commit from
 * an older log reads the same way (its `at` = the position it named). Present
 * mode orders and seeks by `at`.
 */
export interface Checkpoint {
  readonly label: string;
  /** The tagged commit (a legacy beat: the beat commit itself). */
  readonly commitId: string | null;
  /** The moment the tag names — the tagged commit (a legacy beat: its parent). */
  readonly at: string | null;
  /** The named commit's index in the log (ordering). */
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
      readonly reencoded?: { readonly viewId: string; readonly channel: string; readonly field: string } | { readonly viewId: string; readonly bindings: Readonly<Record<string, string>> };
      /** Encoding plane: the binding did not fit as asked and a named coercer took it — the sentence says what changed. Absent when nothing was coerced. */
      readonly coerced?: readonly EncodingProblem[];
      /** Layer 4: the edge as it now stands (an edited edge, or the base edge after an un-declare). */
      readonly linked?: LinkEdge;
      /** The prose plane: the slot as it now stands at the cursor (null after a back-to-the-def that leaves no declared words). */
      readonly described?: ProseStatus | null;
      /** The prose plane: the proposal as it now stands (after a propose, an accept, or a decline). */
      readonly proposed?: ProposalStatus;
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
  /** Layer 4 offers: require every select/filter to name a current offerId from whats_here (default false: an offer is accepted, not yet enforced). */
  readonly requireOffer?: boolean;
  /** Override the runtime default table. Must be a declared table. */
  readonly defaultTable?: string;
}

export interface ViewInfo {
  readonly viewId: string;
  readonly actor: Actor;
  readonly label?: string;
  /** Layer 4: what acting on this view DOES, in one sentence — the routing text a phrase is matched against (`actors[viewId].does`). */
  readonly does?: string;
  /**
   * Which point/interval/cell SELECTION kinds this view can emit (R3
   * capability — renamed from the old `encodings` to free that name for the
   * visual-channel sense below; nothing shipped ever read the old name off
   * `Overview`).
   */
  readonly selectionKinds: readonly ('point' | 'interval' | 'cell' | 'match')[];
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
  /**
   * The encoding plane (src/encoding): per channel, every column judged as if
   * bound there now — fitting ones first, refused ones with their sentence.
   * Present only for a view with a declared encoding surface.
   */
  readonly fits?: Readonly<Record<string, readonly Fit[]>>;
  /**
   * What the view SHOWS (encoding links): its own bindings with followed
   * channels laid over them, one hop, each judged by this view's own rules.
   * Present only for a view with an encoding surface. Hosts render this and
   * edit `encodings`.
   */
  readonly effective?: EffectiveEncoding;
  /** The prose plane: every slot the view carries at the cursor, each with its staleness judged against what is on screen. */
  readonly prose: readonly ProseStatus[];
  /** The prose plane: the proposals on the table for this view at the cursor, one per slot (the latest), with their derived status. */
  readonly proposals: readonly ProposalStatus[];
}

/** A view's effective bindings under the link graph (see src/links/README.md, the encoding kind). */
export interface EffectiveEncoding {
  /** The bindings on screen: own, overlaid by every followed channel that passed this view's rules. */
  readonly bindings: Readonly<Record<string, string>>;
  /** channel → the edge it follows, the source view, and the source channel it reads. */
  readonly followed: Readonly<Record<string, { readonly edge: string; readonly from: string; readonly sourceChannel: string }>>;
  /** channel → a follow this view's own rules refused (the view keeps its own binding; the sentence says why). */
  readonly refused: Readonly<Record<string, { readonly edge: string; readonly field: string; readonly sentence: string }>>;
}

/** An active DATA-space selection (never pixels; R5). */
export interface SelectionInfo {
  readonly viewId: string;
  /** For kind:'cell' this is the display-only joint label; the pair rides `fields` (D30). */
  readonly field: string;
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
  /** For kind:'cell': the two-sided pair `[x side, y side]`; for kind:'match': the `MatchValue` (values + polarity). */
  readonly value: unknown;
  /** kind:'cell' only — the two selected fields, x side then y side. */
  readonly fields?: readonly [string, string];
  /** The commit that landed this selection (a live selection only) — what a note, a bring-over or a saved selection names. */
  readonly commitId?: string;
}

/** Layer 4, the OFFER: one (view, emission kind) an act can reach from the current position, with the id the act door checks. */
export interface Offer {
  readonly offerId: string;
  readonly viewId: string;
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
}

/** A view whose last selection was CLEARED, and what it was — read by a target edge's `onClear` policy (layer 4). */
export interface ClearedSelectionInfo extends SelectionInfo {
  /** The commit that cleared it. */
  readonly clearedBy: string;
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
export type { ColumnFacet } from '../data/types.js';

/** One note on the dashboard: words with an author and refs, addressed `note:<id>` in the prose plane. */
export interface NoteInfo {
  readonly id: string;
  readonly prose: readonly ProseStatus[];
  readonly proposals: readonly ProposalStatus[];
}

/** One declared table as the def states it (see `Overview.tables`). Nothing here is inferred from the rows. */
/** What tagging (or renaming, forgetting) came back with. */
export type TagResult = { readonly ok: true; readonly tag: Tag } | { readonly ok: false; readonly rejected: string };

// ── Saved selections: saved LOGIC beside the log (see SavedSelection in def/types). ──

/** What to save: every live clause (the whole picture), one view's live clause, or explicit conditions. */
export type SaveSelectionSource = { readonly live: 'all' } | { readonly viewId: string } | { readonly conditions: readonly SavedClause[] };

export type SaveSelectionResult = { readonly ok: true; readonly saved: SavedSelection } | { readonly ok: false; readonly rejected: string };

/** How a saved selection lands: `replace` (the default) clears the other live filters first — the picture comes back; `layer` adds its conditions to what is selected now. */
export interface ApplySavedOptions {
  readonly mode?: 'replace' | 'layer';
  readonly as?: Actor;
}

/**
 * What applying did — honest per condition: the commits that landed (and the
 * clears a replace made), and every condition that could not land, with its
 * sentence (a view no longer on the dashboard, a field it no longer binds).
 * Never a silent partial apply.
 */
export type ApplySavedResult =
  | {
      readonly ok: true;
      readonly name: string;
      readonly correlationId: string;
      readonly applied: readonly CommitRecord[];
      readonly cleared: readonly CommitRecord[];
      readonly refused: readonly { readonly viewId: string; readonly rejected: string }[];
    }
  | { readonly ok: false; readonly rejected: string };

// ── The view-query port: the sheet's window on a table, judged by the same laws as a chart. ──

/** A live (or remembered-on-clear) clause that reaches a view through the link graph, with the response its edge carries. */
export interface ReachingClause {
  /** The view whose gesture this is. */
  readonly from: string;
  /** The clause as the consumer sees it — the edge's field mapping already applied. */
  readonly clause: PredicateClause;
  readonly response: LinkResponse;
}

/**
 * One window of rows: the table, whose eyes (a view: its own clause excluded,
 * link responses applied — or none: the whole-dashboard truth, every live
 * clause), which columns, in what order, and where the window starts.
 */
export interface ViewQuery {
  /** Default: the dashboard's default table. */
  readonly table?: string;
  /** The consumer. Absent = every live clause filters (what `Overview.selectedRowCount` counts). */
  readonly viewId?: string;
  /** Default: the columns visible at the cursor. A declared row key is always projected — identity rides every window. */
  readonly columns?: readonly string[];
  readonly sort?: readonly SortSpec[];
  /** Default `VIEW_QUERY_DEFAULT_LIMIT` — a window is a window; ask for a larger one explicitly. */
  readonly limit?: number;
  /** Default 0. Past the last match answers no rows and the honest count. */
  readonly offset?: number;
}

/** Why a window was refused — a code to branch on beside the sentence. `engine` carries the provider's own reason. */
export type ViewQueryRefusal = 'unknown-table' | 'unknown-view' | 'unsupported-sort' | 'no-columns' | 'version-moved' | 'engine';

export type ViewQueryResult =
  | {
      readonly ok: true;
      /** The columns each row carries, in order — the projection asked for, plus the declared key when it was left out. */
      readonly columns: readonly string[];
      readonly rows: readonly Row[];
      /** Parallel to `rows`: the declared key's value, or `<version>#<source index>` on a positional table. */
      readonly rowIds: readonly string[];
      /** True when the table declares no row key — a row id is then a within-version position, never an identity across refreshes. */
      readonly positional: boolean;
      /** The declared row key's column, when the table has one — the column a grid freezes and a row click selects on. Absent on a positional table. */
      readonly key?: string;
      readonly count: number;
      readonly start: number;
      /** The table's data version the window was read at (null for an inline table that has none) — read beside the rows, and re-checked after them. */
      readonly version: string | null;
      /** The cursor commit the window was read at — a late answer can be dropped when the cursor has moved on. */
      readonly cursor: string | null;
      /** Every clause that reached the consumer, with its response — only `filter` ones restricted the rows. Clauses are ANDed: the sheet is intersect-only. */
      readonly clauses: readonly ReachingClause[];
    }
  | { readonly ok: false; readonly reason: ViewQueryRefusal; readonly engineReason?: string; readonly rejected: string };

export interface TableInfo {
  readonly name: string;
  /** Where the rows come from: a declared source (`format · via · at`, the locator only when it is a string), or inline rows / CSV text carried by the def. */
  readonly source: { readonly format: string; readonly via: string; readonly at?: string } | { readonly inline: 'rows' | 'csv'; readonly rows?: number };
  /** The engine the table routed to. */
  readonly engine: Engine;
  /** The declared row key, when the def states one — without it a refresh replaces the table and no row is addressable. */
  readonly key?: string;
  readonly grain?: SeriesGrain;
  /** The absence column and the vocabulary it speaks, when declared. */
  readonly absence?: { readonly field: string; readonly states: readonly string[] };
  /** How many columns the def declares facets for (the engine may list more). */
  readonly declaredColumns: number;
}

/** The structured payload `whats_here` projects. All app content lives in DATA fields. */
export interface Overview {
  readonly defaultTable: string;
  readonly views: readonly ViewInfo[];
  /**
   * The prose plane's one non-view subject: the DASHBOARD's own words at the
   * cursor (`describe` with viewId `'dashboard'`) — its `caption` is the
   * summary of what the whole cockpit shows now, judged stale on its basis
   * like any view's slot; `proposals` = the drafts on the table for it.
   */
  readonly dashboard: { readonly prose: readonly ProseStatus[]; readonly proposals: readonly ProposalStatus[] };
  /** The notes on the dashboard (the Text tool): every `note:<id>` subject with words at the cursor, oldest first. */
  readonly notes: readonly NoteInfo[];
  /** The saved selections — saved logic beside the log, oldest first (legacy log-derived ones included unless forgotten). */
  readonly saved: readonly SavedSelection[];
  /** The tags — names on moments beside the log, oldest first (legacy beat commits included unless forgotten). */
  readonly tags: readonly Tag[];
  readonly activeSelections: readonly SelectionInfo[];
  /**
   * The live selections in the SHAPE a prose basis states them: viewId → clause, `{}` for none — byte-equal to what
   * `basis.filters` is judged against, so an agent copies it verbatim into a record (`activeSelections` is the same
   * fact as a list, for reading).
   */
  readonly filters: Readonly<Record<string, unknown>>;
  /** Layer 4 `onClear`: views whose selection was cleared and what it was, so an edge that says `leave` or `excludeAll` can act. */
  readonly clearedSelections: readonly ClearedSelectionInfo[];
  /** Layer 4 offers: every (view, kind) of the dashboard, each stamped with the current position — the id a select/filter may name (a stale one is refused by naming the current one). */
  readonly offers: readonly Offer[];
  /** Provenance: what each declared source vouched for when it was read (version, retrieval time, row count) — absent for a table declared inline as rows/csv. */
  readonly sources: Readonly<Record<string, SourceInfo>>;
  /** How many rows of the default table the live selection keeps — counted by the engine in one query, no row materialised; `null` when the engine could not answer (never a fake 0). */
  readonly selectedRowCount: number | null;
  /** The declared row key per table — with one a refresh's delta is exact; without, a refreshed table is replaced. */
  readonly keys: Readonly<Record<string, string>>;
  /**
   * Every declared table as the def states it — the Sources tab's rows: where the rows come from, the engine
   * they route to, the row key, the grain, the absence vocabulary, and how many columns the def declares.
   * Provenance (version, retrieved at, rows read) rides `sources` for the tables that declared a source.
   */
  readonly tables: readonly TableInfo[];
  /** The data journal's latest records (the newest 50, oldest first — a dashboard-level record, never a commit); `dashboard.journal()` holds every one. */
  readonly journal: readonly RefreshRecord[];
  /** How many records the journal holds in all — when it exceeds `journal.length`, an answer may lie beyond the tail. */
  readonly journalTotal: number;
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
  /** viewId → the bindings on screen under the link graph (`views[].effective.bindings`, flattened). Render these; edit `encodings`. */
  readonly effectiveEncodings: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * LY-1: scope → prop → value — the cockpit-layout fold (`navigate` verb,
   * `layout:${scope}` synthetic identity), branch-scoped at the cursor exactly
   * like `encodings`. Empty until a layout note lands; seeking the cursor back
   * in time restores the OLD arrangement. Values are plain inert strings
   * (e.g. `{ dashboard: { preset: 'focus', focus: 'scatter' } }`).
   */
  readonly layouts: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The encoding plane's rules as sentences — the built-in law first, then the def's in declared order. */
  readonly rules: readonly RuleLine[];
  /** What happens to an act that breaks an encoding rule, and how far a two-column rule reaches. */
  readonly encodingPolicy: { readonly onInvalid: string; readonly ruleScope: RuleScope };
  readonly gaps: number;
  readonly currentView: string | null;
  readonly engines: Readonly<Record<string, string>>;
  /** Time-travel position: cursor vs active head, branch/checkpoint counts, cursor-local test count (Phase A). */
  readonly time: TimeState;
  /** Named paths (BR-1): the refs, where HEAD is, and the ref-event journal. */
  readonly paths: PathsState;
  /** RP-3: the agent-authored charts registered this session + their ledger status. */
  readonly charts: readonly ChartInfo[];
  /** Layer 4: the materialized link graph — what each view's emission does to every other view (src/links). */
  readonly links: LinkGraph;
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
