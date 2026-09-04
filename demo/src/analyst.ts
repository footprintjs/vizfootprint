/**
 * URL 2 — /analyst: the declared-analysis + online-FDR story, PLUS the real L5
 * agent surface (`buildDashboard(def).createSession()` + `vizAsTools`).
 *
 *   - correlation (kind:'test')      → a scalar r; its p-value STEPS the real
 *     online-FDR stepper `session` owns internally — one honest ledger row,
 *     read back through `session.overview().fdr` (never a locally-kept copy).
 *   - clustering (kind:'transform')  → materializes cluster_id via `session`'s
 *     own data provider (R11's landing spot; `session.dispatch({verb:'analyze'})`
 *     lands it), then re-enters as an ORDINARY point predicate (a cluster
 *     click-list) — driven by `session.dispatch({verb:'select', ...})`.
 *   - regression (kind:'transform')  → an OLS line drawn as an SVG overlay
 *     (geometry channel; selects no rows). Honesty floor: < 10 points → R14.
 *   - group-by (kind:'transform')    → a small summary table.
 *
 * User gestures (scatter brush, bar click, cluster chip) all ride
 * `session.dispatch(...)` directly (R4's single semantic entry point, open to
 * any principal). The "Run agent task" / "asks for a column that doesn't
 * exist" buttons instead go through `vizAsTools(session, {as:'agent'})` — the
 * FIXED Mode-B tool port an LLM agent would actually call — so the activity
 * strip and the gap panel are produced by the real tool surface, not a
 * simulation of it. `viz.dispatch.range`/`.value` are plain DATA-space bounds;
 * only `session.log.selection` (the crossfilter self-exclusion machinery
 * `selectedRows()` doesn't expose a per-client variant of) is read directly —
 * everything ANALYTICAL (selection resolution, materialize, the ledger, gaps)
 * flows through the session.
 *
 * `declareClustering` keeps ONE honest wrap point: `AnalysisCommit` reports
 * which COLUMN NAMES were materialized (`materialized`), not the computed
 * VALUE ARRAY — there is no sanctioned way to read the array back through the
 * session (only through `selectedRows()`, which is filtered, or aggregate
 * `overview()` counts). This hand-rolled SVG chart keeps its OWN `rows` array
 * for rendering (a separate copy from the session's internal data provider),
 * so it mirrors cluster_id onto it with one extra, session-free, deterministic
 * run of the SAME analysis module (same input order -> byte-identical
 * assignment) — see the comment at its call site.
 *
 * Invariants shown live:
 *   R6  — brushing NEVER adds a ledger row; only a Declare (or the agent's
 *         declare_analysis tool) does.
 *   R14 — the degenerate button (8 collinear points → correlation) surfaces the
 *         honest degenerate-fit flag instead of a fabricated r, and spends NO
 *         FDR wealth (no ledger row).
 *   R14 (agent) — the gap button asks the agent to select on a column that was
 *         never declared; the surface files a typed `needs-column` gap instead
 *         of silently no-op'ing.
 * Two-string discipline: all runtime text via textContent / text nodes,
 * including every activity-strip / gap-panel row.
 */

import {
  BarChart,
  CATEGORIES,
  Scatter,
  actionButton,
  el,
  fmtInterval,
  loadRows,
  replaceChildren,
  specFromRecord,
  type DemoRow,
} from './common.js';
import { causeClauseFromEmission, type ActorMeta, type ChartEmission, type RegisteredSource } from 'vizfootprint/mosaic';
import type { Cause } from 'vizfootprint/cause';
import { matchesClause, type PredicateClause } from 'vizfootprint/data';
import { correlationAnalysis, clusteringAnalysis, regressionAnalysis, groupByAnalysis } from 'vizfootprint/analysis';
import type { FdrStep } from 'vizfootprint/session';
import type { CommitRecord } from 'vizfootprint/log';
import { buildDashboard, vizAsTools, type AnalysisCommit, type DashboardDef, type FdrSummary, type GapRow, type VizToolResult } from 'vizfootprint/agent';

const ALPHA = 0.05;
const CLUSTER_K = 4;
const CLUSTER_COLORS = ['#4c8dff', '#f5a623', '#00b3a4', '#ff5c9d'];

const SCATTER: ActorMeta = { actor: 'user', label: 'Price brush' };
const BAR: ActorMeta = { actor: 'user', label: 'Category' };
const CLUSTER: ActorMeta = { actor: 'agent', label: 'Cluster picker' };

export async function mountAnalyst(root: HTMLElement): Promise<void> {
  const rows = await loadRows();

  // ── L5: declare -> connect -> serve ───────────────────────────────────────
  const clusteringModule = clusteringAnalysis({ column: 'price', k: CLUSTER_K, table: 'data', outColumn: 'cluster_id' });
  const def: DashboardDef = {
    meta: { title: 'vizfootprint analyst demo' },
    data: { data: { rows } },
    actors: { scatter: SCATTER, bar: BAR, cluster: CLUSTER },
    analyses: {
      correlation: correlationAnalysis({ x: 'price', y: 'rating' }),
      clustering: clusteringModule,
      regression: regressionAnalysis({ x: 'price', y: 'rating' }),
      groupby: groupByAnalysis({ by: 'category', measure: 'price' }),
    },
    fdr: { procedure: 'LORD++', alpha: ALPHA },
    defaultTable: 'data',
  };
  const dashboard = buildDashboard(def); // declare (offline, no API key)
  const session = dashboard.createSession(); // connect (one live session)
  const agentPort = vizAsTools(session, { as: 'agent' }); // serve (fixed Mode B tools)

  const specBySource = new Map<object, PredicateClause>();
  const src = (viewId: string, meta: ActorMeta) => session.log.registry.register(viewId, meta);

  function causeUser(intent: string): Cause {
    return { requestedBy: 'user', computedBy: 'user', intent };
  }

  function applyTransient(viewId: string, meta: ActorMeta, emission: ChartEmission, spec: PredicateClause | null): void {
    const source = src(viewId, meta);
    const clause = causeClauseFromEmission(emission, { source, cause: causeUser('transient') });
    session.log.selection.update(clause);
    /* v8 ignore next -- `applyTransient` has exactly one call site (the scatter's `onBrushMove`
     * below), which only ever passes a null `spec` when its own `iv` is falsy — but Scatter's
     * `onBrushMove` (common.ts) always calls back with a real, non-empty `toInterval(...)` tuple,
     * never `null`/`undefined`. (Contrast `applyRecord` just below: a real CLICK-to-clear commit
     * — `commitFilter(..., null)` — genuinely lands `value:null`, so ITS `spec === null` arm is
     * reachable and IS exercised by a real test.) */
    if (spec === null) specBySource.delete(source);
    else specBySource.set(source, spec);
    void render();
  }

  /** `record.viewId` is already registered by the dispatch that produced it. */
  function applyRecord(record: CommitRecord | undefined): void {
    /* v8 ignore next -- all three call sites (`commitFilter`/`commitSelect` below, both guarded by
     * `if (result.ok)` before calling this with `result.commit` — always defined on an ok filter/
     * select dispatch — and `callAgentTool`'s `if (record) applyRecord(record)`) already guarantee
     * a defined record before calling in. */
    if (!record) return;
    const source = session.log.registry.require(record.viewId);
    const spec = specFromRecord(record);
    if (spec === null) specBySource.delete(source);
    else specBySource.set(source, spec);
    void render();
  }

  async function commitFilter(viewId: string, field: string, iv: [number, number] | null): Promise<void> {
    const intent = iv ? `brush ${field} ${fmtInterval(iv)}` : `clear ${field}`;
    const result = await session.dispatch({ verb: 'filter', viewId, field, range: iv, cause: causeUser(intent) });
    if (result.ok) applyRecord(result.commit);
  }

  async function commitSelect(viewId: string, field: string, value: unknown, intent: string): Promise<void> {
    const result = await session.dispatch({ verb: 'select', viewId, field, value, cause: causeUser(intent) });
    if (result.ok) applyRecord(result.commit);
  }

  function predicateFor(client: RegisteredSource): (r: DemoRow) => boolean {
    const specs = session.log.selection.clauses
      .filter((c) => !session.log.selection.skip(client, c))
      .map((c) => specBySource.get(c.source as object))
      .filter((s): s is PredicateClause => s !== undefined);
    return (r) => specs.every((s) => matchesClause(r, s));
  }

  // ── charts ───────────────────────────────────────────────────────────────────
  const scatter = new Scatter(rows, {
    brushField: 'price',
    /* v8 ignore next -- Scatter's own `onBrushMove` (common.ts) only ever calls back with a real
     * `[number,number]` tuple from `toInterval(...)`, never null/falsy, so the `: null` arm this
     * ternary offers is unreachable via the wired chart (see the matching note on `applyTransient`
     * just above). */
    onBrushMove: (iv) =>
      applyTransient('scatter', SCATTER, Scatter.brushEmission('price', iv), iv ? { kind: 'interval', field: 'price', value: iv } : null),
    onBrushCommit: (iv) => void commitFilter('scatter', 'price', iv),
  });
  const bar = new BarChart(CATEGORIES, {
    onBarClick: (cat) => void commitSelect('bar', 'category', cat, `select category ${cat}`),
  });

  // ── selection readout + cluster list ─────────────────────────────────────────
  const selReadout = el('div', { class: 'sel-readout' });
  const clusterList = el('div', { class: 'cluster-list' });

  async function render(): Promise<void> {
    const keepBar = predicateFor(src('bar', BAR));
    const counts = new Map<string, number>();
    for (const c of CATEGORIES) counts.set(c, 0);
    for (const r of rows) if (keepBar(r)) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    bar.setCounts(counts);
    scatter.setHighlight(predicateFor(src('scatter', SCATTER)));
    const n = (await session.selectedRows()).length;
    replaceChildren(selReadout, el('span', { text: `current selection: ${n} of ${rows.length} rows` }));
  }

  // ── the ledger (read from the REAL session — never a locally-kept copy) ──────
  const headline = el('div', { class: 'headline', dataset: { headline: '1' } });
  const ledgerBody = el('tbody', {});
  const ledgerHead = el('div', { class: 'ledger-head' });

  function renderLedger(fdr: FdrSummary): void {
    replaceChildren(
      ledgerHead,
      el('span', {
        text: `LORD++  ·  α=${fdr.alpha}  ·  tests=${fdr.tests}  ·  wealth W(t)=${fdr.wealth.toFixed(4)}  ·  discoveries=${fdr.discoveries}`,
      }),
    );
    const rowsOut = fdr.ledger.map((s: FdrStep) =>
      el('tr', { class: s.reject ? 'discovery' : '' }, [
        el('td', { text: String(s.step) }),
        el('td', { text: s.hypothesisId }),
        el('td', { text: s.pValue.toFixed(4) }),
        el('td', { text: s.alphaThreshold.toFixed(5) }),
        el('td', { class: 'verdict', text: s.reject ? 'DISCOVERY' : 'no' }),
      ]),
    );
    replaceChildren(ledgerBody, ...rowsOut);

    const last = fdr.ledger[fdr.ledger.length - 1];
    if (last) {
      let msg: string;
      if (last.reject) {
        msg = `Test #${last.step}: p=${last.pValue.toFixed(4)} — DISCOVERY (p ≤ threshold ${last.alphaThreshold.toFixed(5)}).`;
      } else if (last.pValue <= fdr.alpha) {
        msg = `Test #${last.step}: p=${last.pValue.toFixed(4)} — significant alone, NOT a discovery at your current test count (threshold ${last.alphaThreshold.toFixed(5)}).`;
      } else {
        msg = `Test #${last.step}: p=${last.pValue.toFixed(4)} — not significant (threshold ${last.alphaThreshold.toFixed(5)}).`;
      }
      replaceChildren(headline, el('span', { text: msg }));
    }
  }

  async function refreshLedger(): Promise<void> {
    renderLedger((await session.overview()).fdr);
  }

  // ── result card ──────────────────────────────────────────────────────────────
  const resultCard = el('div', { class: 'result-card', dataset: { result: '1' } });
  function showResult(nodes: (Node | null)[]): void {
    replaceChildren(resultCard, ...nodes);
  }

  /**
   * Run a declared analysis through `session.dispatch` (R4) — the user path.
   *
   * `session.dispatch`'s 'analyze' verb (`doAnalyze`, src/session/session.ts)
   * rejects (`result.ok === false`) ONLY for an undeclared `analysisId`
   * (`!this.hasAnalysis(analysisId)`) — every other outcome, including a
   * DEGENERATE analysis result, still returns `ok:true` with the honest
   * failure carried inside `result.analysis.result`. This file's own five
   * call sites below all pass one of the four ids declared in `mountAnalyst`'s
   * own `def.analyses` (`'correlation' | 'clustering' | 'regression' |
   * 'groupby'`), so `result.ok` is always true here, and `result.analysis` is
   * therefore always the real `AnalysisCommit` `doAnalyze` unconditionally
   * attaches on success — never nullish. Every `if (!commit) return;` guard
   * at this function's call sites shares this same reasoning (cross-referenced
   * there, not re-derived).
   */
  async function runAnalyze(analysisId: string, intent: string, input?: readonly Record<string, unknown>[]): Promise<AnalysisCommit | null> {
    const result = await session.dispatch({
      verb: 'analyze',
      analysisId,
      cause: causeUser(intent),
      ...(input ? { input } : {}),
    });
    /* v8 ignore next 4 -- see this function's own doc comment: `result.ok` is always true for the
     * four hardcoded, always-declared analysis ids this file ever calls `runAnalyze` with. */
    if (!result.ok) {
      showResult([el('div', { class: 'flag', text: `gap: ${result.rejection.detail}` })]);
      return null;
    }
    /* v8 ignore next -- `result.analysis` is unconditionally set by `doAnalyze` whenever
     * `result.ok` (see above) — the `?? null` fallback is unreachable via this file's calls. */
    return result.analysis ?? null;
  }

  // ── declared analyses ────────────────────────────────────────────────────────
  async function declareCorrelation(): Promise<void> {
    const commit = await runAnalyze('correlation', 'declare correlation');
    /* v8 ignore next -- see `runAnalyze`'s doc comment: `commit` is never null for the hardcoded
     * 'correlation' id. */
    if (!commit) return;
    if (!commit.result.ok) {
      showResult([
        el('div', { class: 'analysis-title', text: 'correlation (price × rating)' }),
        el('div', { class: 'flag r14', text: `honest degenerate-fit flag (R14): n=${commit.result.n}, no r computed, no FDR wealth spent` }),
      ]);
    } else {
      // `correlationAnalysis` (src/analysis/builtins.ts) hardcodes `as:'scalar'` on every `ok:true`
      // result — this analysis module can never produce anything else, so the false arm of this
      // (no matching branch) is unreachable regardless of what selection is analyzed.
      /* v8 ignore else */
      if (commit.result.output.as === 'scalar') {
        const r = commit.result.output.value as number;
        const n = (await session.selectedRows()).length;
        showResult([
          el('div', { class: 'analysis-title', text: 'correlation (price × rating)' }),
          el('div', { text: `Pearson r = ${r.toFixed(4)} over ${n} rows` }),
          el('div', { class: 'muted', text: 'kind:test → one row added to the ledger below' }),
        ]);
      }
    }
    await refreshLedger();
  }

  async function declareDegenerate(): Promise<void> {
    // Select 8 points that share one rating value → zero y-variance → NaN r.
    const byRating = new Map<number, DemoRow[]>();
    for (const r of rows) {
      const bucket = byRating.get(r.rating) ?? [];
      bucket.push(r);
      byRating.set(r.rating, bucket);
    }
    const bucket = [...byRating.values()].find((b) => b.length >= 8);
    const eight = (bucket ?? rows).slice(0, 8);
    const ids = new Set(eight.map((r) => r.id));
    scatter.setHighlight((r) => ids.has(r.id)); // visually mark the degenerate 8

    const before = (await session.overview()).fdr.tests;
    const commit = await runAnalyze('correlation', 'degenerate demo (8 collinear points)', eight);
    /* v8 ignore next -- see `runAnalyze`'s doc comment: `commit` is never null for the hardcoded
     * 'correlation' id (an explicit `input` doesn't change which id is dispatched). */
    if (!commit) return;
    const after = (await session.overview()).fdr.tests;
    const degenerate = !commit.result.ok;
    showResult([
      el('div', { class: 'analysis-title', text: 'DEGENERATE demo — 8 collinear points → correlation' }),
      degenerate
        ? el('div', { class: 'flag r14', text: `R14 honest flag: degenerate-fit (n=8, zero variance) — no r, and the ledger did NOT grow (${before} → ${after})` })
        : el('div', { class: 'flag', text: 'unexpected: got a result on a degenerate set' }),
    ]);
    await refreshLedger();
  }

  async function declareClustering(): Promise<void> {
    const commit = await runAnalyze('clustering', `declare clustering (k=${CLUSTER_K})`);
    /* v8 ignore next -- see `runAnalyze`'s doc comment: `commit` is never null for the hardcoded
     * 'clustering' id. */
    if (!commit) return;

    // `AnalysisCommit` reports which COLUMNS materialized, not the computed
    // VALUES — the session doesn't hand the array back to a caller (see the
    // file header). Mirror the SAME deterministic assignment onto this
    // chart's own local `rows` (same input order -> identical cluster_id per
    // row) so the SVG can highlight by cluster; the REAL materialize already
    // landed in the session's own provider above, which is what makes
    // "cluster_id" a real, selectable column for the dispatch below.
    const mirrorRun = await clusteringModule.run(rows);
    /* v8 ignore next -- `clusteringModule.run` (quantileBins, src/analysis/stats.ts) always
     * succeeds and always sets `sharedState['cluster_id']` to an array — the `?? []` fallback
     * (a missing/undefined snapshot or key) is unreachable via this deterministic mirror call. */
    const clusterIds = (mirrorRun.snapshot?.sharedState['cluster_id'] as number[] | undefined) ?? [];
    rows.forEach((r, i) => {
      /* v8 ignore next -- `clusterIds` is produced by mapping the SAME `rows` array one-to-one
       * (quantileBins returns one entry per input value), so `clusterIds[i]` is always defined for
       * every index this `forEach` visits. */
      r['cluster_id'] = clusterIds[i] ?? 0;
    });

    renderClusterList();
    /* v8 ignore next -- `session.ts`'s `declareAnalysis` unconditionally initializes `materialized
     * = []` whenever an analysis's output is `as:'columns'` (clustering's case) before it even
     * starts materializing columns — `commit.materialized` is therefore never undefined here. */
    const materialized = commit.materialized ?? [];
    // Materializing 'cluster_id' can only fail on a row-count mismatch between the values array and
    // the provider's table (memoryProvider.ts's `materializeColumn`) — since `resolveAnalysisInput`
    // for a columns-producing analysis always reads the FULL table from the SAME provider the values
    // were computed against, the counts can never differ here; "rejected" is unreachable via this
    // file's own construction.
    /* v8 ignore next */
    const landedText = materialized.includes('cluster_id') ? 'landed via the L5 session' : 'rejected';
    showResult([
      el('div', { class: 'analysis-title', text: `clustering (price → cluster_id, k=${CLUSTER_K})` }),
      el('div', { text: `materialized column "cluster_id" (${landedText})` }),
      el('div', { class: 'muted', text: 'kind:transform → no ledger row; filter by cluster below (ordinary predicate path)' }),
    ]);
  }

  function renderClusterList(): void {
    const chips: Node[] = [];
    chips.push(el('span', { class: 'cluster-label', text: 'filter by cluster:' }));
    for (let i = 0; i < CLUSTER_K; i++) {
      const chip = el('button', { class: 'cluster-chip', text: `cluster ${i}`, dataset: { cluster: String(i) } });
      /* v8 ignore next -- `CLUSTER_COLORS` has exactly `CLUSTER_K` (4) entries, matching this loop's
       * own bound — `CLUSTER_COLORS[i]` is always defined for every `i` this loop visits. */
      chip.style.borderColor = CLUSTER_COLORS[i] ?? '#888';
      chip.addEventListener('click', () => {
        void selectCluster(i);
      });
      chips.push(chip);
    }
    replaceChildren(clusterList, ...chips);
  }

  async function selectCluster(i: number): Promise<void> {
    // The ordinary predicate path — a point clause on the materialized column.
    await commitSelect('cluster', 'cluster_id', i, `select cluster ${i}`);
    const n = (await session.selectedRows()).length;
    showResult([
      el('div', { class: 'analysis-title', text: `cluster ${i} selected (ordinary predicate path)` }),
      el('div', { text: `session selection: ${n} rows` }),
    ]);
  }

  async function declareRegression(): Promise<void> {
    const commit = await runAnalyze('regression', 'declare regression');
    /* v8 ignore next -- see `runAnalyze`'s doc comment: `commit` is never null for the hardcoded
     * 'regression' id. */
    if (!commit) return;
    if (!commit.result.ok) {
      scatter.setRegressionLine(null);
      showResult([
        el('div', { class: 'analysis-title', text: 'regression (price → rating)' }),
        el('div', { class: 'flag r14', text: `R14 honesty floor: only ${commit.result.n} points (< 10) — no line fit` }),
      ]);
      return;
    }
    /* v8 ignore next -- `regressionAnalysis` (src/analysis/builtins.ts) hardcodes `as:'geometry'`
     * on every `ok:true` result — unreachable via this analysis module's own contract. */
    if (commit.result.output.as !== 'geometry') return;
    const g = commit.result.output.features;
    scatter.setRegressionLine(g);
    showResult([
      el('div', { class: 'analysis-title', text: 'regression (price → rating)' }),
      el('div', { text: `slope=${g.slope.toFixed(4)}  intercept=${g.intercept.toFixed(3)}  (drawn as an SVG overlay — selects no rows)` }),
      el('div', { class: 'muted', text: 'kind:transform → geometry channel, no ledger row' }),
    ]);
  }

  async function declareGroupBy(): Promise<void> {
    const commit = await runAnalyze('groupby', 'declare group-by');
    /* v8 ignore next -- all three disjuncts are unreachable via this file's own call site: `commit`
     * is never null for the hardcoded 'groupby' id (see `runAnalyze`'s doc comment); `groupByAnalysis`
     * (src/analysis/builtins.ts) has no honesty precheck and always returns `ok:true`; and it
     * hardcodes `as:'table'` on that result. */
    if (!commit || !commit.result.ok || commit.result.output.as !== 'table') return;
    const out = commit.result.output;
    const table = el('table', { class: 'gb-table' });
    const thead = el('thead', {}, [el('tr', {}, Object.keys(out.schema).map((k) => el('th', { text: k })))]);
    const body = el(
      'tbody',
      {},
      out.rows.map((r) =>
        el(
          'tr',
          {},
          Object.keys(out.schema).map((k) => {
            const v = r[k];
            return el('td', { text: typeof v === 'number' ? v.toFixed(2) : String(v) });
          }),
        ),
      ),
    );
    table.append(thead, body);
    showResult([
      el('div', { class: 'analysis-title', text: 'group-by (category → mean price)' }),
      table,
      el('div', { class: 'muted', text: 'kind:transform → table channel, no ledger row' }),
    ]);
  }

  function declareBtn(id: string, label: string, run: () => Promise<void>): HTMLButtonElement {
    const b = el('button', { class: 'btn declare', text: label, dataset: { declare: id } });
    b.addEventListener('click', () => {
      b.disabled = true;
      void run().finally(() => {
        b.disabled = false;
      });
    });
    return b;
  }

  // ── the agent panel — driven ONLY through vizAsTools (Mode B) ────────────────
  const activityStrip = el('div', { class: 'activity' });
  const gapsPanel = el('div', { class: 'gaps' });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /** A compact `key=value` rendering, truncating long strings — not a raw JSON dump. */
  function summarizeValue(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(summarizeValue).join(',')}]`;
    if (typeof v === 'string') return v.length > 32 ? `"${v.slice(0, 29)}…"` : `"${v}"`;
    /* v8 ignore next -- the fixed args `runAgentTask`/`runAgentGapDemo` below ever pass through
     * here (a price range, a cluster index, a discount value) are all integers — this file never
     * constructs a non-integer numeric arg, so the `.toFixed(4)` arm is unreachable via its calls. */
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
    /* v8 ignore next -- every value this file ever pipes through `summarizeValue` (tool call args
     * in `runAgentTask`/`runAgentGapDemo`, and a landed commit's `.value` in `summarizeResult`
     * below) is a string, a number, or an array of those — this file never dispatches a boolean/
     * null/object value, so the generic `String(v)` catch-all is unreachable via its calls. */
    return String(v);
  }

  function summarizeArgs(args: Record<string, unknown>): string {
    const parts = Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${summarizeValue(v)}`);
    return parts.length ? parts.join(' ') : '(no args)';
  }

  /** A hand-picked, human-scannable digest of a tool result — never the raw payload. */
  function summarizeResult(result: VizToolResult): string {
    const r = result as Record<string, unknown>;
    if (r['ok'] === false) {
      const gap = r['gap'] as { code?: string; detail?: string } | undefined;
      // This file's own scripted tool calls (`runAgentTask`/`runAgentGapDemo` below) only ever use
      // a known tool name with well-formed, hardcoded args, so the only `ok:false` shape vizAsTools
      // can ever hand back here is a real dispatch rejection — which `projectDispatch` (src/agent/
      // vizAsTools.ts) always attaches as `gap`. The PAYLOAD_INVALID/UNKNOWN_TOOL `reason`-only
      // shape (malformed args, an unrecognized tool name) never occurs via this file's calls.
      /* v8 ignore next -- see above: `gap` is always present on an `ok:false` result here. */
      if (gap) return `ok=false gap=${gap.code} (${gap.detail})`;
      // Unreachable dead code once `gap` is always present (see above).
      /* v8 ignore next */
      const reason = r['reason'];
      /* v8 ignore next */
      const reasonSuffix = reason ? ` reason=${String(reason)}` : '';
      return `ok=false${reasonSuffix}`;
    }
    if ('views' in r && 'activeSelections' in r) {
      const fdr = r['fdr'] as { tests?: number } | undefined;
      /* v8 ignore next -- `session.overview()` always returns a real `fdr` object with a numeric
       * `tests` count (0 before any test runs) — never undefined — so the `?? 0` fallback is
       * unreachable via a real `viz.whats_here` result. */
      return `views=${(r['views'] as unknown[]).length} selections=${(r['activeSelections'] as unknown[]).length} analyses=${(r['analyses'] as unknown[]).length} tests=${fdr?.tests ?? 0} gaps=${String(r['gaps'])}`;
    }
    // This file only ever calls `viz.whats_here` (caught above), `viz.dispatch`, and
    // `viz.declare_analysis` — the latter two always project a `verb` field on success
    // (`projectDispatch`, src/agent/vizAsTools.ts), so `'verb' in r` is always true by the time
    // a successful result reaches here; the final `return 'ok=true'` fallback below it (reached
    // only for a tool this file never calls, e.g. `viz.why`/`viz.fork`/`viz.bookmark`) is
    // unreachable via this file's own three-tool usage.
    /* v8 ignore next -- see the comment just above: always true via this file's own calls. */
    if ('verb' in r) {
      const bits: string[] = [`verb=${String(r['verb'])}`];
      const commit = r['commit'] as { id?: string; field?: string; value?: unknown } | undefined;
      if (commit) bits.push(`commit=#${commit.id} ${commit.field}=${summarizeValue(commit.value)}`);
      const analysis = r['analysis'] as
        | { analysisId?: string; kind?: string; materialized?: string[]; fdrStep?: { pValue?: number; reject?: boolean } }
        | undefined;
      if (analysis) {
        bits.push(`analysis=${analysis.analysisId} kind=${analysis.kind}`);
        if (analysis.materialized?.length) bits.push(`materialized=[${analysis.materialized.join(',')}]`);
        if (analysis.fdrStep) bits.push(`p=${analysis.fdrStep.pValue?.toFixed(4)} discovery=${String(analysis.fdrStep.reject)}`);
      }
      return bits.join(' ');
    }
    /* v8 ignore next -- unreachable: see the comment above `if ('verb' in r)`. */
    return 'ok=true';
  }

  function addActivityStep(tool: string, args: Record<string, unknown>, result: VizToolResult): void {
    activityStrip.appendChild(
      el('div', { class: 'activity-step', dataset: { step: String(activityStrip.children.length) } }, [
        el('span', { class: 'tool', text: tool }),
        el('span', { class: 'args', text: summarizeArgs(args) }),
        el('span', { class: 'result', text: summarizeResult(result) }),
      ]),
    );
  }

  function renderGaps(): void {
    const gapRows: readonly GapRow[] = session.gaps();
    replaceChildren(
      gapsPanel,
      el('div', { class: 'panel-head', text: `Gaps — unmet requests (${gapRows.length})` }),
      ...(gapRows.length === 0
        ? [el('div', { class: 'muted', text: 'no gaps filed' })]
        : gapRows.map((g) =>
            el('div', { class: 'gap-row', dataset: { gap: g.code } }, [
              el('span', { class: 'gap-code', text: g.code }),
              el('span', { class: 'gap-op', text: g.op }),
              el('span', { class: 'gap-detail', text: g.detail }),
            ]),
          )),
    );
  }

  /** Call ONE tool through the fixed Mode-B port, log it to the activity strip, apply its commit. */
  async function callAgentTool(tool: string, args: Record<string, unknown>): Promise<VizToolResult> {
    const result = await agentPort.call(tool, args);
    addActivityStep(tool, args, result);
    const record = (result as { commit?: CommitRecord }).commit;
    if (record) applyRecord(record);
    else void render();
    return result;
  }

  let agentRunning = false;

  /**
   * The scripted (NO LLM) agent task — L5's own R4 acceptance shape:
   * filter -> cluster -> filter-by-cluster -> declare correlation -> read
   * ledger. Every step rides the fixed six-tool Mode-B surface; the activity
   * strip renders one row per call as it happens.
   */
  async function runAgentTask(): Promise<void> {
    if (agentRunning) return;
    agentRunning = true;
    runAgentBtn.disabled = true;
    replaceChildren(activityStrip);
    try {
      await callAgentTool('viz.whats_here', {});
      await sleep(120);

      await callAgentTool('viz.dispatch', {
        verb: 'filter',
        viewId: 'scatter',
        field: 'price',
        range: [60, 130],
        intent: 'focus mid prices',
      });
      await sleep(120);

      await callAgentTool('viz.declare_analysis', { analysisId: 'clustering' });
      await syncClusterMirror();
      renderClusterList();
      await refreshLedger();
      await sleep(120);

      await callAgentTool('viz.dispatch', {
        verb: 'select',
        viewId: 'cluster',
        field: 'cluster_id',
        value: 2,
        intent: 'filter to cluster 2',
      });
      await sleep(120);

      await callAgentTool('viz.declare_analysis', { analysisId: 'correlation' });
      await refreshLedger();
      await sleep(120);

      await callAgentTool('viz.whats_here', {});
      renderGaps();
    } finally {
      agentRunning = false;
      runAgentBtn.disabled = false;
    }
  }

  /** Same session-free mirror trick as `declareClustering` — see the file header. */
  async function syncClusterMirror(): Promise<void> {
    const mirrorRun = await clusteringModule.run(rows);
    /* v8 ignore next -- same reasoning as `declareClustering`'s identical line above: quantileBins
     * always succeeds and always sets `sharedState['cluster_id']`. */
    const clusterIds = (mirrorRun.snapshot?.sharedState['cluster_id'] as number[] | undefined) ?? [];
    rows.forEach((r, i) => {
      /* v8 ignore next -- same reasoning as `declareClustering`'s identical line above: `clusterIds`
       * is one-to-one with the SAME `rows` array this `forEach` walks. */
      r['cluster_id'] = clusterIds[i] ?? 0;
    });
  }

  /** A deliberate gap: the agent asks to select on a column that was never declared (R14). */
  async function runAgentGapDemo(): Promise<void> {
    await callAgentTool('viz.dispatch', {
      verb: 'select',
      viewId: 'scatter',
      field: 'discount_pct',
      value: 10,
      intent: 'agent asks for a column that does not exist',
    });
    renderGaps();
  }

  const runAgentBtn = actionButton('run-agent-task', 'Run agent task', () => void runAgentTask());
  const agentPanel = el('div', { class: 'analyses agent-panel' }, [
    el('div', { class: 'panel-head', text: 'Agent — driven through the real viz.dispatch / viz.declare_analysis / viz.whats_here tools' }),
    el('div', { class: 'toolbar' }, [runAgentBtn, actionButton('agent-gap', "Agent asks for a column that doesn't exist", () => void runAgentGapDemo())]),
    activityStrip,
  ]);

  // ── layout ───────────────────────────────────────────────────────────────────
  const panel = el('div', { class: 'analyses' }, [
    el('div', { class: 'panel-head', text: 'Analyses — Declare to run (only tests touch the ledger)' }),
    declareBtn('correlation', 'Declare correlation (test)', declareCorrelation),
    declareBtn('clustering', 'Declare clustering', declareClustering),
    declareBtn('regression', 'Declare regression', declareRegression),
    declareBtn('groupby', 'Declare group-by', declareGroupBy),
    declareBtn('degenerate', 'Degenerate: 8 collinear → correlation', declareDegenerate),
  ]);

  const ledgerTable = el('table', { class: 'ledger' });
  ledgerTable.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: '#' }),
        el('th', { text: 'hypothesis' }),
        el('th', { text: 'p-value' }),
        el('th', { text: 'threshold αt' }),
        el('th', { text: 'discovery?' }),
      ]),
    ]),
    ledgerBody,
  );

  replaceChildren(
    root,
    selReadout,
    el('div', { class: 'grid' }, [
      el('div', { class: 'left' }, [
        el('figure', { class: 'chartbox' }, [scatter.root, el('figcaption', { text: 'Scatter — brush price; regression overlay draws here' })]),
        el('figure', { class: 'chartbox' }, [bar.root, el('figcaption', { text: 'Bar — click a category to filter' })]),
        clusterList,
      ]),
      el('div', { class: 'right' }, [
        panel,
        resultCard,
        el('div', { class: 'strip-head', text: 'The ledger — online FDR (LORD++). Brushing never adds a row; only tests do.' }),
        ledgerHead,
        ledgerTable,
        headline,
      ]),
    ]),
    el('div', { class: 'agent-section' }, [agentPanel, gapsPanel]),
  );

  void render();
  await refreshLedger();
  renderGaps();

  (window as unknown as { __viz?: unknown }).__viz = {
    ledgerLength: () => session.ledger().length,
    declareCorrelation,
    declareDegenerate,
    runAgentTask,
    runAgentGapDemo,
    gaps: () => session.gaps(),
  };
}

void mountAnalyst(document.getElementById('app') as HTMLElement);
