/**
 * Coverage packet (COV-trace) — closes the branches `why.test.ts` /
 * `x3.test.ts` / `sanctioned-path.test.ts` never needed to exercise because
 * they only ever drove `why()` through a SUCCEEDING session or a fully
 * threaded x3 fixture. This file calls `why(target, sources)` DIRECTLY with
 * hand-built `WhySources` so every honest-miss / fallback branch inside
 * `why.ts` itself gets a real assertion (not just re-run through resolvers.ts
 * indirection):
 *
 *   - the VIZ-tier miss that makes `why()` itself return `WhyTargetMiss`
 *     (session always short-circuits this earlier — `why.ts`'s own
 *     `isMiss(viz)` branch is otherwise dead in every other test file);
 *   - a STALE input-selection id excluded by the log-membership check;
 *   - the KERNEL tier missing INSIDE `why()` (every session-level test
 *     always has a real kernel run);
 *   - the `key` anchor fallback to the target's own name for BOTH target
 *     kinds, when no kernel key was resolved;
 *   - `threaded` staying `false` when a correlationId IS supplied but the
 *     agent tier still misses (every other test with a correlationId also
 *     has a matching agent frame).
 */

import { describe, expect, it } from 'vitest';
import { CauseSelectionSession, type CommitRecord } from '../log/index.js';
import { why } from './index.js';
import type { WhySources, WhyTarget } from './index.js';
import { runKernel } from './kernel.fixture.js';

const cause = { requestedBy: 'user' as const, computedBy: 'user' as const };

function oneRecordLog(id: string): readonly CommitRecord[] {
  const s = new CauseSelectionSession();
  s.commit({
    id,
    parent: null,
    viewId: 'A',
    actorMeta: { actor: 'user' },
    kind: 'point',
    field: 'category',
    value: 'Data',
    cause,
  });
  return s.records;
}

/** A one-record log whose commit itself carries `correlationId` (viz tier resolves cleanly). */
function oneRecordLogWithCorrelation(id: string, correlationId: string): readonly CommitRecord[] {
  const s = new CauseSelectionSession();
  s.commit({
    id,
    parent: null,
    correlationId,
    viewId: 'A',
    actorMeta: { actor: 'user' },
    kind: 'point',
    field: 'category',
    value: 'Data',
    cause,
  });
  return s.records;
}

describe('why() — the VIZ-tier anchor miss (WhyTargetMiss), driven directly', () => {
  it('declaringCommitId absent from the log, no correlationId → ok:false no-such-target', () => {
    const target: WhyTarget = { kind: 'column', column: 'ghost' };
    const sources: WhySources = {
      vizRecords: oneRecordLog('real-commit'),
      declaringCommitId: 'never-committed',
      inputSelectionCommitIds: [],
    };
    const r = why(target, sources);
    expect(r).toEqual({ ok: false, missing: 'no-such-target', target });
  });

  it('empty log entirely → still an honest no-such-target, not a crash', () => {
    const target: WhyTarget = { kind: 'hypothesis', analysisId: 'ghost' };
    const r = why(target, { vizRecords: [], declaringCommitId: 'x', inputSelectionCommitIds: [] });
    expect(r).toEqual({ ok: false, missing: 'no-such-target', target });
  });
});

describe('why() — stale input-selection ids are validated against the log', () => {
  it('an id that never landed as a commit is silently excluded (never faked into the set)', () => {
    const s = new CauseSelectionSession();
    const declaring = s.commit({
      id: 'declaring', parent: null, viewId: 'A', actorMeta: { actor: 'user' },
      kind: 'point', field: 'category', value: 'Data', cause,
    }).record;
    const realSelection = s.commit({
      id: 'sel-real', parent: declaring.id, viewId: 'B', actorMeta: { actor: 'user' },
      kind: 'interval', field: 'amount', value: [1, 2], cause,
    }).record;

    const sources: WhySources = {
      vizRecords: s.records,
      declaringCommitId: declaring.id,
      // 'sel-stale' never appears in s.records — must be dropped, not faked.
      inputSelectionCommitIds: [realSelection.id, 'sel-stale'],
    };
    const r = why({ kind: 'column', column: 'cluster_id' }, sources);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const selectionIds = r.commits.filter((c) => c.kind === 'input-selection').map((c) => c.id);
    expect(selectionIds).toEqual([realSelection.id]); // exactly the real one
    expect(selectionIds).not.toContain('sel-stale');
  });
});

describe('why() — the kernel tier honestly misses INSIDE the composed answer', () => {
  it('no kernel run recorded at all: kernel:null, a typed miss, and no kernel-stage commits', () => {
    const s = new CauseSelectionSession();
    const declaring = s.commit({
      id: 'declaring', parent: null, viewId: 'A', actorMeta: { actor: 'user' },
      kind: 'point', field: 'category', value: 'Data', cause,
    }).record;
    const sources: WhySources = {
      vizRecords: s.records,
      declaringCommitId: declaring.id,
      inputSelectionCommitIds: [],
      kernelKey: 'rowCount', // a key was named, but no snapshot ever ran
    };
    const r = why({ kind: 'column', column: 'rowCount' }, sources);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kernel).toBeNull();
    expect(r.misses).toContainEqual({ tier: 'kernel', missing: 'no-kernel-snapshot' });
    expect(r.commits.some((c) => c.tier === 'kernel')).toBe(false);
    expect(r.flags.kernelRunIdAvailable).toBe(false); // kernel null → optional-chain fallback
  });

  it('a real snapshot but a key that never resolved: kernel-key-unresolved, still ok:true', async () => {
    const s = new CauseSelectionSession();
    const declaring = s.commit({
      id: 'declaring', parent: null, viewId: 'A', actorMeta: { actor: 'user' },
      kind: 'point', field: 'category', value: 'Data', cause,
    }).record;
    const kernel = await runKernel({ correlationId: 'k1', field: 'amount', range: [10, 20] });
    const sources: WhySources = {
      vizRecords: s.records,
      declaringCommitId: declaring.id,
      inputSelectionCommitIds: [],
      kernelSnapshot: kernel.snapshot,
      kernelKey: 'never-written-key',
    };
    const r = why({ kind: 'column', column: 'never-written-key' }, sources);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kernel).toBeNull();
    expect(r.misses).toContainEqual({ tier: 'kernel', missing: 'kernel-key-unresolved' });
  });
});

describe('why() — the anchor `key` falls back to the target\'s own name (no kernel key resolved)', () => {
  it('column target: key === target.column when sources.kernelKey is absent', () => {
    const declaring = oneRecordLog('declaring-col')[0]!;
    const r = why(
      { kind: 'column', column: 'my_col' },
      { vizRecords: [declaring], declaringCommitId: declaring.id, inputSelectionCommitIds: [] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.key).toBe('my_col');
  });

  it('hypothesis target: key === target.analysisId when sources.kernelKey is absent', () => {
    const declaring = oneRecordLog('declaring-hyp')[0]!;
    const r = why(
      { kind: 'hypothesis', analysisId: 'my-analysis' },
      { vizRecords: [declaring], declaringCommitId: declaring.id, inputSelectionCommitIds: [] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.key).toBe('my-analysis');
  });

  it('sources.kernelKey, when present, always wins over the target-derived fallback', () => {
    const declaring = oneRecordLog('declaring-key-wins')[0]!;
    const r = why(
      { kind: 'column', column: 'my_col' },
      { vizRecords: [declaring], declaringCommitId: declaring.id, inputSelectionCommitIds: [], kernelKey: 'explicit-key' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.key).toBe('explicit-key');
  });
});

describe('why() — threaded stays honestly false when a correlationId is supplied but the agent tier still misses', () => {
  it('correlationId present, no matching agent frame → threaded:false, correlationId still echoed', () => {
    const declaring = oneRecordLogWithCorrelation('declaring-corr', 'corr-unmatched')[0]!;
    const r = why(
      { kind: 'column', column: 'x' },
      {
        vizRecords: [declaring],
        declaringCommitId: declaring.id,
        inputSelectionCommitIds: [],
        correlationId: 'corr-unmatched',
        agentEventLog: [{ toolCallId: 't1', runId: 'r1', runtimeStageId: 's1', correlationId: 'corr-other' }],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.correlationId).toBe('corr-unmatched');
    expect(r.threaded).toBe(false); // correlationId present but the join never landed
    expect(r.agent).toBeNull();
    expect(r.misses).toContainEqual({ tier: 'agent', missing: 'no-agent-frame' });
  });

  it('correlationId present, NO agent event log at all → threaded:false, no-agent-tier miss', () => {
    const declaring = oneRecordLogWithCorrelation('declaring-corr2', 'corr-solo')[0]!;
    const r = why(
      { kind: 'column', column: 'x' },
      {
        vizRecords: [declaring],
        declaringCommitId: declaring.id,
        inputSelectionCommitIds: [],
        correlationId: 'corr-solo',
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.threaded).toBe(false);
    expect(r.misses).toContainEqual({ tier: 'agent', missing: 'no-agent-tier' });
  });
});
