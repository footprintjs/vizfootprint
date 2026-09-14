import { memoryProvider } from '../memoryProvider.js';
import { isRejection, type Row } from '../types.js';
import { ProfileError } from '../profile/error.js';
import { profileScan } from '../profile/scan.js';
import { declaration, invalid, normalizePlan, positiveLimit, record, textId } from '../profile/validate.js';
import type { ProfileScanResult } from '../profile/scan.types.js';
import type { RankLimits, RankOptions, RankPlan, RankProvider, RankResult, RankRow } from './types.js';

export const RANK_DEFAULT_LIMITS = Object.freeze({ maxScannedRows: 100_000, maxRetainedRows: 100_000, maxRetainedCharacters: 1_000_000, maxResultBytes: 131_072 });
const MAX = { maxScannedRows: 1_000_000, maxRetainedRows: 100_000, maxRetainedCharacters: 8_000_000, maxResultBytes: 1_048_576 };

/** Shared with the native builtin's declaration judge. No source is read here. */
export function normalizeRankPlan(input: RankPlan): RankPlan {
  const p = record(declaration(input), ['kind', 'version', 'ops', 'source', 'selectionRef', 'where', 'keys', 'metric', 'direction', 'limit', 'missing', 'ties', 'limits'], 'rank plan');
  if (p.kind !== 'rank' || p.version !== 1) invalid('Rank requires kind rank and version 1');
  if (p.direction !== 'asc' && p.direction !== 'desc') invalid('Rank direction must be asc or desc');
  if (p.missing !== 'exclude' || p.ties !== 'keys-ascending') invalid('Rank requires explicit missing:exclude and ties:keys-ascending');
  if (!Array.isArray(p.keys) || p.keys.length < 1 || p.keys.length > 4 || new Set(p.keys).size !== p.keys.length) invalid('Rank requires 1 to 4 distinct complete key fields');
  for (const key of p.keys) textId(key, 'rank key');
  textId(p.metric, 'rank metric'); positiveLimit(p.limit, 'rank limit', 100);
  if (p.keys.includes(p.metric)) invalid('Rank metric cannot also be an identity key');
  const limits: Record<keyof RankLimits, number> = { ...RANK_DEFAULT_LIMITS };
  if (p.limits !== undefined) {
    const overrides = record(p.limits, Object.keys(limits), 'rank limits');
    for (const key of Object.keys(overrides) as (keyof RankLimits)[]) {
      positiveLimit(overrides[key], key, MAX[key]); limits[key] = overrides[key] as number;
    }
  }
  // The existing expression/plan validator owns source IDs, ops and the predicate tree.
  const common = normalizePlan({ kind: 'profile', version: 1, ops: p.ops as number, source: p.source as RankPlan['source'], selectionRef: p.selectionRef as string,
    ...(p.where === undefined ? {} : { where: p.where as RankPlan['where'] }), fields: [{ field: p.metric, statistics: ['max'] }] });
  return declaration({ kind: 'rank', version: 1, ops: common.ops, source: common.source, selectionRef: common.selectionRef,
    ...(common.where === undefined ? {} : { where: common.where }), keys: p.keys as string[], metric: p.metric, direction: p.direction,
    limit: p.limit, missing: 'exclude', ties: 'keys-ascending', limits });
}

/** Rank a complete provider snapshot. The host owns immutable source identity, persistence and authorization. */
export async function rankData(provider: RankProvider, input: RankPlan, options: RankOptions): Promise<RankResult> {
  const plan = normalizeRankPlan(input);
  const limits = plan.limits as Required<RankLimits>;
  const scanPlan = normalizePlan({ kind: 'profile', version: 1, ops: plan.ops, source: plan.source, selectionRef: plan.selectionRef,
    ...(plan.where === undefined ? {} : { where: plan.where }), fields: [{ field: plan.metric, statistics: ['max'] }],
    limits: { maxScannedRows: limits.maxScannedRows, maxRetainedValues: limits.maxRetainedRows * (plan.keys.length + 1), maxRetainedCharacters: limits.maxRetainedCharacters } });
  let answer: RankResult | undefined;
  const scanned = await profileScan(provider, {
    operation: 'rank', plan: scanPlan, options,
    create(schema, reserve) {
      for (const key of plan.keys) {
        const column = schema.columns.find(c => c.name === key);
        if (!column || !['identifier', 'dimension'].includes(column.role)) invalid(`Rank key must be a declared identifier or dimension: ${key}`);
      }
      const retained: Row[] = [], identities = new Set<string>();
      let missing = 0, visited = 0;
      return {
        reads: plan.keys,
        visit(read) {
          if (++visited > limits.maxRetainedRows) throw new ProfileError('PROFILE_LIMIT', 'Rank exceeds maxRetainedRows; no complete result is available');
          const keys = plan.keys.map(key => {
            const value = read(key);
            if (value === null || (typeof value === 'string' && value.length === 0)) throw new ProfileError('INVALID_VALUE', `Rank requires complete nonempty keys: ${key}`);
            reserve('group-key', value); return value;
          });
          const identity = JSON.stringify(keys);
          if (identities.has(identity)) throw new ProfileError('INVALID_VALUE', 'Rank key tuple is not unique in the source snapshot');
          identities.add(identity);
        },
        push(read) {
          const keys = plan.keys.map(key => read(key));
          const value = read(plan.metric); reserve('exact', value);
          if (value === null) { missing++; return; }
          // profileScan already applied the numeric-measure schema and rejects nonfinite/coerced values.
          retained.push(Object.fromEntries([...plan.keys.map((key, i) => [key, keys[i]]), [plan.metric, value]]));
        },
        async finish() {
          let rows: readonly RankRow[] = [];
          if (retained.length) {
            // One existing ordering implementation; source order cannot decide equal metrics because keys are complete and unique.
            const sorted = await memoryProvider({ ranking: retained }).evaluate('ranking', null, {
              sort: [{ field: plan.metric, dir: plan.direction, absent: 'last' }, ...plan.keys.map(field => ({ field, dir: 'asc' as const }))], limit: plan.limit,
            });
            if (isRejection(sorted)) throw new ProfileError('PROVIDER_FAILURE', sorted.detail ?? 'Rank sort was refused');
            rows = (sorted.rows ?? []).map((row, index) => ({ position: index + 1, value: row[plan.metric] as number,
              sourceRef: { source: schema.source, table: schema.table, keys: Object.fromEntries(plan.keys.map(key => [key, row[key]])) as RankRow['sourceRef']['keys'] } }));
          }
          return { rows, known: retained.length, missing };
        },
      };
    },
    validateResult(result: ProfileScanResult<{ rows: readonly RankRow[]; known: number; missing: number }>) {
      answer = declaration({ kind: 'rank', version: 1, operationId: result.operationId, resultRef: result.resultRef, plan, schema: result.schema,
        population: { ...result.population, known: result.value.known, missing: result.value.missing }, rows: result.value.rows,
        shown: result.value.rows.length, total: result.value.known, complete: result.value.rows.length === result.value.known,
        execution: { ...result.execution, strategy: 'bounded-scan-then-provider-sort' },
        conventions: { population: 'provider-snapshot', missing: 'exclude-null-or-undefined', invalid: 'refuse', ties: 'keys-ascending', position: 'ordinal', boundaryTies: 'may-be-split', authorization: 'host-owned-references' } });
      // Reserve the possible final observer failure before emitting completed; the returned receipt uses the actual count.
      if (new TextEncoder().encode(JSON.stringify({ ...answer, execution: { ...answer.execution, observerFailures: answer.execution.observerFailures + 1 } })).byteLength > limits.maxResultBytes) throw new ProfileError('PROFILE_LIMIT', 'Rank result exceeds maxResultBytes; request fewer rows');
    },
  });
  return declaration({ ...answer!, execution: { ...answer!.execution, observerFailures: scanned.execution.observerFailures } });
}
