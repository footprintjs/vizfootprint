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
import type { AnalysisModule } from '../analysis/index.js';
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

  it('counts the tests of every branch, in the order they were made — an abandoned branch included', async () => {
    const source = fresh();
    const root = await source.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    if (!root.ok) throw new Error('the fixture select was refused');
    // a test on a branch…
    await source.declareAnalysis('correlation');
    // …then travel back to before it and test again: the first test now sits on a branch the cursor has left
    await source.dispatch({ verb: 'fork', fromCommitId: root.commit!.id, cause });
    await source.declareAnalysis('correlation');
    expect(source.branches().length).toBeGreaterThan(1);
    expect((await source.overview()).time.cursorTests).toBe(1);
    expect(source.ledger()).toHaveLength(2);

    const replayed = fresh();
    const res = await replayed.replay(source.log.records);
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

  it('a test whose analysis the log itself declares is named by that declaration, on a session that declares nothing', async () => {
    // the declaration rides on the test's own commit, so it must be registered BEFORE the budget is carried
    const source = fresh();
    const made = await source.dispatch({ verb: 'analyze', analysisId: 'c1', def: { builtin: 'correlation', x: 'price', y: 'rating', id: 'named-by-its-record' }, cause });
    expect(made.ok).toBe(true);
    expect(source.ledger()[0]!.hypothesisId).toBe('named-by-its-record');
    const replayed = fresh(); // declares no `c1`
    await replayed.replay(source.log.records);
    expect(replayed.ledger().map((r) => r.hypothesisId)).toEqual(['named-by-its-record']);
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
    // under LORD++ (this fixture's procedure) raising a p-value can never leave more to spend
    expect(res.overview.fdr.procedure).toBe('LORD++');
    expect(res.overview.fdr.wealth).toBeLessThanOrEqual((await source.overview()).fdr.wealth);
  });
});

describe('what a carried budget does not claim', () => {
  const investing = () => buildDashboard({ ...makeDashboardDef(), fdr: { procedure: 'alpha-investing', alpha: 0.05 } }).createSession({ as: 'agent' });

  it('the verdicts are the replaying dashboard\u2019s: the log records p-values, not the settings it was made under', async () => {
    // one log, two dashboards. The rows are computed where the log is replayed.
    const source = fresh();
    await source.declareAnalysis('correlation');
    const same = fresh();
    const other = investing();
    await same.replay(source.log.records);
    await other.replay(source.log.records);
    expect(money(same.ledger())).toEqual(money(source.ledger()));
    expect(other.ledger()).toHaveLength(1);
    expect(other.ledger()[0]!.pValue).toBe(source.ledger()[0]!.pValue);
    // a different procedure judges the same p-value at its own threshold
    expect(other.ledger()[0]!.alphaThreshold).not.toBe(source.ledger()[0]!.alphaThreshold);
    expect((await other.overview()).fdr.procedure).toBe('alpha-investing');
  });

  it('an unreadable test is entered at p = 1 under alpha-investing too, with no claim that it is the cautious side', async () => {
    const source = investing();
    await source.declareAnalysis('correlation');
    const log = structuredClone(source.log.records) as unknown as { id: string; field: string; value: unknown }[];
    log.find((r) => r.field === 'pValue')!.value = 0.0001;
    const replayed = investing();
    const res = await replayed.replay(log as never);
    expect(res.ok && res.tests.unreadable).toHaveLength(1);
    expect(replayed.ledger()[0]).toMatchObject({ pValue: 1, reject: false });
  });

  it('a plain-statistic test is carried into the ledger and is still not answerable by why on the replay', async () => {
    const source = fresh();
    await source.declareAnalysis('correlation');
    expect(source.why({ kind: 'hypothesis', analysisId: 'correlation' }).ok).toBe(true);
    const replayed = fresh();
    await replayed.replay(source.log.records);
    expect(replayed.ledger()).toHaveLength(1);
    expect(replayed.why({ kind: 'hypothesis', analysisId: 'correlation' })).toMatchObject({ ok: false, missing: 'no-such-target' });
  });

  it('a chart claim is charged and not listed', async () => {
    const source = fresh();
    const chart = await source.proposeChart({ id: 'pr', spec, claim: 'price relates to rating' });
    expect(chart.ok).toBe(true);
    const replayed = fresh();
    await replayed.replay(source.log.records);
    expect(replayed.ledger()).toHaveLength(1);
    expect(replayed.charts()).toEqual([]);
  });
});

describe('only a declared test spends budget', () => {
  it('an analysis declared as something else cannot report a test result', async () => {
    // it used to spend a step with no test commit behind it, which no replay could account for
    const def = makeDashboardDef();
    const real = def.analyses!['regression'] as AnalysisModule;
    expect(real.kind).not.toBe('test');
    const reporting: AnalysisModule = {
      ...real,
      run: async (input, opts) => {
        const result = await real.run(input, opts);
        opts?.sink?.({ hypothesisId: 'sneaked', pValue: 0.5, timestamp: 1 });
        return result;
      },
    };
    const s = buildDashboard({ ...def, analyses: { ...def.analyses, regression: reporting } }).createSession({ as: 'agent' });
    await expect(s.dispatch(analyze('regression'))).rejects.toThrow(`reported a test result, but is declared as "${real.kind}", not as a test`);
    expect(s.ledger()).toEqual([]);
    expect(s.log.records).toEqual([]);
  });
});
