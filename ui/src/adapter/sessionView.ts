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
import { LinkGraphView,
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
  parseLayout,
} from './types.js';
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
  readonly analyses?: readonly unknown[];
  readonly fdr?: unknown;
  readonly columns?: Readonly<Record<string, readonly { field: string; type: string }[]>>;
  readonly encodings?: Readonly<Record<string, ViewEncoding>>;
  readonly gaps?: readonly unknown[];
  readonly branches?: readonly { tip: string; length: number; actor: Actor; active: boolean }[];
  /** BR-2: the named-paths surface (`overview().paths` serialized as-is). */
  readonly paths?: RawPollPaths;
  readonly checkpoints?: readonly { label: string; commitId: string | null; at?: string | null; ts: number }[];
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
  if (viewId.startsWith('layout:')) return 'layout'; // LY-1: an arrangement note ('preset'/'order'/'focus' rides field)
  if (field === '__analysis__') return 'analysis';
  if (field === 'pValue') return 'test';
  if (field === '__annotation__') return 'note';
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
}

/** Turn extracted pieces into the finalized, derivation-stamped state. */
function finalize(p: StatePieces): SessionViewState {
  const active = activePath(p.rawCommits, p.head);
  const commits: CommitView[] = p.rawCommits.map((c) => ({
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
    conflicts: c.conflicts,
    label: commitLabel(c.field, c.viewId),
    onBranch: active.has(c.id),
    isCursor: c.id === p.cursor,
    isHead: c.id === p.head,
  }));
  const activePathIds = pathToRoot(p.rawCommits, p.head).map((r) => r.id);
  const ledger: LedgerView = { ...p.ledgerBase, cursorTests: p.cursorTests, honesty: HONESTY_LINE };
  return {
    defaultTable: p.defaultTable,
    ...(p.links !== undefined ? { links: p.links } : {}),
    views: p.views,
    encodings: p.encodings,
    columns: p.columns,
    selections: p.selections,
    commits,
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
      columns?: readonly { field: string; type: string }[];
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
      columns: (o.columns ?? []).map((c) => ({ field: c.field, type: String(c.type) })),
    };
  });
}
/** The link graph, when the wire carries one with the shape src/links serves; anything else = absent (the old rule). */
function mapLinks(raw: unknown): LinkGraphView | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const g = raw as { default?: unknown; views?: unknown; edges?: unknown };
  if ((g.default !== 'crossfilter' && g.default !== 'none') || !Array.isArray(g.views) || !Array.isArray(g.edges)) return undefined;
  return { default: g.default, views: g.views as LinkGraphView['views'], edges: g.edges as LinkGraphView['edges'] };
}

function mapSelections(sels: readonly unknown[] | undefined): SelectionView[] {
  return (sels ?? []).map((s) => {
    const o = s as SelectionView;
    // D30: a cell selection carries its field pair through (both sources
    // serialize the same SelectionInfo shape).
    return { viewId: o.viewId, field: o.field, kind: o.kind, value: o.value, ...(o.fields !== undefined ? { fields: o.fields } : {}) };
  });
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
  columns: Readonly<Record<string, readonly { field: string; type: string; absence?: readonly string[] }[]>> | undefined,
): Record<string, readonly ColumnView[]> {
  const out: Record<string, readonly ColumnView[]> = {};
  for (const [table, cols] of Object.entries(columns ?? {})) {
    // The absence declaration rides through untouched: the app must never re-spell it.
    out[table] = cols.map((c) => (c.absence !== undefined ? { field: c.field, type: String(c.type), absence: c.absence } : { field: c.field, type: String(c.type) }));
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
async function mapSession(session: SessionLike): Promise<SessionViewState> {
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
    conflicts: r.cause?.conflicts,
  }));
  const views = mapViews(overview.views);
  return finalize({
    defaultTable: overview.defaultTable,
    rawCommits,
    views,
    encodings: overview.encodings ?? encodingsFromViews(views),
    columns: mapColumns(overview.columns),
    selections: mapSelections(overview.activeSelections),
    links: mapLinks((overview as { links?: unknown }).links),
    branches: session.branches().map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
    // TL-1: the overview's `paths` carries the VISIBLE rows; the archived ones
    // come from the session's own full listing (whats_here only reports their
    // COUNT, deliberately — a hidden path is hidden until asked for).
    paths: withArchived(mapPaths(overview.paths), session.paths({ includeArchived: true })),
    checkpoints: session.checkpoints().map((c) => ({ label: c.label, commitId: c.commitId, at: c.at, ts: c.ts })),
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
    layout: parseLayout(overview.layouts?.['dashboard']),
  });
}

/** Map a raw `/api/state` payload into `SessionViewState`. */
export function mapPollState(raw: RawPollState): SessionViewState {
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
    conflicts: r.cause?.conflicts,
  }));
  const views = mapViews(raw.views);
  return finalize({
    defaultTable: raw.defaultTable ?? 'data',
    rawCommits,
    views,
    encodings: raw.encodings ?? encodingsFromViews(views),
    columns: mapColumns(raw.columns),
    selections: mapSelections(raw.activeSelections),
    links: mapLinks(raw.links),
    branches: (raw.branches ?? []).map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
    paths: mapPaths(raw.paths),
    checkpoints: (raw.checkpoints ?? []).map((c) => ({ label: c.label, commitId: c.commitId, ...(c.at !== undefined ? { at: c.at } : {}), ts: c.ts })),
    cursor: raw.cursor ?? null,
    head: raw.head ?? null,
    viewingPast: raw.viewingPast ?? false,
    cursorTests: raw.cursorTests ?? 0,
    ledgerBase: mapLedgerBase(raw.fdr),
    gaps: mapGaps(raw.gaps),
    readiness: mapReadiness(raw.analyses),
    charts: mapCharts(raw.charts),
    layout: parseLayout(raw.layouts?.['dashboard']),
    mode: raw.mode,
  });
}

// ── the store ───────────────────────────────────────────────────────────────────

export interface SessionViewOptions {
  /** The acting principal for UI-initiated commits. Default `'user'`. */
  readonly as?: Actor;
  /** Refresh the snapshot after each action (default true). */
  readonly refreshOnAction?: boolean;
}

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
   * SET-1: flip a view's live point/match between KEEP and EXCLUDE (a point
   * becomes a one-value set). An interval or a cell has no polarity — no-op.
   */
  setPolarity(viewId: string, exclude: boolean, intent?: string): Promise<void>;
  /** UI-0: rebind a view's visual channel to a field. */
  reencode(viewId: string, channel: string, field: string): Promise<void>;
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
      setState(await mapSession(source.session));
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
      setState(mapPollState(raw));
    } catch {
      /* swallow — keep the last good snapshot */
    }
  }

  async function afterAction(): Promise<void> {
    if (refreshOnAction) await refresh();
  }

  async function dispatch(action: DispatchAction, body: Record<string, unknown>): Promise<void> {
    if (source.kind === 'session') {
      await Promise.resolve(source.session.dispatch(action, { as }));
    } else {
      await postJson(endpoints.dispatch, body);
    }
    await afterAction();
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
