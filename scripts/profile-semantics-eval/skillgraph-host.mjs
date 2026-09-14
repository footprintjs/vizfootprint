import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { executeDecision, gradeInterpretation } from './grade.mjs';
import { assertNoRetiredDescriptors, assertReceiptConformance, assertWitnessCoverage } from './audit.mjs';

const nullable = { type: ['number', 'null'] };
const interpretationProperties = {
  supported: { type: 'boolean', description: 'Whether the requested calculation is supported by the supplied evidence.' },
  populationBasis: { enum: ['source-row', 'group', 'aggregate-row', 'unavailable'], description: 'Population of the computed result: source-row for a profile of individual source rows, group for grouped profiles, aggregate-row for a supported profile of saved aggregates, unavailable when no result was computed or the request was refused. Source grain is independently declared in the source schema; a refusal has no computed population.' },
  selected: { ...nullable, description: 'Selected source rows before any unknown group-key exclusion; null when no result was computed.' },
  grouped: { ...nullable, description: 'Selected source rows assigned to groups; null for an ungrouped profile or refusal.' },
  excludedUnknownKeys: { ...nullable, description: 'Selected rows excluded by the unknown group-key policy; null for an ungrouped profile or refusal.' },
  knownDenominator: { ...nullable, description: 'Known values of the requested field for an ungrouped profile. Null for grouped results (use each group) or refusal.' },
  unknownCount: { ...nullable, description: 'Unknown values of the requested field for an ungrouped profile. Null for grouped results (use each group) or refusal.' },
  mean: nullable, p95: nullable, sum: nullable,
  groupCount: { ...nullable, description: 'Number of result groups, not source rows; null for an ungrouped profile or refusal.' },
  groups: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
    required: ['keys', 'rowCount', 'known', 'unknown', 'mean', 'p95', 'sum'], properties: {
      keys: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
      rowCount: { type: 'number' }, known: { type: 'number' }, unknown: { type: 'number' }, mean: nullable, p95: nullable, sum: nullable,
    } } },
  reasonCode: { enum: ['none', 'numeric-identifier', 'aggregate-grain', 'no-result'] },
};
const interpretationSchema = { type: 'object', additionalProperties: false, required: Object.keys(interpretationProperties), properties: interpretationProperties };
const interpretationInstructions = 'Interpret the computed evidence for the exact task. Call submit_interpretation once. For one profile fill top-level knownDenominator, unknownCount and requested statistics; set grouping-only fields null and groups empty. For grouped results fill group totals and each group; top-level knownDenominator, unknownCount and statistics are null. An unrequested statistic is null. For unsupported calculations fill numerical fields null and groups empty and identify the specific reason. Use only supplied evidence; do not invent underlying records.';

// Independent bounded wire checker for this text/tool-only evaluation. It compares
// semantic blocks, allowing Anthropic's adjacent tool-result coalescing.
function logicalAtoms(messages) {
  return messages.flatMap(message => {
    assert(!message.thinkingBlocks?.length && !message.images?.length, 'Fixture cannot silently gain multimodal content');
    if (message.role === 'tool') return [{ role: 'user', type: 'tool_result', id: message.toolCallId ?? '', content: message.content }];
    assert(['user', 'assistant'].includes(message.role));
    return [...(message.content ? [{ role: message.role, type: 'text', text: message.content }] : []),
      ...(message.toolCalls ?? []).map(call => ({ role: 'assistant', type: 'tool_use', id: call.id, name: call.name, input: call.args }))];
  });
}
function vendorAtoms(messages) {
  return messages.flatMap(message => {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    return blocks.flatMap(block => {
      if (block.type === 'text') return block.text ? [{ role: message.role, type: 'text', text: block.text }] : [];
      if (block.type === 'tool_use') return [{ role: message.role, type: 'tool_use', id: block.id, name: block.name, input: block.input }];
      assert.equal(block.type, 'tool_result');
      return [{ role: message.role, type: 'tool_result', id: block.tool_use_id, content: block.content }];
    });
  });
}

/** Resolve an existing optional eval host by its public package doors; never add a core dependency. */
export async function loadAgentHost(packageRoot) {
  const directory = resolve(packageRoot);
  const require = createRequire(join(directory, 'package.json'));
  const main = require('agentfootprint');
  const context = require('agentfootprint/context');
  const providers = require('agentfootprint/providers');
  for (const name of ['Agent', 'defineTool', 'servedViews', 'receiptAt', 'receiptHash', 'messageDigestInput', 'toolDigestInput']) assert(main[name], 'Configured AgentFootprint is missing public ' + name);
  assert(context.defineSkill && context.skillGraph && providers.browserAnthropic, 'Configured host lacks graph/provider doors');
  const pkg = JSON.parse(await readFile(require.resolve('agentfootprint/package.json'), 'utf8'));
  return { ...main, ...context, browserAnthropic: providers.browserAnthropic, package: { name: pkg.name, version: pkg.version, root: directory } };
}

/** One real Agent with its own SkillGraph, tool execution and committed served-state witnesses. */
export async function runGraphCase({ api, host, testcase, arm, dryRun, key, model, fetchRecorded }) {
  const descriptors = ['profile', 'group-profile'].map(kind => api.describeProfileOperation(testcase.schema, kind, testcase.schema.columns.map(column => column.name)));
  const catalog = api.listProfileOperations();
  const allMetadata = { catalog, descriptors, interpretation: { instructions: interpretationInstructions, inputSchema: interpretationSchema } };
  const common = 'Address the exact synthetic task and preserve its source, selection and requested scope. The currently active skill is already loaded: use its operational tool, not read_skill. Make exactly one tool call at a time. Do not skip ahead or repeat a completed operation. After submitting interpretation, answer only Done. No source rows are provided to the model.';
  let chosen = null, executed = null, interpreted = null;
  const attempts = [], wire = [], vendorBodies = [], graphEvents = [];

  const choose = host.defineTool({
    name: 'choose_operation', description: 'Choose one existing data-analysis operation, or explicitly refuse an unsupported calculation before choosing parameters.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['operation', 'reasonCode'], properties: {
      operation: { enum: ['profile', 'group-profile', 'refuse'], description: 'Use profile or group-profile for a supported calculation; otherwise choose refuse.' },
      reasonCode: { enum: ['none', 'numeric-identifier', 'aggregate-grain', 'unsupported'], description: 'Use none for profile/group-profile. When refusing, name the specific unsupported meaning or grain.' },
    } },
    execute(args) {
      assert.equal(chosen, null, 'Operation was already chosen');
      assert(['profile', 'group-profile', 'refuse'].includes(args.operation), 'Unknown operation');
      chosen = structuredClone(args); attempts.push({ stage: 'choose', args: chosen });
      return { operation: chosen.operation, reasonCode: chosen.reasonCode, source: testcase.schema.source, selectionRef: testcase.plan.selectionRef };
    },
  });
  const calculators = descriptors.map(descriptor => host.defineTool({
    ...descriptor.tool,
    async execute(plan) {
      assert.equal(chosen?.operation, descriptor.operation.id, 'This calculation was not the selected operation');
      assert.equal(executed, null, 'The selected calculation already executed');
      attempts.push({ stage: 'execute', operation: descriptor.operation.id, plan: structuredClone(plan) });
      executed = await executeDecision(api, testcase, { decision: 'calculate', reasonCode: chosen.reasonCode, plan }, arm);
      // Evaluation checks/expected answers stay private; both arms receive identical public facts.
      return { execution: executed.evidence,
        ...(executed.result ? { summary: api.summarizeProfileResult(executed.result, { fields: [testcase.field], groupLimit: 8, maxCharacters: 16_000 }) } : {}) };
    },
  }));
  const submit = host.defineTool({ name: 'submit_interpretation', description: 'Submit the structured interpretation once the selected calculation or explicit refusal has been read.', inputSchema: interpretationSchema,
    async execute(claim) {
      assert(chosen, 'No operation decision exists'); assert.equal(interpreted, null, 'Interpretation already submitted');
      if (chosen.operation === 'refuse') executed = await executeDecision(api, testcase, { decision: 'refuse', reasonCode: chosen.reasonCode }, arm);
      assert(executed, 'No execution evidence or refusal exists');
      interpreted = structuredClone(claim); attempts.push({ stage: 'interpret', claim: interpreted });
      return { submitted: true, meaning: 'Submission is recorded; this acknowledgement is not an independent correctness judgment.' };
    },
  });
  const stageBody = (stage, instructions, metadata) => `Stage: ${stage}. ${instructions}\n${arm === 'progressive' ? JSON.stringify(metadata) : 'Use the complete metadata already provided in the base system context.'}`;
  const choice = host.defineSkill({ id: 'choose-analysis', description: 'Choose the existing analysis operation.',
    body: stageBody('choose', 'Call choose_operation with profile, group-profile, or an explicit refusal.', { catalog, schema: testcase.schema }), tools: [choose] });
  const parameters = descriptors.map((descriptor, index) => host.defineSkill({ id: index === 0 ? 'profile-parameters' : 'group-parameters', description: 'Supply parameters for the selected operation.',
    body: stageBody('parameters', `Call ${descriptor.tool.name} with the exact requested plan and supplied selectionRef.`, descriptor), tools: [calculators[index]] }));
  const interpret = host.defineSkill({ id: 'interpret-analysis', description: 'Interpret the computed result or explicit refusal.',
    body: stageBody('interpret', 'Use the latest calculation evidence or explicit refusal, then call submit_interpretation.', { instructions: interpretationInstructions, inputSchema: interpretationSchema }), tools: [submit] });
  const finish = host.defineSkill({ id: 'analysis-finished', description: 'Finish the completed evaluation.', body: 'The interpretation is submitted. Answer only Done. Do not call any tool.' });
  const pick = operation => result => result.toolName === 'choose_operation' && JSON.parse(result.result).operation === operation;
  // An unconditional entry intentionally remains co-active in AgentFootprint.
  // A matching conditional entry is cursor-scoped and leaves at the declared hop.
  const graph = host.skillGraph().entry(choice, { when: () => true })
    .route(choice, parameters[0], { when: pick('profile'), label: 'profile chosen' })
    .route(choice, parameters[1], { when: pick('group-profile'), label: 'groups chosen' })
    .route(choice, interpret, { when: pick('refuse'), label: 'explicit refusal' })
    .route(parameters[0], interpret, { onToolReturn: descriptors[0].tool.name })
    .route(parameters[1], interpret, { onToolReturn: descriptors[1].tool.name })
    .route(interpret, finish, { onToolReturn: 'submit_interpretation' })
    .build({ scopeTools: true });

  const adapter = host.browserAnthropic({ apiKey: dryRun ? 'synthetic-dry-run-no-key' : key, defaultModel: model, defaultMaxTokens: 500, parallelToolCalls: false,
    _fetch: async (url, init) => {
      const body = JSON.parse(init.body); vendorBodies.push(body);
      return fetchRecorded({ testcase, arm, index: wire.length, url, init, body, scripted: () => {
        const names = body.tools?.map(tool => tool.name) ?? [];
        let name, args;
        if (names.includes('choose_operation')) { name = 'choose_operation'; args = { operation: testcase.expectedRefusal ? 'refuse' : testcase.plan.kind, reasonCode: testcase.expectedRefusal ?? 'none' }; }
        else if (names.includes('profile_data') || names.includes('profile_groups')) { name = testcase.plan.kind === 'profile' ? 'profile_data' : 'profile_groups'; args = testcase.plan; }
        else if (names.includes('submit_interpretation')) { name = 'submit_interpretation'; args = testcase.expected; }
        return { id: `synthetic-${testcase.id}-${arm}-${wire.length}`, type: 'message', role: 'assistant', model,
          content: name ? [{ type: 'tool_use', id: `call-${wire.length}`, name, input: args }] : [{ type: 'text', text: 'Done.' }],
          stop_reason: name ? 'tool_use' : 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } };
      } });
    },
  });
  const provider = { name: adapter.name + '/recorded-eval', carriesInMessages: adapter.carriesInMessages, carriesForcedToolChoice: adapter.carriesForcedToolChoice,
    async complete(request, hooks) {
      assert(wire.length < 4, 'Hard four-call per-run budget exceeded; no further request sent');
      // Capture without changing anything after the framework minted its receipt.
      wire.push(JSON.parse(JSON.stringify(request, (name, value) => name === 'signal' ? undefined : value)));
      return adapter.complete(request, hooks);
    } };
  const agent = host.Agent.create({ provider, model, maxIterations: 4, maxTokens: 500, temperature: 0,
    contextBudget: { systemPrompt: 160_000, messages: 80_000, tools: 80_000 } })
    .system(common + (arm === 'all-at-once' ? '\nAll relevant metadata:\n' + JSON.stringify(allMetadata) : ''))
    .skillGraph(graph).build();
  const off = agent.on('agentfootprint.context.evaluated', event => graphEvents.push(structuredClone(event)));
  let answer, runError;
  try { answer = await agent.run({ message: JSON.stringify({ task: testcase.task, source: testcase.schema.source, selectionRef: testcase.plan.selectionRef, schema: testcase.schema }) }); }
  catch (error) { runError = { name: error.name, message: String(error.message).slice(0, 1600) }; }
  finally { off(); }
  const snapshot = agent.getSnapshot();
  const views = host.servedViews(snapshot);
  const check = (name, test) => { try { test(); return { name, pass: true }; } catch (error) { return { name, pass: false, message: String(error.message).slice(0, 600) }; } };
  const auditChecks = [check('complete-provider-and-vendor-witness-coverage', () => assertWitnessCoverage({ views, wire, vendorBodies }))];
  const witnesses = views.map(view => {
    const receipt = host.receiptAt(snapshot, view.epoch);
    const actual = wire[view.epoch - 1];
    const vendor = vendorBodies[view.epoch - 1];
    const phase = graphEvents.find(event => event.payload.iteration === view.epoch)?.payload.cursorMove?.to;
    const checks = [
      check('receipt-present', () => assert(receipt)),
      check('served-system-is-provider-system', () => assert.equal(view.system.text, actual.systemPrompt ?? '')),
      check('served-messages-are-provider-messages', () => assert.deepEqual(view.messages.asSent, actual.messages)),
      check('served-tools-are-provider-tools', () => assert.deepEqual(view.tools.schemas, actual.tools ?? [])),
      check('receipt-bindings-cardinalities-and-digests', () => assertReceiptConformance(host, view, receipt)),
      check('exact-current-operational-catalog', () => {
        const operational = view.tools.names.filter(name => name !== 'read_skill');
        const expected = { 'choose-analysis': ['choose_operation'], 'profile-parameters': ['profile_data'], 'group-parameters': ['profile_groups'], 'interpret-analysis': ['submit_interpretation'], 'analysis-finished': [] }[phase];
        assert(expected, 'Missing actual graph phase'); assert.deepEqual(operational, expected);
      }),
      check('actual-vendor-system-tools-and-dials', () => {
        assert.equal(vendor.system, actual.systemPrompt); assert.equal(vendor.model, actual.model);
        assert.equal(vendor.max_tokens, actual.maxTokens); assert.equal(vendor.temperature, actual.temperature);
        assert.deepEqual(vendor.tools ?? [], (actual.tools ?? []).map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })));
      }),
      check('actual-vendor-message-content-and-call-ids', () => assert.deepEqual(vendorAtoms(vendor.messages), logicalAtoms(actual.messages))),
      check('fixture-label-stays-host-side', () => {
        assert(!JSON.stringify(actual).includes(testcase.id), 'Descriptive fixture label leaked into provider context');
        assert(!JSON.stringify(vendor).includes(testcase.id), 'Descriptive fixture label leaked into vendor context');
      }),
      check('original-task-and-source-survive', () => {
        const history = view.messages.asSent.map(message => message.content).join('\n');
        assert(history.includes(testcase.task)); assert(history.includes(testcase.schema.source.id));
        assert(history.includes(testcase.plan.selectionRef));
      }),
      check('descriptor-is-not-retained-in-tool-history', () => assertNoRetiredDescriptors(view.messages.asSent, descriptors)),
    ];
    if (arm === 'progressive') checks.push(check('stage-appropriate-body-retirement', () => {
      const names = view.tools.names;
      if (names.includes('choose_operation')) {
        assert(view.system.text.includes(JSON.stringify(catalog)));
        for (const descriptor of descriptors) assert(!view.system.text.includes(JSON.stringify(descriptor)));
        assert(!view.system.text.includes(interpretationInstructions));
      } else {
        assert(!view.system.text.includes('Stage: choose.'));
        assert(!view.system.text.includes(JSON.stringify(catalog)));
        const active = descriptors.find(descriptor => names.includes(descriptor.tool.name));
        for (const descriptor of descriptors) assert.equal(view.system.text.includes(JSON.stringify(descriptor)), descriptor === active);
        if (active) assert(!view.system.text.includes(interpretationInstructions));
        else {
          assert(!view.system.text.includes('Stage: parameters.'));
          assert.equal(view.system.text.includes(interpretationInstructions), names.includes('submit_interpretation'));
        }
      }
    }));
    else checks.push(check('all-metadata-remains-served', () => assert(view.system.text.includes(JSON.stringify(allMetadata)))));
    return { epoch: view.epoch, phase, callRuntimeStageId: view.callRuntimeStageId, view, receipt, checks };
  });
  const interpretationChecks = gradeInterpretation(testcase, interpreted);
  const hasWitnesses = auditChecks.every(check => check.pass) && witnesses.every(witness => witness.checks.every(check => check.pass));
  const pass = !runError && !!executed?.pass && !!interpreted && interpretationChecks.every(check => check.pass) && hasWitnesses;
  return { case: testcase.id, arm, dryRun, pass, status: runError ? 'blocked-run' : !executed || !interpreted ? 'incomplete-run' : 'scored', answer, runError,
    calls: wire.length, chosen, attempts, execution: executed, interpreted, interpretationChecks,
    graph: { mermaid: graph.toMermaid(), events: graphEvents }, snapshot, wire, vendorBodies, witnesses, auditChecks, hasWitnesses };
}
