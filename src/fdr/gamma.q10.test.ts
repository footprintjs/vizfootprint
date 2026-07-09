/**
 * Q10 — the LORD gamma leading-constant decision, with evidence.
 *
 * Two published leading constants exist for the identical gamma SHAPE
 * g(j) = log(j v 2) / (j e^{sqrt(log j)}):
 *   - 0.0722      Ramdas, Yang, Wainwright & Jordan (2017) Sec. 3.1 — the
 *                 number printed in the primary paper this package
 *                 implements "EXACTLY from" (see `lordPlusPlus.ts` header).
 *   - 0.07720838  the R/Bioconductor package `onlineFDR`'s LORD/LOND/
 *                 alpha-investing default ("The theory behind onlineFDR",
 *                 https://bioconductor.org/packages/devel/bioc/vignettes/onlineFDR/inst/doc/theory.html,
 *                 retrieved 2026-07-09), citing the SAME source (Javanmard &
 *                 Montanari 2018, eq. 31).
 *
 * This test computes both constants' effect on the realistic per-session
 * threshold range (j <= 100) and pins the DECIDED default (see the Q10 note
 * in `gamma.ts`): ship 0.0722, keep 0.07720838 available via
 * `{ gamma: lordGammaOnlineFDR }`.
 */

import { describe, it, expect } from 'vitest';
import {
  lordGamma,
  lordGammaOnlineFDR,
  lordGammaShape,
  LORD_GAMMA_CONSTANT,
  LORD_GAMMA_CONSTANT_ONLINEFDR,
  sumGamma,
  lordPlusPlus,
  type HypothesisRecord,
} from './index.js';

describe('Q10 — gamma leading-constant decision', () => {
  it('the ratio of the two constants is fixed and applies UNIFORMLY across j<=100 (linear in C)', () => {
    const ratio = LORD_GAMMA_CONSTANT_ONLINEFDR / LORD_GAMMA_CONSTANT;
    const js = [1, 2, 5, 10, 20, 40, 60, 100];

    const rows = js.map((j) => {
      const paper = lordGamma(j);
      const onlineFdr = lordGammaOnlineFDR(j);
      return { j, shape: lordGammaShape(j), paper, onlineFdr, measuredRatio: onlineFdr / paper };
    });

    // eslint-disable-next-line no-console
    console.log(
      '\n================= Q10: GAMMA CONSTANT COMPARISON (j<=100) =================\n' +
        `C_paper (Ramdas et al. 2017, Sec. 3.1)     = ${LORD_GAMMA_CONSTANT}\n` +
        `C_onlineFDR (Bioconductor onlineFDR LORD)  = ${LORD_GAMMA_CONSTANT_ONLINEFDR}\n` +
        `ratio C_onlineFDR / C_paper                = ${ratio.toFixed(6)} (onlineFDR is ~${(
          (ratio - 1) *
          100
        ).toFixed(2)}% looser at EVERY step, holding rejection history fixed)\n\n` +
        'j    shape(j)      gamma_j(paper)   gamma_j(onlineFDR)   ratio\n' +
        rows
          .map(
            (r) =>
              `${String(r.j).padStart(3)}  ${r.shape.toFixed(8)}   ${r.paper.toExponential(4)}     ` +
              `${r.onlineFdr.toExponential(4)}       ${r.measuredRatio.toFixed(4)}`,
          )
          .join('\n') +
        '\n=============================================================================\n',
    );

    for (const r of rows) {
      expect(r.measuredRatio).toBeCloseTo(ratio, 10);
    }
    // The realistic session range: uniformly ~6.94% looser, not e.g. 2x or 1.01x.
    expect(ratio).toBeGreaterThan(1.06);
    expect(ratio).toBeLessThan(1.08);
  });

  it('both constants stay deeply conservative (partial sums << 1) at every practical horizon', () => {
    const horizons = [100, 1_000, 100_000, 2_000_000];
    const rows = horizons.map((h) => ({
      h,
      paper: sumGamma(lordGamma, h),
      onlineFdr: sumGamma(lordGammaOnlineFDR, h),
    }));

    // eslint-disable-next-line no-console
    console.log(
      '\n========== Q10: PARTIAL SUMS — both constants are conservative ==========\n' +
        rows
          .map(
            (r) =>
              `H=${String(r.h).padStart(9)}   sum(paper)=${r.paper.toFixed(6)}   ` +
              `sum(onlineFDR)=${r.onlineFdr.toFixed(6)}`,
          )
          .join('\n') +
        '\n===========================================================================\n',
    );

    for (const r of rows) {
      expect(r.paper).toBeLessThanOrEqual(1);
      expect(r.onlineFdr).toBeLessThanOrEqual(1);
      // onlineFDR's constant is looser (bigger partial sum) at every horizon, never crosses under.
      expect(r.onlineFdr).toBeGreaterThan(r.paper);
    }
    // Realistic per-session horizon (<=100): nowhere near the asymptotic 1.
    expect(rows[0]!.paper).toBeLessThan(0.25);
  });

  it('the default stays 0.0722 (conservative); the onlineFDR constant is reachable via the existing gamma override seam', () => {
    expect(LORD_GAMMA_CONSTANT).toBe(0.0722);
    expect(LORD_GAMMA_CONSTANT_ONLINEFDR).toBeCloseTo(0.07720838, 8);

    // No-rejection stream (all p=1): thresholds are pure W0*gamma(t), so the
    // SAME 1.0694 ratio must show up end-to-end through the real stepper.
    const stream: HypothesisRecord[] = Array.from({ length: 100 }, (_, i) => ({
      hypothesisId: `h${i + 1}`,
      pValue: 1,
      timestamp: i + 1,
    }));
    const withDefault = lordPlusPlus(stream, { alpha: 0.05 });
    const withOnlineFdr = lordPlusPlus(stream, { alpha: 0.05, gamma: lordGammaOnlineFDR });

    expect(withDefault.discoveries.length).toBe(0);
    expect(withOnlineFdr.discoveries.length).toBe(0);
    for (let i = 0; i < stream.length; i++) {
      const ratio = withOnlineFdr.audit[i]!.alphaThreshold / withDefault.audit[i]!.alphaThreshold;
      expect(ratio).toBeCloseTo(LORD_GAMMA_CONSTANT_ONLINEFDR / LORD_GAMMA_CONSTANT, 10);
    }
  });
});
