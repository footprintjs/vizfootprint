/**
 * Coverage packet (COV-trace) — `branch.test.ts` only ever calls
 * `runBranchingReplay()` with ZERO arguments (the default-parameter arm).
 * This closes the "a caller supplies their own log" arm.
 */

import { describe, expect, it } from 'vitest';
import { runBranchingReplay, BRANCHING_LOG } from './branching.fixture.js';
import type { CommitInput } from './log.js';

describe('runBranchingReplay — an explicit log argument overrides the BRANCHING_LOG default', () => {
  it('a caller-supplied log (same c1/c2/c2b id shape runBranchingReplay hardcodes its replay order on, different content) drives a genuinely different result', () => {
    // `runBranchingReplay`'s two `replayLog(serialized, [...])` calls hardcode
    // the path ids 'c1'/'c2'/'c2b' — so a caller-supplied log must reuse that
    // id shape to replay cleanly, but is otherwise free to vary field/value.
    const customLog: CommitInput[] = [
      {
        id: 'c1',
        parent: null,
        viewId: 'A',
        actorMeta: { actor: 'user' },
        kind: 'point',
        field: 'region', // different field than BRANCHING_LOG's 'category'
        value: 'North',
        cause: { requestedBy: 'user', computedBy: 'user' },
      },
      {
        id: 'c2',
        parent: 'c1',
        viewId: 'B',
        actorMeta: { actor: 'agent' },
        kind: 'interval',
        field: 'amount',
        value: [1, 2],
        cause: { requestedBy: 'agent', computedBy: 'agent' },
      },
      {
        id: 'c2b',
        parent: 'c1',
        viewId: 'B',
        actorMeta: { actor: 'agent' },
        kind: 'interval',
        field: 'amount',
        value: [3, 4],
        cause: { requestedBy: 'agent', computedBy: 'agent' },
      },
    ];

    const r = runBranchingReplay(customLog);
    expect(r.branchLow).toContain('A:("region" IN (\'North\'))');
    expect(r.branchLow).toContain('B:("amount" BETWEEN 1 AND 2)');
    expect(r.branchHigh).toContain('B:("amount" BETWEEN 3 AND 4)');
    expect(r.allReplayed).toBe(true);
    // proves the DEFAULT (BRANCHING_LOG) was NOT silently used instead.
    expect(r.branchLow).not.toContain('category');
  });

  it('the default argument (BRANCHING_LOG) is a genuinely different code path than passing it explicitly', () => {
    // calling with no args (default arm) and calling with BRANCHING_LOG
    // explicitly (argument arm) must produce byte-identical output — proving
    // the default really IS `BRANCHING_LOG`, not some other fallback.
    const viaDefault = runBranchingReplay();
    const viaExplicitArg = runBranchingReplay(BRANCHING_LOG);
    expect(viaExplicitArg.serialized).toBe(viaDefault.serialized);
    expect(viaExplicitArg.branchLow).toEqual(viaDefault.branchLow);
    expect(viaExplicitArg.branchHigh).toEqual(viaDefault.branchHigh);
  });
});
