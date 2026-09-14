import { describe, expect, it } from 'vitest';
import { conflictsOf, participates } from 'contextfootprint';
import { profileStatisticAssertion } from './assertion.js';
import { createArrayProfileProvider } from './memory.js';
import { profileData } from './run.js';
import type { ProfilePlan, ProfileResult, ProfileSchema } from './types.js';

const schema: ProfileSchema = {
  source: { id: 'requests', version: 'snapshot-1' }, table: 'requests', grain: 'one completed request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Observed client' },
    { name: 'duration', type: 'number', role: 'measure', meaning: 'Completed duration', unit: 'ms' },
  ],
};
const plan: ProfilePlan = {
  kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'client-a',
  where: { op: 'eq', args: [{ col: 'client' }, { lit: 'a' }] },
  fields: [{ field: 'duration', statistics: ['mean', 'min', 'median', 'p95', 'stddevSample'] }],
  quantileMethod: 'linear',
};
const stamp = { field: 'duration', statistic: 'mean', scope: 'investigation-a', epoch: 3, stratum: 'asserted' } as const;
const fixture = (values: (number | null)[] = [0, null, 20], s = schema, p = plan) => profileData(
  createArrayProfileProvider(s, values.map(duration => ({ client: 'a', duration }))),
  { ...p, source: s.source }, { operationId: 'profile-1', resultRef: 'result-1' },
);
const observed = (result: ProfileResult) => profileStatisticAssertion(result, stamp);

describe('profile statistic assertions', () => {
  it('projects the computed value, then shares exact conflict witnesses with the core', async () => {
    const result = await fixture();
    const observation = observed(result);
    const correct = { ...observation, value: 10, provenance: 'explicit claim about this exact measure' };
    const wrong = { ...correct, value: 20 };
    expect(observation.value).toBe(10);
    expect(conflictsOf([observation, correct])).toEqual([]);
    const conflicts = conflictsOf([observation, wrong]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.assertions[0]).toBe(observation);
    expect(conflicts[0]!.assertions[1]).toBe(wrong);
    expect(JSON.parse(observation.provenance)).toMatchObject({ resultRef: 'result-1', operationId: 'profile-1', known: 2, unknown: 1 });
  });

  it('preserves zero and unknown without converting missing estimates into zero', async () => {
    const zero = observed(await fixture([0, 0]));
    const unknown = observed(await fixture([null, null]));
    expect(zero.value).toBe(0);
    expect(participates(zero.value)).toBe(true);
    expect(unknown.value).toMatchObject({ kind: 'unknown' });
    expect(participates(unknown.value)).toBe(false);
    // Absence of a contradiction is not proof of a claim.
    expect(conflictsOf([unknown, { ...unknown, value: 99 }])).toEqual([]);
    const sample = profileStatisticAssertion(await fixture([0]), { ...stamp, statistic: 'stddevSample' });
    expect(sample.value).toMatchObject({ kind: 'unknown' });
  });

  it('separates explicit host scope, epoch and current versus quoted evidence', async () => {
    const result = await fixture();
    const current = observed(result);
    for (const option of [{ scope: 'another-investigation' }, { epoch: 4 }, { stratum: 'quoted' as const }]) {
      const other = profileStatisticAssertion(result, { ...stamp, ...option });
      expect(conflictsOf([current, { ...other, value: 999 }])).toEqual([]);
    }
  });

  it('qualifies snapshot, table, selection ref and actual predicate even with a reused selection ref', async () => {
    const result = await fixture();
    const current = observed(result);
    const variants = [
      { ...result, schema: { ...result.schema, table: 'other' } },
      { ...result, plan: { ...result.plan, selectionRef: 'other' } },
      { ...result, plan: { ...result.plan, where: { lit: true } } },
      await fixture(undefined, { ...schema, source: { ...schema.source, version: 'snapshot-2' } }),
      await fixture(undefined, { ...schema, source: { ...schema.source, id: 'other-source' } }),
    ];
    for (const variant of variants) {
      const other = observed(variant);
      expect(other.subject).not.toEqual(current.subject);
      expect(conflictsOf([current, { ...other, value: 999 }])).toEqual([]);
    }
    // Object property insertion order is not predicate meaning.
    expect(observed({ ...result, plan: { ...result.plan, where: { args: [{ col: 'client' }, { lit: 'a' }], op: 'eq' } } }).subject).toEqual(current.subject);
  });

  it('separates units and grain without silently converting or relabelling values', async () => {
    const current = observed(await fixture());
    for (const s of [
      { ...schema, grain: 'one ten-second average' },
      { ...schema, columns: schema.columns.map(c => c.name === 'duration' ? { ...c, unit: 's' } : c) },
      { ...schema, columns: schema.columns.map(c => c.name === 'duration' ? { ...c, meaning: 'Storage processing duration' } : c) },
    ]) {
      const other = observed(await fixture(undefined, s));
      expect(other.predicate).not.toBe(current.predicate);
      expect(conflictsOf([current, { ...other, value: 999 }])).toEqual([]);
    }
  });

  it('uses the statistic and its applicable method, not unrelated plan settings', async () => {
    const linear = await fixture();
    const nearest = await fixture(undefined, schema, { ...plan, quantileMethod: 'nearest-rank' });
    expect(observed(linear).predicate).toBe(observed(nearest).predicate);
    expect(profileStatisticAssertion(linear, { ...stamp, statistic: 'p95' }).predicate)
      .not.toBe(profileStatisticAssertion(nearest, { ...stamp, statistic: 'p95' }).predicate);
    expect(profileStatisticAssertion(linear, { ...stamp, statistic: 'min' }).predicate).not.toBe(observed(linear).predicate);
    expect(observed(linear).predicate).toContain('known-selected-values');
  });

  it('keeps separate fields separate and never rescans data while creating observations', async () => {
    const s = { ...schema, columns: [...schema.columns, { ...schema.columns[1]!, name: 'processing' }] };
    const provider = createArrayProfileProvider(s, [{ client: 'a', duration: 0, processing: 20 }]);
    let scans = 0;
    const result = await profileData({ ...provider, scan(...args) { scans++; return provider.scan(...args); } },
      { ...plan, fields: [...plan.fields, { field: 'processing', statistics: ['mean'] }] },
      { operationId: 'two-fields', resultRef: 'two-fields-result' });
    const duration = observed(result);
    const processing = profileStatisticAssertion(result, { ...stamp, field: 'processing' });
    expect(scans).toBe(1);
    expect(duration.value).toBe(0);
    expect(processing.value).toBe(20);
    expect(duration.predicate).not.toBe(processing.predicate);
    expect(conflictsOf([duration, processing])).toEqual([]);
  });

  it('uses collision-free tuple addresses and keeps operation references as provenance only', async () => {
    const result = await fixture();
    const a = profileStatisticAssertion({ ...result, schema: { ...result.schema, table: 'b_c' } }, { ...stamp, scope: 'a' });
    const b = profileStatisticAssertion({ ...result, schema: { ...result.schema, table: 'c' } }, { ...stamp, scope: 'a_b' });
    expect(a.subject).not.toEqual(b.subject);
    const changedReceipt = observed({ ...result, operationId: 'profile-2', resultRef: 'result-2' });
    expect(changedReceipt.subject).toEqual(observed(result).subject);
    expect(changedReceipt.predicate).toEqual(observed(result).predicate);
    expect(changedReceipt.provenance).not.toBe(observed(result).provenance);
  });

  it('refuses absent fields and statistics instead of inventing observations', async () => {
    const result = await fixture();
    expect(() => profileStatisticAssertion(result, { ...stamp, field: 'not-present' })).toThrow();
    expect(() => profileStatisticAssertion(result, { ...stamp, statistic: 'sum' })).toThrow();
    expect(() => observed({ ...result, fields: [] })).toThrow();
    expect(() => observed({ ...result, fields: result.fields.map(f => ({ ...f, statistics: {} })) })).toThrow();
    expect(() => observed({ ...result, fields: [...result.fields, result.fields[0]!] })).toThrow();
  });

  it('refuses invalid or contradictory metadata and non-finite outputs', async () => {
    const result = await fixture();
    for (const options of [{ ...stamp, epoch: undefined }, { ...stamp, epoch: -1 }, { ...stamp, epoch: 0.5 },
      { ...stamp, scope: '' }, { ...stamp, stratum: 'observed' }, { ...stamp, extra: true }]) {
      expect(() => profileStatisticAssertion(result, options as typeof stamp)).toThrow();
    }
    expect(() => observed({ ...result, schema: { ...result.schema, source: { id: 'other', version: '1' } } })).toThrow();
    expect(() => observed({ ...result, fields: result.fields.map(f => ({ ...f, unit: 'seconds' })) })).toThrow();
    expect(() => observed({ ...result, fields: result.fields.map(f => ({ ...f, statistics: { mean: Infinity } })) })).toThrow();
    expect(() => observed({ ...result, conventions: { ...result.conventions, statisticsPopulation: 'all-values' } } as never)).toThrow();
  });

  it('refuses malformed receipt envelopes, incomplete coverage and unsupported conventions', async () => {
    const result = await fixture();
    const field = result.fields[0]!;
    const malformed: unknown[] = [
      null, { ...result, kind: 'groups' }, { ...result, version: 2 },
      { ...result, fields: null }, { ...result, fields: Array(33).fill(field) },
      { ...result, population: { ...result.population, selected: 99 } },
      { ...result, population: null },
      { ...result, fields: [{ ...field, known: -1 }] },
      { ...result, fields: [{ ...field, unknown: '1' }] },
      { ...result, fields: [{ ...field, statistics: null }] },
      { ...result, fields: [{ ...field, statistics: { mean: '10' } }] },
      { ...result, fields: [{ ...field, statistics: { mean: null } }] },
      { ...result, fields: [{ ...field, type: 'string' }] },
      { ...result, fields: [{ ...field, role: 'identifier' }] },
      { ...result, fields: [{ ...field, meaning: 'A different measurement' }] },
      { ...result, conventions: null },
      ...['missing', 'invalid', 'predicate'].map(key => ({ ...result, conventions: { ...result.conventions, [key]: 'unsupported' } })),
      { ...result, execution: null }, { ...result, execution: { ...result.execution, exact: false } },
    ];
    for (const receipt of malformed) expect(() => observed(receipt as ProfileResult)).toThrow();
    expect(() => profileStatisticAssertion(result, { ...stamp, statistic: 'p99' } as never)).toThrow();
    const noEstimate = await fixture([null]);
    expect(() => observed({ ...noEstimate, fields: noEstimate.fields.map(f => ({ ...f, statistics: { mean: 0 } })) })).toThrow();
  });

  it('keeps an unspecified unit distinct and supports an explicit all-rows selection', async () => {
    const unitless = { ...schema, columns: schema.columns.map(({ unit: _unit, ...column }) => column) };
    const { where: _where, ...allRows } = plan;
    const result = await fixture(undefined, unitless, allRows);
    const assertion = observed(result);
    expect(assertion.value).toBe(10);
    expect(assertion.predicate).not.toBe(observed(await fixture()).predicate);
    expect(assertion.subject).not.toEqual(observed(await fixture()).subject);
  });

  it('returns a frozen detached observation without mutating the receipt', async () => {
    const result = await fixture();
    const before = JSON.stringify(result);
    const assertion = observed(result);
    expect(Object.isFrozen(assertion)).toBe(true);
    expect(Object.isFrozen(assertion.subject)).toBe(true);
    expect(JSON.stringify(result)).toBe(before);
    const unknown = observed(await fixture([null]));
    expect(Object.isFrozen(unknown.value)).toBe(true);
  });
});
