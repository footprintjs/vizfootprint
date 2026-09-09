/**
 * THE CONFORMANCE FIXTURE — every op, at its pinned answer.
 *
 * An op whose answer moves with the engine is not one answer, so each row below
 * is the answer this grammar promises: a negative modulus, a `.5` rounding, an
 * integer division and a non-ISO date among them, exactly as the design asks.
 * A second engine earns the right to run these declarations by passing this
 * table, and refuses the op where it cannot ("never approximated").
 *
 * Beside it, the pins on the TABLE itself — the counts and the four non-strict
 * rows — because the absence law is only checkable if its exceptions are data.
 */

import { describe, expect, it } from 'vitest';
import {
  CALENDARS,
  CAST_TARGETS,
  DATE_UNITS,
  OP_NAMES,
  OPS_VERSION,
  REDUCER_OPS,
  addOf,
  dayOf,
  daysInMonth,
  diffOf,
  epochDayOf,
  evaluateRow,
  isoOf,
  isoOfMoment,
  opOf,
  partsOf,
  RESERVED_OPS,
  truncOf,
  wantAt,
  weekOf,
  weekdayOf,
  weekStartOf,
  wordsFor,
  type Cell,
  type Expr,
} from './index.js';
import type { Row } from '../data/types.js';

/** One table's row, holding one of everything the ops read. */
const ROW: Row = {
  cases: 12,
  population: 1000,
  ratio: 7,
  half: 0.5,
  region: 'North',
  label: '  Rate  ',
  flag: true,
  off: false,
  when: '2026-01-04',
  slash: '2026/01/04',
  nothing: null,
};

const at = (expr: Expr): Cell => evaluateRow(expr, ROW);
const col = (name: string): Expr => ({ col: name });
const lit = (value: number | string | boolean | null): Expr => ({ lit: value });

describe('the op table', () => {
  it('holds fifty-one ops in nine categories, and five reserved names beside them', () => {
    expect(OP_NAMES).toHaveLength(51);
    expect(new Set(OP_NAMES.map((name) => opOf(name)!.category))).toEqual(
      new Set(['arithmetic', 'compare', 'logic', 'conditional', 'number', 'string', 'date', 'cast', 'reducer']),
    );
    // The six reducers were reserved names until they had a group to run over; a
    // clock never can be, `lookup` names an ACT rather than a missing op,
    // `distinct` is held for the set-valued op — the one that COUNTS is countDistinct —
    // and `avg` is the SQL word for the reducer this table calls mean.
    expect(Object.keys(RESERVED_OPS)).toEqual(['lookup', 'today', 'now', 'distinct', 'avg']);
    // A reserved name is not also an op: the two lists are the whole vocabulary and they do not overlap.
    expect(OP_NAMES.filter((name) => name in RESERVED_OPS)).toEqual([]);
    expect(OPS_VERSION).toBe(1);
  });

  it('carries every arity in numbers AND in words, so neither is derived from the other', () => {
    for (const name of OP_NAMES) {
      const op = opOf(name)!;
      expect(op.takes.length, name).toBeGreaterThan(0);
      expect(op.least, name).toBeGreaterThanOrEqual(1);
      expect(op.most, name).toBeGreaterThanOrEqual(op.least);
      expect(op.wants.length, name).toBeGreaterThan(0);
    }
  });

  it('names the reducer vocabulary a measure picker offers, and it is exactly the ops that fold rows', () => {
    // Read off the table, never typed beside it: the list a screen offers and the
    // list the walker folds with are the same list, so a seventh reducer arrives
    // on both at once.
    expect(REDUCER_OPS).toEqual(['count', 'sum', 'mean', 'min', 'max', 'countDistinct']);
    // Read off `reduces`, the flag the walker and the group collector branch on — so the picker
    // and the fold cannot come to hold two opinions about which ops fold.
    expect(REDUCER_OPS.filter((name) => opOf(name)!.reduces !== true)).toEqual([]);
    expect(OP_NAMES.filter((name) => opOf(name)!.reduces === true && !REDUCER_OPS.includes(name))).toEqual([]);
    // The documentation label agrees with the flag today, and nothing reads it: `category` is prose.
    expect(REDUCER_OPS.filter((name) => opOf(name)!.category !== 'reducer')).toEqual([]);
  });

  it('says which four ops see absence, and it is the four whose subject IS absence', () => {
    expect(OP_NAMES.filter((name) => opOf(name)!.strict === false)).toEqual(['if', 'case', 'coalesce', 'isAbsent']);
  });

  it('says which six ops fold ROWS, and they are the only ops that are neither strict nor not', () => {
    const reducers = OP_NAMES.filter((name) => opOf(name)!.reduces === true);
    expect(reducers).toEqual(['count', 'sum', 'mean', 'min', 'max', 'countDistinct']);
    // The three shapes are told apart by data, never by guessing: a reducer has
    // no per-row strictness to declare, because its rows are not its arguments.
    for (const name of reducers) expect(opOf(name)!.strict, name).toBeUndefined();
    for (const name of OP_NAMES.filter((n) => !reducers.includes(n))) expect(opOf(name)!.reduces, name).toBeUndefined();
    // Every reducer takes exactly one argument, and that argument is an ordinary row tree.
    for (const name of reducers) expect([opOf(name)!.least, opOf(name)!.most], name).toEqual([1, 1]);
  });

  it('names only week, dayOfWeek and dateTrunc as calendar-carrying', () => {
    expect(OP_NAMES.filter((name) => opOf(name)!.calendar !== undefined)).toEqual(['week', 'dayOfWeek', 'dateTrunc']);
    expect(CALENDARS).toEqual(['iso', 'mmwr']);
    expect(DATE_UNITS).toEqual(['year', 'month', 'week', 'day']);
    expect(CAST_TARGETS).toEqual(['number', 'string', 'date']);
  });

  it('has no op of a name it does not have — Object.prototype\'s names included', () => {
    expect(opOf('sqrt')).toBeUndefined();
    expect(opOf('toString')).toBeUndefined();
    expect(opOf('constructor')).toBeUndefined();
    expect(RESERVED_OPS['toString']).toBeUndefined();
  });

  it('repeats the last want for a variadic op, and cycles for the one op whose arguments alternate', () => {
    expect(wantAt(opOf('concat')!, 5, 6)).toBe('string');
    // `case` is condition, value, condition, value, …, fallback — and the fallback takes the value's want.
    expect([0, 1, 2, 3, 4].map((position) => wantAt(opOf('case')!, position, 5))).toEqual(['boolean', 'same', 'boolean', 'same', 'same']);
  });
});

describe('the conformance fixture', () => {
  const CASES: readonly (readonly [string, Expr, Cell])[] = [
    // arithmetic — division is always float, and a negative modulus keeps the dividend's sign
    ['add', { op: 'add', args: [col('cases'), lit(3)] }, 15],
    ['sub', { op: 'sub', args: [col('cases'), lit(3)] }, 9],
    ['mul', { op: 'mul', args: [col('cases'), lit(3)] }, 36],
    ['div is float', { op: 'div', args: [col('ratio'), lit(2)] }, 3.5],
    ['div by zero is absent', { op: 'div', args: [col('cases'), lit(0)] }, null],
    ['mod follows the dividend', { op: 'mod', args: [lit(-7), lit(3)] }, -1],
    ['mod by zero is absent', { op: 'mod', args: [col('cases'), lit(0)] }, null],

    // compare — by code unit, both ends included
    ['eq', { op: 'eq', args: [col('region'), lit('North')] }, true],
    ['ne', { op: 'ne', args: [col('region'), lit('North')] }, false],
    ['lt on numbers', { op: 'lt', args: [col('cases'), lit(20)] }, true],
    ['lt by code unit', { op: 'lt', args: [lit('Apple'), lit('apple')] }, true],
    ['lte', { op: 'lte', args: [col('cases'), lit(12)] }, true],
    ['gt', { op: 'gt', args: [col('cases'), lit(20)] }, false],
    ['gte', { op: 'gte', args: [col('cases'), lit(12)] }, true],
    ['between includes both ends', { op: 'between', args: [col('cases'), lit(12), lit(20)] }, true],
    ['between excludes outside', { op: 'between', args: [col('cases'), lit(13), lit(20)] }, false],

    // logic — strict, unlike SQL
    ['and', { op: 'and', args: [col('flag'), col('off')] }, false],
    ['or', { op: 'or', args: [col('flag'), col('off')] }, true],
    ['not', { op: 'not', args: [col('flag')] }, false],
    ['and with an absence is absent, not false', { op: 'and', args: [{ op: 'eq', args: [col('nothing'), lit(1)] }, col('off')] }, null],

    // conditional and absence
    ['if takes the arm', { op: 'if', args: [{ op: 'gt', args: [col('cases'), lit(10)] }, lit('many'), lit('few')] }, 'many'],
    ['if takes the other arm', { op: 'if', args: [{ op: 'gt', args: [col('cases'), lit(90)] }, lit('many'), lit('few')] }, 'few'],
    ['an absent condition is absent, not false', { op: 'if', args: [{ op: 'eq', args: [col('nothing'), lit(1)] }, lit(1), lit(0)] }, null],
    ['case matches its pair', { op: 'case', args: [{ op: 'gt', args: [col('cases'), lit(10)] }, lit('high'), lit('low')] }, 'high'],
    [
      'case falls through to the fallback',
      { op: 'case', args: [{ op: 'gt', args: [col('cases'), lit(90)] }, lit('high'), { op: 'gt', args: [col('cases'), lit(50)] }, lit('mid'), lit('low')] },
      'low',
    ],
    [
      'case reaches its second pair',
      { op: 'case', args: [{ op: 'gt', args: [col('cases'), lit(90)] }, lit('high'), { op: 'gt', args: [col('cases'), lit(5)] }, lit('mid'), lit('low')] },
      'mid',
    ],
    ['case with an absent condition is absent', { op: 'case', args: [{ op: 'eq', args: [col('nothing'), lit(1)] }, lit('a'), lit('b')] }, null],
    ['coalesce takes the first value there is', { op: 'coalesce', args: [col('nothing'), col('cases')] }, 12],
    ['coalesce of nothing is absent', { op: 'coalesce', args: [col('nothing'), lit(null)] }, null],
    ['isAbsent on a silence', { op: 'isAbsent', args: [col('nothing')] }, true],
    ['isAbsent on a value', { op: 'isAbsent', args: [col('cases')] }, false],

    // number — half away from zero
    ['round half away from zero', { op: 'round', args: [col('half')] }, 1],
    ['round negative half away from zero', { op: 'round', args: [lit(-0.5)] }, -1],
    ['round half away from zero at 2.5', { op: 'round', args: [lit(2.5)] }, 3],
    ['abs', { op: 'abs', args: [lit(-3)] }, 3],
    ['floor', { op: 'floor', args: [lit(1.7)] }, 1],
    ['ceil', { op: 'ceil', args: [lit(1.2)] }, 2],
    ['rowMin', { op: 'rowMin', args: [lit(3), col('cases'), lit(2)] }, 2],
    ['rowMax', { op: 'rowMax', args: [lit(3), col('cases'), lit(2)] }, 12],
    ['rowMin over dates is the earlier date', { op: 'rowMin', args: [col('when'), lit('2025-12-31'), lit('2026-02-01')] }, '2025-12-31'],
    ['rowMax over dates is the later date', { op: 'rowMax', args: [col('when'), lit('2025-12-31'), lit('2026-02-01')] }, '2026-02-01'],

    // string
    ['concat', { op: 'concat', args: [col('region'), lit('!')] }, 'North!'],
    ['lower', { op: 'lower', args: [col('region')] }, 'north'],
    ['upper', { op: 'upper', args: [col('region')] }, 'NORTH'],
    ['trim', { op: 'trim', args: [col('label')] }, 'Rate'],
    ['length counts code units', { op: 'length', args: [col('region')] }, 5],
    ['contains', { op: 'contains', args: [col('region'), lit('ort')] }, true],
    ['startsWith', { op: 'startsWith', args: [col('region'), lit('N')] }, true],
    ['endsWith', { op: 'endsWith', args: [col('region'), lit('h')] }, true],
    ['in', { op: 'in', args: [col('region'), lit('North'), lit('South')] }, true],
    ['in, when it is not', { op: 'in', args: [col('region'), lit('East'), lit('South')] }, false],
    ['split counts pieces from 1', { op: 'split', args: [lit('a-b-c'), lit('-'), lit(2)] }, 'b'],
    ['split past the end is absent', { op: 'split', args: [lit('a-b-c'), lit('-'), lit(9)] }, null],
    ['substring counts from 1', { op: 'substring', args: [col('region'), lit(2), lit(3)] }, 'ort'],
    ['substring before the first character is absent', { op: 'substring', args: [col('region'), lit(0), lit(3)] }, null],
    ['substring of a negative length is absent', { op: 'substring', args: [col('region'), lit(1), lit(-1)] }, null],
    ['replace changes every occurrence', { op: 'replace', args: [lit('a-b-a'), lit('a'), lit('x')] }, 'x-b-x'],
    ['replacing nothing changes nothing', { op: 'replace', args: [lit('John'), lit(''), lit('-')] }, 'John'],

    // date — and the non-ISO date the fixture owes
    ['year', { op: 'year', args: [col('when')] }, 2026],
    ['month', { op: 'month', args: [col('when')] }, 1],
    ['a non-ISO date is absent', { op: 'year', args: [col('slash')] }, null],
    ['week on the iso calendar', { op: 'week', args: [lit('2026-01-03')], calendar: 'iso' }, 1],
    ['week on the mmwr calendar', { op: 'week', args: [lit('2026-01-03')], calendar: 'mmwr' }, 53],
    ['dayOfWeek on the iso calendar', { op: 'dayOfWeek', args: [col('when')], calendar: 'iso' }, 7],
    ['dayOfWeek on the mmwr calendar', { op: 'dayOfWeek', args: [col('when')], calendar: 'mmwr' }, 1],
    ['dateDiff in whole months', { op: 'dateDiff', args: [lit('2026-01-01'), lit('2026-03-01'), lit('month')] }, 2],
    ['dateDiff truncates a part month', { op: 'dateDiff', args: [lit('2026-01-31'), lit('2026-02-28'), lit('month')] }, 0],
    ['dateAdd clamps to the end of the month', { op: 'dateAdd', args: [lit('2026-01-31'), lit(1), lit('month')] }, '2026-02-28'],
    ['dateAdd of half a month is absent', { op: 'dateAdd', args: [col('when'), lit(1.5), lit('month')] }, null],
    ['dateAdd past what a date can be is absent', { op: 'dateAdd', args: [col('when'), lit(1_000_000_000), lit('day')] }, null],
    ['dateTrunc to the month', { op: 'dateTrunc', args: [lit('2026-01-15'), lit('month')] }, '2026-01-01'],
    ['dateTrunc to the mmwr week', { op: 'dateTrunc', args: [lit('2026-01-15'), lit('week')], calendar: 'mmwr' }, '2026-01-11'],
    ['dateTrunc to the iso week', { op: 'dateTrunc', args: [lit('2026-01-15'), lit('week')], calendar: 'iso' }, '2026-01-12'],

    // cast — and cast(to date) yields an ISO string, never a Date
    ['cast text to a number', { op: 'cast', args: [lit(' 12 '), lit('number')] }, 12],
    ['cast text that is not a number', { op: 'cast', args: [lit('12 cases'), lit('number')] }, null],
    ['cast empty text to a number', { op: 'cast', args: [lit(''), lit('number')] }, null],
    ['cast decimal notation, and only that', { op: 'cast', args: [lit('-1.5e2'), lit('number')] }, -150],
    ['cast base-prefixed text is absent, never its value', { op: 'cast', args: [lit('0x10'), lit('number')] }, null],
    ['cast binary text is absent', { op: 'cast', args: [lit('0b11'), lit('number')] }, null],
    ['cast a number too large to hold is absent', { op: 'cast', args: [lit('1e999'), lit('number')] }, null],
    ['cast a number to a number', { op: 'cast', args: [col('cases'), lit('number')] }, 12],
    ['cast a boolean to a number', { op: 'cast', args: [col('flag'), lit('number')] }, 1],
    ['cast a false to a number', { op: 'cast', args: [col('off'), lit('number')] }, 0],
    ['cast a number to text', { op: 'cast', args: [col('cases'), lit('string')] }, '12'],
    ['cast text to text', { op: 'cast', args: [col('region'), lit('string')] }, 'North'],
    ['cast a timestamp to a date keeps the ISO string', { op: 'cast', args: [lit('2026-01-04T05:00:00Z'), lit('date')] }, '2026-01-04'],
    ['cast a non-ISO date is absent', { op: 'cast', args: [col('slash'), lit('date')] }, null],
    ['cast a number to a date is absent', { op: 'cast', args: [col('cases'), lit('date')] }, null],
  ];

  for (const [what, expr, expected] of CASES) {
    it(what, () => {
      expect(at(expr)).toEqual(expected);
    });
  }
});

describe('the calendar arithmetic', () => {
  it('reads an ISO date and refuses everything else', () => {
    expect(epochDayOf('1970-01-01')).toBe(0);
    expect(epochDayOf('2026-01-04T05:00:00Z')).toBe(dayOf(2026, 1, 4));
    expect(epochDayOf('2026-01-04T05:00:00.250+05:30')).toBe(dayOf(2026, 1, 4));
    expect(epochDayOf('2026-01-04T05:00')).toBe(dayOf(2026, 1, 4));
    // a T must be followed by a TIME — "Tomorrow" is not a timestamp, and no other engine would read it as one
    expect(epochDayOf('2026-01-04T')).toBeNull();
    expect(epochDayOf('2026-01-04Tomorrow')).toBeNull();
    expect(epochDayOf('2026/01/04')).toBeNull();
    expect(epochDayOf('2026-13-01')).toBeNull();
    expect(epochDayOf('2026-00-01')).toBeNull();
    expect(epochDayOf('2026-01-32')).toBeNull();
    expect(epochDayOf('2026-01-00')).toBeNull();
    expect(epochDayOf('2026-02-29')).toBeNull();
  });

  it('knows which Februaries have twenty-nine days', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(epochDayOf('0026-01-04')).toBe(dayOf(26, 1, 4));
    expect(partsOf(dayOf(26, 1, 4)).year).toBe(26);
  });

  it('writes a day back as ten characters, or refuses when there is no date there', () => {
    expect(isoOf(0)).toBe('1970-01-01');
    expect(isoOf(dayOf(26, 1, 4))).toBe('0026-01-04');
    expect(isoOf(1e9)).toBeNull();
    expect(isoOf(0.5)).toBeNull();
    // the two ends are the four-digit years its own reader reads back — never a JS Date's reach
    expect(isoOf(dayOf(0, 1, 1))).toBe('0000-01-01');
    expect(isoOf(dayOf(9999, 12, 31))).toBe('9999-12-31');
    expect(isoOf(dayOf(10000, 1, 1))).toBeNull();
    expect(isoOf(dayOf(-1, 1, 1))).toBeNull();
    expect(epochDayOf(isoOf(dayOf(9999, 12, 31))!)).toBe(dayOf(9999, 12, 31));
  });

  it('brings a `Date` over as its UTC day, and an invalid one as absent', () => {
    expect(isoOfMoment(new Date('2026-01-04T23:59:59Z'))).toBe('2026-01-04');
    expect(isoOfMoment(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
    expect(isoOfMoment(new Date(Number.NaN))).toBeNull();
  });

  it('counts weekdays before 1970 as well as after', () => {
    // 1969-12-25 was a Thursday: fourth day of an iso week, fifth of an mmwr one.
    expect(weekdayOf(epochDayOf('1969-12-25')!, 'iso')).toBe(4);
    expect(weekdayOf(epochDayOf('1969-12-25')!, 'mmwr')).toBe(5);
    expect(isoOf(weekStartOf(epochDayOf('1969-12-25')!, 'iso'))).toBe('1969-12-22');
  });

  it('puts a day into the week of the year it really belongs to', () => {
    // The three arms: before this year's week 1, inside it, and on or after the next year's.
    expect(weekOf(epochDayOf('2026-01-03')!, 'mmwr')).toBe(53);
    expect(weekOf(epochDayOf('2026-06-01')!, 'mmwr')).toBe(22);
    expect(weekOf(epochDayOf('2025-12-29')!, 'iso')).toBe(1);
  });

  it('truncates to every unit', () => {
    const day = epochDayOf('2026-05-20')!;
    expect(isoOf(truncOf(day, 'year', undefined))).toBe('2026-01-01');
    expect(isoOf(truncOf(day, 'month', undefined))).toBe('2026-05-01');
    expect(isoOf(truncOf(day, 'week', 'iso'))).toBe('2026-05-18');
    expect(isoOf(truncOf(day, 'day', undefined))).toBe('2026-05-20');
  });

  it('adds in every unit, and clamps where the month is shorter', () => {
    const day = epochDayOf('2026-01-31')!;
    expect(isoOf(addOf(day, 3, 'day')!)).toBe('2026-02-03');
    expect(isoOf(addOf(day, 1, 'week')!)).toBe('2026-02-07');
    expect(isoOf(addOf(day, 1, 'month')!)).toBe('2026-02-28');
    expect(isoOf(addOf(day, 1, 'year')!)).toBe('2027-01-31');
    expect(isoOf(addOf(day, -2, 'month')!)).toBe('2025-11-30');
    expect(addOf(day, 0.5, 'day')).toBeNull();
  });

  it('counts whole units between two days, in either direction', () => {
    const jan = epochDayOf('2026-01-31')!;
    const feb = epochDayOf('2026-02-28')!;
    expect(diffOf(jan, feb, 'day')).toBe(28);
    expect(diffOf(jan, feb, 'week')).toBe(4);
    expect(diffOf(jan, feb, 'month')).toBe(0);
    expect(diffOf(feb, jan, 'month')).toBe(0);
    expect(diffOf(jan, epochDayOf('2027-03-01')!, 'year')).toBe(1);
    expect(diffOf(epochDayOf('2026-03-01')!, jan, 'month')).toBe(-1);
    expect(diffOf(jan, epochDayOf('2026-03-31')!, 'month')).toBe(2);
  });
});

describe('the sentence', () => {
  it('says a tree in the op table’s own words, parenthesising what is nested', () => {
    expect(wordsFor({ op: 'mul', args: [{ op: 'div', args: [col('cases'), col('population')] }, lit(100000)] })).toBe(
      '(cases divided by population) times 100000',
    );
  });

  it('says which calendar counted a week, because the calendar is part of the meaning', () => {
    expect(wordsFor({ op: 'week', args: [col('when')], calendar: 'mmwr' })).toBe('the week of when on the mmwr calendar');
  });

  it('says a written-down word bare, and a string value quoted', () => {
    expect(wordsFor({ op: 'dateTrunc', args: [col('when'), lit('month')] })).toBe('the start of the month containing when');
    expect(wordsFor({ op: 'cast', args: [col('cases'), lit('string')] })).toBe('cases read as a string');
    expect(wordsFor({ op: 'eq', args: [col('region'), lit('North')] })).toBe('region is "North"');
    // a value holding a quote still has a beginning and an end — written the way the judge writes it
    expect(wordsFor({ op: 'eq', args: [col('region'), lit('North "Central"')] })).toBe('region is "North \\"Central\\""');
  });

  it('never prints the word "undefined" — an unjudged tree with a column where a word belongs names the column', () => {
    expect(wordsFor({ op: 'dateTrunc', args: [col('when'), col('unit_col')] })).toBe('the start of the unit_col containing when');
    expect(wordsFor({ op: 'cast', args: [col('cases'), { op: 'lower', args: [col('region')] }] })).toBe('cases read as a (region in lower case)');
  });

  it('names an absence rather than showing an empty space', () => {
    expect(wordsFor({ op: 'coalesce', args: [col('cases'), lit(null)] })).toBe('the first of cases, absent that is there');
    expect(wordsFor({ op: 'eq', args: [col('flag'), lit(true)] })).toBe('flag is true');
  });

  it('says every shape the table can make', () => {
    expect(wordsFor({ op: 'and', args: [{ op: 'not', args: [col('flag')] }, col('off')] })).toBe('(not flag) and off');
    expect(wordsFor({ op: 'or', args: [col('flag'), col('off')] })).toBe('flag or off');
    expect(wordsFor({ op: 'if', args: [col('flag'), lit(1), lit(0)] })).toBe('1 when flag, otherwise 0');
    expect(wordsFor({ op: 'case', args: [col('flag'), lit(1), col('off'), lit(2), lit(0)] })).toBe('1 when flag, 2 when off, otherwise 0');
    expect(wordsFor({ op: 'isAbsent', args: [col('cases')] })).toBe('cases is absent');
    expect(wordsFor({ op: 'in', args: [col('region'), lit('North'), lit('South')] })).toBe('region is one of "North", "South"');
    expect(wordsFor({ op: 'between', args: [col('cases'), lit(1), lit(9)] })).toBe('cases is between 1 and 9');
    expect(wordsFor({ op: 'dateDiff', args: [col('when'), col('when'), lit('day')] })).toBe('the whole days from when to when');
    expect(wordsFor({ op: 'dateAdd', args: [col('when'), lit(3), lit('day')] })).toBe('3 days after when');
  });

  it('has a fragment for every op in the table', () => {
    for (const name of OP_NAMES) {
      const op = opOf(name)!;
      const said = op.words(['a', 'b', 'c']);
      expect(said.length, name).toBeGreaterThan(0);
    }
  });
});
