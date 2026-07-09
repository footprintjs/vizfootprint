/**
 * l3-channels spike — the FOUR AnalysisOutput channels, each executed as a
 * footprintjs flowchart, plus the cause-carrying analysis-commit log.
 *
 * This spike validates SPEC §5's central bet (adjudication C3, the highest-risk
 * layer): that an analysis's output can RE-ENTER the data space as ordinary
 * columns / geometry / scalars / tables with ZERO new interaction verbs (R11),
 * and that every analysis output lands as a committed record carrying a two-slot
 * cause whose `computedBy` is `'system'` BY CONSTRUCTION (the flowchart engine
 * computed it, not a human or an agent).
 *
 * What is DEMONSTRATED here, not asserted in prose:
 *   - column   → a deterministic clustering flowchart materializes `cluster_id`;
 *                the test then filters it through the ORDINARY L2 predicate path
 *                (`causeClauseFromEmission`, src/mosaic) → a clause indistinguishable
 *                in KIND from a human bar-click.
 *   - scalar   → a correlation flowchart yields {r,n} + a caller-supplied p-value,
 *                emitted as a `HypothesisRecord` (the L4 stream contract, imported
 *                from src/fdr — never redefined) when declared `kind:'test'`.
 *   - geometry → an OLS regression line: slope/intercept/domain as DATA, selecting
 *                NO rows (no clause). Below the honesty floor it returns a TYPED
 *                degenerate flag (R14), never a fabricated fit.
 *   - table    → a groupby summary as a new queryable table (itself filterable by
 *                ordinary predicates — no new verb).
 *
 * The flowchart pattern is the x3 kernel's (`spikes/x3-why-join/kernel.ts:60-108`):
 * `flowChart(...).addFunction(...).build()`, stages read tracked keys via
 * `$getValue` and write named outputs via `$setValue` into committed state, so
 * `getSnapshot().commitLog` + `sliceForKey` can slice them (R9).
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { RuntimeSnapshot } from 'footprintjs';
import { validateCause, type Actor, type Cause } from '../../src/cause/index.js';
import type { HypothesisRecord } from '../../src/fdr/index.js';
import type { Row } from './dataset.js';
import { ols, pearson, quantileBins } from './stats.js';

// ─────────────────────────────────────────────────────────────────────────────
// The R11 output vocabulary (mirrors SPEC §5's AnalysisOutput union) + the
// cause-carrying analysis commit. NEVER a row-id list (R11 forbids it).
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisKind = 'test' | 'transform';

/** A materialized column set (e.g. adds `cluster_id : int`). Re-enters as a predicate. */
export interface ColumnsOutput {
  readonly as: 'columns';
  readonly table: string;
  readonly columns: Record<string, { readonly type: 'int' | 'float' | 'string' }>;
}
/** A geometry layer (regression line / hull / contour). Selects NO rows. */
export interface GeometryOutput {
  readonly as: 'geometry';
  readonly layer: string;
  readonly features: {
    readonly slope: number;
    readonly intercept: number;
    readonly domain: readonly [number, number];
  };
}
/** A single scalar (e.g. a correlation coefficient). */
export interface ScalarOutput {
  readonly as: 'scalar';
  readonly name: string;
  readonly value: number | string | boolean;
}
/** A new queryable summary table. Filterable by ordinary predicates. */
export interface TableOutput {
  readonly as: 'table';
  readonly name: string;
  readonly schema: Record<string, 'int' | 'float' | 'string'>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}
export type AnalysisOutput = ColumnsOutput | GeometryOutput | ScalarOutput | TableOutput;

/**
 * One committed analysis output — the cause-carrying record L3 appends. Modeled
 * on src/log's committed-record-with-cause discipline (L1 `CommitRecord`), but a
 * DISTINCT record kind: an analysis output is not itself a clause. Only the
 * `columns` channel additionally re-enters src/log as a real clause commit (the
 * predicate on the materialized column) — that is exactly R11's "zero new verbs".
 */
export interface AnalysisCommit {
  readonly id: string;
  readonly analysisId: string;
  readonly kind: AnalysisKind;
  readonly output: AnalysisOutput;
  /** Two-slot cause; `computedBy` is ALWAYS 'system' (stamped by construction). */
  readonly cause: Cause;
  readonly ts: number;
}

/**
 * The append-only analysis-commit log. Reuses the L0 cause firewall
 * (`validateCause`, R12) and enforces R6 at the commit boundary: a declared
 * `kind:'test'` analysis MUST carry an analytical intent.
 */
export class AnalysisLog {
  readonly commits: AnalysisCommit[] = [];

  record(input: {
    id: string;
    analysisId: string;
    kind: AnalysisKind;
    output: AnalysisOutput;
    /** Who DECLARED the analysis (the intent's origin). computedBy is forced to 'system'. */
    requestedBy: Actor;
    /** R6: mandatory when kind==='test'; optional otherwise. Inert free text. */
    intent?: string;
  }): AnalysisCommit {
    if (input.kind === 'test' && (input.intent === undefined || input.intent.trim() === '')) {
      throw new Error(
        `R6: a kind:'test' analysis must declare its analytical intent (analysisId="${input.analysisId}")`,
      );
    }
    // computedBy:'system' BY CONSTRUCTION — the flowchart engine computed it.
    const cause = validateCause({
      requestedBy: input.requestedBy,
      computedBy: 'system',
      ...(input.intent !== undefined ? { intent: input.intent } : {}),
    });
    const commit: AnalysisCommit = {
      id: input.id,
      analysisId: input.analysisId,
      kind: input.kind,
      output: input.output,
      cause,
      ts: this.commits.length,
    };
    Object.freeze(commit);
    this.commits.push(commit);
    return commit;
  }

  /** The kind:'test' commits — the ones that arm L4's online-FDR stepper. */
  testCommits(): readonly AnalysisCommit[] {
    return this.commits.filter((c) => c.kind === 'test');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 1 — COLUMN: deterministic quantile-bin clustering → cluster_id.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClusteringResult {
  readonly snapshot: RuntimeSnapshot;
  /** The materialized cluster_id column, one entry per row. */
  readonly clusterIds: readonly number[];
  readonly output: ColumnsOutput;
}

export async function runClustering(data: readonly Row[], k: number): Promise<ClusteringResult> {
  // Committed keys are DISTINCT from the input arg names (`values`/`k`) —
  // footprintjs guards input keys as readonly and THROWS on a colliding write
  // (scope/protection/readonlyInput.js:23), mirroring the x3 kernel's note.
  const chart = flowChart<Record<string, unknown>>(
    'load values',
    (scope) => {
      const args = scope.$getArgs<{ values: number[]; k: number }>();
      scope.$setValue('amountVals', args.values);
      scope.$setValue('binCount', args.k);
    },
    'load',
  )
    .addFunction(
      'assign quantile bins',
      (scope) => {
        const values = scope.$getValue('amountVals') as number[];
        const k = scope.$getValue('binCount') as number;
        scope.$setValue('cluster_id', quantileBins(values, k)); // the NEW column
      },
      'cluster',
    )
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run({ input: { values: data.map((d) => d.amount), k } });
  const snapshot = executor.getSnapshot();
  return {
    snapshot,
    clusterIds: snapshot.sharedState.cluster_id as number[],
    output: { as: 'columns', table: 'data', columns: { cluster_id: { type: 'int' } } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 2 — SCALAR: Pearson correlation → {r, n} + a caller-supplied p-value.
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrelationResult {
  readonly snapshot: RuntimeSnapshot;
  readonly r: number;
  readonly n: number;
  readonly pValue: number;
  readonly output: ScalarOutput;
  /** The L4 stream record — imported HypothesisRecord shape, never redefined. */
  readonly hypothesis: HypothesisRecord;
}

export async function runCorrelation(
  data: readonly Row[],
  opts: {
    analysisId: string;
    xField: 'amount' | 'size';
    yField: 'amount' | 'size';
    /** Caller-supplied judge (SPEC §5 non-goal — L3 never computes the p-value). */
    pValue: (r: number, n: number) => number;
    timestamp: number;
    branchId?: string;
  },
): Promise<CorrelationResult> {
  // Committed keys (`xv`/`yv`) distinct from input arg names (`xs`/`ys`) — see runClustering.
  const chart = flowChart<Record<string, unknown>>(
    'load pairs',
    (scope) => {
      const args = scope.$getArgs<{ xs: number[]; ys: number[] }>();
      scope.$setValue('xv', args.xs);
      scope.$setValue('yv', args.ys);
    },
    'load',
  )
    .addFunction(
      'compute pearson r',
      (scope) => {
        const xs = scope.$getValue('xv') as number[];
        const ys = scope.$getValue('yv') as number[];
        const { r, n } = pearson(xs, ys);
        scope.$setValue('r', r);
        scope.$setValue('n', n);
      },
      'correlate',
    )
    .build();

  const executor = new FlowChartExecutor(chart);
  const xs = data.map((d) => d[opts.xField]);
  const ys = data.map((d) => d[opts.yField]);
  await executor.run({ input: { xs, ys } });
  const snapshot = executor.getSnapshot();
  const r = snapshot.sharedState.r as number;
  const n = snapshot.sharedState.n as number;
  const pValue = opts.pValue(r, n);
  return {
    snapshot,
    r,
    n,
    pValue,
    output: { as: 'scalar', name: `corr_${opts.xField}_${opts.yField}`, value: r },
    hypothesis: {
      hypothesisId: opts.analysisId,
      pValue,
      timestamp: opts.timestamp,
      ...(opts.branchId !== undefined ? { branchId: opts.branchId } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 3 — GEOMETRY: OLS regression line. Selects NO rows. R14 honesty floor.
// ─────────────────────────────────────────────────────────────────────────────

/** The honesty floor: a linear fit + p-value below this row count is not trusted. */
export const REGRESSION_MIN_POINTS = 10;

export type RegressionResult =
  | { readonly ok: true; readonly snapshot: RuntimeSnapshot; readonly output: GeometryOutput }
  | { readonly ok: false; readonly reason: 'degenerate-fit'; readonly n: number; readonly fitDegenerate: true };

export async function runRegression(
  data: readonly Row[],
  opts: { layer: string; xField: 'amount' | 'size'; yField: 'amount' | 'size'; minPoints?: number },
): Promise<RegressionResult> {
  const minPoints = opts.minPoints ?? REGRESSION_MIN_POINTS;
  const n = data.length;
  // R14: below the floor, return a TYPED flag, never a bare (fabricated) fit.
  if (n < minPoints) return { ok: false, reason: 'degenerate-fit', n, fitDegenerate: true };

  // Committed keys (`xv`/`yv`) distinct from input arg names (`xs`/`ys`) — see runClustering.
  const chart = flowChart<Record<string, unknown>>(
    'load pairs',
    (scope) => {
      const args = scope.$getArgs<{ xs: number[]; ys: number[] }>();
      scope.$setValue('xv', args.xs);
      scope.$setValue('yv', args.ys);
    },
    'load',
  )
    .addFunction(
      'fit OLS line',
      (scope) => {
        const xs = scope.$getValue('xv') as number[];
        const ys = scope.$getValue('yv') as number[];
        const { slope, intercept, domain } = ols(xs, ys);
        scope.$setValue('slope', slope);
        scope.$setValue('intercept', intercept);
        scope.$setValue('domain', [domain[0], domain[1]]);
      },
      'fit',
    )
    .build();

  const executor = new FlowChartExecutor(chart);
  const xs = data.map((d) => d[opts.xField]);
  const ys = data.map((d) => d[opts.yField]);
  await executor.run({ input: { xs, ys } });
  const snapshot = executor.getSnapshot();
  return {
    ok: true,
    snapshot,
    output: {
      as: 'geometry',
      layer: opts.layer,
      features: {
        slope: snapshot.sharedState.slope as number,
        intercept: snapshot.sharedState.intercept as number,
        domain: snapshot.sharedState.domain as [number, number],
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 4 — TABLE: groupby summary as a new queryable table.
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupByResult {
  readonly snapshot: RuntimeSnapshot;
  readonly output: TableOutput;
}

export async function runGroupBy(
  data: readonly Row[],
  opts: { name: string; by: 'category'; measure: 'amount' | 'size' },
): Promise<GroupByResult> {
  const chart = flowChart<Record<string, unknown>>(
    'load rows',
    (scope) => {
      const args = scope.$getArgs<{ rows: Row[]; by: string; measure: string }>();
      scope.$setValue('src', args.rows);
      scope.$setValue('groupField', args.by);
      scope.$setValue('measureField', args.measure);
    },
    'load',
  )
    .addFunction(
      'group + aggregate',
      (scope) => {
        const rows = scope.$getValue('src') as Array<Record<string, unknown>>;
        const by = scope.$getValue('groupField') as string;
        const measure = scope.$getValue('measureField') as string;
        const groups = new Map<string, { count: number; sum: number }>();
        for (const row of rows) {
          const key = String(row[by]);
          const g = groups.get(key) ?? { count: 0, sum: 0 };
          g.count += 1;
          g.sum += Number(row[measure]);
          groups.set(key, g);
        }
        const summary = [...groups.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .map(([key, g]) => ({ [by]: key, count: g.count, [`${measure}_mean`]: g.sum / g.count }));
        scope.$setValue('summary', summary);
      },
      'groupby',
    )
    .build();

  const executor = new FlowChartExecutor(chart);
  await executor.run({ input: { rows: [...data], by: opts.by, measure: opts.measure } });
  const snapshot = executor.getSnapshot();
  return {
    snapshot,
    output: {
      as: 'table',
      name: opts.name,
      schema: { [opts.by]: 'string', count: 'int', [`${opts.measure}_mean`]: 'float' },
      rows: snapshot.sharedState.summary as Array<Record<string, unknown>>,
    },
  };
}
