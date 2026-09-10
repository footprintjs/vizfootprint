/**
 * THE GROUP, one law at a time.
 *
 * The two columns an Excel or Tableau user writes most — a share of a total and
 * a deviation from a group's average — are the reason this exists, so they are
 * the first two tests. Everything after them is an honesty rule that a wrong
 * answer would look right without: which rows a group is made of, which rows a
 * reducer counted, and what an empty tally comes to.
 */

import { describe, expect, it } from 'vitest';
import { groupRowsOf, reducersOf, rowsOver, valuesOf } from './groups.js';
import { evaluate } from './walk.js';
import { silenceOfDecl, type TableSilence } from '../data/silence.js';
import type { Cell, DerivedColumnDecl, Expr, OpExpr } from './types.js';
import type { Row } from '../data/types.js';

const col = (name: string): Expr => ({ col: name });
const lit = (value: number | string | boolean | null): Expr => ({ lit: value });
const op = (name: OpExpr['op'], ...args: Expr[]): OpExpr => ({ op: name, args });

/** The demo's own shape: state rows AND a region roll-up, in one table. */
const CELLS: readonly Row[] = [
  { jurisdiction: 'Texas', kind: 'state', disease: 'Pertussis', cases: 10, report_state: 'present' },
  { jurisdiction: 'Ohio', kind: 'state', disease: 'Pertussis', cases: 30, report_state: 'present' },
  { jurisdiction: 'Midwest', kind: 'region', disease: 'Pertussis', cases: 40, report_state: 'present' },
  { jurisdiction: 'Texas', kind: 'state', disease: 'Measles', cases: 5, report_state: 'present' },
  { jurisdiction: 'Ohio', kind: 'state', disease: 'Measles', cases: null, report_state: 'unavailable' },
];

const column = (expr: Expr, over: DerivedColumnDecl['over'], kind: DerivedColumnDecl['kind'] = 'row'): DerivedColumnDecl => ({ ops: 1, kind, expr, over });
const over = (rows: readonly Row[], declared: DerivedColumnDecl, silence?: TableSilence): Cell[] => valuesOf(declared, rowsOver(rows, silence));

const ONLY_STATES: Expr = op('eq', col('kind'), lit('state'));

describe('the two columns this exists for', () => {
  it('a SHARE OF TOTAL: each row over its own group’s total, broadcast back', () => {
    const share = column(op('div', col('cases'), op('sum', col('cases'))), { groupBy: ['disease'], where: ONLY_STATES });
    // Pertussis states total 40; Measles states total 5. The REGION row still
    // gets its disease's answer — `where` picks what was counted, not who gets a value.
    expect(over(CELLS, share)).toEqual([10 / 40, 30 / 40, 40 / 40, 5 / 5, null]);
  });

  it('a DEVIATION FROM THE GROUP MEAN, over the whole table when the group is empty', () => {
    const deviation = column(op('sub', col('cases'), op('mean', col('cases'))), { groupBy: [], where: ONLY_STATES });
    // the three counted state cells are 10, 30 and 5 — mean 15
    expect(over(CELLS, deviation)).toEqual([-5, 15, 25, -10, null]);
  });
});

describe('which rows a group is made of', () => {
  it('an AGGREGATE is the same on every row of its group', () => {
    const total = column(op('sum', col('cases')), { groupBy: ['disease'], where: ONLY_STATES }, 'aggregate');
    // the last row is a state cell the source left silent: `where` kept it OUT of
    // the fold's arithmetic and its group still answers for it — which is the
    // whole difference between the rows counted and the rows answered.
    expect(over(CELLS, total)).toEqual([40, 40, 40, 5, 5]);
  });

  it('groups by SEVERAL columns, and two groups never collide because a separator fell somewhere', () => {
    const rows: readonly Row[] = [
      { a: 'x', b: 'y:z', n: 1 },
      { a: 'x:y', b: 'z', n: 2 },
    ];
    expect(over(rows, column(op('sum', col('n')), { groupBy: ['a', 'b'] }, 'aggregate'))).toEqual([1, 2]);
  });

  it('a row whose group key has an ABSENCE is in no group: its answer is absent, and it is folded into nothing', () => {
    const rows: readonly Row[] = [
      { g: 'a', n: 1 },
      { g: null, n: 100 },
      { g: 'a', n: 2 },
    ];
    expect(over(rows, column(op('sum', col('n')), { groupBy: ['g'] }, 'aggregate'))).toEqual([3, null, 3]);
  });

  it('the declared absence law reaches the group: a row the table does not call present is in no group', () => {
    const absence: TableSilence = silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable'] });
    const total = column(op('sum', col('cases')), { groupBy: ['disease'] }, 'aggregate');
    // the `unavailable` Measles row is in no group AND adds nothing to one
    expect(over(CELLS, total, absence)).toEqual([80, 80, 80, 5, null]);
  });
});

describe('which rows a reducer counted', () => {
  it('SUMIF is sum(if(...)) and the skipped rows add NOTHING — never a zero', () => {
    const sumif = column(op('sum', op('if', ONLY_STATES, col('cases'), lit(null))), { groupBy: ['disease'] }, 'aggregate');
    expect(over(CELLS, sumif)).toEqual([40, 40, 40, 5, 5]);
  });

  it('a reducer skips a value that is not the kind its position wanted', () => {
    const rows: readonly Row[] = [{ g: 'a', n: 1 }, { g: 'a', n: 'twelve' }, { g: 'a', n: 3 }];
    expect(over(rows, column(op('sum', col('n')), { groupBy: ['g'] }, 'aggregate'))).toEqual([4, 4, 4]);
  });

  it('`where` that is absent on a row leaves that row out — an unknown answer is not a yes', () => {
    const rows: readonly Row[] = [
      { g: 'a', n: 1, keep: true },
      { g: 'a', n: 2, keep: null },
      { g: 'a', n: 4, keep: false },
    ];
    expect(over(rows, column(op('sum', col('n')), { groupBy: ['g'], where: col('keep') }, 'aggregate'))).toEqual([1, 1, 1]);
  });
});

describe('what an empty tally comes to', () => {
  const nothing = { groupBy: ['g'], where: lit(false) } as const;
  const answer = (name: OpExpr['op']): Cell => over([{ g: 'a', n: 1 }], column(op(name, col('n')), nothing, 'aggregate'))[0]!;

  it('counting nothing is honestly NONE', () => {
    expect(answer('count')).toBe(0);
    expect(answer('countDistinct')).toBe(0);
  });

  it('the total, the average and the extremes of nothing are ABSENT — a silence is not a zero', () => {
    expect(answer('sum')).toBe(null);
    expect(answer('mean')).toBe(null);
    expect(answer('min')).toBe(null);
    expect(answer('max')).toBe(null);
  });
});

describe('the six reducers, at their pinned answers', () => {
  const ROWS: readonly Row[] = [
    { g: 'a', n: 3, t: 'pear', d: '2026-01-04' },
    { g: 'a', n: null, t: 'apple', d: '2026-03-01' },
    { g: 'a', n: 1, t: 'pear', d: '2026-02-01' },
  ];
  const first = (expr: Expr): Cell => over(ROWS, column(expr, { groupBy: ['g'] }, 'aggregate'))[0]!;

  it('counts, totals and averages the PRESENT values only', () => {
    expect(first(op('count', col('n')))).toBe(2);
    expect(first(op('sum', col('n')))).toBe(4);
    expect(first(op('mean', col('n')))).toBe(2);
  });

  it('takes the smallest and the largest by the ONE order the grammar has — numbers, text and ISO dates alike', () => {
    expect(first(op('min', col('n')))).toBe(1);
    expect(first(op('max', col('n')))).toBe(3);
    expect(first(op('min', col('t')))).toBe('apple');
    expect(first(op('max', col('t')))).toBe('pear');
    expect(first(op('min', col('d')))).toBe('2026-01-04');
    expect(first(op('max', col('d')))).toBe('2026-03-01');
  });

  it('counts DISTINCT values, by value', () => {
    expect(first(op('countDistinct', col('t')))).toBe(2);
    expect(first(op('countDistinct', col('n')))).toBe(2);
  });
});

describe('the tree the fold reads', () => {
  it('finds every reducer node in first-seen order, and looks inside the arms a walk might skip', () => {
    const expr = op('add', op('sum', col('n')), op('if', col('flag'), op('max', col('n')), op('min', col('n'))));
    expect(reducersOf(expr).map((node) => node.op)).toEqual(['sum', 'max', 'min']);
  });

  it('finds none in a tree that has none — and a leaf is not a tree to walk into', () => {
    expect(reducersOf(op('add', col('n'), lit(1)))).toEqual([]);
    expect(reducersOf(col('n'))).toEqual([]);
    expect(reducersOf(lit(2))).toEqual([]);
  });

  it('answers ONE reducer node once, however many times a walk reaches it', () => {
    const total = op('sum', col('n'));
    const twice = column(op('add', op('div', col('n'), total), op('div', lit(1), total)), { groupBy: ['g'] });
    expect(over([{ g: 'a', n: 2 }, { g: 'a', n: 2 }], twice)).toEqual([2 / 4 + 1 / 4, 2 / 4 + 1 / 4]);
  });
});

describe('the door', () => {
  it('a declaration with no group is one plain walk, and needs no group to be given', () => {
    const rate = column(op('mul', col('n'), lit(2)), undefined);
    expect(over([{ n: 1 }, { n: 2 }], rate)).toEqual([2, 4]);
  });

  it('a reducer walked with NO group under it is absent, rather than a number nobody could account for', () => {
    expect(evaluate(op('sum', col('n')), (name) => ({ n: 5 })[name])).toBe(null);
  });

  it('an empty table is an empty column — no group, no answer, nothing invented', () => {
    expect(over([], column(op('sum', col('n')), { groupBy: ['g'] }, 'aggregate'))).toEqual([]);
  });
});

describe('min and max over a group that held two KINDS', () => {
  // A number column with one "N/A" row is the ordinary case, not a hostile one. The row walk makes a
  // row's ordered arguments one kind; a group is held to the same law, or its answer would be
  // whichever kind arrived first.
  const MIXED: readonly Row[] = [{ n: 'N/A' }, { n: 5 }, { n: 3 }];
  const least = column(op('min', col('n')), { groupBy: [] }, 'aggregate');
  const most = column(op('max', col('n')), { groupBy: [] }, 'aggregate');

  it('are absent in either row order — a group nobody can put in one order has no smallest', () => {
    expect(over(MIXED, least)).toEqual([null, null, null]);
    expect(over([...MIXED].reverse(), least)).toEqual([null, null, null]);
    expect(over(MIXED, most)).toEqual([null, null, null]);
    expect(over([...MIXED].reverse(), most)).toEqual([null, null, null]);
  });

  it('while a group of one kind still answers, and `sum` still skips what it cannot read', () => {
    expect(over([{ n: 5 }, { n: 3 }], least)).toEqual([3, 3]);
    expect(over([{ n: 5 }, { n: 3 }], most)).toEqual([5, 5]);
    expect(over(MIXED, column(op('sum', col('n')), { groupBy: [] }, 'aggregate'))).toEqual([8, 8, 8]);
  });
});

describe('one row per group — pass one, stopping before the broadcast', () => {
  const rows = (exprs: readonly Expr[], over: { groupBy: readonly string[]; where?: Expr }, silence?: TableSilence): { key: readonly Cell[]; values: readonly Cell[] }[] =>
    groupRowsOf(exprs, over, rowsOver(CELLS, silence));

  it('answers the groups in first-seen order, each with its key and what every tree came to', () => {
    expect(rows([op('sum', col('cases')), op('count', col('cases'))], { groupBy: ['disease'], where: ONLY_STATES })).toEqual([
      { key: ['Pertussis'], values: [40, 2] },
      { key: ['Measles'], values: [5, 1] },
    ]);
  });

  it('a group none of whose rows folded in is not a row — `where` says which rows go in, and a table’s rows ARE the groups', () => {
    expect(rows([op('sum', col('cases'))], { groupBy: ['kind'], where: op('eq', col('disease'), lit('Measles')) })).toEqual([{ key: ['state'], values: [5] }]);
    expect(rows([op('sum', col('cases'))], { groupBy: ['kind'], where: lit(false) })).toEqual([]);
  });

  it('the whole table is one row with an empty key', () => {
    expect(rows([op('mean', col('cases'))], { groupBy: [] })).toEqual([{ key: [], values: [85 / 4] }]);
  });

  it('a row whose group key is absent is in no group — and the absence law reaches the key through the reader', () => {
    const absence: TableSilence = silenceOfDecl({ field: 'report_state', states: ['present', 'unavailable'] });
    expect(rows([op('count', col('jurisdiction'))], { groupBy: ['disease'] }, absence)).toEqual([
      { key: ['Pertussis'], values: [3] },
      { key: ['Measles'], values: [1] },
    ]);
  });

  it('a grouping column read outside a reducer answers from the key; any other column is absent, so the fold stays total over a tree the judge never saw', () => {
    const label = op('concat', col('disease'), lit('!'));
    const loose = op('add', col('cases'), op('sum', col('cases')));
    expect(rows([label, loose], { groupBy: ['disease'], where: ONLY_STATES })).toEqual([
      { key: ['Pertussis'], values: ['Pertussis!', null] },
      { key: ['Measles'], values: ['Measles!', null] },
    ]);
  });

  it('the whole table is one row even when nothing folded in — a grand total nobody reached says 0', () => {
    // `groupBy: []` names its group in the DECLARATION and not from a value, so no row has to reach
    // it. SQL, Malloy and dbt all answer one row here; a KPI tile reads 0 rather than going blank.
    expect(rows([op('count', col('cases')), op('sum', col('cases'))], { groupBy: [], where: lit(false) })).toEqual([{ key: [], values: [0, null] }]);
    expect(groupRowsOf([op('count', col('cases'))], { groupBy: [] }, rowsOver([]))).toEqual([{ key: [], values: [0] }]);
    // A NAMED group nothing folded into is still no row: that group was named by a value nothing had.
    expect(rows([op('count', col('cases'))], { groupBy: ['disease'], where: lit(false) })).toEqual([]);
  });

  it('two trees sharing one reducer node are answered from one tally', () => {
    const total = op('sum', col('cases'));
    expect(rows([total, op('div', total, lit(2))], { groupBy: [], where: ONLY_STATES })).toEqual([{ key: [], values: [45, 22.5] }]);
  });
});

/**
 * SILENCE BELONGS TO A COLUMN, in the GROUP FOLD — the demo's own table.
 *
 * Three measured quantities, three state columns, three entries. The row that
 * matters is the one with no radius and a mass: before this packet one state
 * column spoke for the whole row, so that row's mass was lost from every sum.
 */
describe('the group fold, per column', () => {
  const MEASURED = silenceOfDecl([
    { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'] },
    { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
  ]);
  const CARRIED = silenceOfDecl([
    { field: 'radius_state', states: ['present', 'upper-bound', 'not-measured', 'unknown'], carries: ['upper-bound'], governs: ['pl_rade'], arithmetic: 'carried' },
    { field: 'mass_state', states: ['present', 'not-measured', 'unknown'], governs: ['pl_masse'] },
  ]);
  /** Three planets: one measured both ways, one with a bounded radius, one with no radius at all. */
  const PLANETS: readonly Row[] = [
    { method: 'transit', radius_state: 'present', pl_rade: 1.0, mass_state: 'present', pl_masse: 1.0 },
    { method: 'transit', radius_state: 'upper-bound', pl_rade: 2.0, mass_state: 'present', pl_masse: 4.0 },
    { method: 'transit', radius_state: 'not-measured', pl_rade: null, mass_state: 'present', pl_masse: 6.0 },
  ];
  const sumOf = (field: string, silence?: TableSilence): Cell[] => over(PLANETS, column(op('sum', col(field)), { groupBy: ['method'] }, 'aggregate'), silence);

  it('a row silent in its RADIUS still contributes its MASS to a sum', () => {
    expect(sumOf('pl_masse', MEASURED)).toEqual([11, 11, 11]);
  });

  it('…and contributes nothing to the radius sum, while the measured rows still do', () => {
    // 1.0 only: the bounded radius is a figure the source published, but the default arithmetic reads exactly `present`
    expect(sumOf('pl_rade', MEASURED)).toEqual([1, 1, 1]);
  });

  it("arithmetic: 'carried' puts the published bound into the SAME sum, over the same rows", () => {
    expect(sumOf('pl_rade', CARRIED)).toEqual([3, 3, 3]);
    // and it moves that column only — the mass entry never said `carried`
    expect(sumOf('pl_masse', CARRIED)).toEqual([11, 11, 11]);
  });

  it('a table with no reading at all sums every cell it finds — the law is the declaration\'s, never guessed', () => {
    expect(sumOf('pl_rade')).toEqual([3, 3, 3]);
  });

  it("the aggregate's `where` drops the right rows per column: a filter on one state column leaves the others alone", () => {
    const measuredRadius = op('eq', col('radius_state'), lit('present'));
    const filtered = column(op('sum', op('if', measuredRadius, col('pl_masse'), lit(null))), { groupBy: ['method'] }, 'aggregate');
    // only the first planet's radius is `present`, so only its mass is folded — the state column stayed askable
    expect(over(PLANETS, filtered, MEASURED)).toEqual([1, 1, 1]);
  });

  it('a row silent in the GROUP KEY\'s own column is in no group, and its neighbours are not dropped with it', () => {
    const keyed = silenceOfDecl([{ field: 'radius_state', states: ['present', 'not-measured', 'unknown'], governs: ['method'] }]);
    // Planet 1 groups. Planet 3's `method` is blanked by its governor (`not-measured`), and planet 2's
    // too — `upper-bound` is a word THIS vocabulary never declared, and an undeclared word is a
    // silence like any other (the walker's law, `./walk.ts`). Each is in no group, and each one's
    // OTHER columns are untouched: the mass sums above still count all three.
    expect(over(PLANETS, column(op('count', col('pl_masse')), { groupBy: ['method'] }, 'aggregate'), keyed)).toEqual([1, null, null]);
  });
});
