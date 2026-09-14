// Frozen synthetic tasks. Expected answers stay in the evaluator, never in model requests.
import { createHash } from 'node:crypto';
const column = (name, type, role, meaning, unit) => ({ name, type, role, meaning, ...(unit ? { unit } : {}) });
const requestColumns = [
  column('client', 'string', 'identifier', 'Exact client identity within this snapshot'),
  column('operation', 'string', 'dimension', 'Recorded request operation'),
  column('durationMs', 'number', 'measure', 'Known completed request duration; missing values are not zero', 'ms'),
];
const requestRows = [
  { client: 'client-a', operation: 'read', durationMs: 10 },
  { client: 'client-a', operation: 'read', durationMs: 30 },
  { client: 'client-b', operation: 'read', durationMs: null },
  { client: null, operation: 'read', durationMs: 8 },
  { operation: 'read', durationMs: 12 },
  { client: 'client-b', operation: 'write', durationMs: 99 },
];
const reads = { op: 'eq', args: [{ col: 'operation' }, { lit: 'read' }] };
const statistics = ['sum', 'mean', 'p95'];
const baseClaim = {
  supported: true, populationBasis: 'source-row', selected: null, grouped: null,
  excludedUnknownKeys: null, knownDenominator: null, unknownCount: null,
  mean: null, p95: null, sum: null, groupCount: null, groups: [], reasonCode: 'none',
};
function fixture(id, task, rows, expected, options = {}) {
  // Human-readable testcase names contain outcomes; only opaque refs may reach a model.
  const identity = createHash('sha256').update(id).digest('hex').slice(0, 24);
  const source = { id: 'synthetic:source:' + identity, version: 'frozen-v1' };
  const field = options.field ?? 'durationMs';
  const schema = { source, table: options.table ?? 'requests', grain: options.grain ?? 'one saved request', columns: options.columns ?? requestColumns };
  const plan = {
    kind: options.groupBy ? 'group-profile' : 'profile', version: 1, ops: 1, source,
    selectionRef: 'synthetic:selection:' + identity,
    ...(options.where === false ? {} : { where: options.where ?? reads }),
    fields: [{ field, statistics: options.statistics ?? statistics }],
    ...((options.statistics ?? statistics).includes('p95') ? { quantileMethod: 'nearest-rank' } : {}),
    ...(options.groupBy ? { groupBy: options.groupBy, unknownKeys: options.unknownKeys } : {}),
  };
  return { id, task, schema, rows, field, plan, expected: { ...baseClaim, ...expected }, expectedRefusal: options.refusal ?? null };
}

const grouped = [
  { keys: { client: 'client-a', operation: 'read' }, rowCount: 2, known: 2, unknown: 0, mean: 20, p95: 30, sum: 40 },
  { keys: { client: 'client-b', operation: 'read' }, rowCount: 1, known: 0, unknown: 1, mean: null, p95: null, sum: null },
  { keys: { client: null, operation: 'read' }, rowCount: 2, known: 2, unknown: 0, mean: 10, p95: 12, sum: 20 },
];
export const cases = freeze([
  fixture('selected-known-denominator',
    'For read operations only, profile durationMs: sum, mean, and nearest-rank p95. Report the selected row count and the known-value denominator, preserving missing durations.',
    [{ operation: 'read', durationMs: 0 }, { operation: 'read', durationMs: 20 }, { operation: 'read', durationMs: null }, { operation: 'write', durationMs: 100 }, { operation: null, durationMs: 8 }],
    { selected: 3, knownDenominator: 2, unknownCount: 1, sum: 20, mean: 10, p95: 20 }),
  fixture('group-include-unknown',
    'For read operations only, give durationMs sum, mean and nearest-rank p95 separately for each client and operation. Include unknown grouping keys. Report each group separately and distinguish source rows from result groups.',
    requestRows,
    { populationBasis: 'group', selected: 5, grouped: 5, excludedUnknownKeys: 0, groupCount: 3, groups: grouped },
    { groupBy: ['client', 'operation'], unknownKeys: 'include' }),
  fixture('group-exclude-unknown',
    'For read operations only, give durationMs sum, mean and nearest-rank p95 separately for each client and operation. Exclude rows with unknown grouping keys from groups, but report how many selected source rows that excluded.',
    requestRows,
    { populationBasis: 'group', selected: 5, grouped: 3, excludedUnknownKeys: 2, groupCount: 2, groups: grouped.slice(0, 2) },
    { groupBy: ['client', 'operation'], unknownKeys: 'exclude' }),
  fixture('empty-selection',
    'For delete operations only, profile durationMs sum, mean and nearest-rank p95. State the selected and known-value counts, and preserve the numerical meaning of an empty selection.',
    requestRows,
    { selected: 0, knownDenominator: 0, unknownCount: 0 },
    { where: { op: 'eq', args: [{ col: 'operation' }, { lit: 'delete' }] } }),
  fixture('all-unknown-measure',
    'For read operations only, profile durationMs sum, mean and nearest-rank p95. Report the selected, known and unknown counts without treating absent measurements as zero.',
    [{ operation: 'read', durationMs: null }, { operation: 'read' }],
    { selected: 2, knownDenominator: 0, unknownCount: 2 }),
  fixture('numeric-identifier-refusal',
    'What is the average customerCode across these customer records?',
    [{ customerCode: 1001 }, { customerCode: 9001 }],
    { supported: false, populationBasis: 'unavailable', reasonCode: 'numeric-identifier' },
    { table: 'customers', grain: 'one saved customer', field: 'customerCode', where: false, statistics: ['mean'], refusal: 'numeric-identifier',
      columns: [column('customerCode', 'number', 'identifier', 'Assigned customer identity code; numeric representation is not a measured quantity')] }),
  fixture('aggregate-grain-refusal',
    'What is the nearest-rank p95 of individual request durations?',
    [{ client: 'client-a', meanDurationMs: 10, requestCount: 100 }, { client: 'client-b', meanDurationMs: 100, requestCount: 1 }],
    { supported: false, populationBasis: 'unavailable', reasonCode: 'aggregate-grain' },
    { table: 'client_summaries', grain: 'one per-client aggregate row, not one request', field: 'meanDurationMs', where: false, statistics: ['p95'], refusal: 'aggregate-grain',
      columns: [column('client', 'string', 'identifier', 'Client summarized by this row'), column('meanDurationMs', 'number', 'measure', 'Already aggregated arithmetic mean of request durations within this client', 'ms'), column('requestCount', 'number', 'measure', 'Number of requests summarized by this row')] }),
  fixture('aggregate-grain-interpretation',
    'Compute the unweighted arithmetic mean of the saved meanDurationMs values, one value per client summary row. This asks about per-client aggregates, not a request-weighted mean. Report the population grain and known-value denominator.',
    [{ client: 'client-a', meanDurationMs: 10, requestCount: 100 }, { client: 'client-b', meanDurationMs: 100, requestCount: 1 }, { client: 'client-c', meanDurationMs: null, requestCount: 5 }],
    { populationBasis: 'aggregate-row', selected: 3, knownDenominator: 2, unknownCount: 1, mean: 55 },
    { table: 'client_summaries', grain: 'one per-client aggregate row, not one request', field: 'meanDurationMs', where: false, statistics: ['mean'],
      columns: [column('client', 'string', 'identifier', 'Client summarized by this row'), column('meanDurationMs', 'number', 'measure', 'Already aggregated arithmetic mean of request durations within this client', 'ms'), column('requestCount', 'number', 'measure', 'Number of requests summarized by this row')] }),
]);

function freeze(value) {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
