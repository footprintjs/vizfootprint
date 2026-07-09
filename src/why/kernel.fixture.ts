/**
 * L6 test fixture — the BACKEND (kernel) tier: a tiny footprintjs flowchart.
 * Promoted verbatim from `spikes/x3-why-join/kernel.ts` (P3-L6 retirement).
 * A `.fixture.ts` (vitest ignores it), like `src/log/branching.fixture.ts`.
 *
 * A three-stage data pipeline whose final key `rowCount` is the thing the
 * promoted `why({kind:'column', column:'rowCount'})` is asked about:
 *
 *   load → decoy → filter → count
 *
 * - `load`   reads the run INPUT (frozen args) and writes `rows`, plus the three
 *            threaded values (`corrId`, `filterField`, `filterRange`). The
 *            correlationId is written into COMMITTED STATE here — the only way
 *            the join key survives into `getSnapshot().commitLog` (footprintjs
 *            input is a frozen, UNTRACKED args channel; it never lands on its own).
 * - `decoy`  is the intra-kernel DECOY (A2): it writes `auditNote`, a key nothing
 *            downstream reads. `sliceForKey('rowCount')` must exclude it.
 * - `filter` reads `rows`/`filterField`/`filterRange`, writes `filtered`.
 * - `count`  reads `filtered`, writes `rowCount`.
 *
 * Reads use tracked `$getValue` access so the executor records them into
 * `StageSnapshot.stageReads` (readTracking defaults to 'full' for a bare
 * FlowChartExecutor) — what `keysReadFromExecutionTree` feeds the slicer.
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
  readonly correlationId: string;
  readonly field: 'amount';
  readonly range: readonly [number, number];
}

/** Build the kernel chart. Stable stage ids so the slice's node set is assertable by id. */
export function buildKernelChart() {
  return flowChart<Record<string, unknown>>(
    'load rows',
    (scope) => {
      const args = scope.$getArgs<KernelInput>();
      // committed keys must NOT collide with input key names (footprintjs guards
      // input keys as readonly) — `corrId`/`filterField`/`filterRange` are distinct.
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

/** Run the kernel chart once. Fresh executor = fresh run. */
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
