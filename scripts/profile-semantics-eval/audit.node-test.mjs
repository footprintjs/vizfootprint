import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { cases } from './fixtures.mjs';
import { loadAgentHost, runGraphCase } from './skillgraph-host.mjs';
import { assertNoRetiredDescriptors, assertReceiptConformance, assertWitnessCoverage } from './audit.mjs';
import { executeDecision } from './grade.mjs';

const packageRoot = process.env.AGENTFOOTPRINT_ROOT;
describe('semantic evaluator audit negative controls', { skip: !packageRoot && 'Set AGENTFOOTPRINT_ROOT to an optional installed evaluation host.' }, () => {
  let host, api, run, descriptors;
  before(async () => {
    host = await loadAgentHost(packageRoot);
    api = await import('vizfootprint/data');
    const testcase = cases[0];
    descriptors = ['profile', 'group-profile'].map(kind => api.describeProfileOperation(testcase.schema, kind, testcase.schema.columns.map(c => c.name)));
    run = await runGraphCase({ api, host, testcase, arm: 'progressive', dryRun: true,
      model: 'claude-haiku-4-5-20251001', fetchRecorded: async ({ scripted }) => new Response(JSON.stringify(scripted()), {
        status: 200, headers: { 'content-type': 'application/json' },
      }) });
    assert.equal(run.pass, true, JSON.stringify({ error: run.runError, checks: run.auditChecks, witnesses: run.witnesses.map(w => w.checks) }));
  });
  const coverage = (overrides = {}) => ({ views: run.witnesses.map(w => w.view), wire: run.wire, vendorBodies: run.vendorBodies, ...overrides });

  it('accepts all actual dry-run receipts and exact call coverage', () => {
    assertWitnessCoverage(coverage());
    for (const { view, receipt } of run.witnesses) {
      assertReceiptConformance(host, view, receipt);
      assertNoRetiredDescriptors(view.messages.asSent, descriptors);
    }
  });

  it('rejects descriptors leaked through nested JSON strings or objects', () => {
    const payloads = [
      JSON.stringify({ body: 'Stage: parameters. ' + JSON.stringify(descriptors[0]) }),
      JSON.stringify(JSON.stringify({ body: JSON.stringify(descriptors[0]) })),
      JSON.stringify({ nested: [{ descriptor: Object.fromEntries(Object.entries(descriptors[0]).reverse()) }] }),
    ];
    for (const content of payloads) {
      assert.throws(() => assertNoRetiredDescriptors([{ role: 'tool', content }], descriptors), /retired descriptor/i);
    }
  });

  it('rejects duplicate, missing and reordered epochs or call-stage identities', () => {
    const views = run.witnesses.map(w => w.view);
    for (const bad of [
      [views[0], views[0], ...views.slice(2)], views.slice(1), [...views].reverse(),
      views.map((view, index) => index === 1 ? { ...view, callRuntimeStageId: views[0].callRuntimeStageId } : view),
    ]) assert.throws(() => assertWitnessCoverage(coverage({ views: bad })));
  });

  it('rejects missing or extra vendor requests', () => {
    assert.throws(() => assertWitnessCoverage(coverage({ vendorBodies: run.vendorBodies.slice(1) })));
    assert.throws(() => assertWitnessCoverage(coverage({ vendorBodies: [...run.vendorBodies, run.vendorBodies[0]] })));
  });

  it('rejects message cardinality and digest mismatches', () => {
    const { view, receipt } = run.witnesses[1];
    for (const mutate of [
      value => { value.messages.count++; },
      value => { value.messages.entries.push(value.messages.entries[0]); },
      value => { value.messages.entries.pop(); },
      value => { value.messages.entries[0].hash = 'bad-hash'; },
    ]) {
      const changed = structuredClone(receipt); mutate(changed);
      assert.throws(() => assertReceiptConformance(host, view, changed));
    }
  });

  it('rejects tool name/cardinality/hash and receipt-epoch mismatches', () => {
    const { view, receipt } = run.witnesses[1];
    for (const mutate of [
      value => { value.tools.names.pop(); },
      value => { value.tools.schemaHashes.unserved = 'extra'; },
      value => { delete value.tools.schemaHashes[value.tools.names[0]]; },
      value => { value.tools.schemaHashes[value.tools.names[0]] = 'bad-hash'; },
      value => { value.basis.epoch++; },
    ]) {
      const changed = structuredClone(receipt); mutate(changed);
      assert.throws(() => assertReceiptConformance(host, view, changed));
    }
  });

  it('rejects a refusal reason attached to an otherwise correct calculation', async () => {
    const testcase = cases[0];
    const decision = { decision: 'calculate', plan: testcase.plan, reasonCode: 'none' };
    assert.equal((await executeDecision(api, testcase, decision, 'reason-control')).pass, true);
    const wrong = await executeDecision(api, testcase, { ...decision, reasonCode: 'numeric-identifier' }, 'wrong-reason-control');
    assert.equal(wrong.pass, false);
    assert.deepEqual(wrong.checks.filter(check => !check.pass).map(check => check.criterion), ['calculation-reason-is-none']);
  });
});
