/**
 * THE SESSION'S SINK JUDGES WHAT IT IS HANDED.
 *
 * `defineAnalysis` refuses a judge's answer that is not a p-value, but an
 * analysis module need not be built by it. A hand-written module that reported
 * `NaN` used to pass straight through: the error-budget stepper spent a step
 * on a number that can never reject, and the commit recorded a test no reader
 * can read. A refused test does not happen — no step, no commit.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { AnalysisModule } from '../analysis/index.js';
import { isPValue } from '../fdr/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';

/**
 * The fixture's dashboard, with its correlation module replaced by a hand-written wrapper:
 * it runs the real analysis, then tells the session's sink whatever `report` says to.
 */
function sessionWhere(report: (sink: (pValue: unknown) => void) => void) {
  const def = makeDashboardDef();
  const real = def.analyses!['correlation'] as AnalysisModule;
  const wrapped: AnalysisModule = {
    ...real,
    run: async (input, opts) => {
      let seen: Parameters<NonNullable<NonNullable<typeof opts>['sink']>>[0] | undefined;
      const result = await real.run(input, { ...opts, sink: (h) => void (seen = h) });
      report((pValue) => opts?.sink?.({ ...seen!, pValue: pValue as number }));
      return result;
    },
  };
  return buildDashboard({ ...def, analyses: { ...def.analyses, correlation: wrapped } }).createSession({ as: 'agent' });
}
const swallowing = (fn: () => void): void => {
  try {
    fn();
  } catch {
    /* a module that ignores the sink's refusal */
  }
};
const sessionReporting = (pValue: unknown, swallow = false) => sessionWhere((sink) => (swallow ? swallowing(() => sink(pValue)) : sink(pValue)));
const analyze = { verb: 'analyze', analysisId: 'correlation', cause: { requestedBy: 'agent', computedBy: 'system' } } as const;

describe('isPValue — the one rule', () => {
  it.each([0, 1, 0.05, 1e-300])('%s is a p-value', (p) => expect(isPValue(p)).toBe(true));
  it.each([Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY, '0.05', null, undefined, new Number(0.5)])('%s is not', (p) => expect(isPValue(p)).toBe(false));
});

describe('a hand-written analysis module', () => {
  it('reporting a real p-value is ledgered and lands, as before', async () => {
    const s = sessionReporting(0.5);
    await s.dispatch(analyze);
    expect(s.ledger()).toHaveLength(1);
    expect(s.ledger()[0]!.pValue).toBe(0.5);
    expect(s.log.records).toHaveLength(1);
  });

  it.each([Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY, '0.01'])('reporting %s is refused: no budget is spent and nothing lands', async (bad) => {
    const s = sessionReporting(bad);
    const wealthBefore = (await s.overview()).fdr.wealth;
    await expect(s.dispatch(analyze)).rejects.toThrow(`analysis "correlation" reported the p-value ${String(bad)} — a p-value is a finite number in [0,1]`);
    expect(s.ledger()).toEqual([]);
    expect(s.log.records).toEqual([]);
    expect((await s.overview()).fdr.wealth).toBe(wealthBefore);
  });

  it('cannot land the act as an ordinary analysis by swallowing the refusal', async () => {
    const s = sessionReporting(Number.NaN, true);
    await expect(s.dispatch(analyze)).rejects.toThrow('reported the p-value NaN');
    expect(s.ledger()).toEqual([]);
    expect(s.log.records).toEqual([]);
  });

  // The budget used to be spent INSIDE the sink, while the module was still running. Anything
  // that happened afterwards was too late: a step was spent with no commit behind it.
  it.each([
    ['a valid result and then an invalid one', (sink: (p: unknown) => void) => (sink(0.5), sink(Number.NaN)), 'reported a second test result'],
    ['two valid results', (sink: (p: unknown) => void) => (sink(0.5), sink(0.4)), 'reported a second test result'],
    ['an invalid result it swallows, then a valid one', (sink: (p: unknown) => void) => (swallowing(() => sink(Number.NaN)), sink(0.5)), 'reported the p-value NaN'],
  ])('reporting %s spends no budget and lands nothing', async (_case, report, why) => {
    const s = sessionWhere(report);
    const wealthBefore = (await s.overview()).fdr.wealth;
    await expect(s.dispatch(analyze)).rejects.toThrow(why);
    expect(s.ledger()).toEqual([]);
    expect(s.log.records).toEqual([]);
    expect((await s.overview()).fdr.wealth).toBe(wealthBefore);
  });

  it('reporting a result and then throwing spends no budget either', async () => {
    const s = sessionWhere((sink) => {
      sink(0.5);
      throw new Error('the module failed after reporting');
    });
    await expect(s.dispatch(analyze)).rejects.toThrow('the module failed after reporting');
    expect(s.ledger()).toEqual([]);
    expect(s.log.records).toEqual([]);
  });

  it('a refused test leaves the next one exactly where a fresh session would put it', async () => {
    const after = sessionWhere((sink) => sink(Number.NaN));
    await expect(after.dispatch(analyze)).rejects.toThrow();
    const fresh = buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
    const again = buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
    await fresh.dispatch(analyze);
    // a session that only ever refused has spent what a fresh one has: nothing
    expect((await after.overview()).fdr.wealth).toBe((await again.overview()).fdr.wealth);
    expect(fresh.ledger()).toHaveLength(1);
  });
});
