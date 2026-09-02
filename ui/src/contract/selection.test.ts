// @vitest-environment jsdom
/**
 * The clause-addressable selection derivation — including the PARITY PIN:
 * `clausePredicate` must agree with `src/data`'s real `matchesClause` on
 * every point/interval shape the wire can carry (the mirror-instead-of-import
 * contract stated in selection.ts's header).
 */
import { describe, it, expect } from 'vitest';
import { selfSelectedSet } from './selection.js';
import { matchesClause } from '../../../src/data/predicate.js';
import type { PredicateClause } from '../../../src/data/types.js';
import {
  clausePredicate,
  emptySelection,
  keepPredicate,
  selectionForView,
  selfSelectedValue,
  selfSelectedInterval,
  selfSelectedCell,
} from './selection.js';
import type { SelectionView } from '../adapter/types.js';

const ROWS = [
  { id: 'r1', price: 40, rating: 3, category: 'Casual', date: '2026-05-01', note: null },
  { id: 'r2', price: 160, rating: 5, category: 'Formal', date: '2026-06-10', note: 'x' },
  { id: 'r3', price: 220, rating: 2, category: 'Party', date: '2026-07-04', note: undefined },
  { id: 'r4', price: Number.NaN, rating: 4, category: 'Work', date: '2026-05-20', note: 'y' },
];

describe('clausePredicate ↔ matchesClause parity (the pinned mirror)', () => {
  // every wire shape: cleared point, value point, cleared interval, numeric
  // closed/half-open intervals, string (ISO date) intervals. `null` point is
  // NOT here — it is the one pinned DIVERGENCE, tested separately below.
  const CASES: { kind: 'point' | 'interval'; field: string; value: unknown }[] = [
    { kind: 'point', field: 'category', value: undefined },
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

  it('THE pinned divergence: a null point value is CLEARED at the adapter tier (src tier reads IS NULL)', () => {
    // overview() projects a kept-but-cleared point clause as `value ?? null`,
    // and JSON cannot carry undefined — so at this tier null can only mean
    // "cleared". The src evaluator (operating on session-internal values,
    // where undefined survives) reads null as IS NULL instead.
    const mirrored = clausePredicate('point', 'note', null);
    expect(ROWS.map((r) => mirrored(r))).toEqual([true, true, true, true]); // cleared — keeps everything
    expect(ROWS.map((r) => matchesClause(r, { kind: 'point', field: 'note', value: null }))).toEqual([
      true, // note: null — IS NULL matches
      false,
      true, // note: undefined — == null matches
      false,
    ]);
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

describe('selfSelectedInterval (the interval sibling — the histogram’s own-range derivation)', () => {
  it('reads the consuming view’s own live interval value as the [lo, hi] tuple', () => {
    expect(selfSelectedInterval(selectionForView(SELS, 'scatter'))).toEqual([50, 200]);
    const dates = selectionForView(
      [{ viewId: 'line', field: 'date', kind: 'interval', value: ['2026-04-01', '2026-04-09'] }],
      'line',
    );
    expect(selfSelectedInterval(dates)).toEqual(['2026-04-01', '2026-04-09']);
  });
  it('null when the view has no clause, a cleared clause, a point, or no self at all', () => {
    expect(selfSelectedInterval(selectionForView(SELS, 'map'))).toBeNull(); // no clause
    expect(selfSelectedInterval(selectionForView(SELS, 'bar'))).toBeNull(); // point
    expect(selfSelectedInterval(selectionForView(SELS, null))).toBeNull(); // whole-dashboard fold
    const cleared = selectionForView([{ viewId: 'scatter', field: 'price', kind: 'interval', value: null }], 'scatter');
    expect(selfSelectedInterval(cleared)).toBeNull(); // cleared interval
  });
});

describe('D30 — the cell arm of clausePredicate (parity with the real evaluator)', () => {
  const CELL_CASES: { fields: readonly [string, string]; value: unknown }[] = [
    { fields: ['price', 'category'], value: [[50, 200], 'Formal'] }, // interval × point
    { fields: ['price', 'category'], value: [[150, null], 'Party'] }, // half-open side
    { fields: ['date', 'category'], value: [['2026-05-01', '2026-06-30'], 'Casual'] }, // ISO interval side
    { fields: ['category', 'rating'], value: ['Formal', 5] }, // point × point
    { fields: ['price', 'note'], value: [[0, 300], null] }, // null point side = IS NULL
    { fields: ['price', 'rating'], value: [[0, 300], [2, 4]] }, // interval × interval
    { fields: ['price', 'category'], value: null }, // cleared cell
  ];

  it('agrees with src/data matchesClause on every cell case × every row', () => {
    for (const c of CELL_CASES) {
      const real: PredicateClause = {
        kind: 'cell',
        fields: c.fields,
        value: c.value as Extract<PredicateClause, { kind: 'cell' }>['value'],
      };
      const mirror = clausePredicate('cell', `${c.fields[0]} × ${c.fields[1]}`, c.value, c.fields);
      for (const row of ROWS) {
        expect(mirror(row), `cell ${JSON.stringify(c)} on ${row.id}`).toBe(matchesClause(row, real));
      }
    }
  });

  it('a cell wire row that lost its pair keeps ALL rows (honest fallback, never a guessed split)', () => {
    const p = clausePredicate('cell', 'price × category', [[50, 200], 'Formal']); // no fields
    expect(ROWS.every((r) => p(r))).toBe(true);
  });

  it('selectionForView carries the pair through to the addressable clause', () => {
    const sels: SelectionView[] = [
      { viewId: 'heatmap', field: 'price × category', kind: 'cell', value: [[50, 200], 'Formal'], fields: ['price', 'category'] },
    ];
    const sel = selectionForView(sels, 'heatmap');
    const own = sel.clauses.get('heatmap')!;
    expect(own.kind).toBe('cell');
    expect(own.fields).toEqual(['price', 'category']);
    expect(own.predicate(ROWS[1]!)).toBe(true); // Formal @ 160
    expect(own.predicate(ROWS[0]!)).toBe(false); // Casual @ 40 — both sides must hold
  });
});

describe('selfSelectedCell (the cell sibling — the heatmap’s own-cell derivation)', () => {
  const cellSel = (value: unknown, fields?: readonly [string, string]): SelectionView[] => [
    { viewId: 'heatmap', field: 'price × category', kind: 'cell', value, ...(fields ? { fields } : {}) },
  ];

  it('reads the consuming view’s own live cell: field pair + the two sides', () => {
    const sel = selectionForView(cellSel([[100, 150], 'Formal'], ['price', 'category']), 'heatmap');
    expect(selfSelectedCell(sel)).toEqual({ fields: ['price', 'category'], values: [[100, 150], 'Formal'] });
  });

  it('null when the view has no clause, a cleared cell, a non-cell clause, a lost pair, or no self at all', () => {
    expect(selfSelectedCell(selectionForView([], 'heatmap'))).toBeNull();
    expect(selfSelectedCell(selectionForView(cellSel(null, ['price', 'category']), 'heatmap'))).toBeNull();
    expect(
      selfSelectedCell(
        selectionForView([{ viewId: 'heatmap', field: 'price', kind: 'interval', value: [1, 2] }], 'heatmap'),
      ),
    ).toBeNull();
    expect(selfSelectedCell(selectionForView(cellSel([[100, 150], 'Formal']), 'heatmap'))).toBeNull(); // pair lost
    expect(selfSelectedCell(selectionForView(cellSel([[100, 150], 'Formal'], ['price', 'category']), null))).toBeNull();
  });
});

describe('SET-1 — the match arm mirrors matchesClause; selfSelectedSet is the view\'s own set', () => {
  const rows = [{ category: 'A' }, { category: 'B' }, { category: 'C' }];
  const sel = (value: unknown) => selectionForView([{ viewId: 'bar', field: 'category', kind: 'match', value }], null);
  it('keep: in the list; exclude: not in it; an empty keep-list matches nothing; an empty exclude-list keeps all; null is cleared', () => {
    const kept = (value: unknown) => rows.filter(keepPredicate(sel(value))).map((r) => r.category);
    expect(kept({ values: ['A', 'C'] })).toEqual(['A', 'C']);
    expect(kept({ values: ['A', 'C'], exclude: true })).toEqual(['B']);
    expect(kept({ values: [] })).toEqual([]);
    expect(kept({ values: [], exclude: true })).toEqual(['A', 'B', 'C']);
    expect(kept(null)).toEqual(['A', 'B', 'C']);
  });
  it('selfSelectedSet: a point is a one-value keep-set; a match is its list and polarity; an interval, a cell, a cleared clause or no clause is the empty keep-set', () => {
    const point = selectionForView([{ viewId: 'bar', field: 'category', kind: 'point', value: 'A' }], 'bar');
    expect(selfSelectedSet(point)).toEqual({ values: ['A'], exclude: false });
    const match = selectionForView([{ viewId: 'bar', field: 'category', kind: 'match', value: { values: ['A', 7], exclude: true } }], 'bar');
    expect(selfSelectedSet(match)).toEqual({ values: ['A', '7'], exclude: true });
    const interval = selectionForView([{ viewId: 'bar', field: 'price', kind: 'interval', value: [1, 2] }], 'bar');
    expect(selfSelectedSet(interval)).toEqual({ values: [], exclude: false });
    const cleared = selectionForView([{ viewId: 'bar', field: 'category', kind: 'match', value: null }], 'bar');
    expect(selfSelectedSet(cleared)).toEqual({ values: [], exclude: false });
    expect(selfSelectedSet(selectionForView([], 'bar'))).toEqual({ values: [], exclude: false });
    expect(selfSelectedSet(selectionForView([{ viewId: 'bar', field: 'category', kind: 'point', value: 'A' }], null))).toEqual({ values: [], exclude: false });
  });
});
