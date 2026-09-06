/**
 * THE GRAMMAR, AND EVERY REFUSAL IT MAKES.
 *
 * A formula is the one thing in this library a PERSON types and the library
 * then runs, so the two properties this file pins are the two that matter:
 * nothing outside the grammar is ever executed, and everything outside the
 * grammar is refused at PARSE with a sentence naming the token and where it
 * sits — never at run, over a row, once half a column has been computed.
 *
 * The third is the silence law: a step that cannot produce a finite number
 * produces null, and null spreads.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateFormula,
  formulaAnalysis,
  formulaColumnProblems,
  FormulaError,
  FORMULA_FUNCTIONS,
  parseFormula,
  type FormulaNode,
} from './index.js';
import type { DataRow } from './index.js';
import type { ColumnInfo } from '../data/types.js';

/** The tree of an expression that parses, or the test fails saying what it refused. */
function tree(expression: string): FormulaNode {
  const parsed = parseFormula(expression);
  if (!parsed.ok) throw new Error(`expected "${expression}" to parse, got: ${parsed.problem}`);
  return parsed.node;
}

/** One row through a formula. */
function on(expression: string, row: DataRow): number | null {
  return evaluateFormula(tree(expression), row);
}

/** The sentence a formula is refused with, or the tree it should not have produced. */
function problem(expression: string): string {
  const parsed = parseFormula(expression);
  return parsed.ok ? `PARSED: ${JSON.stringify(parsed.node)}` : parsed.problem;
}

const ROW: DataRow = { cases: 120, population: 60, zero: 0 };

// ─────────────────────────────────────────────────────────────────────────────

describe('what the grammar says', () => {
  it('reads arithmetic with the ordinary precedence, and parentheses over it', () => {
    expect(on('1 + 2 * 3', ROW)).toBe(7);
    expect(on('(1 + 2) * 3', ROW)).toBe(9);
    expect(on('10 - 2 - 3', ROW)).toBe(5); // left to right, not 11
    expect(on('100 / 5 / 2', ROW)).toBe(10);
    expect(on('2.5 * 4', ROW)).toBe(10);
    expect(on('.5 * 4', ROW)).toBe(2);
  });

  it('reads a unary minus, and a minus in front of a minus', () => {
    expect(on('-3', ROW)).toBe(-3);
    expect(on('- -3', ROW)).toBe(3);
    expect(on('4 - -3', ROW)).toBe(7);
    expect(on('-cases / 10', ROW)).toBe(-12);
  });

  it('reads a column by its bare name, and one with spaces in quotes', () => {
    expect(on('cases', ROW)).toBe(120);
    expect(on('cases / population', ROW)).toBe(2);
    expect(on('"the count" + 1', { 'the count': 41 })).toBe(42);
    const two = parseFormula('"the count" + cases');
    expect(two.ok && two.columns).toEqual(['the count', 'cases']);
  });

  it('names every column it reads, once, in first-seen order', () => {
    const parsed = parseFormula('cases / population * cases');
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.columns : []).toEqual(['cases', 'population']);
    // an expression over no column at all is a constant, and reads nothing
    const constant = parseFormula('1 + 1');
    expect(constant.ok && constant.columns).toEqual([]);
  });

  it('knows five functions and says which they are', () => {
    expect(FORMULA_FUNCTIONS).toEqual(['abs', 'log', 'max', 'min', 'round']);
    expect(on('abs(0 - 7)', ROW)).toBe(7);
    expect(on('round(2.6)', ROW)).toBe(3);
    expect(on('min(3, 9)', ROW)).toBe(3);
    expect(on('max(3, 9, 12)', ROW)).toBe(12);
    expect(on('log(1)', ROW)).toBe(0);
    expect(on('round(cases / population)', ROW)).toBe(2);
  });
});

describe('what it refuses, and where', () => {
  it('refuses a character it has no rule for, naming it and its position', () => {
    expect(problem('cases % 2')).toBe('the formula has no rule for "%" at position 7');
    expect(problem('cases > 2')).toBe('the formula has no rule for ">" at position 7');
    expect(problem('a & b')).toBe('the formula has no rule for "&" at position 3');
  });

  it('refuses an empty formula rather than reading it as nothing', () => {
    expect(problem('')).toBe("the formula is empty — write an expression over this table's number columns");
    expect(problem('   \n ')).toBe("the formula is empty — write an expression over this table's number columns");
  });

  it('refuses a number with two decimal points', () => {
    expect(problem('1.2.3')).toBe('"1.2." at position 1 is not a number — a number has one decimal point');
  });

  it('refuses a quoted name that is never closed, and an empty one', () => {
    expect(problem('1 + "the count')).toBe('the column name opened with " at position 5 is never closed');
    expect(problem('"" + 1')).toBe('the empty name at position 1 is not a column');
  });

  it('refuses an expression that stops early, and one that goes on too long', () => {
    expect(problem('cases +')).toBe('the formula stops at position 8 — something is missing at the end');
    expect(problem('cases 2')).toBe('"2" at position 7 is not part of the formula');
    expect(problem('* 2')).toBe('"*" at position 1 is not where a value can go');
    expect(problem(', 2')).toBe('"," at position 1 is not where a value can go');
    expect(problem(')')).toBe('")" at position 1 is not where a value can go');
  });

  it('refuses a parenthesis that is never closed', () => {
    expect(problem('(1 + 2')).toBe('the "(" at position 1 is never closed');
    expect(problem('(1, 2)')).toBe('the "(" at position 1 is never closed');
  });

  it('refuses a function nobody has, and lists the ones there are', () => {
    expect(problem('sqrt(9)')).toBe('there is no function named "sqrt" at position 1 — the formula knows abs, log, max, min, round');
    // the shape a person most often reaches for: a method call
    expect(problem('cases.toFixed(2)')).toBe('the formula has no rule for "." at position 6');
  });

  it('refuses a function written without its arguments', () => {
    expect(problem('abs + 1')).toBe('"abs" at position 1 is a function and needs its arguments in ( )');
    // …and a column genuinely called `abs` is still readable, in quotes
    expect(on('"abs" + 1', { abs: 41 })).toBe(42);
  });

  it('refuses the wrong number of arguments, in words', () => {
    expect(problem('abs(1, 2)')).toBe('"abs" at position 1 takes one argument, and it was given 2');
    expect(problem('min(1)')).toBe('"min" at position 1 takes two or more arguments, and it was given 1');
    expect(problem('abs(1')).toBe('the arguments of "abs" at position 1 are never closed');
  });

  it('never runs anything: the shapes a hostile string would need are all outside the grammar', () => {
    for (const hostile of [
      'constructor',
      'this.constructor("return 1")()',
      '[].constructor',
      'process.exit(1)',
      '`${1}`',
      'a; b',
      'a = 1',
      "'x'",
      'a ? b : c',
    ]) {
      const parsed = parseFormula(hostile);
      // `constructor` alone is a legal COLUMN NAME and nothing else — it parses
      // to a column reference, which reads a row's own property and can only
      // ever answer a number or null
      if (parsed.ok) {
        expect(parsed.node).toEqual({ kind: 'column', name: 'constructor' });
        expect(evaluateFormula(parsed.node, {} as DataRow)).toBeNull();
      } else {
        expect(parsed.problem.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('a silence stays a silence', () => {
  it('divides by zero into null, never Infinity', () => {
    expect(on('cases / zero', ROW)).toBeNull();
    expect(on('zero / zero', ROW)).toBeNull();
    expect(on('1 / 0', ROW)).toBeNull();
  });

  it('reads a missing, empty or non-numeric cell as null, and null spreads', () => {
    expect(on('cases + 1', {} as DataRow)).toBeNull();
    expect(on('cases + 1', { cases: null } as unknown as DataRow)).toBeNull();
    expect(on('cases + 1', { cases: 'unavailable' })).toBeNull();
    expect(on('1 + cases', { cases: 'unavailable' })).toBeNull(); // either side
    expect(on('-cases', { cases: 'unavailable' })).toBeNull();
    expect(on('abs(cases)', { cases: 'unavailable' })).toBeNull();
    expect(on('max(1, cases)', { cases: 'unavailable' })).toBeNull();
    expect(on('cases', { cases: Number.NaN })).toBeNull(); // a number that is not one
  });

  it('answers null where a function has no answer, never -Infinity or NaN', () => {
    expect(on('log(0)', ROW)).toBeNull();
    expect(on('log(0 - 1)', ROW)).toBeNull();
    expect(on('-(1 / 0)', ROW)).toBeNull();
  });

  it('overflows to null rather than Infinity', () => {
    const huge = { big: 1e308 } satisfies DataRow;
    expect(on('big * big', huge)).toBeNull();
    expect(on('-(big * big)', huge)).toBeNull();
  });
});

describe('judging a formula against the table it will read', () => {
  const columns: readonly ColumnInfo[] = [
    { name: 'cases', type: 'number' },
    { name: 'ytd', type: 'number' },
    { name: 'disease', type: 'string' },
    { name: 'week', type: 'date' },
  ];

  it('says nothing when every column it reads is a number this table has', () => {
    expect(formulaColumnProblems('cases / ytd', ['cases', 'ytd'], 'cells', columns)).toEqual([]);
  });

  it('refuses a column the table does not have, and says which numbers it does', () => {
    expect(formulaColumnProblems('cases / rate', ['cases', 'rate'], 'cells', columns)).toEqual([
      'the formula "cases / rate" reads "rate", which table "cells" does not have — the numbers it may read are cases, ytd',
    ]);
  });

  it('refuses a column the engine calls something other than a number', () => {
    expect(formulaColumnProblems('cases / disease', ['cases', 'disease'], 'cells', columns)).toEqual([
      'the formula "cases / disease" reads "disease", which table "cells" holds as string — a formula reads numbers',
    ]);
    expect(formulaColumnProblems('week + 1', ['week'], 'cells', columns)).toEqual([
      'the formula "week + 1" reads "week", which table "cells" holds as date — a formula reads numbers',
    ]);
  });

  it('says so plainly when the table has no numbers at all', () => {
    expect(formulaColumnProblems('a + 1', ['a'], 'words', [{ name: 'b', type: 'string' }])).toEqual([
      'the formula "a + 1" reads "a", which table "words" does not have — this table has no number columns',
    ]);
  });
});

describe('the analysis it becomes', () => {
  const rows: readonly DataRow[] = [
    { cases: 120, population: 60 },
    { cases: 90, population: 0 },
    { cases: 30, population: 15 },
  ];

  it('runs row-wise and writes ONE column, declared as it was asked for', async () => {
    const mod = formulaAnalysis({ expression: 'cases / population', name: 'rate' });
    expect(mod.id).toBe('formula:rate');
    expect(mod.kind).toBe('transform');
    // the read-set the def declares is the columns the expression names
    expect(mod.def.inputs).toEqual([
      { column: 'cases', role: 'value' },
      { column: 'population', role: 'value' },
    ]);
    const run = await mod.run(rows);
    expect(run.result.ok).toBe(true);
    const output = run.result.ok ? run.result.output : undefined;
    expect(output).toEqual({ as: 'columns', table: 'data', columns: { rate: { type: 'float' } } });
    // the VALUES land under the column's own name — the key `writeColumns` reads
    expect(run.snapshot?.sharedState['rate']).toEqual([2, null, 2]);
  });

  it('takes the table, the type and the id a caller names', async () => {
    const mod = formulaAnalysis({ expression: 'round(cases / 10)', name: 'tens', table: 'other', type: 'int', id: 'my-formula' });
    expect(mod.id).toBe('my-formula');
    const run = await mod.run(rows);
    expect(run.result.ok && run.result.output).toEqual({ as: 'columns', table: 'other', columns: { tens: { type: 'int' } } });
    expect(run.snapshot?.sharedState['tens']).toEqual([12, 9, 3]);
  });

  it('carries the judge, so the session can ask it before a row moves', () => {
    const mod = formulaAnalysis({ expression: 'cases / population', name: 'rate' });
    expect(mod.def.judgeTable?.('cells', [{ name: 'cases', type: 'number' }])).toEqual([
      'the formula "cases / population" reads "population", which table "cells" does not have — the numbers it may read are cases',
    ]);
  });

  it('throws rather than building an analysis over an expression that is not one', () => {
    expect(() => formulaAnalysis({ expression: 'cases %', name: 'rate' })).toThrow(FormulaError);
    try {
      formulaAnalysis({ expression: 'cases %', name: 'rate' });
    } catch (error) {
      expect(error).toBeInstanceOf(FormulaError);
      expect((error as FormulaError).problem).toBe('the formula has no rule for "%" at position 7');
      expect((error as FormulaError).name).toBe('FormulaError');
    }
  });

  it('a column named like the chart’s own keys still lands: both are derived from the name', async () => {
    // the chart's arg and held keys are `"<name> rows"` and `"<name> loaded"`,
    // strictly longer than the column — so a column called `rows` (or `loaded`)
    // is an ordinary column and not a collision with the readonly input guard
    const mod = formulaAnalysis({ expression: 'cases + 1', name: 'rows' });
    const run = await mod.run(rows);
    expect(run.snapshot?.sharedState['rows']).toEqual([121, 91, 31]);
  });
});
