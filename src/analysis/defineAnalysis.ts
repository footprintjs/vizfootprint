/**
 * L3 — `defineAnalysis`: the schema-validated declarative entry to an analysis
 * executed as a footprintjs flowchart.
 *
 * R12 firewall (mirrors L0's `parseCause`): the DECLARATIVE metadata of a def
 * (`id`, `kind`, `produces`, `inputs`, `test.statistic`, `honesty`) is validated
 * against a strict allowlist and treated as inert data — a hostile string in any
 * of those fields is stored/echoed verbatim and NEVER interpreted. The
 * executable parts (`build`/`toRunInput`/`readOutput`/`precheck`/`test.pValue`)
 * are developer-authored functions, never a model-supplied code string.
 *
 * Cited footprintjs APIs (installed 9.10.1, paths under
 * `node_modules/footprintjs/dist/esm/lib/`):
 *   - `flowChart<T>(name, fn, id)` → builder — `builder/FlowChartBuilder.d.ts:458`.
 *   - `.build(): RunnableFlowChart` (assignable to `FlowChart`) — `builder/FlowChartBuilder.d.ts:416`;
 *     `RunnableFlowChart extends FlowChart` — `runner/RunnableChart.d.ts:39`.
 *   - `class FlowChartExecutor(flowChart, factoryOrOptions?)` — `runner/FlowChartExecutor.d.ts:236`.
 *   - `run(options?: RunOptions): Promise<ExecutorResult>` (`{ input }`) — `:604`, `engine/types.ts:315`.
 *   - `getSnapshot(): RuntimeSnapshot` ({ sharedState, executionTree, commitLog }) — `:635`,
 *     `runner/ExecutionRuntime.d.ts:27`.
 */

import { FlowChartExecutor } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { HypothesisRecord } from '../fdr/index.js';
import {
  OUTPUT_CHANNELS,
  type AnalysisDef,
  type AnalysisModule,
  type AnalysisRunResult,
  type AnalysisOutput,
  type RunAnalysisOptions,
} from './types.js';

/** Thrown when a def is structurally malformed. Carries every problem at once. */
export class AnalysisDefError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid AnalysisDef: ${problems.join('; ')}`);
    this.name = 'AnalysisDefError';
    this.problems = problems;
  }
}

/** The exhaustive set of keys a def may carry. Anything else is rejected (R12). */
const DEF_KEYS = new Set([
  'id',
  'kind',
  'inputs',
  'produces',
  'build',
  'toRunInput',
  'readOutput',
  'precheck',
  'test',
  'honesty',
]);

const KINDS = new Set(['test', 'transform']);
const CHANNELS = new Set<string>(OUTPUT_CHANNELS);
const ROLES = new Set(['x', 'y', 'group', 'measure', 'value', 'param']);

function isFn(v: unknown): v is (...args: never[]) => unknown {
  return typeof v === 'function';
}

/**
 * Validate a def's declarative shape (never throws in the caller's control flow
 * — collects every problem). Does NOT execute any of the def's functions; a
 * malformed string is never interpreted, only reported.
 */
export function validateAnalysisDef(def: unknown): string[] {
  const problems: string[] = [];
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    return ['def must be a plain object'];
  }
  for (const key of Object.keys(def)) {
    if (!DEF_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }
  const d = def as Record<string, unknown>;

  if (typeof d.id !== 'string' || d.id.length === 0) problems.push('id must be a non-empty string');
  if (typeof d.kind !== 'string' || !KINDS.has(d.kind)) problems.push('kind must be "test" | "transform"');
  if (typeof d.produces !== 'string' || !CHANNELS.has(d.produces)) {
    problems.push(`produces must be one of ${[...CHANNELS].join('|')}`);
  }

  if (!Array.isArray(d.inputs)) {
    problems.push('inputs must be an array of InputBinding');
  } else {
    d.inputs.forEach((b, i) => {
      if (b === null || typeof b !== 'object') {
        problems.push(`inputs[${i}] must be an object`);
        return;
      }
      const binding = b as Record<string, unknown>;
      if (typeof binding.column !== 'string' || binding.column.length === 0) {
        problems.push(`inputs[${i}].column must be a non-empty string`);
      }
      if (binding.role !== undefined && !ROLES.has(binding.role as string)) {
        problems.push(`inputs[${i}].role, if present, must be one of ${[...ROLES].join('|')}`);
      }
    });
  }

  if (!isFn(d.build)) problems.push('build must be a function');
  if (!isFn(d.toRunInput)) problems.push('toRunInput must be a function');
  if (!isFn(d.readOutput)) problems.push('readOutput must be a function');
  if (d.precheck !== undefined && !isFn(d.precheck)) problems.push('precheck, if present, must be a function');

  // R6: a declared test MUST carry its statistic + a caller-supplied p-value.
  if (d.kind === 'test') {
    if (d.test === null || typeof d.test !== 'object') {
      problems.push('kind:test requires a test declaration { statistic, pValue }');
    } else {
      const t = d.test as Record<string, unknown>;
      if (typeof t.statistic !== 'string' || t.statistic.length === 0) {
        problems.push('test.statistic must be a non-empty string');
      }
      if (!isFn(t.pValue)) problems.push('test.pValue must be a function (the caller-supplied judge)');
    }
  } else if (d.test !== undefined) {
    // A transform is FDR-exempt; a stray test decl is a category error.
    problems.push('kind:transform must not carry a test declaration');
  }

  if (d.honesty !== undefined) {
    if (d.honesty === null || typeof d.honesty !== 'object') {
      problems.push('honesty, if present, must be an object');
    } else {
      const h = d.honesty as Record<string, unknown>;
      if (h.minPoints !== undefined && (typeof h.minPoints !== 'number' || h.minPoints < 0)) {
        problems.push('honesty.minPoints, if present, must be a non-negative number');
      }
    }
  }

  return problems;
}

/**
 * Promote a validated def into a runnable module. Throws `AnalysisDefError` on a
 * malformed def (the R12 gate). The flowchart is built ONCE (immutable,
 * re-runnable — SPEC §5 / the x3 kernel pattern) and a fresh `FlowChartExecutor`
 * runs it per invocation (one executor = one run — the library's re-entrancy rule).
 */
export function defineAnalysis<I = unknown, O extends AnalysisOutput = AnalysisOutput>(
  def: AnalysisDef<I, O>,
): AnalysisModule<I, O> {
  const problems = validateAnalysisDef(def);
  if (problems.length) throw new AnalysisDefError(problems);

  let chart: FlowChart | undefined;
  const getChart = (): FlowChart => (chart ??= def.build());

  return {
    id: def.id,
    kind: def.kind,
    def,
    async run(input: I, opts: RunAnalysisOptions = {}): Promise<AnalysisRunResult<O>> {
      // R14: the honesty floor gates BEFORE the chart runs — a degenerate input
      // never produces a (fabricated) fit or a HypothesisRecord.
      const gate = def.precheck?.(input);
      if (gate) return { result: gate };

      const executor = new FlowChartExecutor(getChart());
      await executor.run({ input: def.toRunInput(input) });
      const snapshot = executor.getSnapshot();
      const result = def.readOutput({ snapshot, input });

      let hypothesis: HypothesisRecord | undefined;
      if (def.kind === 'test' && result.ok && def.test) {
        const pValue = def.test.pValue({ snapshot, input, output: result.output });
        hypothesis = {
          hypothesisId: def.id,
          pValue,
          timestamp: opts.timestamp ?? 0,
          ...(def.test.branchId !== undefined ? { branchId: def.test.branchId } : {}),
        };
        opts.sink?.(hypothesis); // the L4 emission seam (P3.4 wires the stepper)
      }

      return { result, snapshot, ...(hypothesis ? { hypothesis } : {}) };
    },
  };
}
