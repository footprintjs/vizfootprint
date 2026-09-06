/**
 * `hypothesisRecordsFromLog` / `branchIdFromLog` — the L1 -> L4 adapter that
 * retires `spikes/x2-fdr/commit-log-stub.ts`. Exercises the adapter directly
 * against a REAL `CauseSelectionSession` (the same class `src/log/log.test.ts`
 * and `spikes/x2-fdr/scenario.ts` author against), not a hand-rolled fixture.
 */

import { describe, it, expect } from 'vitest';
import { CauseSelectionSession } from '../log/index.js';
import { hypothesisRecordsFromLog, branchIdFromLog, testActOf } from './fromLog.js';

/** The test lane's value: the ACT (which analysis, over which table) and the p it made. */
const act = (pValue: unknown, over = 'data'): unknown => ({ id: 'corr', table: over, pValue });

describe('hypothesisRecordsFromLog — L1 CommitRecord -> HypothesisRecord', () => {
  it('R6 analog: ordinary brushes (point/interval, not field "pValue") emit ZERO hypotheses', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'brush-1',
      parent: null,
      viewId: 'amountAxis',
      actorMeta: { actor: 'user' },
      kind: 'interval',
      field: 'amount',
      value: [10, 20],
      cause: { requestedBy: 'user', computedBy: 'user' },
    });
    session.commit({
      id: 'brush-2',
      parent: 'brush-1',
      viewId: 'categoryChart',
      actorMeta: { actor: 'user' },
      kind: 'point',
      field: 'category',
      value: 'Data',
      cause: { requestedBy: 'user', computedBy: 'user' },
    });

    expect(hypothesisRecordsFromLog(session.records)).toEqual([]);
  });

  it('a point commit on field "pValue" IS a declared-analysis test emission', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'test-1',
      parent: null,
      correlationId: 'corr:amount:size',
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'pValue',
      value: act(0.0123),
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: 7,
    });

    const stream = hypothesisRecordsFromLog(session.records);
    expect(stream).toEqual([
      { hypothesisId: 'corr:amount:size', pValue: 0.0123, timestamp: 7 },
    ]);
  });

  it('hypothesisId falls back to the commit id when correlationId is absent', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'test-only-id',
      parent: null,
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'pValue',
      value: act(0.4),
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: 1,
    });

    expect(hypothesisRecordsFromLog(session.records)[0]!.hypothesisId).toBe('test-only-id');
  });

  it('an out-of-range or non-numeric "pValue" value is NOT read as a test emission (honest skip, not a fabricated record)', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'weird',
      parent: null,
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'pValue',
      value: act(1.5), // out of [0,1]
      cause: { requestedBy: 'agent', computedBy: 'system' },
    });
    expect(hypothesisRecordsFromLog(session.records)).toEqual([]);
  });

  it('an UNFORKED linear chain gets NO branch label (nothing to disambiguate)', () => {
    const session = new CauseSelectionSession();
    let parent: string | null = null;
    for (let i = 0; i < 5; i++) {
      const id = `t${i}`;
      session.commit({
        id,
        parent,
        viewId: 'analysisPanel',
        actorMeta: { actor: 'system' },
        kind: 'point',
        field: 'pValue',
        value: act(0.5),
        cause: { requestedBy: 'agent', computedBy: 'system' },
        ts: i + 1,
      });
      parent = id;
    }
    const stream = hypothesisRecordsFromLog(session.records);
    expect(stream).toHaveLength(5);
    for (const h of stream) expect(h.branchId).toBeUndefined();
  });

  it('a fork produces two distinct, stable branch labels — the L1 analog of branch.test.ts siblings', () => {
    // root -> {main-1, abandoned-1}; main-1 -> main-2; abandoned-1 -> abandoned-2.
    const session = new CauseSelectionSession();
    session.commit({
      id: 'root',
      parent: null,
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'origin', // not a test-analog commit — a plain fork-point marker
      value: null,
      cause: { requestedBy: 'agent', computedBy: 'system' },
    });
    for (const [id, parent] of [
      ['main-1', 'root'],
      ['abandoned-1', 'root'],
      ['main-2', 'main-1'],
      ['abandoned-2', 'abandoned-1'],
    ] as const) {
      session.commit({
        id,
        parent,
        viewId: 'analysisPanel',
        actorMeta: { actor: 'system' },
        kind: 'point',
        field: 'pValue',
        value: act(0.5),
        cause: { requestedBy: 'agent', computedBy: 'system' },
      });
    }

    const branches = branchIdFromLog(session.records);
    expect(branches.get('root')).toBeUndefined(); // predates the fork — on neither branch
    expect(branches.get('main-1')).toBe('main-1');
    expect(branches.get('main-2')).toBe('main-1'); // inherits its lineage's fork-entry id
    expect(branches.get('abandoned-1')).toBe('abandoned-1');
    expect(branches.get('abandoned-2')).toBe('abandoned-1');

    const stream = hypothesisRecordsFromLog(session.records);
    expect(stream.map((h) => h.branchId)).toEqual(['main-1', 'abandoned-1', 'main-1', 'abandoned-1']);
  });

  it('output order follows LOG arrival order (records push order), independent of parent-chain topology', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'root', parent: null, viewId: 'v', actorMeta: { actor: 'system' },
      kind: 'point', field: 'origin', value: null,
      cause: { requestedBy: 'agent', computedBy: 'system' },
    });
    // Author interleaved: main, abandoned, main, abandoned — arrival order.
    session.commit({
      id: 'main-1', parent: 'root', viewId: 'v', actorMeta: { actor: 'system' },
      kind: 'point', field: 'pValue', value: act(0.1), cause: { requestedBy: 'agent', computedBy: 'system' }, ts: 1,
    });
    session.commit({
      id: 'abandoned-1', parent: 'root', viewId: 'v', actorMeta: { actor: 'system' },
      kind: 'point', field: 'pValue', value: act(0.2), cause: { requestedBy: 'agent', computedBy: 'system' }, ts: 2,
    });
    session.commit({
      id: 'main-2', parent: 'main-1', viewId: 'v', actorMeta: { actor: 'system' },
      kind: 'point', field: 'pValue', value: act(0.3), cause: { requestedBy: 'agent', computedBy: 'system' }, ts: 3,
    });

    const stream = hypothesisRecordsFromLog(session.records);
    expect(stream.map((h) => h.pValue)).toEqual([0.1, 0.2, 0.3]);
    expect(stream.map((h) => h.timestamp)).toEqual([1, 2, 3]);
  });
});

describe('testActOf — the reader of the test lane, on everything it can be handed', () => {
  it('reads the act and its p, and refuses everything that is not one', () => {
    expect(testActOf({ id: 'corr', table: 'data', pValue: 0.01 })).toEqual({ id: 'corr', table: 'data', pValue: 0.01 });
    expect(testActOf({ id: 'corr', table: 'data', pValue: 0 })).toEqual({ id: 'corr', table: 'data', pValue: 0 });
    expect(testActOf({ id: 'corr', table: 'data', pValue: 1 })).toEqual({ id: 'corr', table: 'data', pValue: 1 });
    // the shape before this law: a bare number names neither the analysis nor
    // the table, so it is not a record of the act — no alias, no fallback
    expect(testActOf(0.01)).toBeUndefined();
    expect(testActOf(null)).toBeUndefined();
    expect(testActOf(['corr', 'data', 0.01])).toBeUndefined();
    expect(testActOf({ table: 'data', pValue: 0.01 })).toBeUndefined();
    expect(testActOf({ id: '', table: 'data', pValue: 0.01 })).toBeUndefined();
    expect(testActOf({ id: 'corr', pValue: 0.01 })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: 7, pValue: 0.01 })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: '', pValue: 0.01 })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: 'data' })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: 'data', pValue: '0.01' })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: 'data', pValue: Number.NaN })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: 'data', pValue: -0.1 })).toBeUndefined();
    expect(testActOf({ id: 'corr', table: 'data', pValue: 1.5 })).toBeUndefined();
  });
});
