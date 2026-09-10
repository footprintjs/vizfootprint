/**
 * L5 — session (`vizfootprint/agent`, the live half) · shared types.
 *
 * An {@link InteractionSession} is the container that wires ALL layers together:
 * one selection port (`src/selection`; the built-in unless
 * `SessionOptions.selection` hands in `mosaicSelection()`) + branch-capable
 * commit log (L1), the source registry + cause-clauses (L2), the data providers (D24), the declared
 * analyses (L3), and the online-FDR stepper (L4). `dispatch(action, {as})` is
 * THE single semantic entry point (R4) — the agent never synthesizes a raw
 * input event; there is no such path.
 */

import type { SourceInfo } from '../source/types.js';
import type { Actor, Cause } from '../cause/index.js';
import type { EmissionKind, FieldMapping, LinkEdge, LinkGraph, LinkOnClear, LinkResponse, LinkKind, ChannelPair } from '../links/types.js';
import type { CommitRecord } from '../log/index.js';
import type { CauseClause, SelectionPort } from '../selection/index.js';
import type { AnalysisKind, AnalysisOutput, AnalysisResult } from '../analysis/index.js';
import type { FdrStep, HypothesisRecord } from '../fdr/index.js';
import type { CellClause, ColumnFacet, ColumnType, Engine, IntervalClause, PredicateClause, Row, SortSpec, WalkAsk } from '../data/index.js';
import type { EncodingProblem, Fit, RuleLine, RuleScope } from '../encoding/index.js';
import type { ProseRecord, ProseSlot, ProseStatus, ProposalStatus } from '../prose/index.js';
import type { ChannelResolution, DispatchVerb, IntentClass, SeriesGrain, SavedClause, SavedSelection, Bookmark, RelationEdge } from '../def/types.js';
import type { RefreshRecord } from '../def/buildDashboard.js';
import type { DiffChange, DiffOnly, PlanRecipe, RefEvent } from '../branches/index.js';

// ── The gap ledger (D14 taxonomy) — every unmet request, typed, never dropped. ─

/**
 * The D14 gap taxonomy codes, as DATA — so the one place that has to enumerate
 * them at runtime (`GapLedger.byCode`) reads this list rather than repeating
 * it. It repeated it once, and drifted: `stale-offer` was added to the type and
 * not to the histogram, which then counted it as `undefined + 1` = `NaN`.
 *
 * The `chart-*` codes (RP-3) are the four governed `proposeChart` pipeline
 * refusals — each a stage of schema-valid → capability-check → hypothesis,
 * landed instead of a silent drop so the agent reads the reason back and
 * repairs.
 */
export const GAP_CODES = [
  'needs-column',
  'needs-analysis-kind',
  'needs-view',
  'guard-failed',
  'needs-backend-data',
  // ── layer 4 offers: an act named an offer that is not the current one for its node (or none, where one is required) ──
  'stale-offer',
  /**
   * An OUTBOUND effect of an act that already happened failed — a mounted
   * adapter's `applyClause` threw, the live selection's listeners threw, a
   * provider THREW while writing a materialized column back (a provider that
   * refuses in the ordinary way is still `needs-backend-data`). The act STANDS: its
   * commit is on the trace and the session's own state agrees with it. This
   * code is the honest record that the world outside the session did not keep
   * up. See src/session/README.md, "an act either fully happens or does not".
   */
  'effect-failed',
  /**
   * A DECLARED COLUMN that is not a legal column at all (`../derive/`): an op
   * the grammar does not have, an op given the wrong arguments, a column the
   * table does not hold, a column whose type nobody can name — or a name the
   * base store already holds (`cases is a source column`).
   *
   * It is its own code and not `guard-failed` because an agent has to be able
   * to branch on one: a declaration it can repair by editing the tree is a
   * different answer from one it can repair only by opening the source.
   */
  'derive-invalid',
  /**
   * A DECLARED COLUMN whose rows could not be read — the table refused, was
   * never opened, or could not say which columns are its own.
   *
   * Its sibling above is about the DECLARATION; this one is about the ground it
   * stands on, and nothing about the tree will fix it. A column is not computed
   * over rows the source refused: half a table is not a table, and a column
   * derived from half of one would look exactly like a column derived from all
   * of it.
   */
  'derive-source-refused',
  /**
   * An act was legal and its ANSWER is too big to record — a walk whose set
   * holds more nodes than a commit may carry (`NEIGHBOURHOOD_ID_CEILING`,
   * `./neighbourhood.ts`). Nothing lands.
   *
   * It is its own code and not `guard-failed` because an agent has to be able
   * to branch on one: nothing about the declaration is wrong, so re-reading
   * the capabilities will never repair it — the repair is to make the DATA
   * smaller (filter the edges first) or to ask a smaller question. The same
   * argument that gives `derive-invalid` a code of its own.
   */
  'result-too-large',
  /**
   * A view's TABLE IS NOT HERE YET: it is one a declared act mints (an
   * aggregate's landed table), and that act has not landed on this path.
   *
   * The act named in the detail is the repair, which is the whole reason this
   * is not `guard-failed`: nothing about the view's capability is wrong and
   * re-reading it will never fix this, so an agent that could only see
   * `guard-failed` would go looking in the definition for a refusal the
   * definition does not hold. It is per CURSOR — the same probe lands after the
   * act and is refused again after a seek back past it. The same argument that
   * gives `derive-invalid` and `result-too-large` codes of their own.
   */
  'needs-act',
  // ── RP-3: agent-authored chart pipeline refusals ──
  'chart-invalid-spec',
  'chart-transforms-not-owned',
  'chart-unsupported-composition',
  'chart-hypothesis-rejected',
] as const;

export type GapCode = (typeof GAP_CODES)[number];

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
  | 'adoptPath'
  /**
   * Replaying a whole log into a session ({@link InteractionSession.replay}).
   * A replay files gaps for the acts it could not re-perform — an analysis the
   * session does not declare, one that threw, one whose fit is degenerate on
   * this data — never for the records, which either all land or none do.
   */
  | 'replay'
  /**
   * Landing a commit itself, as opposed to any one verb: the op an
   * `effect-failed` gap carries when the live selection's own update threw
   * after the record was already on the trace. The verb is not known at that
   * depth (the log does not have one) — the gap's `target` names the COMMIT,
   * which identifies the act more exactly than a verb would.
   */
  | 'commit';

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
 * WHICH WALK a neighbourhood `select` asks for — the act's own slot, owned by
 * `../data/types.ts` beside the BODY it records ({@link NeighbourhoodValueBody}),
 * because the ask and the record are the same question either side of the walk.
 * Re-exported here so every act shape reads from one module.
 */
export type { WalkAsk };

/**
 * The cell-select value pair — single-sourced from `src/data`'s `CellClause`
 * (the seam that actually EVALUATES it), the `FilterRange` precedent exactly:
 * `[x side, y side]` where each side is an interval `[lo, hi]` (half-open
 * allowed, numeric or ISO-date-string bounds) or a point value; or `null` to
 * clear the whole cell.
 *
 * A side's own `null` is NOT a clear — it is IS NULL, the blanks in that column
 * (`CellSide`, `src/data/types.ts`): `values: [null, 'Formal']` selects the rows
 * whose x is blank AND whose category is Formal, and on ordinary data that is
 * zero rows with a live clause. A cell has no per-side clearing; only
 * `values: null` clears the whole cell.
 */
export type CellValues = CellClause['value'];

export type DispatchAction =
  /**
   * The POINT form of `select`: one value on one field. `value: null` CLEARS
   * it — the one spelling of cleared, shared with `range: null`,
   * `values: null` and a cell's `values: null`, because it is the only one
   * that survives JSON (`./README.md`, beside law 6). Every other kind says so
   * in its type; a point's slot is `unknown`, so the door says it instead — a
   * MISSING value is refused (`guard-failed`), never read as a clear.
   */
  | { readonly verb: 'select'; readonly viewId: string; readonly field: string; readonly value: unknown; readonly cause: Cause; readonly correlationId?: string; readonly asOf?: string }
  /**
   * The MATCH form of `select` (SET-1): one field, MANY values — the plural of
   * a point (shift-click adds one, a drag crosses a run). `exclude: true`
   * keeps everything BUT them. Same verb, same intent class, same fold key
   * (`selection:${viewId}`, last-wins per view); `values: null` clears (the
   * cleared-interval rule).
   */
  | { readonly verb: 'select'; readonly viewId: string; readonly field: string; readonly values: readonly unknown[] | null; readonly exclude?: boolean; readonly cause: Cause; readonly correlationId?: string; readonly asOf?: string }
  /**
   * The CELL form of `select` (D30): one heatmap-cell gesture selects on TWO
   * fields at once ("price 100–150 AND category Formal") and lands ONE
   * commit whose predicate is the AND of both sides — never two
   * correlationId-linked commits. Same verb, same intent class, same fold key
   * (`selection:${viewId}`, last-wins per view) — the vocabulary stays at 8
   * verbs. `values: null` clears the cell (the cleared-interval rule); a
   * `null` INSIDE the pair is IS NULL on that side, never a clear
   * ({@link CellValues}).
   */
  | { readonly verb: 'select'; readonly viewId: string; readonly fields: readonly [string, string]; readonly values: CellValues; readonly cause: Cause; readonly correlationId?: string; readonly asOf?: string }
  /**
   * The NEIGHBOURHOOD form of `select` (packet 5): ONE gesture on a node
   * selects the ties INSIDE the walked set. `field` names one ENDPOINT column
   * of the act's own table (the edges table — `source`), `seed` is the node
   * the walk starts from; the session reads the declared relations to find
   * the other endpoint, walks the edges ONCE at the cursor, and lands ONE
   * commit carrying the question (seed, derivation, hops, `to` for a path)
   * with its answer (the walked ids). `seed: null` clears it (the
   * cleared-interval rule); `seed` missing is refused, exactly as a point's
   * missing value is.
   *
   * WHY the act names an endpoint and not the node table: a clause names
   * columns of the table it is judged against, and this clause's predicate is
   * "both ends are in the set" over the EDGES table. The node table is
   * reached from there, through the relation the endpoint declares.
   */
  | {
      readonly verb: 'select';
      readonly viewId: string;
      readonly field: string;
      readonly seed: unknown;
      /** WHICH WALK to run from the seed ({@link WalkAsk}) — absent = one hop of ego, the walk that existed before the other two. */
      readonly walk?: WalkAsk;
      readonly cause: Cause;
      readonly correlationId?: string;
      readonly asOf?: string;
    }
  /** Layer 4: `asOf` names the offer (from whats_here.offers) an act answers; a stale one is refused by naming the current one. */
  | { readonly verb: 'filter'; readonly viewId: string; readonly field: string; readonly range: FilterRange; readonly cause: Cause; readonly correlationId?: string; readonly asOf?: string }
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
  /**
   * The prose plane, in three modes told apart by the key each mode REQUIRES —
   * never by a sibling key's presence. WHY three members and not one with
   * optional `accept`/`decline`: `record: null` is the live spelling of "back
   * to the def's own words", so one shape would let an accept whose key was
   * dropped type-check as a clear and LAND one.
   *
   * Set one of a view's words — title, caption, altShort, altLong, howToRead —
   * as a record with an author; `null` = back to the def's own words.
   * `proposal: true` lands the record in the slot's proposal lane for a person
   * to accept, never as the live words.
   */
  | { readonly verb: 'describe'; readonly viewId: string; readonly slot: ProseSlot; readonly record: ProseRecord | null; readonly proposal?: boolean; readonly cause: Cause; readonly correlationId?: string }
  /** Accept the open proposal with this commit id: its record lands on the slot with `author.acceptedFrom`. */
  | { readonly verb: 'describe'; readonly viewId: string; readonly slot: ProseSlot; readonly accept: string; readonly cause: Cause; readonly correlationId?: string }
  /** Decline the open proposal with this commit id, with a reason that stays on the record. */
  | { readonly verb: 'describe'; readonly viewId: string; readonly slot: ProseSlot; readonly decline: { readonly proposal: string; readonly reason: string }; readonly cause: Cause; readonly correlationId?: string }
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
  | {
      readonly verb: 'analyze';
      readonly analysisId: string;
      readonly input?: readonly Record<string, unknown>[];
      /**
       * Declare the analysis as part of the act, under `analysisId` — the
       * `declareAnalysis(id, def)` door as a dispatch. A record naming a
       * builtin is DATA, which is what lets a person add a formula column from
       * a screen without anybody writing TypeScript; a malformed one is
       * refused in the library's own sentence and lands nothing.
       */
      readonly def?: import('../def/types.js').AnalysisSlot;
      /** Which table to read / write into. Default: the session default table. */
      readonly table?: string;
      readonly cause: Cause;
      readonly correlationId?: string;
    }
  | { readonly verb: 'fork'; readonly fromCommitId: string; readonly cause: Cause }
  | { readonly verb: 'bookmark'; readonly label: string; readonly cause: Cause }
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
 * A bookmark as the WIRE carries it — a view of a {@link Bookmark} record:
 * `label` is the bookmark's name, `commitId` and `at` are both the bookmarked
 * commit (the moment), `ts` its position in the log. Never derived from the
 * log: the one producer is `bookmarkViews()`, over the session's own store.
 * Present mode orders and seeks by `at`.
 */
export interface BookmarkView {
  /** The bookmark's own id (`b1`, `b2`, …) — what a note's words link and what a badge keys on, so a rename moves nothing. */
  readonly id: string;
  readonly label: string;
  /** The bookmarked commit. */
  readonly commitId: string;
  /**
   * The moment the bookmark names — the same commit as `commitId`. A place in
   * the HISTORY: a commit id, never a time. The clock time is
   * {@link BookmarkView.madeAt}, and the two are named apart on purpose,
   * because the store spells this one `commitId` and calls the clock time `at`.
   */
  readonly at: string;
  /** The named commit's index in the log (ordering) — or `-1` when this log does not hold the named commit (a bookmark restored from another log). */
  readonly ts: number;
  /** Who made the bookmark — the CREATOR, exactly as the store holds it (a rename records `editedBy` instead, and never moves this). */
  readonly by: Actor;
  /**
   * When it was made, ISO — the store's own creation stamp (`Bookmark.at`),
   * carried under a name that cannot be read as the moment it NAMES. A rename
   * records `editedAt` beside it and never moves this, which is why a list
   * ordered by it does not reorder under a rename.
   */
  readonly madeAt: string;
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
  /** Number of named bookmarks. */
  readonly bookmarks: number;
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

/**
 * What {@link InteractionSession.replay} did: the whole log landed, the acts
 * that could be re-performed re-performed, and the fold at the tip.
 *
 * All-or-nothing on the RECORDS (a refusal lands none of them, and the session
 * is exactly as it was); honest per ACT about what a re-performance could not
 * rebuild. The counts are the short version of that; the gap ledger has the
 * sentences.
 */
export type ReplayResult =
  | {
      readonly ok: true;
      /** How many records landed. Every record handed in, or the call refused. */
      readonly landed: number;
      /**
       * How many analyses were RE-PERFORMED so their columns exist again. The
       * log records that an analysis ran; the column values it wrote live in
       * the provider store, which no log carries. An analysis that produced no
       * column — a statistic, a fit, a summary table — is never re-run: nothing
       * of it lives outside the log.
       */
      readonly reran: number;
      /** How many gaps this replay filed — one per act it could not re-perform. */
      readonly filed: number;
      /** The fold at the tip the replayed log ends on — detached, like every fold this library hands out. */
      readonly overview: Overview;
    }
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
  /**
   * The MOMENT the claim was made: the spec-registration commit's id. `charts`
   * is session-local and deliberately not branch-scoped (a proposal spends
   * ledger budget when it is made, so hiding it while the ledger goes on
   * charging for it would be the worse lie — see README.md, law 5). This is
   * what lets a reader tell a claim about NOW from one made somewhere else.
   */
  readonly commitId: string;
  /**
   * Is `commitId` on the branch path at the cursor? `false` means the chart was
   * proposed on a path you have since left — it is still listed, still
   * ledgered, and still costing alpha, but it is not a claim about what is on
   * screen. Disclose rather than conceal.
   */
  readonly onPath: boolean;
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
      readonly bookmark?: BookmarkView;
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
   * The mount-time twin of {@link CapabilityDecl.encodings}, and typed from
   * the same `EmissionKind` — as a literal union it had silently missed
   * `'match'` since SET-1, so an adapter could not declare the set voice its
   * own guard (`voiceOf`) already accepted.
   */
  readonly encodings?: readonly EmissionKind[];
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
  /**
   * The selection port every commit's clause is stood on — chosen by the host
   * that runs the engine, once, at session birth. Default: the built-in
   * (`builtinSelection()`); a Mosaic host hands in `mosaicSelection()` from
   * `vizfootprint/mosaic` and its live `Selection` sees every dispatched clause.
   */
  readonly selection?: SelectionPort;
  /** Layer 4 offers: require every select/filter to name a current asOf from whats_here (default false: an offer is accepted, not yet enforced). */
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
   * Which SELECTION kinds this view can emit (R3 capability — renamed from
   * the old `encodings` to free that name for the visual-channel sense below;
   * nothing shipped ever read the old name off `Overview`). Typed from
   * `EMISSION_KINDS` itself, so a new kind reaches this projection with the
   * voice that answers it.
   */
  readonly selectionKinds: readonly EmissionKind[];
  readonly canProbe: boolean;
  readonly mounted: boolean;
  /**
   * The current CHANNEL→field visual-encoding map at the cursor (the
   * `reencode` verb's fold; SPEC Q6 8th-verb). Empty if the view declares no
   * encoding surface. Seeking the cursor back in time restores the OLD map.
   */
  readonly encodings: Readonly<Record<string, string>>;
  /*
   * There is deliberately no per-view `columns` list here. It used to carry the
   * columns available to encode onto — and it was the same ARRAY REFERENCE as
   * `Overview.columns[defaultTable]`, written once at a single site with no
   * per-view branch, because a view has no table of its own (`ViewDecl`
   * declares none). Repeated across N views it was the largest single item in
   * the answer — half of `views`, ~38% of the whole payload on a large
   * dashboard — restating one fact the same answer already carries at a
   * twentieth of the cost. Two surfaces answer "what can I put on x?" better:
   * `Overview.columns[defaultTable]` (what exists) and this view's own
   * `accepts` (what actually FITS each channel, judged, with the sentence for
   * every refusal). If a view ever gains a table of its own, or a per-view
   * subset, the list becomes information rather than repetition and belongs
   * back here — carrying the DIFFERENCE from the table's list, not a copy.
   */
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
  /**
   * The view's layers, when it draws more than one table on one frame (a
   * node-link: edges under nodes). Projected from the MAP — the declared
   * facts, nothing judged; an act on a layer names it by the address
   * `viewId~layerId` (`vizfootprint/def`'s `layerAddress`), and is gated on
   * the layer's table. Absent on a view that declares none.
   */
  readonly layers?: readonly LayerInfo[];
  /**
   * THE FRAME: per channel, how its scale is resolved across those layers —
   * the DECLARATION (`ViewEncodingDecl.frame`), projected verbatim, in which no
   * number can be typed. A host folds it into actual domains with
   * `frameDomains` at every update, over rows it reads through one door.
   * Absent on a view that declares none (and on every plain view).
   */
  readonly frame?: Readonly<Record<string, ChannelResolution>>;
}

/** One layer of a view as the overview projects it: its address parts, its table and its encoding surface. */
export interface LayerInfo {
  readonly layerId: string;
  /** The table the layer reads — what a select on `viewId~layerId` is judged against. */
  readonly table: string;
  readonly chartKind: string;
  readonly channels: readonly string[];
  readonly label?: string;
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
  /** For the two-column kinds — 'cell' and 'neighbourhood' — this is the display-only joint label; the pair rides `fields`. */
  readonly field: string;
  readonly kind: EmissionKind;
  /**
   * For kind:'cell': the two-sided pair `[x side, y side]`; for kind:'match':
   * the `MatchValue` (values + polarity); for kind:'neighbourhood': the walked
   * ids — the ANSWER a live clause carries. The QUESTION that produced them
   * (seed, derivation, hops, and a path's `to`) rides the COMMIT, which
   * `commitId` names.
   */
  readonly value: unknown;
  /** The two-column kinds only — a cell's x side then y side, a neighbourhood's two endpoint columns. */
  readonly fields?: readonly [string, string];
  /** The commit that landed this selection (a live selection only) — what a note, a bring-over or a saved selection names. */
  readonly commitId?: string;
}

/**
 * Layer 4, the OFFER: one (view, emission kind) an act can reach. A voice is
 * DECLARED, so this list does not move with the cursor — the position it is
 * good at rides once, on `Overview.asOf`, and that is the id the act door
 * checks.
 */
export interface Offer {
  readonly viewId: string;
  readonly kind: EmissionKind;
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

/** What bookmarking (or renaming, forgetting) came back with. */
export type BookmarkResult = { readonly ok: true; readonly bookmark: Bookmark } | { readonly ok: false; readonly rejected: string };

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
  /**
   * Present exactly when the clause REACHED this consumer and the table it
   * reads could not judge it: the column that table lacks, and the sentence
   * saying so (`unjudgeableWords`). Such a clause filtered NOTHING — it is
   * still listed, because omitting a clause silently would make the read look
   * like a clause nobody sent (law 3: omit, never deny). Absent = it was
   * judged, which is every clause on a table that carries its columns.
   */
  readonly narrowed?: {
    readonly column: string;
    readonly reason: string;
  };
  /**
   * The edge's mapping entries that actually RENAMED one of this clause's
   * fields (`from !== to`) — the author naming a landing column, as opposed to
   * a field that reached unchanged (the crossfilter default, or an identity
   * pair). Read by the view-query door alone: when `narrowed.column` is one of
   * these `to` names, the miss is an AIM that missed — an author error, not a
   * coincidence to omit quietly — and the door refuses the read by name
   * instead of narrowing it away (`unjudgeableColumn`'s narrowing stays the
   * law for every clause that arrived unaimed). Absent = no mapping touched
   * this clause's fields.
   */
  readonly mappedFields?: readonly FieldMapping[];
}

/**
 * One window of rows: the table, whose eyes (a view: its own clause excluded,
 * link responses applied — or none: the whole-dashboard truth, every live
 * clause), which columns, in what order, and where the window starts.
 */
export interface ViewQuery {
  /**
   * Default: the dashboard's default table — or, when `viewId` is a LAYER
   * address, that layer's own table. A `table` that disagrees with the layer's
   * is refused (`table-mismatch`), never silently served: the address is
   * resolved in one place, and one place only.
   */
  readonly table?: string;
  /**
   * WHOSE EYES. A viewId = what reaches that consumer through the link graph.
   * Absent = every live clause filters (what `Overview.selectedRowCount`
   * counts — the whole-dashboard truth). `null` = **no clause at all**: the
   * table as it stands at the cursor, which is the window an axis is FIXED to
   * (`ChannelResolution.basis: 'table'` — a filter elsewhere repaints the
   * marks and leaves the axis where it was).
   *
   * Three states, three meanings, exactly like a `PointClause.value` (a value,
   * `null`, absent) — and for the same reason: "nobody's clause" and "everybody's
   * clause" are two different questions, and neither is the other's default.
   *
   * The third state is THIS query's alone. A `FindQuery` takes a viewId or none
   * (a find moves where a person stands inside a window; there is no window to
   * fix), and neither does the sheet's `SheetWindowRequest`, which is what the
   * HTTP door serialises — so no `null` can reach a wire as the string
   * `"null"`. The frame door that needs it is in-process.
   */
  readonly viewId?: string | null;
  /** Default: the columns visible at the cursor. A declared row key is always projected — identity rides every window. */
  readonly columns?: readonly string[];
  readonly sort?: readonly SortSpec[];
  /** Default `VIEW_QUERY_DEFAULT_LIMIT` — a window is a window; ask for a larger one explicitly. */
  readonly limit?: number;
  /** Default 0. Past the last match answers no rows and the honest count. */
  readonly offset?: number;
}

/** Why a window was refused — a code to branch on beside the sentence. `engine` carries the provider's own reason. */
export type ViewQueryRefusal = 'unknown-table' | 'unknown-view' | 'table-mismatch' | 'unsupported-sort' | 'no-columns' | 'version-moved' | 'engine';

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

// ── The find port: where the next match is, in the order this view is in. ──

/**
 * A find is a READ, and the narrowest one there is: it moves where a person
 * STANDS in one fixed order — exactly as a scroll does — and nothing lands on
 * the log. It never filters: the rows on screen are the same rows before and
 * after, which is what makes it safe to press repeatedly. An AGENT that wants
 * fewer rows filters (`dispatch`), and that is an act with a cause; a person
 * looking for a cell wants their table left alone.
 *
 * WHOSE EYES is the same question `ViewQuery` asks, answered by the same code:
 * the two compose the reaching clauses through ONE helper, so a find can never
 * see a row the window would have hidden.
 */
export interface FindQuery {
  /** Default: the dashboard's default table — or, for a LAYER address, that layer's own table. A `table` that disagrees is refused (`table-mismatch`), exactly as in `ViewQuery`. */
  readonly table?: string;
  /** The consumer. Absent = every live clause filters — the same "whose eyes" `ViewQuery` means by it, minus its `null`: a find has no window to fix, it moves where a person stands inside one. */
  readonly viewId?: string;
  /**
   * The order the positions are counted in. Pass the SAME sort the window was
   * read with: a position is only the offset of a row if both agree about what
   * order the rows are in.
   */
  readonly sort?: readonly SortSpec[];
  /**
   * Which columns to look in. Default: the TEXT columns of the projection at
   * the cursor — a person typing letters means the columns that hold letters. A
   * host may name others (a number column is searched as its digits); a column
   * whose type the tally never settled (`unknown`) is NOT searched by default,
   * so it has to be named. No text column to look in at all is refused
   * (`no-columns`) rather than silently searching everything.
   */
  readonly columns?: readonly string[];
  /** What a person typed. Empty once trimmed is refused by the engine (`bad-find`). */
  readonly text: string;
  /** The view position to search FROM, inclusive. */
  readonly from: number;
  /** `'forward'` = the first match at or after `from`; `'backward'` = the last match at or before it. Neither direction WRAPS — the caller decides to ask again from the other end, and can say so. */
  readonly direction: 'forward' | 'backward';
}

/**
 * Where the next match is: the position to stand at, the row's identity, and
 * how many matches the whole view holds.
 *
 * `position: null` with `matches > 0` is the honest end of a walk — there is no
 * match that way, and there are still matches the other way. Nothing here is a
 * row: a find says WHERE to look, and the window says what is there.
 */
export type FindInViewResult =
  | {
      readonly ok: true;
      /** The view position of the match, or `null` when there is none in that direction. */
      readonly position: number | null;
      /** The found row's identity — the declared key's value, or `<version>#<source index>` on a positional table. Absent exactly when `position` is null. */
      readonly rowId?: string;
      /** 1-based among the matches, in view order — "match 3 of 12" is this and `matches`. Absent exactly when `position` is null. */
      readonly ordinal?: number;
      /** How many rows in the whole view hold the text. */
      readonly matches: number;
      /** The table's data version the find was answered at — read beside the answer and re-checked after it, the same law `ViewQueryResult` keeps. */
      readonly version: string | null;
      /** The cursor commit the find was answered at — a late answer can be dropped when the cursor has moved on. */
      readonly cursor: string | null;
    }
  | {
      readonly ok: false;
      /** Every refusal a window has, plus the one only a find has: an engine that cannot answer where the next match is. */
      readonly reason: ViewQueryRefusal | 'unsupported-find';
      readonly engineReason?: string;
      readonly rejected: string;
    };

/** One declared table as the def states it (see `Overview.tables`). Nothing here is inferred from the rows. */
export interface TableInfo {
  readonly name: string;
  /**
   * Where the rows come from: a declared source (`format · via · at`, the
   * locator only when it is a string), inline rows / CSV text carried by the
   * def, or COMPUTED — an act cut them, and no carrier holds them. The third
   * arm is not an inline table said differently: nothing can refresh it, and
   * `derived` below says which act to ask instead.
   */
  readonly source: { readonly format: string; readonly via: string; readonly at?: string } | { readonly inline: 'rows' | 'csv'; readonly rows?: number } | { readonly computed: 'aggregate' };
  /** The engine the table routed to. */
  readonly engine: Engine;
  /** The declared row key, when the def states one — without it a refresh replaces the table and no row is addressable. */
  readonly key?: string;
  readonly grain?: SeriesGrain;
  /**
   * The state columns and the vocabulary each of them speaks, when the table
   * declares any — a LIST, in declaration order, because silence belongs to a
   * column and not to the row (`../data/silence.ts`). A `measurements` table
   * whose radius was measured, whose mass is a published bound and whose period
   * was never taken lists three, and the Sources tab shows all three: a tab
   * that showed the first would be telling a reader that one column speaks for
   * the row, which is the thing that is not true.
   */
  readonly absence?: readonly { readonly field: string; readonly states: readonly string[] }[];
  /** How many columns the def declares facets for (the engine may list more) — for a derived table, how many the ACT lands. */
  readonly declaredColumns: number;
  /**
   * The act that cut this table, when an act did: the parent it was cut from,
   * the group columns, the measure NAMES in the order they land as columns,
   * and the commit that made it.
   *
   * Names and words, never values — the rows are read through `viewQuery` like
   * any table's. The measure TREES stay on the commit: this is the Sources row,
   * and a reader asking what a measure computes is asking the act, not the map.
   */
  readonly derived?: {
    readonly of: string;
    readonly groupBy: readonly string[];
    readonly measures: readonly string[];
    readonly at: string;
  };
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
  /** The saved selections — saved logic beside the log, oldest first (the session's own store, never derived from the log). */
  readonly saved: readonly SavedSelection[];
  /** The bookmarks — names on moments beside the log, oldest first (the session's own store, never derived from the log). */
  readonly bookmarks: readonly Bookmark[];
  readonly activeSelections: readonly SelectionInfo[];
  /**
   * The live selections in the SHAPE a prose basis states them: viewId → clause, `{}` for none — byte-equal to what
   * `basis.filters` is judged against, so an agent copies it verbatim into a record (`activeSelections` is the same
   * fact as a list, for reading).
   */
  readonly filters: Readonly<Record<string, unknown>>;
  /** Layer 4 `onClear`: views whose selection was cleared and what it was, so an edge that says `leave` or `excludeAll` can act. */
  readonly clearedSelections: readonly ClearedSelectionInfo[];
  /** Layer 4 offers: every (view, kind) of the dashboard — declared voices, so this list does not move with the cursor. */
  readonly offers: readonly Offer[];
  /**
   * Layer 4 offers: the POSITION every offer above is good at, stated ONCE —
   * the id a select/filter passes back as `asOf`. A stale one (the position
   * moved since this answer) is refused by naming the current one. It is one
   * field rather than a stamp on each offer because the act already names its
   * own view and kind: repeating the node in N ids said nothing extra and made
   * `offers` the largest churning item in the answer.
   */
  readonly asOf: string;
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
  /** The declared relations between tables (a column → another table's key), as the runtime resolved them — the MAP's edges, echoed and never re-derived; `[]` when none. */
  readonly relations: readonly RelationEdge[];
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
  /** Time-travel position: cursor vs active head, branch/bookmark counts, cursor-local test count (Phase A). */
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
