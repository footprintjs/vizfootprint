import { describe, expect, it } from 'vitest';
import { createFieldNamespace, FieldNamespaceError, FIELD_NAMESPACE_PREFIX } from './index.js';

const make = (table = 'nodes', datasetRef = 'snapshot:1', fields = ['p95_us', 'node']) => createFieldNamespace({ datasetRef, table, fields });

describe('declared field namespaces', () => {
  it('binds exact source, table and field identity; resolution accepts only declared members', () => {
    const namespace = make();
    const binding = namespace.field('p95_us');
    expect(binding).toEqual({ field: 'p95_us', reference: { datasetRef: 'snapshot:1', table: 'nodes', field: 'p95_us' }, nativeField: expect.any(String) });
    expect(binding.nativeField.startsWith(FIELD_NAMESPACE_PREFIX)).toBe(true);
    expect(namespace.resolve(binding.nativeField)).toBe(binding);
    expect(make().field('p95_us')).toEqual(binding);
    expect(() => namespace.field('missing')).toThrow(FieldNamespaceError);
    expect(() => namespace.field('missing')).toThrow(/unknown-field/);
    expect(() => namespace.resolve(make('clients').field('p95_us').nativeField)).toThrow(/unknown-native-field/);
    expect(() => namespace.resolve(make('nodes', 'snapshot:2').field('p95_us').nativeField)).toThrow(/unknown-native-field/);
    expect(() => namespace.resolve(make('nodes', 'snapshot:1', ['unknown']).field('unknown').nativeField)).toThrow(/unknown-native-field/);
    expect(() => namespace.resolve('p95_us')).toThrow(/unknown-native-field/);
  });

  it('does not collapse delimiters, dataset versions, Unicode forms or UTF-16 surrogate code units', () => {
    const identities = [
      ['snapshot:1', 'a_b', 'c'], ['snapshot:1', 'a', 'b_c'],
      ['snapshot:1', 'a.b', 'c'], ['snapshot:1', 'a', 'b.c'],
      ['SNAPSHOT:1', 'a', 'b.c'], ['snapshot:1', 'A', 'b.c'], ['snapshot:1', 'a', 'B.c'],
      ['snapshot:2', 'a', 'b.c'], ['snapshot:1', 'a', '\ud800'],
      ['snapshot:1', 'a', '\ufffd'], ['snapshot:1', 'a', '\udc00'],
      ['snapshot:1', 'a', 'é'], ['snapshot:1', 'a', 'e\u0301'],
      ['snapshot:1', 'a', '🚀'], ['snapshot:1', 'a', '"],"injected'],
      ['snapshot:1', 'a', '\u0000'], ['snapshot:1', 'a', '\\u0000'],
    ];
    const tokens = identities.map(([datasetRef, table, field]) => createFieldNamespace({ datasetRef: datasetRef!, table: table!, fields: [field!] }).field(field!).nativeField);
    expect(new Set(tokens).size).toBe(identities.length);
    // SQL engines may compare quoted identifiers case-insensitively too.
    expect(new Set(tokens.map(token => token.toLowerCase())).size).toBe(identities.length);
  });

  it('copies and deeply freezes bindings; map keys cannot address prototypes; whitespace is exact', () => {
    const fields = ['__proto__', 'constructor', 'hasOwnProperty', ' x ', 'x'];
    const input = { datasetRef: ' source ', table: ' table ', fields };
    const namespace = createFieldNamespace(input);
    input.datasetRef = 'changed'; input.table = 'changed'; fields[0] = 'changed'; fields.push('extra');
    expect(namespace.bindings.map(binding => binding.field)).toEqual(['__proto__', 'constructor', 'hasOwnProperty', ' x ', 'x']);
    expect(Object.isFrozen(namespace)).toBe(true);
    expect(Object.isFrozen(namespace.bindings)).toBe(true);
    for (const binding of namespace.bindings) {
      expect(Object.isFrozen(binding)).toBe(true);
      expect(Object.isFrozen(binding.reference)).toBe(true);
      expect(namespace.resolve(binding.nativeField)).toBe(binding);
      expect(binding.reference.datasetRef).toBe(' source ');
      expect(binding.reference.table).toBe(' table ');
    }
    expect(namespace.field(' x ').nativeField).not.toBe(namespace.field('x').nativeField);
    expect(() => { (namespace.field('x').reference as { table: string }).table = 'tampered'; }).toThrow();
    expect(() => { (namespace.bindings as unknown[]).push('tampered'); }).toThrow();
  });

  it('accepts an empty declared field set and exact metadata limits', () => {
    expect(make(' ', ' ', []).bindings).toEqual([]);
    expect(() => make(' ', ' ', []).field('anything')).toThrow(/unknown-field/);
    const atLimit = createFieldNamespace({ datasetRef: 'd'.repeat(512), table: 't'.repeat(512), fields: ['f'.repeat(512), ...Array.from({ length: 255 }, (_, i) => String(i))] });
    expect(atLimit.bindings).toHaveLength(256);
  });

  it.each([
    null, undefined, [], 1, 'namespace',
    {}, { datasetRef: '', table: 't', fields: [] }, { datasetRef: 1, table: 't', fields: [] },
    { datasetRef: 'd', table: '', fields: [] }, { datasetRef: 'd', table: null, fields: [] },
    { datasetRef: 'd'.repeat(513), table: 't', fields: [] }, { datasetRef: 'd', table: 't'.repeat(513), fields: [] },
    { datasetRef: 'd', table: 't', fields: null }, { datasetRef: 'd', table: 't', fields: {} },
    { datasetRef: 'd', table: 't', fields: [''] }, { datasetRef: 'd', table: 't', fields: [5] },
    { datasetRef: 'd', table: 't', fields: ['f'.repeat(513)] },
    { datasetRef: 'd', table: 't', fields: ['a', 'a'] }, { datasetRef: 'd', table: 't', fields: Array(1) },
    { datasetRef: 'd', table: 't', fields: Array.from({ length: 257 }, (_, i) => String(i)) },
    { datasetRef: 'd', table: 't', fields: [], typo: true },
  ])('rejects malformed or oversized declaration %# before building any binding', input => {
    expect(() => createFieldNamespace(input as never)).toThrow(/invalid-input/);
  });

  it('refuses malformed lookup values without coercion', () => {
    const namespace = make();
    for (const value of [null, undefined, 3, {}, ['p95_us'], Symbol('field')]) {
      expect(() => namespace.field(value as never)).toThrow(/unknown-field/);
      expect(() => namespace.resolve(value as never)).toThrow(/unknown-native-field/);
    }
  });
});
