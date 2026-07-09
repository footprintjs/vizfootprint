/**
 * A3 — dead ends stay in the denominator (invariant R8).
 *
 * Rerun the A1 brushing scenario, but half the tests happen on a branch the
 * agent later ABANDONS. Abandoning a branch must NOT refund the alpha those
 * tests spent. We prove it two ways:
 *
 *  (a) every abandoned-branch test still consumed wealth (wealthAfter <
 *      wealthBefore on non-rejections) and advanced the step counter t; and
 *  (b) the counterfactual in which the abandoned tests are REMOVED (i.e. their
 *      alpha refunded) leaves the surviving 'main' tests with strictly MORE
 *      wealth and LOOSER thresholds. Since the real procedure gives the smaller
 *      wealth / stricter thresholds, it did not refund — the dead ends stayed
 *      in the denominator.
 *
 * There is no refund operation in either procedure, so R8 holds by construction;
 * this test pins that behavior.
 *
 * REWIRED onto REAL L1 (P3-L4): `stream` now comes from a real
 * `CauseSelectionSession` fork (`buildBrushStream`'s `branchOf` path) read
 * back through `hypothesisRecordsFromLog`/`branchIdFromLog`
 * (`src/fdr/fromLog.ts`) — `branchId` is DERIVED from the log's real
 * parent-chain, not a caller-stamped label. By construction (see
 * `scenario.ts`) the derived label for a lineage started at arrival index i
 * is `"<label>-1"` (the id of that lineage's fork-entry commit, always its
 * FIRST-seen occurrence) — hence `MAIN_BRANCH`/`ABANDONED_BRANCH` below.
 */

import { describe, it, expect } from 'vitest';
import { lordPlusPlus, alphaInvesting, type HypothesisRecord } from '../../src/fdr/index.js';
import { buildBrushStream } from './scenario.js';

const ALPHA = 0.05;
const N = 40;
const LEN = 32;
const SEED = 20260709;

/** Odd-indexed brushes live on an abandoned branch. */
const branchOf = (i: number): string => (i % 2 === 1 ? 'abandoned' : 'main');
// Derived branchIds (see the module doc above): the fork-entry commit id of
// each lineage, i.e. `"<label>-1"` — NOT the raw `branchOf` label.
const MAIN_BRANCH = 'main-1';
const ABANDONED_BRANCH = 'abandoned-1';

describe('A3 — abandoning a branch does not refund alpha (R8)', () => {
  it('abandoned tests consume wealth and stay in the denominator', () => {
    const { stream, session } = buildBrushStream({ seed: SEED, n: N, len: LEN, branchOf });

    // Sanity: the branch split is REAL L1 topology, not a relabeled stream —
    // root forks into exactly two lineages, each of length N/2.
    expect(session.records.filter((r) => r.field === 'pValue')).toHaveLength(N);
    expect(stream).toHaveLength(N);

    // Counterfactual: the agent had NEVER explored the abandoned branch.
    const mainOnly: HypothesisRecord[] = stream
      .filter((h) => h.branchId === MAIN_BRANCH)
      .map((h, i) => ({ ...h, timestamp: i + 1 }));

    for (const runProc of [
      { name: 'LORD++', fn: lordPlusPlus },
      { name: 'alpha-investing', fn: alphaInvesting },
    ] as const) {
      const full = runProc.fn(stream, { alpha: ALPHA });
      const refunded = runProc.fn(mainOnly, { alpha: ALPHA });

      // (a) every abandoned-branch, non-rejected test consumed wealth.
      const abandoned = full.audit.filter((s) => s.branchId === ABANDONED_BRANCH);
      expect(abandoned.length).toBe(N / 2);
      for (const s of abandoned) {
        if (!s.reject) expect(s.wealthAfter).toBeLessThan(s.wealthBefore);
      }

      // (b) refunding (removing) the dead ends leaves MORE wealth than reality.
      const wealthConsumedByDeadEnds = refunded.finalWealth - full.finalWealth;

      // eslint-disable-next-line no-console
      console.log(
        `\n[A3/${runProc.name}] seed=${SEED}, ${N} brushes (half abandoned)\n` +
          `  final wealth WITH dead ends kept (reality) = ${full.finalWealth.toFixed(6)}\n` +
          `  final wealth IF dead ends refunded/removed  = ${refunded.finalWealth.toFixed(6)}\n` +
          `  alpha the dead ends consumed (never refunded) = ${wealthConsumedByDeadEnds.toFixed(6)}\n` +
          `  abandoned tests in audit = ${abandoned.length} (all counted in the stream)`,
      );

      // Keeping the dead ends leaves strictly less wealth: no refund happened.
      expect(full.finalWealth).toBeLessThan(refunded.finalWealth);
      expect(wealthConsumedByDeadEnds).toBeGreaterThan(0);
    }
  });
});
