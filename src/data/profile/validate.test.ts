import { describe, expect, it, vi } from 'vitest';
import { declaration, normalizePlan, normalizeSchema, positiveLimit, sameSource, textId, validateSelection, PROFILE_DEFAULT_LIMITS } from './validate.js';
import { profileData } from './run.js';
import type { ProfilePlan, ProfileSchema } from './types.js';

const schema: ProfileSchema = {
  source: { id: 'sample:requests', version: 'snapshot-1' }, table: 'requests', grain: 'one saved request',
  columns: [
    { name: 'duration', type: 'number', role: 'measure', meaning: 'Known request duration', unit: 'ms' },
    { name: 'port', type: 'number', role: 'identifier', meaning: 'Transport port' },
    { name: 'operation', type: 'string', role: 'dimension', meaning: 'Recorded operation' },
    { name: 'successful', type: 'boolean', role: 'dimension', meaning: 'Observed outcome' },
  ],
};
const plan: ProfilePlan = {
  kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'sample:all',
  fields: [{ field: 'duration', statistics: ['mean'] }],
};
const rawPlan = (value: unknown) => normalizePlan(value as ProfilePlan);
const rawSchema = (value: unknown) => normalizeSchema(value as ProfileSchema);
const nested = (depth: number): unknown => depth ? [nested(depth - 1)] : null;

describe('profile declaration boundary', () => {
  it('detaches and freezes ordinary JSON, including null prototypes and repeated references', () => {
    const shared = { present: true, absent: null, value: 0, label: 'read' };
    const input = Object.assign(Object.create(null), { values: [shared, shared, false] });
    const copied = declaration(input);
    shared.value = 900;
    expect(copied.values[0].value).toBe(0);
    expect(copied.values[0]).not.toBe(copied.values[1]);
    expect(Object.isFrozen(copied)).toBe(true);
    expect(Object.isFrozen(copied.values)).toBe(true);
    expect(Object.isFrozen(copied.values[0])).toBe(true);
  });

  it.each([undefined, () => 1, 1n, Symbol('hidden'), NaN, Infinity, -Infinity])('refuses non-JSON declaration value %s', value => {
    expect(() => declaration({ value })).toThrow(/finite JSON/);
  });
  it.each([new Date(0), Object.create({ inherited: 1 })])('refuses nonplain object declarations', value => {
    expect(() => declaration(value)).toThrow(/plain objects/);
  });
  it('refuses cycles without mistaking repeated acyclic input for a cycle', () => {
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => declaration(cyclic)).toThrow(/cyclic/);
  });
  it('never executes an accessor while validating a declaration', () => {
    const get = vi.fn(() => 1);
    expect(() => declaration(Object.defineProperty({}, 'secret', { get, enumerable: true }))).toThrow(/accessors/);
    expect(get).not.toHaveBeenCalled();
  });
  it('refuses hidden and symbol properties rather than silently dropping them', () => {
    expect(() => declaration(Object.defineProperty({}, 'hidden', { value: 1 }))).toThrow(/hidden values/);
    expect(() => declaration({ [Symbol('scope')]: 'other' })).toThrow(/symbol keys/);
  });
  it('refuses both sparse arrays and an array with a disguised non-index member', () => {
    expect(() => declaration(new Array(2))).toThrow(/dense/);
    const disguised: unknown[] & { extra?: number } = [10, 20];
    delete disguised[1]; disguised.extra = 20;
    expect(() => declaration(disguised)).toThrow(/dense/);
  });
  it('accepts the nesting boundary and refuses the next level', () => {
    expect(declaration(nested(70))).toEqual(nested(70));
    expect(() => declaration(nested(71))).toThrow(/deeply nested/);
  });
  it('bounds total nodes independently of depth and object width', () => {
    expect(() => declaration(Array.from({ length: 10_001 }, () => ({ value: null })))).toThrow(/too large/);
  });
  it('bounds object width before traversing its members', () => {
    expect(() => declaration(Object.fromEntries(Array.from({ length: 20_001 }, (_, i) => [String(i), null])))).toThrow(/too many members/);
  });
  it('bounds one string, accumulated string values, and accumulated property names', () => {
    expect(declaration('x'.repeat(16_384))).toHaveLength(16_384);
    expect(() => declaration('x'.repeat(16_385))).toThrow(/text is too large/);
    expect(() => declaration(Array(17).fill('x'.repeat(16_000)))).toThrow(/text is too large/);
    expect(() => declaration(Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['k'.repeat(16_000) + i, false])))).toThrow(/text is too large/);
  });
});

describe('profile wire contract and resource policy', () => {
  it.each([null, [], 3].map(value => ({ value })))('requires a top-level record, not $value', ({ value }) => expect(() => rawPlan(value)).toThrow(/must be an object/));
  it.each([{ kind: 'group' }, { version: 2 }, { ops: 2 }, { invented: true }])('refuses an incompatible plan %j', patch => {
    expect(() => rawPlan({ ...plan, ...patch })).toThrow(/Unsupported|Unknown/);
  });
  it.each([undefined, null, [], 'source'].map(source => ({ source })))('requires a structured source', ({ source }) => {
    const { source: _removed, ...rest } = plan;
    expect(() => rawPlan(source === undefined ? rest : { ...rest, source })).toThrow(/source must be an object/);
  });
  it.each([4, '', '  ', 'x'.repeat(4097)])('bounds nonempty identifiers', value => {
    expect(() => textId(value, 'selectionRef')).toThrow(/selectionRef must be a nonempty string/);
  });
  it('preserves valid identifier bytes and rejects source identity or version mismatches', () => {
    expect(() => textId('source:exact ID', 'source.id')).not.toThrow();
    expect(() => sameSource(schema.source, { ...schema.source })).not.toThrow();
    expect(() => sameSource({ ...schema.source, id: 'other' }, schema.source)).toThrow(/snapshot does not match/);
    expect(() => sameSource({ ...schema.source, version: 'snapshot-2' }, schema.source)).toThrow(/snapshot does not match/);
  });
  it.each([null, [], Array.from({ length: 33 }, (_, i) => ({ field: String(i) }))].map(fields => ({ fields })))('bounds the requested field population', ({ fields }) => {
    expect(() => rawPlan({ ...plan, fields })).toThrow(/1 to 32 fields/);
  });
  it('accepts the maximum field count, but refuses duplicate field identities', () => {
    expect(rawPlan({ ...plan, fields: Array.from({ length: 32 }, (_, i) => ({ field: `f${i}` })) }).fields).toHaveLength(32);
    expect(() => rawPlan({ ...plan, fields: [{ field: 'duration' }, { field: 'duration' }] })).toThrow(/Repeated field/);
  });
  it.each([null, [], Array(9).fill('mean')].map(statistics => ({ statistics })))('requires a bounded nonempty statistics list', ({ statistics }) => {
    expect(() => rawPlan({ ...plan, fields: [{ field: 'duration', statistics }] })).toThrow(/statistics must be a nonempty list/);
  });
  it.each([[4], ['mode'], ['mean', 'mean']].map(statistics => ({ statistics })))('refuses unknown or duplicate statistics $statistics', ({ statistics }) => {
    expect(() => rawPlan({ ...plan, fields: [{ field: 'duration', statistics }] })).toThrow(/Unknown or repeated statistic/);
  });
  it('keeps Boolean frequencies distinct from untyped truthy inputs', () => {
    expect(rawPlan({ ...plan, fields: [{ field: 'operation', frequencies: false }] }).fields[0]!.frequencies).toBe(false);
    expect(() => rawPlan({ ...plan, fields: [{ field: 'operation', frequencies: 'yes' }] })).toThrow(/frequencies must be boolean/);
  });
  it.each(['median', 'p95'])('requires a named method for %s', statistic => {
    const fields = [{ field: 'duration', statistics: [statistic] }];
    expect(() => rawPlan({ ...plan, fields })).toThrow(/explicit quantileMethod/);
    for (const quantileMethod of ['nearest-rank', 'linear']) expect(rawPlan({ ...plan, fields, quantileMethod }).quantileMethod).toBe(quantileMethod);
  });
  it('refuses unsupported quantile semantics even without a requested quantile', () => {
    expect(() => rawPlan({ ...plan, quantileMethod: 'approximate' })).toThrow(/Unsupported quantile method/);
  });
  it('detaches defaults and enforces all configured ceiling values', () => {
    const limits = { maxScannedRows: 10_000_000, maxExactValues: 1_000_000, maxDistinctValues: 4096, maxRetainedValues: 2_000_000, maxRetainedCharacters: 8_000_000 };
    expect(normalizePlan(plan).limits).toEqual(PROFILE_DEFAULT_LIMITS);
    const normalized = normalizePlan({ ...plan, limits });
    expect(normalized.limits).toEqual(limits);
    expect(Object.isFrozen(normalized.limits)).toBe(true);
    for (const [key, ceiling] of Object.entries(limits)) {
      expect(() => rawPlan({ ...plan, limits: { [key]: ceiling + 1 } })).toThrow(/must be an integer/);
      expect(rawPlan({ ...plan, limits: { [key]: 1 } }).limits?.[key as keyof typeof limits]).toBe(1);
    }
    limits.maxDistinctValues = 2;
    expect(normalized.limits?.maxDistinctValues).toBe(4096);
    expect(() => rawPlan({ ...plan, limits: { unbounded: true } })).toThrow(/Unknown limits property/);
  });
  it.each(['10', 1.5, 0, -1, NaN, Number.MAX_SAFE_INTEGER + 1])('refuses invalid positive budget %s', value => {
    expect(() => positiveLimit(value, 'budget', 10)).toThrow(/budget must be an integer/);
  });
});

describe('schema and selection compatibility', () => {
  it('preserves metadata and independently validates the schema width', () => {
    expect(normalizeSchema(schema)).toEqual(schema);
    const columns = Array.from({ length: 256 }, (_, i) => ({ ...schema.columns[0]!, name: `c${i}` }));
    expect(rawSchema({ ...schema, columns }).columns).toHaveLength(256);
    expect(() => rawSchema({ ...schema, columns: [...columns, { ...columns[0], name: 'overflow' }] })).toThrow(/1 to 256 columns/);
  });
  it.each([null, []].map(columns => ({ columns })))('refuses a missing/empty schema column list', ({ columns }) => {
    expect(() => rawSchema({ ...schema, columns })).toThrow(/1 to 256 columns/);
  });
  it('refuses duplicate names, undeclared physical types, roles, and empty units', () => {
    expect(() => rawSchema({ ...schema, columns: [schema.columns[0], schema.columns[0]] })).toThrow(/Repeated column/);
    for (const [patch, reason] of [[{ type: 'object' }, /Unsupported column type/], [{ role: 'guess' }, /Unsupported column role/], [{ unit: '' }, /column.unit/]] as const) {
      expect(() => rawSchema({ ...schema, columns: [{ ...schema.columns[0], ...patch }] })).toThrow(reason);
    }
  });
  it('preserves typed predicate dependencies and permits profiling without a predicate', () => {
    expect(validateSelection(plan, schema)).toEqual([]);
    expect(validateSelection({ ...plan, where: { op: 'eq', args: [{ col: 'operation' }, { lit: 'read' }] } }, schema)).toEqual(['operation']);
    expect(validateSelection({ ...plan, fields: [{ field: 'successful', frequencies: true }] }, schema)).toEqual([]);
  });
  it('refuses nonexistent fields, malformed expressions and non-Boolean predicates', () => {
    expect(() => validateSelection({ ...plan, fields: [{ field: 'missing' }] }, schema)).toThrow(/Unknown column/);
    expect(() => validateSelection({ ...plan, where: { col: 'missing' } }, schema)).toThrow();
    expect(() => validateSelection({ ...plan, where: { col: 'duration' } }, schema)).toThrow(/must produce a boolean/);
  });
  it.each(['date', 'unknown'] as const)('can describe %s metadata but refuses profiling it', type => {
    const extended = normalizeSchema({ ...schema, columns: [...schema.columns, { name: 'extra', type, role: 'dimension', meaning: 'Unsupported field' }] });
    expect(() => validateSelection({ ...plan, fields: [{ field: 'extra' }] }, extended)).toThrow(/not supported/);
  });
  it.each(['port', 'operation'])('refuses arithmetic over nonmeasure field %s', field => {
    expect(() => validateSelection({ ...plan, fields: [{ field, statistics: ['sum'] }] }, schema)).toThrow(/numeric measure/);
  });
  it('refuses an invalid declaration before invoking an external provider', async () => {
    const describe = vi.fn(() => schema), scan = vi.fn(function* () { yield { duration: 10 }; });
    await expect(profileData({ describe, scan }, { ...plan, limits: { maxRetainedValues: 2_000_001 } }, { operationId: 'op-1', resultRef: 'result-1' })).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(describe).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
  });
});
