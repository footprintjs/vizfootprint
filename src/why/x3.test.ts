/**
 * X3 acceptance — PROMOTED (P3-L6) from `spikes/x3-why-join/x3.test.ts`.
 *
 * The R10 kill-test for `why()` across viz → agent → kernel, now driving the
 * PROMOTED `why(target, sources)` (not the spike's hard-coded `whyRowCount`).
 * Generalisation proof (adjudication C2): `rowCount` is asked as an ordinary
 * `{kind:'column', column:'rowCount'}` target — the SAME `why()` the session
 * uses for `cluster_id` and correlation hypotheses.
 *
 *   A1 — composed slice == the hand-computed minimal set (listed explicitly).
 *   A2 — decoys excluded: 2 unrelated viz commits, 1 unrelated agent tool call,
 *        1 unrelated kernel stage write (minimality, not just reachability).
 *   A3 — the slice is machine-shaped (commit ids + tier tags), never prose.
 *
 * The agent tier consumes SANCTIONED `EventMeta`-shaped frames (C4 — the join
 * key rides in the `correlationId` field, NOT tool args); the sanctioned path
 * over a real agentfootprint run is proven in `sanctioned-path.test.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { CauseSelectionSession, type CommitRecord } from '../log/index.js';
import { why } from './index.js';
import type { AgentEventFrame, CrossTierSlice, WhySources } from './index.js';
import { runKernel, type KernelResult } from './kernel.fixture.js';

const TRACKED = 'corr-amt-1';
const DECOY_Q = 'corr-amt-2';

let vizRecords: readonly CommitRecord[];
let kernel: KernelResult;
let decoyKernel: KernelResult;
let agentEventLog: AgentEventFrame[];
let result: CrossTierSlice;

beforeAll(async () => {
  // ── viz tier — a small cause-log with the tracked brush + two decoys ──────────
  const viz = new CauseSelectionSession();
  let head: string | null = null;
  // DECOY viz commit #1 — a user category point-select, unrelated to any run.
  const decoyCat = viz.commit({
    id: 'decoy-cat', parent: head, viewId: 'A',
    actorMeta: { actor: 'user', label: 'Category picker' },
    kind: 'point', field: 'category', value: 'Ops',
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'user clicks Ops' },
  });
  head = decoyCat.record.id;
  // The TRACKED brush — carries the join key as its FIRST-CLASS field (id !== key).
  viz.commit({
    id: `viz-${TRACKED}`, correlationId: TRACKED, parent: head, viewId: 'B',
    actorMeta: { actor: 'agent', label: 'Amount brush' },
    kind: 'interval', field: 'amount', value: [10, 20],
    cause: { requestedBy: 'agent', computedBy: 'system', intent: 'agent brushes amount 10..20' },
  });
  // DECOY viz commit #2 — the OTHER question's brush (its whole trail is excluded).
  viz.commit({
    id: `viz-${DECOY_Q}`, correlationId: DECOY_Q, parent: `viz-${TRACKED}`, viewId: 'B',
    actorMeta: { actor: 'agent', label: 'Amount brush' },
    kind: 'interval', field: 'amount', value: [40, 50],
    cause: { requestedBy: 'agent', computedBy: 'system', intent: 'agent brushes amount 40..50' },
  });
  vizRecords = viz.records;

  // ── kernel tier — one real footprintjs run per question ───────────────────────
  kernel = await runKernel({ correlationId: TRACKED, field: 'amount', range: [10, 20] });
  decoyKernel = await runKernel({ correlationId: DECOY_Q, field: 'amount', range: [40, 50] });

  // ── agent tier — SANCTIONED EventMeta-shaped frames (join key in the field) ────
  // Both frames share runtimeStageId 'tool-calls#22' (the honest collision) but
  // differ by runId + correlationId — the DECOY frame is discriminated by those.
  agentEventLog = [
    { toolCallId: `call-${TRACKED}`, runId: 'run-A', runtimeStageId: 'tool-calls#22', correlationId: TRACKED },
    { toolCallId: `call-${DECOY_Q}`, runId: 'run-B', runtimeStageId: 'tool-calls#22', correlationId: DECOY_Q },
  ];

  const sources: WhySources = {
    vizRecords,
    declaringCommitId: `viz-${TRACKED}`,
    inputSelectionCommitIds: [],
    kernelSnapshot: kernel.snapshot,
    kernelKey: 'rowCount',
    correlationId: TRACKED,
    agentEventLog,
  };
  const r = why({ kind: 'column', column: 'rowCount' }, sources);
  if (!r.ok) throw new Error(`expected a slice, got a target miss for ${JSON.stringify(r.target)}`);
  result = r;
});

describe('A1 — composed slice equals the hand-computed minimal set', () => {
  it('the join key threaded end to end (kernel committed state carries it)', () => {
    expect(kernel.committedCorrelationId).toBe(TRACKED);
    expect(result.threaded).toBe(true);
    expect(result.correlationId).toBe(TRACKED);
    expect(result.targetKind).toBe('column'); // rowCount is asked as an ordinary column (C2 generalisation)
  });

  it('kernel minimal set is EXACTLY {load, filter, count}, anchored at count', () => {
    // Hand-computed: rowCount ← filtered ← rows/filterField/filterRange ← input.
    // 'decoy' (writes auditNote, read by nobody) is NOT on that chain.
    expect([...result.kernel!.stageIds].sort()).toEqual(['count', 'filter', 'load']);
    expect(kernel.rowCount).toBe(3); // amounts 12,15,18 ∈ [10,20]
    expect(result.kernel!.writerId.startsWith('count#')).toBe(true);
  });

  it('agent frame is the corr-amt-1 tool call; viz commit resolved by its correlationId FIELD', () => {
    expect(result.agent!.toolCallId).toBe(`call-${TRACKED}`);
    expect(result.agent!.runId).toBe('run-A');
    expect(result.agent!.runtimeStageId.length).toBeGreaterThan(0);
    // D20: the commit id is identity-only — the join key rides in the first-class
    // field, so id !== correlationId by construction.
    expect(result.viz.commitId).toBe(`viz-${TRACKED}`);
    expect(result.viz.commitId).not.toBe(result.correlationId);
  });

  it('the composed cross-tier set is exactly the hand-listed commits', () => {
    const composed = result.commits.map((c) => `${c.tier}:${c.stageId ?? c.id}`).sort();
    expect(composed).toEqual(
      [
        'viz:viz-corr-amt-1', // own id; joined via CommitRecord.correlationId
        'agent:call-corr-amt-1', // agent commit id = toolCallId (unambiguous)
        'kernel:count',
        'kernel:filter',
        'kernel:load',
      ].sort(),
    );
  });

  it('the viz commit carries the join key as a FIRST-CLASS field (no id overload)', () => {
    const rec = vizRecords.find((r) => r.correlationId === TRACKED)!;
    expect(rec.id).toBe(`viz-${TRACKED}`);
    expect(rec.correlationId).toBe(TRACKED);
    expect(rec.id).not.toBe(rec.correlationId);
    // commits that never joined a cross-tier run simply have NO key.
    expect(vizRecords.find((r) => r.id === 'decoy-cat')!.correlationId).toBeUndefined();
  });
});

describe('A2 — decoys are excluded from the slice', () => {
  it('DECOY viz commits (user category + the other question) never appear', () => {
    const ids = new Set(result.commits.map((c) => c.id));
    for (const decoyId of ['decoy-cat', `viz-${DECOY_Q}`]) expect(ids.has(decoyId)).toBe(false);
    expect(result.viz.commitId).not.toBe('decoy-cat');
    expect(result.viz.commitId).not.toBe(`viz-${DECOY_Q}`);
  });

  it('the DECOY agent tool call (corr-amt-2) never appears — discriminated by runId, not runtimeStageId', () => {
    const decoyFrame = agentEventLog.find((f) => f.correlationId === DECOY_Q)!;
    expect(result.agent!.toolCallId).not.toBe(decoyFrame.toolCallId);
    expect(result.agent!.runId).not.toBe(decoyFrame.runId);
    expect(new Set(result.commits.map((c) => c.id)).has(decoyFrame.toolCallId)).toBe(false);
    // HONEST FINDING pinned as an assertion: runtimeStageId COLLIDES across
    // independent agent runs — it is NOT a valid cross-run discriminator.
    expect(decoyFrame.runtimeStageId).toBe(result.agent!.runtimeStageId);
  });

  it('the DECOY kernel stage write (auditNote / decoy stage) is excluded', () => {
    const trackedLog = kernel.snapshot.commitLog;
    expect(trackedLog.some((b) => b.stageId === 'decoy')).toBe(true); // it DID run...
    expect(trackedLog.some((b) => 'auditNote' in b.overwrite)).toBe(true); // and DID write auditNote...
    expect(result.kernel!.stageIds).not.toContain('decoy'); // ...but is not a rowCount dependency.
    // every kernel commit in the slice traces to the TRACKED run's own log — the
    // slice is scoped to the snapshot we sliced, BY CONSTRUCTION.
    const trackedIds = new Set(trackedLog.map((b) => b.runtimeStageId));
    for (const id of result.kernel!.commitIds) expect(trackedIds.has(id)).toBe(true);
  });

  it('HONEST FINDING: kernel runtimeStageIds COLLIDE across independent runs (fp 9.10.1 gap)', () => {
    // The decoy run over the SAME chart reuses execution indices, so its
    // runtimeStageId STRINGS coincide with the tracked run's (e.g. 'count#…').
    // The slice stays correct only because it is sourced from the tracked
    // snapshot; cross-run disambiguation would need `snapshot.runId`
    // (footprintjs fba2886), which is ABSENT in the installed 9.10.1.
    const decoyIds = new Set(decoyKernel.snapshot.commitLog.map((b) => b.runtimeStageId));
    expect(result.kernel!.commitIds.every((id) => decoyIds.has(id))).toBe(true); // the collision
    expect(result.kernel!.runId).toBeNull(); // the gap that makes it unresolvable globally
    expect(result.flags.kernelRunIdAvailable).toBe(false);
  });
});

describe('A3 — the composed slice is machine-shaped, not prose', () => {
  it('every commit is a {tier, id, kind} record with a known tier tag', () => {
    for (const c of result.commits) {
      expect(['viz', 'agent', 'kernel']).toContain(c.tier);
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
      expect(['declaring', 'input-selection', 'kernel-stage', 'agent-frame']).toContain(c.kind);
    }
  });

  it('carries no free-text / prose fields (ids + tags only)', () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('agent brushes'); // viz cause.intent
    expect(serialized).not.toContain('load rows'); // kernel stage NAME (we keep stageId, not name)
    expect(serialized).not.toContain('Amount brush'); // actor label
    // fixed machine key set.
    expect(Object.keys(result).sort()).toEqual(
      ['agent', 'commits', 'correlationId', 'flags', 'kernel', 'key', 'misses', 'ok', 'targetKind', 'threaded', 'viz'].sort(),
    );
  });

  it('documents the fp 9.10.1 gap honestly: snapshot.runId is absent → kernel runId null', () => {
    expect(result.kernel!.runId).toBeNull();
    expect(result.flags.kernelRunIdAvailable).toBe(false);
  });
});
