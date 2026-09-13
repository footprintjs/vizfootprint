// After npm run build: node examples/group-profile-data.mjs [--sqlite]
// Synthetic fixtures only. Grouping profiles organized rows; it does not build source relationships.
import assert from 'node:assert/strict';
import { profileData, profileGroups, createArrayProfileProvider } from 'vizfootprint/data';

const schema = {
  source: { id: 'example:grouped-requests', version: 'fixture-v1' },
  table: 'requests', grain: 'one saved request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Client identity within this source' },
    { name: 'operation', type: 'string', role: 'dimension', meaning: 'Recorded operation' },
    { name: 'durationMs', type: 'number', role: 'measure', unit: 'ms', meaning: 'Known completed request duration' },
    { name: 'successful', type: 'boolean', role: 'dimension', meaning: 'Observed success; null means unknown' },
    { name: 'eligible', type: 'boolean', role: 'dimension', meaning: 'Whether this fixture row belongs to the selected population' },
  ],
};
const rows = [
  { client: 'client-a', operation: 'read', durationMs: 0, successful: true, eligible: true },
  { client: 'client-a', operation: 'read', durationMs: 10, successful: true, eligible: true },
  { client: 'client-a', operation: 'read', durationMs: null, successful: null, eligible: true },
  { client: 'client-a', operation: 'write', durationMs: 30, successful: false, eligible: true },
  { client: 'client-b', operation: 'read', durationMs: 20, successful: true, eligible: true },
  { client: null, operation: 'read', durationMs: 5, successful: true, eligible: true },
  { operation: 'read', durationMs: null, successful: null, eligible: true },
  { client: 'client-b', operation: 'write', durationMs: 999, successful: true, eligible: false },
];
const plan = {
  kind: 'group-profile', version: 1, ops: 1, source: schema.source,
  selectionRef: 'example:eligible-requests', where: { col: 'eligible' },
  groupBy: ['client', 'operation'], unknownKeys: 'include',
  fields: [
    { field: 'durationMs', statistics: ['sum', 'min', 'max', 'mean', 'median', 'p95'] },
    { field: 'successful', frequencies: true },
  ], quantileMethod: 'nearest-rank',
};

async function reconstruct(provider, result) {
  for (const [index, group] of result.groups.entries()) {
    assert.deepEqual(group.ref, { resultRef: result.resultRef, index });
    const replay = await profileData(provider, {
      kind: 'profile', version: 1, ops: result.plan.ops, source: result.plan.source,
      selectionRef: result.resultRef + ':group-' + index,
      where: group.where, fields: result.plan.fields,
      ...(result.plan.quantileMethod ? { quantileMethod: result.plan.quantileMethod } : {}),
    }, { operationId: 'example:reconstruct-' + index, resultRef: 'example:reconstruction-' + index });
    assert.equal(replay.population.selected, group.rowCount);
    assert.deepEqual(replay.fields, group.fields);
  }
}

const provider = createArrayProfileProvider(schema, rows);
const events = [];
const included = await profileGroups(provider, plan, {
  operationId: 'example:group-requests', resultRef: 'example:request-groups', progressEvery: 2,
  onEvent: event => events.push(event.status),
});
assert.deepEqual(included.population, {
  scanned: 8, selected: 7, excluded: 1, predicateUnknown: 0, grouped: 7, withUnknownKeys: 2, excludedUnknownKeys: 0,
});
assert.deepEqual(included.grain, { kind: 'group', groupBy: ['client', 'operation'], sourceGrain: 'one saved request' });
assert.equal(included.groupOrder, 'first-seen');
assert.deepEqual(included.groups.map(group => group.keys), [
  { client: 'client-a', operation: 'read' }, { client: 'client-a', operation: 'write' },
  { client: 'client-b', operation: 'read' }, { client: null, operation: 'read' },
]);
assert.equal(included.groups[0].rowCount, 3);
assert.equal(included.groups[0].fields[0].unknown, 1);
assert.equal(included.groups[0].fields[0].statistics.mean, 5);
assert.equal(included.groups[0].fields[0].statistics.p95, 10);
assert.equal(events[0], 'started');
assert.equal(events.at(-1), 'completed');
assert(events.includes('progress'));
await reconstruct(provider, included);

const excluded = await profileGroups(provider, { ...plan, unknownKeys: 'exclude' }, {
  operationId: 'example:group-known-clients', resultRef: 'example:known-client-groups',
});
assert.deepEqual(excluded.population, {
  scanned: 8, selected: 7, excluded: 1, predicateUnknown: 0, grouped: 5, withUnknownKeys: 2, excludedUnknownKeys: 2,
});
assert.equal(excluded.groups.length, 3);
await reconstruct(provider, excluded);

const inventorySchema = {
  source: { id: 'example:grouped-inventory', version: 'fixture-v1' },
  table: 'disks', grain: 'one inventoried disk',
  columns: [
    { name: 'vm', type: 'string', role: 'identifier', meaning: 'Exact virtual machine identity' },
    { name: 'kind', type: 'string', role: 'dimension', meaning: 'Recorded disk kind' },
    { name: 'capacityGiB', type: 'number', role: 'measure', unit: 'GiB', meaning: 'Reported provisioned capacity' },
  ],
};
const inventoryProvider = createArrayProfileProvider(inventorySchema, [
  { vm: 'vm-a', kind: 'VMDK', capacityGiB: 100 }, { vm: 'vm-a', kind: 'VMDK', capacityGiB: 500 },
  { vm: 'vm-a', kind: 'RDM', capacityGiB: null }, { vm: 'vm-b', kind: 'VMDK', capacityGiB: 250 },
]);
const inventory = await profileGroups(inventoryProvider, {
  kind: 'group-profile', version: 1, ops: 1, source: inventorySchema.source,
  selectionRef: 'example:all-disks', groupBy: ['vm', 'kind'], unknownKeys: 'exclude',
  fields: [{ field: 'capacityGiB', statistics: ['sum', 'mean'] }],
}, { operationId: 'example:group-inventory', resultRef: 'example:inventory-groups' });
assert.equal(inventory.groups.length, 3);
assert.equal(inventory.groups[0].fields[0].statistics.sum, 600);
assert.equal(inventory.groups[1].fields[0].statistics.sum, null);
assert.equal(inventory.groups[1].fields[0].unknown, 1);
await reconstruct(inventoryProvider, inventory);

let sqlite;
if (process.argv.includes('--sqlite')) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE requests(client TEXT, operation TEXT, durationMs REAL, successful INTEGER, eligible INTEGER)');
    const insert = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) insert.run(row.client ?? null, row.operation, row.durationMs, row.successful === null ? null : Number(row.successful), Number(row.eligible));
    db.exec('PRAGMA query_only = ON');
    const check = source => assert.deepEqual(source, schema.source);
    const sqliteProvider = {
      describe(source, signal) { signal?.throwIfAborted(); check(source); return schema; },
      *scan(source, columns, signal) {
        check(source);
        const allowed = new Set(schema.columns.map(column => column.name));
        for (const column of columns) assert(allowed.has(column), 'Unknown projected column');
        const iterator = db.prepare('SELECT ' + columns.map(column => '"' + column + '"').join(', ') + ' FROM requests ORDER BY rowid').iterate();
        try {
          for (const row of iterator) {
            signal?.throwIfAborted();
            for (const name of ['successful', 'eligible']) if (Object.hasOwn(row, name) && row[name] !== null) row[name] = Boolean(row[name]);
            yield row;
          }
        } finally { iterator.return?.(); }
      },
    };
    sqlite = await profileGroups(sqliteProvider, plan, { operationId: 'example:group-sqlite', resultRef: included.resultRef });
    assert.deepEqual(sqlite.population, included.population);
    assert.deepEqual(sqlite.groups, included.groups);
    await reconstruct(sqliteProvider, sqlite);
  } finally { db.close(); }
}

console.log(JSON.stringify({
  examples: [included, excluded, inventory, ...(sqlite ? [sqlite] : [])].map(result => ({
    resultRef: result.resultRef, source: result.schema.source, grain: result.grain,
    population: result.population, groups: result.groups,
  })),
  requestEvents: events,
}, null, 2));
