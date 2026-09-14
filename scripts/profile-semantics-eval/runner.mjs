import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './fixtures.mjs';
import { verifyFixtures } from './grade.mjs';
import { loadAgentHost, runGraphCase } from './skillgraph-host.mjs';
import { summarizeUsage } from './usage.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const endpoint = 'https://api.anthropic.com/v1/messages', model = 'claude-haiku-4-5-20251001';
const liveIds = ['selected-known-denominator', 'group-exclude-unknown', 'numeric-identifier-refusal', 'aggregate-grain-refusal'];
const config = { live: false, dryRun: false, output: undefined, envFile: undefined, agentRoot: process.env.AGENTFOOTPRINT_ROOT };
const argv = process.argv.slice(2);
for (let at = 0; at < argv.length; at++) {
  const arg = argv[at];
  if (arg === '--live') config.live = true;
  else if (arg === '--dry-run') config.dryRun = true;
  else if (['--output', '--env-file', '--agent-root'].includes(arg)) {
    const value = argv[++at]; assert(value && !value.startsWith('--'), arg + ' needs a value');
    config[{ '--output': 'output', '--env-file': 'envFile', '--agent-root': 'agentRoot' }[arg]] = value;
  } else throw new Error('Unknown argument: ' + arg);
}
assert(config.live !== config.dryRun, 'Choose exactly one of --dry-run or --live');
assert(config.agentRoot, 'Set AGENTFOOTPRINT_ROOT or --agent-root to an existing host with served-state APIs');
if (config.output) assert(isAbsolute(config.output), '--output must be absolute');
const output = config.output ?? resolve(root, '..', 'PROFILE_SEMANTICS_EVAL_' + new Date().toISOString().replaceAll(':', '-'));
assert(!output.startsWith(root + '/'), 'Write audit reports outside the library checkout');
const api = await import('vizfootprint/data');
for (const name of ['profileData', 'profileGroups', 'createArrayProfileProvider', 'listProfileOperations', 'describeProfileOperation', 'summarizeProfileResult'])
  assert.equal(typeof api[name], 'function', 'Build the current public API: missing ' + name);
const host = await loadAgentHost(config.agentRoot), fixtures = await verifyFixtures(api, cases);
let key;
if (config.live) {
  key = config.envFile ? parseEnv(await readFile(resolve(config.envFile), 'utf8')).ANTHROPIC_API_KEY : process.env.ANTHROPIC_API_KEY;
  assert(typeof key === 'string' && key.trim(), 'ANTHROPIC_API_KEY is absent from the selected source'); key = key.trim();
}
await mkdir(output, { recursive: false }); // Never overwrite an earlier experiment.
const redact = text => key ? text.replaceAll(key, '[REDACTED_API_KEY]') : text;
async function save(name, value) {
  await writeFile(join(output, name), redact(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n', { flag: 'wx' });
}
let count = 0;
const statuses = [];
async function fetchRecorded({ testcase, arm, index, url, init, body, scripted }) {
  assert.equal(url, endpoint); assert.equal(body.model, model); assert.equal(body.max_tokens, 500); assert.equal(body.stream, undefined);
  assert(Buffer.byteLength(JSON.stringify(body)) < 300_000, 'Synthetic request exceeded 300KB');
  assert(index <= 4, 'Hard per-run limit'); assert(count < (config.dryRun ? 64 : 32), 'Hard total request limit'); count++;
  const stem = `${testcase.id}.${arm}.call-${index}`;
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([name, value]) => [name, /authorization|api.key/i.test(name) ? '[REDACTED]' : value]));
  await save(stem + '.vendor-request.json', { endpoint: url, method: init.method, headers, body });
  const started = performance.now();
  try {
    const response = config.dryRun ? new Response(JSON.stringify(scripted()), { status: 200, headers: { 'content-type': 'application/json' } })
      : await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
    const text = redact(await response.clone().text()); assert(Buffer.byteLength(text) <= 1_000_000, 'Response exceeded 1MB');
    await save(stem + '.vendor-response.json', text);
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
    const status = { case: testcase.id, arm, index, serial: count,
      status: config.dryRun ? 'scripted-dry-run' : response.ok ? 'response' : 'http-error', httpStatus: response.status,
      requestId: response.headers.get('request-id'), latencyMs: Math.round(performance.now() - started), requestBytes: Buffer.byteLength(JSON.stringify(body)),
      usage: parsed?.usage ?? null, stopReason: parsed?.stop_reason ?? null, servedModel: parsed?.model ?? null };
    statuses.push(status); await save(stem + '.status.json', status); console.log(JSON.stringify(status)); return response;
  } catch (error) {
    const status = { case: testcase.id, arm, index, serial: count, status: 'transport-error', latencyMs: Math.round(performance.now() - started), error: { name: error.name, message: redact(String(error.message)).slice(0, 1200) } };
    statuses.push(status); await save(stem + '.failure.json', status); console.log(JSON.stringify(status)); throw error;
  }
}
const selected = config.dryRun ? cases : cases.filter(testcase => liveIds.includes(testcase.id));
const manifest = {
  experiment: 'Small controlled progressive-disclosure evaluation over real SkillGraph runs', version: 4,
  revision: 'Follow-up after v2 and an aborted v3: shared executable Expr examples, group-key/measure guidance, explicit interpretation field meanings, opaque model-visible references, and exact requested frequency-output grading. A refusal has populationBasis=unavailable; source grain remains in schema. Earlier results are preserved; v2 and partial v3 identifiers revealed testcase labels and cannot establish unbiased decision accuracy.',
  mode: config.dryRun ? 'dry-run' : 'live', startedAt: new Date().toISOString(), model, host: host.package,
  limits: { callsPerRun: 4, totalLiveRequests: 32, outputTokensPerCall: 500, timeoutMs: 60_000, concurrency: 1, retries: 0 },
  fixtureSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'), selectedCases: selected.map(testcase => testcase.id), allFrozenCases: cases.map(testcase => testcase.id),
  condition: 'Identical real graph, tool gates, tasks, schema and semantic facts. All-at-once puts catalog, both descriptors and interpretation metadata in the base system from call1. Progressive serves catalog at choice, selected descriptor at parameters and interpretation metadata at interpretation. Both get the same bounded result facts after execution.',
  rubric: 'Operation and predicate scope, source/selection identities, requested fields/statistics, actual public execution, independent structured interpretation, and served/receipt conformance must all pass. Equality argument order may differ; otherwise predicate shape is graded explicitly.',
  limitations: ['Only four selected cases are measured live; eight cases run through deterministic scripted dry checks.',
    'Prompt lengths differ. This is not a token-matched or statistically powered study and cannot show Haiku generally sufficient.',
    'Raw synthetic rows stay host-side. Generated summaries are not independent receipt authentication.',
    'Aggregate-grain refusal is a semantic requirement distinct from numerical executor type validity.',
    'No app integration, new state engine, library dependency change, retries, saved key or environment dump.'],
  documentation: ['https://platform.claude.com/docs/en/models/overview', 'https://platform.claude.com/docs/en/api/overview'],
};
await save('manifest.json', manifest); await save('fixtures-and-independent-rubric.json', cases); await save('fixture-public-api-verification.json', fixtures);
const grades = [];
for (const [position, testcase] of selected.entries()) {
  for (const arm of position % 2 ? ['progressive', 'all-at-once'] : ['all-at-once', 'progressive']) {
    const result = await runGraphCase({ api, host, testcase, arm, dryRun: config.dryRun, key, model, fetchRecorded });
    const stem = `${testcase.id}.${arm}`;
    await save(stem + '.snapshot.json', result.snapshot); await save(stem + '.served-receipts.json', result.witnesses);
    await save(stem + '.provider-requests.json', result.wire); await save(stem + '.graph.json', result.graph);
    const { snapshot: _snapshot, witnesses: _witnesses, wire: _wire, vendorBodies: _vendorBodies, graph: _graph, ...grade } = result;
    grades.push(grade); await save(stem + '.grade.json', grade);
    console.log(JSON.stringify({ case: testcase.id, arm, status: config.dryRun ? 'scripted-graph-check' : result.status, pass: result.pass, calls: result.calls, servedWitnesses: result.hasWitnesses }));
  }
}
const totals = ['all-at-once', 'progressive'].map(arm => {
  const rows = grades.filter(grade => grade.arm === arm), calls = statuses.filter(status => status.arm === arm);
  return { arm, cases: rows.length, passed: rows.filter(row => row.pass).length, failed: rows.filter(row => !row.pass).length,
    calls: calls.length, infrastructureErrors: calls.filter(call => ['transport-error', 'http-error'].includes(call.status)).length,
    ...summarizeUsage(calls),
    totalRequestBytes: calls.reduce((sum, call) => sum + (call.requestBytes ?? 0), 0), latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0) };
});
await save('results.json', { manifest, completedAt: new Date().toISOString(), calls: count, totals, grades, statuses });
await save('REPORT.md', [
  '# Progressive semantic context over real SkillGraph runs', '',
  `Mode: **${manifest.mode}**. Model: ${model}. AgentFootprint ${host.package.version}. Cases per arm: ${selected.length}. Provider requests: ${count}.`, '',
  config.dryRun ? '**No live model calls were made.** Results below are deterministic graph/executor/audit checks, not model accuracy.' : 'Each case requires a valid operation decision, correctly scoped public execution or specific justified refusal, correct structured interpretation and a matching committed served-state witness.', '',
  '| Arm | Passed | Failed | Calls | Infrastructure errors | Input tokens | Output tokens | Vendor request bytes | Latency ms |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...totals.map(total => `| ${total.arm} | ${total.passed}/${total.cases} | ${total.failed} | ${total.calls} | ${total.infrastructureErrors} | ${total.inputTokens ?? 'unavailable'} | ${total.outputTokens ?? 'unavailable'} | ${total.totalRequestBytes} | ${total.latencyMs} |`), '',
  'Token columns sum the provider-reported input_tokens and output_tokens. Any unreported count makes that total unavailable; cache counters, when present, remain in the per-call usage records. Dry-run zeros are scripted, not model usage.', '',
  '| Case | All-at-once | Progressive |', '| --- | --- | --- |',
  ...selected.map(testcase => `| ${testcase.id} | ${['all-at-once', 'progressive'].map(arm => { const grade = grades.find(grade => grade.case === testcase.id && grade.arm === arm); return grade.pass ? 'pass' : `fail (${grade.status})`; }).join(' | ')} |`), '',
  manifest.condition, '', manifest.revision, '',
  'The existing SkillGraph cursor controls actual tools and skill bodies. No LLMRequest is patched after recording. Snapshots, rebuilt servedViews, receiptAt hashes, provider requests and the actual sanitized vendor payload are saved per case. Retirement checks cover old system bodies and descriptors kept out of tool history.', '',
  `The evaluator independently verified all eight fixture outcomes and ${fixtures.negativeControls} grader negative controls before executing the graph. Live runs use only the four manifest-listed cases; unmeasured cases have no live success claim.`, '',
  ...manifest.limitations.map(item => '- ' + item), '', `Fixture SHA-256: ${manifest.fixtureSha256}.`, '',
  'See manifest.json, results.json, per-case grade/graph/snapshot/served-receipts files and per-call provider/vendor evidence for exact context and failures.', '',
  '[Anthropic models](https://platform.claude.com/docs/en/models/overview) · [API/authentication](https://platform.claude.com/docs/en/api/overview).',
].join('\n'));
console.log(JSON.stringify({ status: 'complete', mode: manifest.mode, output, calls: count, totals }));
if (grades.some(grade => !grade.pass)) process.exitCode = 1;
