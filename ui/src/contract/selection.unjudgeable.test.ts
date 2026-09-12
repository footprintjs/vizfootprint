// @vitest-environment jsdom
/**
 * A CLAUSE A ROW CANNOT ANSWER DOES NOT DROP IT (the missing-column law,
 * `selection.ts` · `judgeable`).
 *
 * A clause is a sentence about a column. A row that does not CARRY that column
 * cannot answer it, so the clause says nothing about the row and keeps it —
 * for every kind and every polarity. Before this law a missing column DROPPED
 * the row for a point, an interval, an including match, a cell and a
 * neighbourhood, but KEPT it for an IS-NULL point (`undefined == null`) and an
 * excluding match (`!hit`): one missing column, six kinds, two answers. The
 * last block below is the one that asserts the six now agree.
 *
 * THE EVIDENCE IS THE KEY, NOT THE VALUE — so every kind gets two rows here:
 * one LACKING the column (kept, whatever the clause) and one CARRYING it as
 * `null` (judged exactly as before — an IS-NULL point matches it, everything
 * else refuses it, a walk keeps no null endpoint). `selection.test.ts`'s
 * delegation check is the proof that a row carrying a real value is unchanged;
 * this file does not repeat it.
 */
import { describe, it, expect } from 'vitest';
import { brightPredicate, clausePredicate, keepPredicate, selectionForView, selfSelectedSet } from './selection.js';
import type { LinkGraphView, SelectionView } from '../adapter/types.js';

/** A row LACKING the column every clause below names — it can answer none of them. */
const LACKS = { id: 'lacks', other: 1 } as const;
/** A row CARRYING each named column as `null` — judgeable, and the value is null. */
const HOLDS_NULL = { id: 'null', radii: null, category: null, source: null, target: null } as const;
/** A row carrying real values, the control. */
const HOLDS = { id: 'holds', radii: 4.5, category: 'Formal', source: 'flu', target: 'cold' } as const;

const WALK = { seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] };

describe('the missing-column law, kind by kind — the key is the evidence, never the value', () => {
  it('point: a row lacking the column is kept; one holding null is refused by a value point as before', () => {
    const p = clausePredicate('point', 'category', 'Formal');
    expect(p(LACKS)).toBe(true);
    expect(p(HOLDS_NULL)).toBe(false);
    expect(p(HOLDS)).toBe(true);
  });

  it('point with null (IS NULL): a row lacking the column is kept BY THE LAW, one holding null is kept BY THE TEST — and a real value is refused', () => {
    // On the wire a null point is CLEARED (one spelling, every kind — `selection.test.ts`), so the
    // IS-NULL point reaches the compiler only as a cell SIDE (`cellSideClause`). The x side here is
    // an interval every row below satisfies, so what is under test is the y side alone.
    const p = clausePredicate('cell', 'radii × category', [[0, 100], null], ['radii', 'category']);
    // the two used to be one accident (`undefined == null`); they are now two reasons with one answer
    expect(p({ radii: 2 })).toBe(true); // lacks `category` — the law
    expect(p({ radii: 2, category: null })).toBe(true); // holds null — the test (IS NULL)
    expect(p({ radii: 2, category: 'Formal' })).toBe(false); // holds a value — refused
  });

  it('interval: a row lacking the column is kept; one holding null is refused (no number to place) as before', () => {
    const p = clausePredicate('interval', 'radii', [1, 5]);
    expect(p(LACKS)).toBe(true);
    expect(p(HOLDS_NULL)).toBe(false);
    expect(p(HOLDS)).toBe(true);
    // a half-open bound and a string bound answer the same way on a missing key
    expect(clausePredicate('interval', 'radii', [null, 5])(LACKS)).toBe(true);
    expect(clausePredicate('interval', 'radii', ['2026-01-01', null])(LACKS)).toBe(true);
  });

  it('match (including): a row lacking the column is kept; one holding null is not in the list, refused as before', () => {
    const p = clausePredicate('match', 'category', { values: ['Formal', 'Party'] });
    expect(p(LACKS)).toBe(true);
    expect(p(HOLDS_NULL)).toBe(false);
    expect(p(HOLDS)).toBe(true);
  });

  it('match (excluding): a row lacking the column is kept BY THE LAW, not by `!hit`; one holding null is kept as before (not in the list); a listed value is refused', () => {
    const p = clausePredicate('match', 'category', { values: ['Formal'], exclude: true });
    expect(p(LACKS)).toBe(true);
    expect(p(HOLDS_NULL)).toBe(true);
    expect(p(HOLDS)).toBe(false);
    // the guard sits OUTSIDE the polarity: an empty keep-list still matches nothing on a row that HAS the column…
    expect(clausePredicate('match', 'category', { values: [] })(HOLDS)).toBe(false);
    // …and still keeps a row that has not got it
    expect(clausePredicate('match', 'category', { values: [] })(LACKS)).toBe(true);
  });

  it('cell: each side carries its own guard — a row lacking ONE column is judged on the other; lacking both is kept', () => {
    const p = clausePredicate('cell', 'radii × category', [[1, 5], 'Formal'], ['radii', 'category']);
    expect(p(LACKS)).toBe(true);
    expect(p(HOLDS)).toBe(true);
    // x missing, y present and wrong → the y side refuses it
    expect(p({ category: 'Party' })).toBe(false);
    // x missing, y present and right → the x side says nothing, the y side keeps it
    expect(p({ category: 'Formal' })).toBe(true);
    // y missing, x present and out of range → the x side refuses it
    expect(p({ radii: 9 })).toBe(false);
    // both present, one null → judged, refused (a null radius is not in [1, 5])
    expect(p(HOLDS_NULL)).toBe(false);
  });

  it('neighbourhood: a row missing EITHER endpoint column is kept; a null endpoint in a column the row HAS is kept by no walk, as before', () => {
    const p = clausePredicate('neighbourhood', 'source ↔ target', WALK, ['source', 'target']);
    expect(p(LACKS)).toBe(true);
    expect(p({ source: 'flu' })).toBe(true); // target column missing — cannot be shown outside the subgraph
    expect(p({ target: 'cold' })).toBe(true); // source column missing
    expect(p(HOLDS_NULL)).toBe(false); // both columns present, both null: IN (NULL) is never true
    expect(p({ source: 'flu', target: null })).toBe(false);
    expect(p(HOLDS)).toBe(true);
    expect(p({ source: 'flu', target: 'strep' })).toBe(false);
  });
});

describe('the demo\'s exact shape — an interval on `radii` over rows that have not got it', () => {
  const sels: SelectionView[] = [{ viewId: 'radius', field: 'radii', kind: 'interval', value: [1, 5] }];

  it('folded over rows lacking `radii`, the selection keeps ALL of them (it used to keep 0 of 2 and blank the chart)', () => {
    const years = [{ year: 2001, count: 3 }, { year: 2002, count: 7 }];
    const keep = keepPredicate(selectionForView(sels, 'year'));
    expect(years.filter(keep)).toEqual(years);
  });

  it('and the same interval over rows that have `radii` keeps exactly the right ones', () => {
    const planets = [{ name: 'a', radii: 0.5 }, { name: 'b', radii: 2 }, { name: 'c', radii: 4.9 }, { name: 'd', radii: 12 }, { name: 'e', radii: null }];
    const keep = keepPredicate(selectionForView(sels, 'scatter'));
    expect(planets.filter(keep).map((p) => p.name)).toEqual(['b', 'c']);
  });
});

describe('the consumers of the compiled predicate', () => {
  const rows = [{ category: 'A', region: 'North' }, { category: 'B', region: 'South' }, { category: 'C' }];
  const sels: SelectionView[] = [
    { viewId: 'bar', field: 'category', kind: 'point', value: 'A' },
    { viewId: 'map', field: 'region', kind: 'point', value: 'North' },
  ];
  const graph = (response: 'filter' | 'highlight' | 'mirror'): LinkGraphView => ({
    default: 'none',
    views: [{ viewId: 'bar', voice: ['point'] }, { viewId: 'map', voice: ['point'] }, { viewId: 'table', voice: ['point'] }],
    edges: [
      { id: 'bar:point→table', source: 'bar', kind: 'point', target: 'table', response: 'filter', origin: 'declared' },
      { id: 'map:point→table', source: 'map', kind: 'point', target: 'table', response, origin: 'declared' },
    ],
  });

  it('keepPredicate folds the law: the row without `region` survives the map\'s filter and is judged by the bar\'s', () => {
    const keep = keepPredicate(selectionForView(sels, 'table', 'intersect', graph('filter')));
    // row C has no region (kept by the map's clause) but its category is C (dropped by the bar's)
    expect(rows.filter(keep)).toEqual([{ category: 'A', region: 'North' }]);
    const onlyMap = keepPredicate(selectionForView([sels[1]!], 'table', 'intersect', graph('filter')));
    expect(rows.filter(onlyMap)).toEqual([{ category: 'A', region: 'North' }, { category: 'C' }]);
  });

  it('brightPredicate (the highlight response) is the SAME compiled predicate, so it gets the law with no second spelling — pinned', () => {
    const sel = selectionForView([sels[1]!], 'table', 'intersect', graph('highlight'));
    const bright = brightPredicate(sel);
    expect(rows.map(bright)).toEqual([true, false, true]); // North bright, South dim, no-region column: bright (not dimmed on ignorance)
    // and it is literally the clause's own predicate, not a re-derivation
    expect(sel.clauses.get('map')!.predicate({ category: 'C' })).toBe(true);
    expect(keepPredicate(sel)({ category: 'C' })).toBe(true); // a highlight never narrows — untouched
  });

  it('mirror never tests a row — it lifts the value list — so it came out untouched: the same set with or without the column on any row', () => {
    const sel = selectionForView([sels[1]!], 'table', 'intersect', graph('mirror'));
    expect(selfSelectedSet(sel)).toEqual({ values: ['North'], exclude: false });
    // the mirror path reads `clause.value`; no row was ever handed to it, so no row's columns can change it
    expect(keepPredicate(sel)({ category: 'C' })).toBe(true);
    expect(keepPredicate(sel)({ category: 'C', region: 'South' })).toBe(true); // a mirror does not filter at all
  });
});

describe('the six kinds now agree with each other on a missing column — the inconsistency this closes', () => {
  it('every kind, every polarity, keeps a row that has not got the column', () => {
    const six = [
      clausePredicate('point', 'category', 'Formal'),
      clausePredicate('cell', 'radii × category', [[0, 100], null], ['radii', 'category']), // the IS-NULL point, as a cell side
      clausePredicate('interval', 'radii', [1, 5]),
      clausePredicate('match', 'category', { values: ['Formal'] }),
      clausePredicate('match', 'category', { values: ['Formal'], exclude: true }),
      clausePredicate('cell', 'radii × category', [[1, 5], 'Formal'], ['radii', 'category']),
      clausePredicate('neighbourhood', 'source ↔ target', WALK, ['source', 'target']),
    ];
    const answers = six.map((p) => p(LACKS));
    expect(answers).toEqual(answers.map(() => true));
    expect(new Set(answers).size).toBe(1);
  });
});

describe('protocol 1.7 — `narrowed` is the CONSUMER\'s own entry of the session\'s `narrowedFor`, picked at the fold, or no key at all', () => {
  const reason = (table: string) => `table "${table}" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows`;
  // the session's word: the brush filtered nothing on `year` (a view) and on `net~edges` (a layer address) — and was judged on `scatter`
  const narrowedFor = { year: { column: 'radii', reason: reason('years'), label: 'Years' }, 'net~edges': { column: 'radii', reason: reason('edges') } };
  const sels: SelectionView[] = [
    { viewId: 'radius', field: 'radii', kind: 'interval', value: [1, 5], narrowedFor },
    { viewId: 'bar', field: 'category', kind: 'point', value: 'A' },
  ];

  it('the consuming view picks ITS entry — `{ column, reason }` only, the label stays on the adapter side (the contract\'s shape is unchanged)', () => {
    const sel = selectionForView(sels, 'year');
    expect(sel.clauses.get('radius')?.narrowed).toEqual({ column: 'radii', reason: reason('years') });
    expect('label' in sel.clauses.get('radius')!.narrowed!).toBe(false);
    // a clause the session said nothing about has NO key (not `undefined`)
    expect('narrowed' in sel.clauses.get('bar')!).toBe(false);
    // and the predicate beside it keeps the row that lacks the column — the fact and the behaviour agree
    expect(sel.clauses.get('radius')!.predicate({ year: 2001 })).toBe(true);
  });

  it('a layer address is a key like any other', () => {
    expect(selectionForView(sels, 'net~edges').clauses.get('radius')?.narrowed).toEqual({ column: 'radii', reason: reason('edges') });
  });

  it('a DIFFERENT consumer gets none: the same brush was judged on the scatter, so its clause view carries no key there', () => {
    const sel = selectionForView(sels, 'scatter');
    expect('narrowed' in sel.clauses.get('radius')!).toBe(false);
    expect(sel.clauses.get('radius')!.predicate({ radii: 2 })).toBe(true); // judged as ever
  });

  it('the whole-dashboard fold (`selfViewId === null`) names no consumer and carries none', () => {
    const sel = selectionForView(sels, null);
    expect('narrowed' in sel.clauses.get('radius')!).toBe(false);
  });

  it('the `leave` branch: a cleared source an edge keeps in force picks its consumer\'s entry the same way', () => {
    const links: LinkGraphView = {
      default: 'none',
      views: [{ viewId: 'radius', voice: ['interval'] }, { viewId: 'year', voice: [] }, { viewId: 'scatter', voice: [] }],
      edges: [
        { id: 'radius:interval→year', source: 'radius', kind: 'interval', target: 'year', response: 'filter', origin: 'declared', onClear: 'leave' },
        { id: 'radius:interval→scatter', source: 'radius', kind: 'interval', target: 'scatter', response: 'filter', origin: 'declared', onClear: 'leave' },
      ],
    };
    const cleared = [{ viewId: 'radius', field: 'radii', kind: 'interval' as const, value: [1, 5], clearedBy: 's2', narrowedFor }];
    const onYear = selectionForView([], 'year', 'intersect', links, cleared);
    expect(onYear.clauses.get('radius')?.narrowed).toEqual({ column: 'radii', reason: reason('years') });
    const onScatter = selectionForView([], 'scatter', 'intersect', links, cleared);
    expect(onScatter.clauses.has('radius')).toBe(true); // remembered there too…
    expect('narrowed' in onScatter.clauses.get('radius')!).toBe(false); // …and judged there
  });
});
