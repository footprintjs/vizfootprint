/**
 * L3 — `defineAnalysis`: the schema-validated declarative entry to an analysis
 * executed as a footprintjs flowchart.
 *
 * R12 firewall (mirrors L0's `parseCause`): the DECLARATIVE metadata of a def
 * (`id`, `kind`, `produces`, `inputs`, `reads`, `test.statistic`, `honesty`) is
 * validated against a strict allowlist and treated as inert data — a hostile
 * string in any of those fields is stored/echoed verbatim and NEVER interpreted.
 * `reads` is the clearest case: the table names come out of a dashboard record,
 * are stored as written and are echoed back word for word in the door's
 * refusals. The executable parts
 * (`build`/`toRunInput`/`readOutput`/`precheck`/`judgeTable`/`test.pValue`) are
 * developer-authored functions, never a model-supplied code string.
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
  ANALYSIS_KINDS,
  INPUT_ROLES,
  NO_RELATED_ROWS,
  OUTPUT_CHANNELS,
  type AnalysisDef,
  type AnalysisModule,
  type AnalysisRunResult,
  type AnalysisOutput,
  type RelatedRows,
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
  'reads',
  'produces',
  'build',
  'toRunInput',
  'readOutput',
  'precheck',
  'judgeTable',
  'refusalTaxonomy',
  'test',
  'honesty',
]);

/** The gap taxonomies an analysis may claim its refusals belong to. One so far; see `./types.ts`. */
const TAXONOMIES = new Set<string>(['derive']);

const KINDS = new Set<string>(ANALYSIS_KINDS);
const CHANNELS = new Set<string>(OUTPUT_CHANNELS);
const ROLES = new Set<string>(INPUT_ROLES);

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

  // The tables read BESIDE the own one: names only, judged as SHAPE here. Whether
  // a relation permits each read is a question about the def AND the table the act
  // runs over, so it is asked at the door (`declareAnalysis`), not here.
  if (d.reads !== undefined) {
    if (!Array.isArray(d.reads)) {
      problems.push('reads, if present, must be an array of table names');
    } else {
      const seen = new Set<string>();
      d.reads.forEach((name, i) => {
        if (typeof name !== 'string' || name.length === 0) problems.push(`reads[${i}] must be a non-empty table name`);
        else if (seen.has(name)) problems.push(`reads[${i}] repeats table "${name}"`);
        else seen.add(name);
      });
    }
  }

  if (!isFn(d.build)) problems.push('build must be a function');
  if (!isFn(d.toRunInput)) problems.push('toRunInput must be a function');
  if (!isFn(d.readOutput)) problems.push('readOutput must be a function');
  if (d.precheck !== undefined && !isFn(d.precheck)) problems.push('precheck, if present, must be a function');
  if (d.judgeTable !== undefined && !isFn(d.judgeTable)) problems.push('judgeTable, if present, must be a function');
  // A taxonomy nobody can file is not one: the session would read the word off
  // the def and have no code to put on the ledger row.
  if (d.refusalTaxonomy !== undefined && !TAXONOMIES.has(d.refusalTaxonomy as string)) {
    problems.push(`refusalTaxonomy, if present, must be one of ${[...TAXONOMIES].join(' | ')}`);
  }

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
  } else if (d.kind === 'transform' && d.test !== undefined) {
    // A transform is FDR-exempt; a stray test decl is a category error. Narrowed
    // to the kind it NAMES: a def whose kind is misspelled is neither, and a
    // refusal may not tell it that it is a transform.
    problems.push('kind:transform must not carry a test declaration');
  }

  if (d.honesty !== undefined) {
    if (d.honesty === null || typeof d.honesty !== 'object') {
      problems.push('honesty, if present, must be an object');
    } else {
      const h = d.honesty as Record<string, unknown>;
      // `Number.isFinite` and not just `typeof`: NaN is a number, `NaN < 0` is
      // false, and a NaN floor makes `rows.length < minPoints` false for every
      // row count — the R14 gate silently stops existing. Worded as its twin
      // words it (`../def/builtinAnalyses.ts`).
      if (h.minPoints !== undefined && (typeof h.minPoints !== 'number' || !Number.isFinite(h.minPoints) || h.minPoints < 0)) {
        problems.push('honesty.minPoints, if present, must be a non-negative finite number');
      }
    }
  }

  return problems;
}

/**
 * The related rows one invocation may read: exactly the tables `reads` names,
 * taken from what the caller resolved.
 *
 * WHY the caller's map is judged and then narrowed, and WHY here: `run` is the
 * ONE place holding both halves — the def's declaration and the rows a caller
 * with a data space went and read. A declared table nobody handed over refuses
 * in a sentence naming it, because half an input is not an input (R14): an
 * analysis handed `{}` for a table it declared would lay out an edgeless graph
 * and call it a success. A table the def never named is dropped rather than
 * forwarded, because the permission the door granted was for the DECLARED names
 * — which is what `RelatedRows` says it holds.
 */
function relatedFor(id: string, reads: readonly string[] | undefined, supplied: RelatedRows): RelatedRows {
  const declared = reads ?? [];
  if (declared.length === 0) return NO_RELATED_ROWS;
  const missing = declared.filter((name) => !Object.prototype.hasOwnProperty.call(supplied, name));
  if (missing.length > 0) {
    throw new Error(
      `vizfootprint: analysis "${id}" reads ${missing.map((name) => `"${name}"`).join(', ')} beside its own table, and this run was handed no rows to read there — "reads" is a promise the caller resolves`,
    );
  }
  return Object.freeze(Object.fromEntries(declared.map((name) => [name, supplied[name]!])));
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
      // The related rows are the CALLER's to resolve — only the session has a
      // data space and a cursor — so they arrive per invocation, never on the
      // def, and this is where the promise `reads` made is kept or refused.
      // FIRST, before the honesty gate below: a run missing half its input is
      // not a run whose rows can be judged degenerate or whole.
      const related = relatedFor(def.id, def.reads, opts.related ?? NO_RELATED_ROWS);

      // R14: the honesty floor gates BEFORE the chart runs — a degenerate input
      // never produces a (fabricated) fit or a HypothesisRecord.
      const gate = def.precheck?.(input);
      if (gate) return { result: gate };

      const executor = new FlowChartExecutor(getChart());
      await executor.run({ input: def.toRunInput(input, related) });
      const snapshot = executor.getSnapshot();
      const result = def.readOutput({ snapshot, input });

      let hypothesis: HypothesisRecord | undefined;
      if (def.kind === 'test' && result.ok && def.test) {
        const pValue = def.test.pValue({ snapshot, input, output: result.output });
        // WHY the judge's answer is judged: `pValue` is caller-supplied, and the
        // record it is stamped onto is what L4's stepper SPENDS wealth on. A NaN
        // never rejects and still burns the budget, and the frozen audit row
        // then carries a number that was never a p-value. The other door into
        // this record type (`../fdr/fromLog.ts`) already applies this rule; a
        // refused act does not happen, so no step is spent.
        if (typeof pValue !== 'number' || !Number.isFinite(pValue) || pValue < 0 || pValue > 1) {
          throw new Error(`vizfootprint: analysis "${def.id}" judged "${def.test.statistic}" with ${String(pValue)} — a p-value is a finite number in [0,1]`);
        }
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
