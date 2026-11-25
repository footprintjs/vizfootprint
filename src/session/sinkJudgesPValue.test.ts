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

/** The fixture's dashboard, with its correlation module reporting `pValue` to the sink in place of its own. */
function sessionReporting(pValue: unknown, swallow = false) {
  const def = makeDashboardDef();
  const real = def.analyses!['correlation'] as AnalysisModule;
  const wrapped: AnalysisModule = {
    ...real,
    run: (input, opts) =>
      real.run(input, {
        ...opts,
        sink: (h) => {
          try {
            opts?.sink?.({ ...h, pValue: pValue as number });
          } catch (error) {
            if (!swallow) throw error;
          }
        },
      }),
  };
  return buildDashboard({ ...def, analyses: { ...def.analyses, correlation: wrapped } }).createSession({ as: 'agent' });
}
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
});
