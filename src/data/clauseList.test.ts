/**
 * The query port takes a clause LIST — its AND — so the whole live selection
 * is one question to the engine; the descriptor and the count are the same
 * from every memory layout, and the session no longer folds rows in JS.
 */
import { describe, it, expect } from 'vitest';
import { memoryProvider, resolvePredicateSQL, isRejection } from './index.js';
import type { PredicateClause } from './index.js';

const rows = [
  { id: 'a', price: 40, category: 'Casual', region: 'N' },
  { id: 'b', price: 160, category: 'Formal', region: 'N' },
  { id: 'c', price: 220, category: 'Formal', region: 'S' },
  { id: 'd', price: 90, category: 'Party', region: 'S' },
];
const price: PredicateClause = { kind: 'interval', field: 'price', value: [50, 200] };
const formal: PredicateClause = { kind: 'point', field: 'category', value: 'Formal' };

describe('resolvePredicateSQL over a list', () => {
  it('an empty list is no filter, one clause is itself, many are their AND with each side parenthesised', () => {
    expect(resolvePredicateSQL([])).toBe(resolvePredicateSQL(null));
    expect(resolvePredicateSQL([price])).toBe(resolvePredicateSQL(price));
    expect(resolvePredicateSQL([price, formal])).toBe(`(${resolvePredicateSQL(price)}) AND (${resolvePredicateSQL(formal)})`);
  });
});

describe('a list with a cleared clause, a match, and a cell', () => {
  it('a cleared conjunct is no conjunct; a match and a cell keep their own descriptor inside the AND', () => {
    const cleared: PredicateClause = { kind: 'interval', field: 'price', value: null };
    expect(resolvePredicateSQL([cleared, formal])).toBe(resolvePredicateSQL(formal));
    expect(resolvePredicateSQL([cleared])).toBe(resolvePredicateSQL(null));
    const set: PredicateClause = { kind: 'match', field: 'category', values: ['Formal', 'Party'], exclude: true };
    const cell: PredicateClause = { kind: 'cell', fields: ['price', 'category'], value: [[50, 200], 'Formal'] };
    const both = resolvePredicateSQL([set, cell]);
    expect(both).toBe(`(${resolvePredicateSQL(set)}) AND (${resolvePredicateSQL(cell)})`);
  });
});

describe('memoryProvider.evaluate over a list', () => {
  it('keeps the rows every clause keeps; count mode agrees; both layouts answer the same bytes', async () => {
    for (const layout of ['row', 'column'] as const) {
      const p = memoryProvider(rows, { tableName: 'data', layout });
      const both = await p.evaluate('data', [price, formal], { mode: 'rows' });
      expect(!isRejection(both) && both.rows?.map((r) => r['id'])).toEqual(['b']);
      expect(!isRejection(both) && both.sql).toBe(resolvePredicateSQL([price, formal]));
      const counted = await p.evaluate('data', [price, formal], { mode: 'count' });
      expect(!isRejection(counted) && counted.count).toBe(1);
      const none = await p.evaluate('data', [], { mode: 'count' });
      expect(!isRejection(none) && none.count).toBe(4);
      const one = await p.evaluate('data', [formal], { mode: 'count' });
      expect(!isRejection(one) && one.count).toBe(2);
    }
  });
  it('a column any clause reads must exist — the second clause is checked too', async () => {
    const p = memoryProvider(rows, { tableName: 'data' });
    const res = await p.evaluate('data', [formal, { kind: 'point', field: 'ghost', value: 1 }]);
    expect(isRejection(res) && res.reason).toBe('unknown-column');
    expect(isRejection(res) && res.detail).toBe('table "data" has no column "ghost"');
  });
});

describe('the engine over ragged rows', () => {
  it('the columns are the first row\'s, in both layouts; a key a later row adds is not a column', async () => {
    const ragged = [{ a: 1, b: 2 }, { a: 3 }, { a: 4, b: 5, ghost: 6 }];
    for (const layout of ['row', 'column'] as const) {
      const p = memoryProvider(ragged, { tableName: 't', layout });
      const cols = await p.columns('t');
      expect(!isRejection(cols) && cols.map((c) => [c.name, c.type])).toEqual([['a', 'number'], ['b', 'number']]);
    }
  });
});
