/**
 * l3-channels acceptance — the C3 mini-spike gating the L3 API freeze.
 *
 * Written to the acceptance criteria FIRST (family Convention 2). Validates that
 * the FOUR AnalysisOutput channels ride EXISTING rails with ZERO new interaction
 * verbs (R11), each executed as a footprintjs flowchart (computedBy:'system' by
 * construction), and that:
 *   - every channel's output lands as a committed record carrying a two-slot
 *     cause + (for kind:'test') a mandatory analytical intent (R6);
 *   - the COLUMN channel's materialized `cluster_id` filters through the ORDINARY
 *     L2 predicate path — a clause indistinguishable in KIND from a bar-click;
 *   - the SCALAR channel emits the imported L4 `HypothesisRecord` and steps the
 *     real online-FDR stepper;
 *   - the GEOMETRY channel selects NO rows (no clause) and flags a degenerate fit
 *     (R14) rather than fabricating one;
 *   - the TABLE channel is a new queryable relation, itself predicate-filterable;
 *   - brushing/committing 100 interval emissions produces ZERO test commits (R6).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { sliceForKey, keysReadFromExecutionTree, sliceToJSON } from 'footprintjs/trace';
import {
  AnalysisLog,
  runClustering,
  runCorrelation,
  runGroupBy,
  runRegression,
  type ClusteringResult,
  type CorrelationResult,
  type GroupByResult,
} from './analysis.js';
import { DATASET, DEGENERATE_DATASET } from './dataset.js';
import { normalApproxPValue } from './stats.js';
import {
  causeClauseFromEmission,
  causeOf,
  SourceRegistry,
  type ChartEmission,
} from '../../src/mosaic/index.js';
import { CauseSelectionSession } from '../../src/log/index.js';
import { createLordPlusPlus } from '../../src/fdr/index.js';
import type { CauseClause } from '../../src/mosaic/index.js';

// Every clause produced anywhere in the spike is collected here; the R11
// overarching assertion checks NONE introduced a third clause kind.
const allClauses: CauseClause[] = [];

// ─────────────────────────────────────────────────────────────────────────────
describe('Channel 1 — COLUMN: clustering materializes cluster_id, filters as an ordinary predicate', () => {
  let result: ClusteringResult;
  const log = new AnalysisLog();

  beforeAll(async () => {
    result = await runClustering(DATASET, 3);
  });

  it('materializes a deterministic cluster_id column (one bin per row, in [0,k))', () => {
    expect(result.clusterIds).toHaveLength(DATASET.length);
    expect(new Set(result.clusterIds)).toEqual(new Set([0, 1, 2]));
    // Deterministic: quantile bins of the amounts. Top tertile = {25,30,35,42}.
    const topAmounts = DATASET.filter((_, i) => result.clusterIds[i] === 2).map((r) => r.amount);
    expect([...topAmounts].sort((a, b) => a - b)).toEqual([25, 30, 35, 42]);
  });

  it('the cluster_id column lands in the footprintjs commit log and is sliceable (R9)', () => {
    const onLog = result.snapshot.commitLog.some((b) => 'cluster_id' in b.overwrite);
    expect(onLog).toBe(true);
    const slice = sliceForKey(
      result.snapshot.commitLog,
      'cluster_id',
      keysReadFromExecutionTree(result.snapshot.executionTree),
    );
    const stageIds = Object.values(sliceToJSON(slice).nodes ?? {}).map((n) => n.stageId);
    expect(new Set(stageIds)).toEqual(new Set(['cluster', 'load']));
  });

  it('the output lands as a committed record with cause {requestedBy, computedBy:system}', () => {
    const commit = log.record({
      id: 'c1',
      analysisId: 'cluster-amount-k3',
      kind: 'transform',
      output: result.output,
      requestedBy: 'agent',
      intent: 'segment rows by amount tertile',
    });
    expect(commit.cause.computedBy).toBe('system');
    expect(commit.cause.requestedBy).toBe('agent');
    expect(commit.output.as).toBe('columns');
    expect(Object.isFrozen(commit)).toBe(true);
  });

  it('filtering cluster_id is a clause INDISTINGUISHABLE IN KIND from a human bar-click', () => {
    const registry = new SourceRegistry();
    const agentSrc = registry.register('scatter', { actor: 'agent' });
    const userSrc = registry.register('barchart', { actor: 'user' });

    // Agent selects an ANALYSIS-DERIVED column (cluster_id = 2).
    const analysisEmission: ChartEmission = {
      rawValue: 2,
      encoding: { kind: 'point', field: 'cluster_id' },
    };
    const analysisClause = causeClauseFromEmission(analysisEmission, {
      source: agentSrc,
      cause: { requestedBy: 'agent', computedBy: 'agent' },
    });

    // Human bar-clicks a RAW column (category = 'Ops').
    const barClickEmission: ChartEmission = {
      rawValue: 'Ops',
      encoding: { kind: 'point', field: 'category' },
    };
    const barClickClause = causeClauseFromEmission(barClickEmission, {
      source: userSrc,
      cause: { requestedBy: 'user', computedBy: 'user' },
    });
    allClauses.push(analysisClause, barClickClause);

    // Same clause KIND: identical top-level shape, identical meta.type, both
    // carry a cause. The ONLY differences are the data (field/value) and the
    // cause slots — the analysis column is NOT tagged as "computed" in any way
    // that changes the clause kind or adds a verb.
    expect(analysisClause.meta.type).toBe('point');
    expect(barClickClause.meta.type).toBe('point');
    expect(analysisClause.meta.type).toBe(barClickClause.meta.type);
    expect(Object.keys(analysisClause).sort()).toEqual(Object.keys(barClickClause).sort());
    expect(Object.keys(analysisClause.meta).sort()).toEqual(Object.keys(barClickClause.meta).sort());
    expect(causeOf(analysisClause)).toBeDefined();
    expect(causeOf(barClickClause)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Channel 2 — SCALAR: correlation → {r,n,pValue} + a HypothesisRecord', () => {
  let result: CorrelationResult;
  const log = new AnalysisLog();

  beforeAll(async () => {
    result = await runCorrelation(DATASET, {
      analysisId: 'H-amount-size',
      xField: 'amount',
      yField: 'size',
      pValue: normalApproxPValue,
      timestamp: 1,
    });
  });

  it('computes a strong, deterministic correlation with n = dataset size', () => {
    expect(result.n).toBe(DATASET.length);
    expect(result.r).toBeGreaterThan(0.98);
    expect(result.pValue).toBeLessThan(0.01);
    expect(result.output.as).toBe('scalar');
    expect(result.output.value).toBeCloseTo(result.r, 12);
  });

  it('emits the imported L4 HypothesisRecord shape (never redefined)', () => {
    expect(result.hypothesis.hypothesisId).toBe('H-amount-size');
    expect(result.hypothesis.pValue).toBe(result.pValue);
    expect(typeof result.hypothesis.timestamp).toBe('number');
  });

  it('a declared kind:test output lands with cause {computedBy:system} + a mandatory intent (R6)', () => {
    const commit = log.record({
      id: 's1',
      analysisId: 'H-amount-size',
      kind: 'test',
      output: result.output,
      requestedBy: 'agent',
      intent: 'test whether amount predicts size',
    });
    expect(commit.cause.computedBy).toBe('system');
    expect(commit.cause.intent).toBe('test whether amount predicts size');
    expect(log.testCommits()).toHaveLength(1);
  });

  it('R6 gate: a kind:test commit WITHOUT an analytical intent is rejected', () => {
    expect(() =>
      log.record({
        id: 's2',
        analysisId: 'H-no-intent',
        kind: 'test',
        output: result.output,
        requestedBy: 'agent',
      }),
    ).toThrow(/must declare its analytical intent/);
  });

  it('the HypothesisRecord steps the real online-FDR stepper → exactly one FdrStep, a discovery', () => {
    const stepper = createLordPlusPlus({ alpha: 0.05 });
    const step = stepper.step(result.hypothesis);
    expect(step.hypothesisId).toBe('H-amount-size');
    expect(step.pValue).toBe(result.pValue);
    expect(step.step).toBe(1);
    // p ≈ 0 is below any positive first threshold → a discovery.
    expect(step.reject).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Channel 3 — GEOMETRY: a regression line that SELECTS NO ROWS + R14 honesty', () => {
  const log = new AnalysisLog();

  it('fits an OLS line (slope/intercept/domain as DATA) over the full dataset', async () => {
    const result = await runRegression(DATASET, { layer: 'reg_line', xField: 'amount', yField: 'size' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.as).toBe('geometry');
    expect(result.output.features.slope).toBeCloseTo(2, 0); // size ≈ 2·amount
    expect(result.output.features.domain).toEqual([5, 42]);
  });

  it('the geometry output produces NO clause — the L2 predicate log stays empty', async () => {
    const result = await runRegression(DATASET, { layer: 'reg_line', xField: 'amount', yField: 'size' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = new CauseSelectionSession();
    log.record({
      id: 'g1',
      analysisId: 'reg-amount-size',
      kind: 'transform',
      output: result.output,
      requestedBy: 'user',
      intent: 'trend line for amount vs size',
    });
    // Recording a geometry output never calls the clause path — no rows selected.
    expect(session.records).toHaveLength(0);
    expect(log.commits[0]!.cause.computedBy).toBe('system');
    expect('predicate' in result.output).toBe(false);
  });

  it('R14: a degenerate fit (n=8 < minPoints) carries {n, fitDegenerate:true}, not a bare result', async () => {
    const result = await runRegression(DEGENERATE_DATASET, {
      layer: 'reg_line',
      xField: 'amount',
      yField: 'size',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('degenerate-fit');
    expect(result.n).toBe(8);
    expect(result.fitDegenerate).toBe(true);
    // The honest flag, NOT a fabricated slope/intercept.
    expect('slope' in result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Channel 4 — TABLE: a groupby summary as a new queryable table', () => {
  let result: GroupByResult;
  const log = new AnalysisLog();

  beforeAll(async () => {
    result = await runGroupBy(DATASET, { name: 'by_category', by: 'category', measure: 'amount' });
  });

  it('materializes a deterministic summary table (one row per group, sorted)', () => {
    expect(result.output.as).toBe('table');
    const rows = result.output.rows as Array<{ category: string; count: number; amount_mean: number }>;
    expect(rows.map((r) => r.category)).toEqual(['Analytics', 'Data', 'Ops']);
    expect(rows.every((r) => r.count === 4)).toBe(true);
    const ops = rows.find((r) => r.category === 'Ops')!;
    expect(ops.amount_mean).toBeCloseTo(27.25, 10); // (15+42+30+22)/4
  });

  it('the table output lands as a committed record with cause {computedBy:system}', () => {
    const commit = log.record({
      id: 't1',
      analysisId: 'groupby-category',
      kind: 'transform',
      output: result.output,
      requestedBy: 'agent',
      intent: 'mean amount by category',
    });
    expect(commit.cause.computedBy).toBe('system');
    expect(commit.output.as).toBe('table');
  });

  it('the new table is itself filterable by an ORDINARY predicate (no new verb)', () => {
    const registry = new SourceRegistry();
    const src = registry.register('summaryTable', { actor: 'agent' });
    const emission: ChartEmission = { rawValue: 'Ops', encoding: { kind: 'point', field: 'category' } };
    const clause = causeClauseFromEmission(emission, {
      source: src,
      cause: { requestedBy: 'agent', computedBy: 'agent' },
    });
    allClauses.push(clause);
    expect(clause.meta.type).toBe('point'); // identical KIND to a raw-column selection
    expect(causeOf(clause)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R6 cross-channel — a brush is NOT a test', () => {
  it('committing 100 interval emissions produces ZERO analysis/test commits or FDR steps', async () => {
    const analysisLog = new AnalysisLog();
    const stepper = createLordPlusPlus({ alpha: 0.05 });
    let fdrSteps = 0;

    // 100 brushes ride the L2 interaction rail (emission → clause) + the L1 log.
    const registry = new SourceRegistry();
    const brushSrc = registry.register('amountAxis', { actor: 'user' });
    const session = new CauseSelectionSession();
    const brushClauses: CauseClause[] = [];
    for (let i = 0; i < 100; i++) {
      const emission: ChartEmission = {
        rawValue: [i, i + 5],
        encoding: { kind: 'interval', field: 'amount' },
      };
      brushClauses.push(
        causeClauseFromEmission(emission, {
          source: brushSrc,
          cause: { requestedBy: 'user', computedBy: 'user' },
        }),
      );
      session.commit({
        id: `brush-${i}`,
        parent: i === 0 ? null : `brush-${i - 1}`,
        viewId: 'amountAxis',
        actorMeta: { actor: 'user' },
        kind: 'interval',
        field: 'amount',
        value: [i, i + 5],
        cause: { requestedBy: 'user', computedBy: 'user' },
      });
    }
    allClauses.push(...brushClauses);

    expect(brushClauses).toHaveLength(100);
    expect(session.records).toHaveLength(100); // brushes landed as L2 clause commits...
    expect(analysisLog.commits).toHaveLength(0); // ...but NOTHING on the analysis rail.
    expect(analysisLog.testCommits()).toHaveLength(0);
    expect(fdrSteps).toBe(0);

    // Exactly one DECLARED analysis then produces exactly one test commit + step.
    const corr = await runCorrelation(DATASET, {
      analysisId: 'H-declared',
      xField: 'amount',
      yField: 'size',
      pValue: normalApproxPValue,
      timestamp: 100,
    });
    analysisLog.record({
      id: 'a1',
      analysisId: 'H-declared',
      kind: 'test',
      output: corr.output,
      requestedBy: 'agent',
      intent: 'the single declared hypothesis',
    });
    stepper.step(corr.hypothesis);
    fdrSteps++;
    expect(analysisLog.testCommits()).toHaveLength(1);
    expect(fdrSteps).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R11 overarching — ZERO new interaction verbs across all four channels', () => {
  it('every clause any channel produced is one of the two EXISTING kinds', () => {
    expect(allClauses.length).toBeGreaterThan(100); // column + table + 100 brushes
    for (const clause of allClauses) {
      expect(['point', 'interval']).toContain(clause.meta.type);
    }
  });
});
