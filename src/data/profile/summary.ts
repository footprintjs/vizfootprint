import type { GroupProfileResult } from './groups.types.js';
import type { ProfileColumn, ProfileFieldResult, ProfileResult } from './types.js';
import { declaration, invalid, normalizeSchema, positiveLimit, textId } from './validate.js';
import { ProfileError } from './error.js';

export interface ProfileSummaryOptions {
  /** Expose selected field definitions and values; omitted fields remain counted. Defaults to the first eight. */
  readonly fields?: readonly string[];
  readonly groupOffset?: number;
  readonly groupLimit?: number;
  readonly frequencyLimit?: number;
  /** UTF-16 JSON characters, not model tokens. Refuses overflow rather than clipping meaning. */
  readonly maxCharacters?: number;
}
export interface ProfileSummaryValue {
  readonly field: string;
  readonly known: number;
  readonly unknown: number;
  readonly statistics?: ProfileFieldResult['statistics'];
  readonly frequencies?: {
    readonly values: NonNullable<ProfileFieldResult['frequencies']>;
    readonly totalDistinct: number;
    readonly omitted: number;
    readonly order: 'value-ascending';
  };
}
export interface ProfileResultSummary {
  readonly version: 1;
  readonly operation: 'profile' | 'group-profile';
  readonly resultRef: string;
  readonly operationId: string;
  readonly source: ProfileResult['schema']['source'];
  readonly selection: { readonly ref: string; readonly where?: ProfileResult['plan']['where'] };
  readonly inputGrain: string;
  readonly outputGrain: string;
  readonly population: ProfileResult['population'] | GroupProfileResult['population'];
  readonly method: {
    readonly quantileMethod: ProfileResult['plan']['quantileMethod'] | null;
    readonly statisticsPopulation: string;
    readonly exact: boolean;
    readonly arithmetic: 'IEEE-754';
  };
  readonly fieldDefinitions: readonly ProfileColumn[];
  readonly fieldCoverage: { readonly total: number; readonly returned: number; readonly omitted: number };
  readonly values?: readonly ProfileSummaryValue[];
  readonly grouping?: { readonly by: readonly string[]; readonly unknownKeys: 'include' | 'exclude'; readonly order: 'first-seen'; readonly fieldDefinitions: readonly ProfileColumn[] };
  readonly groups?: readonly {
    readonly ref: GroupProfileResult['groups'][number]['ref'];
    readonly keys: GroupProfileResult['groups'][number]['keys'];
    readonly rowCount: number;
    readonly values: readonly ProfileSummaryValue[];
  }[];
  readonly groupPage?: { readonly total: number; readonly offset: number; readonly returned: number; readonly nextOffset: number | null };
  readonly explanation: string;
  readonly notes: readonly string[];
}

/** Project an engine-produced receipt for a UI or model. No row access, execution or reference authentication. */
export function summarizeProfileResult(result: ProfileResult | GroupProfileResult, options: ProfileSummaryOptions = {}): ProfileResultSummary {
  const { fields, groupOffset = 0, groupLimit = 3, frequencyLimit = 5, maxCharacters = 16_000 } = options;
  positiveLimit(groupLimit, 'groupLimit', 16); positiveLimit(frequencyLimit, 'frequencyLimit', 16);
  positiveLimit(maxCharacters, 'maxCharacters', 64_000);
  if (!Number.isSafeInteger(groupOffset) || groupOffset < 0) invalid('groupOffset must be a nonnegative integer');
  if (result.kind !== 'profile' && result.kind !== 'group-profile') invalid('Unsupported result kind');
  if (result.kind === 'profile' && groupOffset !== 0) invalid('A profile result has no group pages');
  const schema = normalizeSchema(result.schema);
  const requested = result.plan.fields.map(field => field.field);
  const selected = declaration(fields === undefined ? requested.slice(0, 8) : fields);
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 16) invalid('Summary requires 1 to 16 fields');
  const seen = new Set<string>();
  for (const name of selected) {
    textId(name, 'summary field');
    if (seen.has(name) || !requested.includes(name)) invalid(`Unknown or repeated result field: ${name}`);
    seen.add(name);
  }
  const columns = new Map(schema.columns.map(column => [column.name, column]));
  // This is a projection of a trusted engine receipt. Validate selected structure
  // and bounded JSON output, but never imply that this recomputes source facts.
  const definitions = (names: readonly string[]): readonly ProfileColumn[] => names.map(name => {
    const column = columns.get(name);
    if (!column) invalid(`Missing result field definition: ${name}`);
    return column;
  });
  const values = (input: readonly ProfileFieldResult[]): readonly ProfileSummaryValue[] => selected.map(name => {
    const field = input.find(value => value.field === name);
    if (!field) invalid(`Missing result field values: ${name}`);
    return {
      field: name, known: field.known, unknown: field.unknown,
      ...(field.statistics === undefined ? {} : { statistics: field.statistics }),
      ...(field.frequencies === undefined ? {} : { frequencies: {
        values: field.frequencies.slice(0, frequencyLimit), totalDistinct: field.frequencies.length,
        omitted: Math.max(0, field.frequencies.length - frequencyLimit), order: 'value-ascending' as const,
      } }),
    };
  });
  const grouped = result.kind === 'group-profile';
  const visible = grouped ? result.groups.slice(groupOffset, groupOffset + groupLimit) : [];
  const end = groupOffset + visible.length;
  const summary: ProfileResultSummary = {
    version: 1, operation: result.kind, operationId: result.operationId, resultRef: result.resultRef,
    source: schema.source,
    selection: { ref: result.plan.selectionRef, ...(result.plan.where === undefined ? {} : { where: result.plan.where }) },
    inputGrain: schema.grain,
    outputGrain: grouped ? `One summary per group of ${result.plan.groupBy.join(', ')}` : 'One summary of the selected source rows',
    population: result.population,
    method: { quantileMethod: result.plan.quantileMethod ?? null, statisticsPopulation: result.conventions.statisticsPopulation,
      exact: result.execution.exact, arithmetic: 'IEEE-754' },
    fieldDefinitions: definitions(selected), fieldCoverage: { total: requested.length, returned: selected.length, omitted: requested.length - selected.length },
    ...(grouped ? {
      grouping: { by: result.plan.groupBy, unknownKeys: result.plan.unknownKeys, order: result.groupOrder, fieldDefinitions: definitions(result.plan.groupBy) },
      groups: visible.map(group => ({ ref: group.ref, keys: group.keys, rowCount: group.rowCount, values: values(group.fields) })),
      groupPage: { total: result.groups.length, offset: groupOffset, returned: visible.length, nextOffset: end < result.groups.length ? end : null },
    } : { values: values(result.fields) }),
    explanation: `${result.population.selected} of ${result.population.scanned} source rows matched the selection. Input grain: ${schema.grain}.`,
    notes: [
      'Row counts describe the declared input grain; they do not establish distinct entity counts.',
      'Statistics describe known contributing values; grouped statistics describe each group separately. Unknown values are reported separately; zero and false are known.',
      'Null statistics mean no applicable estimate; they do not mean zero. Sample standard deviation requires two known values.',
      'A percentile of already aggregated measurements describes those measurements, not the original observations.',
      'This is a bounded projection of a saved result. Omitted fields, groups or frequency values are explicitly counted; frequency previews are not a ranking.',
      'Result references and group indices require host-managed lookup and source scope. A computed observation does not establish a causal explanation.',
    ],
  };
  if (JSON.stringify(summary).length > maxCharacters) throw new ProfileError('PROFILE_LIMIT', 'Summary exceeds maxCharacters; select fewer fields or groups');
  return declaration(summary);
}
