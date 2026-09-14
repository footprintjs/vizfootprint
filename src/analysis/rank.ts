import { flowChart } from 'footprintjs';
import { defineAnalysis } from './defineAnalysis.js';
import type { AnalysisModule, TableOutput } from './types.js';
import type { Row } from '../data/types.js';
import { rankData, normalizeRankPlan } from '../data/rank/run.js';
import type { RankPlan, RankResult } from '../data/rank/types.js';
import type { ProfileSchema } from '../data/profile/types.js';
import { createArrayProfileProvider } from '../data/profile/memory.js';
import { declaration, normalizeSchema, sameSource, textId, validateSelection } from '../data/profile/validate.js';

export interface RankAnalysisOptions {
  readonly schema: ProfileSchema; readonly plan: RankPlan;
  readonly operationId: string; readonly resultRef: string;
  readonly name?: string; readonly id?: string;
}
export interface RankTableOutput extends TableOutput { readonly ranking: RankResult }

/** Same validation for a serializable builtin and the public factory; no rows or provider calls. */
export function normalizeRankAnalysisOptions(input: RankAnalysisOptions): RankAnalysisOptions {
  const schema = normalizeSchema(input.schema), plan = normalizeRankPlan(input.plan);
  sameSource(schema.source, plan.source); textId(input.operationId, 'operationId'); textId(input.resultRef, 'resultRef');
  if (input.id !== undefined) textId(input.id, 'rank analysis id');
  if (input.name !== undefined) textId(input.name, 'rank result table name');
  validateSelection({ kind: 'profile', version: 1, ops: plan.ops, source: plan.source, selectionRef: plan.selectionRef,
    ...(plan.where === undefined ? {} : { where: plan.where }), fields: [{ field: plan.metric, statistics: ['max'] }] }, schema);
  for (const key of plan.keys) if (!schema.columns.some(c => c.name === key && ['identifier', 'dimension'].includes(c.role))) throw new Error(`Rank key must be a declared identifier or dimension: ${key}`);
  return declaration({ schema, plan, operationId: input.operationId, resultRef: input.resultRef,
    ...(input.name === undefined ? {} : { name: input.name }), ...(input.id === undefined ? {} : { id: input.id }) });
}

/** Existing analyze/table channel: a receipt, not a newly materialized native table or row-selection act. */
export function rankAnalysis(input: RankAnalysisOptions): AnalysisModule<readonly Row[], RankTableOutput> {
  const opts = normalizeRankAnalysisOptions(input);
  return defineAnalysis<readonly Row[], RankTableOutput>({
    id: opts.id ?? `rank:${opts.schema.table}:${opts.plan.metric}`, kind: 'transform', produces: 'table', requiresCompleteInput: true,
    inputs: opts.schema.columns.map(column => ({ column: column.name })),
    judgeTable(table, columns) {
      const problems: string[] = [];
      if (table !== opts.schema.table) problems.push(`Rank schema names table ${opts.schema.table}, not ${table}`);
      // Empty/all-unknown memory tables cannot infer a type. The complete scan still validates every observed cell against the declared schema.
      for (const field of columns.length === 0 ? [] : opts.schema.columns) {
        const actual = columns.find(column => column.name === field.name);
        if (!actual) problems.push(`Rank input table has no column ${field.name}`);
        else if (actual.type !== 'unknown' && actual.type !== field.type) problems.push(`Rank schema type disagrees for ${field.name}`);

      }
      return problems;
    },
    build: () => flowChart('rank the complete analysis input', async scope => {
      const args = scope.$getArgs<{ rows: readonly Row[] }>();
      const ranked = await rankData(createArrayProfileProvider(opts.schema, args.rows), opts.plan, { operationId: opts.operationId, resultRef: opts.resultRef });
      // The native session already selected this input; scanned does not claim the original estate was read again.
      const ranking: RankResult = declaration({ ...ranked, conventions: { ...ranked.conventions, population: 'analysis-input' } });
      scope.$setValue('ranking', ranking);
    }, 'rank').build(),
    toRunInput: rows => ({ rows }),
    readOutput: ({ snapshot }) => {
      const ranking = snapshot.sharedState.ranking as RankResult;
      const schema: TableOutput['schema'] = Object.fromEntries([...opts.plan.keys, opts.plan.metric].map(name => {
        const type = opts.schema.columns.find(column => column.name === name)!.type;
        return [name, type === 'number' ? 'float' : type];
      }));
      return { ok: true, output: { as: 'table', name: opts.name ?? `ranked_${opts.schema.table}`, schema,
        rows: ranking.rows.map(row => Object.fromEntries([...Object.entries(row.sourceRef.keys), [opts.plan.metric, row.value]])), ranking } };
    },
  });
}
