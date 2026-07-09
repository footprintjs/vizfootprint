/**
 * X4 runner — bundles page-entry.ts, drives the pinned headless Chromium,
 * runs interleaved log/nolog reps of the 3s/60Hz brush bench, and prints the
 * main-thread-budget table.
 *
 * Programmatic API: `runX4({ reps, rows, frames, seed })` (used by x4.test.ts).
 * CLI: `node bench/x4/run.mjs` (thin wrapper, prints the table).
 *
 * Robustness notes (earned the hard way in this packet):
 *  - The hard-abort watchdog SIGKILLs the browser child process directly and
 *    never awaits browser.close() — a stalled renderer hangs close() too.
 *  - The page side has its own watchdog (see page-entry.ts) so evaluate()
 *    returns a `stalled` result instead of hanging forever.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Pinned browser build (playwright chromium_headless_shell rev 1208). */
export const CHROME_EXECUTABLE =
  '/Users/sanjay/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';

/**
 * Bundle the page bench into a single browser IIFE (global `X4Bench`).
 * @uwdata/mosaic-core's barrel statically imports its DuckDB-WASM connector;
 * the bench never touches it, so it is aliased to an empty stub to keep the
 * bundle lean. Selection / clause / session code is the real thing.
 */
export async function buildPageBundle() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'page-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'X4Bench',
    platform: 'browser',
    target: 'es2022',
    plugins: [
      {
        name: 'stub-duckdb-wasm',
        setup(build) {
          build.onResolve({ filter: /^@duckdb\/duckdb-wasm$/ }, (args) => ({
            path: args.path,
            namespace: 'duckdb-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'duckdb-stub' }, () => ({
            contents: 'export default {};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no output');
  return out.text;
}

/**
 * Run one bench config in a FRESH page.
 * @param {import('playwright-core').Browser} browser
 * @param {string} bundle
 * @param {{mode: 'log'|'nolog', rows: number, frames: number, seed: number}} cfg
 */
async function runOnce(browser, bundle, cfg) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: bundle });
    /** @type {import('./page-entry.ts').BenchResult} */
    const result = await page.evaluate(
      (c) => globalThis.X4Bench.runBench(c),
      cfg,
    );
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Positive control: prove the longtask detector is LIVE in this browser build
 * before trusting a 0-vs-0 delta. Blocks the main thread ~80ms off a timer
 * and expects PerformanceObserver('longtask') to report it.
 * @param {import('playwright-core').Browser} browser
 */
async function runDetectorControl(browser) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    return await page.evaluate(async () => {
      const durations = [];
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) durations.push(e.duration);
      });
      po.observe({ entryTypes: ['longtask'] });
      await new Promise((resolve) => {
        setTimeout(() => {
          const until = performance.now() + 80;
          while (performance.now() < until) {
            /* deliberate 80ms block */
          }
          resolve();
        }, 0);
      });
      await new Promise((r) => setTimeout(r, 300));
      for (const e of po.takeRecords()) durations.push(e.duration);
      po.disconnect();
      return {
        longTasks: durations.length,
        maxDurationMs: durations.length ? Math.max(...durations) : 0,
      };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Full X4 bench: `reps` interleaved (nolog, log) pairs, aggregated summary.
 * Interleaving cancels warm-up / thermal drift between the two arms.
 */
export async function runX4({ reps = 3, rows = 100_000, frames = 180, seed = 42 } = {}) {
  const bundle = await buildPageBundle();

  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE,
    headless: true,
  });

  // HARD abort: generous overall deadline; SIGKILL the child, never await close.
  const perRunBudgetMs = 60_000;
  const deadline = setTimeout(
    () => {
      // eslint-disable-next-line no-console
      console.error('X4 HARD TIMEOUT — SIGKILLing browser');
      try {
        browser.process()?.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    },
    reps * 2 * perRunBudgetMs,
  );
  if (typeof deadline.unref === 'function') deadline.unref();

  /** @type {any[]} */
  const runs = [];
  let detectorControl;
  try {
    detectorControl = await runDetectorControl(browser);
    for (let rep = 0; rep < reps; rep++) {
      for (const mode of /** @type {const} */ (['nolog', 'log'])) {
        const result = await runOnce(browser, bundle, { mode, rows, frames, seed });
        runs.push({ rep, ...result });
      }
    }
  } finally {
    clearTimeout(deadline);
    // close() with a safety net: if the renderer wedged, SIGKILL after 5s.
    const closeKill = setTimeout(() => {
      try {
        browser.process()?.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, 5_000);
    if (typeof closeKill.unref === 'function') closeKill.unref();
    await browser.close().catch(() => {});
    clearTimeout(closeKill);
  }

  const byMode = (m) => runs.filter((r) => r.mode === m);
  const agg = (m) => {
    const rs = byMode(m);
    return {
      runs: rs.length,
      longTasksMean: mean(rs.map((r) => r.longTaskCount)),
      longTasksTotal: rs.reduce((s, r) => s + r.longTaskCount, 0),
      tbtMsMean: mean(rs.map((r) => r.tbtMs)),
      commitsPerRun: mean(rs.map((r) => r.commits)),
      commitMsMean: mean(rs.map((r) => r.commitMs)),
      gestureWallMsMean: mean(rs.map((r) => r.gestureWallMs)),
      frameP50: mean(rs.map((r) => r.frameWorkMs.p50)),
      frameP95: mean(rs.map((r) => r.frameWorkMs.p95)),
      frameMax: Math.max(...rs.map((r) => r.frameWorkMs.max), 0),
    };
  };

  const log = agg('log');
  const nolog = agg('nolog');

  const fmt = (x, d = 2) => Number(x).toFixed(d);
  const rowsOut = [
    ['arm', 'runs', 'long tasks (>50ms) mean', 'TBT ms mean', 'commits/run', 'commit ms', 'gesture wall ms', 'frame work p50/p95/max ms'],
    [
      '(a) log attached',
      String(log.runs),
      fmt(log.longTasksMean, 2),
      fmt(log.tbtMsMean, 2),
      fmt(log.commitsPerRun, 0),
      fmt(log.commitMsMean, 3),
      fmt(log.gestureWallMsMean, 0),
      `${fmt(log.frameP50)}/${fmt(log.frameP95)}/${fmt(log.frameMax)}`,
    ],
    [
      '(b) logging disabled',
      String(nolog.runs),
      fmt(nolog.longTasksMean, 2),
      fmt(nolog.tbtMsMean, 2),
      fmt(nolog.commitsPerRun, 0),
      '—',
      fmt(nolog.gestureWallMsMean, 0),
      `${fmt(nolog.frameP50)}/${fmt(nolog.frameP95)}/${fmt(nolog.frameMax)}`,
    ],
    [
      'DELTA (a−b)',
      '',
      fmt(log.longTasksMean - nolog.longTasksMean, 2),
      fmt(log.tbtMsMean - nolog.tbtMsMean, 2),
      '',
      '',
      fmt(log.gestureWallMsMean - nolog.gestureWallMsMean, 0),
      '',
    ],
  ];
  const widths = rowsOut[0].map((_, i) => Math.max(...rowsOut.map((r) => r[i].length)));
  const table = rowsOut
    .map((r) => '| ' + r.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |')
    .join('\n');

  return { runs, summary: { log, nolog, table, detectorControl } };
}
