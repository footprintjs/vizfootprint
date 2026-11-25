/**
 * A TEST CARRIES THE ROW IT GOT, AND A REPLAY CHECKS IT.
 *
 * A replay computes each carried row with the replaying session's own
 * procedure. Until the row was recorded, nothing could say whether that was
 * the row the test really got: a log replayed into a dashboard configured
 * differently was silently judged again, and could show a discovery the
 * original never made.
 *
 * | the log                                             | the replay says                              |
 * |-----------------------------------------------------|----------------------------------------------|
 * | whole, into the dashboard that made it              | nothing rejudged, nothing unchecked          |
 * | the same, after a JSON round trip                   | the same                                     |
 * | into another procedure or other settings            | each differing test, both rows, what differs |
 * | written before rows were recorded                   | every readable test unchecked                |
 * | a row that cannot be read (five ways)               | that test unchecked                          |
 * | a row with the wrong p-value                        | that test unchecked: not a row of this test  |
 * | an earlier test missing from the log                | later tests differ in `step`                 |
 * | a recorded verdict that is not the computed one     | `verdict`                                    |
 * | fields nobody knows beside the row's own            | dropped by the reader                        |
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { ledgerRowDifferences, ledgerRowToRecord, loggedTests, readLedgerRow, testActOf, type FdrStep } from '../fdr/index.js';
import type { CommitRecord } from '../log/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';

const cause = { requestedBy: 'agent', computedBy: 'system' } as const;
const fresh = () => buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
const investing = () => buildDashboard({ ...makeDashboardDef(), fdr: { procedure: 'alpha-investing', alpha: 0.05 } }).createSession({ as: 'agent' });
const stricter = () => buildDashboard({ ...makeDashboardDef(), fdr: { procedure: 'LORD++', alpha: 0.01 } }).createSession({ as: 'agent' });
const spec = {
  mark: { type: 'circle' },
  params: [{ name: 'b', select: { type: 'interval', encodings: ['x'] } }],
  encoding: { x: { field: 'price', type: 'quantitative' }, y: { field: 'rating', type: 'quantitative' } },
};
const judged = ({ step, alphaThreshold, reject, wealthBefore, wealthAfter }: FdrStep) => ({ step, alphaThreshold, reject, wealthBefore, wealthAfter });

/** Two tests — a tested analysis and an untested chart claim — among two acts that are not tests. */
async function original(make = fresh) {
  const s = make();
  await s.dispatch({ verb: 'analyze', analysisId: 'correlation', cause });
  await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
  await s.dispatch({ verb: 'analyze', analysisId: 'regression', cause });
  const chart = await s.proposeChart({ id: 'pr', spec, claim: 'price relates to rating' });
  if (!chart.ok) throw new Error('the fixture chart was refused');
  return s;
}

type Loose = { id: string; field: string; value: { ledgerRow?: Record<string, unknown> } & Record<string, unknown> };
const editable = (records: readonly CommitRecord[]) => structuredClone(records) as unknown as Loose[];
const testsOf = (log: Loose[]) => log.filter((r) => r.field === 'pValue');

describe('a test commit carries the row it got', () => {
  it('every test in the log holds its own ledger row, an analysis and a chart claim alike', async () => {
    const source = await original();
    const rows = loggedTests(source.log.records).map((t) => t.act?.ledgerRow);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(source.ledger());
    // exactly the known fields: nothing `undefined` is written to the log
    for (const row of rows) expect(Object.values(row!)).not.toContain(undefined);
  });

  it('an act that is not a test carries none', async () => {
    const source = await original();
    const others = source.log.records.filter((r) => r.field !== 'pValue');
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) expect(JSON.stringify(r.value ?? null)).not.toContain('ledgerRow');
  });
});

describe('a replay checks each carried row against the recorded one', () => {
  it('whole, into the dashboard that made it: nothing rejudged, nothing unchecked', async () => {
    const source = await original();
    const res = await fresh().replay(source.log.records);
    expect(res.ok && res.tests).toEqual({ carried: 2, unreadable: [], rejudged: [], unchecked: [] });
  });

  it('the same after the log has been through JSON', async () => {
    const source = await original();
    const res = await fresh().replay(JSON.parse(JSON.stringify(source.log.records)) as CommitRecord[]);
    expect(res.ok && res.tests).toEqual({ carried: 2, unreadable: [], rejudged: [], unchecked: [] });
  });

  it('the same under alpha-investing', async () => {
    const source = await original(investing);
    const res = await investing().replay(source.log.records);
    expect(res.ok && res.tests).toEqual({ carried: 2, unreadable: [], rejudged: [], unchecked: [] });
  });

  it('into another procedure: each differing test is listed with the row it got and the row computed here', async () => {
    const source = await original();
    const other = investing();
    const res = await other.replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tests.rejudged.length).toBeGreaterThan(0);
    const tests = loggedTests(source.log.records);
    for (const r of res.tests.rejudged) {
      const at = tests.findIndex((t) => t.commitId === r.commitId);
      expect(r.recorded).toEqual(source.ledger()[at]); // what the test really got
      expect(r.computed).toBe(other.ledger()[at]); // what this session holds
      expect(r.differs).toEqual(ledgerRowDifferences(r.recorded, r.computed));
      expect(r.differs.length).toBeGreaterThan(0);
    }
    // …and every test NOT listed agrees
    const listed = new Set(res.tests.rejudged.map((r) => r.commitId));
    tests.forEach((t, at) => {
      if (!listed.has(t.commitId)) expect(judged(other.ledger()[at]!)).toEqual(judged(source.ledger()[at]!));
    });
  });

  it('into the same procedure with a smaller budget: the threshold and the budget differ, the position does not', async () => {
    const source = await original();
    const res = await stricter().replay(source.log.records);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tests.rejudged).toHaveLength(2);
    for (const r of res.tests.rejudged) {
      expect(r.differs).toContain('threshold');
      expect(r.differs).toContain('budget');
      expect(r.differs).not.toContain('step');
    }
  });

  it('a log written before rows were recorded: every readable test is unchecked, none is called rejudged', async () => {
    const source = await original();
    const log = editable(source.log.records);
    for (const t of testsOf(log)) delete t.value.ledgerRow;
    const replayed = investing(); // a dashboard that WOULD differ, and has nothing to be checked against
    const res = await replayed.replay(log as never);
    expect(res.ok && res.tests).toEqual({ carried: 2, unreadable: [], rejudged: [], unchecked: testsOf(log).map((t) => t.id) });
  });

  it.each([
    ['not an object', () => 'row'],
    ['an array', () => []],
    ['a position that is not a count', (row: Record<string, unknown>) => ({ ...row, step: 0 })],
    ['no name', (row: Record<string, unknown>) => ({ ...row, hypothesisId: '' })],
    ['a threshold that is not a number', (row: Record<string, unknown>) => ({ ...row, alphaThreshold: 'low' })],
    ['a budget that is not finite', (row: Record<string, unknown>) => ({ ...row, wealthAfter: null })],
    ['a verdict that is not yes or no', (row: Record<string, unknown>) => ({ ...row, reject: 1 })],
    ['a branch that is not a name', (row: Record<string, unknown>) => ({ ...row, branchId: 7 })],
    ['a clock that is not a number', (row: Record<string, unknown>) => ({ ...row, timestamp: 'now' })],
    ['a first-discovery mark that is not yes or no', (row: Record<string, unknown>) => ({ ...row, firstRejection: 'no' })],
    ['another test’s p-value', (row: Record<string, unknown>) => ({ ...row, pValue: 0.5 })],
  ])('a row that is %s is not a row: the test is unchecked, and still carried', async (_what, spoil) => {
    const source = await original();
    const log = editable(source.log.records);
    const first = testsOf(log)[0]!;
    first.value.ledgerRow = spoil(first.value.ledgerRow!) as never;
    const res = await fresh().replay(log as never);
    expect(res.ok && res.tests).toEqual({ carried: 2, unreadable: [], rejudged: [], unchecked: [first.id] });
  });

  it('an earlier test missing from the log: the later tests are in another position, and it says so', async () => {
    const source = await original();
    const first = loggedTests(source.log.records)[0]!.commitId;
    // the first test's commit made into an ordinary act: the act stays, the test is gone from the log
    const log = editable(source.log.records);
    const gone = log.find((r) => r.id === first)!;
    gone.field = '__analysis__';
    const res = await fresh().replay(log as never);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tests.carried).toBe(1);
    expect(res.tests.rejudged).toHaveLength(1);
    for (const r of res.tests.rejudged) expect(r.differs).toContain('step');
  });

  it('a recorded verdict that is not the computed one is a difference in the verdict', async () => {
    const source = await original();
    const log = editable(source.log.records);
    const first = testsOf(log)[0]!;
    first.value.ledgerRow = { ...first.value.ledgerRow!, reject: !first.value.ledgerRow!.reject };
    const replayed = fresh();
    const res = await replayed.replay(log as never);
    expect(res.ok && res.tests.rejudged.map((r) => [r.commitId, r.differs])).toEqual([[first.id, ['verdict']]]);
    // the ledger holds the row this session computed, never the recorded claim
    expect(replayed.ledger()[0]!.reject).toBe(source.ledger()[0]!.reject);
  });

  it('a branch name on the recorded row is carried onto the row computed here', async () => {
    const source = await original();
    const log = editable(source.log.records);
    const first = testsOf(log)[0]!;
    first.value.ledgerRow = { ...first.value.ledgerRow!, branchId: 'side' };
    const replayed = fresh();
    const res = await replayed.replay(log as never);
    expect(res.ok && res.tests.rejudged).toEqual([]);
    expect(replayed.ledger()[0]!.branchId).toBe('side');
    expect(replayed.ledger()[1]!.branchId).toBeUndefined();
  });

  it('what the replay hands out cannot be edited', async () => {
    const source = await original();
    const res = await stricter().replay(source.log.records);
    if (!res.ok) throw new Error('refused');
    expect(Object.isFrozen(res.tests.rejudged[0])).toBe(true);
    expect(Object.isFrozen(res.tests.rejudged[0]!.recorded)).toBe(true);
    expect(Object.isFrozen(res.tests.rejudged[0]!.computed)).toBe(true);
  });

  it('a session replayed and then carried on writes rows a second replay agrees with', async () => {
    const source = await original();
    const middle = fresh();
    await middle.replay(source.log.records);
    await middle.dispatch({ verb: 'analyze', analysisId: 'correlation', cause });
    expect(middle.ledger()).toHaveLength(3);
    const res = await fresh().replay(middle.log.records);
    expect(res.ok && res.tests).toEqual({ carried: 3, unreadable: [], rejudged: [], unchecked: [] });
  });
});

describe('the one reader of a recorded row', () => {
  const row: FdrStep = { step: 2, hypothesisId: 'h', pValue: 0.2, timestamp: 5, alphaThreshold: 0.01, reject: false, wealthBefore: 0.02, wealthAfter: 0.01, firstRejection: false };

  it('returns the known fields and nothing else', () => {
    expect(readLedgerRow({ ...row, note: 'a discovery, trust me', branchId: undefined }, 0.2)).toEqual(row);
    expect(Object.keys(readLedgerRow({ ...row, note: 'x' }, 0.2)!)).not.toContain('note');
    expect(readLedgerRow({ ...row, branchId: 'b1' }, 0.2)).toEqual({ ...row, branchId: 'b1' });
  });

  it('refuses nothing loudly: a value that is not a row is no row', () => {
    for (const bad of [undefined, null, 3, 'row', [], {}, { ...row, step: 1.5 }, { ...row, step: -1 }, { ...row, wealthBefore: Number.NaN }]) {
      expect(readLedgerRow(bad, 0.2)).toBeUndefined();
    }
    expect(readLedgerRow(row, 0.3)).toBeUndefined();
  });

  it('what a session writes is what the reader reads back, and a row it would not read is not written', () => {
    expect(ledgerRowToRecord({ ...row, branchId: undefined } as FdrStep)).toEqual({ ledgerRow: row });
    expect(Object.keys(ledgerRowToRecord({ ...row, branchId: undefined } as FdrStep).ledgerRow!)).not.toContain('branchId');
    expect(ledgerRowToRecord({ ...row, wealthAfter: Number.POSITIVE_INFINITY })).toEqual({});
  });

  it('an act with an unreadable row is still a readable test', () => {
    expect(testActOf({ id: 'a', table: 't', pValue: 0.2, ledgerRow: 'gone' })).toEqual({ id: 'a', table: 't', pValue: 0.2 });
    expect(testActOf({ id: 'a', table: 't', pValue: 0.2, ledgerRow: row })).toEqual({ id: 'a', table: 't', pValue: 0.2, ledgerRow: row });
  });
});

describe('what counts as a difference between two rows', () => {
  const row: FdrStep = { step: 2, hypothesisId: 'h', pValue: 0.2, timestamp: 5, alphaThreshold: 0.01, reject: false, wealthBefore: 0.02, wealthAfter: 0.01, firstRejection: false };

  it.each([
    ['nothing', {}, []],
    ['the clock', { timestamp: 99 }, []],
    ['the name', { hypothesisId: 'other' }, []],
    ['the branch', { branchId: 'b' }, []],
    ['the first-discovery mark', { firstRejection: true }, []],
    ['the position', { step: 3 }, ['step']],
    ['the threshold', { alphaThreshold: 0.02 }, ['threshold']],
    ['the verdict', { reject: true }, ['verdict']],
    ['the budget before', { wealthBefore: 0.03 }, ['budget']],
    ['the budget after', { wealthAfter: 0 }, ['budget']],
    ['everything', { step: 1, alphaThreshold: 1, reject: true, wealthBefore: 1, wealthAfter: 1 }, ['step', 'threshold', 'verdict', 'budget']],
  ] as const)('%s', (_what, change, expected) => {
    expect(ledgerRowDifferences(row, { ...row, ...change })).toEqual(expected);
  });

  it('two engines’ last bits are not a difference; a ninth digit is', () => {
    expect(ledgerRowDifferences(row, { ...row, alphaThreshold: 0.01 * (1 + 1e-13) })).toEqual([]);
    expect(ledgerRowDifferences(row, { ...row, alphaThreshold: 0.01 * (1 + 1e-7) })).toEqual(['threshold']);
    expect(ledgerRowDifferences({ ...row, wealthAfter: 0 }, { ...row, wealthAfter: 0 })).toEqual([]);
    expect(ledgerRowDifferences({ ...row, wealthAfter: 0 }, { ...row, wealthAfter: 1e-12 })).toEqual(['budget']);
  });
});
