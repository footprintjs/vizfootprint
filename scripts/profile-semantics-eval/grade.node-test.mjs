import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from './fixtures.mjs';
import { executeDecision, gradeInterpretation } from './grade.mjs';
import { loadAgentHost, runGraphCase } from './skillgraph-host.mjs';

function assertOpaque(value) {
  const text = JSON.stringify(value);
  for (const testcase of cases) assert(!text.includes(testcase.id), `Visible metadata leaks ${testcase.id}`);
  for (const arm of ['progressive', 'all-at-once']) assert(!text.includes(arm), `Visible identity leaks arm ${arm}`);
}

test('a justified refusal has no computed population even when its source has aggregate rows', () => {
  const testcase = cases.find(item => item.id === 'aggregate-grain-refusal');
  const observed = { ...testcase.expected, supported: false, populationBasis: 'unavailable', reasonCode: 'aggregate-grain' };
  assert(gradeInterpretation(testcase, observed).every(check => check.pass));
  assert(gradeInterpretation(testcase, { ...observed, reasonCode: 'numeric-identifier' }).some(check => !check.pass));
});

test('a computed statistic over aggregates still identifies its aggregate population', () => {
  const testcase = cases.find(item => item.id === 'aggregate-grain-interpretation');
  for (const populationBasis of ['source-row', 'unavailable'])
    assert(gradeInterpretation(testcase, { ...testcase.expected, populationBasis }).some(check => !check.pass));
});

test('source and selection identities contain no outcome-bearing testcase labels', () => {
  const refs = cases.flatMap(testcase => [testcase.schema.source.id, testcase.plan.selectionRef]);
  assert.equal(new Set(refs).size, refs.length);
  assertOpaque(refs);
});

test('computed result metadata uses opaque deterministic operation and result identities', async () => {
  const api = await import('vizfootprint/data');
  const refs = new Set();
  for (const testcase of cases.filter(testcase => !testcase.expectedRefusal)) {
    for (const arm of ['all-at-once', 'progressive']) {
      const decision = { decision: 'calculate', reasonCode: 'none', plan: testcase.plan };
      const executed = await executeDecision(api, testcase, decision, arm);
      assert.equal(executed.pass, true);
      assertOpaque(executed.evidence);
      assertOpaque(api.summarizeProfileResult(executed.result));
      const ids = [executed.result.operationId, executed.result.resultRef];
      assertOpaque(ids);
      for (const id of ids) { assert(!refs.has(id)); refs.add(id); }
      const replay = await executeDecision(api, testcase, decision, arm);
      assert.deepEqual([replay.result.operationId, replay.result.resultRef], ids);
    }
  }
});

test('scope grading rejects unrequested frequencies but accepts their explicit omission', async () => {
  const api = await import('vizfootprint/data'), testcase = cases[0];
  for (const frequencies of [true, false]) {
    const result = await executeDecision(api, testcase, { decision: 'calculate', reasonCode: 'none',
      plan: { ...testcase.plan, fields: testcase.plan.fields.map(field => ({ ...field, frequencies })) },
    }, 'frequency-control');
    assert.equal(result.pass, !frequencies);
    assert.deepEqual(result.checks.filter(check => !check.pass).map(check => check.criterion), frequencies ? ['requested-field-statistics-and-method'] : []);
  }
});

test('actual dry provider requests and served views contain no descriptive testcase labels', {
  skip: !process.env.AGENTFOOTPRINT_ROOT && 'Set AGENTFOOTPRINT_ROOT to an optional installed evaluation host.',
}, async () => {
  const host = await loadAgentHost(process.env.AGENTFOOTPRINT_ROOT), api = await import('vizfootprint/data');
  for (const testcase of cases) {
    const run = await runGraphCase({ api, host, testcase, arm: 'progressive', dryRun: true, model: 'claude-haiku-4-5-20251001',
      fetchRecorded: async ({ scripted }) => new Response(JSON.stringify(scripted()), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(run.pass, true, `Dry graph failed ${testcase.id}`);
    assertOpaque(run.wire);
    assertOpaque(run.witnesses.map(witness => witness.view));
  }
});
