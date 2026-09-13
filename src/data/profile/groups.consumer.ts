import { judgeExpr } from '../../derive/judge.js';
import type { Cell, Expr } from '../../derive/types.js';
import { createFieldAccumulator } from './accumulator.js';
import { ProfileError } from './error.js';
import { groupBasePlan } from './groups.validate.js';
import type { GroupProfileLimits, GroupProfilePlan, ProfileGroup } from './groups.types.js';
import type { ProfileConsumer, ProfileReserve } from './scan.types.js';
import type { ProfileSchema } from './types.js';
import { declaration, normalizePlan } from './validate.js';

interface GroupState {
  readonly values: readonly Cell[];
  readonly where: Expr;
  readonly fields: readonly ReturnType<typeof createFieldAccumulator>[];
  rowCount: number;
}

/** Consume selected, typed cells from the shared scanner. The plan and its
 * limits have already been validated; no rows or reader closures are retained. */
export function createGroupConsumer(
  schema: ProfileSchema,
  input: GroupProfilePlan,
  resultRef: string,
  reserve: ProfileReserve,
): ProfileConsumer<{ groups: readonly ProfileGroup[]; grouped: number; withUnknownKeys: number; excludedUnknownKeys: number }> {
  const plan = declaration(input);
  const columns = new Map(schema.columns.map(column => [column.name, { ...column }]));
  const reads = plan.groupBy;
  const groupingColumns = reads.map(name => {
    const column = columns.get(name);
    if (!column) throw new ProfileError('INVALID_PROFILE', `Unknown grouping column: ${name}`);
    if (!['number', 'string', 'boolean'].includes(column.type))
      throw new ProfileError('INVALID_PROFILE', `Grouping ${column.type} columns is not supported: ${name}`);
    return column;
  });
  const base = groupBasePlan(plan);
  const limits = plan.limits as Required<GroupProfileLimits>;

  function groupWhere(values: readonly Cell[]): Expr {
    const tests: Expr[] = reads.map((name, index) => {
      const value = values[index]!;
      const args = Object.freeze(value === null ? [{ col: name }] : [{ col: name }, { lit: value }]);
      for (const arg of args) Object.freeze(arg);
      return Object.freeze({ op: value === null ? 'isAbsent' : 'eq', args });
    });
    const args = plan.where === undefined ? tests : [plan.where, ...tests];
    return args.length === 1 ? args[0]! : Object.freeze({ op: 'and', args: Object.freeze(args) });
  }

  // Adding key conditions must not yield a drill-down that the ordinary
  // expression judge rejects. Non-null placeholders use the larger key form.
  const placeholders = groupingColumns.map(column => column.type === 'string' ? '' : column.type === 'number' ? 0 : false);
  const judged = judgeExpr(groupWhere(placeholders), schema.table, schema.columns);
  if (!judged.ok) throw new ProfileError('INVALID_PROFILE', `Group drill-down is not replayable: ${judged.problem}`);

  const groups = new Map<string, GroupState>();
  let grouped = 0, withUnknownKeys = 0, excludedUnknownKeys = 0;
  let failed = false, failure: unknown;
  function latch(error: unknown): never { failed = true; failure = error; throw error; }

  return {
    reads,
    push(read) {
      if (failed) throw failure;
      try {
        const values = reads.map(name => { const cell = read(name); return cell === 0 ? 0 : cell; });
        const hasUnknown = values.some(cell => cell === null);
        if (hasUnknown) {
          withUnknownKeys++;
          if (plan.unknownKeys === 'exclude') { excludedUnknownKeys++; return; }
        }
        // Typed primitive tuples distinguish null from "null", preserve tuple
        // positions and escaping, and canonicalize -0 without delimiter joins.
        const identity = JSON.stringify(values);
        let group = groups.get(identity);
        if (!group) {
          if (groups.size >= limits.maxGroups) throw new ProfileError('PROFILE_LIMIT', 'Group profile exceeds maxGroups; no complete result is available');
          if ((groups.size + 1) * plan.fields.length > limits.maxGroupFields)
            throw new ProfileError('PROFILE_LIMIT', 'Group profile exceeds maxGroupFields; no complete result is available');
          const where = groupWhere(values);
          // Concrete strings also have to fit the replay plan's wire budget.
          // Retain the frozen composition, sharing its immutable base predicate,
          // rather than retaining this validation copy once for every group.
          normalizePlan({ ...base, where });
          for (const value of values) reserve('group-key', value);
          const fields = plan.fields.map(field => createFieldAccumulator(columns.get(field.field)!, field, {
            quantileMethod: plan.quantileMethod, maxExactValues: limits.maxExactValues,
            maxDistinctValues: limits.maxDistinctValues, reserve,
          }));
          group = { values: Object.freeze(values), where, fields, rowCount: 0 };
          groups.set(identity, group);
        }
        for (let index = 0; index < group.fields.length; index++) group.fields[index]!.push(read(plan.fields[index]!.field));
        group.rowCount++; grouped++;
      } catch (error) { latch(error); }
    },
    finish() {
      if (failed) throw failure;
      try {
        return {
          groups: [...groups.values()].map((group, index) => ({
            ref: { resultRef, index }, keys: Object.fromEntries(reads.map((name, at) => [name, group.values[at]!])),
            rowCount: group.rowCount, where: group.where, fields: group.fields.map(field => field.finish()),
          })),
          grouped, withUnknownKeys, excludedUnknownKeys,
        };
      } catch (error) { return latch(error); }
    },
  };
}
