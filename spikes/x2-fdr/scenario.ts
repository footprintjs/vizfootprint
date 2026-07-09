/**
 * X2 spike — the shared "agent brushes N subsets of pure-noise data and runs a
 * correlation test on each" scenario. Everything is seeded so the packet's
 * reported numbers reproduce exactly.
 *
 * Pure noise => every null is true => any rejection is a FALSE discovery. That
 * is the honest worst case for a value proof: it isolates the multiplicity
 * problem (an agent p-hacking over noise) from any real signal.
 */

import type { HypothesisRecord, Rng } from '../../src/fdr/index.js';
import { makeRng, normalVector } from '../../src/fdr/index.js';
import { correlationPValue } from './stats.js';
import { DeclaredAnalysisLog } from './commit-log-stub.js';

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
   * Optional branch assignment per index. Default: everything on 'main'.
   * (A3 puts half on an abandoned branch.)
   */
  readonly branchOf?: (index: number) => string;
}

/**
 * Build a declared-analysis stream by brushing noise, via the (stub) commit
 * log. Returns both the log and its stream so tests can show provenance.
 */
export function buildBrushStream(opts: BrushStreamOptions): {
  readonly log: DeclaredAnalysisLog;
  readonly stream: readonly HypothesisRecord[];
  readonly pValues: readonly number[];
} {
  const rng = makeRng(opts.seed);
  const pValues = brushNoisePValues(rng, opts.n, opts.len);
  if (opts.firstPValue !== undefined) pValues[0] = opts.firstPValue;

  const log = new DeclaredAnalysisLog();
  for (let i = 0; i < opts.n; i++) {
    log.declare({
      hypothesisId: `brush#${i + 1}`,
      pValue: pValues[i]!,
      timestamp: i + 1,
      branchId: opts.branchOf ? opts.branchOf(i) : 'main',
    });
  }
  return { log, stream: log.stream(), pValues };
}
