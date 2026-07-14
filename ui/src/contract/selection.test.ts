// @vitest-environment jsdom
/**
 * The clause-addressable selection derivation — including the PARITY PIN:
 * `clausePredicate` must agree with `src/data`'s real `matchesClause` on
 * every point/interval shape the wire can carry (the mirror-instead-of-import
 * contract stated in selection.ts's header).
 */
import { describe, it, expect } from 'vitest';
import { matchesClause } from '../../../src/data/predicate.js';
import type { PredicateClause } from '../../../src/data/types.js';
import { clausePredicate, emptySelection, keepPredicate, selectionForView, selfSelectedValue } from './selection.js';
import type { SelectionView } from '../adapter/types.js';

const ROWS = [
  { id: 'r1', price: 40, rating: 3, category: 'Casual', date: '2026-05-01', note: null },
  { id: 'r2', price: 160, rating: 5, category: 'Formal', date: '2026-06-10', note: 'x' },
  { id: 'r3', price: 220, rating: 2, category: 'Party', date: '2026-07-04', note: undefined },
  { id: 'r4', price: Number.NaN, rating: 4, category: 'Work', date: '2026-05-20', note: 'y' },
];

describe('clausePredicate ↔ matchesClause parity (the pinned mirror)', () => {
  // every wire shape: cleared point, IS NULL point, value point, cleared
  // interval, numeric closed/half-open intervals, string (ISO date) intervals
  const CASES: { kind: 'point' | 'interval'; field: string; value: unknown }[] = [
    { kind: 'point', field: 'category', value: undefined },
    { kind: 'point', field: 'note', value: null },
    { kind: 'point', field: 'category', value: 'Formal' },
    { kind: 'point', field: 'price', value: 160 },
    { kind: 'interval', field: 'price', value: null },
    { kind: 'interval', field: 'price', value: [50, 200] },
    { kind: 'interval', field: 'price', value: [150, null] },
    { kind: 'interval', field: 'price', value: [null, 100] },
    { kind: 'interval', field: 'date', value: ['2026-05-01', '2026-06-30'] },
    { kind: 'interval', field: 'date', value: ['2026-06-01', null] },
    { kind: 'interval', field: 'date', value: [null, '2026-05-31'] },
    { kind: 'interval', field: 'price', value: ['2026-01-01', '2026-12-31'] }, // string bounds over numeric cells
    { kind: 'interval', field: 'date', value: [0, 100] }, // numeric bounds over string cells
  ];

  it('agrees with the real src/data evaluator on every case × every row', () => {
    for (const c of CASES) {
      const mirrored = clausePredicate(c.kind, c.field, c.value);
      const real = (row: Record<string, unknown>): boolean =>
        matchesClause(row, { kind: c.kind, field: c.field, value: c.value } as PredicateClause);
      for (const row of ROWS) {
        expect(mirrored(row), `${c.kind} ${c.field} ${JSON.stringify(c.value)} on ${row.id}`).toBe(real(row));
      }
    }
  });
});

const SELS: SelectionView[] = [
  { viewId: 'scatter', field: 'price', kind: 'interval', value: [50, 200] },
  { viewId: 'bar', field: 'category', kind: 'point', value: 'Formal' },
];

describe('selectionForView', () => {
  it('builds one addressable clause per source view, keyed by viewId, with a working predicate', () => {
    const sel = selectionForView(SELS, 'scatter');
    expect(sel.selfClauseId).toBe('scatter');
    expect(sel.resolve).toBe('intersect');
    expect([...sel.clauses.keys()]).toEqual(['scatter', 'bar']);
    const bar = sel.clauses.get('bar')!;
    expect(bar.kind).toBe('point');
    expect(bar.field).toBe('category');
    expect(bar.value).toBe('Formal');
    expect(bar.predicate(ROWS[1]!)).toBe(true);
    expect(bar.predicate(ROWS[0]!)).toBe(false);
  });

  it('selfClauseId null = a whole-dashboard fold (nothing to exclude)', () => {
    const sel = selectionForView(SELS, null);
    expect(sel.selfClauseId).toBeNull();
    const keep = keepPredicate(sel);
    // both clauses apply: price in [50,200] AND category Formal → only r2
    expect(ROWS.filter((r) => keep(r)).map((r) => r.id)).toEqual(['r2']);
  });

  it('honors an explicit union resolve', () => {
    const sel = selectionForView(SELS, null, 'union');
    const keep = keepPredicate(sel);
    // price in [50,200] OR category Formal → r2 only? r2 matches both; r1 price 40 no, r3 220 no, r4 NaN no
    expect(ROWS.filter((r) => keep(r)).map((r) => r.id)).toEqual(['r2']);
    // widen: a row matching just ONE side is kept under union
    expect(keep({ price: 100, category: 'Party' })).toBe(true);
    expect(keep({ price: 500, category: 'Formal' })).toBe(true);
    expect(keep({ price: 500, category: 'Party' })).toBe(false);
  });
});

describe('keepPredicate', () => {
  it('excludes the self clause by default (dim under everyone’s brush but my own)', () => {
    const sel = selectionForView(SELS, 'scatter');
    const keep = keepPredicate(sel);
    // only bar's Formal clause applies → r2 kept, r1/r3/r4 dimmed
    expect(ROWS.map((r) => keep(r))).toEqual([false, true, false, false]);
  });

  it('includeSelf folds every clause (the whole-dashboard truth)', () => {
    const sel = selectionForView(SELS, 'scatter');
    const keep = keepPredicate(sel, { includeSelf: true });
    expect(ROWS.filter((r) => keep(r)).map((r) => r.id)).toEqual(['r2']);
  });

  it('an empty selection keeps everything', () => {
    const keep = keepPredicate(emptySelection('scatter'));
    expect(ROWS.every((r) => keep(r))).toBe(true);
  });

  it('a union fold with only the self clause keeps everything once self is excluded', () => {
    const sel = selectionForView([SELS[0]!], 'scatter', 'union');
    expect(ROWS.every((r) => keepPredicate(sel)(r))).toBe(true);
  });
});

describe('selfSelectedValue', () => {
  it('reads the consuming view’s own live point value as a string', () => {
    expect(selfSelectedValue(selectionForView(SELS, 'bar'))).toBe('Formal');
  });
  it('null when the view has no clause, a cleared clause, an interval, or no self at all', () => {
    expect(selfSelectedValue(selectionForView(SELS, 'map'))).toBeNull(); // no clause
    expect(selfSelectedValue(selectionForView(SELS, 'scatter'))).toBeNull(); // interval
    expect(selfSelectedValue(selectionForView(SELS, null))).toBeNull(); // whole-dashboard fold
    const cleared = selectionForView([{ viewId: 'map', field: 'region', kind: 'point', value: undefined }], 'map');
    expect(selfSelectedValue(cleared)).toBeNull(); // cleared point
  });
  it('a numeric point value stringifies (the selected-prop contract)', () => {
    const sel = selectionForView([{ viewId: 'table', field: 'price', kind: 'point', value: 160 }], 'table');
    expect(selfSelectedValue(sel)).toBe('160');
  });
});
