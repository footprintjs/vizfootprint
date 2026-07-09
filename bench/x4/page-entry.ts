/**
 * X4 page-side bench — runs INSIDE the headless Chromium page.
 *
 * Simulates one 3s / 60Hz brush gesture over a real @uwdata/mosaic-core
 * Selection: 180 transient Selection.update calls driven by
 * requestAnimationFrame, each followed by predicate evaluation over N
 * seeded synthetic rows (the stand-in for the client-side reaction Mosaic
 * views would perform). COMMIT ONLY ON GESTURE END (commit-on-intent):
 *
 *   mode 'log'   — a real CauseSelectionSession (src/log/log.ts, L1) is
 *                  attached; the gesture ends with exactly ONE session.commit.
 *   mode 'nolog' — no session exists anywhere; raw Mosaic only.
 *
 * Both modes drive the byte-identical hot path: same seeded Float64Array,
 * same clauseInterval → selection.update per frame, same full-array scan.
 * Instrumentation: PerformanceObserver('longtask') — long tasks (>50ms) and
 * total blocking time TBT = Σ max(0, duration − 50).
 *
 * Bundled by esbuild (see runner.mjs) and exposed as X4Bench.runBench.
 */

import { Selection, clauseInterval } from '@uwdata/mosaic-core';
import type { MosaicClient } from '@uwdata/mosaic-core';
import { CauseSelectionSession } from '../../src/log/index.js';
import { causeOf } from '../../src/mosaic/index.js';
import type { RegisteredSource, ActorMeta } from '../../src/mosaic/index.js';
import type { Cause } from '../../src/cause/index.js';

export interface BenchConfig {
  mode: 'log' | 'nolog';
  /** Synthetic rows evaluated per transient update. */
  rows: number;
  /** Transient updates in the gesture (180 = 3s at 60Hz). */
  frames: number;
  /** PRNG seed for the synthetic data (anti-fabrication: deterministic). */
  seed: number;
}

export interface BenchResult {
  mode: 'log' | 'nolog';
  /** True if the page watchdog fired (rAF stall) — run is invalid. */
  stalled: boolean;
  /** rAF frames actually executed. */
  frames: number;
  /** Long tasks (>50ms) observed from first update to post-gesture settle. */
  longTaskCount: number;
  /** Total blocking time in ms: Σ max(0, duration − 50). */
  tbtMs: number;
  /** Raw longtask durations (ms), for the report. */
  longTaskDurations: number[];
  /** Commits recorded by the session (0 when mode==='nolog'). */
  commits: number;
  /** Clauses left on the Selection after the gesture (expect 1). */
  selectionClauseCount: number;
  /** Cause read back off the active clause (log mode only, else null). */
  activeClauseCause: Cause | null;
  /** Fold of all per-update selected-row counts — equality across modes
   *  proves both arms performed identical predicate work. */
  checksum: number;
  /** Wall time of the whole gesture (first to last frame), ms. */
  gestureWallMs: number;
  /** Per-frame work duration stats (update + row scan), ms. */
  frameWorkMs: { p50: number; p95: number; max: number; mean: number };
  /** Cost of the single gesture-end commit (log mode; 0 otherwise), ms. */
  commitMs: number;
}

/** Deterministic PRNG (mulberry32) — seeded synthetic data, no fabrication. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/** The moving brush window for frame i of n: 25-wide, sweeping 0→50. */
function brushWindow(i: number, n: number): [number, number] {
  const t = n <= 1 ? 1 : i / (n - 1);
  const lo = t * 50;
  return [lo, lo + 25];
}

const ACTOR_META: ActorMeta = { actor: 'user', label: 'Amount brush' };
const GESTURE_CAUSE: Cause = {
  requestedBy: 'user',
  computedBy: 'user',
  intent: 'brush amount to final window',
};

export async function runBench(cfg: BenchConfig): Promise<BenchResult> {
  // --- seeded synthetic data ------------------------------------------------
  const rand = mulberry32(cfg.seed);
  const amount = new Float64Array(cfg.rows);
  for (let i = 0; i < cfg.rows; i++) amount[i] = rand() * 100;

  // --- selection + source identity -------------------------------------
  // Both arms use a crossfilter Selection and ONE stable source identity so
  // every transient update REPLACES the previous clause (Mosaic resolves by
  // source object identity). In log mode the source comes from the session's
  // registry — the SAME identity its gesture-end commit will use, so the
  // commit replaces the last transient clause instead of adding a second one.
  let selection: Selection;
  let session: CauseSelectionSession | null = null;
  let source: RegisteredSource | { viewId: string };
  if (cfg.mode === 'log') {
    session = new CauseSelectionSession(); // Selection.crossfilter() inside
    selection = session.selection;
    source = session.registry.register('brush', ACTOR_META);
  } else {
    selection = Selection.crossfilter();
    source = { viewId: 'brush' }; // plain identity, no registry, no log
  }
  // Mosaic types clients as Set<MosaicClient>; runtime use is Set.has only.
  const clients = new Set([source]) as unknown as Set<MosaicClient>;

  // --- long-task instrumentation ---------------------------------------
  const longTaskDurations: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTaskDurations.push(e.duration);
  });
  observer.observe({ entryTypes: ['longtask'] });

  // --- the gesture: cfg.frames transient updates via rAF ----------------
  const frameWork: number[] = [];
  let checksum = 0;
  let frames = 0;
  let stalled = false;

  const gestureStart = performance.now();
  await new Promise<void>((resolve) => {
    let lastFrameAt = performance.now();
    // Page watchdog: timers keep firing even if rAF stalls; resolve with
    // `stalled` instead of hanging the evaluate() forever.
    const watchdog = setInterval(() => {
      if (performance.now() - lastFrameAt > 2000) {
        clearInterval(watchdog);
        stalled = true;
        resolve();
      }
    }, 250);

    const tick = () => {
      lastFrameAt = performance.now();
      const workStart = performance.now();

      // (1) the Mosaic hot path: a TRANSIENT clause update (never committed)
      const [lo, hi] = brushWindow(frames, cfg.frames);
      selection.update(
        clauseInterval('amount', [lo, hi], { source, clients }),
      );

      // (2) synthetic client reaction: evaluate the LIVE selection's window
      //     over all N rows (value read back from the real Selection state)
      const v = selection.valueFor(source) as [number, number];
      let count = 0;
      for (let r = 0; r < amount.length; r++) {
        const a = amount[r]!;
        if (a >= v[0] && a <= v[1]) count++;
      }
      checksum += count;

      frameWork.push(performance.now() - workStart);
      frames++;
      if (frames < cfg.frames) {
        requestAnimationFrame(tick);
      } else {
        clearInterval(watchdog);
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
  const gestureWallMs = performance.now() - gestureStart;

  // --- gesture END: commit-on-intent (log mode only) --------------------
  let commitMs = 0;
  if (session && !stalled) {
    const [lo, hi] = brushWindow(cfg.frames - 1, cfg.frames);
    const c0 = performance.now();
    session.commit({
      id: 'gesture-1',
      parent: null,
      viewId: 'brush',
      actorMeta: ACTOR_META,
      kind: 'interval',
      field: 'amount',
      value: [lo, hi],
      cause: GESTURE_CAUSE,
    });
    commitMs = performance.now() - c0;
  }

  // --- settle, then collect any trailing longtask entries ---------------
  await new Promise((r) => setTimeout(r, 300));
  for (const e of observer.takeRecords()) longTaskDurations.push(e.duration);
  observer.disconnect();

  const tbtMs = longTaskDurations.reduce((s, d) => s + Math.max(0, d - 50), 0);
  const sorted = [...frameWork].sort((a, b) => a - b);
  const active = selection.active;

  return {
    mode: cfg.mode,
    stalled,
    frames,
    longTaskCount: longTaskDurations.length,
    tbtMs,
    longTaskDurations,
    commits: session ? session.records.length : 0,
    selectionClauseCount: selection.clauses.length,
    activeClauseCause: (active && causeOf(active)) ?? null,
    checksum,
    gestureWallMs,
    frameWorkMs: {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
      mean: frameWork.length
        ? frameWork.reduce((s, d) => s + d, 0) / frameWork.length
        : 0,
    },
    commitMs,
  };
}
