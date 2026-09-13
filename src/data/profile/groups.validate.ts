import type { GroupProfilePlan } from './groups.types.js';
import type { ProfilePlan } from './types.js';
import { declaration, invalid, normalizePlan, positiveLimit, PROFILE_DEFAULT_LIMITS, record, textId } from './validate.js';

export const GROUP_PROFILE_DEFAULT_LIMITS = Object.freeze({ ...PROFILE_DEFAULT_LIMITS, maxGroups: 128, maxGroupFields: 4096 });

/** Translate only the operation envelope; expression, source and field semantics stay identical. */
export function groupBasePlan(plan: GroupProfilePlan): ProfilePlan {
  const { groupBy: _groupBy, unknownKeys: _unknownKeys, limits, ...base } = plan;
  if (limits === undefined) return { ...base, kind: 'profile' };
  const { maxGroups: _maxGroups, maxGroupFields: _maxGroupFields, ...profileLimits } = limits;
  return { ...base, kind: 'profile', limits: profileLimits };
}

export function normalizeGroupPlan(input: GroupProfilePlan): GroupProfilePlan {
  const plan = declaration(input);
  const obj = record(plan, ['kind', 'version', 'ops', 'source', 'selectionRef', 'where', 'fields', 'quantileMethod', 'limits', 'groupBy', 'unknownKeys'], 'group profile');
  if (obj.kind !== 'group-profile') invalid('Unsupported group profile kind');
  if (!Array.isArray(obj.groupBy) || obj.groupBy.length < 1 || obj.groupBy.length > 4) invalid('groupBy requires 1 to 4 column names');
  const seen = new Set<string>();
  for (const field of obj.groupBy) {
    textId(field, 'groupBy column');
    if (seen.has(field)) invalid(`Repeated grouping column: ${field}`);
    seen.add(field);
  }
  if (obj.unknownKeys !== 'include' && obj.unknownKeys !== 'exclude') invalid('unknownKeys must explicitly be include or exclude');
  let maxGroups: number = GROUP_PROFILE_DEFAULT_LIMITS.maxGroups;
  let maxGroupFields: number = GROUP_PROFILE_DEFAULT_LIMITS.maxGroupFields;
  if ('limits' in obj) {
    const limits = record(obj.limits, Object.keys(GROUP_PROFILE_DEFAULT_LIMITS), 'group limits');
    if ('maxGroups' in limits) { positiveLimit(limits.maxGroups, 'maxGroups', 4096); maxGroups = limits.maxGroups; }
    if ('maxGroupFields' in limits) { positiveLimit(limits.maxGroupFields, 'maxGroupFields', 16_384); maxGroupFields = limits.maxGroupFields; }
  }
  const base = normalizePlan(groupBasePlan(plan));
  return Object.freeze({ ...base, kind: 'group-profile', groupBy: plan.groupBy, unknownKeys: plan.unknownKeys,
    limits: Object.freeze({ ...base.limits, maxGroups, maxGroupFields }),
  });
}
