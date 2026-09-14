import { describe, expect, it } from 'vitest';
import { describeProfileOperation, listProfileOperations } from './operations.js';
import { PROFILE_QUANTILE_METHODS, PROFILE_STATISTICS } from './operations.types.js';
import type { ProfileOperationDescriptor, ProfileOperationKind } from './operations.types.js';
import { PROFILE_DEFAULT_LIMITS, PROFILE_MAXIMUM_LIMITS, normalizePlan } from './validate.js';
import { GROUP_PROFILE_DEFAULT_LIMITS, GROUP_PROFILE_MAXIMUM_LIMITS, normalizeGroupPlan } from './groups.validate.js';
import { profileData } from './run.js';
import { profileGroups } from './groups.js';
import { createArrayProfileProvider } from './memory.js';
import { ProfileError } from './error.js';
import type { ProfilePlan, ProfileSchema } from './types.js';
import type { Expr } from '../../derive/types.js';

const schema: ProfileSchema = {
  source: { id: 'capture:requests', version: 'capture-version-1' }, table: 'requests', grain: 'One observed request',
  columns: [
    { name: 'duration', type: 'number', role: 'measure', unit: 'ms', meaning: 'Known request duration' },
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Observed client identity' },
    { name: 'success', type: 'boolean', role: 'dimension', meaning: 'Known response outcome' },
    { name: 'port', type: 'number', role: 'identifier', meaning: 'Numeric endpoint identifier' },
    { name: 'unexposed', type: 'string', role: 'dimension', meaning: 'Private description not requested' },
    { name: 'day', type: 'date', role: 'dimension', meaning: 'Unsupported date domain' },
  ],
};
type Shape = {
  type?: string; const?: unknown; enum?: readonly unknown[]; oneOf?: readonly Shape[];
  properties?: Record<string, Shape>; items?: Shape; required?: readonly string[];
  minimum?: number; maximum?: number; minItems?: number; maxItems?: number;
  description?: string; uniqueItems?: boolean; default?: unknown; additionalProperties?: boolean;
  examples?: readonly Expr[];
};
function property(descriptor: ProfileOperationDescriptor, name: string): Shape {
  return descriptor.tool.inputSchema.properties[name] as Shape;
}
function fieldSchemas(descriptor: ProfileOperationDescriptor): readonly Shape[] {
  return property(descriptor, 'fields').items!.oneOf!;
}
function rejects(action: () => unknown, code = 'INVALID_PROFILE') {
  try { action(); throw new Error('Expected a ProfileError'); }
  catch (error) { expect(error).toBeInstanceOf(ProfileError); expect((error as ProfileError).code).toBe(code); }
}

describe('profile operation catalog: one semantic definition', () => {
  it('lists exactly the two implemented operations as immutable summaries', () => {
    const entries = listProfileOperations();
    expect(entries.map(entry => entry.id)).toEqual(['profile', 'group-profile']);
    expect(entries.every(entry => entry.title.length > 0 && entry.description.length > 0)).toBe(true);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(() => { (entries[0] as { title: string }).title = 'changed'; }).toThrow(TypeError);
    expect(listProfileOperations()).toEqual(entries);
  });

  it.each(['profile', 'group-profile'] as const)('uses the same %s definition for tool and UI, with explicit input and output grain', kind => {
    const result = describeProfileOperation(schema, kind, ['duration', 'client']);
    const summary = listProfileOperations().find(entry => entry.id === kind)!;
    expect(result.definitionVersion).toBe(1); expect(result.operation).toEqual(summary);
    expect(result.ui.title).toBe(summary.title); expect(result.ui.description).toBe(summary.description);
    expect(result.tool.description).toContain(summary.description);
    expect(result.tool.description).toContain(schema.grain);
    expect(result.tool.description).toContain(result.ui.outputGrain);
    for (const note of result.ui.notes) expect(result.tool.description).toContain(note);
    expect(result.source).toEqual(schema.source); expect(result.table).toBe(schema.table);
    expect(result.grain).toBe(schema.grain); expect(result.ui.inputGrain).toBe(schema.grain);
    expect(result.ui.outputGrain).not.toBe(schema.grain);
    expect(result.tool.name).toBe(kind === 'profile' ? 'profile_data' : 'profile_groups');
    const notes = result.ui.notes.join(' ');
    expect(notes).toContain('null'); expect(notes).toContain('undefined'); expect(notes).toContain('Zero');
    expect(notes).toContain('unit'); expect(notes).toContain('IEEE 754'); expect(notes).toContain('causality');
    expect(notes).toContain('operationId'); expect(notes).toContain('resultRef'); expect(notes).toContain('selectionRef');
    expect(notes).toContain('synchronous'); expect(notes).toContain('progress'); expect(notes).toContain('persist');
    expect(notes).toContain('row counts'); expect(notes).toContain('entity counts');
    expect(notes).toContain('ascending value order'); expect(notes).toContain('not a frequency ranking');
  });

  it('exposes only focused field metadata, in caller order, while preserving meanings, roles and units', () => {
    const result = describeProfileOperation(schema, 'profile', ['client', 'duration', 'success', 'port']);
    expect(result.fields.map(field => field.name)).toEqual(['client', 'duration', 'success', 'port']);
    expect(result.fields[1]).toEqual(schema.columns[0]);
    expect(JSON.stringify(result)).not.toContain('Private description not requested');
    expect(JSON.stringify(result)).not.toContain('Unsupported date domain');
    expect(JSON.stringify(result)).not.toContain('unexposed');
  });

  it('returns detached immutable descriptions and never shares mutable caller schema or focus handles', () => {
    const input = structuredClone(schema), focus = ['duration'];
    const descriptor = describeProfileOperation(input, 'profile', focus);
    (input.source as { version: string }).version = 'changed';
    (input.columns[0] as { meaning: string }).meaning = 'Changed'; focus[0] = 'client';
    expect(descriptor.source.version).toBe(schema.source.version);
    expect(descriptor.fields[0]!.meaning).toBe('Known request duration');
    expect(descriptor.fields[0]!.name).toBe('duration');
    expect(Object.isFrozen(descriptor.tool.inputSchema.properties)).toBe(true);
    expect(() => { (descriptor.fields[0] as { unit: string }).unit = 's'; }).toThrow(TypeError);
    expect(() => { (descriptor.ui.notes as string[]).push('invented'); }).toThrow(TypeError);
  });
});

describe('profile operation catalog: existing executable envelopes', () => {
  it('binds source identity and version and exposes only focused names for field requests', () => {
    const descriptor = describeProfileOperation(schema, 'profile', ['duration', 'client', 'success', 'port']);
    const json = descriptor.tool.inputSchema;
    expect(json.type).toBe('object'); expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['kind', 'version', 'ops', 'source', 'selectionRef', 'fields']);
    expect(property(descriptor, 'kind').const).toBe('profile'); expect(property(descriptor, 'version').const).toBe(1);
    expect(property(descriptor, 'ops').const).toBe(1);
    const source = property(descriptor, 'source');
    expect(source.properties!.id!.const).toBe(schema.source.id);
    expect(source.properties!.version!.const).toBe(schema.source.version);
    expect(source.additionalProperties).toBe(false); expect(source.required).toEqual(['id', 'version']);
    const fields = property(descriptor, 'fields');
    expect(fields.minItems).toBe(1); expect(fields.maxItems).toBe(4); expect(fields.uniqueItems).toBe(true);
    expect(fieldSchemas(descriptor).map(field => field.properties!.field!.const)).toEqual(['duration', 'client', 'success', 'port']);
    expect(json.properties).not.toHaveProperty('groupBy'); expect(json.properties).not.toHaveProperty('operationId');
    expect(json.properties).not.toHaveProperty('resultRef');
  });

  it('offers numeric statistics only for numeric measures, while all supported types can request frequencies', () => {
    const descriptor = describeProfileOperation(schema, 'profile', ['duration', 'client', 'success', 'port']);
    const choices = fieldSchemas(descriptor);
    expect(choices[0]!.properties!.field!.description).toContain('unit: ms');
    expect(choices[1]!.properties!.field!.description).toContain('unit: not declared');
    expect(choices[3]!.properties!.field!.description).toContain('role: identifier');
    expect(choices[0]!.properties!.statistics!.items!.enum).toEqual(PROFILE_STATISTICS);
    expect(choices[0]!.properties!.statistics).toMatchObject({ minItems: 1, maxItems: 8, uniqueItems: true });
    for (const choice of choices) {
      expect(choice.required).toEqual(['field']); expect(choice.additionalProperties).toBe(false);
      expect(choice.properties!.frequencies!.type).toBe('boolean');
    }
    for (const choice of choices.slice(1)) expect(choice.properties).not.toHaveProperty('statistics');
    expect(property(descriptor, 'quantileMethod').enum).toEqual(PROFILE_QUANTILE_METHODS);
    expect(property(descriptor, 'quantileMethod').description).toContain('median');
    expect(property(descriptor, 'quantileMethod').description).toContain('p95');
  });

  it('keeps the existing expression grammar and states the authority boundary', () => {
    const descriptor = describeProfileOperation(schema, 'profile', ['duration']);
    const where = property(descriptor, 'where');
    expect(where.type).toBe('object');
    expect(where.description).toContain('Expr'); expect(where.description).toContain('judge');
    expect(where).not.toHaveProperty('oneOf'); expect(where).not.toHaveProperty('properties');
    expect(descriptor.tool.description).toContain('not read authorization');
    expect(descriptor.tool.description).toContain('runtime validators');
  });

  it('exposes grouping and unknown-key policy explicitly without promising ordering or stable entity IDs', () => {
    const descriptor = describeProfileOperation(schema, 'group-profile', ['client', 'success']);
    expect(descriptor.tool.inputSchema.required).toEqual(['kind', 'version', 'ops', 'source', 'selectionRef', 'fields', 'groupBy', 'unknownKeys']);
    expect(property(descriptor, 'groupBy')).toMatchObject({ type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ['client', 'success'] } });
    expect(property(descriptor, 'unknownKeys').enum).toEqual(['include', 'exclude']);
    expect(descriptor.ui.notes.join(' ')).toContain('first-seen');
    expect(descriptor.ui.notes.join(' ')).toContain('same source snapshot');
    expect(descriptor.ui.notes.join(' ')).toContain('selected = grouped + excludedUnknownKeys');
    const larger = describeProfileOperation(schema, 'group-profile', ['duration', 'client', 'success', 'port']);
    expect(property(larger, 'groupBy').maxItems).toBe(4);
  });

  it.each(['profile', 'group-profile'] as const)('executes the %s advertised equality and conjunction through the existing expression engine', async kind => {
    const descriptor = describeProfileOperation(schema, kind, ['duration', 'client']);
    const where = property(descriptor, 'where');
    expect(where.description).toContain('exactly one of');
    expect(where.examples).toHaveLength(2);
    const source = createArrayProfileProvider(schema, [
      { duration: 1, client: 'example' }, { duration: 1, client: 'other' },
      { duration: 2, client: 'example' }, { duration: null, client: 'example' },
    ]);
    for (const [index, predicate] of where.examples!.entries()) {
      expect(descriptor.ui.notes.join('\n')).toContain(JSON.stringify(predicate));
      expect(descriptor.tool.description).toContain(JSON.stringify(predicate));
      const base: ProfilePlan = { kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'example-shape',
        where: predicate, fields: [{ field: 'duration', statistics: ['mean'] }] };
      const result = kind === 'profile'
        ? await profileData(source, base, { operationId: 'example', resultRef: 'example-result' })
        : await profileGroups(source, { ...base, kind, groupBy: ['client'], unknownKeys: 'include' }, { operationId: 'example', resultRef: 'example-result' });
      expect(result.population.selected).toBe(index === 0 ? 2 : 1);
      const summaries = result.kind === 'profile' ? [result.fields] : result.groups.map(group => group.fields);
      for (const fields of summaries) expect(fields).toMatchObject([{ field: 'duration', statistics: { mean: 1 } }]);
    }
  });

  it.each([
    ['duration', 1, 2], ['client', 'example', 'other'], ['success', true, false],
  ] as const)('advertises a correctly typed predicate for focused %s alone', async (name, included, excluded) => {
    const descriptor = describeProfileOperation(schema, 'profile', [name]);
    const examples = property(descriptor, 'where').examples;
    expect(examples).toHaveLength(1);
    const result = await profileData(createArrayProfileProvider(schema, [{ [name]: included }, { [name]: excluded }, { [name]: null }]), {
      kind: 'profile', version: 1, ops: 1, source: schema.source, selectionRef: 'typed-example',
      where: examples![0], fields: [{ field: name }],
    }, { operationId: 'typed-example', resultRef: 'typed-example-result' });
    expect(result.population).toMatchObject({ selected: 1, excluded: 2, predicateUnknown: 1 });
    expect(result.fields[0]).toMatchObject({ field: name, known: 1, unknown: 0 });
  });

  it('shares the group-key versus measured-field distinction with tool and UI and returns keys without redundant field summaries', async () => {
    const descriptor = describeProfileOperation(schema, 'group-profile', ['client', 'duration']);
    const note = descriptor.ui.notes.find(note => note.includes('groupBy keys are already returned'));
    expect(note).toBeDefined();
    expect(note).toContain('only when');
    expect(descriptor.tool.description).toContain(note);
    expect(property(descriptor, 'fields').description).toContain(note);
    const result = await profileGroups(createArrayProfileProvider(schema, [{ client: 'a', duration: 2 }, { client: 'a', duration: 4 }]), {
      kind: 'group-profile', version: 1, ops: 1, source: schema.source, selectionRef: 'group-example',
      groupBy: ['client'], unknownKeys: 'include', fields: [{ field: 'duration', statistics: ['mean'] }],
    }, { operationId: 'group-example', resultRef: 'group-example-result' });
    expect(result.groups[0]!.keys).toEqual({ client: 'a' });
    expect(result.groups[0]!.fields).toMatchObject([{ field: 'duration', statistics: { mean: 3 } }]);
    expect(result.groups[0]!.fields).toHaveLength(1);
  });

  it('derives default and hard limit values from the same constants as the executors', () => {
    const ordinary = property(describeProfileOperation(schema, 'profile', ['duration']), 'limits');
    for (const [name, value] of Object.entries(PROFILE_DEFAULT_LIMITS)) {
      expect(ordinary.properties![name]).toMatchObject({ type: 'integer', minimum: 1, default: value,
        maximum: PROFILE_MAXIMUM_LIMITS[name as keyof typeof PROFILE_MAXIMUM_LIMITS] });
    }
    expect(ordinary.properties).not.toHaveProperty('maxGroups');
    const grouped = property(describeProfileOperation(schema, 'group-profile', ['duration']), 'limits');
    expect(grouped.properties!.maxGroups).toMatchObject({ default: GROUP_PROFILE_DEFAULT_LIMITS.maxGroups, maximum: GROUP_PROFILE_MAXIMUM_LIMITS.maxGroups });
    expect(grouped.properties!.maxGroupFields).toMatchObject({ default: GROUP_PROFILE_DEFAULT_LIMITS.maxGroupFields, maximum: GROUP_PROFILE_MAXIMUM_LIMITS.maxGroupFields });
  });

  it('uses vocabulary accepted by runtime validation and executes every advertised statistic and quantile method', async () => {
    const descriptor = describeProfileOperation(schema, 'profile', ['duration']);
    const advertised = fieldSchemas(descriptor)[0]!.properties!.statistics!.items!.enum!;
    const source = createArrayProfileProvider(schema, [{ duration: 1 }, { duration: 3 }, { duration: 5 }]);
    for (const method of PROFILE_QUANTILE_METHODS) {
      const input: ProfilePlan = { kind: 'profile', version: 1, ops: 1, source: descriptor.source, selectionRef: 'all',
        fields: [{ field: 'duration', statistics: [...PROFILE_STATISTICS] }], quantileMethod: method };
      expect(normalizePlan(input).fields[0]!.statistics).toEqual(advertised);
      const result = await profileData(source, input, { operationId: 'test', resultRef: 'test:result' });
      expect(Object.keys(result.fields[0]!.statistics!)).toEqual(advertised);
      expect(result.fields[0]!.statistics).toMatchObject({ sum: 9, min: 1, max: 5, mean: 3, median: 3 });
    }
    expect(normalizeGroupPlan({ kind: 'group-profile', version: 1, ops: 1, source: descriptor.source,
      selectionRef: 'all', fields: [{ field: 'duration' }], groupBy: ['duration'], unknownKeys: 'include' }).kind).toBe('group-profile');
  });
});

describe('profile operation catalog: bounded metadata boundary', () => {
  it.each(['missing', '__proto__', null, 1])('refuses unsupported operation %s', kind => {
    rejects(() => describeProfileOperation(schema, kind as ProfileOperationKind, ['duration']));
  });

  it.each([null, 'duration', [], Array(17).fill('duration'), ['duration', 'duration'], ['missing'], [''], [3], ['day']])('refuses invalid or unsupported focus %j', focus => {
    rejects(() => describeProfileOperation(schema, 'profile', focus as readonly string[]));
  });

  it('validates the complete source schema and refuses getters without executing them', () => {
    rejects(() => describeProfileOperation({ ...schema, grain: '' }, 'profile', ['duration']));
    let reads = 0;
    const focus = ['duration']; Object.defineProperty(focus, '0', { enumerable: true, get() { reads++; return 'duration'; } });
    rejects(() => describeProfileOperation(schema, 'profile', focus));
    expect(reads).toBe(0);
    const unknown: ProfileSchema = { ...schema, columns: [{ ...schema.columns[0]!, type: 'unknown' }] };
    rejects(() => describeProfileOperation(unknown, 'profile', ['duration']));
  });

  it('refuses output beyond its character budget rather than silently removing fields or descriptions', () => {
    const large: ProfileSchema = { ...schema, columns: Array.from({ length: 16 }, (_, index) => ({
      name: `measure${index}`, type: 'number', role: 'measure', unit: 'ms', meaning: 'm'.repeat(4096),
    })) };
    const focus = large.columns.map(column => column.name);
    rejects(() => describeProfileOperation(large, 'profile', focus), 'PROFILE_LIMIT');
    const bounded = describeProfileOperation(large, 'profile', focus.slice(0, 2));
    expect(bounded.fields).toHaveLength(2);
    expect(bounded.fields[0]!.meaning).toHaveLength(4096);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(60_000);
  });
});
