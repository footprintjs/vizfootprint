/**
 * A2 — batch BH is WRONG here, not merely different.
 *
 * Adaptive arrival: the agent keeps brushing new pure-noise subsets and, after
 * each brush, PEEKS — it re-runs Benjamini-Hochberg over the hypotheses-so-far
 * and stops the moment BH declares anything (data-dependent / optional
 * stopping). This is exactly "batch BH applied retroactively at each step" and
 * is precisely the use BH's guarantee does NOT cover: BH controls FDR only for
 * a single application to a fixed, pre-specified family (Benjamini & Hochberg
 * 1995). The reason online procedures exist is to make an immediate, valid
 * decision at each step under such adaptive arrival (Ramdas et al. 2017, Sec. 1;
 * Foster & Stine 2008, Sec. 3).
 *
 * Everything is pure noise => the global null holds => every rejection is a
 * FALSE discovery => the false discovery proportion FDP is 1 whenever anything
 * is rejected, so realized FDR = E[FDP] = P(>=1 rejection) over the seeded sims.
 *
 * We measure realized FDR over 10k seeded simulations of:
 *   (i)  BH peeking at each step (the wrong, adaptive use)   -> should EXCEED alpha
 *   (ii) LORD++ online                                        -> should HOLD  <= alpha
 * plus a control:
 *   (0)  BH applied ONCE to the fixed family of N (correct use) -> ~ alpha
 * The control shows the violation comes from the ADAPTIVE/peeking use, not from
 * BH being a bad procedure.
 *
 * Serves R7 (online correction is necessary; batch is wrong under adaptivity).
 *
 * REWIRED onto REAL L1 (P3-L4): each sim's p-values are authored into a real
 * `CauseSelectionSession` and read back through `hypothesisRecordsFromLog`
 * via `buildBrushStream` — the same path A1/A3 use (see `scenario.ts`) —
 * rather than a hand-built `HypothesisRecord[]`. Measured overhead for 10k
 * sims x 40 real commits: well under a second (see the P3-L4 packet report);
 * `vitest.config.ts`'s `testTimeout: 30_000` (Q11) already accommodates it.
 */

import { describe, it, expect } from 'vitest';
import { lordPlusPlus } from '../../src/fdr/index.js';
import { buildBrushStream } from './scenario.js';
import { bhRejectsAny, benjaminiHochberg } from './batch-bh.js';

const ALPHA = 0.05;
const N = 40; // cap on brushes per session
const LEN = 32; // df = 30
const SIMS = 10_000;
const BASE_SEED = 1_000;

/** Agent peeks after each brush; returns true if BH ever rejects (agent stops). */
function bhPeekEverRejects(pvals: readonly number[], q: number): boolean {
  for (let t = 1; t <= pvals.length; t++) {
    if (bhRejectsAny(pvals.slice(0, t), q)) return true; // optional stopping
  }
  return false;
}

describe('A2 — realized FDR: batch BH (peeking) violates alpha, LORD++ holds', () => {
  it('reports both realized FDRs against the target over 10k seeded sims', () => {
    let bhPeekFalse = 0;
    let bhOnceFalse = 0;
    let lordFalse = 0;

    for (let s = 0; s < SIMS; s++) {
      // Real L1 commit log -> real hypothesisRecordsFromLog adapter -> stream.
      const { stream, pValues: pvals } = buildBrushStream({ seed: BASE_SEED + s, n: N, len: LEN });

      // (i) adaptive/peeking BH
      if (bhPeekEverRejects(pvals, ALPHA)) bhPeekFalse++;

      // (0) control: BH once on the fixed family of N
      if (benjaminiHochberg(pvals, ALPHA).length > 0) bhOnceFalse++;

      // (ii) LORD++ online over the same (now log-derived) stream
      if (lordPlusPlus(stream, { alpha: ALPHA }).discoveries.length > 0) lordFalse++;
    }

    const bhPeekFDR = bhPeekFalse / SIMS;
    const bhOnceFDR = bhOnceFalse / SIMS;
    const lordFDR = lordFalse / SIMS;
    // Monte-Carlo standard error at p~=alpha over SIMS Bernoulli trials.
    const se = Math.sqrt((ALPHA * (1 - ALPHA)) / SIMS);

    // eslint-disable-next-line no-console
    console.log(
      '\n============== A2: REALIZED FDR (10k seeded sims) ==============\n' +
        `global null (pure noise), N=${N} brushes, df=${LEN - 2}, ` +
        `target alpha = ${ALPHA}, sims = ${SIMS}, base seed = ${BASE_SEED}\n` +
        `Monte-Carlo SE at p=alpha ~= ${se.toFixed(4)}\n` +
        `  (0) BH applied ONCE, fixed family (correct use)  realized FDR = ${bhOnceFDR.toFixed(4)}  ` +
        `[at target: |FDR-alpha| = ${Math.abs(bhOnceFDR - ALPHA).toFixed(4)} = ${(
          Math.abs(bhOnceFDR - ALPHA) / se
        ).toFixed(1)} SE; theory: BH FDR = alpha exactly under the global null]\n` +
        `  (i) BH peeking at each step (adaptive, WRONG)    realized FDR = ${bhPeekFDR.toFixed(4)}  ` +
        `[${bhPeekFDR > ALPHA ? 'VIOLATES' : 'holds'} target by ${((bhPeekFDR - ALPHA) / se).toFixed(
          1,
        )} SE]\n` +
        `  (ii) LORD++ online                               realized FDR = ${lordFDR.toFixed(4)}  ` +
        `[${lordFDR <= ALPHA ? 'holds' : 'VIOLATES'} target, margin ${(ALPHA - lordFDR).toFixed(
          4,
        )}]\n` +
        `  => peeking-BH exceeds target by ${(bhPeekFDR - ALPHA).toFixed(4)} (${(
          (bhPeekFDR - ALPHA) /
          se
        ).toFixed(0)} SE); LORD++ margin below target = ${(ALPHA - lordFDR).toFixed(4)}\n` +
        '===============================================================\n',
    );

    // The core claim: adaptive/peeking BH grossly exceeds the target, LORD++ holds it.
    expect(bhPeekFDR).toBeGreaterThan(ALPHA);
    expect(bhPeekFDR - ALPHA).toBeGreaterThan(10 * se); // gross, not noise
    expect(lordFDR).toBeLessThanOrEqual(ALPHA);
    // Honesty control: BH used correctly (once, fixed family) sits AT the target
    // within Monte-Carlo error (theory says = alpha exactly), NOT grossly above
    // like the peeking version. This proves the violation is from the adaptive
    // use, not from BH being a poor procedure.
    expect(Math.abs(bhOnceFDR - ALPHA)).toBeLessThan(5 * se);
    expect(bhPeekFDR).toBeGreaterThan(bhOnceFDR + 0.05);
  });
});
