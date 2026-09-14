// Synthetic public-API example: progressive discovery, shared tool/UI meanings, and bounded findings.
import assert from 'node:assert/strict';
import { listProfileOperations, describeProfileOperation, profileGroups, createArrayProfileProvider, summarizeProfileResult,
  rankData, summarizeRankResult, summarizeDataResult, listDataOperations } from 'vizfootprint/data';
const schema = {
  source: { id: 'synthetic:semantics', version: '1' }, table: 'requests', grain: 'one observed request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Client identity within this source' },
    { name: 'durationMs', type: 'number', role: 'measure', meaning: 'Known completed request duration', unit: 'ms' },
  ],
};
const catalog = listProfileOperations();
assert.equal(catalog.length, 2);
const descriptor = describeProfileOperation(schema, 'group-profile', ['client', 'durationMs']);
assert.equal(descriptor.ui.title, descriptor.operation.title);
assert.equal(descriptor.ui.description, descriptor.operation.description);
assert.equal(descriptor.tool.name, 'profile_groups');
assert.equal(descriptor.fields[1].unit, 'ms');
const events = [];
const result = await profileGroups(createArrayProfileProvider(schema, [
  { client: 'a', durationMs: 0 }, { client: 'a', durationMs: null }, { client: 'b', durationMs: 20 },
]), {
  kind: 'group-profile', version: 1, ops: 1, source: schema.source, selectionRef: 'all',
  groupBy: ['client'], unknownKeys: 'include', fields: [{ field: 'durationMs', statistics: ['mean'] }],
}, { operationId: 'semantics:1', resultRef: 'result:1', progressEvery: 1, onEvent: event => events.push(event.status) });
const first = summarizeProfileResult(result, { groupLimit: 1 });
const second = summarizeProfileResult(result, { groupOffset: first.groupPage.nextOffset, groupLimit: 1 });
assert.equal(first.groupPage.total, 2);
assert.equal(first.groups[0].values[0].known, 1);
assert.equal(first.groups[0].values[0].unknown, 1);
assert.equal(first.groups[0].values[0].statistics.mean, 0);
assert.equal(second.groups[0].values[0].statistics.mean, 20);
assert.equal(first.resultRef, second.resultRef);
assert.equal(second.groupPage.nextOffset, null);
assert(events.includes('progress'));
assert.equal(events.at(-1), 'completed');
const ranking = await rankData(createArrayProfileProvider(schema, [
  { client: 'node-a', durationMs: 40 }, { client: 'node-b', durationMs: 40 },
  { client: 'node-c', durationMs: 0 }, { client: 'node-d', durationMs: null },
]), {
  kind: 'rank', version: 1, ops: 1, source: schema.source, selectionRef: 'selection:all-nodes',
  keys: ['client'], metric: 'durationMs', direction: 'desc', limit: 2, missing: 'exclude', ties: 'keys-ascending',
}, { operationId: 'semantics:rank', resultRef: 'result:rank' });
const rankFirst = summarizeRankResult(ranking, { rowLimit: 1 });
const rankSecond = summarizeDataResult(ranking, { rowOffset: rankFirst.rowPage.nextOffset, rowLimit: 1 });
assert.equal(rankFirst.ranking.total, 3);
assert.equal(rankFirst.ranking.shown, 2);
assert.equal(rankFirst.ranking.complete, false);
assert.equal(rankFirst.rowPage.total, 2);
assert.equal(rankFirst.population.missing, 1);
assert.equal(rankSecond.rows[0].sourceRef.keys.client, 'node-b');
assert.equal(rankFirst.fieldDefinitions[1].unit, 'ms');
const dataCatalog = listDataOperations();
assert.deepEqual(dataCatalog.map(operation => operation.id), ['profile', 'group-profile', 'rank']);
console.log(JSON.stringify({ catalog, descriptor, pages: [first, second], events, dataCatalog, rankPages: [rankFirst, rankSecond] }, null, 2));
