/**
 * `clauseFromWire` — the ONE reading of a commit's `{kind, field, value}`
 * triple as a `PredicateClause`.
 *
 * The law under test is the one the file header states: the function is TOTAL
 * (every input answers, nothing throws) and CLEARED is its only fallback — a
 * value the wire's declared shape does not cover keeps every row rather than
 * narrowing on a value nobody can interpret.
 *
 * The evaluated half is pinned beside it: for every triple, the clause this
 * returns must select exactly the rows the wire triple means. That is what a
 * consumer buys by calling this instead of writing the rules again.
 */
import { describe, it, expect } from 'vitest';
import { cellSideClause, clauseFromWire } from './clauseFromWire.js';
import { matchesClause } from './predicate.js';
import type { Row } from './types.js';

const ROWS: Row[] = [
  { id: 'r1', price: 40, rating: 3, category: 'Casual', date: '2026-05-01', note: null },
  { id: 'r2', price: 160, rating: 5, category: 'Formal', date: '2026-06-10', note: 'x' },
  { id: 'r3', price: 220, rating: 2, category: 'Party', date: '2026-07-04', note: undefined },
  { id: 'r4', price: Number.NaN, rating: 4, category: 'Work', date: '2026-05-20', note: 'y' },
];

/** Which rows a wire triple selects, read through the translation. */
const kept = (kind: Parameters<typeof clauseFromWire>[0], field: string, value: unknown, fields?: readonly [string, string]): string[] =>
  ROWS.filter((r) => matchesClause(r, clauseFromWire(kind, field, value, fields))).map((r) => String(r['id']));

const ALL = ['r1', 'r2', 'r3', 'r4'];

describe('point — the three-way split is the clause\'s own', () => {
  it('undefined is cleared, null is IS NULL, anything else is strict equality', () => {
    expect(clauseFromWire('point', 'category', undefined)).toEqual({ kind: 'point', field: 'category', value: undefined });
    expect(kept('point', 'category', undefined)).toEqual(ALL); // cleared
    expect(kept('point', 'note', null)).toEqual(['r1', 'r3']); // null AND undefined — SQL NULL knows no difference
    expect(kept('point', 'category', 'Formal')).toEqual(['r2']);
    expect(kept('point', 'price', 160)).toEqual(['r2']);
    expect(kept('point', 'price', '160')).toEqual([]); // strict — no SQL-style coercion
  });
});

describe('interval — a pair is the bounds verbatim', () => {
  it('null clears; a closed, half-open or ISO-string pair carries through', () => {
    expect(clauseFromWire('interval', 'price', null)).toEqual({ kind: 'interval', field: 'price', value: null });
    expect(kept('interval', 'price', null)).toEqual(ALL);
    expect(kept('interval', 'price', [50, 200])).toEqual(['r2']);
    expect(kept('interval', 'price', [150, null])).toEqual(['r2', 'r3']); // half-open, only the present side tested
    expect(kept('interval', 'price', [null, 100])).toEqual(['r1']);
    expect(kept('interval', 'date', ['2026-05-01', '2026-06-30'])).toEqual(['r1', 'r2', 'r4']);
    expect(kept('interval', 'price', ['2026-01-01', '2026-12-31'])).toEqual([]); // string bounds never match numeric cells
  });

  it('a value that is not a two-element pair is CLEARED, never a narrowing on bounds nobody can read', () => {
    for (const bad of [5, 'ohno', [10], [1, 2, 3], {}, true]) {
      expect(clauseFromWire('interval', 'price', bad), JSON.stringify(bad)).toEqual({ kind: 'interval', field: 'price', value: null });
      expect(kept('interval', 'price', bad), JSON.stringify(bad)).toEqual(ALL);
    }
  });
});

describe('match — the list and its polarity ride INSIDE the value', () => {
  it('the body becomes sibling values/exclude; the polarity survives', () => {
    expect(clauseFromWire('match', 'category', { values: ['Formal', 'Party'] })).toEqual({ kind: 'match', field: 'category', values: ['Formal', 'Party'] });
    expect(kept('match', 'category', { values: ['Formal', 'Party'] })).toEqual(['r2', 'r3']);
    expect(clauseFromWire('match', 'category', { values: ['Formal'], exclude: true })).toEqual({ kind: 'match', field: 'category', values: ['Formal'], exclude: true });
    expect(kept('match', 'category', { values: ['Formal'], exclude: true })).toEqual(['r1', 'r3', 'r4']);
    expect(kept('match', 'category', { values: ['Formal'], exclude: false })).toEqual(['r2']); // only `true` flips it
    expect(kept('match', 'category', { values: [] })).toEqual([]); // an empty keep-list is a real FALSE
    expect(kept('match', 'category', { values: [], exclude: true })).toEqual(ALL); // an empty exclude-list excludes nothing
  });

  it('a null body, a body that is not an object, and a body with no list are all CLEARED', () => {
    for (const bad of [null, undefined, 'Formal', 7, { exclude: true }, { values: 'Formal' }]) {
      expect(clauseFromWire('match', 'category', bad), JSON.stringify(bad)).toBeNull();
      expect(kept('match', 'category', bad), JSON.stringify(bad)).toEqual(ALL);
    }
  });
});

describe('cell — the pair rides `fields`, and `field` is only a label', () => {
  const FIELDS = ['price', 'category'] as const;

  it('both sides must hold; a side is an interval when it is an array and a point otherwise', () => {
    expect(kept('cell', 'price × category', [[50, 200], 'Formal'], FIELDS)).toEqual(['r2']);
    expect(kept('cell', 'price × category', [[50, 200], 'Casual'], FIELDS)).toEqual([]); // the price side holds, the category side does not
    expect(kept('cell', 'price × note', [[0, 300], null], ['price', 'note'])).toEqual(['r1', 'r3']); // a null side is IS NULL — null AND undefined
    expect(kept('cell', 'price × rating', [[0, 300], [2, 4]], ['price', 'rating'])).toEqual(['r1', 'r3']);
  });

  it('a null pair is the whole cell cleared', () => {
    expect(clauseFromWire('cell', 'price × category', null, FIELDS)).toEqual({ kind: 'cell', fields: FIELDS, value: null });
    expect(kept('cell', 'price × category', null, FIELDS)).toEqual(ALL);
  });

  it('WITHOUT the pair there is no cell — the label is never split back into columns', () => {
    expect(clauseFromWire('cell', 'price × category', [[50, 200], 'Formal'])).toBeNull();
    expect(kept('cell', 'price × category', [[50, 200], 'Formal'])).toEqual(ALL);
  });

  it('a value that is not a two-element pair is CLEARED', () => {
    for (const bad of ['Formal', 5, [[50, 200]], {}]) {
      expect(clauseFromWire('cell', 'price × category', bad, FIELDS), JSON.stringify(bad)).toEqual({ kind: 'cell', fields: FIELDS, value: null });
    }
  });
});

describe('cellSideClause — the other half of the translation, exported for a consumer that compiles the sides apart', () => {
  it('an array side is an interval; anything else is a point', () => {
    expect(cellSideClause('price', [50, 200])).toEqual({ kind: 'interval', field: 'price', value: [50, 200] });
    expect(cellSideClause('price', [150, null])).toEqual({ kind: 'interval', field: 'price', value: [150, null] });
    expect(cellSideClause('category', 'Formal')).toEqual({ kind: 'point', field: 'category', value: 'Formal' });
    expect(cellSideClause('note', null)).toEqual({ kind: 'point', field: 'note', value: null });
    expect(cellSideClause('rating', 5)).toEqual({ kind: 'point', field: 'rating', value: 5 });
  });

  it('is the SAME lift the cell evaluator uses — the sides apart equal the cell whole', () => {
    const whole = clauseFromWire('cell', 'price × category', [[50, 200], 'Formal'], ['price', 'category']);
    for (const row of ROWS) {
      const apart = matchesClause(row, cellSideClause('price', [50, 200])) && matchesClause(row, cellSideClause('category', 'Formal'));
      expect(matchesClause(row, whole), String(row['id'])).toBe(apart);
    }
  });
});

describe('TOTAL — nothing in the wire\'s slots can make it throw', () => {
  it('every kind × a hostile value answers with a clause or an honest null', () => {
    const hostile = [undefined, null, 0, '', 'x', true, [], [1], [1, 2], {}, { values: null }, Symbol.iterator];
    for (const kind of ['point', 'interval', 'match', 'cell'] as const) {
      for (const value of hostile) {
        expect(() => clauseFromWire(kind, 'price', value, ['price', 'category'])).not.toThrow();
        const clause = clauseFromWire(kind, 'price', value, ['price', 'category']);
        for (const row of ROWS) expect(() => matchesClause(row, clause)).not.toThrow();
      }
    }
  });
});
