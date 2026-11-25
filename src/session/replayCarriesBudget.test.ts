/**
 * A REPLAYED SESSION STANDS WHERE THE ORIGINAL STOOD.
 *
 * An online error budget is spent test by test and never refunded. A session
 * replayed from a saved log used to start with the full budget, although its
 * log held tests: the next test was judged as the first, at the loosest
 * threshold the procedure has. Saving and replaying handed out a fresh budget.
 *
 * The budget comes with the log now. No test is run again; the recorded
 * results are fed through the budget in the order they arrived.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { FdrStep } from '../fdr/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';

const cause = { requestedBy: 'agent', computedBy: 'system' } as const;
const fresh = () => buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
const analyze = (analysisId: string) => ({ verb: 'analyze', analysisId, cause }) as const;
const spec = {
  mark: { type: 'circle' },
  params: [{ name: 'b', select: { type: 'interval', encodings: ['x'] } }],
  encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } },
};

/** A ledger without its timestamps: those are a session's own clock, and the log does not record them. */
const money = (ledger: readonly FdrStep[]) => ledger.map(({ timestamp: _clock, ...row }) => row);

/** A session with both kinds of test — a tested analysis and an untested chart claim — among acts that are not tests. */
async function original() {
  const s = fresh();
  await s.dispatch(analyze('correlation'));
  await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
  await s.dispatch(analyze('regression'));
  const chart = await s.proposeChart({ id: 'pr', spec, claim: 'price relates to rating' });
  if (!chart.ok) throw new Error('the fixture chart was refused');
  return s;
}

describe('replay carries the error budget', () => {
  it('the replayed ledger is the original ledger, row for row', async () => {
    const source = await original();
    expect(source.ledger().length).toBeGreaterThanOrEqual(2);

    const replayed = fresh();
    const res = await replayed.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tests).toEqual({ carried: source.ledger().length, unreadable: [] });
    expect(money(replayed.ledger())).toEqual(money(source.ledger()));
    const summary = ({ ledger, ...rest }: Awaited<ReturnType<typeof source.overview>>['fdr']) => ({ ...rest, ledger: money(ledger) });
    expect(summary(res.overview.fdr)).toEqual(summary((await source.overview()).fdr));
    // …and the two counts a reader compares agree again: tests on this path, tests in the budget
    expect(res.overview.time.cursorTests).toBeLessThanOrEqual(res.overview.fdr.tests);
  });

  it('the next test is judged at the threshold the original would have judged it at, not the first one', async () => {
    const source = await original();
    const replayed = fresh();
    await replayed.replay(source.log.records);
    const first = fresh();

    const onSource = await source.declareAnalysis('correlation');
    const onReplay = await replayed.declareAnalysis('correlation');
    const onFirst = await first.declareAnalysis('correlation');
    const row = (r: typeof onSource) => money([r.fdrStep!])[0]!;
    expect(row(onReplay)).toEqual(row(onSource));
    expect(row(onReplay).step).toBe(source.ledger().length);
    expect(row(onReplay).step).toBeGreaterThan(1);
    // the fault this file is about: the replayed session used to answer like `first`
    expect(row(onReplay).step).not.toBe(row(onFirst).step);
    expect(row(onReplay).wealthBefore).not.toBe(row(onFirst).wealthBefore);
  });

  it('counts the tests of every branch, in the order they were made', async () => {
    const source = fresh();
    const a = await source.declareAnalysis('correlation');
    await source.dispatch(analyze('regression'));
    // travel back and test again: a second branch, a second test
    await source.dispatch({ verb: 'fork', fromCommitId: a.commit!.id, cause });
    await source.dispatch(analyze('correlation'));
    expect(source.branches().length).toBeGreaterThan(1);

    const replayed = fresh();
    const res = await replayed.replay(source.log.records);
    expect(source.ledger()).toHaveLength(2); // one test on each branch
    expect(res.ok && res.tests.carried).toBe(2);
    expect(money(replayed.ledger())).toEqual(money(source.ledger()));
  });

  it('runs no test again', async () => {
    const source = await original();
    const replayed = fresh();
    const res = await replayed.replay(source.log.records);
    // nothing in this log wrote a column, so nothing is re-performed at all
    expect(res.ok && res.reran).toBe(0);
    const told = (s: typeof source) => s.log.records.map((r) => [r.id, r.parent, r.viewId, r.field, r.value]);
    expect(told(replayed)).toEqual(told(source));
  });

  it('a log with no test carries nothing', async () => {
    const source = fresh();
    await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    await source.dispatch({ verb: 'annotate', target: 'pValue', note: 'a note about a column of that name', cause });
    const replayed = fresh();
    const res = await replayed.replay(source.log.records);
    expect(res.ok && res.tests).toEqual({ carried: 0, unreadable: [] });
    expect(replayed.ledger()).toEqual([]);
  });

  it('a refused replay carries nothing', async () => {
    const source = await original();
    const used = fresh();
    await used.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    const res = await used.replay(source.log.records);
    expect(res.ok).toBe(false);
    expect(used.ledger()).toEqual([]);
  });
});

describe('a carried row is named as the row it replaces was', () => {
  it('a test and a chart claim made under a correlation id', async () => {
    const source = fresh();
    await source.declareAnalysis('correlation', { correlationId: 'call-7' });
    const chart = await source.proposeChart({ id: 'pr', spec, claim: 'price relates to rating', correlationId: 'call-8' });
    expect(chart.ok).toBe(true);
    const replayed = fresh();
    await replayed.replay(source.log.records);
    expect(replayed.ledger().map((r) => r.hypothesisId)).toEqual(source.ledger().map((r) => r.hypothesisId));
    expect(replayed.ledger().map((r) => r.hypothesisId)).toEqual(['corr:price:rating', 'call-8']);
  });

  it('a test of an analysis this session does not declare goes under the act\u2019s id, and still spends', async () => {
    const source = fresh();
    await source.declareAnalysis('correlation');
    const def = makeDashboardDef();
    const { correlation: _gone, ...others } = def.analyses!;
    const without = buildDashboard({ ...def, analyses: others }).createSession({ as: 'agent' });
    const res = await without.replay(source.log.records);
    expect(res.ok && res.tests.carried).toBe(1);
    expect(without.ledger()[0]).toMatchObject({ step: 1, hypothesisId: 'correlation', pValue: source.ledger()[0]!.pValue });
    expect((await without.overview()).fdr.wealth).toBe((await source.overview()).fdr.wealth);
  });

  it('an unreadable test made under a correlation id is named by it', async () => {
    const source = fresh();
    await source.declareAnalysis('correlation', { correlationId: 'call-9' });
    const log = structuredClone(source.log.records) as unknown as { id: string; field: string; value: unknown }[];
    log.find((r) => r.field === 'pValue')!.value = { id: 'correlation', table: 'data', pValue: 7 };
    const replayed = fresh();
    const res = await replayed.replay(log as never);
    expect(res.ok && res.tests.unreadable).toEqual([{ commitId: log[0]!.id, reason: 'bad-p-value' }]);
    expect(replayed.ledger()[0]).toMatchObject({ hypothesisId: 'call-9', pValue: 1, reject: false });
  });
});

describe('a test the log holds and nobody can read', () => {
  it('still spends budget, at p = 1, and is named', async () => {
    const source = await original();
    const log = structuredClone(source.log.records) as unknown as { id: string; field: string; value: unknown }[];
    const test = log.find((r) => r.field === 'pValue')!;
    test.value = 0.0001; // the bare number this lane used to carry: a result no reader can attribute to an act

    const replayed = fresh();
    const res = await replayed.replay(log as never);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tests).toEqual({ carried: source.ledger().length, unreadable: [{ commitId: test.id, reason: 'not-an-act' }] });
    // it costs what a test costs, and can never be a discovery
    expect(replayed.ledger()[0]).toMatchObject({ step: 1, pValue: 1, reject: false, hypothesisId: test.id });
    expect(replayed.ledger()).toHaveLength(source.ledger().length);
    // entering it at p = 1 can only leave less to spend than the original had, never more
    expect(res.overview.fdr.wealth).toBeLessThanOrEqual((await source.overview()).fdr.wealth);
  });
});
