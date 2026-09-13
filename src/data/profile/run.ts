import { createFieldAccumulator } from './accumulator.js';
import { profileScan } from './scan.js';
import { normalizePlan } from './validate.js';
import type { ProfileOptions, ProfilePlan, ProfileProvider, ProfileResult } from './types.js';

/** Profile a selected snapshot using the same row walk as grouped profiling. */
export async function profileData(provider: ProfileProvider, input: ProfilePlan, options: ProfileOptions): Promise<ProfileResult> {
  const plan = normalizePlan(input);
  const { value: fields, ...receipt } = await profileScan(provider, {
    operation: 'profile', plan, options,
    create(schema, reserve) {
      const columns = new Map(schema.columns.map(column => [column.name, column]));
      const limits = plan.limits as Required<NonNullable<ProfilePlan['limits']>>;
      const accumulators = plan.fields.map(field => createFieldAccumulator(columns.get(field.field)!, field, {
        quantileMethod: plan.quantileMethod, maxExactValues: limits.maxExactValues, maxDistinctValues: limits.maxDistinctValues, reserve,
      }));
      return {
        reads: [],
        push(read) { for (let i = 0; i < accumulators.length; i++) accumulators[i]!.push(read(plan.fields[i]!.field)); },
        finish() { return accumulators.map(accumulator => accumulator.finish()); },
      };
    },
  });
  return { kind: 'profile', version: 1, plan, fields, ...receipt };
}
