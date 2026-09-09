/**
 * THE ACT, from the inside — the module a record builds.
 *
 * The session test beside this one (`../session/deriveColumn.test.ts`) is what
 * a person sees. This one holds the module to the three things only its own
 * caller can ask: which columns it folds out of the rows, what it says its
 * column's TYPE is (computed by the judge, `unknown` when nobody judged), and
 * that the absence law reaches the columnar walk and not only the row door.
 */

import { describe, expect, it } from 'vitest';
import type { DataRow } from '../analysis/index.js';
import { deriveAnalysis, deriveWords, type DerivedColumnDecl } from './index.js';

/** The demo's own shape: a row the source marked `unavailable` carries `cases = 0`. */
const ROWS = [
  { id: 'a', report_state: 'present', cases: 120, population: 60, report_date: '2026-01-04' },
  { id: 'b', report_state: 'unavailable', cases: 0, population: 1000, report_date: '2026-01-05' },
  { id: 'c', report_state: 'present', cases: 30, population: 15, report_date: '2026-01-06' },
] as unknown as DataRow[];

const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] } as const;

const RATE: DerivedColumnDecl = { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { col: 'population' }] } };

/** The values one act computed, off the finished run's own snapshot. */
async function valuesOf(mod: ReturnType<typeof deriveAnalysis>, rows: readonly DataRow[] = ROWS): Promise<unknown> {
  const run = await mod.run(rows);
  return run.snapshot?.sharedState['rate'];
}

describe('the module a derive record builds', () => {
  it('takes a table-scoped id by default, so two tables deriving `rate` are two acts', () => {
    expect(deriveAnalysis({ name: 'rate', column: RATE, table: 'cells' }).id).toBe('derive:cells:rate');
    expect(deriveAnalysis({ name: 'rate', column: RATE }).id).toBe('derive:data:rate');
    expect(deriveAnalysis({ name: 'rate', column: RATE, id: 'mine' }).id).toBe('mine');
  });

  it('declares the columns the tree reads, once each, and nothing else', () => {
    const twice: DerivedColumnDecl = {
      ops: 1,
      kind: 'row',
      expr: { op: 'add', args: [{ col: 'cases' }, { op: 'mul', args: [{ col: 'cases' }, { lit: 2 }] }] },
    };
    expect(deriveAnalysis({ name: 'rate', column: twice }).def.inputs).toEqual([{ column: 'cases', role: 'value' }]);
  });

  it('reads no column out of a tree that names none, and none out of a node with no arguments', () => {
    const flat: DerivedColumnDecl = { ops: 1, kind: 'row', expr: { lit: 7 } };
    expect(deriveAnalysis({ name: 'rate', column: flat }).def.inputs).toEqual([]);
    // A record the judge never saw — the shape a tampered log could carry. The
    // reader is total over it; the judge is what refuses it.
    const broken = { ops: 1, kind: 'row', expr: { op: 'add' } } as unknown as DerivedColumnDecl;
    expect(deriveAnalysis({ name: 'rate', column: broken }).def.inputs).toEqual([]);
  });

  it('walks a shared node once and keeps no stack of its own — it runs BEFORE the judge, so the trees the judge refuses may not hang it', () => {
    const inputsOf = (column: unknown): unknown => deriveAnalysis({ name: 'rate', column: column as DerivedColumnDecl }).def.inputs;
    // Forty shared objects: a walk that visited a node once per REFERENCE would make 2^40 calls
    // collecting the one name, and hang before `judgeTable` could say either ceiling's sentence.
    let shared: unknown = { col: 'cases' };
    for (let at = 0; at < 40; at += 1) shared = { op: 'add', args: [shared, shared] };
    expect(inputsOf({ ops: 1, kind: 'row', expr: shared })).toEqual([{ column: 'cases', role: 'value' }]);
    // And a chain deeper than the JS stack is a list, not a RangeError — the judge owns that sentence too.
    let deep: unknown = { col: 'cases' };
    for (let at = 0; at < 20_000; at += 1) deep = { op: 'add', args: [deep, { col: 'population' }] };
    expect(inputsOf({ ops: 1, kind: 'row', expr: deep })).toEqual([
      { column: 'cases', role: 'value' },
      { column: 'population', role: 'value' },
    ]);
  });

  it('is total over every unjudged shape a log could carry — the judge owns the sentence, so the reader never throws ahead of it', () => {
    const inputsOf = (column: unknown): unknown => deriveAnalysis({ name: 'rate', column: column as DerivedColumnDecl }).def.inputs;
    // an argument that is not a node, a column not named with a string, a null arm
    expect(inputsOf({ ops: 1, kind: 'row', expr: { op: 'add', args: [{ col: 'cases' }, 2] } })).toEqual([{ column: 'cases', role: 'value' }]);
    expect(inputsOf({ ops: 1, kind: 'row', expr: { op: 'add', args: [null, { col: 'cases' }] } })).toEqual([{ column: 'cases', role: 'value' }]);
    expect(inputsOf({ ops: 1, kind: 'row', expr: { col: 5 } })).toEqual([]);
    // a group with no groupBy, a groupBy that is a string (never its letters), one holding a non-name, a null group
    expect(inputsOf({ ops: 1, kind: 'aggregate', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: {} })).toEqual([{ column: 'cases', role: 'value' }]);
    expect(inputsOf({ ops: 1, kind: 'aggregate', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: { groupBy: 'disease' } })).toEqual([{ column: 'cases', role: 'value' }]);
    expect(inputsOf({ ops: 1, kind: 'aggregate', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: { groupBy: ['disease', 7] } })).toEqual([
      { column: 'cases', role: 'value' },
      { column: 'disease', role: 'group' },
    ]);
    expect(inputsOf({ ops: 1, kind: 'aggregate', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: null })).toEqual([{ column: 'cases', role: 'value' }]);
  });

  it('says its refusals belong to the derive taxonomy', () => {
    expect(deriveAnalysis({ name: 'rate', column: RATE }).def.refusalTaxonomy).toBe('derive');
  });
});

describe('the absence law reaches the columnar walk', () => {
  it('is absent on a row the table says is not present — never the reported zero', async () => {
    const mod = deriveAnalysis({ name: 'rate', column: RATE, absence: ABSENCE });
    expect(await valuesOf(mod)).toEqual([2, null, 2]);
    // …and the absence column is DECLARED as read, with no role: it is the sole cause of every blank, so a
    // read-set that left it out could not name the cause of one
    expect(mod.def.inputs).toEqual([{ column: 'cases', role: 'value' }, { column: 'population', role: 'value' }, { column: 'report_state' }]);
  });

  it('and without the declaration the same rows give the zero — so it is the DECL that does it', async () => {
    const mod = deriveAnalysis({ name: 'rate', column: RATE });
    expect(await valuesOf(mod)).toEqual([2, 0, 2]);
  });

  it('lets the absence column speak for itself, so a test on the state stays honest', async () => {
    const said: DerivedColumnDecl = { ops: 1, kind: 'row', expr: { op: 'eq', args: [{ col: 'report_state' }, { lit: 'unavailable' }] } };
    const mod = deriveAnalysis({ name: 'rate', column: said, absence: ABSENCE });
    expect(await valuesOf(mod)).toEqual([false, true, false]);
  });

  it('folds the absence column out of the rows even when the tree never names it — and does not fold it twice when it does', async () => {
    const both: DerivedColumnDecl = {
      ops: 1,
      kind: 'row',
      expr: { op: 'if', args: [{ op: 'eq', args: [{ col: 'report_state' }, { lit: 'present' }] }, { col: 'cases' }, { lit: 0 }] },
    };
    const mod = deriveAnalysis({ name: 'rate', column: both, absence: ABSENCE });
    // the `unavailable` row's condition is answerable (the state speaks for
    // itself) but its `cases` is not — the arm it picked is the zero literal
    expect(await valuesOf(mod)).toEqual([120, 0, 30]);
    expect(mod.def.inputs).toEqual([{ column: 'report_state', role: 'value' }, { column: 'cases', role: 'value' }]);
  });
});

describe('the type is computed, never tallied', () => {
  const columns = [
    { name: 'id', type: 'string' as const },
    { name: 'report_state', type: 'string' as const },
    { name: 'cases', type: 'number' as const },
    { name: 'population', type: 'number' as const },
    { name: 'report_date', type: 'date' as const },
  ];

  /** Judge it the way the session does, then run it, and read what it says its column is. */
  async function typeOf(column: DerivedColumnDecl): Promise<unknown> {
    const mod = deriveAnalysis({ name: 'rate', column });
    expect(mod.def.judgeTable!('data', columns)).toEqual([]);
    const run = await mod.run(ROWS);
    return run.result.ok && run.result.output.columns['rate']?.type;
  }

  it('lands a number as float, a string as string, a truth as boolean and a date as date', async () => {
    expect(await typeOf(RATE)).toBe('float');
    expect(await typeOf({ ops: 1, kind: 'row', expr: { op: 'lower', args: [{ col: 'id' }] } })).toBe('string');
    expect(await typeOf({ ops: 1, kind: 'row', expr: { op: 'gt', args: [{ col: 'cases' }, { lit: 50 }] } })).toBe('boolean');
    expect(await typeOf({ ops: 1, kind: 'row', expr: { op: 'dateTrunc', args: [{ col: 'report_date' }, { lit: 'month' }] } })).toBe('date');
  });

  it('says `unknown` when nobody judged it — a replay re-performs an act, it does not re-decide it', async () => {
    const mod = deriveAnalysis({ name: 'rate', column: RATE });
    const run = await mod.run(ROWS);
    expect(run.result.ok && run.result.output).toEqual({ as: 'columns', table: 'data', columns: { rate: { type: 'unknown' } } });
  });

  it('refuses an absence column the table does not have — the one column the tree never names, and the one that would blank every row', () => {
    const mod = deriveAnalysis({ name: 'rate', column: RATE, absence: { field: 'reportState', states: ['present', 'unknown'] } });
    expect(mod.def.judgeTable!('data', columns)).toEqual([
      'this column keeps the absence law of "reportState", which table "data" does not have — it has id, report_state, cases, population, report_date',
    ]);
    // judged AFTER the tree, so a tree that reads nothing meets it on a table that has nothing
    const bare = deriveAnalysis({ name: 'rate', column: { ops: 1, kind: 'row', expr: { lit: 7 } }, absence: { field: 'reportState', states: ['present', 'unknown'] } });
    expect(bare.def.judgeTable!('data', [])).toEqual(['this column keeps the absence law of "reportState", which table "data" does not have — that table has no columns']);
    expect(deriveAnalysis({ name: 'rate', column: RATE, absence: ABSENCE }).def.judgeTable!('data', columns)).toEqual([]);
  });

  it('refuses to RUN a declaration written against another vocabulary — a replay re-performs without judging, and this is the door it walks through', async () => {
    const mod = deriveAnalysis({ name: 'rate', column: { ...RATE, ops: 2 } });
    await expect(mod.run(ROWS)).rejects.toThrow('this column is written against ops 2, and this build knows ops 1');
  });

  it('keeps the judge’s refusal as the one sentence, and computes no type from it', () => {
    const mod = deriveAnalysis({ name: 'rate', column: { ops: 1, kind: 'row', expr: { op: 'div', args: [{ col: 'cases' }, { col: 'nope' }] } } });
    expect(mod.def.judgeTable!('data', columns)).toEqual(['this column reads "nope", which table "data" does not have — it has id, report_state, cases, population, report_date']);
  });
});

describe('the sentence a caption quotes', () => {
  it('comes from the op table, through the same door that lands the column', () => {
    expect(deriveWords(RATE)).toBe('cases divided by population');
    expect(deriveWords({ ops: 1, kind: 'row', expr: { op: 'week', args: [{ col: 'report_date' }], calendar: 'mmwr' } })).toBe('the week of report_date on the mmwr calendar');
  });
});

/**
 * A GROUPED column, through the same act. The columnar walk and the row walk
 * have to agree about a group as well as about a row, so the fold is asked for
 * one here and the answer is the same one `../derive/groups.test.ts` gets from
 * a list of rows.
 */
describe('the act, over a group', () => {
  const GROUPED = [
    { id: 'a', kind: 'state', disease: 'Pertussis', cases: 10, report_state: 'present' },
    { id: 'b', kind: 'state', disease: 'Pertussis', cases: 30, report_state: 'present' },
    { id: 'c', kind: 'region', disease: 'Pertussis', cases: 40, report_state: 'present' },
    { id: 'd', kind: 'state', disease: 'Measles', cases: 5, report_state: 'present' },
  ] as unknown as DataRow[];

  const SHARE: DerivedColumnDecl = {
    ops: 1,
    kind: 'row',
    expr: { op: 'div', args: [{ col: 'cases' }, { op: 'sum', args: [{ col: 'cases' }] }] },
    over: { groupBy: ['disease'], where: { op: 'eq', args: [{ col: 'kind' }, { lit: 'state' }] } },
  };

  it('folds out the grouping column and the filter’s column beside the tree’s own', () => {
    const mod = deriveAnalysis({ name: 'rate', column: SHARE, table: 'cells' });
    expect(mod.def.inputs).toEqual([
      { column: 'cases', role: 'value' },
      { column: 'disease', role: 'group' },
      { column: 'kind', role: 'value' },
    ]);
  });

  it('names a column the tree AND the group read exactly once, and needs no filter to be grouped', () => {
    const byDisease: DerivedColumnDecl = {
      ops: 1,
      kind: 'row',
      expr: { op: 'concat', args: [{ col: 'disease' }, { op: 'cast', args: [{ op: 'count', args: [{ col: 'cases' }] }, { lit: 'string' }] }] },
      over: { groupBy: ['disease'] },
    };
    expect(deriveAnalysis({ name: 'rate', column: byDisease, table: 'cells' }).def.inputs).toEqual([
      { column: 'disease', role: 'group' },
      { column: 'cases', role: 'value' },
    ]);
  });

  it('computes a share of each group’s total, and the roll-up row still gets its group’s answer', async () => {
    const mod = deriveAnalysis({ name: 'rate', column: SHARE, table: 'cells' });
    const run = await mod.run(GROUPED);
    expect(run.snapshot?.sharedState['rate']).toEqual([10 / 40, 30 / 40, 40 / 40, 5 / 5]);
  });

  it('keeps the absence law over a group: a row the table does not call present is in no group', async () => {
    const silent = [...GROUPED, { id: 'e', kind: 'state', disease: 'Measles', cases: 0, report_state: 'unavailable' }] as unknown as DataRow[];
    const mod = deriveAnalysis({ name: 'rate', column: SHARE, table: 'cells', absence: ABSENCE });
    const run = await mod.run(silent);
    expect(run.snapshot?.sharedState['rate']).toEqual([10 / 40, 30 / 40, 40 / 40, 5 / 5, null]);
  });

  it('says the group out loud, so a caption cannot print half of what ran', () => {
    // the group clause is set off by a comma: glued on with a space it would read as a modifier of `cases`
    expect(deriveWords(SHARE)).toBe('cases divided by (the total of cases), over each disease, counting only rows where kind is "state"');
    expect(deriveWords({ ...SHARE, over: { groupBy: [] } })).toBe('cases divided by (the total of cases), over the whole table');
    expect(deriveWords({ ...SHARE, over: { groupBy: ['disease', 'kind'] } })).toMatch(/over each disease and kind$/);
    expect(deriveWords(RATE)).toBe('cases divided by population');
  });
});
