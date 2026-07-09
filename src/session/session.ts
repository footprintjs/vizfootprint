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

import type { Actor, Cause } from '../cause/index.js';
import { validateCause } from '../cause/index.js';
import { CauseSelectionSession } from '../log/index.js';
import { TEST_ANALOG_FIELD, type FdrStep } from '../fdr/index.js';
import { isRejection, matchesClause, type ColumnInfo, type PredicateClause, type Row } from '../data/index.js';
import type { CauseClause } from '../mosaic/index.js';
import { registerAnalysisSlot } from '../def/register.js';
import type {
  AnalysisSlot,
  DashboardRuntime,
  DispatchVerb,
  FdrStepper,
  RegisteredAnalysis,
} from '../def/types.js';
import { GapLedger } from './gapLedger.js';
import { why } from '../why/index.js';
import type { RuntimeSnapshot } from 'footprintjs';
import type { AgentEventFrame, WhyResult, WhyTarget } from '../why/index.js';
import type {
  AnalysisCommit,
  Checkpoint,
  ColumnFacet,
  DeclareAnalysisOptions,
  DispatchAction,
  DispatchResult,
  GapCode,
  GapRow,
  Overview,
  SessionOptions,
  ViewAdapter,
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
 * Fields a `select`/`filter` may NOT target — a clause on one of these would
 * collide with a session-authored commit. `pValue` (`TEST_ANALOG_FIELD`) is the
 * load-bearing one: an unguarded point select on a data column literally named
 * `pValue` carrying a value in [0,1] would be miscounted as a declared test by
 * `hypothesisRecordsFromLog` on log replay (R6). Reject it as a typed gap.
 */
const RESERVED_PROBE_FIELDS = new Set<string>([TEST_ANALOG_FIELD, ANALYSIS_FIELD, ANNOTATION_FIELD]);

/** The public session surface (family-symmetric with hcifootprint's Session). */
export interface InteractionSession {
  readonly log: CauseSelectionSession;
  readonly defaultTable: string;
  readonly defaultActor: Actor;
  readonly head: string | null;

  /** Register a view adapter under a declared view identity (R3). */
  mountView(viewId: string, adapter: ViewAdapter): { ok: true } | { ok: false; gap: GapRow };

  /** THE single semantic entry point (R4). */
  dispatch(action: DispatchAction, opts?: { as?: Actor }): Promise<DispatchResult>;

  /** Run a declared analysis: stamp cause, land the AnalysisCommit, step L4, materialize columns (R11). */
  declareAnalysis(id: string, opts?: DeclareAnalysisOptions): Promise<AnalysisCommit>;

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
  checkpoints(): readonly Checkpoint[];

  /** Rows under the current selection (across all views). */
  selectedRows(table?: string): Promise<readonly Row[]>;

  /** The structured `whats_here` projection (views/selections/analyses+readiness/fdr/gaps). */
  overview(): Promise<Overview>;
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
  /** materialised column name → its producing analysis provenance (L6 `why({kind:'column'})`). */
  private readonly whyByColumn = new Map<string, WhyProvenance>();
  /** analysisId → the last invocation's provenance (L6 `why({kind:'hypothesis'})`). */
  private readonly whyByAnalysisId = new Map<string, WhyProvenance>();
  private readonly fdrStepper: FdrStepper;
  private readonly _ledger: FdrStep[] = [];
  private readonly _checkpoints: Checkpoint[] = [];
  private readonly initialWealth: number;

  private _head: string | null = null;
  private seq = 0;
  private testClock = 0;
  private _currentView: string | null = null;

  constructor(runtime: DashboardRuntime, opts: SessionOptions = {}) {
    this.runtime = runtime;
    this.defaultActor = opts.as ?? 'agent';
    this.defaultTable = opts.defaultTable ?? runtime.defaultTable;
    this.fdrStepper = runtime.makeFdrStepper();
    // Initial alpha-wealth W0 for the summary before any test lands.
    const fdr = runtime.def.fdr;
    this.initialWealth =
      fdr?.w0 ?? (runtime.fdrProcedure === 'LORD++' ? runtime.fdrAlpha / 2 : runtime.fdrAlpha);
  }

  get head(): string | null {
    return this._head;
  }

  // ── ids ────────────────────────────────────────────────────────────────────
  private nextId(): string {
    return `s${++this.seq}`;
  }

  // ── cause stamping (R1 / R12) ────────────────────────────────────────────────
  private stampCause(cause: Cause, verb: DispatchVerb, as: Actor | undefined): Cause {
    const validated = validateCause(cause); // R12 gate — never trusts caller shape
    const requestedBy: Actor = as ?? validated.requestedBy;
    // R1: an analysis is computedBy:'system' BY CONSTRUCTION — never caller-supplied.
    const computedBy: Actor = verb === 'analyze' ? 'system' : (as ?? validated.computedBy);
    const out: Cause = { requestedBy, computedBy };
    if (validated.intent !== undefined) out.intent = validated.intent;
    return out;
  }

  // ── data reads ───────────────────────────────────────────────────────────────
  // Both readers surface a provider REJECTION as a typed `{ rejected }` (never a
  // misleading empty array) so a REQUEST-boundary caller (doProbe / declareAnalysis)
  // can file a `needs-backend-data` gap rather than silently dropping (R14).
  private async allRows(table: string): Promise<readonly Row[] | { rejected: string }> {
    const provider = this.runtime.providerFor(table);
    if (!provider) return { rejected: `no provider for table "${table}"` };
    const res = await provider.evaluate(table, null, { mode: 'rows' });
    if (isRejection(res)) return { rejected: res.detail ?? res.reason };
    return res.rows ?? [];
  }

  private async columnsOf(table: string): Promise<readonly ColumnInfo[] | { rejected: string }> {
    const provider = this.runtime.providerFor(table);
    if (!provider) return { rejected: `no provider for table "${table}"` };
    const res = await provider.columns(table);
    if (isRejection(res)) return { rejected: res.detail ?? res.reason };
    return res;
  }

  /**
   * Rows under the current selection (across all views). A pure best-effort
   * PROJECTION: a rejecting backend yields `[]` (the authoritative
   * `needs-backend-data` gap is filed at the request boundary, not here — a
   * projection called by `overview()` must not spam the ledger).
   */
  async selectedRows(table = this.defaultTable): Promise<readonly Row[]> {
    const base = await this.allRows(table);
    if ('rejected' in base) return [];
    const clauses = [...this.activeFilters.values()];
    if (clauses.length === 0) return base;
    return base.filter((r) => clauses.every((c) => matchesClause(r, c)));
  }

  /** Resolve a declared analysis's input rows, surfacing a backend rejection (R14). */
  private async resolveAnalysisInput(
    producesColumns: boolean,
    table: string,
  ): Promise<readonly Row[] | { rejected: string }> {
    const base = await this.allRows(table);
    if ('rejected' in base) return base; // backend rejection — propagate honestly
    // Columns-channel analyses run over the FULL table (materialized values must
    // align to the row order); every other channel runs over the selection.
    if (producesColumns) return base;
    const clauses = [...this.activeFilters.values()];
    return clauses.length === 0 ? base : base.filter((r) => clauses.every((c) => matchesClause(r, c)));
  }

  // ── capability resolution (R14 / R3) ─────────────────────────────────────────
  private probeCapability(
    viewId: string,
  ): { canProbe: boolean; encodings?: readonly ('point' | 'interval')[] } | undefined {
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
  private probeGuard(viewId: string, kind: 'point' | 'interval'): string | null {
    const cap = this.probeCapability(viewId);
    if (!cap) return null; // no capability declared → default allow
    if (!cap.canProbe) return `view "${viewId}" declares no-probe capability`;
    if (cap.encodings && !cap.encodings.includes(kind)) {
      return `view "${viewId}" does not encode a ${kind} selection`;
    }
    return null;
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
      case 'select':
        return this.doProbe(action.viewId, action.field, action.value, 'point', action.cause, as, intent, action.correlationId);
      case 'filter':
        return this.doProbe(
          action.viewId,
          action.field,
          action.range === null ? null : [action.range[0], action.range[1]],
          'interval',
          action.cause,
          as,
          intent,
          action.correlationId,
        );
      case 'annotate':
        return this.doAnnotate(action.target, action.note, action.cause, as, intent);
      case 'navigate':
        return this.doNavigate(action.viewId, intent);
      case 'analyze':
        return this.doAnalyze(action.analysisId, action.input, action.cause, as, intent, action.correlationId);
      case 'fork':
        return this.doFork(action.fromCommitId, intent);
      case 'checkpoint':
        return this.doCheckpoint(action.label, intent);
    }
  }

  private reject(verb: DispatchVerb, intent: DispatchResult['intent'], gap: GapRow): DispatchResult {
    return { ok: false, verb, intent, rejection: gap };
  }

  private async doProbe(
    viewId: string,
    field: string,
    value: unknown,
    kind: 'point' | 'interval',
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
    correlationId: string | undefined,
  ): Promise<DispatchResult> {
    const verb: DispatchVerb = kind === 'point' ? 'select' : 'filter';
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
    // 3. the field must be a real column (R14: needs-column / needs-backend-data).
    const cols = await this.columnsOf(this.defaultTable);
    if ('rejected' in cols) {
      return this.reject(verb, intent, this.gapLedger.file('needs-backend-data', verb, cols.rejected, field));
    }
    if (!cols.some((c) => c.name === field)) {
      return this.reject(verb, intent, this.gapLedger.file('needs-column', verb, `no column "${field}" in table "${this.defaultTable}"`, field));
    }
    // 4. land the cause-tagged clause commit (commit-on-intent) + update the active filter set.
    const stamped = this.stampCause(cause, verb, as);
    const { record, clause } = this.log.commit({
      id: this.nextId(),
      parent: this._head,
      ...(correlationId !== undefined ? { correlationId } : {}),
      viewId,
      actorMeta: this.runtime.views.get(viewId)!.meta,
      kind,
      field,
      value,
      cause: stamped,
    });
    this._head = record.id;
    if (kind === 'interval' && value === null) {
      this.activeFilters.delete(viewId);
      this.activeFilterCommits.delete(viewId); // a cleared filter is no longer an input dependency
    } else {
      this.activeFilters.set(viewId, kind === 'point' ? { kind, field, value } : { kind, field, value: value as [number, number] });
      this.activeFilterCommits.set(viewId, record.id); // a superseded select on the same view drops out here
    }
    // R3 inbound: hand the resolved clause to a mounted adapter to re-render.
    this.adapters.get(viewId)?.applyClause?.(clause as CauseClause);
    return { ok: true, verb, intent, commit: record };
  }

  private doAnnotate(
    target: string,
    note: string,
    cause: Cause,
    as: Actor | undefined,
    intent: DispatchResult['intent'],
  ): DispatchResult {
    // An annotation is an INERT note (R12): stored as commit data, never parsed.
    const stamped = this.stampCause(cause, 'annotate', as);
    const viewId = `annotation:${stamped.requestedBy}`;
    const { record } = this.log.commit({
      id: this.nextId(),
      parent: this._head,
      viewId,
      actorMeta: { actor: stamped.requestedBy },
      kind: 'point',
      field: ANNOTATION_FIELD,
      value: note,
      cause: stamped,
    });
    this._head = record.id;
    return { ok: true, verb: 'annotate', intent, commit: record, annotated: { target, note } };
  }

  private doNavigate(viewId: string, intent: DispatchResult['intent']): DispatchResult {
    if (!this.runtime.views.has(viewId)) {
      return this.reject('navigate', intent, this.gapLedger.file('needs-view', 'navigate', `no declared view "${viewId}"`, viewId));
    }
    this._currentView = viewId;
    return { ok: true, verb: 'navigate', intent, navigatedTo: viewId };
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
    // Set the head to the fork point — the NEXT commit branches off it (R8).
    this._head = fromCommitId;
    return { ok: true, verb: 'fork', intent };
  }

  private doCheckpoint(label: string, intent: DispatchResult['intent']): DispatchResult {
    const checkpoint: Checkpoint = { label, commitId: this._head, ts: this._checkpoints.length };
    Object.freeze(checkpoint);
    this._checkpoints.push(checkpoint);
    return { ok: true, verb: 'checkpoint', intent, checkpoint };
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
        this._ledger.push(fdrStep);
      },
    });

    // R14: a degenerate result lands NOTHING (no commit) and spends NO wealth
    // (the sink never fired) — the honest flag is the whole answer.
    if (!run.result.ok) {
      return { analysisId: id, kind: analysis.kind, result: run.result };
    }

    // Land ONE cause-tagged provenance commit for the invocation.
    const analysisViewId = `analysis:${id}`;
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
      parent: this._head,
      ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
      viewId: analysisViewId,
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: landField,
      value: landValue,
      cause: stamped,
    });
    this._head = record.id;

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
            gap = this.gapLedger.file(code, 'declareAnalysis', landed.detail ?? landed.reason, name);
          } else {
            materialized.push(name);
          }
        }
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

  // ── L6 why(target) ─────────────────────────────────────────────────────────────
  why(target: WhyTarget, opts: { agentEventLog?: readonly AgentEventFrame[] } = {}): WhyResult {
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

  // ── ledgers ────────────────────────────────────────────────────────────────
  gaps(): readonly GapRow[] {
    return this.gapLedger.rows();
  }

  ledger(): readonly FdrStep[] {
    return this._ledger;
  }

  checkpoints(): readonly Checkpoint[] {
    return this._checkpoints;
  }

  // ── the whats_here projection ────────────────────────────────────────────────
  async overview(): Promise<Overview> {
    const selCount = (await this.selectedRows(this.defaultTable)).length;

    // columns per table (schema only — VALUES never ride here; Q8).
    const columns: Record<string, ColumnFacet[]> = {};
    const colNamesByTable = new Map<string, Set<string>>();
    for (const table of this.runtime.tables) {
      const cols = await this.columnsOf(table);
      if ('rejected' in cols) {
        columns[table] = [];
        colNamesByTable.set(table, new Set());
      } else {
        columns[table] = cols.map((c) => ({ field: c.name, type: c.type }));
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
        encodings: cap?.encodings ?? (['point', 'interval'] as const),
        canProbe: cap?.canProbe ?? true,
        mounted: this.adapters.has(view.viewId),
      };
    });

    const activeSelections = [...this.activeFilters.entries()].map(([viewId, clause]) => ({
      viewId,
      field: clause.field,
      kind: clause.kind as 'point' | 'interval',
      value: (clause as { value?: unknown }).value ?? null,
    }));

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
      } else if (a.def.produces !== 'columns' && minPoints !== undefined && selCount < minPoints) {
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
        selectedRows: selCount,
      };
    });

    const discoveries = this._ledger.filter((s) => s.reject).length;
    const wealth = this._ledger.length ? this._ledger[this._ledger.length - 1]!.wealthAfter : this.initialWealth;

    return {
      defaultTable: this.defaultTable,
      views,
      activeSelections,
      analyses,
      fdr: {
        procedure: this.runtime.fdrProcedure,
        alpha: this.runtime.fdrAlpha,
        tests: this._ledger.length,
        discoveries,
        wealth,
        ledger: [...this._ledger],
      },
      columns,
      gaps: this.gapLedger.size,
      currentView: this._currentView,
      engines: this.runtime.engines,
    };
  }
}

/** Construct a live session over a resolved dashboard runtime. Called by `buildDashboard`. */
export function createInteractionSession(runtime: DashboardRuntime, opts?: SessionOptions): InteractionSession {
  return new InteractionSessionImpl(runtime, opts);
}
