/**
 * memoryProvider.coverage.test.ts — closes the remaining gaps memoryProvider.test.ts
 * leaves: `inferType`'s null-skip / all-null / Date branches, an empty-rows
 * table, a CSV-sourced COLUMN-layout store, `columns()` on an unknown table,
 * and re-materializing an EXISTING column on a column-layout store.
 */

import { describe, it, expect } from 'vitest';
import { memoryProvider } from './memoryProvider.js';
import { isRejection } from './types.js';
import type { Row } from './types.js';

describe('memoryProvider — inferType edge cases', () => {
  it('a column mixing null with numbers still infers "number" (nulls are skipped, not disqualifying)', async () => {
    const rows: Row[] = [{ amount: 5 }, { amount: null }, { amount: 10 }];
    const p = memoryProvider(rows);
    expect(await p.columns('data')).toEqual([{ name: 'amount', type: 'number' }]);
  });

  it('an all-null column infers "unknown" (sawAny stays false)', async () => {
    const rows: Row[] = [{ tag: null }, { tag: null }];
    const p = memoryProvider(rows);
    expect(await p.columns('data')).toEqual([{ name: 'tag', type: 'unknown' }]);
  });

  it('materializing an all-null column also infers "unknown"', async () => {
    const p = memoryProvider([{ x: 1 }, { x: 2 }]);
    await p.materializeColumn('data', 'y', [null, null]);
    expect(await p.columns('data')).toContainEqual({ name: 'y', type: 'unknown' });
  });

  it('a column of Date instances infers "date"', async () => {
    const rows: Row[] = [
      { seen: new Date('2026-01-01') },
      { seen: new Date('2026-02-01') },
    ];
    const p = memoryProvider(rows);
    expect(await p.columns('data')).toEqual([{ name: 'seen', type: 'date' }]);
  });
});

describe('memoryProvider — an empty dataset (zero rows)', () => {
  it('tables() and columns() are both honest about having no columns to report', async () => {
    const p = memoryProvider([]);
    expect(await p.tables()).toEqual(['data']);
    expect(await p.columns('data')).toEqual([]);
  });

  it('evaluate() on an empty table matches nothing but does not reject', async () => {
    const p = memoryProvider([]);
    const result = await p.evaluate('data', null);
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(0);
    expect(result.rows).toEqual([]);
  });
});

describe('memoryProvider — CSV text input with COLUMN layout', () => {
  it('parses CSV text directly into a column-major store (toColumnStore\'s string branch)', async () => {
    const csv = 'category,amount\nData,15\nAnalytics,25\nData,5\n';
    const p = memoryProvider(csv, { layout: 'column' });
    expect(await p.columns('data')).toEqual([
      { name: 'category', type: 'string' },
      { name: 'amount', type: 'number' },
    ]);
    const result = await p.evaluate('data', { kind: 'point', field: 'category', value: 'Data' });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(2);
  });
});

describe('memoryProvider — columns() on an unknown table', () => {
  it('is a typed rejection, matching evaluate()/materializeColumn()\'s existing behavior', async () => {
    const p = memoryProvider([{ x: 1 }]);
    const result = await p.columns('nope');
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) throw new Error('unreachable');
    expect(result).toEqual({
      ok: false,
      engine: 'memory',
      operation: 'columns',
      reason: 'unknown-table',
      detail: 'no such table "nope"',
    });
  });
});

describe('memoryProvider — re-materializing an EXISTING column on a column-layout store', () => {
  it('overwrites the column values without duplicating its name in order/columns()', async () => {
    const p = memoryProvider([{ amount: 1 }, { amount: 2 }], { layout: 'column' });
    await p.materializeColumn('data', 'amount', [100, 200]);

    const cols = await p.columns('data');
    if (isRejection(cols)) throw new Error('unreachable');
    expect(cols.filter((c) => c.name === 'amount')).toHaveLength(1);

    const result = await p.evaluate('data', { kind: 'point', field: 'amount', value: 100 });
    if (isRejection(result)) throw new Error('unreachable');
    expect(result.count).toBe(1);
    expect(result.rows).toEqual([{ amount: 100 }]);
  });
});
