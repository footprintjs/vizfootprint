/**
 * fromLog.coverage.test.ts — closes the remaining gap in `branchIdFromLog`'s
 * `resolve()`: a record whose `parent` id is NOT itself present in the
 * `records` array passed in (a dangling/unresolvable ancestor reference —
 * e.g. a caller passing a SLICE of a longer log). `fromLog.test.ts` only ever
 * exercises fully self-contained record sets; this is the honest "can't
 * resolve further" edge the `!rec` guard exists for.
 */

import { describe, it, expect } from 'vitest';
import { CauseSelectionSession } from '../log/index.js';
import { branchIdFromLog, hypothesisRecordsFromLog } from './fromLog.js';

describe('branchIdFromLog — a dangling ancestor reference (parent id absent from the given records)', () => {
  it('resolves to undefined rather than throwing, for both the child and (recursively) the missing parent', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'child',
      parent: 'missing-parent', // never committed — NOT in session.records
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'pValue',
      value: 0.5,
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: 1,
    });

    const branches = branchIdFromLog(session.records);
    // 'child' has exactly one record in `records`, so childrenOf(parent) has
    // length 1 (not a fork) — it must recurse toward its parent. That parent
    // is unresolvable (not in `records`), so the WHOLE lineage is honestly
    // "nothing to disambiguate" — same undefined a normal unforked chain gets.
    expect(branches.get('child')).toBeUndefined();

    const stream = hypothesisRecordsFromLog(session.records);
    expect(stream).toHaveLength(1);
    expect(stream[0]!.branchId).toBeUndefined();
  });

  it('a dangling ancestor two levels up is still resolved honestly (recursion terminates without throwing)', () => {
    const session = new CauseSelectionSession();
    session.commit({
      id: 'grandchild',
      parent: 'child-2',
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'pValue',
      value: 0.1,
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: 1,
    });
    session.commit({
      id: 'child-2',
      parent: 'missing-root', // dangling
      viewId: 'analysisPanel',
      actorMeta: { actor: 'system' },
      kind: 'point',
      field: 'pValue',
      value: 0.2,
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: 2,
    });

    expect(() => branchIdFromLog(session.records)).not.toThrow();
    const branches = branchIdFromLog(session.records);
    expect(branches.get('grandchild')).toBeUndefined();
    expect(branches.get('child-2')).toBeUndefined();
  });
});
