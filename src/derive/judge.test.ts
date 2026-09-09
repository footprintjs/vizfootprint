/**
 * EVERY REFUSAL, AND THE TYPE IT COMPUTES INSTEAD.
 *
 * The judge is total over any value: a declaration is either a column — with
 * the type worked out from the op table and the columns it reads named — or ONE
 * sentence that quotes the offending value and says what is known. Never a
 * throw, never a half-judged tree, and never a column of silences somebody has
 * to explain afterwards.
 */

import { describe, expect, it } from 'vitest';
import { judgeDerivedColumn, judgeExpr, MAX_TREE_DEPTH, MAX_TREE_NODES, OPS_VERSION, type Expr } from './index.js';
import type { ColumnInfo } from '../data/types.js';

const COLUMNS: readonly ColumnInfo[] = [
  { name: 'cases', type: 'number' },
  { name: 'population', type: 'number' },
  { name: 'region', type: 'string' },
  { name: 'flag', type: 'boolean' },
  { name: 'when', type: 'date' },
  { name: 'blank', type: 'unknown' },
];

const col = (name: string): Expr => ({ col: name });
const lit = (value: number | string | boolean | null): Expr => ({ lit: value });

/** The type a tree computes, or the test fails saying what it refused. */
function typeOf(value: unknown, columns: readonly ColumnInfo[] = COLUMNS): string {
  const judged = judgeExpr(value, 'cells', columns);
  if (!judged.ok) throw new Error(`expected a column, got: ${judged.problem}`);
  return judged.type;
}

/** The sentence a tree is refused with, or the type it should not have computed. */
function problem(value: unknown, columns: readonly ColumnInfo[] = COLUMNS): string {
  const judged = judgeExpr(value, 'cells', columns);
  if (judged.ok) throw new Error(`expected a refusal, got a ${judged.type} column`);
  return judged.problem;
}

describe('the type is computed from the table, never tallied from values', () => {
  it('works arithmetic out to a number, and names what it reads once each', () => {
    const judged = judgeExpr({ op: 'mul', args: [{ op: 'div', args: [col('cases'), col('population')] }, lit(100000)] }, 'cells', COLUMNS);
    expect(judged).toMatchObject({ ok: true, type: 'number', reads: ['cases', 'population'] });
  });

  it('reads a column named twice only once', () => {
    const judged = judgeExpr({ op: 'add', args: [col('cases'), col('cases')] }, 'cells', COLUMNS);
    expect(judged).toMatchObject({ ok: true, reads: ['cases'] });
  });

  it('gives every literal its type, and reads ISO text as the date it is', () => {
    expect(typeOf(lit(3))).toBe('number');
    expect(typeOf(lit('x'))).toBe('string');
    expect(typeOf(lit(true))).toBe('boolean');
    // There is no date literal FORM, so this is the only way a date constant can be written down.
    expect(typeOf(lit('2026-01-04'))).toBe('date');
    expect(typeOf({ op: 'dateDiff', args: [col('when'), lit('2026-03-01'), lit('day')] })).toBe('number');
  });

  it('costs a date-looking literal its place among the string ops, which is what cast is for', () => {
    // …and the refusal is a direction, not a wall: it names the cast, because a quoted string being a
    // date is the one thing no spreadsheet person has a prior for
    expect(problem({ op: 'concat', args: [col('region'), lit('2026-01-04')] })).toBe(
      'argument 2 of the op "concat" must be a string, and the value "2026-01-04" is a date — an ISO-shaped constant reads as a date; ' +
        'to compare it as text, cast it: { op: "cast", args: [{ lit: "2026-01-04" }, { lit: "string" }] }',
    );
    expect(typeOf({ op: 'concat', args: [col('region'), { op: 'cast', args: [lit('2026-01-04'), lit('string')] }] })).toBe('string');
    // the same door from the agreement side, whichever side the constant is on
    expect(problem({ op: 'eq', args: [col('region'), lit('2024-01-06')] })).toBe(
      'the op "eq" needs its arguments to be of ONE type, and the value "2024-01-06" is a date where the column "region" is a string — ' +
        'an ISO-shaped constant reads as a date; to compare it as text, cast it: { op: "cast", args: [{ lit: "2024-01-06" }, { lit: "string" }] }',
    );
    expect(problem({ op: 'eq', args: [lit('2024-01-06'), col('region')] })).toMatch(/is a string where the value "2024-01-06" is a date — an ISO-shaped constant reads as a date/);
    // a date COLUMN beside a string, or a date constant beside a number, is not a shape accident — no door is named
    expect(problem({ op: 'concat', args: [col('region'), col('when')] })).toBe('argument 2 of the op "concat" must be a string, and the column "when" is a date');
    expect(problem({ op: 'add', args: [col('cases'), lit('2026-01-04')] })).toBe('argument 2 of the op "add" must be a number, and the value "2026-01-04" is a date');
    expect(problem({ op: 'eq', args: [col('when'), col('region')] })).toBe(
      'the op "eq" needs its arguments to be of ONE type, and the column "region" is a string where the column "when" is a date',
    );
  });

  it('takes an op that answers with its arguments’ type from those arguments', () => {
    expect(typeOf({ op: 'if', args: [col('flag'), col('region'), lit('none')] })).toBe('string');
    expect(typeOf({ op: 'case', args: [col('flag'), lit(1), col('flag'), lit(2), lit(0)] })).toBe('number');
    // An absence has no type of its own, so the other arm settles it — which is what makes `if(c, x, null)` legal.
    expect(typeOf({ op: 'coalesce', args: [col('cases'), lit(null)] })).toBe('number');
    // the row-wise pair takes anything ordered, like min and max: the earlier of two dates is a date
    expect(typeOf({ op: 'rowMin', args: [col('when'), lit('2026-01-01')] })).toBe('date');
    expect(typeOf({ op: 'rowMax', args: [col('cases'), col('population')] })).toBe('number');
    expect(problem({ op: 'rowMin', args: [col('flag'), col('flag')] })).toMatch(/puts its arguments in an order, and a boolean has none/);
  });

  it('takes a cast’s type from the target it was given', () => {
    expect(typeOf({ op: 'cast', args: [col('region'), lit('date')] })).toBe('date');
    expect(typeOf({ op: 'cast', args: [lit(null), lit('number')] })).toBe('number');
  });

  it('computes the fixed types the comparisons and the date ops declare', () => {
    expect(typeOf({ op: 'eq', args: [col('region'), lit('North')] })).toBe('boolean');
    expect(typeOf({ op: 'lt', args: [col('when'), lit('2026-01-01')] })).toBe('boolean');
    expect(typeOf({ op: 'week', args: [col('when')], calendar: 'mmwr' })).toBe('number');
    expect(typeOf({ op: 'dateAdd', args: [col('when'), lit(1), lit('day')] })).toBe('date');
    expect(typeOf({ op: 'isAbsent', args: [lit(null)] })).toBe('boolean');
  });

  it('takes as many arguments as a variadic op says it may', () => {
    expect(typeOf({ op: 'concat', args: [col('region'), lit('-'), col('region'), lit('-'), col('region')] })).toBe('string');
  });
});

describe('an op the grammar does not have', () => {
  it('names what it knows', () => {
    expect(problem({ op: 'sqrt', args: [col('cases')] })).toMatch(/^there is no op named "sqrt" — the ops this version knows are add, sub, /);
  });

  it('says which DOOR owns a reserved name rather than calling it unknown', () => {
    // `lookup` is not a missing op — it is an op that would duplicate an act, so
    // the sentence names the act and the permission it needs.
    expect(problem({ op: 'lookup', args: [col('cases')] })).toBe(
      'the op "lookup" is reserved: a lookup reads a SECOND table, and only a declared relation may permit that — ' +
        'declare the relation and bring the column over (the bringOver act), then read it here by its name',
    );
    expect(problem({ op: 'today', args: [] })).toBe(
      'the op "today" is reserved: a column whose value depends on when it ran cannot be replayed, so this grammar has no clock',
    );
    expect(problem({ op: 'now', args: [] })).toMatch(/no clock/);
  });

  it('a reducer with no group is told how to give it one, not that the name is unknown', () => {
    expect(problem({ op: 'sum', args: [col('cases')] })).toBe(
      'the op "sum" folds many rows into one answer, and a reducer needs to say which rows it runs over — ' +
        'declare over: { groupBy: [...] }, and an empty groupBy means the whole table',
    );
  });

  it('refuses an op that is not even a name', () => {
    expect(problem({ op: 7, args: [] })).toBe('an {op} node names its op with a string, and this one names 7');
  });

  it('does not know a name that only Object.prototype knows', () => {
    // the two tables are read by name, and a plain object would answer native code for these
    expect(problem({ op: 'toString', args: [] })).toMatch(/^there is no op named "toString" — the ops this version knows are add, /);
    expect(problem({ op: 'constructor', args: [col('cases')] })).toMatch(/^there is no op named "constructor"/);
    expect(problem({ op: '__proto__', args: [] })).toMatch(/^there is no op named "__proto__"/);
  });
});

describe('the wrong number of arguments', () => {
  it('says the arity in words, and how many it was given', () => {
    expect(problem({ op: 'add', args: [col('cases')] })).toBe('the op "add" takes two arguments, and it was given 1');
    expect(problem({ op: 'abs', args: [col('cases'), lit(1)] })).toBe('the op "abs" takes one argument, and it was given 2');
    expect(problem({ op: 'concat', args: [col('region')] })).toBe('the op "concat" takes two or more arguments, and it was given 1');
    expect(problem({ op: 'case', args: [col('flag'), lit(1), col('flag'), lit(2)] })).toBe(
      'the op "case" takes a condition, its value, any further condition/value pairs, and one final fallback, and it was given 4',
    );
  });

  it('refuses arguments that are not a list at all', () => {
    expect(problem({ op: 'add', args: { left: 1 } })).toBe('the op "add" carries its arguments in a list, and this one carries {"left":1}');
  });
});

describe('the wrong kind of argument', () => {
  it('names the position, what it must be, and what it was given', () => {
    expect(problem({ op: 'not', args: [col('cases')] })).toBe('argument 1 of the op "not" must be a boolean, and the column "cases" is a number');
    expect(problem({ op: 'div', args: [col('cases'), col('region')] })).toBe('argument 2 of the op "div" must be a number, and the column "region" is a string');
    expect(problem({ op: 'not', args: [{ op: 'add', args: [col('cases'), lit(1)] }] })).toBe(
      'argument 1 of the op "not" must be a boolean, and the op "add" is a number',
    );
  });

  it('lets a written-down absence stand only where an op does not pin a type, and says where that is', () => {
    expect(problem({ op: 'add', args: [col('cases'), lit(null)] })).toBe(
      'argument 2 of the op "add" must be a number, and the value null is a written-down absence, which has no type — ' +
        'one may stand only where an op does not pin one: inside coalesce, an if arm or a case fallback',
    );
  });

  it('makes every argument of one type agree', () => {
    expect(problem({ op: 'eq', args: [col('cases'), lit('x')] })).toBe(
      'the op "eq" needs its arguments to be of ONE type, and the value "x" is a string where the column "cases" is a number',
    );
  });

  it('refuses to put in an order a type that has none', () => {
    expect(problem({ op: 'lt', args: [col('flag'), lit(true)] })).toBe(
      'the op "lt" puts its arguments in an order, and a boolean has none — the types that do are number, string, date',
    );
  });

  it('refuses a tree that says nothing about its own type', () => {
    expect(problem({ op: 'coalesce', args: [lit(null), lit(null)] })).toBe(
      'the op "coalesce" was given nothing but absences, so nothing in it says what type the column would be',
    );
  });

  it('needs a unit and a cast target written down, never computed', () => {
    expect(problem({ op: 'dateTrunc', args: [col('when'), col('region')] })).toBe(
      'argument 2 of the op "dateTrunc" is the unit it counts in, written down as one of year, month, week, day — and it was given {"col":"region"}',
    );
    expect(problem({ op: 'dateTrunc', args: [col('when'), lit('fortnight')] })).toMatch(/written down as one of year, month, week, day — and it was given {"lit":"fortnight"}$/);
    expect(problem({ op: 'cast', args: [col('cases'), lit('json')] })).toBe(
      'argument 2 of the op "cast" is the type it reads as, written down as one of number, string, date — and it was given {"lit":"json"}',
    );
  });
});

describe('the columns it reads', () => {
  it('names what the table has instead', () => {
    expect(problem(col('deaths'))).toBe('this column reads "deaths", which table "cells" does not have — it has cases, population, region, flag, when, blank');
  });

  it('says so when the table has nothing at all', () => {
    expect(problem(col('deaths'), [])).toBe('this column reads "deaths", which table "cells" does not have — that table has no columns');
  });

  it('refuses a column whose type the engine could not name', () => {
    expect(problem(col('blank'))).toBe('this column reads "blank", which table "cells" holds as unknown — a derived column reads columns whose type is known');
  });

  it('refuses a column that is not named with a string', () => {
    expect(problem({ col: 7 })).toBe('a {col} node names its column with a string, and this one names 7');
  });
});

describe('the shapes that are not nodes', () => {
  it('refuses anything that is not one of the three forms', () => {
    expect(problem(42)).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one is 42');
    expect(problem(undefined)).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one is undefined');
    expect(problem([{ col: 'cases' }])).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one is [{"col":"cases"}]');
    expect(problem({ column: 'cases' })).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one is {"column":"cases"}');
  });

  it('quotes a value that cannot be written down without trying to write it', () => {
    expect(problem(() => 1)).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one is a function');
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(problem(loop)).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one is a value that cannot be written down');
  });

  it('shortens a long value rather than printing a wall', () => {
    const long = problem({ lit: Array.from({ length: 60 }, (_, at) => at) });
    const quoted = long.slice(long.indexOf('this one holds ') + 'this one holds '.length);
    expect(quoted).toHaveLength(80);
    expect(quoted.endsWith('…')).toBe(true);
  });

  it('refuses a literal that is not a value a column can hold', () => {
    expect(problem({ lit: [1, 2] })).toBe('a {lit} node holds a number, a string, a boolean or null, and this one holds [1,2]');
    expect(problem({ lit: Number.NaN })).toBe('a {lit} node holds a number, a string, a boolean or null, and this one holds NaN');
    expect(problem({ lit: undefined })).toBe('a {lit} node holds a number, a string, a boolean or null, and this one holds undefined');
  });

  it('refuses a node that says two forms at once, rather than reading the first it finds', () => {
    // the walks dispatch on different keys first, so a two-form node would be two different nodes to them
    expect(problem({ col: 'cases', op: 'sum', args: [col('cases')] })).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one names col and op at once');
    expect(problem({ col: 'cases', lit: 5 })).toBe('a node of a derived column is one of {col}, {lit} or {op, args}, and this one names col and lit at once');
    expect(problem({ op: 'add', args: [{ lit: 1, op: 'abs', args: [] }, lit(1)] })).toMatch(/names lit and op at once$/);
  });

  it('refuses a stray key on the form it picked, so a typo cannot ride onto the committed declaration', () => {
    // The declaration door keeps this law (`a derived column names ops, kind, expr and over…`); a node
    // one level down carried anything, and `judgeDerivedColumn` mints `expr` from these very bytes.
    expect(problem({ col: 'cases', args: [] })).toBe('a {col} node names col, and this one also names "args"');
    expect(problem({ lit: 3, calendar: 'iso' })).toBe('a {lit} node names lit, and this one also names "calendar"');
    expect(problem({ op: 'round', args: [col('cases')], digits: 2 })).toBe('a {op} node names op, args, calendar, and this one also names "digits"');
    // A one-letter typo on a key the op DOES take is refused too, where before it read as a silent success.
    expect(problem({ op: 'week', args: [col('when')], calender: 'iso' })).toBe('a {op} node names op, args, calendar, and this one also names "calender"');
    // The two-form sentence still wins: it says the bigger thing about the same node.
    expect(problem({ col: 'cases', lit: 5, digits: 2 })).toMatch(/names col and lit at once$/);
  });

  it('holds a WORD position to the same shape, so a unit can never come from a cell', () => {
    // `judgeArgs` short-circuits a unit or a target into `judgeWord`, so this is the ONE door that
    // shape passes — and the walker dispatches on `col` first, which would take the unit off a row.
    expect(problem({ op: 'dateTrunc', args: [col('when'), { lit: 'month', col: 'region' }] })).toBe(
      'argument 2 of the op "dateTrunc" is the unit it counts in, written down as one of year, month, week, day — and it was given {"lit":"month","col":"region"}',
    );
    expect(problem({ op: 'cast', args: [col('cases'), { lit: 'string', op: 'trim', args: [] }] })).toMatch(
      /^argument 2 of the op "cast" is the type it reads as, written down as one of /,
    );
  });

  it('refuses the reserved parameter node by name', () => {
    expect(problem({ param: 'year' })).toBe(
      'named parameters are reserved and not built — a column reads its table, and everything else it needs is written down in it',
    );
  });

  it('refuses a tree nobody could read back', () => {
    const nest = (deep: number): Expr => {
      let node: Expr = col('cases');
      for (let at = 0; at < deep; at += 1) node = { op: 'abs', args: [node] };
      return node;
    };
    expect(typeOf(nest(MAX_TREE_DEPTH - 1))).toBe('number');
    expect(problem(nest(MAX_TREE_DEPTH))).toBe('this tree nests more than 32 deep — a column nobody can read back is a column nobody can check');
  });

  it('refuses a column that is an absence on every row', () => {
    expect(problem(lit(null))).toBe('this column is an absence on every row, so nothing in it says what type it would be');
  });

  it('refuses a tree that is more WORK than a person could read, however shallow — a shared subtree is walked once per reference', () => {
    // `n = add(n, n)` L times over one column is 2^(L+1) - 1 visits: 4095 at eleven levels, 8191 at twelve
    const shared = (levels: number): Expr => {
      let node: Expr = col('cases');
      for (let at = 0; at < levels; at += 1) node = { op: 'add', args: [node, node] };
      return node;
    };
    expect(typeOf(shared(11))).toBe('number');
    expect(problem(shared(12))).toBe(`this tree has more than ${String(MAX_TREE_NODES)} nodes in it — a column nobody can read back is a column nobody can check`);
  });
});

describe('calendars are data, so the judge asks for one', () => {
  it('requires a calendar where the answer moves with it', () => {
    expect(problem({ op: 'week', args: [col('when')] })).toBe(
      'the op "week" must say which calendar counts its weeks — one of iso, mmwr — because a week number that does not say agrees with nothing and disagrees silently',
    );
    expect(problem({ op: 'dateTrunc', args: [col('when'), lit('week')] })).toMatch(/^the op "dateTrunc" must say which calendar/);
  });

  it('refuses a calendar it does not know', () => {
    expect(problem({ op: 'dayOfWeek', args: [col('when')], calendar: 'gregorian' })).toBe(
      '"gregorian" is not a calendar this version knows — the calendars are iso, mmwr',
    );
  });

  it('refuses a calendar on an op whose answer does not move with one', () => {
    expect(problem({ op: 'add', args: [col('cases'), lit(1)], calendar: 'iso' })).toBe(
      'the op "add" does not count on a calendar, so it may not name one — only week, dayOfWeek and a dateTrunc by week do',
    );
    expect(problem({ op: 'dateTrunc', args: [col('when'), lit('month')], calendar: 'iso' })).toBe(
      'a dateTrunc by month does not depend on which day a week starts, so it may not name a calendar',
    );
  });

  it('takes the calendar where it belongs', () => {
    expect(typeOf({ op: 'dateTrunc', args: [col('when'), lit('week')], calendar: 'iso' })).toBe('date');
    expect(typeOf({ op: 'dateTrunc', args: [col('when'), lit('month')] })).toBe('date');
  });
});

describe('the whole declaration', () => {
  const ok = { ops: OPS_VERSION, kind: 'row', expr: { op: 'div', args: [col('cases'), col('population')] } };

  it('answers with the column, its type and what it reads', () => {
    expect(judgeDerivedColumn(ok, 'cells', COLUMNS)).toEqual({
      ok: true,
      column: { ops: 1, kind: 'row', expr: ok.expr },
      type: 'number',
      reads: ['cases', 'population'],
    });
  });

  /** The sentence a declaration is refused with. */
  function refusal(value: unknown): string {
    const judged = judgeDerivedColumn(value, 'cells', COLUMNS);
    if (judged.ok) throw new Error(`expected a refusal, got a ${judged.type} column`);
    return judged.problem;
  }

  it('refuses a declaration that is not one', () => {
    expect(refusal('cases / population')).toBe('a derived column is a declaration — { ops, kind, expr, over? } — and this one is "cases / population"');
  });

  it('refuses a key it does not know, rather than dropping it — a typo\'d `over` must not read as success', () => {
    expect(refusal({ ...ok, ovr: { groupBy: ['region'] } })).toBe('a derived column names ops, kind, expr and over, and this one also names "ovr"');
  });

  it('refuses a vocabulary this build does not have', () => {
    expect(refusal({ ...ok, ops: 2 })).toBe('this column is written against ops 2, and this build knows ops 1');
    expect(refusal({ ...ok, ops: undefined })).toBe('this column is written against ops undefined, and this build knows ops 1');
  });

  it('names what a group would fold, and what a window still needs', () => {
    expect(refusal({ ...ok, over: { groupBy: ['region'] } })).toBe(
      'this column names a group and holds no reducer, so the group would fold nothing — a group is the rows a reducer runs over',
    );
    expect(refusal({ ...ok, kind: 'aggregate' })).toBe(
      'an aggregate column is one a reducer folds, and this one holds none — a reducer needs to say which rows it runs over — ' +
        'declare over: { groupBy: [...] }, and an empty groupBy means the whole table',
    );
    expect(refusal({ ...ok, kind: 'window' })).toBe('a window column needs an ordering as well as a group, and an ordering is not in this version');
    expect(refusal({ ...ok, kind: 'derived' })).toBe('a derived column\'s kind is row or aggregate, and this one says "derived"');
  });

  it('judges the tree it carries', () => {
    expect(refusal({ ...ok, expr: { op: 'sqrt', args: [] } })).toMatch(/^there is no op named "sqrt"/);
    expect(refusal({ ...ok, expr: lit(null) })).toBe('this column is an absence on every row, so nothing in it says what type it would be');
  });
});

/**
 * THE GROUP, judged. A reducer is the only op that reads rows it is not on, so
 * it is the only op whose PLACE has to be judged as well as its arguments — and
 * the kind law is what makes the word a declaration says about itself a fact
 * rather than a label somebody chose.
 */
describe('the group a reducer runs over', () => {
  const GROUPED: readonly ColumnInfo[] = [...COLUMNS, { name: 'disease', type: 'string' }, { name: 'kind', type: 'string' }];
  const STATES: Expr = { op: 'eq', args: [col('kind'), lit('state')] };

  /** A declaration's judgement, over the grouped table. */
  const judge = (value: Record<string, unknown>): ReturnType<typeof judgeDerivedColumn> => judgeDerivedColumn({ ops: OPS_VERSION, ...value }, 'cells', GROUPED);

  /** The sentence a declaration is refused with, over the grouped table. */
  function refused(value: Record<string, unknown>): string {
    const judged = judge(value);
    if (judged.ok) throw new Error(`expected a refusal, got a ${judged.type} column`);
    return judged.problem;
  }

  it('takes a share of a total: a row column holding a reducer, with the group beside it', () => {
    const judged = judge({
      kind: 'row',
      expr: { op: 'div', args: [col('cases'), { op: 'sum', args: [col('cases')] }] },
      over: { groupBy: ['disease'], where: STATES },
    });
    // the grouping column and the filter's column are READ — the fold needs them
    // loaded, and a walk that folded out only what the tree names would put
    // every row into the same silent group
    // the group is judged FIRST, so its columns lead the list a fold loads
    expect(judged).toMatchObject({ ok: true, type: 'number', reads: ['disease', 'kind', 'cases'] });
    expect(judged.ok && judged.column.over).toEqual({ groupBy: ['disease'], where: STATES });
  });

  it('computes a reducer’s type from its row, like every other op', () => {
    const type = (expr: Expr): unknown => {
      const judged = judge({ kind: 'aggregate', expr, over: { groupBy: ['disease'] } });
      return judged.ok ? judged.type : judged.problem;
    };
    expect(type({ op: 'count', args: [col('region')] })).toBe('number');
    expect(type({ op: 'sum', args: [col('cases')] })).toBe('number');
    expect(type({ op: 'countDistinct', args: [col('region')] })).toBe('number');
    // min and max answer with what they were given, so the smallest date is a date
    expect(type({ op: 'min', args: [col('when')] })).toBe('date');
    expect(type({ op: 'max', args: [col('region')] })).toBe('string');
    // …and a type with no order has no smallest
    expect(type({ op: 'min', args: [col('flag')] })).toBe('the op "min" puts its arguments in an order, and a boolean has none — the types that do are number, string, date');
  });

  it('a reducer takes a ROW TREE, which is what makes sum(if(…)) the honest SUMIF', () => {
    const sumif = { op: 'sum', args: [{ op: 'if', args: [STATES, col('cases'), lit(null)] }] };
    expect(judge({ kind: 'aggregate', expr: sumif, over: { groupBy: ['disease'] } })).toMatchObject({ ok: true, type: 'number' });
  });

  it('refuses a reducer INSIDE a reducer — it would have no rows of its own', () => {
    expect(refused({ kind: 'aggregate', expr: { op: 'sum', args: [{ op: 'max', args: [col('cases')] }] }, over: { groupBy: ['disease'] } })).toBe(
      'the op "max" stands inside another reducer, and a reducer inside a reducer has no rows of its own to run over',
    );
  });

  it('refuses a reducer inside the group’s own filter — that filter is what makes the group', () => {
    const expr = { op: 'sum', args: [col('cases')] };
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: ['disease'], where: { op: 'gt', args: [col('cases'), { op: 'mean', args: [col('cases')] }] } } })).toBe(
      'the op "mean" folds many rows into one answer, and over.where picks the rows a group is made of, so it cannot itself ask what a group came to',
    );
  });

  it('refuses a group that is not one, and a group naming a key it does not have', () => {
    const expr = { op: 'sum', args: [col('cases')] };
    expect(refused({ kind: 'aggregate', expr, over: 'disease' })).toBe('a column\'s group is { groupBy, where? }, and this one is "disease"');
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: ['disease'], having: 1 } })).toBe(
      'a column\'s group names groupBy and where, and this one also names "having"',
    );
  });

  it('refuses a groupBy that is not a list of column names, and one that names a column twice', () => {
    const expr = { op: 'sum', args: [col('cases')] };
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: 'disease' } })).toBe(
      'over.groupBy is the list of columns whose values make the groups — [] means the whole table — and this one is "disease"',
    );
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: ['disease', 7] } })).toMatch(/^over.groupBy is the list of columns/);
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: ['disease', 'disease'] } })).toBe(
      'over.groupBy names "disease" twice, and a column can only group by it once',
    );
  });

  it('refuses grouping by a column the table does not have, or one whose type it could not tell', () => {
    const expr = { op: 'sum', args: [col('cases')] };
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: ['ghost'] } })).toBe(
      'this column groups by "ghost", which table "cells" does not have — it has cases, population, region, flag, when, blank, disease, kind',
    );
    // in the GROUP's words — the expression does not read `blank`, it groups by it
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: ['blank'] } })).toBe(
      'this column groups by "blank", which table "cells" holds as unknown — a column groups by columns whose type is known',
    );
  });

  it('refuses a filter that does not come to a yes or a no', () => {
    const expr = { op: 'sum', args: [col('cases')] };
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: [], where: col('cases') } })).toBe(
      'over.where says which rows the reducer runs over, so it must come to a boolean, and this one comes to a number',
    );
    expect(refused({ kind: 'aggregate', expr, over: { groupBy: [], where: lit(null) } })).toBe(
      'over.where says which rows the reducer runs over, so it must come to a boolean, and this one comes to an absence',
    );
  });

  it('refuses a group with nothing to fold, and reducers with no group', () => {
    expect(refused({ kind: 'row', expr: { op: 'add', args: [col('cases'), lit(1)] }, over: { groupBy: ['disease'] } })).toBe(
      'this column names a group and holds no reducer, so the group would fold nothing — a group is the rows a reducer runs over',
    );
    expect(refused({ kind: 'row', expr: { op: 'sum', args: [col('cases')] } })).toBe(
      'the op "sum" folds many rows into one answer, and a reducer needs to say which rows it runs over — declare over: { groupBy: [...] }, and an empty groupBy means the whole table',
    );
    expect(refused({ kind: 'aggregate', expr: { op: 'add', args: [col('cases'), lit(1)] } })).toBe(
      'an aggregate column is one a reducer folds, and this one holds none — a reducer needs to say which rows it runs over — declare over: { groupBy: [...] }, and an empty groupBy means the whole table',
    );
  });

  it('THE KIND LAW: a column that changes within its own group is not an aggregate', () => {
    expect(
      refused({ kind: 'aggregate', expr: { op: 'div', args: [col('cases'), { op: 'sum', args: [col('cases')] }] }, over: { groupBy: ['disease'] } }),
    ).toBe('this column says it is an aggregate, and it reads "cases" outside its reducers — a column that changes within its own group is a row column');
  });

  it('THE KIND LAW: a column that is the same on every row of its group is not a row column', () => {
    expect(refused({ kind: 'row', expr: { op: 'sum', args: [col('cases')] }, over: { groupBy: ['disease'] } })).toBe(
      'this column says it is a row column, and every part of it is the same on every row of its group — that is an aggregate',
    );
    // a GROUPING column read outside a reducer cannot vary within the group, so it does not make one
    expect(refused({ kind: 'row', expr: { op: 'concat', args: [col('disease'), { op: 'cast', args: [{ op: 'sum', args: [col('cases')] }, lit('string')] }] }, over: { groupBy: ['disease'] } })).toMatch(
      /that is an aggregate$/,
    );
  });

  it('an aggregate over the WHOLE TABLE says so with an empty groupBy, and reads only what it folds', () => {
    const judged = judge({ kind: 'aggregate', expr: { op: 'sum', args: [col('cases')] }, over: { groupBy: [] } });
    expect(judged).toMatchObject({ ok: true, type: 'number', reads: ['cases'] });
    expect(judged.ok && judged.column.over).toEqual({ groupBy: [] });
  });

  it('a bare TREE has no group beside it, so a reducer in one is told how to get one', () => {
    expect(problem({ op: 'sum', args: [col('cases')] })).toMatch(/^the op "sum" folds many rows into one answer, and a reducer needs to say/);
  });
});
