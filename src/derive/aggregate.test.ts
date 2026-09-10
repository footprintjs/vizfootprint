/**
 * THE AGGREGATE, from the inside — the module a record builds.
 *
 * What a person sees (the table at the cursor, the minted relation, the three
 * outcomes through the session) is the session's test. This one holds the
 * module to what only its own caller can ask: what it folds out of the rows,
 * what its judge refuses and in which words, the schema it computes, and that
 * one row per group is what lands — an EMPTY table included.
 */

import { describe, expect, it } from 'vitest';
import type { ColumnInfo } from '../data/index.js';
import type { DataRow } from '../analysis/index.js';
import { aggregateAnalysis, aggregateWords, OPS_VERSION, type AggregateOptions, type Expr, type Measure } from './index.js';

/** The demo's own shape: a row the source marked `unavailable` carries no cases. */
const ROWS = [
  { id: 'a', region: 'north', kind: 'state', report_state: 'present', cases: 120, population: 60 },
  { id: 'b', region: 'north', kind: 'state', report_state: 'unavailable', cases: null, population: 1000 },
  { id: 'c', region: 'south', kind: 'state', report_state: 'present', cases: 30, population: 15 },
  { id: 'd', region: 'south', kind: 'state', report_state: 'present', cases: 45, population: 20 },
  { id: 'e', region: 'south', kind: 'region', report_state: 'present', cases: 75, population: 35 },
] as unknown as DataRow[];

const COLUMNS: readonly ColumnInfo[] = [
  { name: 'id', type: 'string' },
  { name: 'region', type: 'string' },
  { name: 'kind', type: 'string' },
  { name: 'report_state', type: 'string' },
  { name: 'cases', type: 'number' },
  { name: 'population', type: 'number' },
  { name: 'blank', type: 'unknown' },
];

const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] } as const;

const col = (name: string): Expr => ({ col: name });
const lit = (value: number | string | boolean | null): Expr => ({ lit: value });
const op = (name: Expr extends { op?: infer O } ? Exclude<O, undefined> : never, ...args: Expr[]): Expr => ({ op: name, args });
const sum = (name: string): Expr => op('sum', col(name));
const measure = (as: string, expr: Expr): Measure => ({ as, expr });

const TOTAL = measure('total', sum('cases'));
const STATES = op('eq', col('kind'), lit('state'));

const declared = (over: Partial<AggregateOptions> = {}): AggregateOptions => ({ name: 'by_region', table: 'cells', ops: OPS_VERSION, groupBy: ['region'], measures: [TOTAL], ...over });

const problemsOf = (over: Partial<AggregateOptions> = {}, columns: readonly ColumnInfo[] = COLUMNS): readonly string[] =>
  aggregateAnalysis(declared(over)).def.judgeTable!('cells', columns);

/** The table one act landed, off the finished run's own output. */
async function landed(mod: ReturnType<typeof aggregateAnalysis>, rows: readonly DataRow[] = ROWS): Promise<{ readonly schema: unknown; readonly rows: unknown }> {
  const run = await mod.run(rows);
  if (!run.result.ok) throw new Error(`did not land: ${run.result.reason}`);
  return { schema: run.result.output.schema, rows: run.result.output.rows };
}

describe('the module an aggregate record builds', () => {
  it('takes a table-scoped id by default, produces a table, reads no second table, and files under the derive taxonomy', () => {
    const mod = aggregateAnalysis(declared());
    expect(mod.id).toBe('aggregate:cells:by_region');
    expect(aggregateAnalysis(declared({ table: undefined })).id).toBe('aggregate:data:by_region');
    expect(aggregateAnalysis(declared({ id: 'mine' })).id).toBe('mine');
    expect(mod.def.produces).toBe('table');
    expect(mod.def.reads).toBeUndefined();
    expect(mod.def.refusalTaxonomy).toBe('derive');
  });

  it('declares what it reads — the group columns as groups, the rest as values, the absence column with no role, each once', () => {
    const mod = aggregateAnalysis(declared({ measures: [TOTAL, measure('n', op('count', col('cases')))], where: STATES, absence: ABSENCE }));
    expect(mod.def.inputs).toEqual([
      { column: 'region', role: 'group' },
      { column: 'cases', role: 'value' },
      { column: 'kind', role: 'value' },
      { column: 'report_state' },
    ]);
    // …and not twice when a measure already reads the absence column
    const reads = aggregateAnalysis(declared({ measures: [measure('n', op('count', col('report_state')))], absence: ABSENCE })).def.inputs;
    expect(reads).toEqual([
      { column: 'region', role: 'group' },
      { column: 'report_state', role: 'value' },
    ]);
  });
});

describe('the judge — every problem at once, each a sentence, before anything moves', () => {
  it('accepts the plainest aggregate', () => {
    expect(problemsOf()).toEqual([]);
  });

  it('refuses a group column the table lacks, one it holds as unknown, and one named twice — in the aggregate’s own words', () => {
    expect(problemsOf({ groupBy: ['ghost'] })).toEqual(['this aggregate groups by "ghost", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank']);
    expect(problemsOf({ groupBy: ['blank'] })).toEqual(['this aggregate groups by "blank", which table "cells" holds as unknown — a table groups by columns whose type is known']);
    expect(problemsOf({ groupBy: ['region', 'region'] })).toEqual(['this aggregate groups by "region" twice, and a table can only group by it once']);
    // …and against a table with no columns at all, the measure has nothing to read either — both are said
    expect(problemsOf({ groupBy: ['ghost'] }, [])).toEqual([
      'this aggregate groups by "ghost", which table "cells" does not have — that table has no columns',
      'measure "total": this column reads "cases", which table "cells" does not have — that table has no columns',
    ]);
  });

  it('refuses a measure column the table lacks, naming the measure', () => {
    expect(problemsOf({ measures: [measure('total', sum('deaths'))] })).toEqual(['measure "total": this column reads "deaths", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank']);
  });

  it('refuses a measure that is not an aggregate — one reading a non-group column outside its reducers, one holding no reducer', () => {
    expect(problemsOf({ measures: [measure('share', op('div', col('cases'), sum('cases')))] })).toEqual([
      'measure "share": this column says it is an aggregate, and it reads "cases" outside its reducers — a column that changes within its own group is a row column',
    ]);
    expect(problemsOf({ measures: [measure('plain', col('cases'))] })).toEqual([
      'measure "plain": this column names a group and holds no reducer, so the group would fold nothing — a group is the rows a reducer runs over',
    ]);
  });

  it('refuses a measure with no name, one wearing a group column’s name, and two under one name', () => {
    expect(problemsOf({ measures: [measure('', sum('cases'))] })).toEqual(['a measure lands as a column, so it needs a name — and this one is ""']);
    expect(problemsOf({ measures: [measure('region', sum('cases'))] })).toEqual(['the measure "region" takes the name of a group column — the derived table already has a column called that']);
    expect(problemsOf({ measures: [TOTAL, measure('total', sum('population'))] })).toEqual(['two measures are called "total", and the derived table can only hold one column of that name']);
  });

  it('refuses a filter that is not a boolean, and the absence column the table does not have — the filter under the key the RECORD spells it with', () => {
    expect(problemsOf({ where: col('cases') })).toEqual([
      'where says which rows the reducer runs over, so it must come to a boolean, and this one comes to a number',
    ]);
    expect(problemsOf({ absence: { field: 'state', states: ['present', 'unknown'] } })).toEqual([
      'this aggregate keeps the absence law of "state", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
    ]);
    // …a state column the table DOES have earns no sentence
    expect(problemsOf({ absence: ABSENCE })).toEqual([]);
    // …and EVERY entry of a list is judged on its own: the one that misses says which
    expect(problemsOf({ absence: [{ field: 'report_state', states: ['present', 'unknown'], governs: ['cases'] }, { field: 'state', states: ['present', 'unknown'], governs: ['population'] }] })).toEqual([
      'this aggregate keeps the absence law of "state", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
    ]);
  });

  it('says everything at once, so a person fixes the declaration in one pass — and a broken group is said once, not once per measure', () => {
    expect(problemsOf({ groupBy: ['ghost'], measures: [measure('', sum('deaths'))] })).toEqual([
      'this aggregate groups by "ghost", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
      'a measure lands as a column, so it needs a name — and this one is ""',
      'measure "": this column reads "deaths", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
    ]);
    expect(problemsOf({ groupBy: ['region', 'region', 'ghost'], measures: [TOTAL, measure('n', op('count', col('kind')))] })).toHaveLength(2);
  });

  it('says a broken FILTER once, not once per measure — the filter is the act’s, and no measure is blamed for it', () => {
    const three = [TOTAL, measure('n', op('count', col('cases'))), measure('peak', op('max', col('cases')))];
    // The filter reads a column the table lacks: ONE sentence, under `where`, however many measures there are.
    expect(problemsOf({ where: op('eq', col('ghost'), lit('state')), measures: three })).toEqual([
      'where reads "ghost", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
    ]);
    // A reducer in the filter is refused under the record's own key, once.
    expect(problemsOf({ where: op('gt', sum('cases'), lit(0)), measures: three })).toEqual([
      'the op "sum" folds many rows into one answer, and where picks the rows a group is made of, so it cannot itself ask what a group came to',
    ]);
    // And a broken filter does not silence the measures' OWN problems.
    expect(problemsOf({ where: col('cases'), measures: [measure('total', sum('deaths'))] })).toEqual([
      'where says which rows the reducer runs over, so it must come to a boolean, and this one comes to a number',
      'measure "total": this column reads "deaths", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
    ]);
  });

  it('a sound filter says nothing, and still cuts the rows — it is judged on its own line, never as part of a measure', () => {
    expect(problemsOf({ where: STATES, measures: [TOTAL] })).toEqual([]);
  });
});

describe('what lands — one row per group, cut from the rows it is handed', () => {
  it('lands one row per group in first-seen order, the group column then the measures, with the schema the judge computed', async () => {
    const mod = aggregateAnalysis(declared({ measures: [TOTAL, measure('n', op('count', col('cases'))), measure('kinds', op('countDistinct', col('kind')))] }));
    expect(mod.def.judgeTable!('cells', COLUMNS)).toEqual([]);
    expect(await landed(mod)).toEqual({
      schema: { region: 'string', total: 'float', n: 'float', kinds: 'float' },
      rows: [
        { region: 'north', total: 120, n: 1, kinds: 1 },
        { region: 'south', total: 150, n: 3, kinds: 2 },
      ],
    });
  });

  it('keeps the absence law: a row the table calls unavailable is in no group and adds nothing', async () => {
    const mod = aggregateAnalysis(declared({ measures: [measure('n', op('count', col('region')))], absence: ABSENCE }));
    expect(await landed(mod)).toMatchObject({ rows: [{ region: 'north', n: 1 }, { region: 'south', n: 3 }] });
    // …and without the law, the unavailable row counts as a row
    expect(await landed(aggregateAnalysis(declared({ measures: [measure('n', op('count', col('region')))] })))).toMatchObject({ rows: [{ region: 'north', n: 2 }, { region: 'south', n: 3 }] });
  });

  it('says the act’s own op version ONCE, in the aggregate’s own words — never once per measure, and even with no measures', () => {
    // `ops` belongs to the ACT: three measures said it three times, each blaming a measure for a fact
    // no measure owns, and an aggregate with none said it nowhere and threw out of `build` instead.
    const three = [TOTAL, measure('n', op('count', col('cases'))), measure('most', op('max', col('cases')))];
    expect(problemsOf({ ops: 2, measures: three })).toEqual(['this aggregate is written against ops 2, and this build knows ops 1']);
    expect(problemsOf({ ops: 2, measures: [] })).toEqual(['this aggregate is written against ops 2, and this build knows ops 1']);
  });

  it('refuses an aggregate that declares no measure — a table of group columns is the group column', () => {
    expect(problemsOf({ measures: [] })).toEqual(['an aggregate lands one column per measure, and this one declares none']);
  });

  it('says a missing group column once, even when it is also named twice', () => {
    // A repeat is the SAME column: judging it again would say one sentence twice and read as two columns.
    expect(problemsOf({ groupBy: ['ghost', 'ghost'] })).toEqual([
      'this aggregate groups by "ghost", which table "cells" does not have — it has id, region, kind, report_state, cases, population, blank',
      'this aggregate groups by "ghost" twice, and a table can only group by it once',
    ]);
  });

  it('lands the grand total as ONE row even when nothing folded in — `groupBy: []` is a group the declaration names', async () => {
    const mod = aggregateAnalysis(declared({ groupBy: [], measures: [measure('n', op('count', col('cases'))), TOTAL], where: lit(false) }));
    expect(await landed(mod)).toMatchObject({ rows: [{ n: 0, total: null }] });
    expect(await landed(mod, [])).toMatchObject({ rows: [{ n: 0, total: null }] });
  });

  it('`where` picks the rows that go in, and a group none of whose rows went in is not a row', async () => {
    const mod = aggregateAnalysis(declared({ where: STATES }));
    expect(await landed(mod)).toMatchObject({ rows: [{ region: 'north', total: 120 }, { region: 'south', total: 75 }] });
    const onlyRegions = aggregateAnalysis(declared({ where: op('eq', col('kind'), lit('region')) }));
    expect(await landed(onlyRegions)).toMatchObject({ rows: [{ region: 'south', total: 75 }] });
  });

  it('EMPTY lands: a filter that picks no row is a table of zero rows under ok, never a degenerate flag', async () => {
    const mod = aggregateAnalysis(declared({ where: lit(false) }));
    expect(await landed(mod)).toMatchObject({ rows: [] });
    expect(await landed(mod, [])).toMatchObject({ rows: [] });
  });

  it('the whole table as one row, said out loud with `groupBy: []`', async () => {
    const mod = aggregateAnalysis(declared({ groupBy: [], measures: [TOTAL, measure('mean', op('mean', col('population')))] }));
    expect(mod.def.judgeTable!('cells', COLUMNS)).toEqual([]);
    expect(await landed(mod)).toEqual({ schema: { total: 'float', mean: 'float' }, rows: [{ total: 270, mean: 226 }] });
  });

  it('a measure may read its group column outside a reducer — it answers from the group’s key', async () => {
    const label = op('concat', col('region'), lit(' x'), op('cast', op('count', col('cases')), lit('string')));
    const mod = aggregateAnalysis(declared({ groupBy: ['region', 'kind'], measures: [measure('label', label), measure('smallest', op('min', col('region')))] }));
    expect(mod.def.judgeTable!('cells', COLUMNS)).toEqual([]);
    expect(await landed(mod)).toEqual({
      schema: { region: 'string', kind: 'string', label: 'string', smallest: 'string' },
      rows: [
        { region: 'north', kind: 'state', label: 'north x1', smallest: 'north' },
        { region: 'south', kind: 'state', label: 'south x2', smallest: 'south' },
        { region: 'south', kind: 'region', label: 'south x1', smallest: 'south' },
      ],
    });
  });

  it('a replay that nobody judged carries its rows and says `unknown` for every column’s type', async () => {
    expect(await landed(aggregateAnalysis(declared()))).toEqual({
      schema: { region: 'unknown', total: 'unknown' },
      rows: [
        { region: 'north', total: 120 },
        { region: 'south', total: 150 },
      ],
    });
  });

  it('refuses at build a record written against another op vocabulary — the one door a replay walks through', async () => {
    const mod = aggregateAnalysis(declared({ ops: 2 }));
    await expect(mod.run(ROWS)).rejects.toThrow('this aggregate is written against ops 2, and this build knows ops 1');
  });
});

describe('the why-sentence', () => {
  it('says each measure in the table’s own words, then the group and its filter', () => {
    expect(aggregateWords({ groupBy: ['region'], measures: [TOTAL, measure('n', op('count', col('cases')))], where: STATES })).toBe(
      'total = the total of cases; n = how many rows have cases, over each region, counting only rows where kind is "state"',
    );
    expect(aggregateWords({ groupBy: [], measures: [TOTAL] })).toBe('total = the total of cases, over the whole table');
  });
});
