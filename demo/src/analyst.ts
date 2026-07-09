/**
 * URL 2 — /analyst: the declared-analysis + online-FDR story.
 *
 * The SAME data + charts as the dashboard, plus an Analyses panel wired to the
 * four landed built-ins (src/analysis) and a live LORD++ ledger (src/fdr):
 *   - correlation (kind:'test')      → a scalar r; its p-value STEPS the real
 *     createLordPlusPlus stepper — one honest ledger row.
 *   - clustering (kind:'transform')  → materializes cluster_id via src/data's
 *     memoryProvider.materializeColumn (R11's landing spot), then re-enters as
 *     an ORDINARY point predicate (a cluster click-list).
 *   - regression (kind:'transform')  → an OLS line drawn as an SVG overlay
 *     (geometry channel; selects no rows). Honesty floor: < 10 points → R14.
 *   - group-by (kind:'transform')    → a small summary table.
 *
 * Invariants shown live:
 *   R6  — brushing NEVER adds a ledger row; only a Declare button does.
 *   R14 — the degenerate button (8 collinear points → correlation) surfaces the
 *         honest degenerate-fit flag instead of a fabricated r, and spends NO
 *         FDR wealth (no ledger row).
 * Two-string discipline: all runtime text via textContent / text nodes.
 */

import {
  BarChart,
  CATEGORIES,
  Scatter,
  categoryColor,
  el,
  fmtInterval,
  loadRows,
  replaceChildren,
  type DemoRow,
} from './common.js';
import { CauseSelectionSession } from '../../src/log/index.js';
import { causeClauseFromEmission } from '../../src/mosaic/index.js';
import type { ChartEmission, RegisteredSource } from '../../src/mosaic/index.js';
import { matchesClause } from '../../src/data/predicate.js';
import type { PredicateClause } from '../../src/data/types.js';
import { memoryProvider } from '../../src/data/memoryProvider.js';
import {
  correlationAnalysis,
  clusteringAnalysis,
  regressionAnalysis,
  groupByAnalysis,
} from '../../src/analysis/index.js';
import { createLordPlusPlus, type FdrStep, type HypothesisRecord } from '../../src/fdr/index.js';

const ALPHA = 0.05;
const CLUSTER_K = 4;
const CLUSTER_COLORS = ['#4c8dff', '#f5a623', '#00b3a4', '#ff5c9d'];

export async function mountAnalyst(root: HTMLElement): Promise<void> {
  const rows = await loadRows();
  const provider = memoryProvider(rows); // src/data memory engine (R11 landing spot)

  const session = new CauseSelectionSession();
  let specBySource = new Map<object, PredicateClause>();

  // ── the REAL online-FDR stepper (persists across every declared test) ────────
  const stepper = createLordPlusPlus({ alpha: ALPHA });
  const ledger: FdrStep[] = [];
  let lastStep: FdrStep | null = null;
  let testClock = 0;

  const src = (viewId: string, actor: 'user' | 'agent' | 'system') =>
    session.registry.register(viewId, { actor });

  function applyEmission(viewId: string, emission: ChartEmission, spec: PredicateClause | null): void {
    const source = src(viewId, 'user');
    const clause = causeClauseFromEmission(emission, {
      source,
      cause: { requestedBy: 'user', computedBy: 'user', intent: 'select' },
    });
    session.selection.update(clause);
    if (spec === null) specBySource.delete(source);
    else specBySource.set(source, spec);
    render();
  }

  function predicateFor(client: RegisteredSource): (r: DemoRow) => boolean {
    const specs = session.selection.clauses
      .filter((c) => !session.selection.skip(client, c))
      .map((c) => specBySource.get(c.source as object))
      .filter((s): s is PredicateClause => s !== undefined);
    return (r) => specs.every((s) => matchesClause(r, s));
  }

  /** Rows under the FULL selection (no self-exclusion) — the analysis input. */
  function selectedRows(): DemoRow[] {
    const specs = session.selection.clauses
      .map((c) => specBySource.get(c.source as object))
      .filter((s): s is PredicateClause => s !== undefined);
    if (specs.length === 0) return rows;
    return rows.filter((r) => specs.every((s) => matchesClause(r, s)));
  }

  // ── charts ───────────────────────────────────────────────────────────────────
  const scatter = new Scatter(rows, {
    brushField: 'price',
    onBrushMove: (iv) =>
      applyEmission('scatter', Scatter.brushEmission('price', iv), iv ? { kind: 'interval', field: 'price', value: iv } : null),
    onBrushCommit: (iv) =>
      applyEmission('scatter', Scatter.brushEmission('price', iv), iv ? { kind: 'interval', field: 'price', value: iv } : null),
  });
  const bar = new BarChart(CATEGORIES, {
    onBarClick: (cat) =>
      applyEmission('bar', { rawValue: cat, encoding: { kind: 'point', field: 'category' } }, { kind: 'point', field: 'category', value: cat }),
  });

  // ── selection readout + cluster list ─────────────────────────────────────────
  const selReadout = el('div', { class: 'sel-readout' });
  const clusterList = el('div', { class: 'cluster-list' });

  function render(): void {
    const keepBar = predicateFor(src('bar', 'user'));
    const counts = new Map<string, number>();
    for (const c of CATEGORIES) counts.set(c, 0);
    for (const r of rows) if (keepBar(r)) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    bar.setCounts(counts);
    scatter.setHighlight(predicateFor(src('scatter', 'user')));
    const n = selectedRows().length;
    replaceChildren(selReadout, el('span', { text: `current selection: ${n} of ${rows.length} rows` }));
  }

  // ── the ledger ───────────────────────────────────────────────────────────────
  const headline = el('div', { class: 'headline', dataset: { headline: '1' } });
  const ledgerBody = el('tbody', {});
  const ledgerHead = el('div', { class: 'ledger-head' });

  function renderLedger(): void {
    replaceChildren(
      ledgerHead,
      el('span', { text: `LORD++  ·  α=${ALPHA}  ·  tests=${stepper.state.t}  ·  wealth W(t)=${stepper.state.wealth.toFixed(4)}  ·  discoveries=${stepper.state.rejectionTimes.length}` }),
    );
    const rowsOut = ledger.map((s) =>
      el('tr', { class: s.reject ? 'discovery' : '' }, [
        el('td', { text: String(s.step) }),
        el('td', { text: s.hypothesisId }),
        el('td', { text: s.pValue.toFixed(4) }),
        el('td', { text: s.alphaThreshold.toFixed(5) }),
        el('td', { class: 'verdict', text: s.reject ? 'DISCOVERY' : 'no' }),
      ]),
    );
    replaceChildren(ledgerBody, ...rowsOut);

    if (lastStep) {
      const s = lastStep;
      let msg: string;
      if (s.reject) {
        msg = `Test #${s.step}: p=${s.pValue.toFixed(4)} — DISCOVERY (p ≤ threshold ${s.alphaThreshold.toFixed(5)}).`;
      } else if (s.pValue <= ALPHA) {
        msg = `Test #${s.step}: p=${s.pValue.toFixed(4)} — significant alone, NOT a discovery at your current test count (threshold ${s.alphaThreshold.toFixed(5)}).`;
      } else {
        msg = `Test #${s.step}: p=${s.pValue.toFixed(4)} — not significant (threshold ${s.alphaThreshold.toFixed(5)}).`;
      }
      replaceChildren(headline, el('span', { text: msg }));
    }
  }

  // ── result card ──────────────────────────────────────────────────────────────
  const resultCard = el('div', { class: 'result-card', dataset: { result: '1' } });
  function showResult(nodes: (Node | null)[]): void {
    replaceChildren(resultCard, ...nodes);
  }

  // ── declared analyses ────────────────────────────────────────────────────────
  async function declareCorrelation(): Promise<void> {
    const input = selectedRows();
    const mod = correlationAnalysis({ x: 'price', y: 'rating' });
    const run = await mod.run(input, {
      timestamp: ++testClock,
      sink: (h: HypothesisRecord) => {
        const step = stepper.step(h); // the REAL LORD++ stepper
        ledger.push(step);
        lastStep = step;
      },
    });
    if (!run.result.ok) {
      showResult([
        el('div', { class: 'analysis-title', text: 'correlation (price × rating)' }),
        el('div', { class: 'flag r14', text: `honest degenerate-fit flag (R14): n=${run.result.n}, no r computed, no FDR wealth spent` }),
      ]);
    } else {
      const r = run.result.output.value as number;
      showResult([
        el('div', { class: 'analysis-title', text: 'correlation (price × rating)' }),
        el('div', { text: `Pearson r = ${r.toFixed(4)} over ${input.length} rows` }),
        el('div', { class: 'muted', text: 'kind:test → one row added to the ledger below' }),
      ]);
    }
    renderLedger();
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

    const before = ledger.length;
    const mod = correlationAnalysis({ x: 'price', y: 'rating' });
    const run = await mod.run(eight, {
      timestamp: ++testClock,
      sink: (h) => {
        const step = stepper.step(h);
        ledger.push(step);
        lastStep = step;
      },
    });
    const degenerate = !run.result.ok;
    showResult([
      el('div', { class: 'analysis-title', text: 'DEGENERATE demo — 8 collinear points → correlation' }),
      degenerate
        ? el('div', { class: 'flag r14', text: `R14 honest flag: degenerate-fit (n=8, zero variance) — no r, and the ledger did NOT grow (${before} → ${ledger.length})` })
        : el('div', { class: 'flag', text: 'unexpected: got a result on a degenerate set' }),
    ]);
    renderLedger();
  }

  async function declareClustering(): Promise<void> {
    const mod = clusteringAnalysis({ column: 'price', k: CLUSTER_K });
    const run = await mod.run(rows); // over ALL rows so cluster_id aligns to the table
    const clusterIds = (run.snapshot?.sharedState['cluster_id'] as number[] | undefined) ?? [];
    rows.forEach((r, i) => {
      r['cluster_id'] = clusterIds[i] ?? 0;
    });
    // R11 landing spot: land the computed column into the memory engine.
    const landed = await provider.materializeColumn('data', 'cluster_id', clusterIds);
    renderClusterList();
    showResult([
      el('div', { class: 'analysis-title', text: `clustering (price → cluster_id, k=${CLUSTER_K})` }),
      el('div', { text: `materialized column "cluster_id" (${'ok' in landed && landed.ok ? 'landed in memory engine' : 'rejected'})` }),
      el('div', { class: 'muted', text: 'kind:transform → no ledger row; filter by cluster below (ordinary predicate path)' }),
    ]);
  }

  function renderClusterList(): void {
    const chips: Node[] = [];
    chips.push(el('span', { class: 'cluster-label', text: 'filter by cluster:' }));
    for (let i = 0; i < CLUSTER_K; i++) {
      const chip = el('button', { class: 'cluster-chip', text: `cluster ${i}`, dataset: { cluster: String(i) } });
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
    applyEmission('cluster', { rawValue: i, encoding: { kind: 'point', field: 'cluster_id' } }, { kind: 'point', field: 'cluster_id', value: i });
    // Honest count straight from the memory engine's evaluate() surface.
    const res = await provider.evaluate('data', { kind: 'point', field: 'cluster_id', value: i }, { mode: 'count' });
    const count = 'count' in res ? res.count : 0;
    showResult([
      el('div', { class: 'analysis-title', text: `cluster ${i} selected (ordinary predicate path)` }),
      el('div', { text: `memory engine count: ${count} rows` }),
      el('div', { class: 'muted', text: `resolved SQL: ${'sql' in res ? res.sql : '—'}` }),
    ]);
  }

  async function declareRegression(): Promise<void> {
    const input = selectedRows();
    const mod = regressionAnalysis({ x: 'price', y: 'rating' });
    const run = await mod.run(input);
    if (!run.result.ok) {
      scatter.setRegressionLine(null);
      showResult([
        el('div', { class: 'analysis-title', text: 'regression (price → rating)' }),
        el('div', { class: 'flag r14', text: `R14 honesty floor: only ${run.result.n} points (< 10) — no line fit` }),
      ]);
      return;
    }
    const g = run.result.output.features;
    scatter.setRegressionLine(g);
    showResult([
      el('div', { class: 'analysis-title', text: 'regression (price → rating)' }),
      el('div', { text: `slope=${g.slope.toFixed(4)}  intercept=${g.intercept.toFixed(3)}  (drawn as an SVG overlay — selects no rows)` }),
      el('div', { class: 'muted', text: 'kind:transform → geometry channel, no ledger row' }),
    ]);
  }

  async function declareGroupBy(): Promise<void> {
    const input = selectedRows();
    const mod = groupByAnalysis({ by: 'category', measure: 'price' });
    const run = await mod.run(input);
    if (!run.result.ok) return;
    const out = run.result.output;
    const table = el('table', { class: 'gb-table' });
    const thead = el('thead', {}, [
      el('tr', {}, Object.keys(out.schema).map((k) => el('th', { text: k }))),
    ]);
    const body = el('tbody', {}, out.rows.map((r) =>
      el('tr', {}, Object.keys(out.schema).map((k) => {
        const v = r[k];
        return el('td', { text: typeof v === 'number' ? v.toFixed(2) : String(v) });
      })),
    ));
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
  );

  render();
  renderLedger();

  (window as unknown as { __viz?: unknown }).__viz = {
    ledgerLength: () => ledger.length,
    declareCorrelation,
    declareDegenerate,
  };
}

void mountAnalyst(document.getElementById('app') as HTMLElement);
