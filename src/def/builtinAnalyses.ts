/**
 * THE BUILTIN ANALYSIS RECORD — an analysis named as data.
 *
 * `AnalysisDef` and `AnalysisModule` are both CODE: the first requires
 * `build`/`toRunInput`/`readOutput` functions, the second is detected by its
 * `run` function. So until this file existed, a def that wanted the four
 * built-in analyses had to be written in TypeScript — nothing resolved a NAME
 * to a factory, and `JSON.parse(text)` could never produce an analysis.
 *
 * A builtin record closes that: `{ builtin: 'groupBy', by: 'disease',
 * measure: 'cases' }` is the factory's own options, as data. The record's keys
 * ARE the factory's parameters (minus the ones that are functions — see
 * `correlation` below), which is why there is one spec table here and no
 * second vocabulary to keep in step.
 *
 * R12 firewall, as everywhere else on this boundary: every field is inert
 * data, validated against a strict allowlist and echoed verbatim; an unknown
 * builtin name, a missing option and an option of the wrong type are each
 * refused in a sentence naming the analysis and the problem, before anything
 * is constructed.
 */

import {
  clusteringAnalysis,
  correlationAnalysis,
  groupByAnalysis,
  regressionAnalysis,
  type AnalysisModule,
  type AnalysisOutput,
  type DataRow,
} from '../analysis/index.js';

/** The builtin analyses a def may name. */
export const BUILTIN_ANALYSES = ['groupBy', 'correlation', 'regression', 'clustering'] as const;
export type BuiltinAnalysisName = (typeof BUILTIN_ANALYSES)[number];

/** A group-by summary as a new queryable table (`groupByAnalysis`). */
export interface GroupByDecl {
  readonly builtin: 'groupBy';
  /** The column whose values become the groups. */
  readonly by: string;
  /** The column averaged per group. */
  readonly measure: string;
  /** The summary table's name. Default `by_<by>`. */
  readonly name?: string;
  /** The analysis id (also the hypothesis id). Default `groupby:<by>:<measure>`. */
  readonly id?: string;
}

/**
 * Pearson correlation as a scalar, with its p-value (`correlationAnalysis`).
 *
 * The factory's `pValue` judge is a FUNCTION and so has no spelling here: a
 * declared correlation takes the built-in normal-approximation judge. A
 * caller who wants their own judge is writing code, and passes the module.
 */
export interface CorrelationDecl {
  readonly builtin: 'correlation';
  readonly x: string;
  readonly y: string;
  /** Default `corr:<x>:<y>`. */
  readonly id?: string;
  /** Provenance branch stamped on the emitted hypothesis (R8). */
  readonly branchId?: string;
}

/** An OLS regression line as a geometry layer (`regressionAnalysis`). */
export interface RegressionDecl {
  readonly builtin: 'regression';
  readonly x: string;
  readonly y: string;
  /** The layer's name. Default `reg_<x>_<y>`. */
  readonly layer?: string;
  /** The honesty floor — below this row count no line is fitted. Default 10. */
  readonly minPoints?: number;
  /** Default `reg:<x>:<y>`. */
  readonly id?: string;
}

/** Deterministic quantile-bin clustering as a new int column (`clusteringAnalysis`). */
export interface ClusteringDecl {
  readonly builtin: 'clustering';
  /** The column the bins are cut from. */
  readonly column: string;
  /** How many bins. A whole number of at least 1. */
  readonly k: number;
  /** The table the column is written into. Default `data`. */
  readonly table?: string;
  /** The column written. Default `cluster_id`. */
  readonly outColumn?: string;
  /** Default `cluster:<column>:k<k>`. */
  readonly id?: string;
}

/** An analysis named as data — the third form of {@link import('./types.js').AnalysisSlot}. */
export type BuiltinAnalysisDecl = GroupByDecl | CorrelationDecl | RegressionDecl | ClusteringDecl;

/** Thrown when a builtin record is malformed. Carries every problem at once. */
export class BuiltinAnalysisError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid builtin analysis: ${problems.join('; ')}`);
    this.name = 'BuiltinAnalysisError';
    this.problems = problems;
  }
}

/** What an option must be. Three kinds is all four builtins need. */
type OptionType = 'string' | 'count' | 'whole';

interface BuiltinSpec {
  readonly required: Readonly<Record<string, OptionType>>;
  readonly optional: Readonly<Record<string, OptionType>>;
}

/**
 * The ONE table: which options each builtin takes, and what each must be.
 * The validator and the constructor below both read it, so a record the
 * validator accepts is a record the constructor can build.
 */
const SPECS: Readonly<Record<BuiltinAnalysisName, BuiltinSpec>> = Object.freeze({
  groupBy: { required: { by: 'string', measure: 'string' }, optional: { name: 'string', id: 'string' } },
  correlation: { required: { x: 'string', y: 'string' }, optional: { id: 'string', branchId: 'string' } },
  regression: { required: { x: 'string', y: 'string' }, optional: { layer: 'string', minPoints: 'count', id: 'string' } },
  clustering: { required: { column: 'string', k: 'whole' }, optional: { table: 'string', outColumn: 'string', id: 'string' } },
});

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function holds(value: unknown, type: OptionType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length > 0;
    case 'count':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'whole':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1;
  }
}

function mustBe(type: OptionType): string {
  switch (type) {
    case 'string':
      return 'must be a non-empty string';
    case 'count':
      return 'must be a non-negative finite number';
    case 'whole':
      return 'must be a whole number of at least 1';
  }
}

/** The options a builtin takes, listed for its refusal sentence. */
function optionNamesOf(spec: BuiltinSpec): string {
  return [...Object.keys(spec.required), ...Object.keys(spec.optional)].join(', ');
}

/** Every key but `builtin` — which is exactly the factory's own options. */
function optionsOf<T extends { readonly builtin: string }>(decl: T): Omit<T, 'builtin'> {
  const { builtin, ...options } = decl;
  void builtin;
  return options;
}

/**
 * True when a slot is a builtin RECORD rather than a def or a module: it
 * carries a `builtin` name and no `build` function. The def door and the
 * registry both route on this one predicate, so the shape that validates is
 * the shape that gets constructed.
 */
export function isBuiltinRecord(slot: unknown): slot is BuiltinAnalysisDecl {
  return isObject(slot) && typeof slot.build !== 'function' && typeof slot.builtin === 'string';
}

/**
 * Judge a builtin record. Total over `unknown` (it is a firewall, not a
 * convenience): collects every problem, never throws, never constructs.
 */
export function validateBuiltinAnalysis(decl: unknown, where: string, problems: string[]): void {
  if (!isObject(decl)) {
    problems.push(`${where} must be an object { builtin, … }`);
    return;
  }
  const name = decl['builtin'];
  if (typeof name !== 'string') {
    problems.push(`${where}.builtin must name a builtin analysis — one of ${BUILTIN_ANALYSES.join(' | ')}`);
    return;
  }
  const spec = SPECS[name as BuiltinAnalysisName] as BuiltinSpec | undefined;
  if (spec === undefined) {
    problems.push(`${where}.builtin "${name}" is not a builtin analysis — one of ${BUILTIN_ANALYSES.join(' | ')}`);
    return;
  }
  for (const key of Object.keys(decl)) {
    if (key !== 'builtin' && !(key in spec.required) && !(key in spec.optional)) {
      problems.push(`${where}.${key} is not an option of the "${name}" analysis — it takes ${optionNamesOf(spec)}`);
    }
  }
  for (const [key, type] of Object.entries(spec.required)) {
    if (!holds(decl[key], type)) problems.push(`${where}.${key} ${mustBe(type)} (the "${name}" analysis needs it)`);
  }
  for (const [key, type] of Object.entries(spec.optional)) {
    if (decl[key] !== undefined && !holds(decl[key], type)) problems.push(`${where}.${key}, if present, ${mustBe(type)}`);
  }
}

/**
 * Resolve a builtin record to its factory. Judged first — a malformed record
 * throws {@link BuiltinAnalysisError} with every problem, rather than reaching
 * a factory that would throw something less specific (or nothing at all until
 * the analysis ran).
 */
export function buildBuiltinAnalysis(decl: BuiltinAnalysisDecl): AnalysisModule<readonly DataRow[], AnalysisOutput> {
  const problems: string[] = [];
  validateBuiltinAnalysis(decl, 'builtin analysis', problems);
  if (problems.length > 0) throw new BuiltinAnalysisError(problems);
  // `builtin` names the factory; every OTHER key is that factory's own option,
  // which is what makes this a rest-spread rather than a per-field copy.
  switch (decl.builtin) {
    case 'groupBy':
      return groupByAnalysis(optionsOf(decl));
    case 'correlation':
      return correlationAnalysis(optionsOf(decl));
    case 'regression':
      return regressionAnalysis(optionsOf(decl));
    case 'clustering':
      return clusteringAnalysis(optionsOf(decl));
  }
}
