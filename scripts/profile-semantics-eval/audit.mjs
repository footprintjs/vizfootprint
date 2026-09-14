import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

/** A complete pairing, not merely equal collection sizes. */
export function assertWitnessCoverage({ views, wire, vendorBodies }) {
  assert(wire.length > 0, 'No provider calls were witnessed');
  assert.equal(views.length, wire.length, 'Every provider call needs exactly one served view');
  assert.equal(vendorBodies.length, wire.length, 'Every provider call needs exactly one vendor request');
  assert.deepEqual(views.map(view => view.epoch), wire.map((_, index) => index + 1), 'Served epochs must cover every request once, in order');
  assert(views.every(view => typeof view.callRuntimeStageId === 'string' && view.callRuntimeStageId.length > 0));
  assert.equal(new Set(views.map(view => view.callRuntimeStageId)).size, views.length, 'A call-stage witness cannot be reused');
}

/** These fixtures have ordinary text/tool messages and no request-only schema
 * correction. Refuse a changed receipt shape instead of validating a prefix.
 */
export function assertReceiptConformance(host, view, receipt) {
  assert(receipt, 'Missing receipt');
  assert.equal(receipt.basis.epoch, view.epoch, 'Receipt epoch does not match its served view');
  for (const key of ['runId', 'model', 'provider']) assert.equal(receipt.basis[key], view.basis[key]);
  const hash = value => host.receiptHash(receipt.basis.runId, value);
  assert.equal(hash(view.system.text), receipt.system.hash, 'System digest differs');
  assert.equal(view.system.text.length, receipt.system.chars, 'System character count differs');
  const messages = view.messages.asSent;
  assert.deepEqual(receipt.messages.requestOnly, [], 'Unexpected request-only messages');
  assert.equal(receipt.messages.count, messages.length, 'Message count differs');
  assert.equal(receipt.messages.entries.length, messages.length, 'Message receipt cardinality differs');
  messages.forEach((message, index) => {
    const entry = receipt.messages.entries[index];
    assert.equal(entry.role, message.role, 'Message role differs');
    assert.equal(entry.key ?? null, message.toolCallId ?? null, 'Message tool-call binding differs');
    assert.equal(hash(host.messageDigestInput(message)), entry.hash, 'Message digest differs');
  });
  const tools = view.tools.schemas, names = tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length, 'Duplicate served tool names');
  assert.deepEqual(view.tools.names, names, 'Served tool names differ from schemas');
  assert.deepEqual(receipt.tools.names, names, 'Receipt tool names differ');
  assert.deepEqual(Object.keys(receipt.tools.schemaHashes).sort(), [...names].sort(), 'Tool digest cardinality differs');
  for (const tool of tools) assert.equal(hash(host.toolDigestInput(tool)), receipt.tools.schemaHashes[tool.name], 'Tool digest differs');
}

/** Tool results may JSON-encode a skill body which itself contains JSON. Walk
 * decoded strings and objects so escaping cannot hide a retained descriptor.
 */
export function assertNoRetiredDescriptors(messages, descriptors) {
  const encoded = descriptors.map(descriptor => JSON.stringify(descriptor));
  function visit(value) {
    if (typeof value === 'string') {
      assert(!encoded.some(descriptor => value.includes(descriptor)), 'Tool history retains a retired descriptor');
      let decoded;
      try { decoded = JSON.parse(value); } catch { return; }
      if (decoded !== value) visit(decoded);
    } else if (value && typeof value === 'object') {
      assert(!descriptors.some(descriptor => isDeepStrictEqual(value, descriptor)), 'Tool history retains a retired descriptor');
      for (const child of Object.values(value)) visit(child);
    }
  }
  for (const message of messages) if (message.role === 'tool') visit(message.content);
}
