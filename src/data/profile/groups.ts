import { createGroupConsumer } from './groups.consumer.js';
import { groupBasePlan, normalizeGroupPlan } from './groups.validate.js';
import { profileScan } from './scan.js';
import type { GroupProfileOptions, GroupProfilePlan, GroupProfileResult } from './groups.types.js';
import type { ProfileProvider } from './types.js';

/** Partition and reduce in one source scan. Output references name groups in this saved result. */
export async function profileGroups(provider: ProfileProvider, input: GroupProfilePlan, options: GroupProfileOptions): Promise<GroupProfileResult> {
  const plan = normalizeGroupPlan(input);
  const { value, ...receipt } = await profileScan(provider, {
    operation: 'group-profile', plan: groupBasePlan(plan), options,
    create(schema, reserve, resultRef) { return createGroupConsumer(schema, plan, resultRef, reserve); },
  });
  return { ...receipt, kind: 'group-profile', version: 1, plan,
    grain: { kind: 'group', groupBy: plan.groupBy, sourceGrain: receipt.schema.grain },
    groupOrder: 'first-seen', groups: value.groups,
    population: { ...receipt.population, grouped: value.grouped, withUnknownKeys: value.withUnknownKeys, excludedUnknownKeys: value.excludedUnknownKeys },
    conventions: { ...receipt.conventions, statisticsPopulation: 'known-selected-group-values' },
  };
}
