/**
 * L6 — the three TIER-RESOLVERS. Each is a pure function over ONE tier's inputs;
 * `why()` (in `./why.ts`) composes them. None of them post-processes a trace —
 * they read structure gathered during the run.
 *
 * Cited footprintjs APIs (installed 9.11.0):
 *   - `sliceForKey(commitLog, key, keysRead, opts?)` → `VariableSlice`
 *     (`node_modules/footprintjs/dist/esm/lib/slice/sliceForKey.d.ts:47`).
 *   - `keysReadFromExecutionTree(tree)` → `KeysReadSource`
 *     (`.../slice/keysReadSources.d.ts:40`).
 *   - `sliceToJSON(slice)` → `SliceJSON` ({ writerId?, nodes?, missing?, … })
 *     (`.../slice/serialize.d.ts:25`, `.../slice/types.d.ts:211-240`).
 *   C4/HONEST-GAP CLOSED: `RuntimeSnapshot.runId: string`
 *     (`.../runner/ExecutionRuntime.d.ts:39`, shipped footprintjs 9.11.0,
 *     source fba2886) — `getSnapshot()` now stamps the run's id on every
 *     snapshot, disambiguating kernel commits across independent runs of the
 *     same chart (their `runtimeStageId` strings still collide by design —
 *     execution indices reset per run). Read defensively below anyway: a
 *     snapshot handed in by an older/duck-typed kernel may still omit it, and
 *     that stays an honest `runId: null` / `kernelRunIdAvailable: false`
 *     fallback, never a crash.
 */

import { keysReadFromExecutionTree, sliceForKey, sliceToJSON } from 'footprintjs/trace';
import type { CommitRecord } from '../log/index.js';
import type { AgentEventFrame, CrossTierMiss, RuntimeSnapshot } from './types.js';

/** A resolver either returns its tier's payload or a typed {@link CrossTierMiss}. */
type Resolved<T> = T | { readonly miss: CrossTierMiss };

/** `true` when a resolver returned a miss (type-narrowing helper). */
export function isMiss<T>(r: Resolved<T>): r is { readonly miss: CrossTierMiss } {
  return typeof r === 'object' && r !== null && 'miss' in r;
}

/**
 * VIZ tier — resolve the declaring commit. When a `correlationId` is present, it
 * is resolved by the FIRST-CLASS `CommitRecord.correlationId` field (D20 — never
 * the id-overload the pre-e6470ec spike used); the resolved id must be a real
 * log entry. Falls back to the declaring id when the target wasn't threaded.
 */
export function resolveVizTier(
  correlationId: string | undefined,
  declaringCommitId: string,
  records: readonly CommitRecord[],
): Resolved<{ readonly commitId: string }> {
  if (correlationId !== undefined) {
    // Address by the join-key FIELD, not the commit id. When the declaring
    // commit itself carries the key (the session case), prefer it so the anchor
    // is deterministic even if some other commit reused the same key; otherwise
    // fall back to the sole field-carrier (the x3 brush case).
    const declaring = records.find((r) => r.id === declaringCommitId);
    if (declaring?.correlationId === correlationId) return { commitId: declaring.id };
    const byField = records.find((r) => r.correlationId === correlationId);
    if (!byField) return { miss: { tier: 'viz', missing: 'no-viz-commit' } };
    return { commitId: byField.id };
  }
  const byId = records.find((r) => r.id === declaringCommitId);
  if (!byId) return { miss: { tier: 'viz', missing: 'no-viz-commit' } };
  return { commitId: byId.id };
}

/**
 * AGENT tier — resolve the tool-call frame from a CALLER-SUPPLIED event log by
 * the SANCTIONED `EventMeta.correlationId` field (C4). agentfootprint is never
 * imported here; the resolver consumes the typed {@link AgentEventFrame} shape.
 */
export function resolveAgentTier(
  correlationId: string | undefined,
  eventLog: readonly AgentEventFrame[] | undefined,
): Resolved<AgentEventFrame> {
  if (eventLog === undefined) return { miss: { tier: 'agent', missing: 'no-agent-tier' } };
  if (correlationId === undefined) return { miss: { tier: 'agent', missing: 'no-join-key' } };
  const frame = eventLog.find((f) => f.correlationId === correlationId);
  if (!frame) return { miss: { tier: 'agent', missing: 'no-agent-frame' } };
  return frame;
}

/** The kernel tier's resolved payload. */
export interface KernelResolution {
  /** runtimeStageId of the anchor writer. */
  readonly writerId: string;
  /** runtimeStageIds of every commit in the R9 minimal set. */
  readonly commitIds: readonly string[];
  /** Stable, index-free stage ids parallel to `commitIds`. */
  readonly stageIds: readonly string[];
  /** `snapshot.runId` — `null` only when the snapshot predates fp 9.11.0 (field absent; see resolver header). */
  readonly runId: string | null;
}

/**
 * KERNEL tier — footprintjs `sliceForKey` over the analysis flowchart's commit
 * log gives the R9 minimal dependency chain for the anchor `key`. An empty /
 * never-written slice is a `kernel-key-unresolved` miss (honest, never faked).
 */
export function resolveKernelTier(
  key: string | undefined,
  snapshot: RuntimeSnapshot | undefined,
): Resolved<KernelResolution> {
  if (snapshot === undefined) return { miss: { tier: 'kernel', missing: 'no-kernel-snapshot' } };
  if (key === undefined) return { miss: { tier: 'kernel', missing: 'kernel-key-unresolved' } };

  const slice = sliceForKey(
    snapshot.commitLog,
    key,
    keysReadFromExecutionTree(snapshot.executionTree),
  );
  const json = sliceToJSON(slice);
  const nodes = json.nodes ?? {};
  const commitIds = Object.keys(nodes);
  if (json.missing || commitIds.length === 0) {
    return { miss: { tier: 'kernel', missing: 'kernel-key-unresolved' } };
  }
  const stageIds = commitIds.map((id) => nodes[id]!.stageId);
  // fp ≥9.11.0 stamps `snapshot.runId`; read defensively so a snapshot from an
  // older/duck-typed kernel degrades to the honest `null` fallback instead of
  // a crash — `why()` turns that into `flags.kernelRunIdAvailable: false`.
  const runId = (snapshot as { readonly runId?: string }).runId ?? null;
  return { writerId: json.writerId ?? '', commitIds, stageIds, runId };
}
