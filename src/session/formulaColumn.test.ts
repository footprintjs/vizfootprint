/**
 * A FORMULA COLUMN, from the outside — what a person who typed one sees.
 *
 * The formula is an analysis like any other, which is the whole point: it lands
 * as an act, its column lives in the slot that act's commit names, it resolves
 * at the cursor's branch path, and a replay re-performs it at its own position.
 * Nothing here is a new mechanism; the file is the proof that none was added.
 *
 * The laws it pins are three folders' own: the grammar and its refusals
 * (`../analysis/README.md`), a derived column belongs to the act that made it
 * (`../data/README.md`), and judge-before-anything-moves (`./README.md`, law 1).
 */

import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { DataRow } from '../analysis/index.js';
import { noSqlConnection } from './dashboard.fixture.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

/** Eight rows with a zero denominator and one absence, so the silence law has something to be silent about. */
const ROWS: DataRow[] = [
  { id: 'a', region: 'north', cases: 120, people: 60 },
  { id: 'b', region: 'north', cases: 90, people: 0 },
  { id: 'c', region: 'south', cases: 30, people: 15 },
  { id: 'd', region: 'south', cases: 45, people: 9 },
];

function defWith(analyses: DashboardDef['analyses'], rows: readonly DataRow[] = ROWS): DashboardDef {
  return {
    data: { data: { rows: [...rows] } },
    actors: { grid: { actor: 'user', label: 'The grid' } },
    ...(analyses !== undefined ? { analyses } : {}),
    defaultTable: 'data',
  };
}

type Session = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;

/** One column's values at the cursor, or the sentence the read was refused with. */
async function read(s: Session, column: string): Promise<unknown[]> {
  const res = await s.viewQuery({ columns: ['id', column], limit: 40 });
  return res.ok ? res.rows.map((r) => r[column]) : [`REFUSED: ${res.rejected}`];
}

// ─────────────────────────────────────────────────────────────────────────────

describe('a formula lands a column, as an act', () => {
  it('runs row-wise and the column reads back under the name it was given', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'formula', expression: 'cases / people', name: 'rate' } })).createSession();
    const made = await s.declareAnalysis('rate', { cause });

    expect(made.materialized).toEqual(['rate']);
    expect(made.gap).toBeUndefined();
    expect(made.commit?.viewId).toBe('analysis:rate');
    // the act, in enough detail to perform it again (law 6): which analysis,
    // over which table, and — because a record is data — the declaration itself
    expect(made.commit?.value).toEqual({
      id: 'rate',
      table: 'data',
      def: { builtin: 'formula', expression: 'cases / people', name: 'rate', id: 'rate' },
    });
    expect(await read(s, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('divides by zero into null and reads an empty cell as null — never a number that was not there', async () => {
    // `people` stays a NUMBER column: the tally reads a null as an absence, not
    // as a value of another type. A column that really held text would be
    // refused at declaration instead — see the judge below.
    const rows: DataRow[] = [
      { id: 'a', cases: 10, people: 5 },
      { id: 'b', cases: 10, people: 0 },
      { id: 'c', cases: 10, people: null },
    ] as unknown as DataRow[];
    const s = buildDashboard(defWith({ rate: { builtin: 'formula', expression: 'cases / people', name: 'rate' } }, rows)).createSession();
    await s.declareAnalysis('rate', { cause });
    expect(await read(s, 'rate')).toEqual([2, null, null]);
  });

  it('reads a column an earlier formula derived, at the cursor', async () => {
    const s = buildDashboard(
      defWith({
        rate: { builtin: 'formula', expression: 'cases / people', name: 'rate' },
        scaled: { builtin: 'formula', expression: 'rate * 100', name: 'scaled' },
      }),
    ).createSession();
    await s.declareAnalysis('rate', { cause });
    const second = await s.declareAnalysis('scaled', { cause });
    expect(second.materialized).toEqual(['scaled']);
    expect(await read(s, 'scaled')).toEqual([200, null, 200, 500]);
  });

  it('takes the type it was declared with, and defaults to float', async () => {
    const s = buildDashboard(
      defWith({
        tens: { builtin: 'formula', expression: 'round(cases / 10)', name: 'tens', type: 'int' },
        rate: { builtin: 'formula', expression: 'cases / people', name: 'rate' },
      }),
    ).createSession();
    const ints = await s.declareAnalysis('tens', { cause });
    expect(ints.result.ok && ints.result.output).toEqual({ as: 'columns', table: 'data', columns: { tens: { type: 'int' } } });
    const floats = await s.declareAnalysis('rate', { cause });
    expect(floats.result.ok && floats.result.output).toEqual({ as: 'columns', table: 'data', columns: { rate: { type: 'float' } } });
  });
});

describe('judged before anything moves', () => {
  it('refuses a column the table does not have, and lands nothing at all', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'formula', expression: 'cases / deaths', name: 'rate' } })).createSession();
    const made = await s.declareAnalysis('rate', { cause });

    expect(made.commit).toBeUndefined();
    expect(made.materialized).toBeUndefined();
    expect(made.gap).toMatchObject({
      code: 'guard-failed',
      op: 'declareAnalysis',
      target: 'rate',
      detail: 'the formula "cases / deaths" reads "deaths", which table "data" does not have — the numbers it may read are cases, people',
    });
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses a column the engine calls text — before a row is touched', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'formula', expression: 'cases / region', name: 'rate' } })).createSession();
    const made = await s.declareAnalysis('rate', { cause });
    expect(made.gap?.detail).toBe('the formula "cases / region" reads "region", which table "data" holds as string — a formula reads numbers');
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses through the dispatch door too, with the same sentence and no commit', async () => {
    const s = buildDashboard(defWith({ rate: { builtin: 'formula', expression: 'cases / region', name: 'rate' } })).createSession();
    const res = await s.dispatch({ verb: 'analyze', analysisId: 'rate', cause });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rejection.detail).toBe('the formula "cases / region" reads "region", which table "data" holds as string — a formula reads numbers');
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses when the engine cannot say what its columns are — never judged on a guess', async () => {
    const def: DashboardDef = {
      data: { data: { rows: [...ROWS], engine: 'wasm' } }, // …on a connection that never opens (`noSqlConnection`), so the engine can say nothing about its columns
      actors: { grid: { actor: 'user', label: 'The grid' } },
      analyses: { rate: { builtin: 'formula', expression: 'cases / people', name: 'rate' } },
      defaultTable: 'data',
    };
    const s = buildDashboard(def, noSqlConnection).createSession();
    const made = await s.declareAnalysis('rate', { cause });
    expect(made.commit).toBeUndefined();
    expect(made.gap).toMatchObject({ code: 'needs-backend-data', op: 'declareAnalysis', target: 'rate' });
    expect(made.gap?.detail).toContain('analysis "rate" could not be judged against table "data"');
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses to write over a declared source column — the existing law, unchanged', async () => {
    const s = buildDashboard(defWith({ over: { builtin: 'formula', expression: 'cases * 2', name: 'cases' } })).createSession();
    const made = await s.declareAnalysis('over', { cause });

    // the analysis RAN — the refusal is about the WRITE, so the commit stands
    expect(made.commit).toBeDefined();
    expect(made.materialized).toEqual([]);
    expect(made.gap).toMatchObject({ code: 'guard-failed', op: 'declareAnalysis', target: 'cases' });
    expect(made.gap?.detail).toContain('a computed column may not take a source column\'s name');
    // and the real numbers are untouched
    expect(await read(s, 'cases')).toEqual([120, 90, 30, 45]);
  });
});

describe('a formula declared as part of the act (the desk’s door)', () => {
  it('lands a column from a record the act brought with it', async () => {
    const s = buildDashboard(defWith(undefined)).createSession();
    const res = await s.dispatch({
      verb: 'analyze',
      analysisId: 'rate',
      def: { builtin: 'formula', expression: 'cases / people', name: 'rate' },
      cause,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.analysis?.materialized).toEqual(['rate']);
    expect(await read(s, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('refuses a record that is not a formula, in the library’s own sentence, and declares nothing', async () => {
    const s = buildDashboard(defWith(undefined)).createSession();
    const res = await s.dispatch({
      verb: 'analyze',
      analysisId: 'rate',
      def: { builtin: 'formula', expression: 'cases %', name: 'rate' },
      cause,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.rejection.detail).toBe(
      'analysis "rate" could not be declared: invalid builtin analysis: builtin analysis.expression is not a formula: the formula has no rule for "%" at position 7',
    );
    expect(s.hasAnalysis('rate')).toBe(false);
    expect(s.log.records).toHaveLength(0);
  });

  it('refuses an analysis nobody declared, as it always did', async () => {
    const s = buildDashboard(defWith(undefined)).createSession();
    const res = await s.dispatch({ verb: 'analyze', analysisId: 'nope', cause });
    expect(res.ok === false && res.rejection.code).toBe('needs-analysis-kind');
  });

  it('reads the table the act named, not the default one', async () => {
    const def: DashboardDef = {
      data: {
        data: { rows: [...ROWS] },
        other: { rows: [{ id: 'a', cases: 1000, people: 10 }, { id: 'b', cases: 2000, people: 10 }, { id: 'c', cases: 3000, people: 10 }, { id: 'd', cases: 4000, people: 10 }] },
      },
      actors: { grid: { actor: 'user', label: 'The grid' } },
      defaultTable: 'data',
    };
    const s = buildDashboard(def).createSession();
    const res = await s.dispatch({
      verb: 'analyze',
      analysisId: 'rate',
      def: { builtin: 'formula', expression: 'cases / people', name: 'rate', table: 'other' },
      table: 'other',
      cause,
    });
    expect(res.ok).toBe(true);
    const answer = await s.viewQuery({ table: 'other', columns: ['id', 'rate'], limit: 10 });
    expect(answer.ok && answer.rows.map((r) => r['rate'])).toEqual([100, 200, 300, 400]);
    // and the act says which table it read, so a replay does not have to guess
    expect(res.ok && res.analysis?.commit?.value).toEqual({
      id: 'rate',
      table: 'other',
      def: { builtin: 'formula', expression: 'cases / people', name: 'rate', table: 'other', id: 'rate' },
    });
  });
});

describe('a definition holding a formula is still JSON', () => {
  it('survives a round trip, builds, and runs', async () => {
    const def = defWith({ rate: { builtin: 'formula', expression: 'cases / people * 1000', name: 'rate', type: 'float' } });
    const back = JSON.parse(JSON.stringify(def)) as DashboardDef;
    expect(back).toEqual(def);
    const s = buildDashboard(back).createSession();
    await s.declareAnalysis('rate', { cause });
    expect(await read(s, 'rate')).toEqual([2000, null, 2000, 5000]);
  });
});

describe('two branches, one column name, two formulas', () => {
  /** The def both sides of the replay are built from — two analyses writing the same column. */
  const TWO: DashboardDef = defWith({
    byPeople: { builtin: 'formula', expression: 'cases / people', name: 'rate' },
    byCases: { builtin: 'formula', expression: 'cases / 10', name: 'rate' },
  });

  it('each branch reads its own numbers, and a replay rebuilds both at their own positions', async () => {
    const source = buildDashboard(TWO).createSession();
    const a = await source.declareAnalysis('byPeople', { cause });
    const root = a.commit!.id;
    source.seek(root);
    const b = await source.declareAnalysis('byCases', { cause }); // acting from the past branches (R8)

    // the walk: each position reads the numbers ITS act computed
    source.seek(a.commit!.id);
    expect(await read(source, 'rate')).toEqual([2, null, 2, 5]);
    source.seek(b.commit!.id);
    expect(await read(source, 'rate')).toEqual([12, 9, 3, 4.5]);

    // …and a replay into a fresh session, from the serialized log alone
    const fresh = buildDashboard(TWO).createSession();
    const replayed = await fresh.replay(JSON.stringify(source.log.records));
    expect(replayed).toMatchObject({ ok: true, landed: 2, reran: 2, filed: 0 });

    fresh.seek(a.commit!.id);
    expect(await read(fresh, 'rate')).toEqual([2, null, 2, 5]);
    fresh.seek(b.commit!.id);
    expect(await read(fresh, 'rate')).toEqual([12, 9, 3, 4.5]);
  });

  it('replays into a session that declares NOTHING — the record rode on the commit', async () => {
    const source = buildDashboard(TWO).createSession();
    const a = await source.declareAnalysis('byPeople', { cause });
    source.seek(a.commit!.id);
    const b = await source.declareAnalysis('byCases', { cause });

    // a dashboard with the same rows and no analyses at all
    const fresh = buildDashboard(defWith(undefined)).createSession();
    expect(fresh.hasAnalysis('byPeople')).toBe(false);
    const replayed = await fresh.replay(JSON.stringify(source.log.records));
    expect(replayed).toMatchObject({ ok: true, landed: 2, reran: 2, filed: 0 });

    fresh.seek(a.commit!.id);
    expect(await read(fresh, 'rate')).toEqual([2, null, 2, 5]);
    fresh.seek(b.commit!.id);
    expect(await read(fresh, 'rate')).toEqual([12, 9, 3, 4.5]);
  });

  it('and one added at RUNTIME through the desk’s door replays the same way, from bytes alone', async () => {
    const source = buildDashboard(defWith(undefined)).createSession();
    const res = await source.dispatch({
      verb: 'analyze',
      analysisId: 'rate',
      def: { builtin: 'formula', expression: 'cases / people', name: 'rate' },
      cause,
    });
    expect(res.ok).toBe(true);

    const fresh = buildDashboard(defWith(undefined)).createSession();
    const replayed = await fresh.replay(JSON.stringify(source.log.records));
    expect(replayed).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    expect(await read(fresh, 'rate')).toEqual(await read(source, 'rate'));
    expect(await read(fresh, 'rate')).toEqual([2, null, 2, 5]);
  });

  it('a declaration the library cannot build refuses the replay, with nothing landed', async () => {
    const source = buildDashboard(TWO).createSession();
    await source.declareAnalysis('byPeople', { cause });
    const wire = JSON.parse(JSON.stringify(source.log.records)) as { value: { def: { expression: string } } }[];
    wire[0]!.value.def.expression = 'cases %'; // a log nobody in this library wrote

    const fresh = buildDashboard(defWith(undefined)).createSession();
    const replayed = await fresh.replay(JSON.stringify(wire));
    expect(replayed.ok).toBe(false);
    expect(!replayed.ok && replayed.gap.detail).toContain('carries a declaration this library cannot build');
    expect(!replayed.ok && replayed.gap.detail).toContain('the formula has no rule for "%" at position 7');
    expect(fresh.log.records).toHaveLength(0);
  });
});
