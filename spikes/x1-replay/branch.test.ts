/**
 * Branching-replay test (R8) — the append-only log supports divergent timelines,
 * and each branch replays deterministically into its own fresh Selection.
 */

import { describe, it, expect } from 'vitest';
import { runSpike, BRANCHING_LOG } from './replay.spike.js';
import { replayLog, serializeLog, CauseSelectionSession } from './log.js';

describe('R8 — branching timelines replay independently', () => {
  it('two sibling branches off c1 produce different, deterministic selections', () => {
    const r = runSpike();

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
});
