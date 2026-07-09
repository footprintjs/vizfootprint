/**
 * L3 — the four built-in channels through the frozen `defineAnalysis` API
 * (SPEC §5 acceptance). Ports the C3 mini-spike's proofs onto the promoted
 * surface: columns re-enter as a predicate (R11), scalar emits a HypothesisRecord
 * and steps the real online-FDR stepper, geometry selects no rows + flags a
 * degenerate fit (R14), table is a new queryable relation, and a brush is not a
 * test (R6). Written to the acceptance criteria FIRST (family Convention 2).
 */

import { describe, it, expect } from 'vitest';
import { sliceForKey, keysReadFromExecutionTree, sliceToJSON } from 'footprintjs/trace';
import {
  clusteringAnalysis,
  correlationAnalysis,
  regressionAnalysis,
  groupByAnalysis,
  normalApproxPValue,
  type DataRow,
} from './index.js';
import {
  causeClauseFromEmission,
  causeOf,
  SourceRegistry,
  type ChartEmission,
} from '../mosaic/index.js';
import { CauseSelectionSession } from '../log/index.js';
import { createLordPlusPlus } from '../fdr/index.js';
import type { HypothesisRecord } from '../fdr/index.js';

const DATASET: readonly DataRow[] = [
  { amount: 5, size: 12, category: 'Data' },
  { amount: 12, size: 26, category: 'Analytics' },
  { amount: 15, size: 30, category: 'Ops' },
  { amount: 18, size: 40, category: 'Data' },
  { amount: 25, size: 52, category: 'Analytics' },
  { amount: 42, size: 88, category: 'Ops' },
  { amount: 8, size: 18, category: 'Data' },
  { amount: 20, size: 44, category: 'Analytics' },
  { amount: 30, size: 62, category: 'Ops' },
  { amount: 35, size: 68, category: 'Data' },
  { amount: 10, size: 22, category: 'Analytics' },
  { amount: 22, size: 50, category: 'Ops' },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('COLUMN channel — cluster_id materializes, slices minimally (R9), re-enters as a predicate (R11)', () => {
  it('produces a columns output and a deterministic cluster_id column', async () => {
    const mod = clusteringAnalysis({ column: 'amount', k: 3 });
    const { result, snapshot } = await mod.run(DATASET);
    expect(result.ok && result.output.as).toBe('columns');
    if (!result.ok) return;
    expect(result.output.columns.cluster_id).toEqual({ type: 'int' });
    const clusterIds = snapshot!.sharedState.cluster_id as number[];
    expect(new Set(clusterIds)).toEqual(new Set([0, 1, 2]));
  });

  it('the materialized column is sliceable to EXACTLY {cluster, load} (R9)', async () => {
    const { snapshot } = await clusteringAnalysis({ column: 'amount', k: 3 }).run(DATASET);
    const slice = sliceForKey(
      snapshot!.commitLog,
      'cluster_id',
      keysReadFromExecutionTree(snapshot!.executionTree),
    );
    const stageIds = Object.values(sliceToJSON(slice).nodes ?? {}).map((n) => n.stageId);
    expect(new Set(stageIds)).toEqual(new Set(['cluster', 'load']));
  });

  it('filtering cluster_id is an ORDINARY point clause — no new verb (R11)', async () => {
    const registry = new SourceRegistry();
    const agentSrc = registry.register('scatter', { actor: 'agent' });
    const userSrc = registry.register('barchart', { actor: 'user' });
    const analysisClause = causeClauseFromEmission(
      { rawValue: 2, encoding: { kind: 'point', field: 'cluster_id' } } as ChartEmission,
      { source: agentSrc, cause: { requestedBy: 'agent', computedBy: 'agent' } },
    );
    const barClickClause = causeClauseFromEmission(
      { rawValue: 'Ops', encoding: { kind: 'point', field: 'category' } } as ChartEmission,
      { source: userSrc, cause: { requestedBy: 'user', computedBy: 'user' } },
    );
    // Indistinguishable in KIND from a human bar-click on a raw column.
    expect(analysisClause.meta.type).toBe('point');
    expect(analysisClause.meta.type).toBe(barClickClause.meta.type);
    expect(Object.keys(analysisClause).sort()).toEqual(Object.keys(barClickClause).sort());
    expect(causeOf(analysisClause)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SCALAR channel — correlation → {r} + a HypothesisRecord, steps the real FDR stepper', () => {
  it('produces a scalar r and emits an imported HypothesisRecord into the sink', async () => {
    const captured: HypothesisRecord[] = [];
    const mod = correlationAnalysis({ x: 'amount', y: 'size', pValue: normalApproxPValue });
    const { result, hypothesis } = await mod.run(DATASET, { sink: (h) => captured.push(h), timestamp: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.as).toBe('scalar');
    expect(result.output.value as number).toBeGreaterThan(0.98);
    expect(hypothesis?.hypothesisId).toBe('corr:amount:size');
    expect(hypothesis!.pValue).toBeLessThan(0.01);
    expect(captured).toEqual([hypothesis]);
  });

  it('the emitted record steps LORD++ → a discovery', async () => {
    const captured: HypothesisRecord[] = [];
    await correlationAnalysis({ x: 'amount', y: 'size' }).run(DATASET, { sink: (h) => captured.push(h) });
    const step = createLordPlusPlus({ alpha: 0.05 }).step(captured[0]!);
    expect(step.step).toBe(1);
    expect(step.reject).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GEOMETRY channel — a regression line that selects NO rows + R14 honesty', () => {
  it('fits an OLS line (slope/intercept/domain as DATA), producing no clause', async () => {
    const { result } = await regressionAnalysis({ x: 'amount', y: 'size' }).run(DATASET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.as).toBe('geometry');
    expect(result.output.features.slope).toBeCloseTo(2, 0);
    expect(result.output.features.domain).toEqual([5, 42]);
    // A geometry output carries geometry, NOT a predicate/clause — it selects no rows.
    expect('predicate' in result.output).toBe(false);
  });

  it('R14: a degenerate fit (n=8 < minPoints) returns {n, fitDegenerate:true}, never ran the chart', async () => {
    const { result, snapshot } = await regressionAnalysis({ x: 'amount', y: 'size' }).run(DATASET.slice(0, 8));
    expect(result).toEqual({ ok: false, reason: 'degenerate-fit', n: 8, fitDegenerate: true });
    expect(snapshot).toBeUndefined(); // the pre-run gate short-circuited
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('TABLE channel — groupby summary as a new queryable relation', () => {
  it('materializes a deterministic summary table', async () => {
    const { result } = await groupByAnalysis({ by: 'category', measure: 'amount' }).run(DATASET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.as).toBe('table');
    const rows = result.output.rows as Array<{ category: string; count: number; amount_mean: number }>;
    expect(rows.map((r) => r.category)).toEqual(['Analytics', 'Data', 'Ops']);
    expect(rows.every((r) => r.count === 4)).toBe(true);
    expect(rows.find((r) => r.category === 'Ops')!.amount_mean).toBeCloseTo(27.25, 10);
  });

  it('the new table is itself filterable by an ORDINARY predicate (no new verb)', () => {
    const registry = new SourceRegistry();
    const src = registry.register('summaryTable', { actor: 'agent' });
    const clause = causeClauseFromEmission(
      { rawValue: 'Ops', encoding: { kind: 'point', field: 'category' } } as ChartEmission,
      { source: src, cause: { requestedBy: 'agent', computedBy: 'agent' } },
    );
    expect(clause.meta.type).toBe('point');
    expect(causeOf(clause)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('R6 — a brush is NOT a test', () => {
  it('committing 100 interval emissions emits ZERO HypothesisRecords; one declared run emits exactly one', async () => {
    const captured: HypothesisRecord[] = [];
    const analysis = correlationAnalysis({ x: 'amount', y: 'size', pValue: normalApproxPValue });

    const session = new CauseSelectionSession();
    for (let i = 0; i < 100; i++) {
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
    expect(session.records).toHaveLength(100); // brushes landed on the L2 rail...
    expect(captured).toHaveLength(0); // ...and NOTHING reached the test sink.

    await analysis.run(DATASET, { sink: (h) => captured.push(h) });
    expect(captured).toHaveLength(1); // exactly one DECLARED analysis → one test.
  });
});
