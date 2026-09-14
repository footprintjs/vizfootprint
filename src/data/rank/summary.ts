import type { ProfileColumn } from '../profile/types.js';
import { ProfileError } from '../profile/error.js';
import { declaration, invalid, normalizeSchema, positiveLimit, record, sameSource, textId, validateSelection } from '../profile/validate.js';
import { normalizeRankPlan } from './run.js';
import { RANK_NOTES } from './semantics.js';
import type { RankResult, RankRow } from './types.js';

export interface RankSummaryOptions {
  /** Offset within the saved top-N result, not the source population. */
  readonly rowOffset?: number;
  /** Defaults to 3; at most 16 complete ranked references per response. */
  readonly rowLimit?: number;
  /** Strict JSON UTF-16 character budget, not bytes or model tokens. Defaults to 16000; maximum 64000. */
  readonly maxCharacters?: number;
}
export interface RankResultSummary {
  readonly version: 1;
  readonly operation: 'rank';
  readonly operationId: string;
  readonly resultRef: string;
  readonly source: RankResult['schema']['source'];
  readonly table: string;
  readonly selection: { readonly ref: string; readonly where?: RankResult['plan']['where'] };
  readonly inputGrain: string;
  readonly outputGrain: string;
  /** One definition for each key, the ranked measure and any remaining predicate fields. */
  readonly fieldDefinitions: readonly ProfileColumn[];
  readonly population: RankResult['population'];
  readonly method: { readonly exact: true; readonly aggregation: 'none'; readonly strategy: RankResult['execution']['strategy'] };
  readonly conventions: RankResult['conventions'];
  readonly ranking: {
    readonly keys: readonly string[]; readonly metric: string; readonly direction: 'asc' | 'desc'; readonly limit: number;
    /** Saved top-N rows, known population and top-N omissions; unaffected by summary paging. */
    readonly shown: number; readonly total: number; readonly omitted: number; readonly complete: boolean;
  };
  readonly rows: readonly RankRow[];
  readonly rowPage: {
    readonly offset: number; readonly returned: number;
    /** Saved top-N rows, not source population. */
    readonly total: number;
    /** All saved rows outside this page, including earlier pages. */
    readonly omitted: number;
    readonly nextOffset: number | null;
  };
  readonly notes: readonly string[];
}

function count(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a nonnegative safe integer`);
}

/** Project a trusted engine receipt. Validates its structure, not source truth, availability or authorization. */
export function summarizeRankResult(input: RankResult, options: RankSummaryOptions = {}): RankResultSummary {
  const controls = record(declaration(options), ['rowOffset', 'rowLimit', 'maxCharacters'], 'rank summary options');
  const rowOffset = controls.rowOffset === undefined ? 0 : controls.rowOffset;
  const rowLimit = controls.rowLimit === undefined ? 3 : controls.rowLimit;
  const maxCharacters = controls.maxCharacters === undefined ? 16_000 : controls.maxCharacters;
  count(rowOffset, 'rowOffset'); positiveLimit(rowLimit, 'rowLimit', 16); positiveLimit(maxCharacters, 'maxCharacters', 64_000);
  // Detach before reading any property, rejecting accessors, prototypes, cycles and nonfinite JSON even on omitted rows.
  const result = declaration(input);
  record(result, ['kind', 'version', 'operationId', 'resultRef', 'plan', 'schema', 'population', 'rows', 'shown', 'total', 'complete', 'execution', 'conventions'], 'rank result');
  if (result.kind !== 'rank' || result.version !== 1) invalid('Summary requires a version 1 rank result');
  textId(result.operationId, 'operationId'); textId(result.resultRef, 'resultRef');
  const schema = normalizeSchema(result.schema), plan = normalizeRankPlan(result.plan);
  sameSource(schema.source, plan.source);
  const reads = validateSelection({ kind: 'profile', version: 1, ops: plan.ops, source: plan.source, selectionRef: plan.selectionRef,
    ...(plan.where === undefined ? {} : { where: plan.where }), fields: [{ field: plan.metric, statistics: ['max'] }] }, schema);
  const columns = new Map(schema.columns.map(column => [column.name, column]));
  for (const key of plan.keys) {
    const column = columns.get(key);
    if (!column || !['identifier', 'dimension'].includes(column.role)) invalid(`Invalid rank key definition: ${key}`);
  }
  const population = record(result.population, ['scanned', 'selected', 'excluded', 'predicateUnknown', 'known', 'missing'], 'rank population');
  for (const key of ['scanned', 'selected', 'excluded', 'predicateUnknown', 'known', 'missing']) count(population[key], `population.${key}`);
  const p = result.population;
  if (p.selected + p.excluded !== p.scanned || p.known + p.missing !== p.selected || p.predicateUnknown > p.excluded) invalid('Inconsistent rank population counts');
  count(result.shown, 'shown'); count(result.total, 'total');
  if (!Array.isArray(result.rows) || result.rows.length > 100 || result.shown !== result.rows.length || result.total !== p.known || result.shown !== Math.min(plan.limit, p.known) || result.complete !== (result.shown === result.total)) invalid('Inconsistent saved rank coverage');
  const execution = record(result.execution, ['strategy', 'exact', 'passes', 'retainedValues', 'retainedCharacters', 'observerFailures', 'elapsedMs'], 'rank execution');
  if (execution.strategy !== 'bounded-scan-then-provider-sort' || execution.exact !== true || execution.passes !== 1) invalid('Unsupported rank execution');
  for (const key of ['retainedValues', 'retainedCharacters', 'observerFailures']) count(execution[key], `execution.${key}`);
  if (typeof execution.elapsedMs !== 'number' || execution.elapsedMs < 0) invalid('Invalid elapsedMs');
  const conventions = record(result.conventions, ['population', 'missing', 'invalid', 'ties', 'position', 'boundaryTies', 'authorization'], 'rank conventions');
  if (!['provider-snapshot', 'analysis-input'].includes(conventions.population as string) || conventions.missing !== 'exclude-null-or-undefined' || conventions.invalid !== 'refuse' || conventions.ties !== 'keys-ascending' || conventions.position !== 'ordinal' || conventions.boundaryTies !== 'may-be-split' || conventions.authorization !== 'host-owned-references') invalid('Unsupported rank conventions');
  const identities = new Set<string>();
  for (const [index, row] of result.rows.entries()) {
    record(row, ['position', 'value', 'sourceRef'], 'rank row');
    if (row.position !== index + 1 || typeof row.value !== 'number') invalid('Rank rows require ordinal positions and finite numeric values');
    record(row.sourceRef, ['source', 'table', 'keys'], 'rank source reference');
    record(row.sourceRef.source, ['id', 'version'], 'rank row source');
    sameSource(row.sourceRef.source, schema.source);
    if (row.sourceRef.table !== schema.table) invalid('Rank row names a different table');
    const keys = record(row.sourceRef.keys, plan.keys, 'rank row keys');
    for (const key of plan.keys) {
      const value = keys[key];
      if (typeof value !== columns.get(key)!.type || (typeof value === 'string' && !value.length)) invalid(`Rank reference requires the complete typed key: ${key}`);
    }
    const identity = JSON.stringify(plan.keys.map(key => keys[key]));
    if (identities.has(identity)) invalid('Repeated rank source key tuple');
    identities.add(identity);
  }
  const names = [...new Set([...plan.keys, plan.metric, ...reads])];
  const rows = result.rows.slice(rowOffset, rowOffset + rowLimit), end = rowOffset + rows.length;
  const summary: RankResultSummary = {
    version: 1, operation: 'rank', operationId: result.operationId, resultRef: result.resultRef,
    source: schema.source, table: schema.table, selection: { ref: plan.selectionRef, ...(plan.where === undefined ? {} : { where: plan.where }) },
    inputGrain: schema.grain, outputGrain: 'One ranked existing numeric observation with its complete source key tuple',
    fieldDefinitions: names.map(name => columns.get(name)!), population: result.population,
    method: { exact: true, aggregation: 'none', strategy: result.execution.strategy }, conventions: result.conventions,
    ranking: { keys: plan.keys, metric: plan.metric, direction: plan.direction, limit: plan.limit,
      shown: result.shown, total: result.total, omitted: result.total - result.shown, complete: result.complete },
    rows, rowPage: { offset: rowOffset, returned: rows.length, total: result.shown, omitted: result.shown - rows.length, nextOffset: end < result.shown ? end : null },
    notes: RANK_NOTES,
  };
  if (JSON.stringify(summary).length > maxCharacters) throw new ProfileError('PROFILE_LIMIT', 'Rank summary exceeds maxCharacters; request fewer rows. Required scope, meanings and complete keys are never clipped.');
  return declaration(summary);
}
