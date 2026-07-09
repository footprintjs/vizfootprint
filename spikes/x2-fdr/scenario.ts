/**
 * X2 spike — the shared "agent brushes N subsets of pure-noise data and runs a
 * correlation test on each" scenario. Everything is seeded so the packet's
 * reported numbers reproduce exactly.
 *
 * Pure noise => every null is true => any rejection is a FALSE discovery. That
 * is the honest worst case for a value proof: it isolates the multiplicity
 * problem (an agent p-hacking over noise) from any real signal.
 *
 * REWIRED onto REAL L1 (P3-L4): declared-analysis test results are authored
 * as real `CommitRecord`s through a live `CauseSelectionSession` (the SAME
 * class `src/log/log.test.ts` and `src/analysis/builtins.test.ts` use), then
 * read back through `hypothesisRecordsFromLog` (`src/fdr/fromLog.ts`) — the
 * adapter that replaces the throwaway `spikes/x2-fdr/commit-log-stub.ts`
 * (deleted; SPEC.md §3 always called it "explicitly throwaway ... L1 replaces
 * it wholesale"). A commit is a declared test iff it is a point commit on the
 * reserved field `'pValue'` (see `fromLog.ts`'s "test-analog" convention).
 *
 * Branching (A3): when `branchOf` assigns more than one label, the labels'
 * FIRST commits fork off a shared, non-test-analog `'root'` commit (a plain
 * marker, field `'origin'`, never read as a hypothesis) into independent
 * per-label lineages — a REAL L1 DAG fork, not a caller-supplied string. The
 * adapter's `branchIdFromLog` then DERIVES each commit's branchId from that
 * real parent-chain topology (see `fromLog.test.ts`'s fork case) — this file
 * never stamps a branchId directly.
 */

import type { HypothesisRecord, Rng } from '../../src/fdr/index.js';
import { makeRng, normalVector, hypothesisRecordsFromLog } from '../../src/fdr/index.js';
import { correlationPValue } from './stats.js';
import { CauseSelectionSession } from '../../src/log/index.js';

/**
 * One "brush": draw two independent noise vectors of length `len` and return
 * the two-sided correlation-test p-value. Under independence this is ~U[0,1].
 */
export function brushOnce(rng: Rng, len: number): number {
  const xs = normalVector(rng, len);
  const ys = normalVector(rng, len);
  return correlationPValue(xs, ys);
}

/** `n` independent brushes -> `n` null correlation p-values. */
export function brushNoisePValues(rng: Rng, n: number, len: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = brushOnce(rng, len);
  return out;
}

export interface BrushStreamOptions {
  readonly seed: number;
  /** Number of brushes / declared analyses. */
  readonly n: number;
  /** Length of each noise vector (=> df = len - 2 for the t-test). */
  readonly len: number;
  /** Optional: force the FIRST p-value to this exact value (A1 uses p*=0.03). */
  readonly firstPValue?: number;
  /**
   * Optional branch assignment per index. Default: everything is ONE
   * unforked lineage (no branch label — see `fromLog.ts`). Returning more
   * than one distinct label (A3) forks each label's own lineage off a shared
   * `'root'` commit; the eventual branchId is DERIVED, not this label
   * verbatim (though by construction here it IS this label, suffixed `-1` —
   * see the module doc).
   */
  readonly branchOf?: (index: number) => string;
}

/**
 * Build a declared-analysis stream by brushing noise, authored into a REAL L1
 * `CauseSelectionSession` and read back through `hypothesisRecordsFromLog`.
 * Returns the live session (so tests can inspect real `CommitRecord`s), the
 * derived `HypothesisRecord` stream, and the raw p-values.
 */
export function buildBrushStream(opts: BrushStreamOptions): {
  readonly session: CauseSelectionSession;
  readonly stream: readonly HypothesisRecord[];
  readonly pValues: readonly number[];
} {
  const rng = makeRng(opts.seed);
  const pValues = brushNoisePValues(rng, opts.n, opts.len);
  if (opts.firstPValue !== undefined) pValues[0] = opts.firstPValue;

  const session = new CauseSelectionSession();
  const branchOf = opts.branchOf;

  if (branchOf) {
    session.commit({
      id: 'root',
      parent: null,
      viewId: 'brush',
      actorMeta: { actor: 'agent' },
      kind: 'point',
      field: 'origin', // NOT 'pValue' — never a test-analog commit (R6 at the L1 rail)
      value: null,
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: 0,
    });
  }

  const tipOf = new Map<string, string | null>();
  const seqOf = new Map<string, number>();
  let mainTip: string | null = null;

  for (let i = 0; i < opts.n; i++) {
    const label = branchOf?.(i);
    const seq = (seqOf.get(label ?? '') ?? 0) + 1;
    seqOf.set(label ?? '', seq);
    const id = label ? `${label}-${seq}` : `brush-${seq}`;
    const parent = label ? (tipOf.get(label) ?? 'root') : mainTip;

    session.commit({
      id,
      parent,
      correlationId: `brush#${i + 1}`,
      viewId: 'brush',
      actorMeta: { actor: 'agent' },
      kind: 'point',
      field: 'pValue',
      value: pValues[i]!,
      cause: { requestedBy: 'agent', computedBy: 'system' },
      ts: i + 1,
    });

    if (label) tipOf.set(label, id);
    else mainTip = id;
  }

  return { session, stream: hypothesisRecordsFromLog(session.records), pValues };
}
