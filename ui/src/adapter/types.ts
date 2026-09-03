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
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
  /** For kind:'cell' this is the display-only joint label ("price × category"); the pair rides `fields` (D30). */
  readonly field: string;
  /** For kind:'cell': the two-sided pair `[x side, y side]`, or null for a cleared cell. */
  readonly value: unknown;
  /** kind:'cell' only — the two selected fields, x side then y side. */
  readonly fields?: readonly [string, string];
  /** The principal that authored the commit (`cause.requestedBy`). */
  readonly actor: Actor;
  /** Which family the commit belongs to — interaction, design, analysis, story — derived from its namespace; the log filters by it. Absent = interaction (an older adapter). */
  readonly family?: 'interaction' | 'design' | 'analysis' | 'story';
  /** The human-facing intent string, if the cause carried one. */
  readonly intent?: string;
  /** Cross-tier join key (R10), if stamped. */
  readonly correlationId?: string;
  /** BR-1 provenance: this commit BRINGS OVER (replays) another commit's step. */
  readonly replayedFrom?: string;
  /** BR-1 provenance: this commit UNDOES (reverts) another commit's step. */
  readonly revertOf?: string;
  /** Commit ids that touched the same state on this path since the fork (honest conflict note). */
  readonly conflicts?: readonly string[];
  /** The data versions this commit was true of (table → version), when the tables declare sources. */
  readonly data?: Readonly<Record<string, string>>;
  /** True when a table this commit was true of has since moved to another version — the number it shows may not be reproducible. */
  readonly dataMoved?: boolean;
  /** The tables that moved, each with the version the commit was true of and the version now. */
  readonly moved?: readonly { readonly table: string; readonly from: string; readonly to: string }[];
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

/** One column facet — name, type, and the role the def declared. VALUES never ride here (schema only). */
export interface ColumnView {
  readonly field: string;
  readonly type: string;
  /** What the column IS to a chart, when the def declared (or derived) one: `identifier | dimension | measure | absence`. Absent on an older wire. */
  readonly role?: string;
  /** The declared absence vocabulary, when the def named this column as the table's absence column — words, never values. */
  readonly absence?: readonly string[];
}

/** A view (chart) the session exposes, with its clause-kind capabilities. */
export interface ViewView {
  readonly viewId: string;
  readonly actor: Actor;
  readonly label?: string;
  /** Which point/interval/cell/match SELECTION kinds this view can emit (R3 capability). */
  readonly selectionKinds: readonly ('point' | 'interval' | 'cell' | 'match')[];
  readonly canProbe: boolean;
  readonly mounted: boolean;
  /** The current channel→field visual-encoding map at the cursor (the `reencode` fold; UI-0). */
  readonly encoding: Readonly<Record<string, string>>;
  /** Columns available to encode onto, branch-scoped at the cursor (names+types only). */
  readonly columns: readonly ColumnView[];
  /** The encoding plane: per channel, every column judged as if bound there now — the picker greys with `because`. Absent when the wire predates the plane or the view has no encoding surface. */
  readonly fits?: Readonly<Record<string, readonly FitView[]>>;
  /** Encoding links: what the view shows, which channels it follows (and through which edge), and which follows its own rules refused. */
  readonly effective?: EffectiveEncodingView;
  /** The prose plane: the view's words at the cursor — each slot with its author kind and whether it went stale. Absent on a server that predates prose. */
  readonly prose?: readonly ProseStatusView[];
  /** The prose plane: proposals on the table for this view, one per slot, with their derived status. */
  readonly proposals?: readonly ProposalView[];
}

/** One prose slot as the wire serves it (src/prose `ProseStatus`, the parts a cockpit renders). */
export interface ProseStatusView {
  readonly slot: 'title' | 'caption' | 'altShort' | 'altLong' | 'howToRead';
  readonly text: string;
  readonly status: 'current' | 'stale' | 'derived';
  /** For a stale slot: what moved. */
  readonly changed: readonly string[];
  readonly author: { readonly kind: 'human' | 'agent' | 'derived' | 'humanEdited'; readonly by?: string; readonly model?: string; readonly at?: string };
  readonly levels: readonly string[];
  /** What the words were written against (encodings, filters, columns, analysisId) — shown so a person can see why a slot went stale. */
  readonly basis?: Readonly<Record<string, unknown>>;
  /** Spans of the text that point at a saved interaction (a commit, a bookmark or a saved selection, each by its id) — rendered as small anchors. Absent when there are none. */
  readonly refs?: readonly ProseRefView[];
}

/** A proposal as the wire serves it (src/prose `ProposalStatus`). */
/** One note on the dashboard (`describe` with viewId `'note:<id>'`): words with an author and refs, judged like the dashboard's. */
export interface NoteView {
  readonly id: string;
  readonly prose: readonly ProseStatusView[];
  readonly proposals: readonly ProposalView[];
}

/** The dashboard's own words (`describe` with viewId `'dashboard'`): the same slots a view carries, judged the same way. */
export interface DashboardWordsView {
  readonly prose: readonly ProseStatusView[];
  readonly proposals: readonly ProposalView[];
}

export interface ProposalView {
  readonly slot: ProseStatusView['slot'];
  /** The proposing commit's id — what accept and decline name. */
  readonly proposal: string;
  readonly text: string;
  readonly status: 'open' | 'accepted' | 'declined';
  readonly author: ProseStatusView['author'];
  readonly levels: readonly string[];
  readonly basis?: Readonly<Record<string, unknown>>;
  readonly by?: string;
  readonly reason?: string;
}

export interface ProseRefView {
  readonly span: readonly [number, number];
  /** A commit by its id. */
  readonly commit?: string;
  /** A bookmark by its ID (`b1`, …), never its name — which is why renaming a bookmark leaves every note working. */
  readonly bookmark?: string;
  /** The words the anchor shows: the name as it read when the link was made (a later rename may leave it stale). */
  readonly label?: string;
  /** A saved selection by its ID (`p1`, …) — a click applies the saved logic, it never seeks. */
  readonly saved?: string;
}

export interface EffectiveEncodingView {
  readonly bindings: Readonly<Record<string, string>>;
  readonly followed: Readonly<Record<string, { readonly edge: string; readonly from: string; readonly sourceChannel: string }>>;
  readonly refused: Readonly<Record<string, { readonly edge: string; readonly field: string; readonly sentence: string }>>;
}

/** One column's fitness for one channel (src/encoding `Fit`). */
export interface FitView {
  readonly field: string;
  readonly ok: boolean;
  readonly because?: string;
}

/** One encoding rule as a sentence (src/encoding `RuleLine`). */
export interface RuleLineView {
  readonly id: string;
  readonly builtIn: boolean;
  readonly sentence: string;
}

/** A live DATA-space selection (never pixels). */
export interface SelectionView {
  readonly viewId: string;
  /** For kind:'cell' this is the display-only joint label; the pair rides `fields` (D30). */
  readonly field: string;
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
  /** For kind:'cell': the two-sided pair `[x side, y side]`; for kind:'match': `{ values, exclude? }` (SET-1) or null. */
  readonly value: unknown;
  /** kind:'cell' only — the two selected fields, x side then y side. */
  readonly fields?: readonly [string, string];
  /** The commit that landed this live selection — what a note (a saved selection) or a bring-over names. Absent on an older server. */
  readonly commitId?: string;
}

/** Provenance of one table's source: what the carrier vouched for when it was read. */
export interface SourceInfoView {
  readonly format: string;
  readonly via: string;
  readonly at?: string;
  readonly version: string;
  readonly retrievedAt: string;
  readonly rows: number;
}

/** One declared table as the def states it — nothing inferred from the rows. */
export interface TableView {
  readonly name: string;
  /** A declared source (`format · via · at`, the locator only when it was a string), inline rows / CSV text carried by the def, or `unstated` when the wire's entry could not be read (the table still counts). */
  readonly source: { readonly format: string; readonly via: string; readonly at?: string } | { readonly inline: 'rows' | 'csv'; readonly rows?: number } | { readonly unstated: true };
  readonly engine: string;
  readonly key?: string;
  readonly grain?: { readonly bucket?: string; readonly reducer?: string; readonly collapsedFrom?: number; readonly note?: string };
  readonly absence?: { readonly field: string; readonly states: readonly string[] };
  readonly declaredColumns: number;
}

/** What a refresh's delta says: exact by the declared row key, or a plain replace when there was no usable key. */
export type RefreshDeltaView =
  | { readonly keyed: true; readonly key: string; readonly added: number; readonly updated: number; readonly removed: number; readonly unkeyed: number }
  | { readonly keyed: false; readonly replaced: number; readonly keyAbsent?: string };

/** One table's answer to a refresh, as the journal keeps it — three arms validated off the wire, and `unreadable` when the wire carried something else (the answer is kept as a fact that could not be read, never dropped or invented). */
export type RefreshOutcomeView =
  | { readonly unchanged: true; readonly version: string }
  | { readonly changed: true; readonly from: string; readonly to: string; readonly retrievedAt: string; readonly rows: number; readonly delta: RefreshDeltaView; readonly materialisedLost?: readonly string[] }
  | { readonly refused: true; readonly reason: string; readonly message: string }
  | { readonly unreadable: true };

/** One refresh in the data journal: when it ran, which tables were asked, what each answered. */
export interface RefreshRecordView {
  readonly at: string;
  readonly asked: readonly string[];
  readonly tables: Readonly<Record<string, RefreshOutcomeView>>;
}

/** A SAVED selection: a selection commit somebody named with a note. Applying it is `bringOver(commitId)`. */
export interface SavedSelectionView {
  /** The note's words — the name. */
  readonly name: string;
  /** The selection commit the note names. */
  readonly commitId: string;
  /** The annotation commit that named it. */
  readonly noteId: string;
  readonly viewId: string;
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
  readonly field: string;
  readonly value: unknown;
  readonly fields?: readonly [string, string];
  readonly actor: Actor;
}

/** A view whose last selection was CLEARED, and what it was — an edge's `onClear` policy reads it (layer 4). */
export interface ClearedSelectionView extends SelectionView {
  /** The commit that cleared it. */
  readonly clearedBy: string;
}

/** A branch tip in the DAG (a leaf lineage). */
export interface BranchView {
  readonly tip: string;
  readonly length: number;
  readonly actor: Actor;
  readonly active: boolean;
}

/** One NAMED path (a saved line of work — a git-style branch, in plain words). */
export interface PathView {
  readonly name: string;
  /** The last commit on this path (its tip). */
  readonly tip: string;
  /** Commits from the start of the story down to the tip. */
  readonly steps: number;
  /** The tip commit's logical timestamp — for "most recent first" ordering, not wall-clock. */
  readonly lastTs: number;
  /** True iff this is the path you are currently on. */
  readonly active: boolean;
  /**
   * TL-1: present (always `true`) only on an ARCHIVED path — hidden from the
   * default list, its steps never deleted. Absent on a visible path.
   */
  readonly archived?: true;
}

/**
 * One entry in the path journal (create/advance/switch/rename). Bookkeeping
 * records, never commits — mirrors `src/branches` RefEvent 1:1 so the poll
 * wire and the live session serialize identically.
 */
export type PathEventView =
  | { readonly type: 'create'; readonly name: string; readonly at: string; readonly auto: boolean; readonly ts: number }
  | { readonly type: 'advance'; readonly name: string; readonly at: string; readonly ts: number }
  | { readonly type: 'switch'; readonly to: string | null; readonly at: string | null; readonly ts: number }
  | { readonly type: 'rename'; readonly from: string; readonly to: string; readonly ts: number }
  // ── TL-1 lifecycle events — each carries the principal that asked for it ──
  | { readonly type: 'archive'; readonly name: string; readonly at: string; readonly by: string; readonly ts: number }
  | { readonly type: 'restore'; readonly name: string; readonly at: string; readonly by: string; readonly ts: number }
  | {
      readonly type: 'discard';
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly kept: string;
      readonly by: string;
      readonly ts: number;
    };

/** The named-paths surface (BR-1): which path you are on (or detached), the list, the journal. */
export interface PathsView {
  /** The named path you are on, or null while detached (travelled into the past by commit id). */
  readonly current: string | null;
  /** The commit you are detached at (null when on a named path — or before any commit exists). */
  readonly detachedAt: string | null;
  /** The VISIBLE paths. Archived ones live in {@link PathsView.archivedList}. */
  readonly list: readonly PathView[];
  /**
   * TL-1: the ARCHIVED paths (hidden from `list`, never erased) — each flagged
   * `archived: true`. The PathsModal reveals them behind a "show archived"
   * toggle; the BranchMap greys their lanes.
   */
  readonly archivedList: readonly PathView[];
  /** The path journal — the ForkToast watches this for auto-forks. */
  readonly events: readonly PathEventView[];
}

/** An empty, render-safe paths surface. */
export function emptyPaths(): PathsView {
  return { current: null, detachedAt: null, list: [], archivedList: [], events: [] };
}

// ── compare (two positions side by side) ────────────────────────────────────────

/** One side of a compare: how it was named, the tip it resolved to, its row count. */
export interface CompareSideView {
  readonly ref: string;
  readonly tip: string;
  /** Rows under this side's selections — null when the backend cannot count (honest, never 0-faked). */
  readonly rows: number | null;
}

/** One state entry present on exactly ONE side, in plain language. */
export interface CompareEntryView {
  readonly key: string;
  readonly kind: 'selection' | 'encoding' | 'analysis' | 'link' | 'prose';
  /** What the entry is about (a view id or an analysis id). */
  readonly label: string;
  /** The entry's value, in plain words (e.g. "price between 30 and 210"). */
  readonly detail: string;
}

/** One state entry present on BOTH sides with different values. */
export interface CompareChangeView {
  readonly key: string;
  readonly kind: 'selection' | 'encoding' | 'analysis' | 'link' | 'prose';
  readonly label: string;
  readonly a: string;
  readonly b: string;
}

/** The normalized compare result the CompareModal renders. */
export type CompareView =
  | {
      readonly ok: true;
      readonly a: CompareSideView;
      readonly b: CompareSideView;
      /** The common-ancestor commit id, or null when the two sides share no start. */
      readonly ancestor: string | null;
      readonly changed: readonly CompareChangeView[];
      readonly onlyA: readonly CompareEntryView[];
      readonly onlyB: readonly CompareEntryView[];
    }
  | { readonly ok: false; readonly reason: string };

/** A named log position: one bookmark, as the wire carries it (present mode walks these). */
export interface BookmarkView {
  /** The bookmark's own id (`b1`, …) — what a note's words link and what a badge keys on, so a rename moves nothing. Absent on a wire that predates bookmark ids. */
  readonly id?: string;
  readonly label: string;
  /** The bookmark commit (the act of naming). */
  readonly commitId: string | null;
  /** The position it names (the bookmark's parent); absent on older wires ⇒ the bookmark itself. */
  readonly at?: string | null;
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

// ── cockpit layout (LY-1: view-state that time-travels) ────────────────────────

/** The three user-pickable cockpit arrangements — plain names, v1. */
export type LayoutPreset = 'flow' | 'grid' | 'focus';

/**
 * The dashboard's arrangement at the cursor — parsed from the session's
 * `layout:dashboard` fold (the `navigate` verb's layout namespace, LY-1), so
 * seeking / switching paths / walking present-mode bookmarks restores it. The
 * cockpit is DRIVEN by this (never self-stateful).
 */
export interface LayoutView {
  readonly preset: LayoutPreset;
  /** Chart-cell ids in display order; empty = the consumer's own order. */
  readonly order: readonly string[];
  /** The maximized chart in the `focus` preset; null = the first cell. */
  readonly focusId: string | null;
}

/** What `SessionView.setLayout` accepts — any subset; each prop lands its own commit. */
export interface LayoutChange {
  readonly preset?: LayoutPreset;
  readonly order?: readonly string[];
  readonly focusId?: string;
}

/** The render-safe default arrangement (no layout note landed yet). */
export function defaultLayout(preset: LayoutPreset = 'flow'): LayoutView {
  return { preset, order: [], focusId: null };
}

/**
 * Parse the wire's plain-string layout props (`layouts.dashboard`) into the
 * typed view. Defensive: an unknown preset string folds to `flow`, a blank
 * focus to null — a stale or foreign wire renders the honest default, never
 * crashes.
 */
export function parseLayout(raw: Readonly<Record<string, string>> | undefined, fallback: LayoutPreset = 'flow'): LayoutView {
  const preset: LayoutPreset = raw?.['preset'] === 'grid' || raw?.['preset'] === 'focus' || raw?.['preset'] === 'flow' ? raw['preset'] : fallback;
  const orderRaw = raw?.['order'];
  const order = orderRaw !== undefined ? orderRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];
  const focusRaw = raw?.['focus'];
  const focusId = focusRaw !== undefined && focusRaw.length > 0 ? focusRaw : null;
  return { preset, order, focusId };
}

/**
 * An agent-authored chart (RP-3): a runtime-proposed spec that passed the
 * governed pipeline (schema-valid → capability-check → LORD++ hypothesis) and
 * is now a real, renderable cockpit cell. The `spec` is the gated Vega-Lite
 * JSON a consumer binds via its own RP-2 bridge (the ui package never depends
 * on a bridge — the consumer supplies the renderer).
 */
export interface ChartCellView {
  readonly chartId: string;
  /** The synthetic view identity `chart:${chartId}` — its crossfilter self-exclusion key. */
  readonly viewId: string;
  /** The gated spec (opaque JSON; the host owns the data channel). */
  readonly spec: unknown;
  /** The chart's ledgered claim (inert text). */
  readonly claim: string;
  /** Who authored the proposal (agent-authored provenance). */
  readonly authoredBy: Actor;
  /** Its row position in the online-FDR ledger. */
  readonly ledgerStep: number;
}

/** The normalized dashboard state — the single render source. */
/** One edge of the link graph as the wire carries it (src/links `LinkEdge`, verbatim JSON). */
export interface LinkEdgeView {
  readonly id: string;
  readonly source: string;
  /** An emission kind (a selection), or `encoding` — the source's channel BINDING, which the target may follow. */
  readonly kind: 'point' | 'interval' | 'cell' | 'match' | 'encoding';
  readonly target: string;
  /** `follow` and `none` are the responses of an encoding edge; the rest answer a selection. */
  readonly response: 'filter' | 'highlight' | 'navigate' | 'mirror' | 'none' | 'follow';
  readonly origin: 'declared' | 'default' | 'edited';
  readonly mapping?: readonly { readonly from: string; readonly to: string }[];
  /** Encoding edges: which channels follow (source channel → target channel), always written out. */
  readonly channels?: readonly { readonly from: string; readonly to: string }[];
  readonly onClear?: 'leave' | 'showAll' | 'excludeAll';
  readonly fold?: string;
  readonly label?: string;
}
/** The materialized link graph (layer 4): what each view's emission does to every other view. */
export interface LinkGraphView {
  readonly default: 'crossfilter' | 'none';
  readonly views: readonly { readonly viewId: string; readonly voice: readonly ('point' | 'interval' | 'cell' | 'match' | 'encoding')[]; readonly channels?: readonly string[] }[];
  readonly edges: readonly LinkEdgeView[];
}

export interface SessionViewState {
  readonly defaultTable: string;
  readonly views: readonly ViewView[];
  /** viewId → { channel: field } — the `reencode` fold (Overview.encodings). */
  readonly encodings: Readonly<Record<string, ViewEncoding>>;
  /** viewId → the bindings ON SCREEN under the link graph (followed channels laid over the view's own). Render these; edit `encodings`. Absent on a server that predates encoding links. */
  readonly effectiveEncodings?: Readonly<Record<string, ViewEncoding>>;
  /** table → column facets (schema). */
  readonly columns: Readonly<Record<string, readonly ColumnView[]>>;
  readonly selections: readonly SelectionView[];
  /** Layer 4: views whose selection was cleared and what it was, so an edge's `onClear` policy can act on it. */
  readonly cleared?: readonly ClearedSelectionView[];
  /** Saved selections: every selection commit a note named, newest note first; apply one with `bringOver`. Absent = an older adapter. */
  readonly saved?: readonly SavedSelectionView[];
  /** Provenance per table: what each declared source vouched for (version, retrieval time, rows). Absent = an older server, or no declared source. */
  readonly sources?: Readonly<Record<string, SourceInfoView>>;
  /** The prose plane's one non-view subject: the dashboard's own words at the cursor (its caption = the summary), with the proposals on the table for them. Absent on an older wire. */
  readonly dashboard?: DashboardWordsView;
  /** The notes on the dashboard (the Text tool): every `note:<id>` with words at the cursor, oldest first. Absent on an older wire. */
  readonly notes?: readonly NoteView[];
  /** The live selections in the shape a prose basis states them (`overview.filters`) — what an agent-authored note copies as its basis. Absent on an older wire. */
  readonly filters?: Readonly<Record<string, unknown>>;
  /** Every declared table as the def states it (the Sources tab's rows). Absent on an older wire. */
  readonly tables?: readonly TableView[];
  /** The data journal's latest records, oldest first. Absent on an older wire. */
  readonly journal?: readonly RefreshRecordView[];
  /** How many records the journal holds in all — more than `journal.length` means older answers lie beyond what the wire carried. */
  readonly journalTotal?: number;
  readonly commits: readonly CommitView[];
  readonly branches: readonly BranchView[];
  /** The NAMED paths surface (BR-1): current/detached, list, journal. */
  readonly paths: PathsView;
  readonly bookmarks: readonly BookmarkView[];
  readonly cursor: string | null;
  readonly head: string | null;
  /** root→head commit ids (the active lineage). */
  readonly activePathIds: readonly string[];
  readonly viewingPast: boolean;
  readonly ledger: LedgerView;
  readonly gaps: readonly GapView[];
  readonly readiness: readonly ReadinessView[];
  /** RP-3: agent-authored charts, each a real cockpit cell the consumer renders via its RP-2 bridge. */
  readonly charts: readonly ChartCellView[];
  /** LY-1: the dashboard arrangement at the cursor (the `layout:dashboard` fold) — drives the cockpit. */
  readonly layout: LayoutView;
  /** Optional provider/mode label for a status readout. */
  readonly mode?: string;
  /**
   * Layer 4: the link graph at the cursor. ABSENT when the server predates
   * links — then the old rule holds (every clause filters every other view).
   */
  readonly links?: LinkGraphView;
  /** The encoding plane's rules as sentences (built-in first); absent when the wire predates the plane. */
  readonly rules?: readonly RuleLineView[];
  /** What happens to a misfit (refuse, or a coercer's name) and how far a two-column rule reaches. */
  readonly encodingPolicy?: { readonly onInvalid: string; readonly ruleScope: 'view' | 'dashboard' };
}

/** The verbatim honesty line (single-sourced here). */
export const HONESTY_LINE = 'alpha spent on abandoned branches is never refunded';

/**
 * TL-1 — the verbatim line every HIDING action states, on the confirm dialog
 * and in the toast. Stated locally (the HONESTY_LINE precedent) so a POLL
 * consumer needs no src value import; a parity test pins it byte-for-byte
 * against `src/agent`'s `HIDDEN_NOT_ERASED`, the same words the agent reads.
 */
export const HIDDEN_NOT_ERASED = 'Hidden, not erased — the statistics remember.';

/**
 * What an `adoptPath` run did, in the numbers a person needs: how many of the
 * other path's steps landed here, how many were honestly skipped (with their
 * reasons), and how many collided with work this path already did. A refused
 * adopt carries its `reason` instead — never a silent nothing.
 */
export interface AdoptSummaryView {
  readonly ok: boolean;
  /** The path adopted from (left untouched by the run). */
  readonly path: string;
  readonly applied: number;
  readonly skipped: number;
  /** How many of this path's own steps the replay collided with. */
  readonly conflicts: number;
  /** One honest line per skipped step. */
  readonly skippedReasons: readonly string[];
  /** Present only when the adopt was refused outright. */
  readonly reason?: string;
}

/** An empty, render-safe state (before the first snapshot resolves). */
export function emptyState(defaultTable = 'data'): SessionViewState {
  return {
    defaultTable,
    views: [],
    encodings: {},
    columns: {},
    selections: [],
    saved: [],
    commits: [],
    branches: [],
    paths: emptyPaths(),
    bookmarks: [],
    cursor: null,
    head: null,
    activePathIds: [],
    viewingPast: false,
    ledger: { procedure: 'LORD++', alpha: 0.05, tests: 0, discoveries: 0, wealth: 0, steps: [], cursorTests: 0, honesty: HONESTY_LINE },
    gaps: [],
    readiness: [],
    charts: [],
    layout: defaultLayout(),
  };
}
