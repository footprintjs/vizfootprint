/**
 * Branching-replay test (R8) — the append-only log supports divergent timelines,
 * and each branch replays deterministically into its own fresh Selection.
 *
 * Promoted from spikes/x1-replay/branch.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { runBranchingReplay, BRANCHING_LOG } from './branching.fixture.js';
import { replayLog, serializeLog, CauseSelectionSession } from './log.js';

describe('R8 — branching timelines replay independently', () => {
  it('two sibling branches off c1 produce different, deterministic selections', () => {
    const r = runBranchingReplay();

    // both branches keep A's Data pick; B differs per branch
    expect(r.branchLow).toContain('A:("category" IN (\'Data\'))');
    expect(r.branchHigh).toContain('A:("category" IN (\'Data\'))');
    expect(r.branchLow).toContain('B:("amount" BETWEEN 10 AND 20)');
    expect(r.branchHigh).toContain('B:("amount" BETWEEN 50 AND 60)');
    expect(r.branchLow).not.toEqual(r.branchHigh);

    // every replayed commit is marked replayed:true (R2)
    expect(r.allReplayed).toBe(true);
  });

  it('same branch path replays byte-identically twice (determinism)', () => {
    const live = new CauseSelectionSession();
    for (const c of BRANCHING_LOG) live.commit(c);
    const json = serializeLog(live.records);

    const a = replayLog(json, ['c1', 'c2b']);
    const b = replayLog(json, ['c1', 'c2b']);
    expect(serializeLog(a.records)).toBe(serializeLog(b.records));
  });

  it('an unknown commit id in the replay path is rejected', () => {
    const live = new CauseSelectionSession();
    for (const c of BRANCHING_LOG) live.commit(c);
    expect(() => replayLog(serializeLog(live.records), ['c1', 'nope'])).toThrow();
  });

  it('a branch cannot resurrect a sibling that was never on its path (R8 isolation)', () => {
    // c2 and c2b are siblings off c1. Replaying the c2b branch must NEVER
    // pull in c2's commit — branches are isolated timelines, not merges.
    const live = new CauseSelectionSession();
    for (const c of BRANCHING_LOG) live.commit(c);
    const json = serializeLog(live.records);

    const high = replayLog(json, ['c1', 'c2b']);
    expect(high.records.map((r) => r.id)).toEqual(['c1', 'c2b']);
    expect(high.records.some((r) => r.id === 'c2')).toBe(false);
  });
});
