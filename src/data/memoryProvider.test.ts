import { describe, it, expect } from 'vitest';
import { memoryProvider } from './memoryProvider.js';
import { isRejection } from './types.js';
import type { Row } from './types.js';

const SAMPLE: Row[] = [
  { category: 'Data', amount: 15, active: true },
  { category: 'Analytics', amount: 25, active: false },
  { category: 'Data', amount: 5, active: true },
];

describe('memoryProvider — single-table construction (bare array, default table name)', () => {
  it('reports the default table name and inferred columns', async () => {
    const p = memoryProvider(SAMPLE);
    expect(p.engine).toBe('memory');
    expect(await p.tables()).toEqual(['data']);
    const cols = await p.columns('data');
    expect(isRejection(cols)).toBe(false);
    expect(cols).toEqual([
      { name: 'category', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'active', type: 'boolean' },
    ]);
  });

  it('honors a custom tableName', async () => {
    const p = memoryProvider(SAMPLE, { tableName: 'events' });
    expect(await p.tables()).toEqual(['events']);
  });

  it('capabilities are honest: canEvaluateSQL is false, canMaterialize is true', () => {
    const p = memoryProvider(SAMPLE);
    expect(p.capabilities).toEqual({ canEvaluateSQL: false, canMaterialize: true });
  });
});

describe('memoryProvider — multi-table construction (named map)', () => {
  it('exposes each table independently', async () => {
    const p = memoryProvider({
      views: [{ viewId: 'A', actor: 'user' }],
      brushes: [{ amount: 15 }, { amount: 25 }],
    });
    expect(await p.tables()).toEqual(['views', 'brushes']);
    expect(await p.columns('views')).toEqual([
      { name: 'viewId', type: 'string' },
      { name: 'actor', type: 'string' },
    ]);
  });
});

describe('memoryProvider — evaluate()', () => {
  it('point clause filters rows and returns the resolved sql', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', { kind: 'point', field: 'category', value: 'Data' });
    expect(isRejection(result)).toBe(false);
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.sql).toBe('("category" IN (\'Data\'))');
    expect(result.count).toBe(2);
    expect(result.rows).toEqual([SAMPLE[0], SAMPLE[2]]);
  });

  it('interval clause is inclusive on both ends', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', { kind: 'interval', field: 'amount', value: [5, 15] });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.sql).toBe('("amount" BETWEEN 5 AND 15)');
    expect(result.count).toBe(2);
  });

  it('null clause (no filter) returns every row', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', null);
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(3);
    expect(result.sql).toBe('null');
  });

  it('mode: "count" omits rows entirely', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', { kind: 'point', field: 'category', value: 'Data' }, { mode: 'count' });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(2);
    expect(result.rows).toBeUndefined();
  });

  it('a column projection narrows the returned row shape', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', null, { columns: ['category'] });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.rows).toEqual([{ category: 'Data' }, { category: 'Analytics' }, { category: 'Data' }]);
  });

  it('a limit caps the returned rows without changing count', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', null, { limit: 1 });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(3);
    expect(result.rows).toHaveLength(1);
  });

  it('unknown table is a typed rejection, never a silent empty result', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('nope', null);
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) throw new Error('unreachable');
    expect(result).toEqual({
      ok: false,
      engine: 'memory',
      operation: 'evaluate',
      reason: 'unknown-table',
      detail: 'no such table "nope"',
    });
  });

  it('unknown column is a typed rejection (an unknown WHERE column would error in real SQL too)', async () => {
    const p = memoryProvider(SAMPLE);
    const result = await p.evaluate('data', { kind: 'point', field: 'nope', value: 1 });
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) throw new Error('unreachable');
    expect(result.reason).toBe('unknown-column');
  });
});

describe('memoryProvider — materializeColumn (R11 landing spot)', () => {
  it('lands a new column, which then appears in columns() and is filterable', async () => {
    const p = memoryProvider(SAMPLE);
    const res = await p.materializeColumn('data', 'cluster_id', [1, 2, 1]);
    expect(res).toEqual({ ok: true });

    const cols = await p.columns('data');
    expect(cols).toContainEqual({ name: 'cluster_id', type: 'number' });

    const evald = await p.evaluate('data', { kind: 'point', field: 'cluster_id', value: 1 });
    if (isRejection(evald)) throw new Error('unreachable');
    expect(evald.count).toBe(2);
  });

  it('a row-count mismatch is a typed rejection, not a truncated/padded write', async () => {
    const p = memoryProvider(SAMPLE);
    const res = await p.materializeColumn('data', 'cluster_id', [1, 2]);
    expect(isRejection(res)).toBe(true);
    if (!isRejection(res)) throw new Error('unreachable');
    expect(res.reason).toBe('row-count-mismatch');
    // and it must NOT have partially landed
    expect(await p.columns('data')).not.toContainEqual(
      expect.objectContaining({ name: 'cluster_id' }),
    );
  });

  it('materializing on an unknown table is a typed rejection', async () => {
    const p = memoryProvider(SAMPLE);
    const res = await p.materializeColumn('nope', 'x', []);
    expect(isRejection(res)).toBe(true);
    if (!isRejection(res)) throw new Error('unreachable');
    expect(res.reason).toBe('unknown-table');
  });

  it('never mutates the caller-supplied row objects (row layout aliasing)', async () => {
    const local: Row[] = [{ x: 1 }, { x: 2 }];
    const p = memoryProvider(local, { layout: 'row' });
    await p.materializeColumn('data', 'y', [10, 20]);
    expect(local).toEqual([{ x: 1 }, { x: 2 }]); // untouched
    const cols = await p.columns('data');
    expect(cols).toContainEqual({ name: 'y', type: 'number' });
  });
});

describe('memoryProvider — CSV text input', () => {
  it('parses and types CSV the same way an object-array input would', async () => {
    const csv = 'category,amount,active\nData,15,true\nAnalytics,25,false\nData,5,true\n';
    const p = memoryProvider(csv);
    expect(await p.columns('data')).toEqual([
      { name: 'category', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'active', type: 'boolean' },
    ]);
    const result = await p.evaluate('data', { kind: 'interval', field: 'amount', value: [5, 15] });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(2);
  });
});

describe('memoryProvider — row vs column layout produce identical public results', () => {
  it('evaluate() agrees byte-for-byte on sql/count/rows across layouts', async () => {
    const rowP = memoryProvider(SAMPLE, { layout: 'row' });
    const colP = memoryProvider(SAMPLE, { layout: 'column' });
    const clause = { kind: 'point' as const, field: 'category', value: 'Data' };

    const rowResult = await rowP.evaluate('data', clause);
    const colResult = await colP.evaluate('data', clause);
    expect(isRejection(rowResult)).toBe(false);
    expect(isRejection(colResult)).toBe(false);
    expect(rowResult).toEqual(colResult);
  });

  it('columns() agrees across layouts', async () => {
    const rowP = memoryProvider(SAMPLE, { layout: 'row' });
    const colP = memoryProvider(SAMPLE, { layout: 'column' });
    expect(await rowP.columns('data')).toEqual(await colP.columns('data'));
  });

  it('materializeColumn() then evaluate() agrees across layouts', async () => {
    const rowP = memoryProvider(SAMPLE, { layout: 'row' });
    const colP = memoryProvider(SAMPLE, { layout: 'column' });
    await rowP.materializeColumn('data', 'cluster_id', [1, 2, 1]);
    await colP.materializeColumn('data', 'cluster_id', [1, 2, 1]);
    const clause = { kind: 'point' as const, field: 'cluster_id', value: 1 };
    expect(await rowP.evaluate('data', clause)).toEqual(await colP.evaluate('data', clause));
  });
});
