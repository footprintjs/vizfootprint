import { OPS_VERSION } from '../../derive/types.js';
import type { Expr } from '../../derive/types.js';
import { ProfileError } from './error.js';
import { GROUP_PROFILE_DEFAULT_LIMITS, GROUP_PROFILE_MAXIMUM_LIMITS } from './groups.validate.js';
import { PROFILE_QUANTILE_METHODS, PROFILE_STATISTICS } from './operations.types.js';
import type { ProfileOperationDescriptor, ProfileOperationInputSchema, ProfileOperationKind, ProfileOperationSummary } from './operations.types.js';
import type { ProfileColumn, ProfileSchema } from './types.js';
import { declaration, normalizeSchema, PROFILE_DEFAULT_LIMITS, PROFILE_MAXIMUM_LIMITS, textId } from './validate.js';

const MAX_DESCRIPTOR_CHARACTERS = 60_000;
const WHERE_SHAPE_NOTE = 'where uses the existing Viz Expr vocabulary. Each node has exactly one of col, lit or op. A column node is {"col":"columnName"}; a literal node is {"lit":value}; an operation node is {"op":"eq","args":[columnNode,literalNode]}. Never combine col, lit and op in the same node. Combine predicates with {"op":"and","args":[predicate1,predicate2]}. Literal values must match the compared column type.';
const GROUP_FIELDS_NOTE = 'groupBy keys are already returned in each group\'s keys. fields requests separate coverage, statistics or frequencies; include a grouping key in fields only when its separate summary is requested. Request only the field summaries needed to answer the question.';

interface Definition {
  readonly summary: ProfileOperationSummary;
  readonly toolName: 'profile_data' | 'profile_groups';
  readonly outputGrain: string;
  readonly notes: readonly string[];
}

const COMMON_NOTES = Object.freeze([
  'Counts describe source row counts, not inferred distinct entity counts. These are descriptive statistics, not hypothesis tests or proof of causality.',
  'Only null and undefined are unknown. Zero and false are known. Invalid types and nonfinite numbers are refused without coercion. Each field reports known and unknown counts.',
  'Statistics use known selected values and retain the declared field unit; no unit conversion is performed. Numeric statistics require a number measure, not merely a numeric identifier. Frequencies count occurrences of known typed values and use ascending value order: numeric order, false before true, or code-unit string order. This is not a frequency ranking.',
  'sum adds known values; min and max select extremes; mean is their arithmetic average. stddevPopulation divides squared deviations by n; stddevSample uses n - 1. All requested statistics are null with no known values; sample deviation is also null for n < 2.',
  'median and p95 require an explicit quantileMethod. nearest-rank selects one-based rank ceil(p * n); linear uses Hyndman-Fan type 7 at zero-based position (n - 1) * p. Arithmetic is IEEE 754, not arbitrary precision.',
  'where uses the existing Viz Expr vocabulary and selects only rows whose answer is true. Predicate-unknown rows and excluded rows remain visible in population coverage. Existing runtime validators and the expression judge remain authoritative.',
  WHERE_SHAPE_NOTE,
  'Focused fields limit this metadata and the offered field/groupBy choices; they are not read authorization. Hosts enforce access and reference ownership, including any allowed where columns.',
  'Execution scans once. Exact quantiles and frequencies retain values under per-field and combined budgets; one pass does not mean constant memory. Exceeding a limit refuses a complete result without silent truncation or an approximate fallback. These budgets do not cap provider buffers or total process memory.',
  'The host supplies selectionRef in the plan and operationId/resultRef as execution options. Receipts retain the actual plan, source version, schema, coverage and methods. These APIs do not persist artifacts or authorize reference reads; providers must preserve the declared snapshot.',
  'Progress uses a synchronous onEvent observer: started, progress, and one completed/failed/cancelled terminal event. Returned thenables count as observer failures and are not awaited. Remote progress transport and UI state belong to the host. Cancellation stops waiting and requests provider cleanup; it does not prove an uncooperative provider released its resources.',
]);

const DEFINITIONS: readonly Definition[] = declaration([
  {
    summary: { id: 'profile', title: 'Profile selected data', description: 'Summarize coverage, requested statistics and optional frequencies for each chosen field over one selected source population.' },
    toolName: 'profile_data', outputGrain: 'One profile result with one field summary per requested field over the selected source rows.',
    notes: ['Statistics describe known selected values separately for each requested field. Source rows are not returned or reorganized.'],
  },
  {
    summary: { id: 'group-profile', title: 'Profile data by groups', description: 'Partition selected source rows by declared key values, then summarize coverage, requested statistics and optional frequencies within each group.' },
    toolName: 'profile_groups', outputGrain: 'One group entry per observed key tuple, with field summaries over that group\'s source rows.',
    notes: [
      'Choose one to four distinct grouping fields. Groups preserve typed tuples, including an explicit null key when included, and appear in first-seen order; this is not ranking or sorting.',
      GROUP_FIELDS_NOTE,
      'unknownKeys must explicitly be include or exclude. A selected row with any unknown key is counted in withUnknownKeys; exclude removes it only from grouping. selected = grouped + excludedUnknownKeys.',
      'Each group reports rowCount, per-field known/unknown counts and statistics from known selected values within that group. An unweighted average of group means does not recover the source mean when group populations differ.',
      'Group ref {resultRef,index} identifies a position in this result, not a stable entity or cross-result join key. Replay group.where with the same source snapshot, field requests and quantile method to reconstruct the group.',
      'Per-field exact and distinct-value caps apply per group/field pair. Shared budgets span all groups; every retained group-key component consumes a slot, including null, and string key characters count too. maxGroupFields also counts coverage-only fields.',
    ],
  },
]);
const SUMMARIES = Object.freeze(DEFINITIONS.map(definition => definition.summary));

/** Small immutable discovery list; this catalog names only implemented operations. */
export function listProfileOperations(): readonly ProfileOperationSummary[] { return SUMMARIES; }

const LIMIT_MEANINGS = Object.freeze({
  maxScannedRows: 'Maximum source rows scanned, including rows excluded by the predicate.',
  maxExactValues: 'Maximum retained exact-quantile values per field accumulator; for grouped profiles, per group/field pair.',
  maxDistinctValues: 'Maximum distinct frequency keys per field accumulator; for grouped profiles, per group/field pair.',
  maxRetainedValues: 'Combined exact slots, distinct frequency keys and, for grouped profiles, group-key components. Each retained representation is charged separately.',
  maxRetainedCharacters: 'Combined UTF-16 characters retained in string frequency keys and, for grouped profiles, string group keys.',
  maxGroups: 'Maximum observed groups; excess groups cause refusal rather than truncation.',
  maxGroupFields: 'Maximum group/field accumulator pairs, including coverage-only fields.',
});

function limitsSchema(grouped: boolean): Record<string, unknown> {
  const defaults = grouped ? GROUP_PROFILE_DEFAULT_LIMITS : PROFILE_DEFAULT_LIMITS;
  const maximums = { ...PROFILE_MAXIMUM_LIMITS, ...GROUP_PROFILE_MAXIMUM_LIMITS };
  return {
    type: 'object', additionalProperties: false,
    description: 'Optional positive integer budget overrides. The existing executor enforces these limits and refuses partial completion.',
    properties: Object.fromEntries(Object.entries(defaults).map(([name, value]) => [name, {
      type: 'integer', minimum: 1, maximum: maximums[name as keyof typeof maximums], default: value,
      description: LIMIT_MEANINGS[name as keyof typeof LIMIT_MEANINGS],
    }])),
  };
}

function fieldSchema(column: ProfileColumn): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    field: { type: 'string', const: column.name,
      description: `${column.meaning} Declared type: ${column.type}; role: ${column.role}; unit: ${column.unit ?? 'not declared'}.` },
    frequencies: { type: 'boolean', description: 'Include exact typed occurrence counts of known values, bounded by distinct-value and shared retention limits.' },
  };
  if (column.type === 'number' && column.role === 'measure') properties.statistics = {
    type: 'array', minItems: 1, maxItems: PROFILE_STATISTICS.length, uniqueItems: true,
    items: { type: 'string', enum: PROFILE_STATISTICS },
    description: 'Requested statistics over known selected values. median or p95 requires quantileMethod on the plan. Omitting statistics still returns known/unknown coverage.',
  };
  return { type: 'object', properties, required: ['field'], additionalProperties: false };
}

/** Illustrative values, never inferred source values or default predicates. */
function predicateExamples(fields: readonly ProfileColumn[]): readonly Expr[] {
  const equalities = fields.slice(0, 2).map((field): Expr => ({ op: 'eq', args: [
    { col: field.name }, { lit: field.type === 'number' ? 1 : field.type === 'boolean' ? true : 'example' },
  ] }));
  return equalities.length === 1 ? equalities : [equalities[0]!, { op: 'and', args: equalities }];
}

function inputSchema(schema: ProfileSchema, definition: Definition, fields: readonly ProfileColumn[], examples: readonly Expr[]): ProfileOperationInputSchema {
  const grouped = definition.summary.id === 'group-profile';
  const properties: Record<string, unknown> = {
    kind: { type: 'string', const: definition.summary.id },
    version: { type: 'integer', const: 1 },
    ops: { type: 'integer', const: OPS_VERSION, description: 'Existing Viz expression vocabulary version.' },
    source: {
      type: 'object', additionalProperties: false, required: ['id', 'version'],
      properties: { id: { type: 'string', const: schema.source.id }, version: { type: 'string', const: schema.source.version } },
      description: 'Bound to this source snapshot. A version label does not itself stabilize a changing provider.',
    },
    selectionRef: { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S', description: 'Host-owned selection identity. The result also retains the actual where predicate; this reference does not replace the filter.' },
    where: { type: 'object', examples, description: `Optional predicate. ${WHERE_SHAPE_NOTE} Examples illustrate shape with placeholder values; replace them with the requested criteria, or omit where to select all rows. The existing runtime judge validates vocabulary, types, boolean result, columns, depth and node limits. Only true selects a row. This schema does not define a second expression grammar.` },
    fields: {
      type: 'array', minItems: 1, maxItems: fields.length, uniqueItems: true,
      items: { oneOf: fields.map(fieldSchema) },
      description: 'Choose focused fields to profile. Each field name must occur once, even if its requested outputs differ; the runtime validator enforces this. Coverage is returned without requiring statistics or frequencies.' + (grouped ? ` ${GROUP_FIELDS_NOTE}` : ''),
    },
    quantileMethod: {
      type: 'string', enum: PROFILE_QUANTILE_METHODS,
      description: 'Required by runtime validation when any field requests median or p95. nearest-rank uses ceil(p*n), starting at rank one; linear uses Hyndman-Fan type 7 interpolation at (n-1)*p. No implicit method.',
    },
    limits: limitsSchema(grouped),
  };
  const required = ['kind', 'version', 'ops', 'source', 'selectionRef', 'fields'];
  if (grouped) {
    properties.groupBy = { type: 'array', minItems: 1, maxItems: Math.min(4, fields.length), uniqueItems: true,
      items: { type: 'string', enum: fields.map(field => field.name) }, description: 'Distinct focused columns whose typed values define groups. Their role need not be measure.' };
    properties.unknownKeys = { type: 'string', enum: ['include', 'exclude'], description: 'Explicitly include null/undefined-key tuples as groups, or exclude rows with any unknown key from grouping while reporting their coverage.' };
    required.push('groupBy', 'unknownKeys');
  }
  return { type: 'object', description: definition.summary.description, additionalProperties: false, properties, required };
}

/** Focused semantic metadata plus tool/UI projections. No scan, model call,
 * executor, reference store or read-authorization policy is created here. */
export function describeProfileOperation(schemaInput: ProfileSchema, kind: ProfileOperationKind, focusedFields: readonly string[]): ProfileOperationDescriptor {
  const definition = DEFINITIONS.find(entry => entry.summary.id === kind);
  if (!definition) throw new ProfileError('INVALID_PROFILE', 'Unknown profile operation');
  const schema = normalizeSchema(schemaInput);
  if (!Array.isArray(focusedFields) || focusedFields.length < 1 || focusedFields.length > 16)
    throw new ProfileError('INVALID_PROFILE', 'Operation metadata requires 1 to 16 distinct focused fields');
  const focus = declaration(focusedFields);
  const columns = new Map(schema.columns.map(column => [column.name, column]));
  const seen = new Set<string>();
  const fields = focus.map(name => {
    textId(name, 'focused field');
    if (seen.has(name)) throw new ProfileError('INVALID_PROFILE', `Repeated focused field: ${name}`);
    seen.add(name);
    const column = columns.get(name);
    if (!column) throw new ProfileError('INVALID_PROFILE', `Unknown focused field: ${name}`);
    if (!['number', 'string', 'boolean'].includes(column.type))
      throw new ProfileError('INVALID_PROFILE', `Operation metadata does not support ${column.type} field: ${name}`);
    return column;
  });
  const examples = predicateExamples(fields);
  const notes = [...COMMON_NOTES, ...definition.notes,
    `Predicate shape examples with placeholder values, not source facts or defaults; replace the values with the requested criteria: ${examples.map(example => JSON.stringify(example)).join('; ')}. Omit where to select all source rows.`];
  const descriptor: ProfileOperationDescriptor = {
    definitionVersion: 1, operation: definition.summary, source: schema.source, table: schema.table, grain: schema.grain, fields,
    tool: { name: definition.toolName, description: [definition.summary.description,
      `Input grain: ${schema.grain}. Output grain: ${definition.outputGrain}`, ...notes].join('\n\n'), inputSchema: inputSchema(schema, definition, fields, examples) },
    ui: { title: definition.summary.title, description: definition.summary.description,
      inputGrain: schema.grain, outputGrain: definition.outputGrain, notes },
  };
  if (JSON.stringify(descriptor).length > MAX_DESCRIPTOR_CHARACTERS)
    throw new ProfileError('PROFILE_LIMIT', 'Operation metadata exceeds 60000 characters; request fewer fields or shorter source descriptions');
  return declaration(descriptor);
}
