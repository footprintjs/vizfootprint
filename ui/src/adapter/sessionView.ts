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
  HONESTY_LINE,
  emptyState,
  emptyPaths,
  type SessionViewState,
  type CommitView,
  type ViewView,
  type ColumnView,
  type SelectionView,
  type BranchView,
  type PathsView,
  type PathEventView,
  type CompareView,
  type CheckpointView,
  type LedgerView,
  type GapView,
  type ReadinessView,
  type ViewEncoding,
  type ChartCellView,
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
  /** RP-3: agent-authored charts (with their gated specs). Optional — a pre-RP-3 session simply has none. */
  charts?(): readonly RawChart[];
  readonly log: { readonly records: readonly CommitRecord[] };
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
  readonly checkpoints?: readonly { label: string; commitId: string | null; ts: number }[];
  readonly cursor?: string | null;
  readonly head?: string | null;
  readonly cursorTests?: number;
  readonly viewingPast?: boolean;
  readonly defaultTable?: string;
  readonly mode?: string;
  /** RP-3: the agent-authored charts (`session.charts()` serialized). */
  readonly charts?: readonly RawChart[];
}
/** The `paths` slice of `/api/state` — `PathsState` from `src/session`, verbatim JSON. */
export interface RawPollPaths {
  readonly current?: string | null;
  readonly detachedAt?: string | null;
  readonly list?: readonly { name: string; tip: string; steps: number; lastTs: number; active: boolean }[];
  readonly events?: readonly PathEventView[];
}
interface RawPollCommit {
  readonly id: string;
  readonly parent: string | null;
  readonly viewId: string;
  readonly kind: 'point' | 'interval';
  readonly field: string;
  readonly value: unknown;
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
 *   POST compare    → { a, b } (path names or commit ids); the RESPONSE body is
 *                     the session's CompareResult JSON, verbatim
 *   POST bringOver  → { commitId }
 *   POST undo       → { commitId }
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
  kind: 'point' | 'interval';
  field: string;
  value: unknown;
  actor: Actor;
  intent?: string;
  correlationId?: string;
  replayedFrom?: string;
  revertOf?: string;
  conflicts?: readonly string[];
}

/** A short, safe label for a chip/dot — never a raw value dump. */
function commitLabel(field: string): string {
  if (field === '__analysis__') return 'analysis';
  if (field === 'pValue') return 'test';
  if (field === '__annotation__') return 'note';
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
  mode?: string;
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
    actor: c.actor,
    intent: c.intent,
    correlationId: c.correlationId,
    replayedFrom: c.replayedFrom,
    revertOf: c.revertOf,
    conflicts: c.conflicts,
    label: commitLabel(c.field),
    onBranch: active.has(c.id),
    isCursor: c.id === p.cursor,
    isHead: c.id === p.head,
  }));
  const activePathIds = pathToRoot(p.rawCommits, p.head).map((r) => r.id);
  const ledger: LedgerView = { ...p.ledgerBase, cursorTests: p.cursorTests, honesty: HONESTY_LINE };
  return {
    defaultTable: p.defaultTable,
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
function mapSelections(sels: readonly unknown[] | undefined): SelectionView[] {
  return (sels ?? []).map((s) => {
    const o = s as SelectionView;
    return { viewId: o.viewId, field: o.field, kind: o.kind, value: o.value };
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
function mapColumns(columns: Readonly<Record<string, readonly { field: string; type: string }[]>> | undefined): Record<string, readonly ColumnView[]> {
  const out: Record<string, readonly ColumnView[]> = {};
  for (const [table, cols] of Object.entries(columns ?? {})) out[table] = cols.map((c) => ({ field: c.field, type: String(c.type) }));
  return out;
}
/**
 * Normalize the named-paths slice — `overview().paths` live, or the identical
 * `/api/state` JSON. Defensive: a source that predates BR-1 simply has no
 * paths, and the UI renders the honest empty surface instead of crashing.
 */
function mapPaths(raw: RawPollPaths | undefined): PathsView {
  if (!raw) return emptyPaths();
  return {
    current: raw.current ?? null,
    detachedAt: raw.detachedAt ?? null,
    list: (raw.list ?? []).map((p) => ({ name: p.name, tip: p.tip, steps: p.steps, lastTs: p.lastTs, active: p.active })),
    events: [...(raw.events ?? [])],
  };
}

function mapGaps(gaps: readonly unknown[] | undefined): GapView[] {
  return (gaps ?? []).map((g) => {
    const o = g as GapView;
    return { code: o.code, op: o.op, detail: o.detail, target: o.target };
  });
}

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
    branches: session.branches().map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
    paths: mapPaths(overview.paths),
    checkpoints: session.checkpoints().map((c) => ({ label: c.label, commitId: c.commitId, ts: c.ts })),
    cursor: overview.time.cursor,
    head: overview.time.head,
    viewingPast: overview.time.viewingPast,
    cursorTests: overview.time.cursorTests,
    ledgerBase: mapLedgerBase(overview.fdr),
    gaps: mapGaps(session.gaps()),
    readiness: mapReadiness(overview.analyses),
    charts: mapCharts(session.charts?.()),
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
    branches: (raw.branches ?? []).map((b) => ({ tip: b.tip, length: b.length, actor: b.actor, active: b.active })),
    paths: mapPaths(raw.paths),
    checkpoints: (raw.checkpoints ?? []).map((c) => ({ label: c.label, commitId: c.commitId, ts: c.ts })),
    cursor: raw.cursor ?? null,
    head: raw.head ?? null,
    viewingPast: raw.viewingPast ?? false,
    cursorTests: raw.cursorTests ?? 0,
    ledgerBase: mapLedgerBase(raw.fdr),
    gaps: mapGaps(raw.gaps),
    readiness: mapReadiness(raw.analyses),
    charts: mapCharts(raw.charts),
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
  /** UI-0: rebind a view's visual channel to a field. */
  reencode(viewId: string, channel: string, field: string): Promise<void>;
  /**
   * RP-1: record a pan/zoom view state through the `navigate` dispatch verb.
   * Deliberately NON-filtering — a viewport is not a data claim; the view
   * state rides the cause's intent as INERT data. A navigate against an
   * undeclared view files a typed `needs-view` gap at the session tier.
   */
  navigate(viewId: string, viewState?: NavigateViewState): Promise<void>;
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

  async function refresh(): Promise<void> {
    if (source.kind === 'session') {
      setState(await mapSession(source.session));
      return;
    }
    try {
      const res = await doFetch(endpoints.state);
      if (!res.ok) return;
      const raw = (await res.json()) as RawPollState;
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
      const label = intent ?? `${emission.encoding.kind} ${emission.encoding.field}`;
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
