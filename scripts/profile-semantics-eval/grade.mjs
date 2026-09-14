import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

function executionRefs(testcase, suffix) {
  const identity = createHash('sha256').update(JSON.stringify([testcase.schema.source, suffix])).digest('hex').slice(0, 24);
  return { operationId: `synthetic:operation:${identity}`, resultRef: `synthetic:result:${identity}` };
}

export function numericFacts(result) {
  const values = fields => fields.map(({ field, known, unknown, statistics, frequencies }) => ({
    field, known, unknown, ...(statistics ? { statistics } : {}), ...(frequencies ? { frequencies } : {}),
  }));
  return {
    kind: result.kind, resultRef: result.resultRef, source: result.schema.source,
    selection: { ref: result.plan.selectionRef, where: result.plan.where ?? null },
    inputGrain: result.schema.grain, population: result.population,
    quantileMethod: result.plan.quantileMethod ?? null,
    ...(result.kind === 'profile' ? { fields: values(result.fields) } : {
      grain: result.grain, groupOrder: result.groupOrder,
      groups: result.groups.map(group => ({ ref: group.ref, keys: group.keys, rowCount: group.rowCount, fields: values(group.fields) })),
    }),
  };
}

export function computedClaim(testcase, result) {
  const blank = {
    supported: true, populationBasis: testcase.schema.table === 'client_summaries' ? 'aggregate-row' : result.kind === 'group-profile' ? 'group' : 'source-row',
    selected: result.population.selected, grouped: null, excludedUnknownKeys: null,
    knownDenominator: null, unknownCount: null, mean: null, p95: null, sum: null,
    groupCount: null, groups: [], reasonCode: 'none',
  };
  const fieldValues = fields => {
    const field = fields.find(field => field.field === testcase.field);
    assert(field, 'Chosen result is missing the requested field');
    return { known: field.known, unknown: field.unknown,
      mean: field.statistics?.mean ?? null, p95: field.statistics?.p95 ?? null, sum: field.statistics?.sum ?? null };
  };
  if (result.kind === 'profile') {
    const field = fieldValues(result.fields);
    return { ...blank, knownDenominator: field.known, unknownCount: field.unknown, mean: field.mean, p95: field.p95, sum: field.sum };
  }
  return { ...blank, grouped: result.population.grouped, excludedUnknownKeys: result.population.excludedUnknownKeys,
    groupCount: result.groups.length, groups: result.groups.map(group => ({ keys: group.keys, rowCount: group.rowCount, ...fieldValues(group.fields) })) };
}

function normalizedExpr(expr) {
  if (!expr || typeof expr !== 'object') return expr ?? null;
  if (expr.op === 'eq' && Array.isArray(expr.args)) return { op: 'eq', args: expr.args.map(normalizedExpr).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  return Object.fromEntries(Object.entries(expr).map(([key, value]) => [key, Array.isArray(value) ? value.map(normalizedExpr) : value]));
}

/** Execute the exact model plan, then judge task scope separately from type validity. */
export async function executeDecision(api, testcase, decision, suffix) {
  const checks = [];
  const check = (criterion, fn) => {
    try { fn(); checks.push({ criterion, pass: true }); }
    catch (error) { checks.push({ criterion, pass: false, error: String(error.message).slice(0, 1200) }); }
  };
  if (decision?.decision === 'refuse') {
    check('refusal-is-required-and-specific', () => { assert.equal(decision.reasonCode, testcase.expectedRefusal); assert(testcase.expectedRefusal); });
    check('refusal-does-not-also-claim-a-plan', () => assert(decision.plan === undefined || decision.plan === null));
    return { checks, pass: checks.every(check => check.pass), result: null, evidence: { status: 'explicit-model-refusal', reasonCode: decision.reasonCode } };
  }
  check('calculation-is-supported-by-requested-grain-and-role', () => assert.equal(testcase.expectedRefusal, null));
  check('decision-is-a-plan', () => assert.equal(decision?.decision, 'calculate'));
  check('calculation-reason-is-none', () => assert.equal(decision?.reasonCode, 'none'));
  const plan = decision?.plan;
  check('source-and-selection-identities', () => { assert.deepEqual(plan?.source, testcase.schema.source); assert.equal(plan?.selectionRef, testcase.plan.selectionRef); });
  check('operation-and-predicate-scope', () => {
    assert.equal(plan?.kind, testcase.plan.kind);
    assert.deepEqual(normalizedExpr(plan?.where), normalizedExpr(testcase.plan.where));
    assert.deepEqual(plan?.groupBy, testcase.plan.groupBy);
    assert.equal(plan?.unknownKeys, testcase.plan.unknownKeys);
  });
  check('requested-field-statistics-and-method', () => {
    assert.equal(plan?.fields?.length, 1); assert.equal(plan.fields[0].field, testcase.field);
    assert.deepEqual([...plan.fields[0].statistics].sort(), [...testcase.plan.fields[0].statistics].sort());
    assert.equal(plan.fields[0].frequencies ?? false, testcase.plan.fields[0].frequencies ?? false);
    assert.equal(plan.quantileMethod, testcase.plan.quantileMethod);
  });
  let result = null, error = null;
  try {
    assert(plan?.kind === 'profile' || plan?.kind === 'group-profile', 'Unknown operation');
    result = await api[plan.kind === 'profile' ? 'profileData' : 'profileGroups'](
      api.createArrayProfileProvider(testcase.schema, testcase.rows), plan,
      executionRefs(testcase, suffix),
    );
    checks.push({ criterion: 'public-executor-accepts-exact-plan', pass: true });
    if (!testcase.expectedRefusal) check('computed-facts-match-independent-rubric', () => assert.deepEqual(computedClaim(testcase, result), testcase.expected));
  } catch (cause) {
    error = { code: typeof cause.code === 'string' ? cause.code : 'HARNESS_PLAN_ERROR', message: String(cause.message).slice(0, 1200) };
    checks.push({ criterion: 'public-executor-accepts-exact-plan', pass: false, error });
  }
  return { checks, pass: checks.every(check => check.pass), result,
    evidence: result ? { status: 'computed', facts: numericFacts(result) } : { status: 'execution-refused', error } };
}

export function gradeInterpretation(testcase, claim) {
  return Object.entries(testcase.expected).map(([criterion, value]) => {
    try { assert.deepEqual(claim?.[criterion], value); return { criterion, pass: true }; }
    catch { return { criterion, pass: false, expected: value, actual: claim?.[criterion] ?? '(missing)' }; }
  });
}

export async function verifyFixtures(api, cases) {
  const evidence = [];
  for (const testcase of cases) {
    if (testcase.expectedRefusal === 'numeric-identifier') {
      await assert.rejects(() => api.profileData(api.createArrayProfileProvider(testcase.schema, testcase.rows), testcase.plan,
        executionRefs(testcase, 'oracle')), error => error.code === 'INVALID_PROFILE');
      evidence.push({ id: testcase.id, status: 'public-executor-rejects-numeric-identifier', rubric: testcase.expected });
    } else if (testcase.expectedRefusal === 'aggregate-grain') {
      const result = await api.profileData(api.createArrayProfileProvider(testcase.schema, testcase.rows), testcase.plan,
        executionRefs(testcase, 'oracle'));
      assert.equal(result.fields[0].statistics.p95, 100);
      evidence.push({ id: testcase.id, status: 'numerically-valid-but-wrong-population-for-request', explanation: '100 is the p95 of two client means; individual request p95 is unavailable from this schema.', facts: numericFacts(result), rubric: testcase.expected });
    } else {
      const executed = await executeDecision(api, testcase, { decision: 'calculate', reasonCode: 'none', plan: testcase.plan }, 'oracle');
      assert(executed.pass, 'Independent fixture failed public execution: ' + testcase.id + JSON.stringify(executed.checks));
      evidence.push({ id: testcase.id, status: 'canonical-plan-matches-independent-rubric', facts: numericFacts(executed.result), rubric: testcase.expected });
    }
  }
  // Negative controls exercise the evaluator itself, with no production mutation.
  const good = cases[0].expected;
  assert(gradeInterpretation(cases[0], good).every(check => check.pass));
  assert(gradeInterpretation(cases[0], { ...good, knownDenominator: good.selected }).some(check => !check.pass));
  assert(gradeInterpretation(cases[3], { ...cases[3].expected, sum: 0 }).some(check => !check.pass));
  assert(gradeInterpretation(cases[1], { ...cases[1].expected, selected: cases[1].expected.groupCount }).some(check => !check.pass));
  assert(gradeInterpretation(cases[7], { ...cases[7].expected, populationBasis: 'source-row' }).some(check => !check.pass));
  const wrong = await executeDecision(api, cases[0], { decision: 'calculate', reasonCode: 'none', plan: { ...cases[0].plan, where: undefined } }, 'negative-control');
  assert.equal(wrong.pass, false);
  const wrongRefusal = await executeDecision(api, cases[0], { decision: 'refuse', reasonCode: 'numeric-identifier' }, 'negative-control');
  assert.equal(wrongRefusal.pass, false);
  const conflictingReason = await executeDecision(api, cases[0], { decision: 'calculate', reasonCode: 'numeric-identifier', plan: cases[0].plan }, 'negative-control');
  assert.deepEqual(conflictingReason.checks.filter(check => !check.pass).map(check => check.criterion), ['calculation-reason-is-none']);
  const extraFrequencies = await executeDecision(api, cases[0], { decision: 'calculate', reasonCode: 'none',
    plan: { ...cases[0].plan, fields: cases[0].plan.fields.map(field => ({ ...field, frequencies: true })) },
  }, 'negative-control');
  assert.deepEqual(extraFrequencies.checks.filter(check => !check.pass).map(check => check.criterion), ['requested-field-statistics-and-method']);
  return { evidence, negativeControls: 8 };
}
