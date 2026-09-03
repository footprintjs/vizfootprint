/**
 * InteractionSession — the live container that wires ALL layers together and
 * exposes `dispatch(action, {as})` as THE single semantic entry point (R4).
 *
 * Layer wiring:
 *  - L1 (log)      : one `CauseSelectionSession` — the append-only branch-capable
 *                    commit log + live Mosaic `Selection` + source registry.
 *  - L2 (mosaic)   : cause-tagged clauses, built by `log.commit` (never here).
 *  - data (D24)    : one `DataProvider` per table; predicate evaluation +
 *                    `materializeColumn` (R11's landing spot).
 *  - L3 (analysis) : declared analyses, run via `defineAnalysis`.
 *  - L4 (fdr)      : one online-FDR stepper, stepped once per declared test.
 *
 * R# served here:
 *  - R4  every interaction rides `dispatch` — there is NO raw-input path.
 *  - R1  the cause's `computedBy` is FORCED to 'system' on every analysis
 *        (never caller-supplied); `dispatch` re-validates every cause (R12 gate).
 *  - R6  a `select`/`filter` is never a test — only a declared `analyze` lands a
 *        `pValue` commit and steps the stepper.
 *  - R11 an analysis output re-enters the data space with ZERO new verbs
 *        (a materialized `cluster_id` filters through an ordinary `select`).
 *  - R14 every unhonorable request is a TYPED gap (D14 taxonomy), never dropped.
 */

import { restoreSavedInto, restoreBookmarksInto } from '../def/buildDashboard.js';
import { COMMIT_ID_PREFIX, PICTURE_ID_PREFIX, BOOKMARK_ID_PREFIX, mintRecordId } from '../def/recordIds.js';
import type { FoldEntry } from '../branches/index.js';
import type { EmissionKind, LinkEdge } from '../links/index.js';
import { voiceOf } from '../links/index.js';
import type { Actor, Cause } from '../cause/index.js';
import { validateCause } from '../cause/index.js';
import { CauseSelectionSession } from '../log/index.js';
import type { CommitRecord } from '../log/index.js';
import { TEST_ANALOG_FIELD, type FdrStep, type HypothesisRecord } from '../fdr/index.js';
import { gateChartSpec } from '../renderer/index.js';
import { cellFieldLabel, isRejection, type CellClause, type ColumnInfo, type MatchValue, type PredicateClause, type Row } from '../data/index.js';
import { isClearedSelection } from '../branches/fold.js';
import { applyLinkOverrides, edgeId, impliedKinds, validateLinks, type LinkDecl } from '../links/index.js';

/** The predicate clause a landed point/interval/match probe folds to — ONE spelling for the live path and the replay fold. */
function probeClause(kind: 'point' | 'interval' | 'match', field: string, value: unknown): PredicateClause {
  if (kind === 'point') return { kind, field, value };
  if (kind === 'match') {
    const body = value as Exclude<MatchValue, null>;
    return { kind, field, values: body.values, ...(body.exclude === true ? { exclude: true } : {}) };
  }
  return { kind, field, value: value as FilterRange };
}
import type { CauseClause } from '../mosaic/index.js';
import { registerAnalysisSlot } from '../def/register.js';
import { copyValue, deepFreeze } from '../detach/index.js';
import type { AnalysisSlot, DashboardRuntime, DispatchVerb, FdrStepper, RegisteredAnalysis, RestorableSaved, RestorableBookmark, RestoreResult, ViewEncodingDecl, SavedClause, SavedSelection, Bookmark } from '../def/types.js';
import { describeRules, fitsFor, refuses, validateBindings } from '../encoding/index.js';
import { ENCODING_KIND, edgesInto } from '../links/index.js';
import { DASHBOARD_PROSE_ID, NOTE_PROSE_PREFIX, isNoteSubject, PROPOSAL_LANE, PROSE_SLOTS, fillProse, PROSE_SENTENCES, proseRefuses, proseStatus, validateProseRecord } from '../prose/index.js';
import type { ProseProposal, ProseRecord, ProseSlot, ProseStatus, ProposalStatus, ProseWorld } from '../prose/index.js';
import type { LinkGraph } from '../links/index.js';
import type { Bindings, EncodingProblem, Fit } from '../encoding/index.js';
import { GapLedger } from './gapLedger.js';
import { why } from '../why/index.js';
import type { RuntimeSnapshot } from 'footprintjs';
import type { AgentEventFrame, WhyResult, WhyTarget } from '../why/index.js';
import {
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  BranchRefs,
  CHART_VIEW_PREFIX,
  ENCODING_VIEW_PREFIX,
  LAYOUT_VIEW_PREFIX,
  LINK_VIEW_PREFIX,
  foldDiff,
  foldStateAt,
  planBringOver,
  planUndo,
  slugForCommit,
  uniqueSlug, ENCODING_SET_FIELD, isEncodingSet, encodingSetOf , PROSE_VIEW_PREFIX } from '../branches/index.js';
import type { PlanRecipe } from '../branches/index.js';
import type {
  Offer,
  SelectionInfo,
  AdoptPathResult,
  AdoptStep,
  AnalysisCommit,
  ArchivePathResult,
  BranchInfo,
  BringOverResult,
  CellValues,
  ChartHypothesis,
  ChartInfo,
  ChartView,
  BookmarkView,
  ColumnFacet,
  CompareResult,
  DeclareAnalysisOptions,
  DiscardResult,
  DispatchAction,
  DispatchResult,
  FilterRange,
  GapCode,
  GapOp,
  GapRow,
  NewPathResult,
  Overview,
  PathInfo,
  PathsListOptions,
  PathsState,
  ProposeChartInput,
  ProposeChartResult,
  RenamePathResult,
  RestorePathResult,
  SeekResult,
  SessionOptions,
  SwitchPathResult,
  TimeState,
  ViewAdapter,
  EffectiveEncoding,
  TableInfo,
  NoteInfo,
  ReachingClause,
  ViewQuery,
  ViewQueryResult,
  SaveSelectionSource,
  SaveSelectionResult,
  ApplySavedOptions,
  ApplySavedResult,
  BookmarkResult,
} from './types.js';

/**
 * Per-invocation provenance the session captures DURING a `declareAnalysis` (the
 * L6 `why()` inputs — gathered live, never post-processed). One record per
 * analysis result that landed a commit.
 */
interface WhyProvenance {
  readonly analysisId: string;
  /** The viz commit `declareAnalysis` landed for this invocation. */
  readonly declaringCommitId: string;
  /** The select/filter commits that formed the analysis input (empty for a full-table transform). */
  readonly inputSelectionCommitIds: readonly string[];
  /** The footprintjs run this analysis executed (the kernel tier), if it ran. */
  readonly snapshot?: RuntimeSnapshot;
  /** The kernel state key the target's value lives under (column name / resolved scalar key). */
  readonly kernelKey?: string;
  /** The cross-tier join key stamped on the landed commit. */
  readonly correlationId?: string;
  /** kind:'test' — the online-FDR ledger row. */
  readonly fdrStep?: FdrStep;
}

/** Reserved log fields the session lands non-filter commits under (never real data columns). */
const ANALYSIS_FIELD = '__analysis__';
const ANNOTATION_FIELD = '__annotation__';
/**
 * The field a bookmark commit carried its label under. The session lands NO
 * bookmark commits any more (a bookmark lives beside the log, not in it), but
 * the field stays reserved from probes: the UI's log reader still labels a
 * `__bookmark__` commit "bookmark", so a data column of that name would read as
 * a bookmark that never was.
 */
const BOOKMARK_FIELD = '__bookmark__';
/** How many journal records the overview carries (the latest) — a poll must not grow without bound; `dashboard.journal()` holds them all. Placeholder until measured. */
const JOURNAL_TAIL = 50;
/** The dashboard subject's registry meta: its words are the system's, its label the cockpit's. */
const DASHBOARD_ACTOR_META = { actor: 'system', label: 'the dashboard' } as const;
/** A note's registry meta: words a person (or an accepted reply) put on the dashboard. */
const NOTE_ACTOR_META = { actor: 'user', label: 'a note' } as const;
/** RP-3: the field an agent-authored chart's spec-registration commit lands under. */
const CHART_FIELD = '__chart__';

/**
 * The `reencode` verb's commit-landing namespace (mirrors the `annotation:`/
 * `analysis:` synthetic-viewId pattern doAnnotate/declareAnalysis already use
 * — see `doAnnotate` above and `declareAnalysis` below): a reencode commit's
 * `viewId` is `encoding:${targetViewId}`, so it is structurally distinct from
 * a real probe on that view (`runtime.views.has()` is false for it) and
 * `rebuildFold` can recognize + fold it without touching `src/log`'s wire
 * union (CommitRecord stays `kind:'point'|'interval'`; `field` carries the
 * CHANNEL, `value` carries the target field — both plain strings, same shape
 * every other commit already uses).
 *
 * The prefix constants themselves are SINGLE-SOURCED from `src/branches/fold`
 * (BR-1): the branches layer folds the same wire from the log alone, so the
 * two layers share the literal bytes and cannot drift.
 */
const encodingViewId = (viewId: string): string => `${ENCODING_VIEW_PREFIX}${viewId}`;
const linkViewId = (id: string): string => `${LINK_VIEW_PREFIX}${id}`;

/**
 * The `chart:${id}` synthetic identity an agent-authored chart's commits land
 * under (RP-3). Single-sourced from `src/branches/fold` like the other
 * prefixes, so the branches fold and the session cannot drift on the wire.
 * A chart commit is INERT in the fold (`keyOf` returns null for it) — a chart
 * registration is not crossfilter state; it renders as its own view.
 */
const chartViewId = (id: string): string => `${CHART_VIEW_PREFIX}${id}`;

/**
 * LY-1: the cockpit-layout commit-landing namespace — a layout note lands under
 * `layout:${scope}` (e.g. `layout:dashboard`), following the `encoding:` /
 * `annotation:` / `chart:` synthetic-viewId precedent above. `field` carries
 * the arrangement PROP (`preset` / `order` / `focus`), `value` its plain-string
 * value. Recorded through the `navigate` verb (deliberately NON-filtering —
 * the same honesty ruling as pan/zoom: an arrangement is never a data claim)
 * and folded by `rebuildFold` like `activeEncodings`, so seek / switchPath /
 * fork each restore their own arrangement. Prefix single-sourced from
 * `src/branches/fold` (where it is INERT — layout never enters row counts,
 * foldDiff, or conflicts).
 *
 * The registry meta for a layout source is CONSTANT (`{ actor: 'system',
 * label: 'layout' }`): `layout:${scope}` is ONE shared source across actors,
 * and the registry rejects a meta that varies (the doReencode BR-1 lesson
 * above) — WHO acted lives in the cause (`requestedBy`).
 */
const LAYOUT_SOURCE_META = { actor: 'system', label: 'layout' } as const;
/** A layout value is inert display state — cap it like a bookmark label (order lists fit easily). */
const LAYOUT_VALUE_MAX = 500;

/**
 * Fields a `select`/`filter` may NOT target — a clause on one of these would
 * collide with a session-authored commit. `pValue` (`TEST_ANALOG_FIELD`) is the
 * load-bearing one: an unguarded point select on a data column literally named
 * `pValue` carrying a value in [0,1] would be miscounted as a declared test by
 * `hypothesisRecordsFromLog` on log replay (R6). Reject it as a typed gap.
 */
const RESERVED_PROBE_FIELDS = new Set<string>([TEST_ANALOG_FIELD, ANALYSIS_FIELD, ANNOTATION_FIELD, CHART_FIELD, BOOKMARK_FIELD]);

/** The public session surface (family-symmetric with hcifootprint's Session). */
export interface InteractionSession {
  readonly log: CauseSelectionSession;
  readonly defaultTable: string;
  readonly defaultActor: Actor;
  /** The ACTIVE branch head — the tip of the lineage linear commits extend (moves only when an act lands a commit). */
  readonly head: string | null;

  /**
   * Move the read-only CURSOR to a prior commit and rebuild the resolved fold
   * (visible selections + materialized columns) as the pure fold of the branch
   * path root→commitId. The active head is UNCHANGED — seek is navigation, not
   * mutation, and refunds no alpha. The NEXT act parents from the cursor, so a
   * dispatch/declareAnalysis from a past cursor branches (see the file header).
   */
  seek(commitId: string): SeekResult;

  /** The current read-only cursor position (the parent the next act commits from). */
  cursor(): string | null;

  /**
   * The divergent lineages in the append-only branch DAG (R8), one per leaf
   * (tip) commit, with the active branch flagged. Derived from the parent-pointer
   * topology; old branches always stay in this list (and in the FDR denominator).
   */
  branches(): readonly BranchInfo[];

  // ── named paths (BR-1: refs + HEAD beside the log; journaled ref-events) ────

  /**
   * The NAMED paths: name, tip, step count, last logical timestamp, active flag.
   * ARCHIVED paths are hidden here (TL-1) — pass `{ includeArchived: true }` to
   * list them too, each flagged `archived: true`. Hidden, never erased.
   */
  paths(opts?: PathsListOptions): readonly PathInfo[];

  /**
   * Switch to a named path: seek to its tip, rebuild the fold there, and make
   * that lineage ACTIVE (HEAD attaches to the ref; the next act advances it).
   * Journaled as a ref-event. Unknown name → typed gap.
   */
  switchPath(name: string): SwitchPathResult;

  /** Rename a path (HEAD follows if attached). Journaled. Unknown/collision/invalid → typed gap. */
  renamePath(from: string, to: string): RenamePathResult;

  /**
   * Start a NEW named path at a prior commit: creates the ref there (name
   * auto-slugged from that commit's cause when omitted), attaches HEAD, and
   * seeks the cursor to it — the next act extends the new path. Journaled.
   */
  newPathAt(commitId: string, name?: string): NewPathResult;

  /**
   * Compare two positions — path names or commit ids. Returns the common
   * ancestor plus the structured state diff (changed / onlyA / onlyB across
   * selections, encodings, and analyses — the `branches/` foldDiff), enriched
   * with per-side ROW COUNTS under each side's folded selections.
   */
  compare(aRef: string, bRef: string): Promise<CompareResult>;

  /**
   * Bring a commit from another path over to the current position
   * (cherry-pick): plan via `branches/` (conflicts = same key touched on this
   * path since the common ancestor, named by the overriding commit id — the
   * plan still executes), then land it through NORMAL dispatch as an ordinary
   * commit whose cause carries `replayedFrom` (+ `conflicts` when any).
   */
  bringOver(commitId: string, opts?: { as?: Actor }): Promise<BringOverResult>;

  /**
   * Undo a commit (revert): restore the state key's value at that commit's
   * PARENT — including "absent at parent → clear". Same plan/execute split as
   * `bringOver`; the landed cause carries `revertOf` (+ `conflicts` when any).
   * An analysis or annotation commit is honestly not undoable (typed gap).
   */
  undo(commitId: string, opts?: { as?: Actor }): Promise<BringOverResult>;

  // ── the trail lifecycle (TL-1: never erase the record — erase the VIEW) ─────

  /**
   * HIDE a path: it keeps its name, its tip, and every one of its commits, but
   * drops out of `paths()`, the pill, and step-nav routing. `compare()` and
   * `why()` still accept it, and the FDR ledger still counts the tests that
   * were run on it — hiding a dead end never refunds alpha.
   *
   * Archiving the path HEAD rides DETACHES HEAD at that path's tip: you keep
   * standing where you were, but on no named path, so the next act starts a
   * fresh named one rather than quietly re-advancing what you just hid. The
   * last visible path cannot be archived (typed gap).
   */
  archivePath(name: string, opts?: { as?: Actor }): ArchivePathResult;

  /** The exact inverse of {@link archivePath} — the path is listed again, unchanged. */
  restorePath(name: string, opts?: { as?: Actor }): RestorePathResult;

  /**
   * DISCARD everything after a point on your own path: the path's ref moves
   * back to `at` (default: the cursor) and the abandoned future is kept as a
   * system-named ARCHIVED path — one ref-journal transaction, zero deletions.
   * The old tip still folds to exactly the same state and one restore brings
   * its name back.
   *
   * Which path moves: the one HEAD rides, if `at` is on it; else — while
   * detached — the single visible path that continues past `at`. Pointing at a
   * commit that is not on your own line of work is a typed gap (only your own
   * future is discardable), and so is a fork point with two futures.
   */
  discardFromHere(opts?: { at?: string; as?: Actor }): DiscardResult;

  /**
   * ADOPT another path's work into yours (merge by replay): every step the
   * source took since the common ancestor is re-planned against where you
   * stand and re-landed IN ORDER through ordinary dispatch, each as a normal
   * commit tagged `replayedFrom` (+ `conflicts` when your path already touched
   * the same state). Steps that cannot be replayed are honestly SKIPPED with a
   * per-step reason — never silently dropped.
   *
   * The source path is left completely untouched (it is not archived — that is
   * your call afterwards). A replayed analysis genuinely RE-RUNS here and
   * spends its own alpha, exactly as `bringOver` does: results are never copied
   * across paths. A step whose replay THROWS (an analysis stage, a mounted
   * adapter) is reported as a skip with the thrown message and files a gap —
   * the run continues, and the caller always gets its report.
   */
  adoptPath(name: string, opts?: { as?: Actor }): Promise<AdoptPathResult>;

  /** Register a view adapter under a declared view identity (R3). */
  mountView(viewId: string, adapter: ViewAdapter): { ok: true } | { ok: false; gap: GapRow };

  /** THE single semantic entry point (R4). */
  dispatch(action: DispatchAction, opts?: { as?: Actor }): Promise<DispatchResult>;

  /** Run a declared analysis: stamp cause, land the AnalysisCommit, step L4, materialize columns (R11). */
  declareAnalysis(id: string, opts?: DeclareAnalysisOptions): Promise<AnalysisCommit>;

  /**
   * RP-3 — an agent PROPOSES a chart at runtime as a Vega-Lite spec, through a
   * GOVERNED pipeline, never trust-and-render (renderer-protocol.md §5 / D28):
   *   schema-valid → capability-check (no host-owned transforms, no unsupported
   *   composition) → registered as a HYPOTHESIS in the LORD++ ledger BEFORE it
   *   renders → registered as a session view under `chart:${id}` with
   *   agent-authored provenance.
   * Any stage failure lands a TYPED gap (chart-invalid-spec |
   * chart-transforms-not-owned | chart-unsupported-composition |
   * chart-hypothesis-rejected) and renders NOTHING — the agent reads the reason
   * back and repairs. A rejected proposal never registers a hypothesis and so
   * never advances the FDR wealth ("alpha spent only on real claims").
   */
  proposeChart(input: ProposeChartInput, opts?: { as?: Actor }): Promise<ProposeChartResult>;

  /** The agent-authored charts registered this session (with their gated specs) — the host's render source. */
  charts(): readonly ChartView[];

  /** Register (and validate) an analysis under `id` at runtime. */
  registerAnalysis(id: string, slot: AnalysisSlot): void;
  hasAnalysis(id: string): boolean;
  analysisIds(): string[];

  /**
   * The L6 cross-tier `why(target)` — the MINIMAL commit set the target depends
   * on, machine-shaped (viz declaring + input-selection commits, agent frame,
   * kernel stages), or a typed miss. `target` names a materialised COLUMN or a
   * SCALAR/hypothesis (analysis id). Pass a caller-harvested `agentEventLog`
   * (sanctioned `EventMeta` frames) to thread the agent tier; omit it for an
   * honest `no-agent-tier` miss.
   */
  why(target: WhyTarget, opts?: { agentEventLog?: readonly AgentEventFrame[] }): WhyResult;

  /** The gap ledger (R14 / D14). */
  gaps(): readonly GapRow[];
  readonly gapLedger: GapLedger;

  /** The online-FDR audit trail (one row per declared test). */
  ledger(): readonly FdrStep[];
  bookmarkViews(): readonly BookmarkView[];

  /** Rows under the current selection (across all views). */
  selectedRows(table?: string): Promise<readonly Row[]>;

  /**
   * The clauses that reach one view through the link graph at the cursor —
   * its own clause excluded, each edge's response and field mapping applied,
   * a cleared source remembered per the edge's `onClear`. The engine, not a
   * renderer, owns which gestures reach a view: the sheet and the charts read
   * the same answer.
   */
  clausesFor(viewId: string): readonly ReachingClause[];

  /**
   * One window of rows for the sheet: sorted, offset, with a row identity per
   * row. Every window is ONE evaluate on the engine (the sort is a cached
   * permutation there; a brush never rebuilds it). Reads only — scrolling
   * lands no commit. Refused with a sentence, never a fabricated window.
   */
  viewQuery(query?: ViewQuery): Promise<ViewQueryResult>;

  /**
   * SAVED SELECTIONS ARE SAVED LOGIC. `saved()` lists the named pictures (the
   * store beside the log). `saveSelection`
   * names every live clause, one view's, or explicit conditions — it lands NO
   * commit. `applySaved` is the act: one ordinary select/filter commit per
   * condition under one cause and one correlation id (`replace` clears the
   * other live filters first), honest per condition about what could not land.
   */
  saved(): readonly SavedSelection[];
  saveSelection(name: string, source: SaveSelectionSource, as?: Actor): SaveSelectionResult;
  /** Rename a picture — free: a note links its `id`, so the link survives (only the words it shows may go stale). `by`/`at` stay the creation stamp; `editedBy`/`editedAt` record the rename. */
  renameSaved(from: string, to: string, as?: Actor): SaveSelectionResult;
  forgetSaved(name: string): SaveSelectionResult;
  applySaved(name: string, cause: Cause, opts?: ApplySavedOptions): Promise<ApplySavedResult>;
  /** Put saved selections back whole (a host's persistence) — judged, never re-stamped; refused entries named, and any record the store had to re-id said so. */
  restoreSaved(list: readonly RestorableSaved[]): RestoreResult;

  /**
   * BOOKMARKS — names on moments, beside the log. `bookmarks()` lists the
   * records; `bookmark(name, commitId?)` names a commit (the cursor by
   * default) and lands NOTHING; a bookmark name points at one moment. The
   * `bookmark` dispatch verb is the same act. `bookmarkViews()` is the wire's
   * view of the same bookmarks (label + the commit + its position in the log).
   */
  bookmarks(): readonly Bookmark[];
  bookmark(name: string, commitId?: string, as?: Actor, description?: string): BookmarkResult;
  /** Change a bookmark's words (null clears them) — `editedBy`/`editedAt` record the change; who bookmarked the moment and when stay as they were. */
  describeBookmark(name: string, description: string | null, as?: Actor): BookmarkResult;
  /** Rename a bookmark — free: a note links its `id`, so the link survives (only the words it shows may go stale). */
  renameBookmark(from: string, to: string, as?: Actor): BookmarkResult;
  forgetBookmark(name: string): BookmarkResult;
  restoreBookmarks(list: readonly RestorableBookmark[]): RestoreResult;

  /**
   * The current channel→field visual-encoding map for one view, branch-scoped
   * at the cursor (the `reencode` verb's fold — SPEC Q6 8th verb). Empty if
   * the view declares no encoding surface or is unknown. Synchronous — no
   * backend read, unlike `overview()` (which also exposes this per-view).
   */
  viewEncodings(viewId: string): Readonly<Record<string, string>>;

  /** The structured `whats_here` projection (views/selections/analyses+readiness/fdr/gaps). */
  overview(): Promise<Overview>;
}

/** The emission kind a select/filter act names: the cell form, the match form, the point, or the interval. */
function kindOfAct(action: Extract<DispatchAction, { verb: 'select' | 'filter' }>): EmissionKind {
  if (action.verb === 'filter') return 'interval';
  return 'fields' in action ? 'cell' : 'values' in action ? 'match' : 'point';
}

/** FNV-1a over a string — a short, stable id for an offer minted at a position. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** One live (or last) clause as the wire's `SelectionInfo` — the same projection for active and cleared selections. */
function selectionInfoOf(viewId: string, clause: PredicateClause, commitId?: string): SelectionInfo {
  const info: SelectionInfo = (
      clause.kind === 'cell'
        ? {
            viewId,
            field: cellFieldLabel(clause.fields), // display-only joint label (D30)
            kind: 'cell' as const,
            value: clause.value,
            fields: clause.fields,
          }
        : clause.kind === 'match'
          ? {
              viewId,
              field: clause.field,
              kind: 'match' as const,
              // the wire carries the IN-list and its polarity as ONE value (a `MatchValue`) — key order {values, exclude?}
              // matches the commit's own value, which a consumer may compare as JSON (the saved-selection panel does)
              value: { values: clause.values, ...(clause.exclude === true ? { exclude: true } : {}) },
            }
          : {
              viewId,
              field: clause.field,
              kind: clause.kind as 'point' | 'interval',
              value: (clause as { value: unknown }).value, // never a cleared point: one clearing rule drops it from the fold (SET-1)
            }  );
  return commitId === undefined ? info : { ...info, commitId };
}

/** A view's live clause as a saved condition. */
function clauseOfLive(viewId: string, clause: PredicateClause): SavedClause {
  if (clause.kind === 'cell') return { viewId, kind: 'cell', field: cellFieldLabel(clause.fields), fields: [clause.fields[0], clause.fields[1]], value: copyValue(clause.value) };
  if (clause.kind === 'match') return { viewId, kind: 'match', field: clause.field, value: { values: copyValue(clause.values), ...(clause.exclude === true ? { exclude: true } : {}) } };
  return { viewId, kind: clause.kind, field: clause.field, value: copyValue(clause.value) };
}

/** The ordinary act a saved condition lands as — the same mapping a bring-over uses for a selection recipe. */
function selectionAction(c: SavedClause, cause: Cause): Extract<DispatchAction, { verb: 'select' | 'filter' }> {
  if (c.kind === 'cell') return { verb: 'select', viewId: c.viewId, fields: c.fields!, values: c.value as CellValues, cause }; // a cell condition always carries its pair
  if (c.kind === 'match') {
    const body = c.value as Exclude<MatchValue, null>;
    return { verb: 'select', viewId: c.viewId, field: c.field, values: body.values, ...(body.exclude === true ? { exclude: true } : {}), cause };
  }
  if (c.kind === 'point') return { verb: 'select', viewId: c.viewId, field: c.field, value: c.value, cause };
  return { verb: 'filter', viewId: c.viewId, field: c.field, range: c.value as FilterRange, cause };
}

/** The kind-faithful clear of a live clause (the same shapes a bring-over's clear-selection recipe lands). */
function clearAction(viewId: string, clause: PredicateClause, cause: Cause): Extract<DispatchAction, { verb: 'select' | 'filter' }> {
  if (clause.kind === 'cell') return { verb: 'select', viewId, fields: [clause.fields[0], clause.fields[1]], values: null, cause };
  if (clause.kind === 'match') return { verb: 'select', viewId, field: clause.field, values: null, cause };
  if (clause.kind === 'point') return { verb: 'select', viewId, field: clause.field, value: undefined, cause };
  return { verb: 'filter', viewId, field: clause.field, range: null, cause };
}

/** A consumer's own copy of a clause — never the session's live object. A clause is JSON-shaped through every door; one that is not is handed over as a shallow copy rather than thrown on. */
function copyClause(clause: PredicateClause): PredicateClause {
  try {
    return structuredClone(clause);
  } catch {
    /* v8 ignore next -- unreachable through the JSON-shaped agent and UI doors: only a hand-built clause with a function or symbol value refuses to clone */
    return { ...clause };
  }
}

/** A window's default size (placeholder): a page a grid can hold without holding the table. */
export const VIEW_QUERY_DEFAULT_LIMIT = 200;

/** The one frozen empty map every "this view binds nothing" answer shares. */
const EMPTY_BINDINGS: Readonly<Record<string, string>> = Object.freeze({});

/** The subject-independent half of a prose record's staleness world at the cursor. */
interface ProseWorldNow {
  readonly filters: Readonly<Record<string, unknown>>;
  readonly columns: Set<string>;
  readonly analyses: Set<string>;
}

class InteractionSessionImpl implements InteractionSession {
  readonly log = new CauseSelectionSession();
  readonly defaultTable: string;
  readonly defaultActor: Actor;
  readonly gapLedger = new GapLedger();

  private readonly runtime: DashboardRuntime;
  private readonly adapters = new Map<string, ViewAdapter>();
  private readonly localAnalyses = new Map<string, RegisteredAnalysis>();
  private readonly activeFilters = new Map<string, PredicateClause>();
  /** viewId → the latest still-active select/filter commit id (the L6 input-selection provenance). */
  private readonly activeFilterCommits = new Map<string, string>();
  /** viewId → its current channel→field visual-encoding map (the `reencode` fold; SPEC Q6 8th verb). */
  private readonly activeEncodings = new Map<string, Record<string, string>>();
  /** Layer 4: the `link` edits at the cursor, one per edge id (folded by rebuildFold like the encodings). */
  private readonly activeLinks = new Map<string, LinkDecl>();
  /** Layer 4 offers: when true, a select/filter must name a current offerId (the act door enforces what whats_here served). */
  private readonly requireOffer: boolean;
  /** Layer 4 `onClear`: each view whose last selection was CLEARED, with what it was and the clearing commit — a target edge's policy reads it. */
  private readonly clearedFilters = new Map<string, { readonly clause: PredicateClause; readonly clearedBy: string }>();
  /** layout scope → its current prop→value arrangement map (the LY-1 layout fold — see LAYOUT_SOURCE_META). */
  private readonly activeLayouts = new Map<string, Record<string, string>>();
  /** The prose plane's fold: viewId → slot → record, seeded from the def, overridden by `describe` commits (null = the def's words again). */
  private readonly activeProse = new Map<string, Map<ProseSlot, ProseRecord>>();
  /** The proposal lane's fold: viewId → slot → the latest proposal (with the proposing commit's id). */
  private readonly activeProposals = new Map<string, Map<ProseSlot, ProseProposal & { readonly proposal: string }>>();
  /** materialised column name → its producing analysis provenance (L6 `why({kind:'column'})`). */
  private readonly whyByColumn = new Map<string, WhyProvenance>();
  /** analysisId → the last invocation's provenance (L6 `why({kind:'hypothesis'})`). */
  private readonly whyByAnalysisId = new Map<string, WhyProvenance>();
  private readonly fdrStepper: FdrStepper;
  private readonly _ledger: FdrStep[] = [];
  /** RP-3: agent-authored charts registered this session, in proposal order (chartId → view). */
  private readonly _charts = new Map<string, ChartView>();
  private readonly initialWealth: number;

  /**
   * commitId → the (table, column) pairs an analysis materialized AT that commit.
   * Column visibility is branch-scoped through the FOLD: a materialized column is
   * visible iff its producing commit is on the cursor's branch path. (The memory
   * provider physically stores the column globally — see the branch-isolation
   * note in `effectiveColumnsOf` — so the session scopes visibility itself.)
   */
  private readonly materializedByCommit = new Map<string, { table: string; name: string }[]>();
  /** `${table}::${name}` for every column ever materialized in this session (across all branches). */
  private readonly allMaterialized = new Set<string>();

  /** The ACTIVE branch head — tip of the lineage linear commits extend. Moves only on a landed act. */
  private _head: string | null = null;
  /** The read-only navigation cursor — the parent the next act commits from. `seek`/`fork` move it. */
  private _cursor: string | null = null;
  /**
   * BR-1 named refs + HEAD, beside the log (never in it): act-at-tip advances
   * the ref, act-while-detached auto-creates a cause-slugged one; every
   * create/advance/switch/rename is journaled as a ref-event.
   */
  private readonly refs = new BranchRefs();
  private testClock = 0;
  private _currentView: string | null = null;

  constructor(runtime: DashboardRuntime, opts: SessionOptions = {}) {
    this.requireOffer = opts.requireOffer === true;
    this.runtime = runtime;
    this.defaultActor = opts.as ?? 'agent';
    this.defaultTable = opts.defaultTable ?? runtime.defaultTable;
    // every commit says which data it was true of: the version the default table's source vouched for at that
    // moment (the table selections, filters and analyses act on) — never every table, so an unrelated refresh
    // does not mark every commit as moved
    this.log.stampData = () => {
      const info = this.runtime.sources[this.defaultTable];
      return info === undefined ? undefined : { [this.defaultTable]: info.version };
    };
    this.fdrStepper = runtime.makeFdrStepper();
    // Initial alpha-wealth W0 for the summary before any test lands.
    const fdr = runtime.def.fdr;
    this.initialWealth =
      fdr?.w0 ?? (runtime.fdrProcedure === 'LORD++' ? runtime.fdrAlpha / 2 : runtime.fdrAlpha);
    // Seed the encoding fold at its root (cursor === null → an empty branch
    // path, so this only applies each declared view's `initial` map — no
    // filter/commit state exists yet to touch).
    this.rebuildFold(this._cursor);
  }

  get head(): string | null {
    return this._head;
  }

  // ── time travel: cursor / seek / branch-on-act (R8, Phase A) ─────────────────
  cursor(): string | null {
    return this._cursor;
  }

  /**
   * Advance BOTH pointers to a freshly-landed commit. After any act the active
   * branch tip and the cursor coincide: a branch-on-act (an act from a past
   * cursor) makes the new sibling lineage the active branch (R8 ruling — "the
   * active branch becomes the new lineage"). BR-1: the commit is also routed
   * through the refs — act-at-tip advances the current ref; act-while-detached
   * auto-creates a NAMED ref (today's branch-on-act, now named) — journaled.
   */
  private landed(record: CommitRecord): void {
    this._head = record.id;
    this._cursor = record.id;
    this.refs.noteCommit(record);
  }

  /** Move the cursor + rebuild the fold at `commitId` (no head change, no validation — callers pre-validate). */
  private seekTo(commitId: string): void {
    this._cursor = commitId;
    this.rebuildFold(commitId);
  }

  seek(commitId: string): SeekResult {
    if (!this.log.records.some((r) => r.id === commitId)) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'seek', `no commit "${commitId}" to seek to`, commitId) };
    }
    this.seekTo(commitId);
    // BR-1 (git parity): travelling BY COMMIT ID detaches HEAD — the next act
    // either extends a ref's tip (advancing it) or auto-creates a named ref.
    // Journaled as a ref-event; `switchPath` is the travel-by-NAME that attaches.
    this.refs.detach(commitId);
    return { ok: true, cursor: commitId };
  }

  /**
   * The root→`cursorId` ancestor chain (the branch path). Walks parent pointers
   * up to the root and reverses. `null` (no commits yet, or a root-before-any-act
   * cursor) yields the empty path. Cycle-guarded defensively (the append-only log
   * cannot form one, but a fold must never loop).
   */
  /**
   * Layer 4, the OFFER (ruling 8): every (view, emission kind) of this
   * dashboard — a view's voice is declared, it does not move — each stamped
   * with the CURRENT POSITION (the cursor), so an id minted by an earlier
   * `whats_here` goes stale when the position moves and the act door can say
   * so, naming the current one. The tool list stays byte-stable: the offer is
   * data in the answer, never a new tool. The view's `does` sentence rides once,
   * on `views[]`, not per offer.
   */
  private offersNow(): Offer[] {
    const position = this._cursor ?? 'root';
    const out: Offer[] = [];
    for (const view of this.runtime.links.views) {
      for (const kind of view.voice) {
        if (kind === ENCODING_KIND) continue; // a binding is followed through an edge, never acted on as an emission
        out.push({ offerId: `o-${fnv1a(`${position}|${view.viewId}|${kind}`)}`, viewId: view.viewId, kind });
      }
    }
    return out;
  }

  /** The act door's half of the offer: a named offer must be the current one for that node; a session may require one. */
  private offerGuard(verb: DispatchVerb, viewId: string, kind: EmissionKind, offerId: string | undefined, intent: DispatchResult['intent']): DispatchResult | null {
    if (offerId === undefined && !this.requireOffer) return null;
    const current = this.offersNow().find((o) => o.viewId === viewId && o.kind === kind);
    if (offerId === undefined) {
      return this.reject(verb, intent, this.gapLedger.file('stale-offer', verb, `this session requires an offerId from whats_here${current !== undefined ? ` — the current offer for view "${viewId}" ${kind} is ${current.offerId}` : ` — and view "${viewId}" has no ${kind} voice`}`, viewId));
    }
    if (current === undefined) return this.reject(verb, intent, this.gapLedger.file('stale-offer', verb, `offer ${offerId} names view "${viewId}" ${kind} — view "${viewId}" has no ${kind} voice`, viewId));
    if (current.offerId !== offerId) return this.reject(verb, intent, this.gapLedger.file('stale-offer', verb, `offer ${offerId} is not current for view "${viewId}" ${kind} — the position moved; the current offer is ${current.offerId}`, viewId));
    return null;
  }

  /** A clear remembers what it cleared (only a live clause can be cleared; clearing nothing notes nothing). */
  private noteCleared(viewId: string, clearedBy: string): void {
    const prev = this.activeFilters.get(viewId);
    if (prev !== undefined) this.clearedFilters.set(viewId, { clause: prev, clearedBy });
  }

  private branchPath(cursorId: string | null): CommitRecord[] {
    if (cursorId === null) return [];
    const byId = new Map(this.log.records.map((r) => [r.id, r]));
    const chain: CommitRecord[] = [];
    const seen = new Set<string>();
    let cur: string | null = cursorId;
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      const rec = byId.get(cur);
      if (!rec) break;
      chain.push(rec);
      cur = rec.parent;
    }
    chain.reverse();
    return chain;
  }

  /**
   * Rebuild the resolved selection fold (active filters + their input-selection
   * commit ids) as the PURE fold of the branch path root→cursor. Only real view
   * probes fold into the selection; annotation/analysis/encoding commits (whose
   * viewIds are not declared views) and reserved-field commits are inert. A
   * cleared interval drops the view's filter, exactly as `doProbe` does live.
   *
   * Also rebuilds `activeEncodings` (the `reencode` verb's fold, SPEC Q6 8th
   * verb): seeded from each declared view's `initial` map, then overridden by
   * every `encoding:` commit on the path, in order — so `seek` restores
   * whatever channel→field mapping was live at that point in history.
   */
  private rebuildFold(cursorId: string | null): void {
    this.activeFilters.clear();
    this.activeFilterCommits.clear();
    this.clearedFilters.clear();
    this.activeEncodings.clear();
    this.activeLinks.clear();
    this.activeLayouts.clear();
    for (const view of this.runtime.views.values()) {
      if (view.encoding?.initial) this.activeEncodings.set(view.viewId, Object.freeze({ ...view.encoding.initial }));
    }
    this.activeProse.clear();
    this.activeProposals.clear();
    for (const [viewId, slots] of this.runtime.prose) this.activeProse.set(viewId, new Map(Object.entries(slots) as [ProseSlot, ProseRecord][]));
    for (const rec of this.branchPath(cursorId)) {
      if (rec.viewId.startsWith(LINK_VIEW_PREFIX)) {
        // Layer 4: an edited edge, last-wins per edge id; null un-declares it
        const id = rec.viewId.slice(LINK_VIEW_PREFIX.length);
        if (rec.value === null) this.activeLinks.delete(id);
        else this.activeLinks.set(id, rec.value as LinkDecl);
        continue;
      }
      if (rec.viewId.startsWith(ENCODING_VIEW_PREFIX)) {
        const targetViewId = rec.viewId.slice(ENCODING_VIEW_PREFIX.length);
        const current = this.activeEncodings.get(targetViewId) ?? {};
        // a binding set (the `*` marker) carries several channels in one commit
        this.activeEncodings.set(targetViewId, Object.freeze(isEncodingSet(rec) ? { ...current, ...encodingSetOf(rec) } : { ...current, [rec.field]: String(rec.value) }));
        continue;
      }
      // LY-1: the layout fold — last-wins per (scope, prop), exactly like the
      // encoding fold above, so seek/switchPath restore the OLD arrangement.
      // No initial seeding: an empty scope means "the consumer's default".
      if (rec.viewId.startsWith(PROSE_VIEW_PREFIX)) {
        const viewId = rec.viewId.slice(PROSE_VIEW_PREFIX.length);
        if (rec.field.endsWith(PROPOSAL_LANE)) this.foldProposal(viewId, rec.field.slice(0, -PROPOSAL_LANE.length) as ProseSlot, rec.value as ProseProposal, rec.id);
        else this.foldProse(viewId, rec.field as ProseSlot, rec.value === null ? null : (rec.value as ProseRecord));
        continue;
      }
      if (rec.viewId.startsWith(LAYOUT_VIEW_PREFIX)) {
        const scope = rec.viewId.slice(LAYOUT_VIEW_PREFIX.length);
        const current = this.activeLayouts.get(scope) ?? {};
        this.activeLayouts.set(scope, Object.freeze({ ...current, [rec.field]: String(rec.value) }));
        continue;
      }
      if (!this.runtime.views.has(rec.viewId)) continue; // skip annotation:/analysis: commits
      if (RESERVED_PROBE_FIELDS.has(rec.field)) continue;
      if (isClearedSelection(rec)) {
        // a cleared interval, cell, match — or point — drops the filter (ONE rule, shared with the branch fold);
        // what it WAS is kept for the edges whose `onClear` says leave or excludeAll
        if (rec.cause.revertOf === undefined && rec.cause.replacedBy === undefined) this.noteCleared(rec.viewId, rec.id); // an undo takes the selection back, it does not "clear" it; nor does a clear that makes room for a saved picture
        this.activeFilters.delete(rec.viewId);
        this.activeFilterCommits.delete(rec.viewId);
      } else {
        this.clearedFilters.delete(rec.viewId);
        const clause: PredicateClause =
          rec.kind === 'cell'
            ? // the log's commit() guarantees `fields` on every cell record
              { kind: 'cell', fields: rec.fields!, value: rec.value as CellClause['value'] }
            : probeClause(rec.kind, rec.field, rec.value);
        this.activeFilters.set(rec.viewId, clause);
        this.activeFilterCommits.set(rec.viewId, rec.id);
      }
    }
  }

  branches(): readonly BranchInfo[] {
    const records = this.log.records;
    if (records.length === 0) return [];
    const childCount = new Map<string, number>();
    for (const r of records) {
      if (r.parent !== null) childCount.set(r.parent, (childCount.get(r.parent) ?? 0) + 1);
    }
    return records
      .filter((r) => (childCount.get(r.id) ?? 0) === 0) // a leaf (no children) is a branch tip
      .map((leaf) => ({
        tip: leaf.id,
        length: this.branchPath(leaf.id).length,
        actor: leaf.cause.requestedBy,
        active: leaf.id === this._head,
      }));
  }

  // ── named paths (BR-1: refs + HEAD beside the log; journaled ref-events) ────

  paths(opts: PathsListOptions = {}): readonly PathInfo[] {
    const byId = new Map(this.log.records.map((r) => [r.id, r]));
    const current = this.refs.currentBranch();
    return Object.entries(this.refs.branches({ includeArchived: opts.includeArchived === true })).map(([name, tip]) => ({
      name,
      tip,
      steps: this.branchPath(tip).length,
      // Session-authored refs only ever point at commits in THIS log (noteCommit
      // routes landed records; newPathAt validates the id first), so the tip is
      // always resolvable.
      lastTs: (byId.get(tip) as CommitRecord).ts,
      active: name === current,
      // TL-1: flagged only when hidden, so a plain listing keeps its old shape.
      ...(this.refs.isArchived(name) ? { archived: true as const } : {}),
    }));
  }

  switchPath(name: string): SwitchPathResult {
    const res = this.refs.switchTo(name); // journals the switch only when it succeeds
    if (!res.ok) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'switchPath', res.detail, name) };
    }
    // A named switch ACTIVATES that lineage: cursor AND head move to its tip
    // (the next linear act extends it — advancing the ref, not branching).
    this.seekTo(res.tip);
    this._head = res.tip;
    return { ok: true, name, cursor: res.tip };
  }

  renamePath(from: string, to: string): RenamePathResult {
    const res = this.refs.rename(from, to);
    if (!res.ok) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'renamePath', res.detail, from) };
    }
    return { ok: true, name: to };
  }

  newPathAt(commitId: string, name?: string): NewPathResult {
    const record = this.log.records.find((r) => r.id === commitId);
    if (!record) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'newPathAt', `no commit "${commitId}" to start a path at`, commitId) };
    }
    const chosen = name ?? uniqueSlug(slugForCommit(record), (n) => this.refs.has(n));
    const res = this.refs.createAt(chosen, commitId);
    if (!res.ok) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'newPathAt', res.detail, chosen) };
    }
    // The new path is the active lineage: the next act extends its tip.
    this.seekTo(commitId);
    this._head = commitId;
    return { ok: true, name: res.name, cursor: commitId };
  }

  // ── the trail lifecycle (TL-1: refs move, commits are forever) ─────────────

  /** File a lifecycle rejection as a typed gap (R14) — never a silent no-op. */
  private lifecycleGap(op: GapOp, detail: string, target: string): { ok: false; gap: GapRow } {
    return { ok: false, gap: this.gapLedger.file('guard-failed', op, detail, target) };
  }

  archivePath(name: string, opts: { as?: Actor } = {}): ArchivePathResult {
    const res = this.refs.archive(name, opts.as ?? this.defaultActor);
    if (!res.ok) return this.lifecycleGap('archivePath', res.detail, name);
    // The cursor does NOT move: hiding a path is a change of VIEW, not of
    // position — you are still standing exactly where you were standing.
    return { ok: true, name, tip: res.tip, detached: res.detached };
  }

  restorePath(name: string, opts: { as?: Actor } = {}): RestorePathResult {
    const res = this.refs.restore(name, opts.as ?? this.defaultActor);
    if (!res.ok) return this.lifecycleGap('restorePath', res.detail, name);
    return { ok: true, name, tip: res.tip };
  }

  /**
   * Which path's ref `discardFromHere` would move, or the honest reason none
   * can. On a named path it is THAT path (and `at` must be on it — only your
   * own future is discardable); while detached it is the single visible path
   * that continues past `at`.
   */
  private pathToRewind(at: string): { name: string; tip: string } | { detail: string } {
    const current = this.refs.currentBranch();
    if (current !== null) {
      const tip = this.refs.tipOf(current) as string; // an attached HEAD always names a born ref
      if (!this.branchPath(tip).some((r) => r.id === at)) {
        return { detail: `commit "${at}" is not on your path "${current}" — only your own future is discardable; switch to the path it lives on first` };
      }
      if (tip === at) return { detail: `you are already at the end of "${current}" — there is nothing after here to discard` };
      return { name: current, tip };
    }
    const heirs = Object.entries(this.refs.branches()).filter(
      ([, tip]) => tip !== at && this.branchPath(tip).some((r) => r.id === at),
    );
    if (heirs.length === 0) return { detail: `no path continues past commit "${at}" — there is nothing to discard` };
    if (heirs.length > 1) {
      return { detail: `commit "${at}" branches into ${heirs.length} paths (${heirs.map(([n]) => n).join(', ')}) — switch to the one you mean first` };
    }
    const [name, tip] = heirs[0] as [string, string];
    return { name, tip };
  }

  discardFromHere(opts: { at?: string; as?: Actor } = {}): DiscardResult {
    const at = opts.at ?? this._cursor;
    if (at === null) return this.lifecycleGap('discardFromHere', 'there are no steps yet — nothing to discard', '');
    if (!this.log.records.some((r) => r.id === at)) {
      return this.lifecycleGap('discardFromHere', `no commit "${at}" to discard from`, at);
    }
    const target = this.pathToRewind(at);
    if ('detail' in target) return this.lifecycleGap('discardFromHere', target.detail, at);

    // The abandoned future is NAMED from the tip it ends at, so it reads back as
    // itself in the archived list ("discarded-premium-focus"), and is unique.
    const tipRecord = this.log.records.find((r) => r.id === target.tip) as CommitRecord;
    const keepAs = uniqueSlug(`discarded-${slugForCommit(tipRecord)}`, (n) => this.refs.has(n));
    const res = this.refs.discardTo(target.name, at, keepAs, opts.as ?? this.defaultActor);
    /* v8 ignore next 2 -- refs.discardTo re-checks what pathToRewind + uniqueSlug already guarantee: a live, non-archived ref whose tip differs from `at` (the attached arm can only name a ref HEAD rides, and the frozen-ref rule keeps HEAD off archived refs — refs.ts's `_archived ⊆ _branches` + rename-refuses-archived invariants, both pinned in src/branches/lifecycle.test.ts; the detached arm draws heirs from `branches()`, visible only), and a free, valid keepAs. The arm is a belt on the ref layer's own contract, unreachable through this method. */
    if (!res.ok) return this.lifecycleGap('discardFromHere', res.detail, target.name);

    // The path now ends here: head AND cursor sit at `at`, fold rebuilt there.
    this._head = at;
    this.seekTo(at);
    const steps = this.branchPath(target.tip).length - this.branchPath(at).length;
    return { ok: true, path: target.name, at, kept: res.kept, keptTip: res.from, steps };
  }

  /**
   * The source path's steps SINCE the common ancestor, oldest→newest, plus that
   * ancestor. Both chains are root-anchored linear ancestries, so their shared
   * commits are a PREFIX of the source chain — the last shared one IS the LCA
   * (null when the two share no root, or when nothing has landed here yet).
   */
  private stepsSinceAncestor(sourceTip: string): { ancestor: string | null; steps: CommitRecord[] } {
    const sourceChain = this.branchPath(sourceTip); // root→tip
    const onTarget = new Set(this.branchPath(this._cursor).map((r) => r.id));
    const firstNew = sourceChain.findIndex((r) => !onTarget.has(r.id));
    const ancestorIdx = firstNew === -1 ? sourceChain.length - 1 : firstNew - 1;
    return {
      /* v8 ignore next -- a session-authored log has exactly ONE root (only the first commit has parent null; every later one parents from a non-null cursor), so both chains always share it and `ancestorIdx` is never -1. The `null` mirrors compare()'s honest disjoint-roots case, which only a hand-carried multi-root log could produce. */
      ancestor: ancestorIdx >= 0 ? (sourceChain[ancestorIdx] as CommitRecord).id : null,
      steps: firstNew === -1 ? [] : sourceChain.slice(firstNew),
    };
  }

  async adoptPath(name: string, opts: { as?: Actor } = {}): Promise<AdoptPathResult> {
    const sourceTip = this.refs.tipOf(name); // archived paths answer too — adopting from one is fair
    if (sourceTip === undefined) return this.lifecycleGap('adoptPath', `no path named "${name}"`, name);
    if (name === this.refs.currentBranch()) {
      return this.lifecycleGap('adoptPath', `"${name}" is the path you are on — there is nothing to adopt`, name);
    }
    const { ancestor, steps } = this.stepsSinceAncestor(sourceTip);
    // Every plan is measured against where the adopt STARTED, so a conflict
    // means "your own path already touched this since the fork" — never "an
    // earlier step of this same replay touched it".
    const originTip = this._cursor;

    const report: AdoptStep[] = [];
    for (const step of steps) {
      if (step.viewId.startsWith(CHART_VIEW_PREFIX)) {
        // RP-3: a chart registration is a proposal, not a state change — it has
        // to pass its own governed pipeline here, so replaying its commit would
        // be a forgery. Honest skip; propose it again on this path.
        report.push({
          commitId: step.id,
          applied: false,
          conflicts: [],
          skippedReason: 'an agent-authored chart is proposed, not replayed — propose it again on this path',
        });
        continue;
      }
      const plan = planBringOver(this.log.records, step.id, originTip);
      /* v8 ignore next 4 -- planBringOver rejects ONLY unknown commit ids; `step.id` came from this log's own ancestor chain and `originTip` is the live cursor, so both are always present — this arm is a type guard, never a reachable path */
      if (!plan.ok) {
        report.push({ commitId: step.id, applied: false, conflicts: [], skippedReason: plan.detail });
        continue;
      }
      // A replay runs REAL third-party code — an analysis def's stage, a mounted
      // adapter's applyClause — and either can THROW. One throwing step must not
      // abort the run and lose the report the caller is owed: catch it, file the
      // typed gap (R14 — never a silent drop), and carry on with the next step.
      // The report stays honest about exactly which step failed and why.
      let landed: BringOverResult;
      try {
        landed = await this.executePlan(plan, { replayedFrom: step.id }, 'adoptPath', opts.as);
      } catch (error) {
        const detail = `replaying this step threw: ${error instanceof Error ? error.message : String(error)}`;
        this.gapLedger.file('guard-failed', 'adoptPath', detail, step.id);
        report.push({ commitId: step.id, applied: false, conflicts: plan.conflicts, skippedReason: detail });
        continue;
      }
      if (!landed.ok) {
        report.push({ commitId: step.id, applied: false, conflicts: plan.conflicts, skippedReason: landed.gap.detail });
        continue;
      }
      report.push({
        commitId: step.id,
        applied: true,
        recipe: plan.recipe,
        // Absent when the replay honestly landed nothing (a degenerate analysis
        // re-run spends no wealth and commits nothing — R14).
        ...(landed.commit ? { landedAs: landed.commit.id } : {}),
        conflicts: plan.conflicts,
      });
    }

    const applied = report.filter((s) => s.applied).length;
    return {
      ok: true,
      path: name,
      ancestor,
      steps: report,
      applied,
      skipped: report.length - applied,
      conflicts: [...new Set(report.flatMap((s) => s.conflicts))],
    };
  }

  /**
   * Rows (default table) under one tip's folded selections. Honest `null`
   * when the backend cannot serve rows — never a fake 0. Selections in a
   * session-authored log always target declared views (doProbe guard), so the
   * fold's selection entries are exactly the active filters at that tip.
   */
  private async rowsAtTip(tip: string): Promise<number | null> {
    const clauses: PredicateClause[] = [];
    for (const entry of foldStateAt(this.log.records, tip).values()) {
      if (entry.kind !== 'selection') continue;
      clauses.push(
        entry.clause.kind === 'cell'
          ? // a cell fold entry always carries its pair (fold.ts sets it from the record)
            { kind: 'cell', fields: entry.clause.fields!, value: entry.clause.value as CellClause['value'] }
          : // point, interval, match — the same builder the live path uses, so a match keeps its kind
            probeClause(entry.clause.kind, entry.clause.field, entry.clause.value),
      );
    }
    return this.selectedCount(this.defaultTable, clauses);
  }

  async compare(aRef: string, bRef: string): Promise<CompareResult> {
    // A ref is a path NAME when one exists, else it is taken as a commit id.
    const tipA = this.refs.tipOf(aRef) ?? aRef;
    const tipB = this.refs.tipOf(bRef) ?? bRef;
    const diff = foldDiff(this.log.records, tipA, tipB);
    if (!diff.ok) {
      const missing = diff.missing.join(', ');
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'compare', `unknown path or commit id(s): ${missing}`, missing) };
    }
    return {
      ok: true,
      a: { ref: aRef, tip: tipA, rows: await this.rowsAtTip(tipA) },
      b: { ref: bRef, tip: tipB, rows: await this.rowsAtTip(tipB) },
      ancestor: diff.ancestor,
      changed: diff.changed,
      onlyA: diff.onlyA,
      onlyB: diff.onlyB,
    };
  }

  // ── bring-over / undo (BR-1: plan via branches/, execute via NORMAL dispatch) ──

  async bringOver(commitId: string, opts: { as?: Actor } = {}): Promise<BringOverResult> {
    const plan = planBringOver(this.log.records, commitId, this._cursor);
    if (!plan.ok) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'bringOver', plan.detail, commitId) };
    }
    return this.executePlan(plan, { replayedFrom: commitId }, 'bringOver', opts.as);
  }

  async undo(commitId: string, opts: { as?: Actor } = {}): Promise<BringOverResult> {
    const plan = planUndo(this.log.records, commitId, this._cursor);
    if (!plan.ok) {
      return { ok: false, gap: this.gapLedger.file('guard-failed', 'undo', plan.detail, commitId) };
    }
    return this.executePlan(plan, { revertOf: commitId }, 'undo', opts.as);
  }

  /**
   * Execute a plan through the ONE dispatch entry (commit-on-intent stays in
   * one place — NO new verbs): the landed commit is ordinary, its cause
   * carries `replayedFrom`/`revertOf` (+ `conflicts` when the plan reported
   * any) — so the story survives serialization, replay, and /api/state.
   */
  private async executePlan(
    plan: { readonly recipe: PlanRecipe; readonly conflicts: readonly string[] },
    bookmark: { replayedFrom?: string; revertOf?: string },
    op: 'bringOver' | 'undo' | 'adoptPath',
    as: Actor | undefined,
  ): Promise<BringOverResult> {
    const actor = as ?? this.defaultActor;
    const cause: Cause = {
      requestedBy: actor,
      computedBy: actor,
      ...bookmark,
      ...(plan.conflicts.length > 0 ? { conflicts: plan.conflicts } : {}),
    };
    const action = this.actionForRecipe(plan.recipe, cause, op);
    if ('gap' in action) return { ok: false, gap: action.gap };
    // a replay (undo, bring-over, adopt) answers the current offer for its node when the session requires one —
    // the person chose the step; the offer is the position's stamp, not a second choice. A step whose view has
    // no such voice under THIS definition is refused in its own words (undo never called whats_here).
    let stamped: DispatchAction = action;
    if (this.requireOffer && (action.verb === 'select' || action.verb === 'filter')) {
      const stamp = this.offersNow().find((o) => o.viewId === action.viewId && o.kind === kindOfAct(action));
      if (stamp === undefined) {
        return { ok: false, gap: this.gapLedger.file('stale-offer', op, `this step selects on view "${action.viewId}" ${kindOfAct(action)}, which that view has no voice for — the definition changed since the step was landed`, action.viewId) };
      }
      stamped = { ...action, offerId: stamp.offerId };
    }
    const result = await this.dispatch(stamped, { as: actor });
    if (!result.ok) return { ok: false, gap: result.rejection };
    // An analyze recipe's record rides inside the AnalysisCommit (absent only
    // for a degenerate run, which honestly lands nothing); every other recipe
    // verb (select/filter/reencode/annotate) lands a top-level commit.
    const commit = plan.recipe.apply === 'analysis' ? result.analysis!.commit : result.commit!;
    return {
      ok: true,
      recipe: plan.recipe,
      conflicts: plan.conflicts,
      ...(commit ? { commit } : {}),
      result,
    };
  }

  /** Map a plan recipe onto the ordinary dispatch action that lands it. */
  private actionForRecipe(recipe: PlanRecipe, cause: Cause, op: 'bringOver' | 'undo' | 'adoptPath'): DispatchAction | { gap: GapRow } {
    switch (recipe.apply) {
      case 'selection':
        // D30: a cell recipe re-lands the COMPOUND (its pair rides the recipe).
        if (recipe.kind === 'cell') {
          return { verb: 'select', viewId: recipe.viewId, fields: recipe.fields!, values: recipe.value as CellValues, cause };
        }
        if (recipe.kind === 'match') {
          const body = recipe.value as Exclude<MatchValue, null>;
          return { verb: 'select', viewId: recipe.viewId, field: recipe.field, values: body.values, ...(body.exclude === true ? { exclude: true } : {}), cause };
        }
        return recipe.kind === 'point'
          ? { verb: 'select', viewId: recipe.viewId, field: recipe.field, value: recipe.value, cause }
          : { verb: 'filter', viewId: recipe.viewId, field: recipe.field, range: recipe.value as FilterRange, cause };
      case 'clear-selection':
        // Clearing is KIND-FAITHFUL: a cleared cell commit for a cell (D30 — the
        // recipe's `field` is the joint label, not a column), a cleared match
        // for a match, a cleared point for a point, a cleared interval otherwise.
        if (recipe.fields !== undefined) {
          return { verb: 'select', viewId: recipe.viewId, fields: recipe.fields, values: null, cause };
        }
        if (recipe.kind === 'match') return { verb: 'select', viewId: recipe.viewId, field: recipe.field, values: null, cause };
        if (recipe.kind === 'point') return { verb: 'select', viewId: recipe.viewId, field: recipe.field, value: undefined, cause };
        return { verb: 'filter', viewId: recipe.viewId, field: recipe.field, range: null, cause };
      case 'encoding':
        return { verb: 'reencode', viewId: recipe.viewId, channel: recipe.channel, field: recipe.field, cause };
      case 'clear-encoding': {
        // "Absent at parent" for an encoding means: restore the view's DECLARED
        // initial binding. The encoding commit being undone came from THIS
        // session's log, so doReencode already validated the view + its
        // declared encoding surface — both lookups are safe by construction.
        const initial = this.runtime.views.get(recipe.viewId)!.encoding!.initial?.[recipe.channel];
        if (initial === undefined) {
          return { gap: this.gapLedger.file('guard-failed', op, `view "${recipe.viewId}" declares no initial "${recipe.channel}" binding to restore`, recipe.viewId) };
        }
        return { verb: 'reencode', viewId: recipe.viewId, channel: recipe.channel, field: initial, cause };
      }
      case 'encoding-set': {
        // a null channel means "the declared initial" — resolved here, the same way clear-encoding does above
        const bindings: Record<string, string> = {};
        for (const [channel, field] of Object.entries(recipe.bindings)) {
          const resolved = field ?? this.runtime.views.get(recipe.viewId)!.encoding!.initial?.[channel];
          if (resolved === undefined) {
            return { gap: this.gapLedger.file('guard-failed', op, `view "${recipe.viewId}" declares no initial "${channel}" binding to restore`, recipe.viewId) };
          }
          bindings[channel] = resolved;
        }
        return { verb: 'reencode', viewId: recipe.viewId, bindings, cause };
      }
      case 'analysis':
        return { verb: 'analyze', analysisId: recipe.analysisId, cause };
      case 'annotation':
        return { verb: 'annotate', target: recipe.target, note: recipe.note, cause };
      case 'prose':
        // the plan layer types the record structurally (it imports only the log); doDescribe judges it again before landing
        return { verb: 'describe', viewId: recipe.viewId, slot: recipe.slot as ProseSlot, record: recipe.record as ProseRecord | null, cause };
      case 'link': {
        // the plan layer types the edge structurally (it imports only the log); the real LinkDecl narrows it back here
        const link = recipe.link as LinkDecl;
        return { verb: 'link', ...link, cause };
      }
      case 'clear-link': {
        const link = recipe.link as LinkDecl;
        return { verb: 'link', source: link.source, kind: link.kind, target: link.target, response: null, cause };
      }
      case 'layout':
        // LY-1: re-land the arrangement prop here through the navigate verb.
        return { verb: 'navigate', viewId: `${LAYOUT_VIEW_PREFIX}${recipe.scope}`, field: recipe.prop, value: recipe.value, cause };
    }
  }

  /** The materialized columns visible on the current cursor's branch path, for one table. */
  private visibleMaterialized(table: string): Set<string> {
    const out = new Set<string>();
    for (const rec of this.branchPath(this._cursor)) {
      const cols = this.materializedByCommit.get(rec.id);
      if (cols) for (const c of cols) if (c.table === table) out.add(c.name);
    }
    return out;
  }

  // ── ids ────────────────────────────────────────────────────────────────────
  /**
   * THE IDENTITY LAW: mint the next commit id from the DASHBOARD's counter, not
   * a session-local one. Two sessions on one `buildDashboard` used to both mint
   * `s1`, `s2`, `s3` — and because bookmarks and saved pictures live in a
   * dashboard-level store and NAME COMMIT IDS, a bookmark made in session A was
   * visible in session B and seeking it there silently landed on B's different
   * `s1`. The same name meant one act in A and another in B, with no error.
   *
   * The consequence is that a session's own log has GAPS in its numbering
   * (A holds `s1, s3`; B holds `s2, s4`). That is correct and expected:
   * nothing reads an id as a position — order is the parent chain and `ts` —
   * and the gaps are the visible sign that the identity is dashboard-wide.
   * The spelling is unchanged: still `s` + a number.
   */
  private nextId(): string {
    return `${COMMIT_ID_PREFIX}${++this.runtime.commitIds.minted}`;
  }

  // ── cause stamping (R1 / R12) ────────────────────────────────────────────────
  private stampCause(cause: Cause, verb: DispatchVerb, as: Actor | undefined): Cause {
    const validated = validateCause(cause); // R12 gate — never trusts caller shape
    const requestedBy: Actor = as ?? validated.requestedBy;
    // R1: an analysis is computedBy:'system' BY CONSTRUCTION — never caller-supplied.
    const computedBy: Actor = verb === 'analyze' ? 'system' : (as ?? validated.computedBy);
    const out: Cause = { requestedBy, computedBy };
    if (validated.intent !== undefined) out.intent = validated.intent;
    // BR-1 provenance tags ride the stamp untouched (validated inert data):
    // a bring-over/undo is an ORDINARY commit — its cause carries the story.
    if (validated.replayedFrom !== undefined) out.replayedFrom = validated.replayedFrom;
    if (validated.revertOf !== undefined) out.revertOf = validated.revertOf;
    if (validated.replacedBy !== undefined) out.replacedBy = validated.replacedBy; // a clear that makes room for a saved picture says so
    if (validated.conflicts !== undefined) out.conflicts = validated.conflicts;
    return out;
  }

  // ── data reads ───────────────────────────────────────────────────────────────
  // Both readers surface a provider REJECTION as a typed `{ rejected }` (never a
  // misleading empty array) so a REQUEST-boundary caller (doProbe / declareAnalysis)
  // can file a `needs-backend-data` gap rather than silently dropping (R14).
  private async allRows(table: string, clauses: readonly PredicateClause[] = []): Promise<readonly Row[] | { rejected: string }> {
    const provider = this.runtime.providerFor(table);
    if (!provider) return { rejected: `no provider for table "${table}"` };
    // the whole live selection is ONE query to the engine — the session never folds rows in JS after the answer
    const res = await provider.evaluate(table, clauses.length === 0 ? null : clauses, { mode: 'rows' });
    /* v8 ignore next -- every provider's reject() (memory/wasm/server, src/data/*Provider.ts) always supplies a `detail`; `res.reason` fallback is unreachable via the public API */
    if (isRejection(res)) return { rejected: res.detail ?? res.reason };
    /* v8 ignore next -- allRows always requests { mode: 'rows' }, and the only non-rejecting provider (memory) always sets `.rows` in that mode; the `?? []` fallback is unreachable via the public API */
    return res.rows ?? [];
  }

  private async columnsOf(table: string): Promise<readonly ColumnInfo[] | { rejected: string }> {
    const provider = this.runtime.providerFor(table);
    if (!provider) return { rejected: `no provider for table "${table}"` };
    const res = await provider.columns(table);
    /* v8 ignore next -- every provider's reject() (memory/wasm/server, src/data/*Provider.ts) always supplies a `detail`; `res.reason` fallback is unreachable via the public API */
    if (isRejection(res)) return { rejected: res.detail ?? res.reason };
    return res;
  }

  /**
   * The columns VISIBLE on the current cursor's branch (branch-scoped fold).
   * Base columns are always visible; a MATERIALIZED column (produced by an
   * analysis on some branch) is visible only when its producing commit is on the
   * cursor's path. This is where branch isolation for materialized columns is
   * enforced: the memory provider mutates its column store IN PLACE and cannot
   * un-materialize per branch (`materializeColumn`, memoryProvider.ts:235-257),
   * so `cluster_id` materialized on branch A physically persists in the shared
   * store — but the SESSION FOLD hides it on any branch whose path excludes the
   * clustering commit, so a `select cluster_id` on branch B is an honest
   * `needs-column` and `overview().columns` omits it there.
   */
  private async effectiveColumnsOf(table: string): Promise<readonly ColumnInfo[] | { rejected: string }> {
    const cols = await this.columnsOf(table);
    if ('rejected' in cols) return cols;
    if (this.allMaterialized.size === 0) return cols; // fast path: nothing materialized yet
    const visible = this.visibleMaterialized(table);
    return cols.filter((c) => !this.allMaterialized.has(`${table}::${c.name}`) || visible.has(c.name));
  }

  /**
   * The current channel→field visual-encoding map for one view, branch-scoped
   * at the cursor.
   *
   * DETACHED by FREEZING, not by copying. This used to hand back the live
   * cached object: mutating it changed what the next read said (`x: 'FORGED'`)
   * with no commit anywhere. A copy per call would also be correct, but this
   * is read several times per view per `overview()` and once per edge in the
   * encoding-link pass, and the fold only ever REPLACES these maps
   * (`set(id, {...current, …})`) — it never writes into one in place. So they
   * are frozen where they are stored, and handing out the object itself is
   * free and safe.
   */
  viewEncodings(viewId: string): Readonly<Record<string, string>> {
    return this.activeEncodings.get(viewId) ?? EMPTY_BINDINGS;
  }

  /**
   * Rows under the current selection (across all views). A pure best-effort
   * PROJECTION: a rejecting backend yields `[]` (the authoritative
   * `needs-backend-data` gap is filed at the request boundary, not here — a
   * projection called by `overview()` must not spam the ledger).
   */
  async selectedRows(table = this.defaultTable): Promise<readonly Row[]> {
    const rows = await this.allRows(table, [...this.activeFilters.values()]);
    return 'rejected' in rows ? [] : rows;
  }

  clausesFor(viewId: string): readonly ReachingClause[] {
    // one lookup per (source, kind) INTO this consumer — the same law the renderer contract applies (ui/src/contract/selection.ts)
    const into = new Map<string, LinkEdge>();
    for (const e of this.currentGraph().edges) if (e.target === viewId) into.set(`${e.source}|${e.kind}`, e);
    const reaches = (from: string, kind: string): LinkEdge | undefined => {
      if (from === viewId) return undefined; // never its own clause
      const edge = into.get(`${from}|${kind}`);
      // an encoding edge never matches a clause's kind, so `follow` cannot reach here; the guard keeps the type honest
      return edge === undefined || edge.response === 'none' || edge.response === 'follow' ? undefined : edge;
    };
    // the consumer gets its own copy: a clause handed out is never the session's live object
    const mapped = (edge: LinkEdge, clause: PredicateClause): PredicateClause => {
      const own = copyClause(clause);
      if (edge.mapping === undefined) return own;
      const to = (f: string): string => edge.mapping!.find((m) => m.from === f)?.to ?? f;
      return own.kind === 'cell' ? { ...own, fields: [to(own.fields[0]), to(own.fields[1])] } : { ...own, field: to(own.field) };
    };
    const out: ReachingClause[] = [];
    // a source that CLEARED still reaches a consumer whose edge says so: `leave` keeps the last clause, `excludeAll` keeps nothing, `showAll` (the default) = gone
    for (const [from, rec] of this.clearedFilters) {
      /* v8 ignore next -- every select door drops the view's cleared record when a live clause lands, so the two maps are disjoint; the guard enforces here what the doors maintain */
      if (this.activeFilters.has(from)) continue; // it is selecting again — the live clause speaks, and it is listed once
      const edge = reaches(from, rec.clause.kind);
      if (edge === undefined) continue;
      const policy = edge.onClear ?? 'showAll';
      if (policy === 'showAll') continue;
      const clause = mapped(edge, rec.clause);
      out.push({ from, response: edge.response, clause: policy === 'leave' ? clause : { kind: 'match', field: clause.kind === 'cell' ? clause.fields[0] : clause.field, values: [] } });
    }
    for (const [from, clause] of this.activeFilters) {
      const edge = reaches(from, clause.kind);
      if (edge === undefined) continue;
      out.push({ from, response: edge.response, clause: mapped(edge, clause) });
    }
    return out;
  }

  async viewQuery(query: ViewQuery = {}): Promise<ViewQueryResult> {
    const table = query.table ?? this.defaultTable;
    if (!this.runtime.tables.includes(table)) return { ok: false, reason: 'unknown-table', rejected: `no table "${table}" is declared — the tables are ${this.runtime.tables.join(', ')}` };
    if (query.viewId !== undefined && !this.runtime.views.has(query.viewId)) return { ok: false, reason: 'unknown-view', rejected: `no declared view "${query.viewId}" — the views are ${[...this.runtime.views.keys()].join(', ')}` };
    const provider = this.runtime.providerFor(table);
    // the version is read in the SAME instant as the provider, and checked again after the rows: a refresh landing anywhere in between is a moved version, never a misdated window
    const version = this.runtime.sources[table]?.version ?? null;
    /* v8 ignore next -- every declared table resolves a provider (the def validator refuses an unknown engine; the stubs are providers too) */
    if (!provider) return { ok: false, reason: 'engine', rejected: `no provider for table "${table}"` };
    const sorted = query.sort !== undefined && query.sort.length > 0;
    if (sorted && provider.capabilities.canSort !== true) return { ok: false, reason: 'unsupported-sort', rejected: `the ${provider.engine} engine cannot sort. Ask for this window without a sort` };
    // whose eyes: a view sees what reaches it; no view = the whole-dashboard truth, every live clause filtering (what selectedRowCount counts)
    const clauses: ReachingClause[] = query.viewId === undefined ? [...this.activeFilters].map(([from, clause]) => ({ from, clause: copyClause(clause), response: 'filter' as const })) : [...this.clausesFor(query.viewId)];
    const filters = clauses.filter((c) => c.response === 'filter').map((c) => c.clause);
    const key = this.runtime.def.data[table]!.key; // the table is declared: its def row exists
    let columns = query.columns;
    if (columns === undefined) {
      const cols = await this.effectiveColumnsOf(table);
      if ('rejected' in cols) return { ok: false, reason: 'no-columns', rejected: cols.rejected };
      columns = cols.map((c) => c.name);
    }
    if (key !== undefined && !columns.includes(key)) columns = [...columns, key]; // identity rides every window
    const cursor = this._cursor;
    const res = await provider.evaluate(table, filters.length === 0 ? null : filters, {
      mode: 'rows',
      columns,
      indices: true,
      offset: query.offset ?? 0,
      limit: query.limit ?? VIEW_QUERY_DEFAULT_LIMIT,
      ...(sorted ? { sort: query.sort } : {}),
    });
    if (isRejection(res)) {
      /* v8 ignore next -- every provider's reject() supplies a `detail`; the `reason` fallback is unreachable through the public engines */
      let rejected = res.detail ?? res.reason;
      // a column a link's mapping invented is the link's doing — say so, or the person cannot find it (judged against the table's own columns, never the projection)
      if (res.reason === 'unknown-column') {
        const own = await this.columnsOf(table);
        /* v8 ignore next -- the engine just named a column it lacks, so it can list the ones it has; the rejected arm keeps the type honest */
        const has = new Set('rejected' in own ? [] : own.map((c) => c.name));
        const invented = this.mappingsInto(query.viewId).filter((m) => !has.has(m.to));
        if (invented.length > 0) rejected += ` — ${invented.map((m) => `the link from ${m.from} maps ${m.field} → ${m.to}`).join('; ')}`;
      }
      return { ok: false, reason: 'engine', engineReason: res.reason, rejected };
    }
    const after = this.runtime.sources[table]?.version ?? null;
    if (after !== version) return { ok: false, reason: 'version-moved', rejected: `table "${table}" was refreshed while the window was read — ask again` };
    /* v8 ignore next -- rows mode always sets `rows` on the memory engine, the only engine that answers today */
    const rows = res.rows ?? [];
    /* v8 ignore next -- `indices: true` always sets `indices` on the memory engine, the only engine that answers today */
    const indices = res.indices ?? [];
    const rowIds = rows.map((row, i) => (key !== undefined ? String(row[key]) : `${version ?? 'inline'}#${indices[i]}`));
    /* v8 ignore next -- an offset is always sent, so `start` is always answered */
    return { ok: true, columns, rows, rowIds, positional: key === undefined, ...(key !== undefined ? { key } : {}), count: res.count, start: res.start ?? 0, version, cursor, clauses };
  }

  // ── bookmarks: names on moments beside the log ────────────────────────────────────

  bookmarks(): readonly Bookmark[] {
    return [...this.runtime.bookmarks.list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((t) => ({ ...t }));
  }

  /** Replace (or, with null, remove) a bookmark by its id — the identity a rename never moves. */
  private replaceBookmark(id: string, next: Bookmark | null): void {
    const store = this.runtime.bookmarks;
    const at = store.list.findIndex((t) => t.id === id);
    if (next === null) store.list.splice(at, 1);
    else store.list[at] = next;
  }

  bookmark(name: string, commitId?: string, as: Actor = 'user', description?: string): BookmarkResult {
    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, rejected: 'a bookmark needs a name' };
    if (trimmed.length > 200) return { ok: false, rejected: 'a bookmark name is at most 200 characters' };
    const target = commitId ?? this._cursor;
    if (target === null) return { ok: false, rejected: 'nothing to bookmark yet — act first' };
    if (!this.log.records.some((r) => r.id === target)) return { ok: false, rejected: `no commit "${target}" in the log` };
    const taken = this.bookmarks().find((t) => t.name === trimmed);
    if (taken !== undefined) return { ok: false, rejected: taken.commitId === target ? `"${trimmed}" already names this moment` : `"${trimmed}" already names #${taken.commitId} — a bookmark is one moment; rename or forget it first` };
    const words = description?.trim();
    if (words !== undefined && words.length > 2000) return { ok: false, rejected: 'a bookmark description is at most 2000 characters' };
    const bookmark: Bookmark = { id: mintRecordId(BOOKMARK_ID_PREFIX, this.runtime.bookmarks), name: trimmed, commitId: target, ...(words !== undefined && words.length > 0 ? { description: words } : {}), by: as, at: new Date().toISOString() };
    this.runtime.bookmarks.list.push(bookmark);
    return { ok: true, bookmark };
  }

  renameBookmark(from: string, to: string, as: Actor = 'user'): BookmarkResult {
    const next = to.trim();
    if (next.length === 0) return { ok: false, rejected: 'a bookmark needs a name' };
    if (next.length > 200) return { ok: false, rejected: 'a bookmark name is at most 200 characters' };
    const current = this.bookmarks().find((t) => t.name === from);
    if (current === undefined) return { ok: false, rejected: `no bookmark "${from}" — the bookmarks are ${this.bookmarkNames()}` };
    if (next === from) return { ok: true, bookmark: current }; // the name it already has: nothing changed, so no edit is recorded
    if (this.bookmarks().some((t) => t.name === next)) return { ok: false, rejected: `"${next}" is already a bookmark — rename or forget it first` };
    // renaming is free: a note links the bookmark's id, so no link can break — only the words it shows may go stale
    const renamed: Bookmark = { ...current, name: next, editedBy: as, editedAt: new Date().toISOString() };
    this.replaceBookmark(current.id, renamed);
    return { ok: true, bookmark: renamed };
  }

  describeBookmark(name: string, description: string | null, as: Actor = 'user'): BookmarkResult {
    const current = this.bookmarks().find((t) => t.name === name);
    if (current === undefined) return { ok: false, rejected: `no bookmark "${name}" — the bookmarks are ${this.bookmarkNames()}` };
    const words = description?.trim();
    if (words !== undefined && words.length > 2000) return { ok: false, rejected: 'a bookmark description is at most 2000 characters' };
    const { description: _old, ...rest } = current;
    const next: Bookmark = { ...rest, ...(words !== undefined && words.length > 0 ? { description: words } : {}), editedBy: as, editedAt: new Date().toISOString() };
    this.replaceBookmark(current.id, next);
    return { ok: true, bookmark: next };
  }

  forgetBookmark(name: string): BookmarkResult {
    const current = this.bookmarks().find((t) => t.name === name);
    if (current === undefined) return { ok: false, rejected: `no bookmark "${name}" — the bookmarks are ${this.bookmarkNames()}` };
    // forgetting really would break a link: the words point at this id and nothing would answer
    const linked = this.wordsLinking('bookmark', current.id);
    if (linked.length > 0) return { ok: false, rejected: `"${name}" is linked from ${linked.join(', ')} — change the link in the words first` };
    this.replaceBookmark(current.id, null);
    return { ok: true, bookmark: current };
  }

  restoreBookmarks(list: readonly RestorableBookmark[]): RestoreResult {
    const ids = new Set(this.log.records.map((r) => r.id));
    return restoreBookmarksInto(this.runtime.bookmarks, list, this.runtime.commitIds, (id) => ids.has(id));
  }

  private bookmarkNames(): string {
    const names = this.bookmarks().map((t) => `"${t.name}"`);
    return names.length === 0 ? 'none' : names.join(', ');
  }

  // ── saved selections: saved logic beside the log ─────────────────────────────

  saved(): readonly SavedSelection[] {
    // oldest first by the time saved; a consumer gets its own copies, never the store's objects
    return [...this.runtime.saved.list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((c) => structuredClone(c));
  }

  /** Replace (or, with null, remove) a saved selection by its id — the identity a rename never moves. */
  private replaceSaved(id: string, next: SavedSelection | null): void {
    const store = this.runtime.saved;
    const at = store.list.findIndex((c) => c.id === id);
    if (next === null) store.list.splice(at, 1);
    else store.list[at] = next;
  }

  restoreSaved(list: readonly RestorableSaved[]): RestoreResult {
    return restoreSavedInto(this.runtime.saved, list, new Set(this.runtime.views.keys()), this.runtime.commitIds);
  }

  saveSelection(name: string, source: SaveSelectionSource, as: Actor = 'user'): SaveSelectionResult {
    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, rejected: 'a saved selection needs a name' };
    if (this.saved().some((c) => c.name === trimmed)) return { ok: false, rejected: `"${trimmed}" is already saved — rename or forget it first` };
    const gathered = this.gatherConditions(source);
    if ('rejected' in gathered) return { ok: false, rejected: gathered.rejected };
    const on = { table: this.defaultTable, version: this.runtime.sources[this.defaultTable]?.version ?? null };
    const saved: SavedSelection = { id: mintRecordId(PICTURE_ID_PREFIX, this.runtime.saved), name: trimmed, conditions: gathered.conditions, by: as, at: new Date().toISOString(), on, ...(gathered.from.length > 0 ? { from: gathered.from } : {}) };
    this.runtime.saved.list.push(saved);
    return { ok: true, saved };
  }

  /** The conditions a source names, judged: every live clause, one view's live clause, or explicit ones (each with a declared view, a field or pair, and a value). */
  private gatherConditions(source: SaveSelectionSource): { readonly conditions: readonly SavedClause[]; readonly from: readonly string[] } | { readonly rejected: string } {
    if ('live' in source) {
      if (this.activeFilters.size === 0) return { rejected: 'nothing is selected to save' };
      const conditions: SavedClause[] = [];
      const from: string[] = [];
      for (const [viewId, clause] of this.activeFilters) {
        conditions.push(clauseOfLive(viewId, clause));
        const commit = this.activeFilterCommits.get(viewId);
        /* v8 ignore next -- every live clause was landed by a door that records its commit beside it; the arm keeps the type honest */
        if (commit !== undefined) from.push(commit);
      }
      return { conditions, from };
    }
    if ('viewId' in source) {
      if (!this.runtime.views.has(source.viewId)) return { rejected: `no declared view "${source.viewId}" — the views are ${[...this.runtime.views.keys()].join(', ')}` };
      const live = this.activeFilters.get(source.viewId);
      if (live === undefined) return { rejected: `"${source.viewId}" has nothing selected to save` };
      const commit = this.activeFilterCommits.get(source.viewId);
      /* v8 ignore next -- every live clause was landed by a door that records its commit beside it; the arm keeps the type honest */
      return { conditions: [clauseOfLive(source.viewId, live)], from: commit !== undefined ? [commit] : [] };
    }
    if (!Array.isArray(source.conditions) || source.conditions.length === 0) return { rejected: 'a saved selection needs at least one condition' };
    const conditions: SavedClause[] = [];
    const seen = new Set<string>();
    for (const c of source.conditions) {
      if (!this.runtime.views.has(c.viewId)) return { rejected: `no declared view "${c.viewId}" — the views are ${[...this.runtime.views.keys()].join(', ')}` };
      if (seen.has(c.viewId)) return { rejected: `the picture already has a condition on "${c.viewId}" — one condition per view` };
      seen.add(c.viewId);
      if (c.kind === 'cell') {
        if (c.fields === undefined) return { rejected: `a cell condition on "${c.viewId}" needs its two fields` };
      } else if (typeof c.field !== 'string' || c.field.length === 0) {
        return { rejected: `a ${c.kind} condition on "${c.viewId}" needs a field` };
      }
      if (c.value === undefined) return { rejected: `the condition on "${c.viewId}" needs a value — an interval its bounds, a match its values, a point its value` };
      conditions.push({
        viewId: c.viewId,
        kind: c.kind,
        field: c.kind === 'cell' ? cellFieldLabel(c.fields!) : c.field,
        ...(c.kind === 'cell' ? { fields: [c.fields![0], c.fields![1]] as const } : {}),
        value: copyValue(c.value),
      });
    }
    return { conditions, from: [] };
  }

  renameSaved(from: string, to: string, as: Actor = 'user'): SaveSelectionResult {
    const next = to.trim();
    if (next.length === 0) return { ok: false, rejected: 'a saved selection needs a name' };
    const current = this.saved().find((c) => c.name === from);
    if (current === undefined) return { ok: false, rejected: `no saved selection "${from}" — the saved ones are ${this.savedNames()}` };
    if (next === from) return { ok: true, saved: current }; // the name it already has: nothing changed, so no edit is recorded
    if (this.saved().some((c) => c.name === next)) return { ok: false, rejected: `"${next}" is already saved — rename or forget it first` };
    // renaming is free: a note links the picture's id, so no link can break — only the words it shows may go stale
    const renamed: SavedSelection = { ...current, name: next, editedBy: as, editedAt: new Date().toISOString() };
    this.replaceSaved(current.id, renamed);
    return { ok: true, saved: renamed };
  }

  forgetSaved(name: string): SaveSelectionResult {
    const current = this.saved().find((c) => c.name === name);
    if (current === undefined) return { ok: false, rejected: `no saved selection "${name}" — the saved ones are ${this.savedNames()}` };
    // forgetting really would break a link: the words point at this id and nothing would answer
    const linked = this.notesLinking(current.id);
    if (linked.length > 0) return { ok: false, rejected: `"${name}" is linked from ${linked.join(', ')} — change the link in the words first` };
    this.replaceSaved(current.id, null);
    return { ok: true, saved: current };
  }

  async applySaved(name: string, cause: Cause, opts: ApplySavedOptions = {}): Promise<ApplySavedResult> {
    const saved = this.saved().find((c) => c.name === name);
    if (saved === undefined) return { ok: false, rejected: `no saved selection "${name}" — the saved ones are ${this.savedNames()}` };
    // JUDGE FIRST, CLEAR SECOND: a condition on a view no longer here, or on a field the table no longer has, is refused before anything is touched — an apply that could land nothing clears nothing
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) return { ok: false, rejected: `"${name}" cannot be applied here — ${cols.rejected}` }; // the select door would refuse every condition without the columns: say so before clearing anything
    const has = new Set(cols.map((c) => c.name));
    const refused: { viewId: string; rejected: string }[] = [];
    const landable: SavedClause[] = [];
    for (const c of saved.conditions) {
      if (!this.runtime.views.has(c.viewId)) {
        refused.push({ viewId: c.viewId, rejected: `"${c.viewId}" is no longer on the dashboard` });
        continue;
      }
      const missing = (c.kind === 'cell' ? [...c.fields!] : [c.field]).find((f) => !has.has(f));
      if (missing !== undefined) {
        refused.push({ viewId: c.viewId, rejected: `table "${this.defaultTable}" no longer has the column "${missing}"` });
        continue;
      }
      const cannot = this.probeGuard(c.viewId, c.kind);
      if (cannot !== null) {
        refused.push({ viewId: c.viewId, rejected: cannot });
        continue;
      }
      landable.push(c);
    }
    if (landable.length === 0) return { ok: false, rejected: `"${name}" cannot be applied here — ${refused.map((r) => r.rejected).join('; ')}` };
    const correlationId = `saved:${name}#${this.log.records.length}`; // one id for the whole batch: the rail folds it (undo is per commit today)
    const intent = cause.intent !== undefined ? `${cause.intent} — applied saved selection ${name}` : `applied saved selection ${name}`; // the name always rides the cause
    const stamped: Cause = { ...cause, intent };
    const dispatchOpts = opts.as !== undefined ? { as: opts.as } : {};
    const applied: CommitRecord[] = [];
    const cleared: CommitRecord[] = [];
    // replace: the picture comes back — every live filter on a view the picture does not name is cleared first, kind-faithfully, and marked as making room (no link remembers it)
    if ((opts.mode ?? 'replace') === 'replace') {
      const named = new Set(saved.conditions.map((c) => c.viewId));
      const making: Cause = { ...stamped, replacedBy: name };
      for (const [viewId, clause] of [...this.activeFilters]) {
        if (named.has(viewId)) continue;
        const r = await this.dispatch({ ...clearAction(viewId, clause, making), correlationId }, dispatchOpts);
        /* v8 ignore next -- clearing a live clause on a declared view is never refused; the arm keeps the result honest */
        if (r.ok && r.commit !== undefined) cleared.push(r.commit);
      }
    }
    for (const c of landable) {
      const r = await this.dispatch({ ...selectionAction(c, stamped), correlationId }, dispatchOpts);
      /* v8 ignore next 4 -- the pre-flight judges every refusal the doors know (view, columns, capability); the arm keeps the result honest for one they do not */
      if (!r.ok) {
        refused.push({ viewId: c.viewId, rejected: r.rejection.detail });
        continue;
      }
      /* v8 ignore next -- a landed select/filter always carries its commit; the arm keeps the type honest */
      if (r.commit !== undefined) applied.push(r.commit);
    }
    return { ok: true, name, correlationId, applied, cleared, refused };
  }

  /** The notes on screen whose words link a saved selection by its id — forgetting it would break their links. */
  private notesLinking(id: string): string[] {
    return this.wordsLinking('saved', id);
  }

  /** The words on screen (notes, the dashboard's, a view's) whose refs link a record by `field` and id — forgetting it would break their links. */
  private wordsLinking(field: 'saved' | 'bookmark', id: string): string[] {
    const out: string[] = [];
    for (const [subject, slots] of this.activeProse) {
      for (const record of slots.values()) {
        if (record.refs?.some((r) => r[field] === id)) {
          out.push(subject.startsWith(NOTE_PROSE_PREFIX) ? `note ${subject.slice(NOTE_PROSE_PREFIX.length)}` : subject);
          break;
        }
      }
    }
    return out;
  }

  /** The saved names, for a refusal sentence — or "none" when nothing is saved. */
  private savedNames(): string {
    const names = this.saved().map((c) => `"${c.name}"`);
    return names.length === 0 ? 'none' : names.join(', ');
  }

  /**
   * The saved selections an OLDER log recorded as annotations on selection
   * commits (the note's `field` names the commit, its `value` the name) —
   * read as one-condition pictures so nothing already recorded is lost.
   * Newest wins per commit and per name.
   */

  /** The field mappings on the edges INTO a view (none for the whole-dashboard truth): which names a link invented for this consumer. */
  private mappingsInto(viewId: string | undefined): readonly { readonly from: string; readonly field: string; readonly to: string }[] {
    if (viewId === undefined) return [];
    const out: { from: string; field: string; to: string }[] = [];
    for (const e of this.currentGraph().edges) {
      if (e.target !== viewId || e.mapping === undefined) continue;
      for (const m of e.mapping) out.push({ from: e.source, field: m.from, to: m.to }); // an identity pair names a real column and is never picked as invented
    }
    return out;
  }

  /** How many rows the live selection keeps — the engine counts; no row is materialised. */
  private async selectedCount(table: string, clauses: readonly PredicateClause[]): Promise<number | null> {
    const provider = this.runtime.providerFor(table);
    if (!provider) return null;
    const res = await provider.evaluate(table, clauses.length === 0 ? null : clauses, { mode: 'count' });
    return isRejection(res) ? null : res.count;
  }

  /** Resolve a declared analysis's input rows, surfacing a backend rejection (R14). */
  private async resolveAnalysisInput(
    producesColumns: boolean,
    table: string,
  ): Promise<readonly Row[] | { rejected: string }> {
    // Columns-channel analyses run over the FULL table (materialized values must
    // align to the row order); every other channel runs over the selection — one query either way.
    return this.allRows(table, producesColumns ? [] : [...this.activeFilters.values()]);
  }

  // ── capability resolution (R14 / R3) ─────────────────────────────────────────
  private probeCapability(
    viewId: string,
  ): { canProbe: boolean; encodings?: readonly ('point' | 'interval' | 'cell' | 'match')[] } | undefined {
    const adapter = this.adapters.get(viewId);
    if (adapter) return adapter.capabilities;
    const view = this.runtime.views.get(viewId);
    if (view?.capability) {
      return {
        canProbe: view.capability.canProbe,
        ...(view.capability.encodings ? { encodings: view.capability.encodings } : {}),
      };
    }
    return undefined;
  }

  /** Returns a `guard-failed` detail string if the view cannot accept this probe, else null. */
  private probeGuard(viewId: string, kind: 'point' | 'interval' | 'cell' | 'match'): string | null {
    const cap = this.probeCapability(viewId);
    if (!cap) return null; // no capability declared → default allow
    if (!cap.canProbe) return `view "${viewId}" declares no-probe capability`;
    if (cap.encodings !== undefined && !impliedKinds(cap.encodings).includes(kind)) {
      return `view "${viewId}" does not encode a ${kind} selection`;
    }
    return null;
  }

  // ── link (layer 4) — edit ONE edge of the graph, as a commit ───────────────────
  private doLink(action: Extract<DispatchAction, { verb: 'link' }>, as: Actor | undefined, intent: DispatchResult['intent']): DispatchResult {
    const { source, kind, target, response, mapping, channels, onClear, fold, cause, correlationId } = action;
    const id = edgeId(source, kind, target);
    // the same refusals a declared edge gets, in the same sentences (the response may be null = un-declare)
    const problems: string[] = [];
    const probe: LinkDecl = { source, kind, target, response: response ?? 'none', ...(mapping !== undefined ? { mapping } : {}), ...(channels !== undefined ? { channels } : {}), ...(onClear !== undefined ? { onClear } : {}), ...(fold !== undefined ? { fold } : {}) };
    validateLinks([probe], undefined, this.runtime.links.views, problems);
    if (problems.length > 0) {
      return this.reject('link', intent, this.gapLedger.file('guard-failed', 'link', problems.map((p) => p.replace(/^links\[0\]/, `link ${id}`)).join('; '), id));
    }
    const value: LinkDecl | null = response === null ? null : probe;
    const stamped = this.stampCause(cause, 'link', as);
    const { record } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor,
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId: linkViewId(id),
      actorMeta: this.runtime.views.get(source)!.meta,
      kind: 'point',
      field: 'response',
      value,
      cause: stamped,
    });
    this.landed(record);
    if (value === null) this.activeLinks.delete(id);
    else this.activeLinks.set(id, value);
    const linked = applyLinkOverrides(this.runtime.links, this.activeLinks).edges.find((e) => e.id === id);
    return { ok: true, verb: 'link', intent, commit: record, ...(linked !== undefined ? { linked } : {}) };
  }

  // ── mountView (R3) ───────────────────────────────────────────────────────────
  mountView(viewId: string, adapter: ViewAdapter): { ok: true } | { ok: false; gap: GapRow } {
    if (!this.runtime.views.has(viewId)) {
      return { ok: false, gap: this.gapLedger.file('needs-view', 'mountView', `no declared view "${viewId}"`, viewId) };
    }
    this.adapters.set(viewId, adapter);
    return { ok: true };
  }

  // ── dispatch (R4) ─────────────────────────────────────────────────────────────
  async dispatch(action: DispatchAction, opts: { as?: Actor } = {}): Promise<DispatchResult> {
    const verb = action.verb;
    const intent = this.runtime.intentOf(verb);
    const as = opts.as;
    switch (action.verb) {
      case 'select': {
        const stale = this.offerGuard('select', action.viewId, kindOfAct(action), action.offerId, intent);
        if (stale !== null) return stale;
        // D30: the cell form of `select` (fields+values) is the compound-cell
        // gesture — one gesture, ONE commit; the plain form stays the point probe.
        if ('fields' in action) {
          return this.doCellProbe(action.viewId, action.fields, action.values, action.cause, as, intent, action.correlationId);
        }
        if ('values' in action) {
          // SET-1: the MATCH form — many values on one field, optional exclude; `values: null` clears.
          // ONE shape guard at the boundary (the doors need not each re-check): a typed gap, never a raw TypeError.
          if (action.values !== null && !Array.isArray(action.values)) {
            return this.reject('select', intent, this.gapLedger.file('guard-failed', 'select', 'select.values must be an array of values, or null to clear the match', action.field));
          }
          const value: MatchValue = action.values === null ? null : { values: action.values, ...(action.exclude === true ? { exclude: true } : {}) };
          return this.doProbe(action.viewId, action.field, value, 'match', action.cause, as, intent, action.correlationId);
        }
        return this.doProbe(action.viewId, action.field, action.value, 'point', action.cause, as, intent, action.correlationId);
      }
      case 'filter': {
        const stale = this.offerGuard('filter', action.viewId, 'interval', action.offerId, intent);
        if (stale !== null) return stale;
        return this.doProbe(
          action.viewId,
          action.field,
          action.range,
          'interval',
          action.cause,
          as,
          intent,
          action.correlationId,
        );
      }
      case 'annotate':
        return this.doAnnotate(action.target, action.note, action.cause, as, intent);
      case 'link':
        return this.doLink(action, as, intent);
      case 'describe':
        if (action.accept !== undefined) return this.doAccept(action.viewId, action.slot, action.accept, action.cause, as, intent, action.correlationId);
        if (action.decline !== undefined) return this.doDecline(action.viewId, action.slot, action.decline, action.cause, as, intent, action.correlationId);
        if (action.proposal === true) return this.doPropose(action.viewId, action.slot, action.record, action.cause, as, intent, action.correlationId);
        return this.doDescribe(action.viewId, action.slot, action.record, action.cause, as, intent, action.correlationId);
      case 'navigate':
        return this.doNavigate(action.viewId, action.field, action.value, action.cause, as, intent, action.correlationId);
      case 'analyze':
        return this.doAnalyze(action.analysisId, action.input, action.cause, as, intent, action.correlationId);
      case 'fork':
        return this.doFork(action.fromCommitId, intent);
      case 'bookmark':
        return this.doBookmark(action.label, action.cause, as, intent);
      case 'reencode':
        return 'bindings' in action
          ? this.doReencodeSet(action.viewId, action.bindings, action.cause, as, intent, action.correlationId)
          : this.doReencode(action.viewId, action.channel, action.field, action.cause, as, intent, action.correlationId);
    }
  }

  private reject(verb: DispatchVerb, intent: DispatchResult['intent'], gap: GapRow): DispatchResult {
    return { ok: false, verb, intent, rejection: gap };
  }

  private async doProbe(
    viewId: string,
    field: string,
    value: unknown,
    kind: 'point' | 'interval' | 'match',
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    const verb: DispatchVerb = kind === 'interval' ? 'filter' : 'select';
    // 1. the view must be declared (R14: needs-view).
    if (!this.runtime.views.has(viewId)) {
      return this.reject(verb, intent, this.gapLedger.file('needs-view', verb, `no declared view "${viewId}"`, viewId));
    }
    // 2. the view's capability guard (R14: guard-failed).
    const guard = this.probeGuard(viewId, kind);
    if (guard) return this.reject(verb, intent, this.gapLedger.file('guard-failed', verb, guard, viewId));
    // 2b. a probe may not target a reserved session field (R6: keep the log's
    //     test-analog channel uncorruptible by an ordinary select/filter).
    if (RESERVED_PROBE_FIELDS.has(field)) {
      return this.reject(verb, intent, this.gapLedger.file('guard-failed', verb, `field "${field}" is reserved by the session and cannot be selected on`, field));
    }
    // 3. the field must be a column VISIBLE on this branch (R14: needs-column /
    //    needs-backend-data). A materialized column absent from the cursor's
    //    branch fold is honestly `needs-column` here — branch isolation.
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) {
      return this.reject(verb, intent, this.gapLedger.file('needs-backend-data', verb, cols.rejected, field));
    }
    if (!cols.some((c) => c.name === field)) {
      return this.reject(verb, intent, this.gapLedger.file('needs-column', verb, `no column "${field}" in table "${this.defaultTable}"`, field));
    }
    // 4. land the cause-tagged clause commit (commit-on-intent) + update the active filter set.
    //    Parent is the CURSOR: a probe from a past cursor branches (R8 branch-on-act).
    const stamped = this.stampCause(cause, verb, as);
    const { record, clause } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor,
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId,
      actorMeta: this.runtime.views.get(viewId)!.meta,
      kind,
      field,
      value,
      cause: stamped,
    });
    this.landed(record);
    if (isClearedSelection({ kind, value })) {
      if (record.cause.revertOf === undefined && record.cause.replacedBy === undefined) this.noteCleared(viewId, record.id); // an undo takes the selection back, it does not "clear" it; nor does a clear that makes room for a saved picture
      this.activeFilters.delete(viewId);
      this.activeFilterCommits.delete(viewId); // a cleared selection is no longer an input dependency
    } else {
      this.clearedFilters.delete(viewId);
      this.activeFilters.set(viewId, probeClause(kind, field, value));
      this.activeFilterCommits.set(viewId, record.id); // a superseded select on the same view drops out here
    }
    // R3 inbound: hand the resolved clause to a mounted adapter to re-render.
    this.adapters.get(viewId)?.applyClause?.(clause as CauseClause);
    return { ok: true, verb, intent, commit: record };
  }

  /**
   * The CELL probe (D30): one heatmap-cell gesture selects on TWO fields at
   * once and lands ONE cause-tagged commit whose predicate is the AND of both
   * sides — the ruling is one gesture = one commit, never two
   * correlationId-linked ones. Rides the `select` verb (mandatory-analytical;
   * the vocabulary stays at 8 verbs) and the SAME fold key
   * (`selection:${viewId}`, last-wins per view), so branching / compare /
   * time-travel machinery is untouched by construction. `values: null`
   * clears the cell exactly like a cleared interval.
   */
  private async doCellProbe(
    viewId: string,
    fields: readonly [string, string],
    values: CellValues,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    const verb: DispatchVerb = 'select';
    // 1. the view must be declared (R14: needs-view).
    if (!this.runtime.views.has(viewId)) {
      return this.reject(verb, intent, this.gapLedger.file('needs-view', verb, `no declared view "${viewId}"`, viewId));
    }
    // 2. the view's capability guard (R14: guard-failed) — a cell must be a
    //    DECLARED emission kind (the classic charts honestly do not emit cells).
    const guard = this.probeGuard(viewId, 'cell');
    if (guard) return this.reject(verb, intent, this.gapLedger.file('guard-failed', verb, guard, viewId));
    // 2b. a cell is a TWO-field gesture — the same field twice is almost
    //     certainly a caller bug, refused honestly rather than landing a
    //     double constraint that looks like a heatmap cell but is not one.
    if (fields[0] === fields[1]) {
      return this.reject(verb, intent, this.gapLedger.file('guard-failed', verb, `a cell selects on two DIFFERENT fields — got "${fields[0]}" twice`, fields[0]));
    }
    // 2c. neither side may target a reserved session field (R6, both sides).
    for (const field of fields) {
      if (RESERVED_PROBE_FIELDS.has(field)) {
        return this.reject(verb, intent, this.gapLedger.file('guard-failed', verb, `field "${field}" is reserved by the session and cannot be selected on`, field));
      }
    }
    // 3. BOTH fields must be columns VISIBLE on this branch (R14: needs-column
    //    / needs-backend-data) — the doProbe guard, applied to each side.
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) {
      return this.reject(verb, intent, this.gapLedger.file('needs-backend-data', verb, cols.rejected, fields[0]));
    }
    for (const field of fields) {
      if (!cols.some((c) => c.name === field)) {
        return this.reject(verb, intent, this.gapLedger.file('needs-column', verb, `no column "${field}" in table "${this.defaultTable}"`, field));
      }
    }
    // 4. land ONE cause-tagged compound commit (commit-on-intent). Parent is
    //    the CURSOR: a cell select from a past cursor branches (R8), like doProbe.
    const stamped = this.stampCause(cause, verb, as);
    const { record, clause } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor,
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId,
      actorMeta: this.runtime.views.get(viewId)!.meta,
      kind: 'cell',
      field: cellFieldLabel(fields), // display-only joint label; the pair is authoritative
      fields: [fields[0], fields[1]],
      value: values,
      cause: stamped,
    });
    this.landed(record);
    if (values === null) {
      if (record.cause.revertOf === undefined && record.cause.replacedBy === undefined) this.noteCleared(viewId, record.id); // an undo takes the selection back, it does not "clear" it; nor does a clear that makes room for a saved picture — the same rule as the point door
      this.activeFilters.delete(viewId); // a cleared cell releases the view's filter
      this.activeFilterCommits.delete(viewId);
    } else {
      this.clearedFilters.delete(viewId); // a live cell speaks for itself: nothing cleared is remembered beside it
      const cell: CellClause = { kind: 'cell', fields: [fields[0], fields[1]], value: values };
      this.activeFilters.set(viewId, cell);
      this.activeFilterCommits.set(viewId, record.id);
    }
    // R3 inbound: hand the resolved clause to a mounted adapter to re-render.
    this.adapters.get(viewId)?.applyClause?.(clause as CauseClause);
    return { ok: true, verb, intent, commit: record };
  }

  /**
   * `reencode` — rebind a view's visual CHANNEL to a different data field (the
   * 8th dispatch verb; SPEC Q6, orchestrator-adjudicated). A state-changing
   * transition, same class as `doProbe`: one cause-tagged commit, parented at
   * the cursor (R8 branch-on-act), folded by `rebuildFold` on `seek`.
   *
   * Lands under the `encoding:${viewId}` synthetic identity (mirrors
   * `doAnnotate`'s `annotation:${actor}` / `declareAnalysis`'s `analysis:${id}`
   * pattern above) rather than a new `CommitRecord.kind` — `field` carries the
   * CHANNEL, `value` carries the target field name, both plain strings.
   */
  /**
   * The guards every reencode shares: a declared view with an encoding
   * surface, channels it declares, columns visible on this branch. Returns the
   * branch-scoped columns (the validator's facets come from them) or the gap.
   */
  private async reencodeGuards(viewId: string, pairs: readonly (readonly [string, string])[]): Promise<{ readonly cols: readonly ColumnInfo[] } | { readonly gap: GapRow }> {
    // 1. the view must be declared (R14: needs-view).
    if (!this.runtime.views.has(viewId)) {
      return { gap: this.gapLedger.file('needs-view', 'reencode', `no declared view "${viewId}"`, viewId) };
    }
    // 2. the view must declare an encoding surface at all (R14: guard-failed —
    //    never guess a channel vocabulary for an undeclared chart kind).
    const decl = this.runtime.views.get(viewId)!.encoding;
    if (!decl) {
      return { gap: this.gapLedger.file('guard-failed', 'reencode', `view "${viewId}" declares no encoding surface`, viewId) };
    }
    if (pairs.length === 0) {
      return { gap: this.gapLedger.file('guard-failed', 'reencode', `a binding set for "${viewId}" names no channel`, viewId) };
    }
    // 3. every channel must be valid for this view's declared chart kind (R14: guard-failed).
    for (const [channel] of pairs) {
      if (!decl.channels.includes(channel)) {
        return {
          gap: this.gapLedger.file('guard-failed', 'reencode', `view "${viewId}" (${decl.chartKind}) has no "${channel}" channel — valid: ${decl.channels.join(', ')}`, channel),
        };
      }
    }
    // 4. every field must be a column VISIBLE on this branch (R14: needs-column /
    //    needs-backend-data) — branch-scoped, same guard as doProbe step 3: a
    //    materialized column absent from the cursor's fold honestly gap-rejects.
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) {
      return { gap: this.gapLedger.file('needs-backend-data', 'reencode', cols.rejected, pairs[0]![1]) };
    }
    for (const [, field] of pairs) {
      if (!cols.some((c) => c.name === field)) {
        return { gap: this.gapLedger.file('needs-column', 'reencode', `no column "${field}" in table "${this.defaultTable}"`, field) };
      }
    }
    // 5. a channel this view FOLLOWS belongs to the edge (encoding links): its own rebind is refused with the sentence that names the edge
    const followed = this.effectiveEncodings(this.runtime.encoding.facetsOf(this.defaultTable, cols)).get(viewId)!.followed; // the view has a surface (step 2)
    for (const [channel] of pairs) {
      const f = followed[channel];
      if (f !== undefined) return { gap: this.gapLedger.file('guard-failed', 'reencode', this.followSentence(viewId, channel, f), channel) };
    }
    return { cols };
  }

  /** Land one `encoding:` commit (single channel, or the `*`-marked binding set) and fold it live. */
  private landEncoding(viewId: string, field: string, value: unknown, next: Bindings, cause: Cause, as: Actor | undefined, correlationId: string | undefined): CommitRecord {
    const stamped = this.stampCause(cause, 'reencode', as);
    const { record } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor, // R8 branch-on-act: a reencode from a past cursor branches, exactly like doProbe
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId: encodingViewId(viewId),
      // STABLE source identity (BR-1 root-cause fix): `encoding:${viewId}` is
      // ONE registry source shared by every reencode of the view, so its meta
      // must not vary by actor — an actor-dependent meta made the SECOND
      // actor's reencode (or an undo/bring-over executed by another actor)
      // throw SourceRegistryError. WHO acted lives in the cause (requestedBy),
      // exactly as doProbe does with the view's declared meta above.
      actorMeta: this.runtime.views.get(viewId)!.meta,
      kind: 'point',
      field,
      value,
      cause: stamped,
    });
    this.landed(record);
    this.activeEncodings.set(viewId, Object.freeze({ ...(this.activeEncodings.get(viewId) ?? {}), ...next }));
    return record;
  }

  private async doReencode(
    viewId: string,
    channel: string,
    field: string,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    const guarded = await this.reencodeGuards(viewId, [[channel, field]]);
    if ('gap' in guarded) return this.reject('reencode', intent, guarded.gap);
    // 5. the encoding plane's ONE validator (src/encoding): the channel's
    //    requirement, the built-in absence law and the def's business rules,
    //    judged on the RESULTING bindings (so a two-column rule sees the whole
    //    chart) and against the other views' bindings (dashboard scope). A
    //    refusal is a gap with the sentence — the same sentence the build door
    //    throws and the picker greys with. Under the coerce policy a named
    //    coercer may take the binding instead; the coercion rides the result.
    const judged = this.judgeBindings(viewId, { ...this.viewEncodings(viewId), [channel]: field }, [channel], guarded.cols);
    if (refuses(judged)) return this.reject('reencode', intent, this.refusalGap(judged, field));
    // 6. land ONE cause-tagged commit (commit-on-intent).
    const record = this.landEncoding(viewId, channel, field, { [channel]: field }, cause, as, correlationId);
    return { ok: true, verb: 'reencode', intent, commit: record, reencoded: { viewId, channel, field }, ...(judged.length > 0 ? { coerced: judged } : {}) };
  }

  /**
   * Several channels in ONE act (encoding plane): judged as a whole — a swap
   * never passes through an illegal middle state — and landed as ONE commit
   * (`field` = the `*` marker, `value` = the map), which folds into one key per
   * channel so undo restores every channel and compare sees each.
   */
  private async doReencodeSet(
    viewId: string,
    bindings: Readonly<Record<string, string>>,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    const pairs = Object.entries(bindings).map(([channel, field]) => [channel, field] as const);
    if (pairs.some(([, field]) => typeof field !== 'string')) {
      return this.reject('reencode', intent, this.gapLedger.file('guard-failed', 'reencode', `a binding set maps every channel to a column name`, viewId));
    }
    const guarded = await this.reencodeGuards(viewId, pairs);
    if ('gap' in guarded) return this.reject('reencode', intent, guarded.gap);
    const judged = this.judgeBindings(viewId, { ...this.viewEncodings(viewId), ...bindings }, Object.keys(bindings), guarded.cols);
    if (refuses(judged)) return this.reject('reencode', intent, this.refusalGap(judged, viewId));
    const record = this.landEncoding(viewId, ENCODING_SET_FIELD, { ...bindings }, bindings, cause, as, correlationId);
    return { ok: true, verb: 'reencode', intent, commit: record, reencoded: { viewId, bindings }, ...(judged.length > 0 ? { coerced: judged } : {}) };
  }

  /** The refusal as a gap: every refusing sentence (an explainer's prose when it added one), the law first. */
  private refusalGap(judged: readonly EncodingProblem[], target: string): GapRow {
    const sentence = judged.filter((p) => p.severity === 'refused').map((p) => p.explained ?? p.sentence).join('; ');
    return this.gapLedger.file('guard-failed', 'reencode', sentence, target);
  }

  /** Fold one prose commit: a record sets the slot; null puts the def's own words back (or clears the slot when the def had none). */
  private foldProse(viewId: string, slot: ProseSlot, record: ProseRecord | null): void {
    const slots = this.activeProse.get(viewId) ?? new Map<ProseSlot, ProseRecord>();
    if (record !== null) slots.set(slot, record);
    else {
      const declared = this.runtime.prose.get(viewId)?.[slot];
      if (declared !== undefined) slots.set(slot, declared);
      else slots.delete(slot);
    }
    this.activeProse.set(viewId, slots);
  }

  /** Fold one proposal-lane commit: the latest proposal per slot is the one on the table (a decline carries the id it answers). */
  private foldProposal(viewId: string, slot: ProseSlot, value: ProseProposal, commitId: string): void {
    const slots = this.activeProposals.get(viewId) ?? new Map<ProseSlot, ProseProposal & { readonly proposal: string }>();
    slots.set(slot, { ...value, proposal: value.proposal ?? commitId });
    this.activeProposals.set(viewId, slots);
  }

  /** Every proposal on the table for a view, its status DERIVED: accepted when the slot's live words came from it. */
  private proposalsOf(viewId: string): ProposalStatus[] {
    const slots = this.activeProposals.get(viewId);
    if (slots === undefined) return [];
    return PROSE_SLOTS.filter((slot) => slots.has(slot)).map((slot) => {
      const p = slots.get(slot)!;
      const live = this.activeProse.get(viewId)?.get(slot);
      const status: ProposalStatus['status'] = live?.author.acceptedFrom === p.proposal ? 'accepted' : p.status;
      return { slot, proposal: p.proposal, record: p.record, status, by: p.by, ...(p.reason !== undefined ? { reason: p.reason } : {}) };
    });
  }

  /** The guards a propose / accept / decline share: a declared view and a real slot. */
  private proseGuards(viewId: string, slot: ProseSlot, op: 'describe'): GapRow | null {
    if (viewId !== DASHBOARD_PROSE_ID && !isNoteSubject(viewId) && !this.runtime.views.has(viewId)) return this.gapLedger.file('needs-view', op, `no declared view "${viewId}" — the prose subjects are a declared view, "dashboard", or a note ("note:<id>")`, viewId);
    if (!(PROSE_SLOTS as readonly string[]).includes(slot)) return this.gapLedger.file('guard-failed', op, `"${String(slot)}" is not a prose slot — the slots are ${PROSE_SLOTS.join(', ')}`, String(slot));
    if (isNoteSubject(viewId) && slot !== 'title' && slot !== 'caption') return this.gapLedger.file('guard-failed', op, `a note carries a title and a caption — "${slot}" is not a note slot`, slot);
    return null;
  }

  /** The world a prose record is judged against at dispatch, from the columns already in hand. */
  private proseWorld(cols: readonly ColumnInfo[], mode: 'set' | 'proposal'): ProseWorld & { readonly mode: 'set' | 'proposal' } {
    // the ids come straight off the stores: `bookmarks()` / `saved()` would sort and copy every
    // record on EVERY describe and every proposal, and the answer is the same set of ids.
    // The names ride along for the refusal sentence — one pass, no copies.
    const bookmarks = new Set<string>();
    const bookmarkNames: string[] = [];
    for (const t of this.runtime.bookmarks.list) {
      bookmarks.add(t.id);
      bookmarkNames.push(t.name);
    }
    const saved = new Set<string>();
    const savedNames: string[] = [];
    for (const c of this.runtime.saved.list) {
      saved.add(c.id);
      savedNames.push(c.name);
    }
    return {
      columns: new Set(cols.map((c) => c.name)),
      analyses: new Set(this.runtime.analyses.keys()),
      surfaced: new Set([...this.runtime.views.values()].filter((v) => v.encoding !== undefined).map((v) => v.viewId)),
      commits: new Set(this.log.records.map((r) => r.id)),
      // a ref links a record's ID, not its name — that is why renaming a bookmark or a picture never breaks a note
      bookmarks,
      bookmarkNames,
      saved,
      savedNames,
      mode,
    };
  }

  /** Land one prose-lane commit (a slot's words, or its proposal lane) and fold it live. */
  private landProse(viewId: string, field: string, value: unknown, cause: Cause, as: Actor | undefined, correlationId: string | undefined): CommitRecord {
    const stamped = this.stampCause(cause, 'describe', as);
    const { record: commit } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor,
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId: `${PROSE_VIEW_PREFIX}${viewId}`,
      actorMeta: this.runtime.views.get(viewId)?.meta ?? (isNoteSubject(viewId) ? NOTE_ACTOR_META : DASHBOARD_ACTOR_META),
      kind: 'point',
      field,
      value,
      cause: stamped,
    });
    this.landed(commit);
    return commit;
  }

  /** PROPOSE: the record lands in the slot's proposal lane (status open), judged by the same laws — never as the live words. */
  private async doPropose(viewId: string, slot: ProseSlot, record: ProseRecord | null, cause: Cause, as: Actor | undefined, intent: DispatchResult['intent'], correlationId: string | undefined): Promise<DispatchResult> {
    const gap = this.proseGuards(viewId, slot, 'describe');
    if (gap !== null) return this.reject('describe', intent, gap);
    if (record === null) return this.reject('describe', intent, this.gapLedger.file('guard-failed', 'describe', `a proposal for "${viewId}".${slot} needs a record — null is not a proposal`, slot));
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) return this.reject('describe', intent, this.gapLedger.file('needs-backend-data', 'describe', cols.rejected, viewId));
    const problems = validateProseRecord(viewId, slot, record, this.proseWorld(cols, 'proposal'));
    if (proseRefuses(problems)) return this.reject('describe', intent, this.gapLedger.file('guard-failed', 'describe', problems.map((p) => p.sentence).join('; '), slot));
    const by = this.stampCause(cause, 'describe', as).requestedBy;
    const value: ProseProposal = { record, status: 'open', by };
    const commit = this.landProse(viewId, `${slot}${PROPOSAL_LANE}`, value, cause, as, correlationId);
    this.foldProposal(viewId, slot, value, commit.id);
    return { ok: true, verb: 'describe', intent, commit, proposed: this.proposalsOf(viewId).find((p) => p.slot === slot)! };
  }

  /** ACCEPT: the open proposal's record lands on the slot with `author.acceptedFrom` = the proposing commit — one commit, and the proposal reads accepted. */
  private async doAccept(viewId: string, slot: ProseSlot, proposalId: string, cause: Cause, as: Actor | undefined, intent: DispatchResult['intent'], correlationId: string | undefined): Promise<DispatchResult> {
    const gap = this.proseGuards(viewId, slot, 'describe');
    if (gap !== null) return this.reject('describe', intent, gap);
    const open = this.activeProposals.get(viewId)?.get(slot);
    const derived = this.proposalsOf(viewId).find((p) => p.slot === slot)?.status; // accepted is derived from the live words
    if (open === undefined || open.proposal !== proposalId || derived !== 'open') {
      return this.reject('describe', intent, this.gapLedger.file('guard-failed', 'describe', fillProse(PROSE_SENTENCES.noProposal, { view: viewId, slot, proposal: proposalId }), slot));
    }
    const acceptedBy = this.stampCause(cause, 'describe', as).requestedBy;
    const record: ProseRecord = { ...open.record, author: { ...open.record.author, acceptedFrom: proposalId, acceptedBy } };
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    /* v8 ignore next 2 -- an open proposal exists only where the columns could be listed when it was proposed; a provider that answered then and refuses now is a mid-session engine failure this door cannot exercise */
    if ('rejected' in cols) return this.reject('describe', intent, this.gapLedger.file('needs-backend-data', 'describe', cols.rejected, viewId));
    const commit = this.landProse(viewId, slot, record, cause, as, correlationId);
    this.foldProse(viewId, slot, record);
    const described = this.proseOf(viewId, this.runtime.encoding.facetsOf(this.defaultTable, cols)).find((p) => p.slot === slot)!; // the slot was just set
    return { ok: true, verb: 'describe', intent, commit, described, proposed: this.proposalsOf(viewId).find((p) => p.slot === slot)! };
  }

  /** DECLINE: a `declined` value with its reason lands in the lane, answering the open proposal — the words never land. */
  private async doDecline(viewId: string, slot: ProseSlot, decline: { readonly proposal: string; readonly reason: string }, cause: Cause, as: Actor | undefined, intent: DispatchResult['intent'], correlationId: string | undefined): Promise<DispatchResult> {
    const gap = this.proseGuards(viewId, slot, 'describe');
    if (gap !== null) return this.reject('describe', intent, gap);
    const open = this.activeProposals.get(viewId)?.get(slot);
    const derived = this.proposalsOf(viewId).find((p) => p.slot === slot)?.status;
    if (open === undefined || open.proposal !== decline.proposal || derived !== 'open') {
      return this.reject('describe', intent, this.gapLedger.file('guard-failed', 'describe', fillProse(PROSE_SENTENCES.noProposal, { view: viewId, slot, proposal: decline.proposal }), slot));
    }
    if (typeof decline.reason !== 'string' || decline.reason.trim().length === 0) {
      return this.reject('describe', intent, this.gapLedger.file('guard-failed', 'describe', fillProse(PROSE_SENTENCES.declineReason, { view: viewId, slot }), slot));
    }
    const by = this.stampCause(cause, 'describe', as).requestedBy;
    const value: ProseProposal = { record: open.record, status: 'declined', proposal: decline.proposal, by, reason: decline.reason };
    const commit = this.landProse(viewId, `${slot}${PROPOSAL_LANE}`, value, cause, as, correlationId);
    this.foldProposal(viewId, slot, value, commit.id);
    return { ok: true, verb: 'describe', intent, commit, proposed: this.proposalsOf(viewId).find((p) => p.slot === slot)! };
  }

  /** The live selections as JSON-safe data — what a caption's basis is compared against. */
  private filtersNow(): Readonly<Record<string, unknown>> {
    return Object.fromEntries([...this.activeFilters.entries()].map(([viewId, clause]) => [viewId, { ...clause }]));
  }

  /** Every slot a view carries at the cursor, in slot order, each with its staleness judged against what is on screen. */
  private proseOf(viewId: string, facets: readonly ColumnFacet[], shared?: ProseWorldNow): ProseStatus[] {
    const slots = this.activeProse.get(viewId);
    if (slots === undefined || slots.size === 0) return [];
    const view = this.runtime.views.get(viewId); // undefined for the dashboard subject — it binds nothing and has no surface
    const now = {
      ...(shared ?? this.proseWorldNow(facets)),
      encodings: this.proseEncodingsNow(viewId, facets),
      ...(view?.encoding !== undefined ? { surface: view.encoding } : {}),
    };
    return PROSE_SLOTS.filter((slot) => slots.has(slot)).map((slot) => proseStatus(slot, slots.get(slot)!, now));
  }

  /** The part of the staleness world every subject shares at one cursor — built once per overview, not once per note. */
  private proseWorldNow(facets: readonly ColumnFacet[]): ProseWorldNow {
    return { filters: this.filtersNow(), columns: new Set(facets.map((f) => f.field)), analyses: new Set(this.runtime.analyses.keys()) };
  }

  /** The notes with words at the cursor: a note whose every slot went back to nothing is gone (its commits stay). */
  private notesInfo(facets: readonly ColumnFacet[]): NoteInfo[] {
    const out: NoteInfo[] = [];
    const shared = this.proseWorldNow(facets);
    for (const subject of this.activeProse.keys()) {
      if (!isNoteSubject(subject)) continue;
      const prose = this.proseOf(subject, facets, shared);
      if (prose.length === 0) continue;
      out.push({ id: subject.slice(NOTE_PROSE_PREFIX.length), prose, proposals: this.proposalsOf(subject) });
    }
    return out;
  }

  /** Every declared table as the def states it — read off the def and the runtime, never inferred from the rows. */
  private tablesInfo(): TableInfo[] {
    return this.runtime.tables.map((name) => {
      const decl = this.runtime.def.data[name]!; // every runtime table is a def table
      const read = this.runtime.sources[name];
      const source: TableInfo['source'] =
        decl.source !== undefined && read !== undefined
          ? { format: read.format, via: read.via, ...(read.at !== undefined ? { at: read.at } : {}) }
          : decl.csv !== undefined
            ? { inline: 'csv' }
            : { inline: 'rows', rows: decl.rows!.length }; // the def door admits a table only with rows, csv or a source
      return {
        name,
        source,
        engine: this.runtime.engines[name]!, // every runtime table resolved an engine at build
        ...(this.runtime.keys[name] !== undefined ? { key: this.runtime.keys[name]! } : {}),
        ...(decl.grain !== undefined ? { grain: decl.grain } : {}),
        ...(decl.absence !== undefined ? { absence: { field: decl.absence.field, states: [...decl.absence.states] } } : {}),
        declaredColumns: Object.keys(decl.columns ?? {}).length,
      };
    });
  }

  /** What a prose subject SHOWS at the cursor: a surfaced view's effective bindings, an unsurfaced view's own, the dashboard's nothing. */
  private proseEncodingsNow(viewId: string, facets: readonly ColumnFacet[]): Readonly<Record<string, string>> {
    const view = this.runtime.views.get(viewId);
    if (view === undefined) return {}; // the dashboard or a note — both bind nothing, so neither has a surface to read (proseGuards admits no other unknown id)
    return view.encoding !== undefined ? this.effectiveEncodings(facets).get(viewId)!.bindings : this.viewEncodings(viewId);
  }

  /**
   * The `describe` verb (the prose plane's dispatch door): one slot of one
   * view set to a record — judged by the one prose validator against the
   * columns on this branch and the declared analyses, refused as a gap with
   * the sentence — or null, back to the def's own words. One commit under
   * `prose:${viewId}`, field = the slot, last-wins per slot; undo restores
   * the prior words, seek shows whatever was said at that point.
   */
  private async doDescribe(
    viewId: string,
    slot: ProseSlot,
    record: ProseRecord | null,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    const gap = this.proseGuards(viewId, slot, 'describe');
    if (gap !== null) return this.reject('describe', intent, gap);
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) return this.reject('describe', intent, this.gapLedger.file('needs-backend-data', 'describe', cols.rejected, viewId));
    if (record !== null && record.author.kind === 'humanEdited' && record.basis !== undefined) {
      // a person edited an agent's words looking at THIS screen: the basis keeps the keys the agent stated,
      // re-stamped to what is on screen now — so the edit is judged fresh, and goes stale on its own terms
      const effective = this.proseEncodingsNow(viewId, this.runtime.encoding.facetsOf(this.defaultTable, cols));
      const { editedFrom: prior, ...stated } = record.basis; // the agent's ORIGINAL evidence survives every edit, kept once — never nested
      record = {
        ...record,
        basis: {
          ...stated,
          ...(stated.encodings !== undefined ? { encodings: effective } : {}),
          ...(stated.filters !== undefined ? { filters: this.filtersNow() } : {}),
          atCommit: this._cursor,
          editedFrom: prior ?? stated,
        },
      };
    }
    if (record !== null) {
      const problems = validateProseRecord(viewId, slot, record, this.proseWorld(cols, 'set'));
      if (proseRefuses(problems)) {
        return this.reject('describe', intent, this.gapLedger.file('guard-failed', 'describe', problems.map((p) => p.sentence).join('; '), slot));
      }
    }
    const commit = this.landProse(viewId, slot, record, cause, as, correlationId);
    this.foldProse(viewId, slot, record);
    const described = this.proseOf(viewId, this.runtime.encoding.facetsOf(this.defaultTable, cols)).find((p) => p.slot === slot) ?? null;
    return { ok: true, verb: 'describe', intent, commit, described };
  }

  /** The last effective map, keyed by what it depends on (the folds, the graph, the columns). */
  private effectiveMemo: { readonly key: string; readonly value: ReadonlyMap<string, EffectiveEncoding> } | undefined;

  /** The link graph at the cursor: the def's materialized graph with the edited edges laid over it. */
  private currentGraph(): LinkGraph {
    return applyLinkOverrides(this.runtime.links, this.activeLinks);
  }

  /**
   * Every view's EFFECTIVE encoding under the link graph — the encoding kind
   * of edge, read through, never landed. Two passes: (1) each view's own fold
   * plus the channels it follows, ONE HOP — a follow reads the source's OWN
   * fold, never a binding the source is itself following, so two views may
   * point at each other and no cycle can form; where two edges reach one
   * channel, graph order decides (last wins); (2) each followed channel judged
   * by the TARGET's own rules through the one validator, against the other
   * views' effective bindings — a refused follow leaves the view's own binding
   * in place and reports the sentence. Reported, never filed: this is the lint
   * door running continuously, not a refused act.
   */
  private effectiveEncodings(facets: readonly ColumnFacet[]): ReadonlyMap<string, EffectiveEncoding> {
    const key = JSON.stringify([[...this.activeEncodings.entries()], [...this.activeLinks.entries()], facets.map((f) => [f.field, f.type, f.role, f.scale])]);
    if (this.effectiveMemo?.key === key) return this.effectiveMemo.value;
    const graph = this.currentGraph();
    type Candidate = { readonly field: string; readonly edge: string; readonly from: string; readonly sourceChannel: string };
    const raw = new Map<string, { readonly own: Bindings; readonly byChannel: ReadonlyMap<string, Candidate> }>();
    for (const [viewId, view] of this.runtime.views) {
      if (view.encoding === undefined) continue;
      const byChannel = new Map<string, Candidate>();
      for (const edge of edgesInto(graph, viewId)) {
        if (edge.kind !== ENCODING_KIND || edge.response !== 'follow') continue;
        const sourceOwn = this.viewEncodings(edge.source); // one hop: the source's OWN fold
        for (const pair of edge.channels!) { // an encoding edge is always written out with its pairs (materialize)
          const field = sourceOwn[pair.from];
          if (field !== undefined) byChannel.set(pair.to, { field, edge: edge.id, from: edge.source, sourceChannel: pair.from });
        }
      }
      raw.set(viewId, { own: this.viewEncodings(viewId), byChannel });
    }
    // The other views a follow is judged against are their RAW effective bindings (own + every candidate,
    // refused ones included), not their judged ones: judging B against judged C against judged B would be the
    // fixed point the one-hop law exists to avoid. The dispatch door (`bindingsOfOthers`) reads the judged map.
    const rawAll = new Map([...raw].map(([id, r]) => [id, { ...r.own, ...Object.fromEntries([...r.byChannel].map(([ch, c]) => [ch, c.field])) } as Bindings] as const));
    const { rules, ports } = this.runtime.encoding;
    const out = new Map<string, EffectiveEncoding>();
    for (const [viewId, r] of raw) {
      const others: Record<string, Bindings> = {};
      for (const [id, b] of rawAll) if (id !== viewId) others[id] = b;
      const bindings: Record<string, string> = { ...r.own };
      const followed: Record<string, { edge: string; from: string; sourceChannel: string }> = {};
      const refused: Record<string, { edge: string; field: string; sentence: string }> = {};
      for (const [channel, c] of r.byChannel) {
        const problems = validateBindings({ view: this.runtime.views.get(viewId)!.encoding!, bindings: { ...bindings, [channel]: c.field }, facets, others, rules, ports, changed: [channel] });
        // a follow is a READING, not an act: it is never coerced — a follow that would need a coercer is refused with the sentence
        if (problems.length > 0) {
          refused[channel] = { edge: c.edge, field: c.field, sentence: problems.map((p) => p.explained ?? p.sentence).join('; ') };
        } else {
          bindings[channel] = c.field;
          followed[channel] = { edge: c.edge, from: c.from, sourceChannel: c.sourceChannel };
        }
      }
      // each entry is handed out through `overview().views[].effective`, so it
      // is frozen where it is BUILT: a memo is a cached object, and a cached
      // object handed to a reader is exactly the leak this sweep is about. It
      // is rebuilt whole whenever the memo key changes, never written into.
      out.set(viewId, deepFreeze({ bindings, followed, refused }));
    }
    this.effectiveMemo = { key, value: out };
    return out;
  }

  /** The sentence a view's own rebind of a FOLLOWED channel is refused with — the edge owns the channel. */
  private followSentence(viewId: string, channel: string, f: { readonly edge: string; readonly from: string }): string {
    return `view "${viewId}"'s ${channel} follows "${f.from}" (edge ${f.edge}) — change the edge, or set it to none`;
  }

  /** The last verdicts per view, keyed by what they depend on — a poll between acts costs nothing. */
  private readonly fitsMemo = new Map<string, { readonly key: string; readonly fits: Readonly<Record<string, readonly Fit[]>> }>();

  /** One view's verdicts, recomputed only when its bindings, the other views' bindings, or the columns changed. */
  private fitsOfView(viewId: string, surface: ViewEncodingDecl, facets: readonly ColumnFacet[]): Readonly<Record<string, readonly Fit[]>> {
    const effective = this.effectiveEncodings(facets).get(viewId)!; // every view with a surface has an entry
    const bindings = effective.bindings;
    const others = this.bindingsOfOthers(viewId, facets);
    const key = JSON.stringify([bindings, others, [...this.activeLinks.entries()], facets.map((f) => [f.field, f.type, f.role, f.scale])]);
    const hit = this.fitsMemo.get(viewId);
    if (hit !== undefined && hit.key === key) return hit.fits;
    const judged = fitsFor({ view: surface, bindings, facets, others, rules: this.runtime.encoding.rules, ports: this.runtime.encoding.ports });
    // a followed channel is the edge's to change: every column is refused with the sentence that names it
    const fits: Record<string, readonly Fit[]> = { ...judged };
    for (const [channel, f] of Object.entries(effective.followed)) {
      // a followed channel is one the view declares (the pair was validated), so it has verdicts to overwrite
      fits[channel] = judged[channel]!.map((fit) => ({ field: fit.field, ok: false, because: this.followSentence(viewId, channel, f) }));
    }
    // same law as the effective memo above: `overview().views[].fits` hands
    // this cached object to a reader, so it is frozen where it is built
    deepFreeze(fits);
    this.fitsMemo.set(viewId, { key, fits });
    return fits;
  }

  /** The other views' bindings ON SCREEN (effective under the link graph) — what a dashboard-scoped rule must read. */
  private bindingsOfOthers(viewId: string, facets: readonly ColumnFacet[]): Record<string, Bindings> {
    const effective = this.effectiveEncodings(facets);
    const others: Record<string, Bindings> = {};
    for (const [id, view] of this.runtime.views) if (id !== viewId && view.encoding !== undefined) others[id] = effective.get(id)!.bindings; // every surfaced view has an entry
    return others;
  }

  /** One view's would-be bindings judged by the plane's validator, with the default table's facets. */
  private judgeBindings(viewId: string, bindings: Bindings, changed: readonly string[], cols: readonly ColumnInfo[]) {
    const { rules, ports } = this.runtime.encoding;
    const facets = this.runtime.encoding.facetsOf(this.defaultTable, cols);
    return validateBindings({
      view: this.runtime.views.get(viewId)!.encoding!,
      bindings,
      facets,
      others: this.bindingsOfOthers(viewId, facets),
      rules,
      ports,
      changed,
    });
  }

  private doAnnotate(
    target: string,
    note: string,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
  ): DispatchResult {
    // An annotation is an INERT note (R12): stored as commit data, never parsed.
    // Its `field` names WHAT it annotates (a commit id, a view, a column) — so a
    // note on a selection commit is a SAVED SELECTION the log can find again.
    const stamped = this.stampCause(cause, 'annotate', as);
    const viewId = `${ANNOTATION_VIEW_PREFIX}${stamped.requestedBy}`; // single-sourced wire prefix (BR-1)
    const { record } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor, // R8 branch-on-act: an annotation from a past cursor branches too
      viewId,
      actorMeta: { actor: stamped.requestedBy },
      kind: 'point',
      field: target.length > 0 ? target : ANNOTATION_FIELD,
      value: note,
      cause: stamped,
    });
    this.landed(record);
    return { ok: true, verb: 'annotate', intent, commit: record, annotated: { target, note } };
  }

  private doNavigate(
    viewId: string,
    field: string | undefined,
    value: string | undefined,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): DispatchResult {
    // LY-1: the `layout:${scope}` synthetic identity LANDS a fold-carried
    // commit (see LAYOUT_SOURCE_META); every other navigate stays commit-free.
    if (viewId.startsWith(LAYOUT_VIEW_PREFIX)) {
      return this.doLayoutNote(viewId, field, value, cause, as, intent, correlationId);
    }
    if (!this.runtime.views.has(viewId)) {
      return this.reject('navigate', intent, this.gapLedger.file('needs-view', 'navigate', `no declared view "${viewId}"`, viewId));
    }
    // A declared-view navigate (pan/zoom) is the RP-1 contract: recorded as the
    // verb itself, deliberately NO commit — `field`/`value`, if sent, are ignored.
    this._currentView = viewId;
    return { ok: true, verb: 'navigate', intent, navigatedTo: viewId };
  }

  /**
   * LY-1 — land ONE cause-tagged layout commit under `layout:${scope}`.
   * `field` = the arrangement prop (`preset`/`order`/`focus`), `value` = its
   * plain-string value; both are INERT display state (R12 — recorded, folded,
   * never dispatched on). Parent is the CURSOR, so setting a layout from a
   * past cursor branches (R8 branch-on-act) and each path keeps its OWN
   * arrangement. Non-filtering by construction: the commit's key is inert in
   * `src/branches/fold.keyOf`, and `rebuildFold` routes it into
   * `activeLayouts`, never `activeFilters`.
   */
  private doLayoutNote(
    viewId: string,
    field: string | undefined,
    value: string | undefined,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): DispatchResult {
    const scope = viewId.slice(LAYOUT_VIEW_PREFIX.length);
    if (scope.length === 0) {
      return this.reject('navigate', intent, this.gapLedger.file('guard-failed', 'navigate', 'a layout navigate needs a scope — use "layout:dashboard", not bare "layout:"', viewId));
    }
    if (typeof field !== 'string' || field.trim().length === 0) {
      return this.reject('navigate', intent, this.gapLedger.file('guard-failed', 'navigate', `a layout navigate on "${viewId}" needs a field naming the arrangement prop (e.g. preset / order / focus)`, viewId));
    }
    if (typeof value !== 'string') {
      return this.reject('navigate', intent, this.gapLedger.file('guard-failed', 'navigate', `a layout navigate on "${viewId}" needs a plain-string value for "${field}"`, field));
    }
    if (value.length > LAYOUT_VALUE_MAX) {
      return this.reject('navigate', intent, this.gapLedger.file('guard-failed', 'navigate', `layout value too long (max ${LAYOUT_VALUE_MAX} chars)`, field));
    }
    const stamped = this.stampCause(cause, 'navigate', as);
    const { record } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor, // R8 branch-on-act: a layout set from a past cursor branches too
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId,
      actorMeta: LAYOUT_SOURCE_META, // constant per source — WHO acted lives in the cause
      kind: 'point',
      field,
      value,
      cause: stamped,
    });
    this.landed(record);
    const current = this.activeLayouts.get(scope) ?? {};
    this.activeLayouts.set(scope, Object.freeze({ ...current, [field]: value }));
    return { ok: true, verb: 'navigate', intent, navigatedTo: viewId, commit: record };
  }

  private async doAnalyze(
    analysisId: string,
    input: readonly Row[] | undefined,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    if (!this.hasAnalysis(analysisId)) {
      return this.reject('analyze', intent, this.gapLedger.file('needs-analysis-kind', 'analyze', `no declared analysis "${analysisId}"`, analysisId));
    }
    const analysis = await this.declareAnalysis(analysisId, {
      ...(input !== undefined ? { input } : {}),
      cause,
      ...(as !== undefined ? { as } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    return { ok: true, verb: 'analyze', intent, analysis };
  }

  private doFork(fromCommitId: string, intent: DispatchResult['intent']): DispatchResult {
    const exists = this.log.records.some((r) => r.id === fromCommitId);
    if (!exists) {
      return this.reject('fork', intent, this.gapLedger.file('guard-failed', 'fork', `no commit "${fromCommitId}" to fork from`, fromCommitId));
    }
    // R8 (DEMO-2 fix): `fork` is an EXPLICIT branch-at-cursor. It moves the
    // read-only CURSOR to the fork point and rebuilds the fold there; the active
    // branch HEAD (the old tip) is left INTACT so the old lineage stays a live,
    // replayable branch. The next dispatch/declareAnalysis parents from the
    // cursor and lands a real sibling (append-only; no history rewritten).
    //
    // Before this fix `doFork` mutated `this._head = fromCommitId` directly (the
    // packet's quoted DEMO-2 flag: "fork only moves the head pointer"): that
    // conflated cursor and head (losing the old tip pointer) AND never rebuilt
    // the resolved selection at the fork point, so `overview()` still reported
    // the pre-fork selection. `fork` and `seek` now share `seekTo` (act-from-past
    // is the IMPLICIT fork; `fork` is the explicit one).
    this.seekTo(fromCommitId);
    this.refs.detach(fromCommitId); // BR-1: an explicit fork detaches HEAD too — the sibling act will auto-name its ref
    return { ok: true, verb: 'fork', intent };
  }

  private doBookmark(
    label: string,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
  ): DispatchResult {
    // R12: the label is validated as inert data — a non-empty, length-capped
    // string, stored VERBATIM and never parsed or dispatched on.
    if (typeof label !== 'string' || label.trim().length === 0) {
      return this.reject('bookmark', intent, this.gapLedger.file('guard-failed', 'bookmark', 'bookmark label must be a non-empty string', ''));
    }
    if (label.length > 200) {
      return this.reject('bookmark', intent, this.gapLedger.file('guard-failed', 'bookmark', 'bookmark label too long (max 200 chars)', label.slice(0, 40)));
    }
    // A bookmark is a NAME ON THE MOMENT the cursor stands on. It lands NO
    // commit and starts no branch (before this it landed a `bookmark:` commit,
    // which put a step on the rail and forked the path when named from the
    // past). The cause still says who named it.
    const stamped = this.stampCause(cause, 'bookmark', as);
    const made = this.bookmark(label, undefined, stamped.requestedBy);
    if (!made.ok) return this.reject('bookmark', intent, this.gapLedger.file('guard-failed', 'bookmark', made.rejected, label.slice(0, 40)));
    const bookmark = this.bookmarkViews().find((c) => c.id === made.bookmark.id) as BookmarkView;
    return { ok: true, verb: 'bookmark', intent, bookmark };
  }

  // ── declareAnalysis (the L3 flags' landing spot) ─────────────────────────────
  registerAnalysis(id: string, slot: AnalysisSlot): void {
    this.localAnalyses.set(id, registerAnalysisSlot(id, slot));
  }

  hasAnalysis(id: string): boolean {
    return this.localAnalyses.has(id) || this.runtime.analyses.has(id);
  }

  analysisIds(): string[] {
    return [...new Set([...this.runtime.analyses.keys(), ...this.localAnalyses.keys()])];
  }

  private analysis(id: string): RegisteredAnalysis | undefined {
    return this.localAnalyses.get(id) ?? this.runtime.analyses.get(id);
  }

  async declareAnalysis(id: string, opts: DeclareAnalysisOptions = {}): Promise<AnalysisCommit> {
    if (opts.def) this.registerAnalysis(id, opts.def);
    const analysis = this.analysis(id);
    if (!analysis) throw new Error(`vizfootprint: unknown analysis "${id}" — declare it in the def or pass { def }`);

    const table = opts.table ?? this.defaultTable;
    // Resolve input (R11 / the demo's own split: columns-channel over the full
    // table, everything else over the selection). A backend rejection is filed
    // as a typed gap and short-circuits — never silently masked as empty (R14).
    let input: readonly Row[];
    if (opts.input !== undefined) {
      input = opts.input;
    } else {
      const resolved = await this.resolveAnalysisInput(analysis.def.produces === 'columns', table);
      if ('rejected' in resolved) {
        const gap = this.gapLedger.file('needs-backend-data', 'declareAnalysis', resolved.rejected, id);
        return {
          analysisId: id,
          kind: analysis.kind,
          result: { ok: false, reason: 'degenerate-fit', n: 0, fitDegenerate: true },
          gap,
        };
      }
      input = resolved;
    }

    const baseCause: Cause = opts.cause ?? { requestedBy: opts.as ?? this.defaultActor, computedBy: 'system' };
    const stamped = this.stampCause(baseCause, 'analyze', opts.as); // computedBy FORCED to 'system' (R1)

    let hypothesis: AnalysisCommit['hypothesis'];
    let fdrStep: FdrStep | undefined;
    const run = await analysis.run(input, {
      timestamp: ++this.testClock,
      sink: (h) => {
        hypothesis = h;
        fdrStep = this.fdrStepper.step(h); // step L4 exactly once per declared test
        // frozen where it LANDS, like a commit and like a gap row: an audit row
        // is finished the moment it is written, and `ledger()` copies the list
        // but shares the rows
        this._ledger.push(deepFreeze(fdrStep));
      },
    });

    // R14: a degenerate result lands NOTHING (no commit) and spends NO wealth
    // (the sink never fired) — the honest flag is the whole answer.
    if (!run.result.ok) {
      return { analysisId: id, kind: analysis.kind, result: run.result };
    }

    // Land ONE cause-tagged provenance commit for the invocation.
    const analysisViewId = `${ANALYSIS_VIEW_PREFIX}${id}`; // single-sourced wire prefix (BR-1)
    let landField = ANALYSIS_FIELD;
    let landValue: unknown = id;
    if (analysis.kind === 'test' && hypothesis) {
      // The L1-native test emission: a point commit on the reserved 'pValue'
      // field (fromLog re-derives it; R6 holds — brushes never land here).
      landField = TEST_ANALOG_FIELD;
      landValue = hypothesis.pValue;
    }
    const { record } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor, // R8 branch-on-act: declaring from a past cursor branches first, then lands
      ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
      viewId: analysisViewId,
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: landField,
      value: landValue,
      cause: stamped,
    });
    this.landed(record);

    // R11: a columns-channel output materializes back into the data space so it
    // re-enters as ordinary, filterable columns.
    let materialized: string[] | undefined;
    let gap: AnalysisCommit['gap'];
    if (run.result.output.as === 'columns') {
      const out = run.result.output;
      const provider = this.runtime.providerFor(out.table);
      materialized = [];
      if (!provider) {
        gap = this.gapLedger.file('needs-view', 'declareAnalysis', `no provider for table "${out.table}"`, out.table);
      } else {
        for (const name of Object.keys(out.columns)) {
          const values = run.snapshot?.sharedState[name];
          if (!Array.isArray(values)) {
            gap = this.gapLedger.file('guard-failed', 'declareAnalysis', `analysis "${id}" produced no values for column "${name}"`, name);
            continue;
          }
          const landed = await provider.materializeColumn(out.table, name, values);
          if (isRejection(landed)) {
            const code = landed.reason === 'not-implemented' || landed.reason === 'no-backend-connection' ? 'needs-backend-data' : 'guard-failed';
            /* v8 ignore next -- every provider's materializeColumn() rejection (memory/wasm/server, src/data/*Provider.ts) always supplies a `detail`; the `landed.reason` fallback is unreachable via the public API */
            gap = this.gapLedger.file(code, 'declareAnalysis', landed.detail ?? landed.reason, name);
          } else {
            materialized.push(name);
          }
        }
      }
      // Branch-scope the materialized columns to THIS commit (the fold makes them
      // visible only on branches whose path includes it — see effectiveColumnsOf).
      if (materialized.length > 0) {
        this.materializedByCommit.set(record.id, materialized.map((name) => ({ table: out.table, name })));
        for (const name of materialized) this.allMaterialized.add(`${out.table}::${name}`);
      }
    }

    // ── L6 provenance capture (collect during the run, never post-process) ──────
    // A full-table columns transform has NO selection dependency (its input is
    // the whole table, not the selection) — record an EMPTY input-selection set
    // so `why()` honestly excludes an active-but-unused filter (minimality). Any
    // other channel ran over the selection, so the active filter commits ARE the
    // causal input.
    const inputSelectionCommitIds =
      analysis.def.produces === 'columns' && opts.input === undefined
        ? []
        : [...this.activeFilterCommits.values()];
    const baseProv: WhyProvenance = {
      analysisId: id,
      declaringCommitId: record.id,
      inputSelectionCommitIds,
      ...(run.snapshot ? { snapshot: run.snapshot } : {}),
      ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
      ...(fdrStep ? { fdrStep } : {}),
    };
    const output = run.result.output;
    if (output.as === 'columns') {
      // Kernel key == the column name (the flowchart writes the column directly
      // into committed state — session.ts reads `sharedState[name]` above).
      /* v8 ignore next -- `materialized` is unconditionally assigned (line ~840) whenever `run.result.output.as === 'columns'`, the same discriminant guarding this block; the `?? []` fallback exists only to satisfy the `string[] | undefined` field type and is unreachable via the public API */
      for (const name of materialized ?? []) {
        this.whyByColumn.set(name, { ...baseProv, kernelKey: name });
      }
    } else if (output.as === 'scalar') {
      // The scalar's kernel key is the (unique) committed state key holding its
      // value; unresolved (ambiguous/absent) → `why()` reports a kernel miss.
      const kernelKey = this.resolveScalarKernelKey(run.snapshot, output.value);
      this.whyByAnalysisId.set(id, { ...baseProv, ...(kernelKey !== undefined ? { kernelKey } : {}) });
    } else {
      // table / geometry — indexed for `why({kind:'hypothesis'})`; no scalar key
      // (kernel tier reports `kernel-key-unresolved`, honestly).
      this.whyByAnalysisId.set(id, baseProv);
    }

    return {
      analysisId: id,
      kind: analysis.kind,
      result: run.result,
      commit: record,
      ...(hypothesis ? { hypothesis } : {}),
      ...(fdrStep ? { fdrStep } : {}),
      ...(materialized ? { materialized } : {}),
      ...(gap ? { gap } : {}),
    };
  }

  /** The unique committed state key whose value === `value`, or undefined if 0/≥2 match. */
  private resolveScalarKernelKey(snapshot: RuntimeSnapshot | undefined, value: unknown): string | undefined {
    if (!snapshot) return undefined;
    const state = snapshot.sharedState;
    const hits = Object.keys(state).filter((k) => state[k] === value);
    return hits.length === 1 ? hits[0] : undefined;
  }

  // ── proposeChart (RP-3: ledger-gated agent-authored charts) ──────────────────
  charts(): readonly ChartView[] {
    return [...this._charts.values()];
  }

  async proposeChart(input: ProposeChartInput, opts: { as?: Actor } = {}): Promise<ProposeChartResult> {
    const { id, spec, correlationId } = input;
    const as = opts.as;
    const file = (code: GapCode, detail: string, target?: string): ProposeChartResult => ({
      ok: false,
      gap: this.gapLedger.file(code, 'proposeChart', detail, target),
    });

    // 0. the id must be a usable, unique handle (a re-used id would collide the view/ledger row).
    if (typeof id !== 'string' || id.trim().length === 0) {
      return file('chart-invalid-spec', 'chart id must be a non-empty string', typeof id === 'string' ? id : '');
    }
    if (this._charts.has(id)) {
      return file('chart-hypothesis-rejected', `a chart with id "${id}" was already proposed — pick a fresh id`, id);
    }

    // 1 + 2. schema-valid → capability-check, via the pure runtime-free shape
    //        gate (no Vega-Lite in the library; the bridge shares this gate).
    const gate = gateChartSpec(spec);
    if (!gate.ok) {
      const code: GapCode =
        gate.reason === 'invalid-spec'
          ? 'chart-invalid-spec'
          : gate.reason === 'unsupported-composition'
            ? 'chart-unsupported-composition'
            : 'chart-transforms-not-owned';
      return file(code, gate.detail, id);
    }

    // 3. hypothesis grounding: the chart CLAIMS a relationship over the fields it
    //    encodes — those must be REAL, branch-visible columns, else the claim is
    //    over nothing. A rejected hypothesis the agent reads back and repairs.
    const cols = await this.effectiveColumnsOf(this.defaultTable);
    if ('rejected' in cols) return file('needs-backend-data', cols.rejected, id);
    const fields = gate.facts.encodedFields;
    if (fields.length === 0) {
      return file('chart-hypothesis-rejected', 'the chart encodes no data field — it makes no claim to ledger', id);
    }
    const known = new Set(cols.map((c) => c.name));
    const missing = fields.filter((f) => !known.has(f));
    if (missing.length > 0) {
      return file(
        'chart-hypothesis-rejected',
        `the chart claims a relationship over column(s) absent from "${this.defaultTable}": ${missing.join(', ')}`,
        missing.join(', '),
      );
    }

    // ── every gate passed: register the hypothesis in the LORD++ ledger BEFORE it renders ──
    // A chart is AGENT-computed (not system): keep `computedBy` as authored,
    // UNLIKE `analyze` (which R1-forces 'system'). validateCause is the R12 gate.
    const validated = validateCause(input.cause ?? { requestedBy: as ?? this.defaultActor, computedBy: as ?? this.defaultActor });
    const requestedBy: Actor = as ?? validated.requestedBy;
    const computedBy: Actor = as ?? validated.computedBy;
    const stamped: Cause = { requestedBy, computedBy, ...(validated.intent !== undefined ? { intent: validated.intent } : {}) };
    const claim = typeof input.claim === 'string' && input.claim.length > 0 ? input.claim : `${fields.join(' vs ')} reveals a relationship`;

    // (a) the ledgered hypothesis — an UNTESTED visual claim entered at p = 1.0:
    //     it COSTS multiplicity budget (an agent cannot fish charts for free) but
    //     can never be a discovery (reject is always false at p=1). Landed as a
    //     `pValue` commit so `hypothesisRecordsFromLog` re-derives it on replay.
    const hRecord: HypothesisRecord = { hypothesisId: correlationId ?? id, pValue: 1, timestamp: ++this.testClock };
    const fdrStep = this.fdrStepper.step(hRecord);
    this._ledger.push(deepFreeze(fdrStep)); // an audit row is finished when it lands (see the other push site)
    const { record: hypothesisCommit } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor, // R8 branch-on-act: proposing from a past cursor branches first
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId: chartViewId(id),
      actorMeta: { actor: computedBy },
      kind: 'point',
      field: TEST_ANALOG_FIELD,
      value: 1,
      cause: stamped,
    });
    this.landed(hypothesisCommit);

    // (b) register the chart as a session view (the render source). The gated
    //     spec is stored as a JSON STRING (inert like the annotation note — the
    //     log's clause factory takes a primitive value), so it round-trips
    //     structuredClone + JSON with the rest of the log.
    const payload = JSON.stringify({ spec, claim, authoredBy: computedBy });
    const { record: specCommit } = this.log.commit({
      id: this.nextId(),
      parent: this._cursor,
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId: chartViewId(id),
      actorMeta: { actor: computedBy },
      kind: 'point',
      field: CHART_FIELD,
      value: payload,
      cause: stamped,
    });
    this.landed(specCommit);

    const hypothesis: ChartHypothesis = { chartId: id, claim, authoredBy: computedBy, tested: false, pValueUsed: 1, fdrStep };
    const view: ChartView = {
      chartId: id,
      viewId: chartViewId(id),
      spec,
      claim,
      authoredBy: computedBy,
      commitId: specCommit.id,
      ledgerStep: fdrStep.step,
    };
    this._charts.set(id, deepFreeze(view)); // a proposed chart is finished when it lands: `charts()` and `overview().charts` hand it out
    return { ok: true, chartId: id, view, hypothesis, commit: specCommit, fdrStep };
  }

  // ── L6 why(target) ─────────────────────────────────────────────────────────────
  why(target: WhyTarget, opts: { agentEventLog?: readonly AgentEventFrame[] } = {}): WhyResult {
    if (target.kind === 'prose') return this.whyProse(target, opts);
    const prov = target.kind === 'column'
      ? this.whyByColumn.get(target.column)
      : this.whyByAnalysisId.get(target.analysisId);
    if (!prov) return { ok: false, missing: 'no-such-target', target };
    return why(target, {
      vizRecords: this.log.records,
      declaringCommitId: prov.declaringCommitId,
      inputSelectionCommitIds: prov.inputSelectionCommitIds,
      ...(prov.snapshot ? { kernelSnapshot: prov.snapshot } : {}),
      ...(prov.kernelKey !== undefined ? { kernelKey: prov.kernelKey } : {}),
      ...(prov.correlationId !== undefined ? { correlationId: prov.correlationId } : {}),
      ...(opts.agentEventLog ? { agentEventLog: opts.agentEventLog } : {}),
      ...(prov.fdrStep ? { fdrStep: prov.fdrStep } : {}),
    });
  }

  /**
   * `why()` over a view's words: the `describe` commit that landed them is the
   * anchor; the selections live when they landed are the input; the proposal
   * they were accepted from, the commit their basis names and the commits their
   * spans cite ride as related commits; a basis that quotes an analysis
   * inherits that analysis's kernel slice. Words the declaration itself carries
   * have no commit — an honest `declared-in-def`.
   */
  private whyProse(target: Extract<WhyTarget, { kind: 'prose' }>, opts: { agentEventLog?: readonly AgentEventFrame[] }): WhyResult {
    const entry = [...foldStateAt(this.log.records, this._cursor).values()].find(
      (e): e is Extract<FoldEntry, { kind: 'prose' }> => e.kind === 'prose' && e.viewId === target.viewId && e.slot === target.slot,
    );
    if (entry === undefined) {
      // no describe commit on this branch (or the last one said null = back to the declaration)
      const declared = this.runtime.prose.get(target.viewId)?.[target.slot] !== undefined;
      return { ok: false, missing: declared ? 'declared-in-def' : 'no-such-target', target };
    }
    const landing = this.log.records.find((r) => r.id === entry.commitId)!; // the fold entry names a commit of this log
    const record = entry.record as unknown as ProseRecord;
    const inputSelectionCommitIds = [...foldStateAt(this.log.records, landing.id).values()].flatMap((e) => (e.kind === 'selection' ? [e.commitId] : []));
    const related: { id: string; kind: 'proposal' | 'basis' | 'ref' }[] = [];
    if (record.author.acceptedFrom !== undefined) related.push({ id: record.author.acceptedFrom, kind: 'proposal' });
    if (typeof record.basis?.atCommit === 'string') related.push({ id: record.basis.atCommit, kind: 'basis' });
    for (const ref of record.refs ?? []) if (ref.commit !== undefined) related.push({ id: ref.commit, kind: 'ref' });
    const quoted = record.basis?.analysisId !== undefined ? this.whyByAnalysisId.get(record.basis.analysisId) : undefined;
    return why(target, {
      vizRecords: this.log.records,
      declaringCommitId: landing.id,
      inputSelectionCommitIds,
      relatedCommits: related,
      ...(landing.correlationId !== undefined ? { correlationId: landing.correlationId } : {}),
      ...(quoted?.snapshot ? { kernelSnapshot: quoted.snapshot } : {}),
      ...(quoted?.kernelKey !== undefined ? { kernelKey: quoted.kernelKey } : {}),
      ...(quoted?.fdrStep ? { fdrStep: quoted.fdrStep } : {}),
      ...(opts.agentEventLog ? { agentEventLog: opts.agentEventLog } : {}),
    });
  }

  // ── ledgers ────────────────────────────────────────────────────────────────
  gaps(): readonly GapRow[] {
    return this.gapLedger.rows();
  }

  /**
   * The online-FDR audit trail. DETACHED by COPYING: `_ledger` is a list the
   * session still appends to, so a reader must not be handed the array itself
   * (it used to be — `ledger()` returned `this._ledger`, which a caller could
   * push a fabricated discovery onto). Cold enough that a copy per call is the
   * right trade.
   */
  ledger(): readonly FdrStep[] {
    return Object.freeze([...this._ledger]);
  }

  /** The wire's view of the bookmarks: `id` = the bookmark's own id (what a note links, and what a badge keys on), `label` = the name, `commitId` and `at` = the bookmarked moment, `ts` = that commit's position in the log — one truth, the bookmark store. */
  bookmarkViews(): readonly BookmarkView[] {
    const position = new Map(this.log.records.map((r, i) => [r.id, i] as const));
    return this.bookmarks().map((t) => Object.freeze({ id: t.id, label: t.name, commitId: t.commitId, at: t.commitId, ts: position.get(t.commitId) ?? -1 }));
  }

  // ── the whats_here projection ────────────────────────────────────────────────
  async overview(): Promise<Overview> {
    const selCount = await this.selectedCount(this.defaultTable, [...this.activeFilters.values()]);

    // columns per table (schema only — VALUES never ride here; Q8).
    const columns: Record<string, ColumnFacet[]> = {};
    const colNamesByTable = new Map<string, Set<string>>();
    for (const table of this.runtime.tables) {
      const cols = await this.effectiveColumnsOf(table); // branch-scoped: hides columns off the cursor's branch
      if ('rejected' in cols) {
        columns[table] = [];
        colNamesByTable.set(table, new Set());
      } else {
        // The encoding plane's facets: type + declared role/scale/label, and
        // the absence column's vocabulary — so an agent reading `whats_here`
        // knows "unavailable" is a kind of silence, not a category like any
        // other. Names + words, never values.
        columns[table] = this.runtime.encoding.facetsOf(table, cols);
        colNamesByTable.set(table, new Set(cols.map((c) => c.name)));
      }
    }
    const defaultCols = colNamesByTable.get(this.defaultTable) ?? new Set<string>();

    const views = [...this.runtime.views.values()].map((view) => {
      const cap = this.probeCapability(view.viewId);
      return {
        viewId: view.viewId,
        actor: view.meta.actor,
        ...(view.meta.label !== undefined ? { label: view.meta.label } : {}),
        ...(view.meta.does !== undefined ? { does: view.meta.does } : {}),
        // the same voice the act door and the offers use — never a second answer to "what can this view emit"
        selectionKinds: voiceOf(cap).filter((k): k is EmissionKind => k !== ENCODING_KIND),
        canProbe: cap?.canProbe ?? true,
        mounted: this.adapters.has(view.viewId),
        // The `reencode` fold (SPEC Q6 8th verb), branch-scoped at the cursor —
        // empty for a view with no declared encoding surface.
        encodings: this.viewEncodings(view.viewId),
        // Every view currently reads the session's single default table (D14
        // token-lean discipline: names+types only, so a chat agent can answer
        // "what can I put on x?" from this one entry).
        columns: columns[this.defaultTable] ?? [],
        // The encoding plane: per channel, every column judged as if bound
        // there now, with the sentence for each refusal (the picker greys with
        // it; the agent's whats_here projects it to the names that fit).
        ...(view.encoding !== undefined
          ? {
              fits: this.fitsOfView(view.viewId, view.encoding, columns[this.defaultTable] ?? []),
              // encoding links: what the view SHOWS — own bindings with followed channels laid over, refusals named
              effective: this.effectiveEncodings(columns[this.defaultTable] ?? []).get(view.viewId)!,
            }
          : {}),
        // the prose plane: every slot at the cursor, its staleness judged against what is on screen
        prose: this.proseOf(view.viewId, columns[this.defaultTable] ?? []),
        proposals: this.proposalsOf(view.viewId),
      };
    });
    const encodingPolicy = { onInvalid: this.runtime.encoding.rules.onInvalid ?? 'refuse', ruleScope: this.runtime.encoding.rules.ruleScope ?? ('dashboard' as const) };

    const activeSelections = [...this.activeFilters.entries()].map(([viewId, clause]) => selectionInfoOf(viewId, clause, this.activeFilterCommits.get(viewId)));
    const offers = this.offersNow();
    // layer 4 `onClear`: what each cleared view LAST selected, for the edges whose policy keeps it in force
    const clearedSelections = [...this.clearedFilters.entries()].map(([viewId, { clause, clearedBy }]) => ({ ...selectionInfoOf(viewId, clause), clearedBy }));

    const analyses = this.analysisIds().map((id) => {
      const a = this.analysis(id)!;
      const inputCols = a.def.inputs.map((b) => b.column);
      const missing = inputCols.filter((c) => !defaultCols.has(c));
      const minPoints = a.def.honesty?.minPoints;
      let ready = true;
      let blockedBy: GapCode | undefined;
      if (missing.length > 0) {
        ready = false;
        blockedBy = 'needs-column';
      } else if (a.def.produces !== 'columns' && minPoints !== undefined && selCount !== null && selCount < minPoints) {
        ready = false;
        blockedBy = 'guard-failed';
      }
      return {
        id,
        kind: a.kind,
        produces: a.def.produces,
        ready,
        ...(blockedBy ? { blockedBy } : {}),
        ...(missing.length > 0 ? { missingColumns: missing } : {}),
        ...(minPoints !== undefined ? { minPoints } : {}),
        ...(selCount !== null ? { selectedRows: selCount } : {}), // absent = not judged, never a fabricated 0
      };
    });

    const discoveries = this._ledger.filter((s) => s.reject).length;
    const wealth = this._ledger.length ? this._ledger[this._ledger.length - 1]!.wealthAfter : this.initialWealth;

    // ── the two-truths inputs (Phase A): cursor-local vs global (below in `fdr`) ──
    const cursorPath = this.branchPath(this._cursor);
    const cursorTests = cursorPath.filter(
      (r) => r.kind === 'point' && r.field === TEST_ANALOG_FIELD && typeof r.value === 'number',
    ).length;
    const time: TimeState = {
      cursor: this._cursor,
      head: this._head,
      branches: this.branches().length,
      bookmarks: this.bookmarks().length,
      cursorTests,
      viewingPast: this._cursor !== this._head,
    };

    // BR-1: the named-paths surface (refs, HEAD, journal) — whats_here reads this.
    const refHead = this.refs.head;
    const paths: PathsState = {
      current: this.refs.currentBranch(),
      detachedAt: 'detached' in refHead ? refHead.detached : null,
      list: this.paths(),
      // TL-1: archived paths are HIDDEN from `list`, so say how many there are —
      // an agent must be able to see that dead ends exist without listing them,
      // and the FDR ledger below still counts every test they ran.
      archived: this.refs.archivedNames().length,
      events: this.refs.events(), // already a frozen copy of the journal
    };

    // RP-3: the agent-authored charts + ledger status (token-lean — the SPEC
    // itself never rides whats_here; the host reads it via `session.charts()`).
    const charts: ChartInfo[] = this.charts().map((c) => ({
      chartId: c.chartId,
      viewId: c.viewId,
      claim: c.claim,
      authoredBy: c.authoredBy,
      ledgered: true,
      ledgerStep: c.ledgerStep,
    }));

    return {
      defaultTable: this.defaultTable,
      links: applyLinkOverrides(this.runtime.links, this.activeLinks),
      rules: describeRules(this.runtime.encoding.rules),
      encodingPolicy,
      views,
      // the prose plane's one non-view subject: the cockpit's own words (its caption = the summary of what it shows now)
      dashboard: { prose: this.proseOf(DASHBOARD_PROSE_ID, columns[this.defaultTable] ?? []), proposals: this.proposalsOf(DASHBOARD_PROSE_ID) },
      // the notes on the dashboard (the Text tool): every note subject with words at the cursor, in the order they were first written
      notes: this.notesInfo(columns[this.defaultTable] ?? []),
      saved: this.saved(),
      bookmarks: this.bookmarks(),
      activeSelections,
      // the live selections in the shape a prose basis states them (`basis.filters`) — an agent copies this verbatim
      filters: this.filtersNow(),
      clearedSelections,
      offers,
      // the one runtime record that MOVES (a refresh replaces a table's entry):
      // a frozen COPY, so a reader never holds the object the dashboard is
      // still writing. `keys`, `engines` and the link graph beside it are
      // build-time constants and are frozen once, at build.
      sources: deepFreeze({ ...this.runtime.sources }),
      keys: this.runtime.keys,
      // the Sources tab's rows: every declared table as the def states it, and the data journal beside the log
      tables: this.tablesInfo(),
      journal: Object.freeze(this.runtime.journal.slice(-JOURNAL_TAIL)), // fresh list; each entry was frozen when it was written
      journalTotal: this.runtime.journal.length,
      selectedRowCount: selCount,
      analyses,
      fdr: {
        procedure: this.runtime.fdrProcedure,
        alpha: this.runtime.fdrAlpha,
        tests: this._ledger.length,
        discoveries,
        wealth,
        ledger: this.ledger(),
      },
      columns,
      encodings: Object.fromEntries(views.map((v) => [v.viewId, v.encodings])),
      effectiveEncodings: Object.fromEntries(views.map((v) => [v.viewId, v.effective?.bindings ?? v.encodings])),
      // LY-1: the layout fold (scope → prop → value), branch-scoped at the
      // cursor like `encodings` — cloned so a caller can never mutate the fold.
      layouts: Object.fromEntries([...this.activeLayouts.entries()].map(([scope, props]) => [scope, { ...props }])),
      gaps: this.gapLedger.size,
      currentView: this._currentView,
      engines: this.runtime.engines,
      time,
      paths,
      charts,
    };
  }
}

/** Construct a live session over a resolved dashboard runtime. Called by `buildDashboard`. */
export function createInteractionSession(runtime: DashboardRuntime, opts?: SessionOptions): InteractionSession {
  return new InteractionSessionImpl(runtime, opts);
}
