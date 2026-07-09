/**
 * X4 (R15) acceptance — WRITTEN FIRST, before the bench implementation.
 *
 * Claim under test: Mosaic owns the 60Hz hot path; our commit log never sits
 * in it (commit-on-intent). During a 3s / 60Hz brush gesture (180 transient
 * Selection.update calls via requestAnimationFrame, each followed by N=100k
 * synthetic rows of predicate-evaluation work), the CauseSelectionSession
 * commit log:
 *
 *   (R13) records EXACTLY ONE commit for the whole gesture (at gesture end),
 *   and adds ~ZERO main-thread blocking versus logging disabled — measured
 *   as the delta in PerformanceObserver('longtask') counts and total
 *   blocking time (TBT = Σ max(0, duration − 50ms)) between
 *     (a) mode 'log'   — commit log attached, one commit on gesture end
 *     (b) mode 'nolog' — no log anywhere, raw Mosaic only.
 *
 * Both arms run the byte-identical hot path: same seeded data, same 180
 * clauseInterval → selection.update calls, same 100k-row scan per update.
 * The ONLY difference is the session object existing and its single
 * gesture-end commit.
 *
 * Environment: real Chromium (pinned chrome-headless-shell 1208) driven by
 * playwright-core; the page runs the real @uwdata/mosaic-core Selection and
 * the real CauseSelectionSession from src/log/log.ts (L1), bundled by
 * esbuild at test time. Runs are interleaved (nolog, log, nolog, log, …) to
 * cancel warm-up/thermal drift.
 */

import { describe, it, expect } from 'vitest';
import { runX4 } from './runner.mjs';

// Give the browser bench ample room; a hard-kill watchdog inside the runner
// guarantees we fail fast instead of hanging if the renderer ever stalls.
const BENCH_TIMEOUT_MS = 240_000;

describe('X4 (R15): commit log stays out of the Mosaic 60Hz hot path', () => {
  it(
    'R13: exactly 1 commit per gesture; long-task delta between log/nolog ~ 0',
    async () => {
      const { runs, summary } = await runX4({
        reps: 2, // 2 interleaved pairs for the gate; run.mjs prints a 3-rep table
        rows: 100_000,
        frames: 180,
        seed: 42,
      });

      // --- positive control: the longtask detector is LIVE ------------------
      // A 0-vs-0 delta only means something if the instrument can fire: an
      // 80ms deliberate block must register as >=1 long task in this browser.
      expect(summary.detectorControl.longTasks).toBeGreaterThanOrEqual(1);
      expect(summary.detectorControl.maxDurationMs).toBeGreaterThan(50);

      // --- sanity: every run completed the full gesture ---------------------
      for (const r of runs) {
        expect(r.stalled).toBe(false);
        expect(r.frames).toBe(180);
      }

      // --- apples-to-apples: identical predicate work in both arms ----------
      // The checksum folds every per-update selected-row count; equal
      // checksums prove both arms did the same 180 × 100k row evaluations.
      expect(new Set(runs.map((r) => r.checksum)).size).toBe(1);

      // --- R13: commit-on-intent — exactly ONE commit for the whole gesture -
      for (const r of runs.filter((r) => r.mode === 'log')) {
        expect(r.commits).toBe(1);
        // the single commit REPLACED the transient clause (same source
        // identity via the registry) — the selection ends with one clause
        expect(r.selectionClauseCount).toBe(1);
        // and that surviving clause is the cause-tagged committed one
        expect(r.activeClauseCause).toEqual({
          requestedBy: 'user',
          computedBy: 'user',
          intent: 'brush amount to final window',
        });
      }
      // the nolog arm never commits anything
      for (const r of runs.filter((r) => r.mode === 'nolog')) {
        expect(r.commits).toBe(0);
        expect(r.selectionClauseCount).toBe(1);
      }

      // --- THE NUMBER: main-thread budget delta ~ 0 --------------------------
      // "≈ 0" bound: less than one long task of difference on average, and
      // less than one frame (16ms) of TBT difference. Measured values are
      // printed so the report states real numbers, not just a pass.
      const longTaskDelta = Math.abs(
        summary.log.longTasksMean - summary.nolog.longTasksMean,
      );
      const tbtDelta = Math.abs(summary.log.tbtMsMean - summary.nolog.tbtMsMean);
      expect(longTaskDelta).toBeLessThanOrEqual(1);
      expect(tbtDelta).toBeLessThanOrEqual(16);

      // publish the measured table into the test output (anti-fabrication)
      // eslint-disable-next-line no-console
      console.log(summary.table);
      // eslint-disable-next-line no-console
      console.log(
        `MEASURED: longTasks log=${summary.log.longTasksMean} nolog=${summary.nolog.longTasksMean} delta=${longTaskDelta}` +
          ` | TBT(ms) log=${summary.log.tbtMsMean.toFixed(2)} nolog=${summary.nolog.tbtMsMean.toFixed(2)} delta=${tbtDelta.toFixed(2)}` +
          ` | one-commit cost=${summary.log.commitMsMean.toFixed(3)}ms (after gesture end)`,
      );
    },
    BENCH_TIMEOUT_MS,
  );
});
