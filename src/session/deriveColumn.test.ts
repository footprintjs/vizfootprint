/**
 * A DECLARED COLUMN, from the outside — what a person who added one sees.
 *
 * The tree is new; the act is not. A declared column lands through `analyze`,
 * like every other analysis, because there are ten verbs and it needs none of
 * the missing ones: it reads one table, produces the columns channel, lands one
 * commit whose value carries the whole declaration, and re-enters the data
 * space as an ordinary filterable column at the act's own slot. This file is
 * the proof that no new mechanism was added — and that four things now hold
 * that did not: the absence law reaches the arithmetic, a calendar is part of
 * the declaration, a refusal about a column says `derive-*` rather than
 * `guard-failed`, and a replay rebuilds the column from bytes alone.
 *
 * The laws it pins live in three folders: the grammar and its refusals
 * (`../derive/README.md`), a derived column belongs to the act that made it
 * (`../data/README.md`), and judge-before-anything-moves (`./README.md`, law 1).
 */

import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { DataRow } from '../analysis/index.js';
import type { DerivedColumnDecl, Expr } from '../derive/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

/**
 * The demo's own shape, four rows.
 *
 * Row `b` is the one the whole absence law was written for: the source could
 * not report it, so `report_state` says `unavailable` and `cases` carries the
 * reported nothing as `0`. `cases / population` must be absent there.
 */
const ROWS = [
  { id: 'a', region: 'north', report_state: 'present', cases: 120, population: 60, report_date: '2026-01-04' },
  { id: 'b', region: 'north', report_state: 'unavailable', cases: 0, population: 1000, report_date: '2026-01-05' },
  { id: 'c', region: 'south', report_state: 'present', cases: 30, population: 15, report_date: '2026-01-06' },
  { id: 'd', region: 'south', report_state: 'present', cases: 45, population: 9, report_date: '2026-12-31' },
] as unknown as DataRow[];

const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] };

const tree = (expr: Expr): DerivedColumnDecl => ({ ops: 1, kind: 'row', expr });

/** `cases / population` — the design's own motivating column. */
const RATE = tree({ op: 'div', args: [{ col: 'cases' }, { col: 'population' }] });

function defWith(analyses: DashboardDef['analyses'], opts: { readonly absence?: boolean; readonly engine?: 'wasm' } = {}): DashboardDef {
  return {
    data: {
      cells: {
        rows: [...ROWS],
        ...(opts.absence === false ? {} : { absence: ABSENCE }),
        ...(opts.engine !== undefined ? { engine: opts.engine } : {}),
      },
    },
    actors: { grid: { actor: 'user', label: 'The grid' } },
    ...(analyses !== undefined ? { analyses } : {}),
    defaultTable: 'cells',
  };
}

type Session = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;

/** One column's values at the cursor, or the sentence the read was refused with. */
async function read(s: Session, column: string): Promise<unknown[]> {
  const res = await s.viewQuery({ columns: ['id', column], limit: 40 });
  return res.ok ? res.rows.map((r) => r[column]) : [`REFUSED: ${res.rejected}`];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('a declared column lands, as an act', () => {
  it('runs row-wise and reads back under the name it was given', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE } })).createSession();
    const made = await s.declareAnalysis('rate', { cause });

    expect(made.materialized).toEqual(['rate']);
    expect(made.gap).toBeUndefined();
    expect(made.commit?.viewId).toBe('analysis:rate');
    expect(await read(s, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('carries the whole declaration on the commit, so the act can be performed again from bytes', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE } })).createSession();
    const made = await s.declareAnalysis('rate', { cause });
    expect(made.commit?.value).toEqual({
      id: 'rate',
      table: 'cells',
      def: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE, id: 'rate' },
    });
    // and the value is JSON, all the way down — no closure, no expression string
    expect(JSON.parse(JSON.stringify(made.commit!.value))).toEqual(made.commit!.value);
  });

  it('lands through the dispatch door with a record the act brought itself', async () => {
    const s = buildDashboard(defWith(undefined)).createSession();
    const res = await s.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE }, cause });
    expect(res.ok).toBe(true);
    expect(res.ok && res.analysis?.materialized).toEqual(['rate']);
    expect(await read(s, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('says its type in the vocabulary the op table computed — not one tallied from the values', async () => {
    const s = buildDashboard(
      defWith({
        rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE },
        big: { builtin: 'derive', table: 'cells', name: 'big', column: tree({ op: 'gt', args: [{ col: 'cases' }, { lit: 50 }] }) },
        loud: { builtin: 'derive', table: 'cells', name: 'loud', column: tree({ op: 'upper', args: [{ col: 'region' }] }) },
        month: { builtin: 'derive', table: 'cells', name: 'month', column: tree({ op: 'dateTrunc', args: [{ op: 'cast', args: [{ col: 'report_date' }, { lit: 'date' }] }, { lit: 'month' }] }) },
      }),
    ).createSession();
    const of = async (id: string): Promise<unknown> => {
      const made = await s.declareAnalysis(id, { cause });
      return made.result.ok && made.result.output.as === 'columns' && made.result.output.columns[id]?.type;
    };
    expect(await of('rate')).toBe('float');
    expect(await of('big')).toBe('boolean');
    expect(await of('loud')).toBe('string');
    expect(await of('month')).toBe('date');
    expect(await read(s, 'big')).toEqual([true, null, false, false]);
    expect(await read(s, 'loud')).toEqual(['NORTH', null, 'SOUTH', 'SOUTH']);
    expect(await read(s, 'month')).toEqual(['2026-01-01', null, '2026-01-01', '2026-12-01']);
  });

  it('reads a column an earlier act derived, judged against what that act actually left', async () => {
    const s = buildDashboard(
      defWith({
        rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE },
        per100k: { builtin: 'derive', table: 'cells', name: 'per100k', column: tree({ op: 'mul', args: [{ col: 'rate' }, { lit: 100000 }] }) },
      }),
    ).createSession();
    await s.declareAnalysis('rate', { cause });
    const second = await s.declareAnalysis('per100k', { cause });
    expect(second.materialized).toEqual(['per100k']);
    expect(await read(s, 'per100k')).toEqual([200000, null, 200000, 500000]);
  });

  it('…and refuses the same declaration where that act has not happened — the cursor is the answer', async () => {
    const s = buildDashboard(
      defWith({
        loud: { builtin: 'derive', table: 'cells', name: 'loud', column: tree({ op: 'upper', args: [{ col: 'region' }] }) },
        rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE },
        per100k: { builtin: 'derive', table: 'cells', name: 'per100k', column: tree({ op: 'mul', args: [{ col: 'rate' }, { lit: 100000 }] }) },
      }),
    ).createSession();
    // one act first, so there is a position to stand at that is BEFORE `rate`
    const before = await s.declareAnalysis('loud', { cause });
    await s.declareAnalysis('rate', { cause });
    s.seek(before.commit!.id);
    const second = await s.declareAnalysis('per100k', { cause });
    expect(second.commit).toBeUndefined();
    expect(second.gap).toMatchObject({ code: 'derive-invalid', op: 'declareAnalysis', target: 'per100k' });
    expect(second.gap?.detail).toContain('this column reads "rate", which table "cells" does not have');
  });
});

describe('the absence law, end to end', () => {
  it('is absent on a row the table says is not present — never the reported zero', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE } })).createSession();
    await s.declareAnalysis('rate', { cause });
    expect(await read(s, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('and the same rows on a table declaring no absence column give the zero — the DECL is what does it', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE } }, { absence: false })).createSession();
    await s.declareAnalysis('rate', { cause });
    expect(await read(s, 'rate')).toEqual([2, 0, 2, 5]);
  });

  it('leaves the absence column itself readable, so a column ABOUT the silence stays honest', async () => {
    const s = buildDashboard(
      defWith({ gone: { builtin: 'derive', table: 'cells', name: 'gone', column: tree({ op: 'eq', args: [{ col: 'report_state' }, { lit: 'unavailable' }] }) } }),
    ).createSession();
    await s.declareAnalysis('gone', { cause });
    expect(await read(s, 'gone')).toEqual([false, true, false, false]);
  });

  it('keeps a skipped count honest: `sum` of an `if` is absent where the row is, never zero', async () => {
    const s = buildDashboard(
      defWith({
        counted: {
          builtin: 'derive',
          table: 'cells',
          name: 'counted',
          column: tree({ op: 'if', args: [{ op: 'gt', args: [{ col: 'cases' }, { lit: 50 }] }, { col: 'cases' }, { lit: null }] }),
        },
      }),
    ).createSession();
    await s.declareAnalysis('counted', { cause });
    // row b is absent because its CONDITION is absent — not because it failed the test
    expect(await read(s, 'counted')).toEqual([120, null, null, null]);
  });
});

describe('calendars are data', () => {
  it('two week columns over the same date disagree, and each says which calendar counted it', async () => {
    const s = buildDashboard(
      defWith({
        iso: { builtin: 'derive', table: 'cells', name: 'iso_week', column: tree({ op: 'week', args: [{ op: 'cast', args: [{ col: 'report_date' }, { lit: 'date' }] }], calendar: 'iso' }) },
        mmwr: { builtin: 'derive', table: 'cells', name: 'mmwr_week', column: tree({ op: 'week', args: [{ op: 'cast', args: [{ col: 'report_date' }, { lit: 'date' }] }], calendar: 'mmwr' }) },
      }),
    ).createSession();
    await s.declareAnalysis('iso', { cause });
    await s.declareAnalysis('mmwr', { cause });
    // 2026-01-04 is a Sunday, so the MMWR week that contains it has already
    // begun where the ISO one has not — the two disagree on the rows after it,
    // and at the year boundary they disagree by a whole week.
    expect(await read(s, 'iso_week')).toEqual([1, null, 2, 53]);
    expect(await read(s, 'mmwr_week')).toEqual([1, null, 1, 52]);
    // and the disagreement is declared, not implicit: the calendar rides the commit
    const act = s.log.records.find((r) => r.viewId === 'analysis:mmwr')!;
    expect(JSON.stringify(act.value)).toContain('"calendar":"mmwr"');
  });
});

describe('judged before anything moves, in the derive taxonomy', () => {
  /** Declare one column through the act's own door and hand back what it refused with. */
  async function refusal(column: unknown, name = 'rate'): Promise<{ code?: string; detail?: string; records: number }> {
    const s = buildDashboard(defWith({ [name]: { builtin: 'derive', table: 'cells', name, column } as never })).createSession();
    const made = await s.declareAnalysis(name, { cause });
    return { code: made.gap?.code, detail: made.gap?.detail, records: s.log.records.length };
  }

  it('refuses an op the grammar does not have', async () => {
    const r = await refusal(tree({ op: 'sqrt' as never, args: [{ col: 'cases' }] }));
    expect(r.code).toBe('derive-invalid');
    expect(r.detail).toContain('there is no op named "sqrt"');
    expect(r.records).toBe(0);
  });

  it('refuses an op given the wrong number of arguments, in the op row’s own words', async () => {
    const r = await refusal(tree({ op: 'div', args: [{ col: 'cases' }] }));
    expect(r.code).toBe('derive-invalid');
    expect(r.detail).toContain('takes two arguments');
    expect(r.records).toBe(0);
  });

  it('refuses a column the table does not have, naming the ones it has', async () => {
    const r = await refusal(tree({ op: 'div', args: [{ col: 'cases' }, { col: 'deaths' }] }));
    expect(r.code).toBe('derive-invalid');
    expect(r.detail).toContain('this column reads "deaths", which table "cells" does not have');
    expect(r.records).toBe(0);
  });

  it('refuses a column of the wrong kind, naming the position and what it holds', async () => {
    const r = await refusal(tree({ op: 'div', args: [{ col: 'cases' }, { col: 'region' }] }));
    expect(r.code).toBe('derive-invalid');
    expect(r.detail).toContain('must be a number');
    expect(r.records).toBe(0);
  });

  it('refuses an aggregate with nothing to fold, and a window by name', async () => {
    const nothing = await refusal({ ops: 1, kind: 'aggregate', expr: { col: 'cases' } });
    expect(nothing.code).toBe('derive-invalid');
    expect(nothing.detail).toContain('an aggregate column is one a reducer folds, and this one holds none');
    expect(nothing.records).toBe(0);

    const window = await refusal({ ops: 1, kind: 'window', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: { groupBy: ['region'] } });
    expect(window.code).toBe('derive-invalid');
    expect(window.detail).toContain('a window column needs an ordering as well as a group');
    expect(window.records).toBe(0);
  });

  it('refuses a group the table cannot make, and a filter that is not a yes or a no', async () => {
    const ghost = await refusal({ ops: 1, kind: 'aggregate', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: { groupBy: ['ghost'] } });
    expect(ghost.code).toBe('derive-invalid');
    expect(ghost.detail).toContain('this column groups by "ghost", which table "cells" does not have');
    expect(ghost.records).toBe(0);

    const filter = await refusal({ ops: 1, kind: 'aggregate', expr: { op: 'sum', args: [{ col: 'cases' }] }, over: { groupBy: [], where: { col: 'cases' } } });
    expect(filter.detail).toContain('over.where says which rows the reducer runs over, so it must come to a boolean');
    expect(filter.records).toBe(0);
  });

  it('refuses a column written against an op vocabulary this build does not have', async () => {
    const r = await refusal({ ops: 2, kind: 'row', expr: { col: 'cases' } });
    expect(r.code).toBe('derive-invalid');
    expect(r.detail).toContain('this build knows ops 1');
    expect(r.records).toBe(0);
  });

  it('refuses the same way through the dispatch door, with no commit', async () => {
    const s = buildDashboard(defWith(undefined)).createSession();
    const res = await s.dispatch({
      verb: 'analyze',
      analysisId: 'rate',
      def: { builtin: 'derive', table: 'cells', name: 'rate', column: tree({ op: 'div', args: [{ col: 'cases' }, { col: 'region' }] }) },
      cause,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rejection.code).toBe('derive-invalid');
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses to write over a declared source column — the act ran, the write did not', async () => {
    const s = buildDashboard(defWith({ over: { builtin: 'derive', table: 'cells', name: 'cases', column: tree({ op: 'mul', args: [{ col: 'cases' }, { lit: 2 }] }) } })).createSession();
    const made = await s.declareAnalysis('over', { cause });
    expect(made.commit).toBeDefined();
    expect(made.materialized).toEqual([]);
    expect(made.gap).toMatchObject({ code: 'derive-invalid', op: 'declareAnalysis', target: 'cases' });
    expect(made.gap?.detail).toContain('a computed column may not take a source column\'s name');
    expect(await read(s, 'cases')).toEqual([120, 0, 30, 45]);
  });

  it('refuses when the rows behind it could not be read — a source refusal, not a bad declaration', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE } }, { engine: 'wasm' })).createSession();
    const made = await s.declareAnalysis('rate', { cause });
    expect(made.commit).toBeUndefined();
    expect(made.gap).toMatchObject({ code: 'derive-source-refused', op: 'declareAnalysis', target: 'rate' });
    expect(made.gap?.detail).toContain('analysis "rate" could not be judged against table "cells"');
    expect(s.log.records).toHaveLength(0);
  });

  it('files a SOURCE refusal — in the derive taxonomy — when the table it writes into has no provider, or cannot say which columns are its own', async () => {
    // a record naming a table nobody declared: the act runs over the session's table and finds no provider to write into
    const ghost = buildDashboard(defWith({ rate: { builtin: 'derive', table: 'ghost', name: 'rate', column: RATE } })).createSession();
    const noProvider = await ghost.declareAnalysis('rate', { cause });
    expect(noProvider.gap).toMatchObject({ code: 'derive-source-refused', op: 'declareAnalysis', target: 'ghost' });
    expect(noProvider.gap?.detail).toBe('no provider for table "ghost"');
    // a declared table on an engine this build does not run: the store cannot say which columns are the map's
    const def: DashboardDef = {
      ...defWith({ twice: { builtin: 'derive', table: 'notes', name: 'twice', column: tree({ op: 'mul', args: [{ col: 'cases' }, { lit: 2 }] }) } }),
      data: { cells: { rows: [...ROWS] }, notes: { rows: [...ROWS], engine: 'wasm' } },
    };
    const notes = buildDashboard(def).createSession();
    const unsaid = await notes.declareAnalysis('twice', { cause });
    expect(unsaid.gap).toMatchObject({ code: 'derive-source-refused', op: 'declareAnalysis', target: 'notes' });
    expect(unsaid.gap?.detail).toContain('could not say which columns are its own');
  });

  it('leaves every other analysis on the general codes, exactly as before', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'formula', expression: 'cases / deaths', name: 'rate', table: 'cells' } })).createSession();
    const made = await s.declareAnalysis('rate', { cause });
    expect(made.gap?.code).toBe('guard-failed');
  });

  it('refuses a record that is not a declaration at all, at the def’s own door', async () => {
    const s = buildDashboard(defWith(undefined)).createSession();
    const res = await s.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', table: 'cells', name: 'rate', column: 'cases / population' } as never, cause });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rejection.detail).toContain('must be a derived-column declaration — { ops, kind, expr }');
    expect(s.hasAnalysis('rate')).toBe(false);
    expect(s.log.records).toHaveLength(0);
  });
});

describe('a definition holding a declared column is still JSON', () => {
  it('survives a round trip, builds, and runs', async () => {
    const def = defWith({ rate: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE } });
    const back = JSON.parse(JSON.stringify(def)) as DashboardDef;
    expect(back).toEqual(def);
    const s = buildDashboard(back).createSession();
    await s.declareAnalysis('rate', { cause });
    expect(await read(s, 'rate')).toEqual([2, null, 2, 5]);
  });
});

describe('two branches, one column name, two declarations', () => {
  const TWO: DashboardDef = defWith({
    byPeople: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE },
    byTen: { builtin: 'derive', table: 'cells', name: 'rate', column: tree({ op: 'div', args: [{ col: 'cases' }, { lit: 10 }] }) },
  });

  it('each branch reads its own numbers, and a replay rebuilds both at their own positions', async () => {
    const source = buildDashboard(TWO).createSession();
    const a = await source.declareAnalysis('byPeople', { cause });
    source.seek(a.commit!.id);
    const b = await source.declareAnalysis('byTen', { cause });

    source.seek(a.commit!.id);
    expect(await read(source, 'rate')).toEqual([2, null, 2, 5]);
    source.seek(b.commit!.id);
    expect(await read(source, 'rate')).toEqual([12, null, 3, 4.5]);

    const fresh = buildDashboard(TWO).createSession();
    const replayed = await fresh.replay(JSON.stringify(source.log.records));
    expect(replayed).toMatchObject({ ok: true, landed: 2, reran: 2, filed: 0 });
    fresh.seek(a.commit!.id);
    expect(await read(fresh, 'rate')).toEqual([2, null, 2, 5]);
    fresh.seek(b.commit!.id);
    expect(await read(fresh, 'rate')).toEqual([12, null, 3, 4.5]);
  });

  it('re-declaring one id lands two acts, and a replay re-performs each with ITS OWN declaration — never the last one on the log', async () => {
    const source = buildDashboard(defWith(undefined)).createSession();
    const a = await source.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE }, cause });
    const b = await source.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', table: 'cells', name: 'rate', column: tree({ op: 'div', args: [{ col: 'cases' }, { lit: 10 }] }) }, cause });
    expect(a.ok && b.ok).toBe(true);
    const first = source.log.records[0]!.id;
    const second = source.log.records[1]!.id;
    source.seek(first);
    expect(await read(source, 'rate')).toEqual([2, null, 2, 5]);
    source.seek(second);
    expect(await read(source, 'rate')).toEqual([12, null, 3, 4.5]);

    // both commits carry their own declaration, so each act is rebuilt from ITS bytes
    const fresh = buildDashboard(defWith(undefined)).createSession();
    expect(await fresh.replay(JSON.stringify(source.log.records))).toMatchObject({ ok: true, landed: 2, reran: 2, filed: 0 });
    fresh.seek(first);
    expect(await read(fresh, 'rate')).toEqual([2, null, 2, 5]);
    fresh.seek(second);
    expect(await read(fresh, 'rate')).toEqual([12, null, 3, 4.5]);
  });

  it('lands a GROUPED column, and the group rides the commit into a replay', async () => {
    // each row's share of its region's reported total, counting present rows only
    const share: DerivedColumnDecl = {
      ops: 1,
      kind: 'row',
      expr: { op: 'div', args: [{ col: 'cases' }, { op: 'sum', args: [{ col: 'cases' }] }] },
      over: { groupBy: ['region'], where: { op: 'eq', args: [{ col: 'report_state' }, { lit: 'present' }] } },
    };
    const source = buildDashboard(defWith(undefined)).createSession();
    const res = await source.dispatch({ verb: 'analyze', analysisId: 'share', def: { builtin: 'derive', table: 'cells', name: 'share', column: share }, cause });
    expect(res.ok).toBe(true);
    // north's present cases are 120 alone; south's are 30 + 45. The `unavailable`
    // row is in no group at all, because the absence law reaches the grouping too.
    expect(await read(source, 'share')).toEqual([1, null, 30 / 75, 45 / 75]);

    // the WHOLE declaration is on the commit — the group and its filter included
    const landed = source.log.records.at(-1) as { readonly value: { readonly def: { readonly column: DerivedColumnDecl } } };
    expect(landed.value.def.column.over).toEqual(share.over);

    const fresh = buildDashboard(defWith(undefined)).createSession();
    expect(await fresh.replay(JSON.stringify(source.log.records))).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    expect(await read(fresh, 'share')).toEqual([1, null, 30 / 75, 45 / 75]);
  });

  it('replays into a session that declares NOTHING — the tree rode on the commit', async () => {
    const source = buildDashboard(defWith(undefined)).createSession();
    const res = await source.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE }, cause });
    expect(res.ok).toBe(true);

    const fresh = buildDashboard(defWith(undefined)).createSession();
    expect(fresh.hasAnalysis('rate')).toBe(false);
    const replayed = await fresh.replay(JSON.stringify(source.log.records));
    expect(replayed).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    // …and the replayed column keeps the absence law, because the law is the
    // DEF's and the fresh session read it off its own dashboard
    expect(await read(fresh, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('refuses a replay of a declaration this library cannot build, with nothing landed', async () => {
    const source = buildDashboard(defWith(undefined)).createSession();
    await source.dispatch({ verb: 'analyze', analysisId: 'rate', def: { builtin: 'derive', table: 'cells', name: 'rate', column: RATE }, cause });
    const wire = JSON.parse(JSON.stringify(source.log.records)) as { value: { def: { column: unknown } } }[];
    wire[0]!.value.def.column = 'cases / population'; // a log nobody in this library wrote

    const fresh = buildDashboard(defWith(undefined)).createSession();
    const replayed = await fresh.replay(JSON.stringify(wire));
    expect(replayed.ok).toBe(false);
    expect(!replayed.ok && replayed.gap.detail).toContain('carries a declaration this library cannot build');
    expect(!replayed.ok && replayed.gap.detail).toContain('must be a derived-column declaration');
  });
});
