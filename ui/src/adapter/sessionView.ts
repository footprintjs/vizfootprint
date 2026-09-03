/**
 * `createSessionView(source)` — the framework-light store every component reads.
 *
 * A SOURCE is one of two things:
 *   • an in-process {@link SessionLike} (a live vizfootprint InteractionSession),
 *     read via `overview()` + `log.records` + `gaps/branches/checkpoints`;
 *   • a polled state ENDPOINT (the demo's `/api/state` shape), fetched on a timer.
 * Both normalize into the ONE {@link SessionViewState}. The store exposes
 * `getState()` + `subscribe()` (so a React `useSyncExternalStore`, or any other
 * framework, can bind) and a small set of ACTION methods that route to whichever
 * source is behind it, then refresh. Components never touch the source directly.
 *
 * UI-0 CONTRACT (landed, fe6e5b5): `reencode(viewId, channel, field)` rides
 * `dispatch({ verb: 'reencode', … })` — the 8th verb; there is deliberately NO
 * `session.reencode()` method. `Overview.encodings[viewId]` (a channel→field
 * convenience projection) and `views[].encodings`/`views[].columns` feed the
 * state's `encodings` map and per-view columns; the old point/interval sense
 * of `ViewInfo.encodings` is now `selectionKinds`.
 */

import type { Actor } from '../../../src/cause/index.js';
import type { CommitRecord } from '../../../src/log/index.js';
import { familyOf } from '../../../src/branches/fold.js';
import { PROPOSAL_LANE } from '../../../src/prose/index.js';
import type {
  Overview,
  GapRow,
  BranchInfo,
  CellValues,
  Checkpoint,
  SeekResult,
  DispatchAction,
  DispatchResult,
  SwitchPathResult,
  RenamePathResult,
  NewPathResult,
  CompareResult,
  BringOverResult,
} from '../../../src/session/index.js';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import {
  ClearedSelectionView, LinkGraphView,
  HONESTY_LINE,
  emptyState,
  emptyPaths,
  type AdoptSummaryView,
  type SessionViewState,
  type CommitView,
  type ViewView,
  type ColumnView,
  type SelectionView,
  type BranchView,
  type PathView,
  type PathsView,
  type PathEventView,
  type CompareView,
  type CheckpointView,
  type LedgerView,
  type GapView,
  type ReadinessView,
  type ViewEncoding,
  type ChartCellView,
  type LayoutChange,
  type LayoutView,
  parseLayout, type FitView, type RuleLineView, type EffectiveEncodingView, type LinkEdgeView, type ProseStatusView, type ProseRefView, type ProposalView, type SavedSelectionView, type SourceInfoView, type DashboardWordsView, type NoteView, type TableView, type RefreshRecordView, type RefreshOutcomeView, type RefreshDeltaView, type LayoutPreset } from './types.js';
import { mapCompareResult, type RawCompareResult } from './compareView.js';
import { activePath, pathToRoot, stepBackTarget, stepForwardTarget } from './stepNav.js';
import type { NavigateViewState } from '../contract/types.js';

// ── the structural session contract (duck-typed; no value import from src) ─────

/** The subset of a vizfootprint `InteractionSession` the adapter reads/drives. */
export interface SessionLike {
  overview(): Promise<Overview> | Overview;
  gaps(): readonly GapRow[];
  branches(): readonly BranchInfo[];
  checkpoints(): readonly Checkpoint[];
  seek(commitId: string): SeekResult;
  dispatch(action: DispatchAction, opts?: { as?: Actor }): Promise<DispatchResult> | DispatchResult;
  // ── named paths (BR-1) — a rejected call files a typed gap; the next refresh shows it ──
  switchPath(name: string): SwitchPathResult;
  renamePath(from: string, to: string): RenamePathResult;
  newPathAt(commitId: string, name?: string): NewPathResult;
  compare(aRef: string, bRef: string): Promise<CompareResult> | CompareResult;
  bringOver(commitId: string, opts?: { as?: Actor }): Promise<BringOverResult> | BringOverResult;
  undo(commitId: string, opts?: { as?: Actor }): Promise<BringOverResult> | BringOverResult;
  // ── the trail lifecycle (TL-1) — hiding and rewinding, never deleting ──
  /** The archived paths are needed for the "show archived" reveal, so read the FULL list too. */
  paths(opts?: { includeArchived?: boolean }): readonly RawPath[];
  archivePath(name: string, opts?: { as?: Actor }): unknown;
  restorePath(name: string, opts?: { as?: Actor }): unknown;
  discardFromHere(opts?: { at?: string; as?: Actor }): unknown;
  adoptPath(name: string, opts?: { as?: Actor }): Promise<RawAdoptResult> | RawAdoptResult;
  /** RP-3: agent-authored charts (with their gated specs). Optional — a pre-RP-3 session simply has none. */
  charts?(): readonly RawChart[];
  readonly log: { readonly records: readonly CommitRecord[] };
}

/** One path row as either source serializes it (src `PathInfo` / its `/api/state` JSON). */
export interface RawPath {
  readonly name: string;
  readonly tip: string;
  readonly steps: number;
  readonly lastTs: number;
  readonly active: boolean;
  /** TL-1: present (true) only on an archived path. */
  readonly archived?: true;
}

/**
 * What an `adoptPath` run answers with (src `AdoptPathResult`, or the same JSON
 * off the endpoint). Read structurally so a poll consumer needs no src import.
 */
export interface RawAdoptResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly applied?: number;
  readonly skipped?: number;
  readonly conflicts?: readonly string[];
  readonly steps?: readonly { readonly applied: boolean; readonly skippedReason?: string }[];
  readonly gap?: { readonly detail?: string };
  /** A demo server's own transport-level refusal (never a session gap). */
  readonly error?: string;
}

/** The wire shape of one agent-authored chart (src `ChartView`, or its `/api/state` JSON). */
export interface RawChart {
  readonly chartId: string;
  readonly viewId: string;
  readonly spec: unknown;
  readonly claim: string;
  readonly authoredBy: Actor;
  readonly ledgerStep: number;
}

/** The raw `/api/state` payload a polled endpoint returns (the demo's shape). */
export interface RawPollState {
  readonly records: readonly RawPollCommit[];
  readonly views?: readonly unknown[];
  readonly activeSelections?: readonly unknown[];
  /** Layer 4 `onClear`: views whose selection was cleared and what it was (each row carries `clearedBy`). */
  readonly clearedSelections?: readonly unknown[];
  /** Provenance per table (what each declared source vouched for). */
  readonly sources?: unknown;
  /** The dashboard's own words (`overview.dashboard`), if the wire carries them. */
  readonly dashboard?: unknown;
  /** The notes on the dashboard (`overview.notes`), if the wire carries them. */
  readonly notes?: unknown;
  /** The live selections in basis shape (`overview.filters`), if the wire carries them. */
  readonly filters?: unknown;
  /** Every declared table (`overview.tables`), if the wire carries them. */
  readonly tables?: unknown;
  /** The data journal (`overview.journal`), if the wire carries it. */
  readonly journal?: unknown;
  /** How many journal records exist in all (`overview.journalTotal`). */
  readonly journalTotal?: unknown;
  readonly analyses?: readonly unknown[];
  readonly fdr?: unknown;
  readonly columns?: Readonly<Record<string, readonly { field: string; type: string; role?: string; absence?: readonly string[] }[]>>;
  readonly encodings?: Readonly<Record<string, ViewEncoding>>;
  readonly gaps?: readonly unknown[];
  readonly branches?: readonly { tip: string; length: number; actor: Actor; active: boolean }[];
  /** BR-2: the named-paths surface (`overview().paths` serialized as-is). */
  readonly paths?: RawPollPaths;
  readonly checkpoints?: readonly { id?: string; label: string; commitId: string | null; at?: string | null; ts: number }[];
  readonly cursor?: string | null;
  readonly head?: string | null;
  readonly cursorTests?: number;
  readonly viewingPast?: boolean;
  readonly defaultTable?: string;
  readonly mode?: string;
  /** RP-3: the agent-authored charts (`session.charts()` serialized). */
  readonly charts?: readonly RawChart[];
  /** LY-1: the layout fold (`overview().layouts` serialized) — scope → prop → value. */
  readonly layouts?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Layer 4: the link graph (`overview().links` serialized) — absent on a server that predates links. */
  /** The encoding plane (`overview().rules` / `encodingPolicy` serialized). */
  readonly rules?: unknown;
  /** Encoding links: `overview().effectiveEncodings` serialized. */
  readonly effectiveEncodings?: unknown;
  readonly encodingPolicy?: unknown;
  readonly links?: unknown;
}
/** The `paths` slice of `/api/state` — `PathsState` from `src/session`, verbatim JSON. */
export interface RawPollPaths {
  readonly current?: string | null;
  readonly detachedAt?: string | null;
  readonly list?: readonly RawPath[];
  /**
   * TL-1: the ARCHIVED paths, flagged. A server serializes
   * `session.paths({includeArchived:true})` here (the hidden rows the modal
   * reveals); absent on a pre-TL-1 server, which simply has none.
   */
  readonly archivedList?: readonly RawPath[];
  readonly events?: readonly PathEventView[];
}
interface RawPollCommit {
  /** The data versions this commit was true of (table → version), when the tables declare sources. */
  readonly data?: Readonly<Record<string, string>>;
  readonly id: string;
  readonly parent: string | null;
  readonly viewId: string;
  readonly kind: 'point' | 'interval' | 'cell' | 'match';
  readonly field: string;
  readonly value: unknown;
  /** kind:'cell' only (D30) — the two selected fields, x side then y side. */
  readonly fields?: readonly [string, string];
  readonly cause?: { requestedBy?: Actor; intent?: string; replayedFrom?: string; revertOf?: string; conflicts?: readonly string[] };
  readonly correlationId?: string;
}

// ── source configs + factories ─────────────────────────────────────────────────

export interface SessionSourceInput {
  readonly kind: 'session';
  readonly session: SessionLike;
}
/**
 * The polled server's endpoint map — each action POSTs JSON to its OWN
 * endpoint (the seek/checkpoint pattern). The BR-2/BR-3 contract:
 *
 *   GET  state      → the RawPollState JSON (now incl. `paths` + BR-1 cause tags)
 *   POST dispatch   → a dispatch action body ({ verb, … })
 *   POST seek       → { commitId }
 *   POST checkpoint → { label }
 *   POST paths      → { action: 'switch', name }
 *                   | { action: 'rename', from, to }
 *                   | { action: 'new', commitId, name? }
 *                   ── TL-1, the trail lifecycle (all on the SAME endpoint) ──
 *                   | { action: 'archive', name }
 *                   | { action: 'restore', name }
 *                   | { action: 'discard', commitId? }   // omitted = the cursor
 *                   | { action: 'adopt', name }          // the RESPONSE body is
 *                     the session's AdoptPathResult JSON, verbatim (the only
 *                     lifecycle action whose answer the UI reads back)
 *   POST compare    → { a, b } (path names or commit ids); the RESPONSE body is
 *                     the session's CompareResult JSON, verbatim
 *   POST bringOver  → { commitId }
 *   POST undo       → { commitId }
 *
 * `/api/state`'s `paths` slice gains `archivedList` (the source's
 * `paths({includeArchived:true})` rows) so the modal can reveal the hidden ones.
 */
export interface PollEndpoints {
  readonly state: string;
  readonly dispatch: string;
  readonly seek: string;
  readonly checkpoint: string;
  readonly paths: string;
  readonly compare: string;
  readonly bringOver: string;
  readonly undo: string;
}
export interface PollSourceInput {
  readonly kind: 'poll';
  readonly endpoints?: Partial<PollEndpoints>;
  /** Injected fetch (defaults to global `fetch`) — makes the source testable. */
  readonly fetchImpl?: typeof fetch;
  /** Poll interval in ms. 0/undefined = manual refresh only. */
  readonly intervalMs?: number;
}
export type SessionViewSource = SessionSourceInput | PollSourceInput;

/** Build an in-process session source. */
export function sessionSource(session: SessionLike): SessionSourceInput {
  return { kind: 'session', session };
}
/** Build a polled-endpoint source (defaults match the demo's `/api/*`). */
export function pollingSource(input: Omit<PollSourceInput, 'kind'> = {}): PollSourceInput {
  return { kind: 'poll', ...input };
}

const DEFAULT_ENDPOINTS: PollEndpoints = {
  state: '/api/state',
  dispatch: '/api/dispatch',
  seek: '/api/seek',
  checkpoint: '/api/checkpoint',
  paths: '/api/paths',
  compare: '/api/compare',
  bringOver: '/api/bring-over',
  undo: '/api/undo',
};

// ── shared normalization ───────────────────────────────────────────────────────

interface RawCommit {
  /** The data versions this commit was true of (table → version), when the tables declare sources. */
  readonly data?: Readonly<Record<string, string>>;
  id: string;
  parent: string | null;
  viewId: string;
  kind: 'point' | 'interval' | 'cell' | 'match';
  field: string;
  value: unknown;
  /** kind:'cell' only (D30). */
  fields?: readonly [string, string];
  actor: Actor;
  intent?: string;
  correlationId?: string;
  replayedFrom?: string;
  revertOf?: string;
  conflicts?: readonly string[];
}

/** A short, safe label for a chip/dot — never a raw value dump. */
function commitLabel(field: string, viewId: string): string {
  if (viewId.startsWith('prose:')) {
    // the prose plane: a view's words — a proposal-lane commit (field `<slot>:proposal`) is a PROPOSAL, not the words
    const subject = viewId.slice('prose:'.length);
    return field.endsWith(PROPOSAL_LANE) ? `propose ${subject}.${field.slice(0, -PROPOSAL_LANE.length)}` : `describe ${subject}.${field}`;
  }
  // encoding plane: a binding SET (a swap) lands as one commit whose field is the `*` marker
  if (viewId.startsWith('encoding:') && field === '*') return `reencode ${viewId.slice('encoding:'.length)} (several channels)`;
  if (viewId.startsWith('layout:')) return 'layout'; // LY-1: an arrangement note ('preset'/'order'/'focus' rides field)
  if (viewId.startsWith('link:')) return 'link'; // layer 4: an edited edge (the LinkDecl rides value)
  if (field === '__analysis__') return 'analysis';
  if (field === 'pValue') return 'test';
  if (field === '__annotation__') return 'note';
  if (viewId.startsWith('annotation:')) return `note on ${field}`;
  if (field === '__beat__') return 'beat'; // a story beat — the checkpoint verb's commit
  if (field === '__chart__') return 'chart'; // RP-3: an agent-authored chart's spec-registration commit
  return field;
}

interface StatePieces {
  defaultTable: string;
  rawCommits: RawCommit[];
  views: ViewView[];
  encodings: Record<string, ViewEncoding>;
  columns: Record<string, readonly ColumnView[]>;
  selections: SelectionView[];
  cleared: readonly ClearedSelectionView[];
  sources?: Readonly<Record<string, SourceInfoView>>;
  dashboard?: DashboardWordsView;
  notes?: readonly NoteView[];
  filters?: Readonly<Record<string, unknown>>;
  tables?: readonly TableView[];
  journal?: readonly RefreshRecordView[];
  journalTotal?: number;
  branches: BranchView[];
  paths: PathsView;
  checkpoints: CheckpointView[];
  cursor: string | null;
  head: string | null;
  viewingPast: boolean;
  cursorTests: number;
  ledgerBase: Omit<LedgerView, 'cursorTests' | 'honesty'>;
  gaps: GapView[];
  readiness: ReadinessView[];
  charts: ChartCellView[];
  layout: LayoutView;
  mode?: string;
  readonly links?: LinkGraphView;
  /** The encoding plane's rules as sentences + policy, when the wire carries them. */
  rules?: readonly RuleLineView[];
  encodingPolicy?: SessionViewState['encodingPolicy'];
  effectiveEncodings?: Record<string, ViewEncoding>;
}

/** Turn extracted pieces into the finalized, derivation-stamped state. */
function finalize(p: StatePieces): SessionViewState {
  const active = activePath(p.rawCommits, p.head);
  const commits: CommitView[] = p.rawCommits.map((c) => ({
    ...movedSince(c.data, p.sources),
    id: c.id,
    parent: c.parent,
    viewId: c.viewId,
    kind: c.kind,
    field: c.field,
    value: c.value,
    fields: c.fields,
    actor: c.actor,
    intent: c.intent,
    correlationId: c.correlationId,
    replayedFrom: c.replayedFrom,
    revertOf: c.revertOf,
    ...(c.data !== undefined ? { data: c.data } : {}),
    conflicts: c.conflicts,
    label: commitLabel(c.field, c.viewId),
    family: familyOf({ viewId: c.viewId }),
    onBranch: active.has(c.id),
    isCursor: c.id === p.cursor,
    isHead: c.id === p.head,
  }));
  const activePathIds = pathToRoot(p.rawCommits, p.head).map((r) => r.id);
  const ledger: LedgerView = { ...p.ledgerBase, cursorTests: p.cursorTests, honesty: HONESTY_LINE };
  return {
    defaultTable: p.defaultTable,
    ...(p.links !== undefined ? { links: p.links } : {}),
    ...(p.rules !== undefined ? { rules: p.rules } : {}),
    ...(p.effectiveEncodings !== undefined ? { effectiveEncodings: p.effectiveEncodings } : {}),
    ...(p.encodingPolicy !== undefined ? { encodingPolicy: p.encodingPolicy } : {}),
    views: p.views,
    encodings: p.encodings,
    columns: p.columns,
    selections: p.selections,
    cleared: p.cleared,
    ...(p.sources !== undefined ? { sources: p.sources } : {}),
    ...(p.dashboard !== undefined ? { dashboard: p.dashboard } : {}),
    ...(p.notes !== undefined ? { notes: p.notes } : {}),
    ...(p.filters !== undefined ? { filters: p.filters } : {}),
    ...(p.tables !== undefined ? { tables: p.tables } : {}),
    ...(p.journal !== undefined ? { journal: p.journal } : {}),
    ...(p.journalTotal !== undefined ? { journalTotal: p.journalTotal } : {}),
    commits,
    saved: savedSelectionsOf(commits),
    branches: p.branches,
    paths: p.paths,
    checkpoints: p.checkpoints,
    cursor: p.cursor,
    head: p.head,
    activePathIds,
    viewingPast: p.viewingPast,
    ledger,
    gaps: p.gaps,
    readiness: p.readiness,
    charts: p.charts,
    layout: p.layout,
    mode: p.mode,
  };
}

// sub-mappers reused by BOTH sources (overview.* and /api/state carry the same
// ViewInfo / SelectionInfo / AnalysisReadiness / FdrSummary shapes).
function mapViews(views: readonly unknown[] | undefined): ViewView[] {
  return (views ?? []).map((v) => {
    const o = v as {
      viewId: string;
      actor: Actor;
      label?: string;
      /** UI-0 (fe6e5b5): the point/interval capability sense. */
      selectionKinds?: readonly ('point' | 'interval')[];
      /** UI-0: the channel→field visual-encoding fold. */
      encodings?: Readonly<Record<string, string>>;
      /** UI-0: branch-scoped columns available to encode onto. */
      columns?: readonly { field: string; type: string; role?: string }[];
      /** The encoding plane's verdicts per channel (`views[].fits` serialized). */
      fits?: unknown;
      /** Encoding links: `views[].effective` serialized. */
      effective?: unknown;
      /** The prose plane: `views[].prose` serialized. */
      prose?: unknown;
      /** The prose plane: `views[].proposals` serialized. */
      proposals?: unknown;
      canProbe?: boolean;
      mounted?: boolean;
    };
    return {
      viewId: o.viewId,
      actor: o.actor,
      label: o.label,
      selectionKinds: o.selectionKinds ?? [],
      canProbe: o.canProbe ?? true,
      mounted: o.mounted ?? true,
      encoding: o.encodings ?? {},
      columns: (o.columns ?? []).map((c) => ({ field: c.field, type: String(c.type), ...(c.role !== undefined ? { role: String(c.role) } : {}) })),
      ...(o.fits !== undefined ? { fits: mapFits(o.fits) } : {}),
      ...(o.effective !== undefined ? { effective: mapEffective(o.effective) } : {}),
      ...(o.prose !== undefined ? { prose: mapProse(o.prose) } : {}),
      ...(o.proposals !== undefined ? { proposals: mapProposals(o.proposals) } : {}),
    };
  });
}
/** Per channel, the column verdicts src/encoding serves — anything malformed is dropped, never invented. */
function mapFits(raw: unknown): Readonly<Record<string, readonly FitView[]>> {
  const out: Record<string, readonly FitView[]> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [channel, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[channel] = list.flatMap((f) => {
      if (typeof f !== 'object' || f === null) return [];
      const x = f as { field?: unknown; ok?: unknown; because?: unknown };
      if (typeof x.field !== 'string' || typeof x.ok !== 'boolean') return [];
      return [{ field: x.field, ok: x.ok, ...(typeof x.because === 'string' ? { because: x.because } : {}) }];
    });
  }
  return out;
}
/** A view's effective encoding (encoding links), when the wire carries one with the session's shape. */
function mapEffective(raw: unknown): EffectiveEncodingView | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const x = raw as { bindings?: unknown; followed?: unknown; refused?: unknown };
  const strings = (v: unknown): Record<string, string> =>
    typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, f]) => typeof f === 'string')) as Record<string, string> : {};
  const followed: Record<string, { edge: string; from: string; sourceChannel: string }> = {};
  for (const [ch, f] of Object.entries((typeof x.followed === 'object' && x.followed !== null ? x.followed : {}) as Record<string, unknown>)) {
    const y = f as { edge?: unknown; from?: unknown; sourceChannel?: unknown };
    if (typeof y?.edge === 'string' && typeof y.from === 'string' && typeof y.sourceChannel === 'string') followed[ch] = { edge: y.edge, from: y.from, sourceChannel: y.sourceChannel };
  }
  const refused: Record<string, { edge: string; field: string; sentence: string }> = {};
  for (const [ch, f] of Object.entries((typeof x.refused === 'object' && x.refused !== null ? x.refused : {}) as Record<string, unknown>)) {
    const y = f as { edge?: unknown; field?: unknown; sentence?: unknown };
    if (typeof y?.edge === 'string' && typeof y.field === 'string' && typeof y.sentence === 'string') refused[ch] = { edge: y.edge, field: y.field, sentence: y.sentence };
  }
  return { bindings: strings(x.bindings), followed, refused };
}
/** The prose slots the wire serves — a slot with the shape src/prose serves; anything malformed is dropped, never invented. */
function mapProse(raw: unknown): readonly ProseStatusView[] {
  if (!Array.isArray(raw)) return [];
  const SLOTS = ['title', 'caption', 'altShort', 'altLong', 'howToRead'];
  const STATUS = ['current', 'stale', 'derived'];
  const KINDS = ['human', 'agent', 'derived', 'humanEdited'];
  return raw.flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const x = p as { slot?: unknown; text?: unknown; status?: unknown; changed?: unknown; refs?: unknown; record?: { author?: { kind?: unknown; by?: unknown; model?: unknown; at?: unknown }; levels?: unknown; basis?: unknown } };
    const kind = x.record?.author?.kind;
    if (typeof x.slot !== 'string' || !SLOTS.includes(x.slot) || typeof x.status !== 'string' || !STATUS.includes(x.status) || typeof kind !== 'string' || !KINDS.includes(kind)) return [];
    const a = x.record!.author!;
    return [
      {
        slot: x.slot as ProseStatusView['slot'],
        text: typeof x.text === 'string' ? x.text : '',
        status: x.status as ProseStatusView['status'],
        changed: Array.isArray(x.changed) ? x.changed.filter((c): c is string => typeof c === 'string') : [],
        author: { kind: kind as ProseStatusView['author']['kind'], ...(typeof a.by === 'string' ? { by: a.by } : {}), ...(typeof a.model === 'string' ? { model: a.model } : {}), ...(typeof a.at === 'string' ? { at: a.at } : {}) },
        levels: Array.isArray(x.record!.levels) ? x.record!.levels.filter((l): l is string => typeof l === 'string') : [],
        ...(typeof x.record!.basis === 'object' && x.record!.basis !== null && !Array.isArray(x.record!.basis) ? { basis: x.record!.basis as Record<string, unknown> } : {}),
        ...(mapRefs(x.refs).length > 0 ? { refs: mapRefs(x.refs) } : {}),
      },
    ];
  });
}
/** The proposals on the table, as the wire serves them; anything malformed is dropped. */
/** Every declared table off the wire — a named table always counts; a source that cannot be read is `unstated`, never invented. */
function mapTables(raw: unknown): readonly TableView[] {
  if (!Array.isArray(raw)) return [];
  const out: TableView[] = [];
  for (const t of raw) {
    const o = t as Partial<TableView>;
    if (typeof o.name !== 'string' || typeof o.engine !== 'string' || typeof o.declaredColumns !== 'number') continue;
    const src = (typeof o.source === 'object' && o.source !== null ? o.source : {}) as { format?: unknown; via?: unknown; at?: unknown; inline?: unknown; rows?: unknown };
    const source: TableView['source'] =
      typeof src.format === 'string' && typeof src.via === 'string'
        ? { format: src.format, via: src.via, ...(typeof src.at === 'string' ? { at: src.at } : {}) }
        : src.inline === 'rows' || src.inline === 'csv'
          ? { inline: src.inline, ...(typeof src.rows === 'number' ? { rows: src.rows } : {}) }
          : { unstated: true };
    const g = (typeof o.grain === 'object' && o.grain !== null ? o.grain : null) as { bucket?: unknown; reducer?: unknown; collapsedFrom?: unknown; note?: unknown } | null;
    const grain = g === null ? undefined : { ...(typeof g.bucket === 'string' ? { bucket: g.bucket } : {}), ...(typeof g.reducer === 'string' ? { reducer: g.reducer } : {}), ...(typeof g.collapsedFrom === 'number' ? { collapsedFrom: g.collapsedFrom } : {}), ...(typeof g.note === 'string' ? { note: g.note } : {}) };
    out.push({
      name: o.name,
      source,
      engine: o.engine,
      ...(typeof o.key === 'string' ? { key: o.key } : {}),
      ...(grain !== undefined ? { grain } : {}),
      ...(typeof o.absence === 'object' && o.absence !== null && typeof o.absence.field === 'string' && Array.isArray(o.absence.states) ? { absence: { field: o.absence.field, states: o.absence.states.map(String) } } : {}),
      declaredColumns: o.declaredColumns,
    });
  }
  return out;
}

/** One refresh outcome off the wire, validated against its three arms — anything else is kept as `unreadable`, never rendered into a crash and never dropped. */
function mapOutcome(raw: unknown): RefreshOutcomeView {
  if (typeof raw !== 'object' || raw === null) return { unreadable: true };
  const o = raw as Record<string, unknown>;
  if (o.unchanged === true && typeof o.version === 'string') return { unchanged: true, version: o.version };
  if (o.refused === true && typeof o.reason === 'string' && typeof o.message === 'string') return { refused: true, reason: o.reason, message: o.message };
  if (o.changed === true && typeof o.from === 'string' && typeof o.to === 'string' && typeof o.retrievedAt === 'string' && typeof o.rows === 'number' && typeof o.delta === 'object' && o.delta !== null) {
    const d = o.delta as Record<string, unknown>;
    const delta: RefreshDeltaView | null =
      d.keyed === true && typeof d.key === 'string' && typeof d.added === 'number' && typeof d.updated === 'number' && typeof d.removed === 'number' && typeof d.unkeyed === 'number'
        ? { keyed: true, key: d.key, added: d.added, updated: d.updated, removed: d.removed, unkeyed: d.unkeyed }
        : d.keyed === false && typeof d.replaced === 'number'
          ? { keyed: false, replaced: d.replaced, ...(typeof d.keyAbsent === 'string' ? { keyAbsent: d.keyAbsent } : {}) }
          : null;
    if (delta === null) return { unreadable: true };
    const lost = Array.isArray(o.materialisedLost) ? o.materialisedLost.map(String) : undefined;
    return { changed: true, from: o.from, to: o.to, retrievedAt: o.retrievedAt, rows: o.rows, delta, ...(lost !== undefined ? { materialisedLost: lost } : {}) };
  }
  return { unreadable: true };
}

/** The data journal off the wire — a record without a time or a tables map is dropped, and so is any outcome that is not one of the three arms. */
function mapJournal(raw: unknown): readonly RefreshRecordView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const o = r as Partial<RefreshRecordView>;
    if (typeof o.at !== 'string' || typeof o.tables !== 'object' || o.tables === null) return [];
    const tables: Record<string, RefreshOutcomeView> = {};
    for (const [table, outcome] of Object.entries(o.tables)) tables[table] = mapOutcome(outcome);
    return [{ at: o.at, asked: Array.isArray(o.asked) ? o.asked.map(String) : Object.keys(tables), tables }];
  });
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The notes off the wire — an entry without a string id is dropped; each note's words go through the same mappers a view's do. */
function mapNotes(raw: unknown): readonly NoteView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((n) => {
    const o = n as { id?: unknown; prose?: unknown; proposals?: unknown };
    if (typeof o.id !== 'string' || o.id.length === 0) return [];
    return [{ id: o.id, prose: mapProse(o.prose), proposals: mapProposals(o.proposals) }];
  });
}

/** The dashboard's own words: the same two lists a view carries, mapped by the same two mappers; a malformed wire yields empty lists, never invented words. */
function mapDashboard(raw: unknown): DashboardWordsView {
  const o = typeof raw === 'object' && raw !== null ? (raw as { prose?: unknown; proposals?: unknown }) : {};
  return { prose: mapProse(o.prose), proposals: mapProposals(o.proposals) };
}

function mapProposals(raw: unknown): ProposalView[] {
  if (!Array.isArray(raw)) return [];
  const SLOTS = ['title', 'caption', 'altShort', 'altLong', 'howToRead'];
  const STATUS = ['open', 'accepted', 'declined'];
  const KINDS = ['human', 'agent', 'derived', 'humanEdited'];
  return raw.flatMap((p) => {
    const x = p as { slot?: unknown; proposal?: unknown; status?: unknown; by?: unknown; reason?: unknown; record?: { text?: unknown; author?: { kind?: unknown; by?: unknown; model?: unknown; at?: unknown }; levels?: unknown; basis?: unknown } } | null;
    const kind = x?.record?.author?.kind;
    if (typeof x !== 'object' || x === null || typeof x.slot !== 'string' || !SLOTS.includes(x.slot) || typeof x.proposal !== 'string' || typeof x.status !== 'string' || !STATUS.includes(x.status) || typeof kind !== 'string' || !KINDS.includes(kind)) return [];
    const a = x.record!.author!;
    return [
      {
        slot: x.slot as ProposalView['slot'],
        proposal: x.proposal,
        text: typeof x.record!.text === 'string' ? x.record!.text : '',
        status: x.status as ProposalView['status'],
        author: { kind: kind as ProposalView['author']['kind'], ...(typeof a.by === 'string' ? { by: a.by } : {}), ...(typeof a.model === 'string' ? { model: a.model } : {}), ...(typeof a.at === 'string' ? { at: a.at } : {}) },
        levels: Array.isArray(x.record!.levels) ? x.record!.levels.filter((l): l is string => typeof l === 'string') : [],
        ...(typeof x.record!.basis === 'object' && x.record!.basis !== null && !Array.isArray(x.record!.basis) ? { basis: x.record!.basis as Record<string, unknown> } : {}),
        ...(typeof x.by === 'string' ? { by: x.by } : {}),
        ...(typeof x.reason === 'string' ? { reason: x.reason } : {}),
      },
    ];
  });
}
/** A slot's refs — a span plus exactly one target; anything else is dropped, never invented. */
function mapRefs(raw: unknown): ProseRefView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const x = r as { span?: unknown; commit?: unknown; beat?: unknown; saved?: unknown; label?: unknown } | null;
    if (typeof x !== 'object' || x === null || !Array.isArray(x.span) || x.span.length !== 2 || !x.span.every((n) => typeof n === 'number')) return [];
    const commit = typeof x.commit === 'string' ? x.commit : undefined;
    const beat = typeof x.beat === 'string' ? x.beat : undefined;
    const saved = typeof x.saved === 'string' ? x.saved : undefined; // a saved selection by its id: a click applies its logic, never seeks
    if (Number(commit !== undefined) + Number(beat !== undefined) + Number(saved !== undefined) !== 1) return [];
    return [{ span: [x.span[0] as number, x.span[1] as number] as const, ...(commit !== undefined ? { commit } : {}), ...(beat !== undefined ? { beat } : {}), ...(saved !== undefined ? { saved } : {}), ...(typeof x.label === 'string' ? { label: x.label } : {}) }];
  });
}
/** The rules as sentences, when the wire carries them. */
function mapRules(raw: unknown): readonly RuleLineView[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((r) => {
    const x = r as { id?: unknown; builtIn?: unknown; sentence?: unknown } | null;
    return typeof x?.id === 'string' && typeof x.sentence === 'string' ? [{ id: x.id, builtIn: x.builtIn === true, sentence: x.sentence }] : [];
  });
}
/** viewId → channel → field, when the wire carries the map; malformed entries dropped. */
function mapEncodingMap(raw: unknown): Record<string, ViewEncoding> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, ViewEncoding> = {};
  for (const [viewId, enc] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof enc !== 'object' || enc === null) continue;
    out[viewId] = Object.fromEntries(Object.entries(enc as Record<string, unknown>).filter(([, f]) => typeof f === 'string')) as ViewEncoding;
  }
  return out;
}
function mapPolicy(raw: unknown): SessionViewState['encodingPolicy'] {
  const x = raw as { onInvalid?: unknown; ruleScope?: unknown } | null;
  if (typeof x?.onInvalid !== 'string' || (x.ruleScope !== 'view' && x.ruleScope !== 'dashboard')) return undefined;
  return { onInvalid: x.onInvalid, ruleScope: x.ruleScope };
}
/** The link graph, when the wire carries one with the shape src/links serves; anything else = absent (the old rule). */
function mapLinks(raw: unknown): LinkGraphView | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const g = raw as { default?: unknown; views?: unknown; edges?: unknown };
  if ((g.default !== 'crossfilter' && g.default !== 'none') || !Array.isArray(g.views) || !Array.isArray(g.edges)) return undefined;
  return { default: g.default, views: g.views as LinkGraphView['views'], edges: g.edges as LinkGraphView['edges'] };
}

/** A commit true of a data version the table has since left is marked, so a number it shows is not mistaken for reproducible. */
function movedSince(data: Readonly<Record<string, string>> | undefined, sources: Readonly<Record<string, SourceInfoView>> | undefined): Pick<CommitView, 'dataMoved' | 'moved'> {
  if (data === undefined || sources === undefined) return {};
  const moved = Object.entries(data).flatMap(([table, from]) => (sources[table] !== undefined && sources[table].version !== from ? [{ table, from, to: sources[table].version }] : []));
  return { dataMoved: moved.length > 0, ...(moved.length > 0 ? { moved } : {}) };
}

/** The stamp as a spread: `{ data }` when the wire carries a well-formed one, else nothing. */
function stampOf(raw: unknown): { readonly data?: Readonly<Record<string, string>> } {
  const stamp = mapStamp(raw);
  return stamp === undefined ? {} : { data: stamp };
}

/** The stamp as the wire carries it: a table → version map of strings, or nothing. */
function mapStamp(raw: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string');
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Provenance rows as the wire carries them; a malformed row is dropped rather than shown as a fact. */
function mapSources(raw: unknown): Readonly<Record<string, SourceInfoView>> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, SourceInfoView> = {};
  for (const [table, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as Partial<SourceInfoView>;
    if (typeof o.format !== 'string' || typeof o.via !== 'string' || typeof o.version !== 'string' || typeof o.retrievedAt !== 'string' || typeof o.rows !== 'number') continue;
    out[table] = { format: o.format, via: o.via, ...(typeof o.at === 'string' ? { at: o.at } : {}), version: o.version, retrievedAt: o.retrievedAt, rows: o.rows };
  }
  return out;
}
function mapCleared(sels: readonly unknown[] | undefined): ClearedSelectionView[] {
  return (sels ?? []).flatMap((s) => {
    const o = s as ClearedSelectionView;
    return typeof o.clearedBy === 'string' ? [{ ...mapSelections([o])[0]!, clearedBy: o.clearedBy }] : [];
  });
}
function mapSelections(sels: readonly unknown[] | undefined): SelectionView[] {
  return (sels ?? []).map((s) => {
    const o = s as SelectionView;
    // D30: a cell selection carries its field pair through (both sources
    // serialize the same SelectionInfo shape).
    return { viewId: o.viewId, field: o.field, kind: o.kind, value: o.value, ...(o.fields !== undefined ? { fields: o.fields } : {}), ...(typeof o.commitId === 'string' ? { commitId: o.commitId } : {}) };
  });
}

/**
 * The saved selections in a log: every annotation whose `field` names a
 * selection commit with a live-shaped value. Newest note first; one entry per
 * selection commit (the latest note wins its name).
 */
export function savedSelectionsOf(commits: readonly CommitView[]): SavedSelectionView[] {
  const byId = new Map(commits.map((c) => [c.id, c] as const));
  const out: SavedSelectionView[] = [];
  const named = new Set<string>();
  for (let i = commits.length - 1; i >= 0; i--) {
    const note = commits[i]!;
    if (!note.viewId.startsWith('annotation:') || typeof note.value !== 'string' || note.value.length === 0) continue;
    const target = byId.get(note.field);
    if (target === undefined || named.has(target.id)) continue;
    if ((target.family !== undefined && target.family !== 'interaction') || target.value === undefined || target.value === null) continue; // not a live selection
    named.add(target.id);
    out.push({ name: note.value, commitId: target.id, noteId: note.id, viewId: target.viewId, kind: target.kind, field: target.field, value: target.value, ...(target.fields !== undefined ? { fields: target.fields } : {}), actor: target.actor });
  }
  return out;
}
function mapReadiness(analyses: readonly unknown[] | undefined): ReadinessView[] {
  return (analyses ?? []).map((a) => {
    const o = a as ReadinessView & { missingColumns?: readonly string[] };
    return {
      id: o.id,
      kind: o.kind,
      produces: o.produces,
      ready: o.ready,
      blockedBy: o.blockedBy,
      missingColumns: o.missingColumns,
      selectedRows: o.selectedRows,
      minPoints: o.minPoints,
    };
  });
}
function mapLedgerBase(fdr: unknown): Omit<LedgerView, 'cursorTests' | 'honesty'> {
  const f = (fdr ?? {}) as { procedure?: string; alpha?: number; tests?: number; discoveries?: number; wealth?: number; ledger?: readonly { step: number; hypothesisId: string; pValue: number; alphaThreshold: number; reject: boolean; wealthAfter: number }[] };
  return {
    procedure: f.procedure ?? 'LORD++',
    alpha: f.alpha ?? 0.05,
    tests: f.tests ?? 0,
    discoveries: f.discoveries ?? 0,
    wealth: f.wealth ?? 0,
    steps: (f.ledger ?? []).map((s) => ({ step: s.step, hypothesisId: s.hypothesisId, pValue: s.pValue, alphaThreshold: s.alphaThreshold, reject: s.reject, wealthAfter: s.wealthAfter })),
  };
}
function mapColumns(
  columns: Readonly<Record<string, readonly { field: string; type: string; role?: string; absence?: readonly string[] }[]>> | undefined,
): Record<string, readonly ColumnView[]> {
  const out: Record<string, readonly ColumnView[]> = {};
  for (const [table, cols] of Object.entries(columns ?? {})) {
    // The role and the absence declaration ride through untouched: the app must never re-spell either.
    out[table] = cols.map((c) => ({ field: c.field, type: String(c.type), ...(c.role !== undefined ? { role: String(c.role) } : {}), ...(c.absence !== undefined ? { absence: c.absence } : {}) }));
  }
  return out;
}
/**
 * Normalize the named-paths slice — `overview().paths` live, or the identical
 * `/api/state` JSON. Defensive: a source that predates BR-1 simply has no
 * paths, and the UI renders the honest empty surface instead of crashing.
 */
function mapPath(p: RawPath): PathView {
  return {
    name: p.name,
    tip: p.tip,
    steps: p.steps,
    lastTs: p.lastTs,
    active: p.active,
    ...(p.archived === true ? { archived: true as const } : {}),
  };
}

function mapPaths(raw: RawPollPaths | undefined): PathsView {
  if (!raw) return emptyPaths();
  return {
    current: raw.current ?? null,
    detachedAt: raw.detachedAt ?? null,
    list: (raw.list ?? []).map(mapPath),
    archivedList: archivedRows(raw.archivedList),
    events: [...(raw.events ?? [])],
  };
}

/**
 * TL-1 — keep ONLY the rows a source flagged `archived`. Both sources hand over
 * a FULL listing (visible rows included), so this filter is what makes hidden
 * actually hidden by default.
 */
function archivedRows(rows: readonly RawPath[] | undefined): PathView[] {
  return (rows ?? []).filter((p) => p.archived === true).map(mapPath);
}

/** Attach the archived rows to an already-mapped paths surface (the session source). */
function withArchived(paths: PathsView, rows: readonly RawPath[]): PathsView {
  return { ...paths, archivedList: archivedRows(rows) };
}

function mapGaps(gaps: readonly unknown[] | undefined): GapView[] {
  return (gaps ?? []).map((g) => {
    const o = g as GapView;
    return { code: o.code, op: o.op, detail: o.detail, target: o.target };
  });
}

/**
 * LY-1: the ONE dashboard-level layout identity, v1. The literal is pinned to
 * `src/branches/fold.LAYOUT_VIEW_PREFIX + 'dashboard'` (a parity test imports
 * both) — the adapter states it locally so a POLL consumer never needs a src
 * value import, matching the HONESTY_LINE precedent.
 */
export const LAYOUT_DASHBOARD_VIEW_ID = 'layout:dashboard';

/** Normalize agent-authored charts (RP-3). A pre-RP-3 source has none — render the empty case. */
function mapCharts(charts: readonly RawChart[] | undefined): ChartCellView[] {
  return (charts ?? []).map((c) => ({
    chartId: c.chartId,
    viewId: c.viewId,
    spec: c.spec,
    claim: c.claim,
    authoredBy: c.authoredBy,
    ledgerStep: c.ledgerStep,
  }));
}

/**
 * TL-1 — turn an `adoptPath` answer into the numbers a person reads: how many
 * steps landed, how many were honestly skipped (and why), how many collided.
 * A refusal keeps its reason (the session's gap detail, or a transport error) —
 * the UI must never show "adopted" when nothing happened.
 */
export function summarizeAdopt(name: string, raw: RawAdoptResult): AdoptSummaryView {
  if (raw.ok !== true) {
    return {
      ok: false,
      path: name,
      applied: 0,
      skipped: 0,
      conflicts: 0,
      skippedReasons: [],
      reason: raw.gap?.detail ?? raw.error ?? 'the adopt was refused',
    };
  }
  const steps = raw.steps ?? [];
  return {
    ok: true,
    path: raw.path ?? name,
    applied: raw.applied ?? 0,
    skipped: raw.skipped ?? 0,
    conflicts: (raw.conflicts ?? []).length,
    skippedReasons: steps.filter((s) => !s.applied).map((s) => s.skippedReason ?? 'skipped'),
  };
}

/** viewId → channel→field, derived from the views when no top-level record rides. */
function encodingsFromViews(views: readonly ViewView[]): Record<string, ViewEncoding> {
  const out: Record<string, ViewEncoding> = {};
  for (const v of views) if (Object.keys(v.encoding).length > 0) out[v.viewId] = v.encoding;
  return out;
}

/** Map a live session's async projection into `SessionViewState`. */
async function mapSession(session: SessionLike, defaultLayout?: LayoutPreset): Promise<SessionViewState> {
  const overview: Overview = await Promise.resolve(session.overview());
  const rawCommits: RawCommit[] = session.log.records.map((r) => ({
    id: r.id,
    parent: r.parent,
    viewId: r.viewId,
    kind: r.kind,
    field: r.field,
    value: r.value,
    fields: r.fields,
    actor: (r.cause?.requestedBy ?? 'system') as Actor,
    intent: r.cause?.intent,
    correlationId: r.correlationId,
    replayedFrom: r.cause?.replayedFrom,
    revertOf: r.cause?.revertOf,
    ...stampOf(r.data),
    conflicts: r.cause?.conflicts,
  }));
  const views = mapViews(overview.views);
  return finalize({
    defaultTable: overview.defaultTable,
    rawCommits,
    views,
    ...(overview.dashboard !== undefined ? { dashboard: mapDashboard(overview.dashboard) } : {}),
    ...(overview.notes !== undefined ? { notes: mapNotes(overview.notes) } : {}),
    ...(isRecord(overview.filters) ? { filters: overview.filters } : {}),
    ...(overview.tables !== undefined ? { tables: mapTables(overview.tables) } : {}),
    ...(overview.journal !== undefined ? { journal: mapJournal(overview.journal) } : {}),
    ...(typeof overview.journalTotal === 'number' ? { journalTotal: overview.journalTotal } : {}),
    encodings: overview.encodings ?? encodingsFromViews(views),
    columns: mapColumns(overview.columns),
    selections: mapSelections(overview.activeSelections),
    cleared: mapCleared(overview.clearedSelections),
    sources: mapSources(overview.sources),
    links: mapLinks((overview as { links?: unknown }).links),
    rules: mapRules((overview as { rules?: unknown }).rules),
    effectiveEncodings: mapEncodingMap((overview as { effectiveEncodings?: unknown }).effectiveEncodings),
    encodingPolicy: mapPolicy((overview as { encodingPolicy?: unknown }).encodingPolicy),
    branches: session.branches().map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
    // TL-1: the overview's `paths` carries the VISIBLE rows; the archived ones
    // come from the session's own full listing (whats_here only reports their
    // COUNT, deliberately — a hidden path is hidden until asked for).
    paths: withArchived(mapPaths(overview.paths), session.paths({ includeArchived: true })),
    checkpoints: session.checkpoints().map((c) => ({ id: c.id, label: c.label, commitId: c.commitId, at: c.at, ts: c.ts })),
    cursor: overview.time.cursor,
    head: overview.time.head,
    viewingPast: overview.time.viewingPast,
    cursorTests: overview.time.cursorTests,
    ledgerBase: mapLedgerBase(overview.fdr),
    gaps: mapGaps(session.gaps()),
    readiness: mapReadiness(overview.analyses),
    charts: mapCharts(session.charts?.()),
    // LY-1: a pre-layout session (no `layouts` on its overview yet — duck-typed
    // sources) parses to the default flow arrangement, hence the `?.`.
    layout: parseLayout(overview.layouts?.['dashboard'], defaultLayout),
  });
}

/** Map a raw `/api/state` payload into `SessionViewState`. */
export function mapPollState(raw: RawPollState, defaultLayout?: LayoutPreset): SessionViewState {
  const rawCommits: RawCommit[] = raw.records.map((r) => ({
    id: r.id,
    parent: r.parent,
    viewId: r.viewId,
    kind: r.kind,
    field: r.field,
    value: r.value,
    fields: r.fields,
    actor: (r.cause?.requestedBy ?? 'system') as Actor,
    intent: r.cause?.intent,
    correlationId: r.correlationId,
    replayedFrom: r.cause?.replayedFrom,
    revertOf: r.cause?.revertOf,
    ...stampOf(r.data),
    conflicts: r.cause?.conflicts,
  }));
  const views = mapViews(raw.views);
  return finalize({
    defaultTable: raw.defaultTable ?? 'data',
    rawCommits,
    views,
    ...(raw.dashboard !== undefined ? { dashboard: mapDashboard(raw.dashboard) } : {}),
    ...(raw.notes !== undefined ? { notes: mapNotes(raw.notes) } : {}),
    ...(isRecord(raw.filters) ? { filters: raw.filters } : {}),
    ...(raw.tables !== undefined ? { tables: mapTables(raw.tables) } : {}),
    ...(raw.journal !== undefined ? { journal: mapJournal(raw.journal) } : {}),
    ...(typeof raw.journalTotal === 'number' ? { journalTotal: raw.journalTotal } : {}),
    encodings: raw.encodings ?? encodingsFromViews(views),
    columns: mapColumns(raw.columns),
    selections: mapSelections(raw.activeSelections),
    cleared: mapCleared(raw.clearedSelections),
    sources: mapSources(raw.sources),
    links: mapLinks(raw.links),
    rules: mapRules(raw.rules),
    effectiveEncodings: mapEncodingMap(raw.effectiveEncodings),
    encodingPolicy: mapPolicy(raw.encodingPolicy),
    branches: (raw.branches ?? []).map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
    paths: mapPaths(raw.paths),
    checkpoints: (raw.checkpoints ?? []).map((c) => ({ ...(c.id !== undefined ? { id: c.id } : {}), label: c.label, commitId: c.commitId, ...(c.at !== undefined ? { at: c.at } : {}), ts: c.ts })),
    cursor: raw.cursor ?? null,
    head: raw.head ?? null,
    viewingPast: raw.viewingPast ?? false,
    cursorTests: raw.cursorTests ?? 0,
    ledgerBase: mapLedgerBase(raw.fdr),
    gaps: mapGaps(raw.gaps),
    readiness: mapReadiness(raw.analyses),
    charts: mapCharts(raw.charts),
    layout: parseLayout(raw.layouts?.['dashboard'], defaultLayout),
    mode: raw.mode,
  });
}

// ── the store ───────────────────────────────────────────────────────────────────

export interface SessionViewOptions {
  /** The acting principal for UI-initiated commits. Default `'user'`. */
  readonly as?: Actor;
  /** Refresh the snapshot after each action (default true). */
  readonly refreshOnAction?: boolean;
  /** The arrangement before any layout commit lands (a host's choice; default `'flow'`). A landed layout always wins. */
  readonly defaultLayout?: LayoutPreset;
}

/** One edge as the matrix hands it to the host (layer 4). */
export interface LinkEdit {
  readonly source: string;
  /** An emission kind, or `encoding` (the target follows the source's bindings). */
  readonly kind: LinkEdgeView['kind'];
  readonly target: string;
  /** null = back to the def's rule. */
  readonly response: LinkEdgeView['response'] | null;
  readonly mapping?: readonly { readonly from: string; readonly to: string }[];
  /** Encoding edges: which channels follow (absent = every channel both views share, written out on the edge). */
  readonly channels?: readonly { readonly from: string; readonly to: string }[];
  /** What the target does when the source clears (selection edges): leave | showAll | excludeAll. */
  readonly onClear?: 'leave' | 'showAll' | 'excludeAll';
  /** How the emission folds down to the target's rows — required when the edge crosses grains. */
  readonly fold?: string;
}

/** What a gesture came back with: landed, or refused with the session's sentence. */
export type DescribeOutcome = { readonly ok: true } | { readonly ok: false; readonly sentence: string };

export interface SessionView {
  getState(): SessionViewState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Turn a chart's R3 emission into a filter/select commit (charts never build clauses). */
  emit(viewId: string, emission: ChartEmission, intent?: string): Promise<void>;
  /**
   * SET-1: clear one view's live selection KIND-FAITHFULLY — a cleared point /
   * interval / cell / match commit of that view, a real act with a cause,
   * never a silent reset. No-op when the view holds no live clause.
   */
  clear(viewId: string, intent?: string): Promise<void>;
  /** Clear every live selection, one commit each — the log stays honest about what was cleared. */
  clearAll(intent?: string): Promise<void>;
  /**
   * Layer 4: edit ONE edge of the link graph as a commit — what `target` does
   * with `source`'s `kind` emission; `response: null` un-declares the edit so
   * the def's rule shows through. The matrix editor's one door.
   */
  link(edge: LinkEdit, intent?: string): Promise<void>;
  /**
   * SET-1: flip a view's live point/match between KEEP and EXCLUDE (a point
   * becomes a one-value set). An interval or a cell has no polarity — no-op.
   */
  setPolarity(viewId: string, exclude: boolean, intent?: string): Promise<void>;
  /** UI-0: rebind a view's visual channel to a field. */
  reencode(viewId: string, channel: string, field: string): Promise<void>;
  /** Encoding plane: rebind SEVERAL channels in one act — a swap is `{ x: <the y field>, y: <the x field> }` and lands as ONE commit. */
  reencodeSet(viewId: string, bindings: Readonly<Record<string, string>>, intent?: string): Promise<void>;
  /** The prose plane: set one of a view's words as a record (the person as author unless the record says otherwise); null = back to the def's own words. */
  /** Land a prose record (null = back to the declaration). The answer says whether it landed — a refusal carries the session's sentence, so the words are never lost to a silent no. */
  describe(viewId: string, slot: ProseStatusView['slot'], record: Readonly<Record<string, unknown>> | null, intent?: string): Promise<DescribeOutcome>;
  /** The prose plane: PROPOSE words for a slot — they land in its proposal lane for a person to accept, never as the live words. */
  propose(viewId: string, slot: ProseStatusView['slot'], record: Readonly<Record<string, unknown>>, intent?: string): Promise<void>;
  /** Accept the open proposal (by its commit id): its words land on the slot, marked as accepted from it. */
  acceptProposal(viewId: string, slot: ProseStatusView['slot'], proposal: string, intent?: string): Promise<void>;
  /** Decline the open proposal with a reason that stays on the record. */
  declineProposal(viewId: string, slot: ProseStatusView['slot'], proposal: string, reason: string, intent?: string): Promise<void>;
  /**
   * RP-1: record a pan/zoom view state through the `navigate` dispatch verb.
   * Deliberately NON-filtering — a viewport is not a data claim; the view
   * state rides the cause's intent as INERT data. A navigate against an
   * undeclared view files a typed `needs-view` gap at the session tier.
   */
  navigate(viewId: string, viewState?: NavigateViewState): Promise<void>;
  /**
   * LY-1: set the cockpit arrangement — preset (Flow / Grid / Focus), cell
   * order, or the focused chart. Wraps the SAME `navigate` dispatch verb under
   * the `layout:dashboard` identity (recorded, deliberately non-filtering; the
   * session fold carries it, so time-travel and path switches restore it).
   * Each provided prop lands ONE commit with a plain-words intent
   * ("layout = focus on scatter"). Works over both sources.
   */
  setLayout(change: LayoutChange): Promise<void>;
  analyze(analysisId: string, intent?: string): Promise<void>;
  seek(commitId: string): Promise<void>;
  stepBack(): Promise<void>;
  stepForward(): Promise<void>;
  checkpoint(label: string): Promise<void>;
  /** Save a view's LIVE selection under a name — a note on its commit; it then rides `state.saved` and applies with `bringOver`. */
  saveSelection(viewId: string, name: string): Promise<void>;
  returnToNow(): Promise<void>;
  // ── named paths (BR-2 over BR-1) — state rides `state.paths` ──
  /** Switch to a named path: jump to its tip and make it the active line of work. */
  switchPath(name: string): Promise<void>;
  /** Rename a path (a rejected rename files a typed gap; the next refresh shows it). */
  renamePath(from: string, to: string): Promise<void>;
  /** Start a NEW named path at a commit (auto-named from that step when `name` is omitted). */
  newPathAt(commitId: string, name?: string): Promise<void>;
  /** Compare two positions (path names or commit ids) — a plain-language diff, read-only. */
  compare(aRef: string, bRef: string): Promise<CompareView>;
  /** Bring one step from another path over to where you are (lands a `replayedFrom` commit). */
  bringOver(commitId: string): Promise<void>;
  /** Undo one step: restore the value from just before it (lands a `revertOf` commit). */
  undo(commitId: string): Promise<void>;
  // ── the trail lifecycle (TL-1) — hidden, not erased ──
  /** Hide a dead-end path. Its steps stay in the log and the statistics still count them. */
  archivePath(name: string): Promise<void>;
  /** Un-hide an archived path, exactly as it was. */
  restorePath(name: string): Promise<void>;
  /**
   * Drop everything after a step on your own path. The abandoned part is KEPT as
   * an archived path (findable, restorable); `commitId` omitted means "from the
   * cursor". A refusal lands as a typed gap in the next snapshot.
   */
  discardFromHere(commitId?: string): Promise<void>;
  /** Replay another path's steps onto yours, one ordinary commit each. Answers with a summary to show. */
  adoptPath(name: string): Promise<AdoptSummaryView>;
  dispose(): void;
}

export function createSessionView(source: SessionViewSource, options: SessionViewOptions = {}): SessionView {
  const as: Actor = options.as ?? 'user';
  const refreshOnAction = options.refreshOnAction ?? true;
  const endpoints: PollEndpoints = source.kind === 'poll' ? { ...DEFAULT_ENDPOINTS, ...source.endpoints } : DEFAULT_ENDPOINTS;
  const doFetch: typeof fetch = source.kind === 'poll' && source.fetchImpl ? source.fetchImpl : (globalThis.fetch as typeof fetch);

  let state = emptyState();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const notify = (): void => {
    for (const l of listeners) l();
  };
  const setState = (next: SessionViewState): void => {
    state = next;
    notify();
  };

  const cause = (intent?: string): { requestedBy: Actor; computedBy: Actor; intent?: string } => ({ requestedBy: as, computedBy: as, intent });

  async function postJson(url: string, body: unknown): Promise<void> {
    try {
      await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      /* swallow — a stale/failed action just no-ops; the next refresh reconciles */
    }
  }

  /**
   * POST and READ THE ANSWER BACK — for the one lifecycle action whose result the
   * UI shows (`adoptPath`). An unreachable or refusing endpoint answers with an
   * honest `error`, never a fabricated success.
   */
  async function postForJson(url: string, body: unknown): Promise<RawAdoptResult> {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: `the paths endpoint answered ${res.status}` };
      return (await res.json()) as RawAdoptResult;
    } catch {
      return { ok: false, error: 'could not reach the paths endpoint' };
    }
  }

  // Two guards on the poll: a SEQUENCE number so a slow response can never
  // overwrite a newer one, and an unchanged-skip so an idle 1 Hz poll does not
  // re-render every subscriber every second (the whole log rides each poll).
  let pollSeq = 0;
  let lastPollText = '';
  async function refresh(): Promise<void> {
    if (source.kind === 'session') {
      setState(await mapSession(source.session, options.defaultLayout));
      return;
    }
    const mine = ++pollSeq;
    try {
      const res = await doFetch(endpoints.state);
      if (!res.ok) return;
      const raw = (await res.json()) as RawPollState;
      if (mine !== pollSeq) return; // a newer poll already landed — this one is stale
      const text = JSON.stringify(raw);
      if (text === lastPollText) return; // nothing changed — no re-render
      lastPollText = text;
      setState(mapPollState(raw, options.defaultLayout));
    } catch {
      /* swallow — keep the last good snapshot */
    }
  }

  async function afterAction(): Promise<void> {
    if (refreshOnAction) await refresh();
  }

  /** POST a gesture and read whether it landed — a refusal's sentence comes back, an unreachable door answers honestly. */
  async function postForOutcome(url: string, body: unknown): Promise<DescribeOutcome> {
    try {
      const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const raw = (await res.json()) as { ok?: boolean; error?: string; rejection?: { detail?: string } };
      if (raw.ok === true) return { ok: true };
      return { ok: false, sentence: raw.rejection?.detail ?? raw.error ?? `the session answered ${res.status}` };
    } catch {
      return { ok: false, sentence: 'could not reach the session' };
    }
  }

  async function dispatch(action: DispatchAction, body: Record<string, unknown>): Promise<DescribeOutcome> {
    let outcome: DescribeOutcome;
    if (source.kind === 'session') {
      const r = await Promise.resolve(source.session.dispatch(action, { as }));
      outcome = r.ok ? { ok: true } : { ok: false, sentence: r.rejection.detail };
    } else {
      outcome = await postForOutcome(endpoints.dispatch, body);
    }
    await afterAction();
    return outcome;
  }

  const view: SessionView = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,

    async emit(viewId, emission, intent) {
      if (emission.encoding.kind === 'cell') {
        // D30: the compound cell rides the SELECT verb's cell form — one
        // gesture, ONE commit (fields + values; values null clears the cell).
        const fields = emission.encoding.fields;
        const values = emission.rawValue as CellValues;
        const label = intent ?? `cell ${fields[0]} × ${fields[1]}`;
        await dispatch(
          { verb: 'select', viewId, fields, values, cause: cause(label) },
          { verb: 'select', viewId, fields, values, intent: label },
        );
        return;
      }
      const label = intent ?? `${emission.encoding.kind} ${emission.encoding.field}`;
      if (emission.encoding.kind === 'match') {
        // SET-1: the match rides the SELECT verb's values form — one gesture, ONE commit; null clears
        const body = emission.rawValue as { readonly values: readonly unknown[]; readonly exclude?: boolean } | null;
        const field = emission.encoding.field;
        const values = body === null ? null : body.values;
        const polarity = body?.exclude === true ? { exclude: true } : {};
        await dispatch(
          { verb: 'select', viewId, field, values, ...polarity, cause: cause(label) },
          { verb: 'select', viewId, field, values, ...polarity, intent: label },
        );
        return;
      }
      if (emission.encoding.kind === 'interval') {
        // the discriminant sits on `encoding.kind` (nested), so `rawValue` does
        // not auto-narrow — assert the interval payload the guard guarantees
        const range = emission.rawValue as readonly [number, number] | null;
        await dispatch(
          { verb: 'filter', viewId, field: emission.encoding.field, range, cause: cause(label) },
          { verb: 'filter', viewId, field: emission.encoding.field, range, intent: label },
        );
      } else {
        const value = emission.rawValue;
        await dispatch(
          { verb: 'select', viewId, field: emission.encoding.field, value, cause: cause(label) },
          { verb: 'select', viewId, field: emission.encoding.field, value, intent: label },
        );
      }
    },

    async clear(viewId, intent) {
      const own = state.selections.find((s) => s.viewId === viewId);
      if (own === undefined) return;
      const label = intent ?? `clear ${viewId}`;
      if (own.kind === 'cell') {
        const fields = own.fields as readonly [string, string];
        await dispatch({ verb: 'select', viewId, fields, values: null, cause: cause(label) }, { verb: 'select', viewId, fields, values: null, intent: label });
      } else if (own.kind === 'interval') {
        await dispatch({ verb: 'filter', viewId, field: own.field, range: null, cause: cause(label) }, { verb: 'filter', viewId, field: own.field, range: null, intent: label });
      } else if (own.kind === 'match') {
        await dispatch({ verb: 'select', viewId, field: own.field, values: null, cause: cause(label) }, { verb: 'select', viewId, field: own.field, values: null, intent: label });
      } else {
        // a point clears with an ABSENT value (the three-way split: null would mean IS NULL) — the wire body carries no value
        await dispatch({ verb: 'select', viewId, field: own.field, value: undefined, cause: cause(label) }, { verb: 'select', viewId, field: own.field, intent: label });
      }
    },

    async clearAll(intent) {
      for (const s of [...state.selections]) await view.clear(s.viewId, intent ?? 'clear all');
    },

    async link(edge, intent) {
      const label = intent ?? `${edge.source} ${edge.kind} → ${edge.target}: ${edge.response ?? 'back to the rule'}`;
      const body = {
        verb: 'link' as const,
        source: edge.source,
        kind: edge.kind,
        target: edge.target,
        response: edge.response,
        ...(edge.mapping !== undefined ? { mapping: edge.mapping } : {}),
        ...(edge.channels !== undefined ? { channels: edge.channels } : {}),
        ...(edge.onClear !== undefined ? { onClear: edge.onClear } : {}),
        ...(edge.fold !== undefined ? { fold: edge.fold } : {}),
      };
      await dispatch({ ...body, cause: cause(label) }, { ...body, intent: label });
    },

    async setPolarity(viewId, exclude, intent) {
      const own = state.selections.find((s) => s.viewId === viewId);
      // no live point or match on that view → nothing to flip (an interval, a cell, a cleared clause, an unknown view)
      if (own === undefined || own.value === undefined || (own.kind !== 'point' && own.kind !== 'match')) return;
      if (own.kind === 'match' && own.value === null) return; // a cleared match has no polarity
      const values: readonly unknown[] = own.kind === 'point' ? [own.value] : (own.value as { readonly values: readonly unknown[] }).values;
      const label = intent ?? `${exclude ? 'exclude' : 'keep'} ${own.field}`;
      const polarity = exclude ? { exclude: true } : {};
      await dispatch(
        { verb: 'select', viewId, field: own.field, values, ...polarity, cause: cause(label) },
        { verb: 'select', viewId, field: own.field, values, ...polarity, intent: label },
      );
    },

    async reencode(viewId, channel, field) {
      // UI-0 (fe6e5b5): reencode is the 8th dispatch verb — it rides the SAME
      // dispatch path as every other act (there is no session.reencode method).
      const intent = `reencode ${viewId}.${channel} → ${field}`;
      await dispatch(
        { verb: 'reencode', viewId, channel, field, cause: cause(intent) },
        { verb: 'reencode', viewId, channel, field, intent },
      );
    },

    async describe(viewId, slot, record, intentWord) {
      const intent = intentWord ?? (record === null ? `${viewId}.${slot}: back to the declaration` : `describe ${viewId}.${slot}`);
      const body = { verb: 'describe' as const, viewId, slot, record };
      return dispatch({ ...body, record: record as never, cause: cause(intent) }, { ...body, intent });
    },

    async propose(viewId, slot, record, intentWord) {
      const intent = intentWord ?? `propose ${viewId}.${slot}`;
      const body = { verb: 'describe' as const, viewId, slot, record, proposal: true };
      await dispatch({ ...body, record: record as never, cause: cause(intent) }, { ...body, intent });
    },

    async acceptProposal(viewId, slot, proposal, intentWord) {
      const intent = intentWord ?? `accept the proposal for ${viewId}.${slot}`;
      const body = { verb: 'describe' as const, viewId, slot, record: null, accept: proposal };
      await dispatch({ ...body, cause: cause(intent) }, { ...body, intent });
    },

    async declineProposal(viewId, slot, proposal, reason, intentWord) {
      const intent = intentWord ?? `decline the proposal for ${viewId}.${slot}`;
      const body = { verb: 'describe' as const, viewId, slot, record: null, decline: { proposal, reason } };
      await dispatch({ ...body, cause: cause(intent) }, { ...body, intent });
    },

    async reencodeSet(viewId, bindings, intentWord) {
      // encoding plane: several channels in ONE act — judged as a whole, one commit (a swap never lands twice)
      const intent = intentWord ?? `reencode ${viewId} ${Object.entries(bindings).map(([c, f]) => `${c} → ${f}`).join(', ')}`;
      await dispatch(
        { verb: 'reencode', viewId, bindings, cause: cause(intent) },
        { verb: 'reencode', viewId, bindings, intent },
      );
    },

    async navigate(viewId, viewState) {
      // RP-1: the view state is serialized into the intent — INERT, human-readable,
      // never parsed back. The verb itself is the record; navigate never filters.
      const described = viewState
        ? ' ' +
          Object.entries(viewState)
            .map(([channel, [lo, hi]]) => `${channel}:[${String(lo)}, ${String(hi)}]`)
            .join(' ')
        : '';
      const intent = `navigate ${viewId}${described}`;
      await dispatch({ verb: 'navigate', viewId, cause: cause(intent) }, { verb: 'navigate', viewId, intent });
    },

    async setLayout(change) {
      // One commit per provided prop (usually exactly one gesture = one prop),
      // each with the plain words the commit log will show.
      const notes: { field: string; value: string; intent: string }[] = [];
      if (change.preset !== undefined) notes.push({ field: 'preset', value: change.preset, intent: `layout = ${change.preset}` });
      if (change.focusId !== undefined) notes.push({ field: 'focus', value: change.focusId, intent: `layout = focus on ${change.focusId}` });
      if (change.order !== undefined) notes.push({ field: 'order', value: change.order.join(','), intent: `layout order: ${change.order.join(', ')}` });
      for (const n of notes) {
        await dispatch(
          { verb: 'navigate', viewId: LAYOUT_DASHBOARD_VIEW_ID, field: n.field, value: n.value, cause: cause(n.intent) },
          { verb: 'navigate', viewId: LAYOUT_DASHBOARD_VIEW_ID, field: n.field, value: n.value, intent: n.intent },
        );
      }
    },

    async analyze(analysisId, intent) {
      await dispatch({ verb: 'analyze', analysisId, cause: cause(intent ?? `analyze ${analysisId}`) }, { verb: 'analyze', analysisId, intent: intent ?? `analyze ${analysisId}` });
    },

    async seek(commitId) {
      if (source.kind === 'session') source.session.seek(commitId);
      else await postJson(endpoints.seek, { commitId });
      await afterAction();
    },

    async stepBack() {
      const target = stepBackTarget(state.commits, state.cursor);
      if (target) await view.seek(target);
    },
    async stepForward() {
      const target = stepForwardTarget(state.commits, state.cursor, state.head);
      if (target) await view.seek(target);
    },

    async saveSelection(viewId, name) {
      const own = state.selections.find((s) => s.viewId === viewId);
      if (own?.commitId === undefined || name.trim().length === 0) return; // nothing live to name (or an older server sends no commit id)
      const body = { verb: 'annotate' as const, target: own.commitId, note: name.trim() };
      await dispatch({ ...body, cause: cause(`save the ${viewId} selection as "${name.trim()}"`) }, { ...body, intent: `save ${name.trim()}` });
    },

    async checkpoint(label) {
      // NOT routed through the generic dispatch() helper: for a poll source that
      // helper always POSTs to endpoints.dispatch, but the demo's checkpoint
      // route is its OWN endpoint (endpoints.checkpoint = '/api/checkpoint',
      // matching seek's own-endpoint pattern below) — bug found dogfooding UI-2
      // (the checkpoint composer silently no-opped over a polled session; only
      // the in-process `sessionSource` path, which never used this helper's poll
      // branch, was ever exercised before).
      if (source.kind === 'session') await Promise.resolve(source.session.dispatch({ verb: 'checkpoint', label, cause: cause(`checkpoint ${label}`) }, { as }));
      else await postJson(endpoints.checkpoint, { label });
      await afterAction();
    },

    async returnToNow() {
      if (state.head) await view.seek(state.head);
    },

    // ── named paths (BR-2): sessionSource calls the BR-1 methods directly; the
    // poll source POSTs to the OWN endpoints (see the PollEndpoints contract).
    // A rejected call lands as a typed gap in the next snapshot — never a throw.
    async switchPath(name) {
      if (source.kind === 'session') source.session.switchPath(name);
      else await postJson(endpoints.paths, { action: 'switch', name });
      await afterAction();
    },

    async renamePath(from, to) {
      if (source.kind === 'session') source.session.renamePath(from, to);
      else await postJson(endpoints.paths, { action: 'rename', from, to });
      await afterAction();
    },

    async newPathAt(commitId, name) {
      if (source.kind === 'session') source.session.newPathAt(commitId, name);
      else await postJson(endpoints.paths, { action: 'new', commitId, name });
      await afterAction();
    },

    async compare(aRef, bRef) {
      // read-only: no afterAction — comparing never moves the cursor or head
      if (source.kind === 'session') {
        const raw = await Promise.resolve(source.session.compare(aRef, bRef));
        return mapCompareResult(raw as RawCompareResult);
      }
      try {
        const res = await doFetch(endpoints.compare, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a: aRef, b: bRef }),
        });
        if (!res.ok) return { ok: false, reason: `the compare endpoint answered ${res.status}` };
        return mapCompareResult((await res.json()) as RawCompareResult);
      } catch {
        return { ok: false, reason: 'could not reach the compare endpoint' };
      }
    },

    async bringOver(commitId) {
      if (source.kind === 'session') await Promise.resolve(source.session.bringOver(commitId, { as }));
      else await postJson(endpoints.bringOver, { commitId });
      await afterAction();
    },

    async undo(commitId) {
      if (source.kind === 'session') await Promise.resolve(source.session.undo(commitId, { as }));
      else await postJson(endpoints.undo, { commitId });
      await afterAction();
    },

    // ── the trail lifecycle (TL-1): the three hiding/rewinding actions are
    // fire-and-reconcile like switchPath (a refusal shows up as a typed gap in
    // the next snapshot); `adoptPath` is the one whose ANSWER the UI reads back.
    async archivePath(name) {
      if (source.kind === 'session') source.session.archivePath(name, { as });
      else await postJson(endpoints.paths, { action: 'archive', name });
      await afterAction();
    },

    async restorePath(name) {
      if (source.kind === 'session') source.session.restorePath(name, { as });
      else await postJson(endpoints.paths, { action: 'restore', name });
      await afterAction();
    },

    async discardFromHere(commitId) {
      if (source.kind === 'session') source.session.discardFromHere({ ...(commitId !== undefined ? { at: commitId } : {}), as });
      else await postJson(endpoints.paths, { action: 'discard', ...(commitId !== undefined ? { commitId } : {}) });
      await afterAction();
    },

    async adoptPath(name) {
      let raw: RawAdoptResult;
      if (source.kind === 'session') {
        raw = await Promise.resolve(source.session.adoptPath(name, { as }));
      } else {
        raw = await postForJson(endpoints.paths, { action: 'adopt', name });
      }
      await afterAction();
      return summarizeAdopt(name, raw);
    },

    dispose() {
      if (timer) clearInterval(timer);
      listeners.clear();
    },
  };

  // poll sources tick on their own interval (in-process sessions refresh on action)
  if (source.kind === 'poll' && source.intervalMs && source.intervalMs > 0) {
    timer = setInterval(() => void refresh(), source.intervalMs);
  }
  void refresh();

  return view;
}
