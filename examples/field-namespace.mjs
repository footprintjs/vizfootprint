// Synthetic metadata only; no rows or database are needed to qualify a field.
import assert from 'node:assert/strict';
import { createFieldNamespace, FIELD_NAMESPACE_PREFIX } from 'vizfootprint/data';

const options = { datasetRef: 'synthetic:snapshot:1', table: 'nodes', fields: ['p95_us', 'node'] };
const nodes = createFieldNamespace(options);
const clients = createFieldNamespace({ ...options, table: 'clients' });
const latency = nodes.field('p95_us');
assert.notEqual(latency.nativeField, clients.field('p95_us').nativeField);
assert.equal(nodes.resolve(latency.nativeField), latency);
assert.throws(() => nodes.resolve(clients.field('p95_us').nativeField), /unknown-native-field/);
assert.throws(() => nodes.field('undeclared'), /unknown-field/);
assert(latency.nativeField.startsWith(FIELD_NAMESPACE_PREFIX));
assert.deepEqual(latency.reference, { datasetRef: options.datasetRef, table: 'nodes', field: 'p95_us' });
const caseDistinct = createFieldNamespace({ ...options, fields: ['x', 'X'] });
assert.notEqual(caseDistinct.field('x').nativeField.toLowerCase(), caseDistinct.field('X').nativeField.toLowerCase());
console.log(JSON.stringify({ bindings: nodes.bindings, distinctTableAddress: clients.field('p95_us').nativeField }, null, 2));
