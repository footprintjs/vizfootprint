// Run after npm run build: node examples/profile-data.mjs [--sqlite]
// Synthetic data only. The optional SQLite fixture is temporary and in memory.
import assert from 'node:assert/strict';
import { profileData, createArrayProfileProvider } from 'vizfootprint/data';

const requestSchema = {
  source: { id: 'example:requests', version: 'fixture-v1' },
  table: 'requests',
  grain: 'one saved request',
  columns: [
    { name: 'id', type: 'string', role: 'identifier', meaning: 'Saved request identity' },
    { name: 'operation', type: 'string', role: 'dimension', meaning: 'Recorded operation' },
    { name: 'durationMs', type: 'number', role: 'measure', unit: 'ms', meaning: 'Known completed request duration' },
    { name: 'successful', type: 'boolean', role: 'dimension', meaning: 'Recorded success; null means unknown' },
  ],
};
const requests = [
  { id: 'r1', operation: 'read', durationMs: 10, successful: true },
  { id: 'r2', operation: 'read', durationMs: 30, successful: true },
  { id: 'r3', operation: 'read', durationMs: null, successful: null },
  { id: 'r4', operation: 'read', durationMs: 0, successful: false },
  { id: 'r5', operation: 'write', durationMs: 100, successful: true },
];
const requestPlan = {
  kind: 'profile', version: 1, ops: 1, source: requestSchema.source,
  selectionRef: 'example:read-requests',
  where: { op: 'eq', args: [{ col: 'operation' }, { lit: 'read' }] },
  fields: [
    { field: 'durationMs', statistics: ['sum', 'min', 'max', 'mean', 'stddevPopulation', 'stddevSample', 'median', 'p95'] },
    { field: 'operation', frequencies: true },
    { field: 'successful', frequencies: true },
  ],
  quantileMethod: 'nearest-rank',
};
const events = [];
const requestResult = await profileData(createArrayProfileProvider(requestSchema, requests), requestPlan, {
  operationId: 'example:profile-requests', resultRef: 'example:request-result', progressEvery: 2,
  onEvent: (event) => events.push(event.status),
});
assert.deepEqual(requestResult.population, { scanned: 5, selected: 4, excluded: 1, predicateUnknown: 0 });
const latency = requestResult.fields.find((field) => field.field === 'durationMs');
assert.equal(latency.known, 3);
assert.equal(latency.unknown, 1);
assert.equal(latency.statistics.min, 0);
assert(Math.abs(latency.statistics.mean - 40 / 3) < 1e-12);
assert.equal(latency.statistics.p95, 30);
assert.equal(events[0], 'started');
assert.equal(events.at(-1), 'completed');
assert(events.includes('progress'));

// The same API for a second domain: no request, protocol, or dashboard rules.
const inventorySchema = {
  source: { id: 'example:inventory', version: 'fixture-v1' },
  table: 'disks', grain: 'one inventoried disk',
  columns: [
    { name: 'disk', type: 'string', role: 'identifier', meaning: 'Exact disk identity' },
    { name: 'capacityGiB', type: 'number', role: 'measure', unit: 'GiB', meaning: 'Reported provisioned capacity' },
  ],
};
const inventoryResult = await profileData(createArrayProfileProvider(inventorySchema, [
  { disk: 'disk-a', capacityGiB: 100 }, { disk: 'disk-b', capacityGiB: 500 }, { disk: 'disk-c', capacityGiB: null },
]), {
  kind: 'profile', version: 1, ops: 1, source: inventorySchema.source,
  selectionRef: 'example:all-inventory', fields: [{ field: 'capacityGiB', statistics: ['sum', 'mean'] }],
}, { operationId: 'example:profile-inventory', resultRef: 'example:inventory-result' });
assert.equal(inventoryResult.population.selected, 3);
assert.equal(inventoryResult.fields[0].unknown, 1);
assert.equal(inventoryResult.fields[0].statistics.sum, 600);
assert.equal(inventoryResult.fields[0].statistics.mean, 300);

let sqliteResult;
if (process.argv.includes('--sqlite')) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE requests(id TEXT, operation TEXT, durationMs REAL, successful INTEGER)');
    const insert = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?)');
    for (const row of requests) insert.run(row.id, row.operation, row.durationMs, row.successful === null ? null : Number(row.successful));
    db.exec('PRAGMA query_only = ON');
    const checkSource = (source) => assert.deepEqual(source, requestSchema.source);
    const provider = {
      describe(source) { checkSource(source); return requestSchema; },
      *scan(source, columns, signal) {
        checkSource(source);
        const allowed = new Set(requestSchema.columns.map((column) => column.name));
        for (const column of columns) assert(allowed.has(column), 'Unknown projected column');
        // Identifiers are accepted only from the fixed schema; values are never SQL text.
        const projection = columns.map((column) => '"' + column + '"').join(', ');
        const iterator = db.prepare('SELECT ' + projection + ' FROM requests ORDER BY rowid').iterate();
        try {
          for (const row of iterator) {
            signal?.throwIfAborted();
            if (Object.hasOwn(row, 'successful') && row.successful !== null) row.successful = Boolean(row.successful);
            yield row;
          }
        } finally { iterator.return?.(); }
      },
    };
    sqliteResult = await profileData(provider, requestPlan, {
      operationId: 'example:profile-sqlite', resultRef: 'example:sqlite-result',
    });
    assert.deepEqual(sqliteResult.population, requestResult.population);
    assert.deepEqual(sqliteResult.fields, requestResult.fields);
  } finally { db.close(); }
}

// Receipts are returned to the host; these example refs do not create persisted artifacts.
console.log(JSON.stringify({
  examples: [requestResult, inventoryResult, ...(sqliteResult ? [sqliteResult] : [])].map((result) => ({
    resultRef: result.resultRef, source: result.schema.source, grain: result.schema.grain,
    population: result.population, fields: result.fields,
  })),
  requestEvents: events,
}, null, 2));
