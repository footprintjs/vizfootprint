import { describe, expect, it } from 'vitest';
import { compile } from '../../derive/walk.js';
import { judgeExpr } from '../../derive/judge.js';
import type { Cell, Expr } from '../../derive/types.js';
import { createGroupConsumer } from './groups.consumer.js';
import { profileCell } from './cell.js';
import { ProfileError } from './error.js';
import type { GroupProfilePlan } from './groups.types.js';
import type { ProfileReserve } from './scan.types.js';
import type { ProfileSchema } from './types.js';

const schema: ProfileSchema = {
  source: { id: 'requests', version: 'snapshot-1' }, table: 'requests', grain: 'One observed request',
  columns: [
    { name: 'client', type: 'string', role: 'identifier', meaning: 'Observed client' },
    { name: 'operation', type: 'string', role: 'dimension', meaning: 'Request operation' },
    { name: 'duration', type: 'number', role: 'measure', meaning: 'Known request duration', unit: 'ms' },
    { name: 'port', type: 'number', role: 'identifier', meaning: 'Network port' },
    { name: 'success', type: 'boolean', role: 'dimension', meaning: 'Known request success' },
  ],
};
const limits = { maxScannedRows: 100_000, maxExactValues: 100, maxDistinctValues: 100,
  maxRetainedValues: 10_000, maxRetainedCharacters: 10_000, maxGroups: 128, maxGroupFields: 4096 };
const plan: GroupProfilePlan = {
  kind: 'group-profile', version: 1, ops: 1, source: schema.source, selectionRef: 'selected-requests',
  groupBy: ['client'], unknownKeys: 'include', limits, quantileMethod: 'linear',
  fields: [{ field: 'duration', statistics: ['sum', 'mean', 'median', 'p95'] }],
};
const noReserve: ProfileReserve = () => {};
function reader(row: Record<string, unknown>, definition = schema) {
  return (name: string): Cell => profileCell(row[name], definition.columns.find(column => column.name === name)!);
}
function consume(rows: readonly Record<string, unknown>[], input: GroupProfilePlan = plan, definition = schema, reserve = noReserve) {
  const consumer = createGroupConsumer(definition, input, 'result:groups-1', reserve);
  rows.forEach(row => consumer.push(reader(row, definition)));
  return consumer.finish();
}
function rejects(action: () => unknown, code: string) {
  try { action(); throw new Error('Expected a ProfileError'); }
  catch (error) { expect(error).toBeInstanceOf(ProfileError); expect((error as ProfileError).code).toBe(code); }
}

describe('group profile consumer: partitions and evidence identity', () => {
  it('profiles unequal populations independently, preserving first-seen order and result-local group references', () => {
    const rows = [{ client: 'small', duration: 100 }, ...Array.from({ length: 9 }, () => ({ client: 'large', duration: 0 }))];
    const result = consume(rows);
    expect(result).toMatchObject({ grouped: 10, withUnknownKeys: 0, excludedUnknownKeys: 0 });
    expect(result.groups.map(group => ({ ref: group.ref, keys: group.keys, rows: group.rowCount, stats: group.fields[0]!.statistics })))
      .toEqual([
        { ref: { resultRef: 'result:groups-1', index: 0 }, keys: { client: 'small' }, rows: 1, stats: { sum: 100, mean: 100, median: 100, p95: 100 } },
        { ref: { resultRef: 'result:groups-1', index: 1 }, keys: { client: 'large' }, rows: 9, stats: { sum: 0, mean: 0, median: 0, p95: 0 } },
      ]);
    // The source mean is 10, not the unweighted mean of group means (50).
    expect(result.groups.reduce((sum, group) => sum + group.fields[0]!.statistics!.sum!, 0) / result.grouped).toBe(10);
    expect(result.groups[0]!.fields[0]).toMatchObject({ unit: 'ms', meaning: 'Known request duration', known: 1, unknown: 0 });
  });

  it('uses collision-free tuples rather than delimiter-joined keys', () => {
    const rows = [
      { client: 'a|b', operation: 'c', duration: 1 },
      { client: 'a', operation: 'b|c', duration: 2 },
      { client: 'a\",\"b', operation: 'c', duration: 3 },
      { client: 'a', operation: 'b\",\"c', duration: 4 },
      { client: 'a|b', operation: 'c', duration: 5 },
    ];
    const result = consume(rows, { ...plan, groupBy: ['client', 'operation'] });
    expect(result.groups.map(group => [group.keys.client, group.keys.operation, group.rowCount, group.fields[0]!.statistics!.sum]))
      .toEqual([['a|b', 'c', 2, 6], ['a', 'b|c', 1, 2], ['a\",\"b', 'c', 1, 3], ['a', 'b\",\"c', 1, 4]]);
  });

  it('preserves typed boolean and numeric keys and canonicalizes signed zero', () => {
    const result = consume([
      { success: false, port: -0, duration: 1 }, { success: false, port: 0, duration: 2 },
      { success: true, port: 0, duration: 3 }, { success: false, port: 443, duration: 4 },
    ], { ...plan, groupBy: ['success', 'port'] });
    expect(result.groups.map(group => [group.keys, group.rowCount]))
      .toEqual([[{ success: false, port: 0 }, 2], [{ success: true, port: 0 }, 1], [{ success: false, port: 443 }, 1]]);
    expect(Object.is(result.groups[0]!.keys.port, -0)).toBe(false);
  });

  it('uses safe own properties for prototype-like column names and values', () => {
    const definition: ProfileSchema = { ...schema, columns: [...schema.columns,
      { name: '__proto__', type: 'string', role: 'identifier', meaning: 'Opaque identifier' }] };
    const result = consume([JSON.parse('{"__proto__":"constructor","duration":3}')], { ...plan, groupBy: ['__proto__'] }, definition);
    const keys = result.groups[0]!.keys;
    expect(Object.hasOwn(keys, '__proto__')).toBe(true);
    expect(keys.__proto__).toBe('constructor');
    expect(Object.getPrototypeOf(keys)).toBe(Object.prototype);
  });

  it('returns an empty complete group collection when no rows were selected', () => {
    expect(consume([])).toEqual({ groups: [], grouped: 0, withUnknownKeys: 0, excludedUnknownKeys: 0 });
  });
});

describe('group profile consumer: missing keys and exact drill-down', () => {
  it('distinguishes an included null-key group from the literal string null and merges undefined with null', () => {
    const result = consume([{ client: null, duration: 2 }, { duration: 4 }, { client: 'null', duration: 8 }]);
    expect(result).toMatchObject({ grouped: 3, withUnknownKeys: 2, excludedUnknownKeys: 0 });
    expect(result.groups.map(group => [group.keys.client, group.rowCount, group.fields[0]!.statistics!.mean]))
      .toEqual([[null, 2, 3], ['null', 1, 8]]);
    expect(result.groups[0]!.where).toEqual({ op: 'isAbsent', args: [{ col: 'client' }] });
  });

  it('excludes rows with any unknown key, reports them, and does not read their measures or reserve group keys', () => {
    const reserved: unknown[] = [];
    const consumer = createGroupConsumer(schema, { ...plan, groupBy: ['client', 'operation'], unknownKeys: 'exclude' }, 'result',
      (kind, value) => { reserved.push([kind, value]); });
    consumer.push(field => { if (field === 'duration') throw new Error('Excluded measure must not be read'); return field === 'client' ? 'a' : null; });
    expect(consumer.finish()).toEqual({ groups: [], grouped: 0, withUnknownKeys: 1, excludedUnknownKeys: 1 });
    expect(reserved).toEqual([]);
  });

  it('counts missing measures within their group without excluding an otherwise known key', () => {
    const result = consume([{ client: 'a', duration: null }, { client: 'a', duration: 0 }, { client: 'b' }]);
    expect(result.groups.map(group => ({ rows: group.rowCount, known: group.fields[0]!.known, unknown: group.fields[0]!.unknown, mean: group.fields[0]!.statistics!.mean })))
      .toEqual([{ rows: 2, known: 1, unknown: 1, mean: 0 }, { rows: 1, known: 0, unknown: 1, mean: null }]);
    expect(result.withUnknownKeys).toBe(0);
  });

  it('replays each group with the original selection and exact key expressions using the existing grammar', () => {
    const original: Expr = { op: 'gte', args: [{ col: 'duration' }, { lit: 5 }] };
    const input = { ...plan, groupBy: ['client', 'operation'], where: original };
    const rows = [
      { client: 'a', operation: 'read', duration: 3 }, { client: 'a', operation: 'read', duration: 7 },
      { client: 'b', operation: 'read', duration: 11 }, { client: null, operation: 'write', duration: 5 },
      { client: 'a', operation: 'write', duration: 9 }, { client: 'b', operation: 'read', duration: null },
    ];
    const selected = rows.filter(row => compile(original)(reader(row)) === true);
    const result = consume(selected, input);
    for (const group of result.groups) {
      expect(judgeExpr(group.where, schema.table, schema.columns).ok).toBe(true);
      const replay = rows.filter(row => compile(group.where)(reader(row)) === true);
      expect(replay).toHaveLength(group.rowCount);
      expect(replay.reduce((sum, row) => sum + row.duration!, 0)).toBe(group.fields[0]!.statistics!.sum);
      expect(group.where.op).toBe('and');
      expect(group.where.args?.[0]).toEqual(original);
    }
  });

  it('returns detached keys, refs, filters and field snapshots rather than mutable internal state', () => {
    const input = { ...plan, where: { op: 'gte', args: [{ col: 'duration' }, { lit: 0 }] } as Expr };
    const consumer = createGroupConsumer(schema, input, 'result', noReserve);
    consumer.push(reader({ client: 'a', duration: 3 }));
    const first = consumer.finish();
    (first.groups[0]!.keys as Record<string, Cell>).client = 'changed';
    (first.groups[0]!.ref as { index: number }).index = 99;
    const where = first.groups[0]!.where as unknown as { args: { args: { lit?: number }[] }[] };
    expect(() => { where.args[0]!.args[1]!.lit = 999; }).toThrow(TypeError);
    (first.groups[0]!.fields[0]!.statistics as Record<string, number>).sum = 999;
    consumer.push(reader({ client: 'a', duration: 5 }));
    const second = consumer.finish().groups[0]!;
    expect(second.keys.client).toBe('a'); expect(second.ref.index).toBe(0); expect(second.rowCount).toBe(2);
    expect(second.fields[0]!.statistics!.sum).toBe(8);
    expect(compile(second.where)(reader({ client: 'a', duration: 3 }))).toBe(true);
    expect(input.where).toEqual({ op: 'gte', args: [{ col: 'duration' }, { lit: 0 }] });
  });
});

describe('group profile consumer: bounds and failure completeness', () => {
  it('refuses missing or unsupported grouping columns before any scan', () => {
    rejects(() => createGroupConsumer(schema, { ...plan, groupBy: ['missing'] }, 'result', noReserve), 'INVALID_PROFILE');
    for (const type of ['date', 'unknown'] as const) {
      const definition = { ...schema, columns: [...schema.columns, { name: 'unsupported', type, role: 'dimension' as const, meaning: 'Unsupported type' }] };
      rejects(() => createGroupConsumer(definition, { ...plan, groupBy: ['unsupported'] }, 'result', noReserve), 'INVALID_PROFILE');
    }
  });

  it('refuses a base predicate whose added group conditions would exceed expression depth', () => {
    let where: Expr = { lit: true };
    for (let i = 0; i < 31; i++) where = { op: 'not', args: [where] };
    expect(judgeExpr(where, schema.table, schema.columns).ok).toBe(true);
    rejects(() => createGroupConsumer(schema, { ...plan, where }, 'result', noReserve), 'INVALID_PROFILE');
  });

  it('refuses concrete group keys that would make the complete replay plan exceed its text budget', () => {
    const where: Expr = { op: 'and', args: Array.from({ length: 16 }, () => ({ op: 'eq', args: [{ col: 'operation' }, { lit: 'x'.repeat(16_000) }] })) };
    const consumer = createGroupConsumer(schema, { ...plan, where }, 'result', noReserve);
    rejects(() => consumer.push(reader({ client: 'a'.repeat(16_384), duration: 1 })), 'INVALID_PROFILE');
    rejects(() => consumer.finish(), 'INVALID_PROFILE');
  });

  it('refuses excess groups and never exports a prefix after failure', () => {
    const consumer = createGroupConsumer(schema, { ...plan, limits: { ...limits, maxGroups: 1 } }, 'result', noReserve);
    consumer.push(reader({ client: 'a', duration: 1 }));
    consumer.push(reader({ client: 'a', duration: 2 }));
    expect(consumer.finish().groups[0]!.rowCount).toBe(2);
    rejects(() => consumer.push(reader({ client: 'b', duration: 3 })), 'PROFILE_LIMIT');
    rejects(() => consumer.finish(), 'PROFILE_LIMIT');
    rejects(() => consumer.push(reader({ client: 'a', duration: 4 })), 'PROFILE_LIMIT');
  });

  it('caps all group-field pairs even when fields request coverage only', () => {
    const consumer = createGroupConsumer(schema, { ...plan,
      fields: [{ field: 'duration' }, { field: 'success' }], limits: { ...limits, maxGroupFields: 3 } }, 'result', noReserve);
    consumer.push(reader({ client: 'a', duration: 1, success: true }));
    rejects(() => consumer.push(reader({ client: 'b', duration: 2, success: false })), 'PROFILE_LIMIT');
  });

  it('applies exact and frequency limits separately per group while using the same accumulator behavior', () => {
    const input: GroupProfilePlan = { ...plan, fields: [{ field: 'duration', statistics: ['median'], frequencies: true }],
      limits: { ...limits, maxExactValues: 2, maxDistinctValues: 1 } };
    const consumer = createGroupConsumer(schema, input, 'result', noReserve);
    for (const client of ['a', 'b']) consumer.push(reader({ client, duration: 1 }));
    consumer.push(reader({ client: 'a', duration: 1 }));
    expect(consumer.finish().groups.map(group => group.fields[0]!.known)).toEqual([2, 1]);
    rejects(() => consumer.push(reader({ client: 'a', duration: 1 })), 'PROFILE_LIMIT');
    const other = createGroupConsumer(schema, input, 'result', noReserve);
    other.push(reader({ client: 'b', duration: 1 }));
    rejects(() => other.push(reader({ client: 'b', duration: 2 })), 'PROFILE_LIMIT');
  });

  it('reserves group key cells once, including null, and shares retained slots across every group and field', () => {
    const calls: [string, Cell][] = [];
    const reserve: ProfileReserve = (kind, value) => {
      if (calls.length === 6) throw new ProfileError('PROFILE_LIMIT', 'Combined budget');
      calls.push([kind, value]);
    };
    const consumer = createGroupConsumer(schema, { ...plan, fields: [{ field: 'duration', statistics: ['median'], frequencies: true }] }, 'result', reserve);
    consumer.push(reader({ client: null, duration: 1 }));
    consumer.push(reader({ client: null, duration: 1 }));
    expect(calls).toEqual([['group-key', null], ['exact', 1], ['frequency', 1], ['exact', 1]]);
    rejects(() => consumer.push(reader({ client: 'b', duration: 2 })), 'PROFILE_LIMIT');
    expect(calls.slice(4)).toEqual([['group-key', 'b'], ['exact', 2]]);
    rejects(() => consumer.finish(), 'PROFILE_LIMIT');
  });

  it('propagates and latches reader or reservation failures, even values other than Error', () => {
    for (const origin of ['read', 'reserve'] as const) {
      const consumer = createGroupConsumer(schema, plan, 'result', origin === 'reserve' ? () => { throw undefined; } : noReserve);
      let thrown = 0;
      const read = origin === 'read' ? () => { throw undefined; } : reader({ client: 'a', duration: 1 });
      for (const action of [() => consumer.push(read), () => consumer.finish(), () => consumer.push(read)]) {
        try { action(); }
        catch (error) { expect(error).toBeUndefined(); thrown++; }
      }
      expect(thrown).toBe(3);
    }
  });

  it('refuses a nonfinite requested group result and latches finish failure', () => {
    const consumer = createGroupConsumer(schema, { ...plan, fields: [{ field: 'duration', statistics: ['sum'] }] }, 'result', noReserve);
    consumer.push(reader({ client: 'a', duration: Number.MAX_VALUE }));
    consumer.push(reader({ client: 'a', duration: Number.MAX_VALUE }));
    rejects(() => consumer.finish(), 'NUMERIC_OVERFLOW');
    rejects(() => consumer.push(reader({ client: 'a', duration: -Number.MAX_VALUE })), 'NUMERIC_OVERFLOW');
  });

  it('consumes a reused row reader immediately and reads no unrequested payload or raw rows', () => {
    const consumer = createGroupConsumer(schema, { ...plan, fields: [{ field: 'duration', statistics: ['sum'] }] }, 'result', noReserve);
    expect(consumer.reads).toEqual(['client']);
    let at = 0;
    const read = (field: string): Cell => {
      if (field === 'client') return at % 2 ? 'odd' : 'even';
      if (field === 'duration') return at;
      throw new Error('Payload or unrequested column was read');
    };
    for (; at < 10_000; at++) consumer.push(read);
    const result = consumer.finish();
    expect(result.groups.map(group => [group.rowCount, group.fields[0]!.statistics!.sum])).toEqual([[5000, 24_995_000], [5000, 25_000_000]]);
    expect(JSON.stringify(result).length).toBeLessThan(2000);
  });
});
