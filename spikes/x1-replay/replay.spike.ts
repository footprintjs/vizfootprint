/**
 * x1-replay experiment (runnable narrative).
 *
 * Authors a BRANCHING cause-log over two coordinated Mosaic views, serializes
 * it, then replays two different branch paths into fresh Selections + fresh
 * registries — proving (H4) that identity-dependent behavior survives replay
 * and (R8) that the append-only log supports branching timelines.
 *
 * Run it with a TS-aware runner, e.g. `npx vitest run spikes/x1-replay` executes
 * branch.test.ts which calls runSpike(); or import runSpike() from anywhere.
 */

import type { RegisteredSource } from '../../src/mosaic/index.js';
import {
  CauseSelectionSession,
  causeHistogram,
  replayLog,
  serializeLog,
  type CommitInput,
} from './log.js';

/** A branching log: c2 and c2b are alternative children of c1. */
export const BRANCHING_LOG: CommitInput[] = [
  {
    id: 'c1',
    parent: null,
    viewId: 'A',
    actorMeta: { actor: 'user' },
    kind: 'point',
    field: 'category',
    value: 'Data',
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'user picks Data' },
  },
  {
    id: 'c2',
    parent: 'c1',
    viewId: 'B',
    actorMeta: { actor: 'agent' },
    kind: 'interval',
    field: 'amount',
    value: [10, 20],
    cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'agent brushes low band' },
  },
  {
    id: 'c2b',
    parent: 'c1', // sibling branch off c1
    viewId: 'B',
    actorMeta: { actor: 'agent' },
    kind: 'interval',
    field: 'amount',
    value: [50, 60],
    cause: { requestedBy: 'user', computedBy: 'agent', intent: 'user asks agent for high band' },
  },
];

const clauseSummary = (session: CauseSelectionSession) =>
  session.selection.clauses
    .map((c) => `${(c.source as RegisteredSource).viewId}:${String(c.predicate)}`)
    .sort();

export interface SpikeResult {
  serialized: string;
  branchLow: string[];
  branchHigh: string[];
  histogramLow: Record<string, number>;
  histogramHigh: Record<string, number>;
  allReplayed: boolean;
}

export function runSpike(log: readonly CommitInput[] = BRANCHING_LOG): SpikeResult {
  // author the full branching log live
  const live = new CauseSelectionSession();
  for (const c of log) live.commit(c);
  const serialized = serializeLog(live.records);

  // replay branch LOW (c1 -> c2) and branch HIGH (c1 -> c2b) into fresh worlds
  const low = replayLog(serialized, ['c1', 'c2']);
  const high = replayLog(serialized, ['c1', 'c2b']);

  const allReplayed = [...low.records, ...high.records].every((r) => r.cause.replayed === true);

  return {
    serialized,
    branchLow: clauseSummary(low),
    branchHigh: clauseSummary(high),
    histogramLow: causeHistogram(low.records),
    histogramHigh: causeHistogram(high.records),
    allReplayed,
  };
}

// Print a readable narrative when executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runSpike();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(r, null, 2));
}
