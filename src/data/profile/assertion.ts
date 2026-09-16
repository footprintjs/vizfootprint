import type { AssertionStratum, ProfileAssertion } from './assertion.types.js';
import type { ProfileResult, ProfileStatistic } from './types.js';
import { PROFILE_STATISTICS } from './operations.types.js';
import { declaration, invalid, normalizePlan, normalizeSchema, record, sameSource, textId, validateSelection } from './validate.js';

export interface ProfileStatisticAssertionOptions {
  /** Exact declared numeric measure whose statistic was requested and computed. */
  readonly field: string;
  /** One existing computed scalar; this projection does not calculate it again. */
  readonly statistic: ProfileStatistic;
  /** Host-owned comparison namespace, for example a scoped investigation ID. */
  readonly scope: string;
  /** Explicit host-owned nonnegative integer comparison version; not an inferred timestamp. */
  readonly epoch: number;
  /** Explicit current assertion or retained quotation; the host establishes which applies. */
  readonly stratum: AssertionStratum;
}

/** Stable serialization of already validated JSON; object insertion order is not identity. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function count(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a nonnegative safe integer`);
}

/**
 * Project one already computed statistic from a trusted profile receipt. No data scan,
 * freshness check, claim extraction, unit conversion or answer enforcement occurs here.
 * A comparator finding no conflict does not establish that an answer is verified.
 */
export function profileStatisticAssertion(result: ProfileResult, options: ProfileStatisticAssertionOptions): ProfileAssertion {
  const input = declaration(options);
  const config = record(input, ['field', 'statistic', 'scope', 'epoch', 'stratum'], 'statistic assertion options');
  textId(config.field, 'field'); textId(config.scope, 'scope'); count(config.epoch, 'epoch');
  if (config.stratum !== 'asserted' && config.stratum !== 'quoted') invalid('stratum must explicitly be asserted or quoted');
  if (!(PROFILE_STATISTICS as readonly unknown[]).includes(config.statistic)) invalid('Unknown profile statistic');
  if (result?.kind !== 'profile' || result.version !== 1) invalid('Expected a version 1 profile result');
  const plan = normalizePlan(result.plan), schema = normalizeSchema(result.schema);
  sameSource(plan.source, schema.source); validateSelection(plan, schema);
  const requested = plan.fields.find(field => field.field === input.field);
  if (!requested?.statistics?.includes(input.statistic)) invalid('The selected statistic was not requested for this field');
  if (!Array.isArray(result.fields) || result.fields.length > 32) invalid('Invalid profile result fields');
  const matches = result.fields.filter(field => field?.field === input.field);
  if (matches.length !== 1) invalid('Expected exactly one result for the selected field');
  const selected = matches[0]!;
  const column = schema.columns.find(field => field.name === input.field)!;
  if (selected.type !== column.type || selected.role !== column.role || selected.unit !== column.unit || selected.meaning !== column.meaning) {
    invalid('Result field metadata does not match its declared schema');
  }
  count(selected.known, 'known'); count(selected.unknown, 'unknown'); count(result.population?.selected, 'selected population');
  if (selected.known + selected.unknown !== result.population.selected) invalid('Field coverage does not match the selected population');
  if (!selected.statistics || !Object.hasOwn(selected.statistics, input.statistic)) invalid('The requested statistic is absent from the result');
  const value = selected.statistics[input.statistic];
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) invalid('A statistic must be a finite number or null');
  const undefinedEstimate = selected.known === 0 || (input.statistic === 'stddevSample' && selected.known < 2);
  if ((value === null) !== undefinedEstimate) invalid('The statistic does not match its declared known-value coverage');
  const conventions = declaration(result.conventions);
  if (conventions?.missing !== 'null-or-undefined' || conventions.invalid !== 'refuse' || conventions.predicate !== 'only-true' ||
      conventions.statisticsPopulation !== 'known-selected-values' || result.execution?.exact !== true) {
    invalid('Unsupported profile statistic population or execution conventions');
  }
  textId(result.resultRef, 'resultRef'); textId(result.operationId, 'operationId');
  const quantile = input.statistic === 'median' || input.statistic === 'p95';
  return declaration({
    subject: {
      kind: 'profile-selection',
      id: canonical(['viz-profile-selection', 1, input.scope, schema.source.id, schema.source.version,
        schema.table, plan.selectionRef, plan.ops, plan.where ?? null]),
    },
    predicate: canonical(['viz-profile-statistic', 1, input.field, input.statistic,
      column.unit ?? null, schema.grain, column.meaning, conventions.statisticsPopulation,
      conventions.missing, conventions.invalid, conventions.predicate,
      quantile ? plan.quantileMethod : null, 'IEEE-754', 'exact-selected-population']),
    value: value === null ? {
      kind: 'unknown',
      reason: selected.known === 0 ? 'No known selected values' : 'Sample standard deviation requires at least two known selected values',
    } : value,
    epoch: input.epoch,
    stratum: input.stratum,
    provenance: canonical({ resultRef: result.resultRef, operationId: result.operationId,
      field: input.field, statistic: input.statistic, known: selected.known, unknown: selected.unknown }),
  });
}
