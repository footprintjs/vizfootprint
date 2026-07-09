/**
 * x3 — BACKEND (kernel) tier: a tiny footprintjs flowchart.
 *
 * The bottom tier of the R10 kill-test. A three-stage data pipeline whose
 * final key `rowCount` is the thing `why(x)` will be asked about:
 *
 *   load → decoy → filter → count
 *
 * - `load`   reads the run INPUT (frozen args) and writes `rows`, plus the
 *            three threaded values (`correlationId`, `field`, `range`). The
 *            correlationId is written into COMMITTED STATE here — that is the
 *            only way the join key survives into `getSnapshot().commitLog`
 *            (footprintjs input is a frozen, UNTRACKED args channel, so it
 *            never lands in a commit on its own).
 * - `decoy`  is the intra-kernel DECOY (A2): it writes `auditNote`, a key that
 *            nothing downstream reads. sliceForKey('rowCount') must exclude it.
 * - `filter` reads `rows`/`field`/`range`, writes `filtered`.
 * - `count`  reads `filtered`, writes `rowCount`.
 *
 * Reads use tracked property/`$getValue` access so the executor records them
 * into `StageSnapshot.stageReads` (readTracking defaults to 'full' for a bare
 * FlowChartExecutor), which is what `keysReadFromExecutionTree` feeds to the
 * slicer.
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { RuntimeSnapshot } from 'footprintjs';

/** One row of the toy dataset. */
export interface Row {
  readonly category: string;
  readonly amount: number;
}

/** The fixed dataset every kernel run filters over. */
export const DATASET: readonly Row[] = [
  { category: 'Data', amount: 5 },
  { category: 'Data', amount: 12 },
  { category: 'Analytics', amount: 15 },
  { category: 'Analytics', amount: 18 },
  { category: 'Ops', amount: 25 },
  { category: 'Ops', amount: 42 },
];

/** What the kernel run is told to do — the threaded join key rides in here. */
export interface KernelInput {
  /** The cross-tier join key (equals the viz commit id). */
  readonly correlationId: string;
  /** Column the filter predicate applies to. */
  readonly field: 'amount';
  /** Inclusive [min,max] interval the filter keeps. */
  readonly range: readonly [number, number];
}

/**
 * Build the kernel chart. One immutable chart, re-runnable per correlationId.
 * Stage ids are stable ('load'/'decoy'/'filter'/'count') so the slice's node
 * set is assertable by id.
 */
export function buildKernelChart() {
  return flowChart<Record<string, unknown>>(
    'load rows',
    (scope) => {
      const args = scope.$getArgs<KernelInput>();
      // Thread the join key into COMMITTED state (frozen args never commit).
      // NOTE: committed keys must NOT collide with input key names — footprintjs
      // guards input keys as readonly (scope/protection/readonlyInput.ts:23), so
      // `corrId`/`filterField`/`filterRange` are distinct from the args names.
      scope.$setValue('corrId', args.correlationId);
      scope.$setValue('filterField', args.field);
      scope.$setValue('filterRange', [args.range[0], args.range[1]]);
      scope.$setValue(
        'rows',
        DATASET.map((r) => ({ category: r.category, amount: r.amount })),
      );
    },
    'load',
  )
    .addFunction(
      'audit note (decoy)',
      (scope) => {
        // Reads corrId, writes a key nobody downstream consumes.
        const corr = scope.$getValue('corrId') as string;
        scope.$setValue('auditNote', `run for ${corr}`);
      },
      'decoy',
    )
    .addFunction(
      'apply filter',
      (scope) => {
        const rows = scope.$getValue('rows') as Row[];
        const field = scope.$getValue('filterField') as 'amount';
        const range = scope.$getValue('filterRange') as [number, number];
        const [lo, hi] = range;
        const filtered = rows.filter((r) => r[field] >= lo && r[field] <= hi);
        scope.$setValue('filtered', filtered);
      },
      'filter',
    )
    .addFunction(
      'compute rowCount',
      (scope) => {
        const filtered = scope.$getValue('filtered') as Row[];
        scope.$setValue('rowCount', filtered.length);
      },
      'count',
    )
    .build();
}

/** One kernel result: the full snapshot plus the values callers care about. */
export interface KernelResult {
  readonly snapshot: RuntimeSnapshot;
  readonly rowCount: number;
  /** correlationId as it stands in committed state (proves it threaded). */
  readonly committedCorrelationId: string;
}

/** Run the kernel chart once for a given input. Fresh executor = fresh run. */
export async function runKernel(input: KernelInput): Promise<KernelResult> {
  const chart = buildKernelChart();
  const executor = new FlowChartExecutor(chart);
  await executor.run({ input });
  const snapshot = executor.getSnapshot();
  return {
    snapshot,
    rowCount: snapshot.sharedState.rowCount as number,
    committedCorrelationId: snapshot.sharedState.corrId as string,
  };
}
