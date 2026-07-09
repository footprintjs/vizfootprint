/**
 * L3 — the four built-in analyses, one per AnalysisOutput channel, promoted
 * from the C3 mini-spike (`spikes/l3-channels/analysis.ts`) into `defineAnalysis`
 * form. Each executes as a footprintjs flowchart (computedBy:'system' by
 * construction) and re-enters the data space through an EXISTING rail (R11).
 *
 * Flowchart pattern (the x3 kernel — `spikes/x3-why-join/kernel.ts:60-108`):
 * `flowChart(name, loadFn, 'load').addFunction(name, fn, id).build()`; stages
 * read tracked keys via `$getValue` and write named outputs via `$setValue`
 * (`node_modules/footprintjs/dist/esm/lib/reactive/types.d.ts:38-44`).
 *
 * Committed keys are DELIBERATELY distinct from the input arg names — footprintjs
 * guards input keys as readonly and THROWS on a colliding write
 * (`node_modules/footprintjs/dist/esm/lib/scope/protection/readonlyInput.js:23`).
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import { defineAnalysis } from './defineAnalysis.js';
import { mean, normalApproxPValue, ols, pearson, quantileBins } from './stats.js';
import type {
  AnalysisModule,
  ColumnsOutput,
  GeometryOutput,
  ScalarOutput,
  TableOutput,
} from './types.js';

/** A generic data-space row: named columns of numbers or strings. */
export type DataRow = Record<string, number | string>;

// ─────────────────────────────────────────────────────────────────────────────
// Channel 1 — COLUMN: deterministic quantile-bin clustering → a new int column.
// ─────────────────────────────────────────────────────────────────────────────

function buildClusteringChart(): FlowChart {
  return flowChart<Record<string, unknown>>(
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
        scope.$setValue('cluster_id', quantileBins(values, k));
      },
      'cluster',
    )
    .build();
}

export function clusteringAnalysis(opts: {
  column: string;
  k: number;
  id?: string;
  table?: string;
  outColumn?: string;
}): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  const outColumn = opts.outColumn ?? 'cluster_id';
  const table = opts.table ?? 'data';
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id: opts.id ?? `cluster:${opts.column}:k${opts.k}`,
    kind: 'transform',
    produces: 'columns',
    inputs: [{ column: opts.column, role: 'value' }],
    build: buildClusteringChart,
    toRunInput: (rows) => ({ values: rows.map((r) => Number(r[opts.column])), k: opts.k }),
    readOutput: () => ({
      ok: true,
      output: { as: 'columns', table, columns: { [outColumn]: { type: 'int' } } },
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 2 — SCALAR: Pearson correlation → {r} + a caller-supplied p-value.
// ─────────────────────────────────────────────────────────────────────────────

function buildCorrelationChart(): FlowChart {
  return flowChart<Record<string, unknown>>(
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
}

export function correlationAnalysis(opts: {
  x: string;
  y: string;
  id?: string;
  /** Caller-supplied p-value judge (SPEC §5 non-goal). Defaults to the normal-approx demo judge. */
  pValue?: (r: number, n: number) => number;
  branchId?: string;
}): AnalysisModule<readonly DataRow[], ScalarOutput> {
  const pv = opts.pValue ?? normalApproxPValue;
  return defineAnalysis<readonly DataRow[], ScalarOutput>({
    id: opts.id ?? `corr:${opts.x}:${opts.y}`,
    kind: 'test',
    produces: 'scalar',
    inputs: [
      { column: opts.x, role: 'x' },
      { column: opts.y, role: 'y' },
    ],
    build: buildCorrelationChart,
    toRunInput: (rows) => ({
      xs: rows.map((r) => Number(r[opts.x])),
      ys: rows.map((r) => Number(r[opts.y])),
    }),
    readOutput: ({ snapshot }) => {
      const r = snapshot.sharedState.r as number;
      if (!Number.isFinite(r)) {
        return { ok: false, reason: 'degenerate-fit', n: snapshot.sharedState.n as number, fitDegenerate: true };
      }
      return { ok: true, output: { as: 'scalar', name: `corr_${opts.x}_${opts.y}`, value: r } };
    },
    test: {
      statistic: 'pearson-r',
      pValue: ({ snapshot }) =>
        pv(snapshot.sharedState.r as number, snapshot.sharedState.n as number),
      ...(opts.branchId !== undefined ? { branchId: opts.branchId } : {}),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 3 — GEOMETRY: OLS regression line. Selects NO rows. R14 honesty floor.
// ─────────────────────────────────────────────────────────────────────────────

/** The default honesty floor: a linear fit below this row count is not trusted. */
export const REGRESSION_MIN_POINTS = 10;

function buildRegressionChart(): FlowChart {
  return flowChart<Record<string, unknown>>(
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
}

export function regressionAnalysis(opts: {
  x: string;
  y: string;
  layer?: string;
  id?: string;
  minPoints?: number;
}): AnalysisModule<readonly DataRow[], GeometryOutput> {
  const minPoints = opts.minPoints ?? REGRESSION_MIN_POINTS;
  const layer = opts.layer ?? `reg_${opts.x}_${opts.y}`;
  return defineAnalysis<readonly DataRow[], GeometryOutput>({
    id: opts.id ?? `reg:${opts.x}:${opts.y}`,
    kind: 'transform',
    produces: 'geometry',
    inputs: [
      { column: opts.x, role: 'x' },
      { column: opts.y, role: 'y' },
    ],
    honesty: { minPoints, notes: 'linear fit + p-value untrusted below the floor' },
    // R14 pre-run gate: never even fits a line on too few points.
    precheck: (rows) =>
      rows.length < minPoints
        ? { ok: false, reason: 'degenerate-fit', n: rows.length, fitDegenerate: true }
        : undefined,
    build: buildRegressionChart,
    toRunInput: (rows) => ({
      xs: rows.map((r) => Number(r[opts.x])),
      ys: rows.map((r) => Number(r[opts.y])),
    }),
    readOutput: ({ snapshot }) => ({
      ok: true,
      output: {
        as: 'geometry',
        layer,
        features: {
          slope: snapshot.sharedState.slope as number,
          intercept: snapshot.sharedState.intercept as number,
          domain: snapshot.sharedState.domain as [number, number],
        },
      },
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel 4 — TABLE: groupby summary as a new queryable table.
// ─────────────────────────────────────────────────────────────────────────────

function buildGroupByChart(): FlowChart {
  return flowChart<Record<string, unknown>>(
    'load rows',
    (scope) => {
      const args = scope.$getArgs<{ rows: DataRow[]; by: string; measure: string }>();
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
}

export function groupByAnalysis(opts: {
  by: string;
  measure: string;
  name?: string;
  id?: string;
}): AnalysisModule<readonly DataRow[], TableOutput> {
  const name = opts.name ?? `by_${opts.by}`;
  return defineAnalysis<readonly DataRow[], TableOutput>({
    id: opts.id ?? `groupby:${opts.by}:${opts.measure}`,
    kind: 'transform',
    produces: 'table',
    inputs: [
      { column: opts.by, role: 'group' },
      { column: opts.measure, role: 'measure' },
    ],
    build: buildGroupByChart,
    toRunInput: (rows) => ({ rows: [...rows], by: opts.by, measure: opts.measure }),
    readOutput: ({ snapshot }) => ({
      ok: true,
      output: {
        as: 'table',
        name,
        schema: { [opts.by]: 'string', count: 'int', [`${opts.measure}_mean`]: 'float' },
        rows: snapshot.sharedState.summary as Array<Record<string, unknown>>,
      },
    }),
  });
}

// Re-export a deterministic default p-value judge for callers who want one.
export { normalApproxPValue } from './stats.js';
