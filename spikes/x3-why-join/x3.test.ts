/**
 * X3 acceptance — the R10 kill-test for `why(x)` across viz → agent → kernel.
 *
 * H2: `whyRowCount(x)` traverses tiers as a JOIN over EXISTING slicers
 * (footprintjs sliceForKey + the agent tool-call frame + the viz cause-log),
 * returning the MINIMAL commit set x depends on, IFF one correlationId threads
 * every tier. These tests were written to the acceptance criteria FIRST.
 *
 *   A1 — composed slice == the hand-computed minimal set (listed explicitly).
 *   A2 — decoys excluded: 2 unrelated viz commits, 1 unrelated agent tool call,
 *        1 unrelated kernel stage write.
 *   A3 — the slice is machine-shaped (commit ids + tier tags), not prose.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildChain, type Chain } from './chain.js';
import { whyRowCount, type CrossTierSlice } from './whyJoin.js';

let chain: Chain;
let result: CrossTierSlice;

beforeAll(async () => {
  chain = await buildChain();
  const r = whyRowCount(chain.tracked, chain);
  if ('missing' in r) throw new Error(`expected a slice, got miss: ${r.missing}`);
  result = r;
});

describe('A1 — composed slice equals the hand-computed minimal set', () => {
  it('the join key threaded end to end (kernel committed state carries it)', () => {
    expect(result.threaded).toBe(true);
    expect(result.correlationId).toBe('corr-amt-1');
  });

  it('kernel minimal set is EXACTLY {load, filter, count}, anchored at count', () => {
    // Hand-computed: rowCount ← filtered ← rows/filterField/filterRange ← input.
    // 'decoy' (writes auditNote, read by nobody) is NOT on that chain.
    const HAND_COMPUTED_KERNEL_STAGES = ['count', 'filter', 'load'];
    expect([...result.kernel.stageIds].sort()).toEqual(HAND_COMPUTED_KERNEL_STAGES);
    // anchor writer is the compute-rowCount stage.
    const nodes = chain.joinTable.get('corr-amt-1')!;
    expect(nodes.kernel.rowCount).toBe(3); // amounts 12,15,18 ∈ [10,20]
    expect(result.kernel.writerId.startsWith('count#')).toBe(true);
  });

  it('agent frame is the corr-amt-1 tool call; viz commit resolved by its correlationId FIELD', () => {
    expect(result.agent.toolCallId).toBe('call-corr-amt-1');
    expect(result.agent.runtimeStageId.length).toBeGreaterThan(0);
    expect(result.agent.runId.length).toBeGreaterThan(0);
    // D20/P3: the commit id is identity-only — the join key rides in the
    // first-class field, so id !== correlationId by construction now.
    expect(result.viz.commitId).toBe('viz-corr-amt-1');
    expect(result.viz.commitId).not.toBe(result.correlationId);
  });

  it('the composed cross-tier set is exactly the hand-listed commits', () => {
    // The explicit minimal set, one entry per tier commit.
    const composed = result.commits
      .map((c) => `${c.tier}:${c.stageId ?? c.id}`)
      .sort();
    const EXPECTED = [
      'viz:viz-corr-amt-1', // own id; joined via CommitRecord.correlationId
      'agent:call-corr-amt-1', // agent commit id = toolCallId (unambiguous)
      'kernel:count',
      'kernel:filter',
      'kernel:load',
    ].sort();
    expect(composed).toEqual(EXPECTED);
  });

  it('the viz commit carries the join key as a FIRST-CLASS field (no id overload)', () => {
    const vizRecord = chain.vizRecords.find((r) => r.correlationId === 'corr-amt-1');
    expect(vizRecord).toBeDefined();
    expect(vizRecord!.id).toBe('viz-corr-amt-1');
    expect(vizRecord!.correlationId).toBe('corr-amt-1');
    expect(vizRecord!.id).not.toBe(vizRecord!.correlationId);
    // commits that never joined a cross-tier run simply have NO key.
    const decoyCat = chain.vizRecords.find((r) => r.id === 'decoy-cat');
    expect(decoyCat).toBeDefined();
    expect(decoyCat!.correlationId).toBeUndefined();
  });
});

describe('A2 — decoys are excluded from the slice', () => {
  it('DECOY viz commits (user category + the other question) never appear', () => {
    const ids = new Set(result.commits.map((c) => c.id));
    for (const decoyId of chain.decoyVizCommitIds) {
      expect(ids.has(decoyId)).toBe(false);
    }
    expect(result.viz.commitId).not.toBe('decoy-cat');
    expect(result.viz.commitId).not.toBe('viz-corr-amt-2');
  });

  it('the DECOY agent tool call (corr-amt-2) never appears', () => {
    const decoyRec = chain.joinTable.get('corr-amt-2')!;
    expect(decoyRec.agent.toolCallId).toBe('call-corr-amt-2'); // it exists...
    // ...and is excluded — discriminated by the UNAMBIGUOUS ids (toolCallId, runId).
    expect(result.agent.toolCallId).toBe('call-corr-amt-1');
    expect(result.agent.toolCallId).not.toBe(decoyRec.agent.toolCallId);
    expect(result.agent.runId).not.toBe(decoyRec.agent.runId);
    const ids = new Set(result.commits.map((c) => c.id));
    expect(ids.has(decoyRec.agent.toolCallId)).toBe(false);

    // HONEST FINDING recorded as an assertion: runtimeStageId is NOT a valid
    // cross-run discriminator — it collides across independent agent runs.
    expect(decoyRec.agent.runtimeStageId).toBe(result.agent.runtimeStageId);
  });

  it('the DECOY kernel stage write (auditNote / decoy stage) is excluded', () => {
    // The `decoy` stage DID run and DID write `auditNote` in the tracked run...
    const trackedLog = chain.joinTable.get('corr-amt-1')!.kernel.snapshot.commitLog;
    const decoyStageRan = trackedLog.some((b) => b.stageId === 'decoy');
    const auditNoteWritten = trackedLog.some((b) => 'auditNote' in b.overwrite);
    expect(decoyStageRan).toBe(true);
    expect(auditNoteWritten).toBe(true);
    // ...but it is NOT a rowCount dependency, so the slice excludes it.
    expect(result.kernel.stageIds).not.toContain('decoy');
    // every commit in the slice traces to the TRACKED run's own commit log.
    const trackedIds = new Set(trackedLog.map((b) => b.runtimeStageId));
    for (const id of result.kernel.commitIds) expect(trackedIds.has(id)).toBe(true);
  });
});

describe('A3 — the composed slice is machine-shaped, not prose', () => {
  it('every commit is an {tier, id} record with a known tier tag', () => {
    for (const c of result.commits) {
      expect(['viz', 'agent', 'kernel']).toContain(c.tier);
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
    }
  });

  it('carries no free-text / prose fields (ids + tags only)', () => {
    const serialized = JSON.stringify(result);
    // none of the human-facing strings from any tier leak into the answer
    expect(serialized).not.toContain('agent brushes'); // viz cause.intent
    expect(serialized).not.toContain('Filtered'); // agent final answer
    expect(serialized).not.toContain('load rows'); // kernel stage NAME (we keep stageId, not name)
    // it IS a structured object with the expected machine keys
    expect(Object.keys(result).sort()).toEqual(
      ['agent', 'commits', 'correlationId', 'kernel', 'key', 'threaded', 'viz'].sort(),
    );
  });
});
