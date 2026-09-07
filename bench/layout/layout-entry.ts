/**
 * LAYOUT BENCH — THE MEASUREMENTS. Bundled by `run.mjs`, run in a child node,
 * prints ONE JSON object on stdout and nothing else.
 *
 * The law it follows: measure before claiming. No sentence in any README, any
 * commit message or any refusal may quote a millisecond, a byte or a stress
 * value that did not come out of this file. In particular the CAP on exact
 * all-pairs — the number `distancesOf`'s refusal has to quote — is decided by
 * the `allPairs` and `matrixBytes` columns below and by nothing else.
 *
 * WHAT IS MEASURED, per size, in the order the layout does them:
 *   generate    building the seeded synthetic graph (bench cost, not the layout's)
 *   adjacency   nodes + edges rows -> undirected graph          [ms]
 *   allPairs    every-source BFS -> the n-by-n distance matrix   [ms, bytes]
 *   place       the seeded SGD stress iterations                 [ms, ms/iteration]
 *   stress      the finished layout, scored by the bench's own metric [dimensionless]
 * plus RSS, heap and array-buffer bytes SAMPLED after each phase, and the
 * honesty counters the adjacency and the distance matrix carry (dropped
 * endpoints, disconnected pairs).
 *
 * MEMORY, read carefully: the sampled columns are the largest of four readings
 * taken BETWEEN phases, not a peak over the run — nothing samples inside a
 * phase. And the distance matrix is a `Uint16Array`, so it lands in
 * `arrayBuffers`/`external`, NOT in `heapUsed`: the array-buffer column is the
 * one `matrixBytes` may be compared against.
 *
 * TWO IMPLEMENTATIONS OF PHASE 2, on purpose. `measure.ts` carries a cap-FREE
 * all-pairs; `src/analysis/layout.ts` carries the real one, which REFUSES above
 * its cap. The bench's own is what makes 10,000 nodes measurable on a day when
 * the real one refuses there — a bench that inherited the cap could never
 * measure the size that justifies it. Both are reported side by side, and the
 * real one's MATRIX is cross-checked against the bench's, not only its clock.
 *
 * THE CONTROLS come first in the output and gate everything after them: if the
 * clock cannot see a deliberate 40 ms block, or the stress metric cannot tell a
 * known-good grid embedding from uniform noise, `controls.live` is false and
 * every number below it is void. `bench/layout/layout.test.ts` asserts the same
 * two facts as a test, so a dead instrument fails the suite and not just the
 * report.
 */

import { DEFAULT_SHAPE, gridGraph, mulberry32, synthesizeGraph, type SyntheticGraph } from './gen.js';
import {
  adjacencyOf as benchAdjacencyOf,
  allPairsOf,
  DEFAULT_COLUMNS,
  memoryNow,
  scrambleOf,
  spin,
  stats,
  stressOf,
  timeOnce,
  type BenchDistances,
} from './measure.js';
import type { LayoutContract, LayoutDistances } from './contract.js';
// The one static import of the thing under measurement. `run.mjs` refuses to
// bundle this file unless `src/analysis/layout.ts` exists, so an absent layout
// is a sentence and not a bundler error.
import * as layoutModule from '../../src/analysis/layout.js';

const layout = layoutModule as unknown as LayoutContract;
const COLS = { key: DEFAULT_COLUMNS.key, from: DEFAULT_COLUMNS.from, to: DEFAULT_COLUMNS.to };

// ── The plan ─────────────────────────────────────────────────────────────────

interface Arm {
  readonly nodes: number;
  readonly reps: number;
  readonly iterations: number;
}

/**
 * `LAYOUT_BENCH_PLAN` = `nodes:reps:iterations,...`.
 *
 * WHY the big arm runs once: SGD stress is O(n^2) per iteration, so 10,000
 * nodes is 50 million terms per pass. One repetition of the real thing beats
 * three repetitions of something smaller pretending to be it.
 */
const DEFAULT_PLAN = '1000:3:30,10000:1:30';

/**
 * WHY it refuses rather than defaulting past a bad number: `??` only fills a
 * MISSING field, and `Number('')` is 0 while `Number('x')` is NaN — both
 * survive it. An arm of 0 reps takes no sample, and `stats` would then have to
 * mint a median for it; an arm of 0 nodes measures a table nobody asked for. A
 * plan that cannot be timed should not produce a table.
 */
function wholeAbove(raw: string, field: string, part: string, least: number): number {
  const v = Number(raw.trim());
  if (!Number.isInteger(v) || v < least) {
    throw new Error(
      `LAYOUT_BENCH_PLAN cannot be read: part "${part}" gives ${field}="${raw.trim()}", ` +
        `and an arm needs a whole number of at least ${least} — the form is nodes:reps:iterations, e.g. "${DEFAULT_PLAN}"`,
    );
  }
  return v;
}

function planOf(text: string): Arm[] {
  return text.split(',').map((part) => {
    const [n = '', reps = '', iterations = ''] = part.split(':');
    return {
      nodes: wholeAbove(n, 'nodes', part, 2),
      reps: wholeAbove(reps, 'reps', part, 1),
      iterations: wholeAbove(iterations, 'iterations', part, 1),
    };
  });
}

const PLAN = planOf(process.env['LAYOUT_BENCH_PLAN'] ?? DEFAULT_PLAN);
const SEED = Number(process.env['LAYOUT_BENCH_SEED'] ?? 42);
const SOURCES = Number(process.env['LAYOUT_BENCH_SOURCES'] ?? 64);
const WARMUP = 1;

// ── The controls ─────────────────────────────────────────────────────────────

/** The two facts that make every number below quotable. Reported first, on purpose. */
function controlsNow(): Record<string, unknown> {
  const asked = 40;
  const clock = timeOnce(() => spin(asked));

  const g = gridGraph(12);
  const adj = benchAdjacencyOf(g.nodes, g.edges);
  const truth = stressOf({ x: g.truth.x, y: g.truth.y }, adj, { sources: 32, seed: 7 });
  const noise = stressOf(scrambleOf(adj.n, 99), adj, { sources: 32, seed: 7 });
  // WHY `counted` gates liveness: a metric that skipped every pair reports
  // meanStress NaN, and a ratio built on it must never read as "alive".
  const counting = truth.counted > 0 && noise.counted > 0;
  const ratio = counting ? noise.meanStress / truth.meanStress : Number.NaN;

  const clockLive = clock.ms >= asked / 2;
  const metricLive = counting && ratio > 3;
  return {
    clock: { askedMs: asked, readMs: round(clock.ms), live: clockLive },
    metric: {
      graph: '12x12 grid (BFS distance == Manhattan distance, so the grid coordinates are a known-good embedding)',
      truthMeanStress: round(truth.meanStress, 6),
      scrambledMeanStress: round(noise.meanStress, 6),
      counted: truth.counted,
      ratio: round(ratio, 2),
      live: metricLive,
    },
    live: clockLive && metricLive,
    note: 'live:false voids every number in this file — a dead instrument reports "no cost" in the same voice as a fast one.',
  };
}

// ── One arm ──────────────────────────────────────────────────────────────────

function round(v: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * Median/p95 of `reps` timed calls, after `WARMUP` discarded ones, KEEPING the
 * last value.
 *
 * WHY it returns the value: a phase that had to be primed with one extra
 * untimed call — only to satisfy definite assignment — would run `1 + WARMUP +
 * reps` times. At 10,000 nodes that is a third 200 MB matrix and a third
 * 30-pass SGD, landing in the very memory column the cap is argued from.
 */
function repeat<T>(reps: number, fn: () => T): { median: number; p95: number; min: number; n: number; last: T } {
  let last: T | undefined;
  for (let i = 0; i < WARMUP; i++) last = fn();
  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    const one = timeOnce(fn);
    samples.push(one.ms);
    last = one.value;
  }
  return { ...stats(samples), last: last as T };
}

/**
 * Does the real all-pairs matrix say the same thing as the bench's?
 *
 * WHY a sample and not every cell: at 10,000 nodes the matrix is 100 million
 * cells, and comparing all of them would cost more than the phase. A seeded
 * 1,000-cell sample plus the three summary numbers catches a rule that moved
 * (a substitution, a hop counted short) without becoming a phase of its own.
 */
function agreementOf(real: LayoutDistances, own: BenchDistances): Record<string, unknown> {
  const disagree = (what: string): Record<string, unknown> => ({ agreesWithBench: false, firstDisagreement: what });
  if (real.n !== own.n) return disagree(`n ${real.n} vs ${own.n}`);
  if (real.maxFinite !== own.maxFinite) return disagree(`maxFinite ${real.maxFinite} vs ${own.maxFinite}`);
  if (real.disconnectedPairs !== own.disconnectedPairs) return disagree(`disconnectedPairs ${real.disconnectedPairs} vs ${own.disconnectedPairs}`);
  const cells = own.d.length;
  const rnd = mulberry32(7);
  for (let k = 0; k < Math.min(1000, cells); k++) {
    const i = Math.floor(rnd() * cells);
    if (real.d[i] !== own.d[i]) return disagree(`cell ${i}: ${String(real.d[i])} vs ${String(own.d[i])}`);
  }
  return { agreesWithBench: true, cellsSampled: Math.min(1000, cells) };
}

/**
 * Phase 2 through the REAL implementation — which may refuse, and that is a
 * result.
 *
 * WHY it separates `refused` from `crashed`: the catch would otherwise publish
 * a `TypeError` in the slot the table prints as the cap's ceiling, and a broken
 * implementation would read as a working law. Only the layout's own
 * `LayoutError` is a refusal. And the refusal is re-read AFTER the timed reps,
 * because a throw is fast: a call that started failing mid-sample would
 * otherwise be timed as a successful — better — pass.
 */
function realDistances(adj: unknown, reps: number, own: BenchDistances): Record<string, unknown> {
  let refusal = '';
  let crash = '';
  const once = (): LayoutDistances | undefined => {
    try {
      return layout.distancesOf(adj as never);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === 'LayoutError') refusal = err.message;
      else crash = err.message;
      return undefined;
    }
  };
  const said = (): Record<string, unknown> | undefined => {
    if (crash !== '') return { measured: false, crashed: crash };
    if (refusal !== '') return { measured: false, refused: refusal };
    return undefined;
  };
  once();
  const early = said();
  if (early !== undefined) return early;
  const t = repeat(reps, once);
  const late = said();
  if (late !== undefined) return late;
  const matrix = t.last;
  return {
    measured: true,
    medianMs: round(t.median),
    p95Ms: round(t.p95),
    ...(matrix === undefined ? { agreesWithBench: false, firstDisagreement: 'the real implementation returned nothing' } : agreementOf(matrix, own)),
  };
}

function armOf(arm: Arm): Record<string, unknown> {
  const graph = timeOnce<SyntheticGraph>(() => synthesizeGraph({ ...DEFAULT_SHAPE, nodes: arm.nodes }, SEED));
  const g = graph.value;
  const afterGraph = memoryNow();

  // phase 1 — adjacency, through the implementation, cross-checked against the bench's own
  const adjacency = repeat(arm.reps, () => layout.adjacencyOf(g.nodes, g.edges, COLS));
  const adj = adjacency.last;
  const mine = benchAdjacencyOf(g.nodes, g.edges);
  const afterAdjacency = memoryNow();

  // phase 2 — all-pairs. The bench's own is cap-free and always runs; the real
  // one runs when it does not refuse. Both are reported.
  const allPairs = repeat(arm.reps, () => allPairsOf(mine));
  const own: BenchDistances = allPairs.last;
  const real = realDistances(adj, arm.reps, own);
  const afterAllPairs = memoryNow();

  // phase 3 — the SGD iterations, fed the bench's distances so the big arm is
  // measurable whatever the implementation's cap turns out to be
  const distances: LayoutDistances = { n: own.n, d: own.d, maxFinite: own.maxFinite, disconnectedPairs: own.disconnectedPairs };
  const place = repeat(arm.reps, () => layout.place({ distances, seed: SEED, iterations: arm.iterations }));
  const placed = place.last;
  const afterPlace = memoryNow();

  // the quality reading, by the instrument that shares no code with the layout
  const good = stressOf(placed, mine, { sources: SOURCES, seed: 7 });
  const noise = stressOf(scrambleOf(mine.n, 99), mine, { sources: SOURCES, seed: 7 });

  return {
    nodes: arm.nodes,
    reps: arm.reps,
    iterations: arm.iterations,
    graph: { ...g.meta, edgeRows: g.edges.length, buildMs: round(graph.ms) },
    adjacency: {
      medianMs: round(adjacency.median),
      p95Ms: round(adjacency.p95),
      samples: adjacency.n,
      total: adj.total,
      used: adj.used,
      dropped: adj.dropped,
      // WHY degree and not only the counters: two implementations that resolve
      // a duplicate key differently build DIFFERENT graphs while their
      // used/dropped counts match exactly, and an agreement flag that cannot
      // see that is not an agreement.
      agreesWithBench: adj.n === mine.n && adj.used === mine.used && adj.dropped === mine.dropped && degreeOf(adj.neighbours) === degreeOf(mine.neighbours),
      benchUsed: mine.used,
      benchDropped: mine.dropped,
      degree: degreeOf(adj.neighbours),
      benchDegree: degreeOf(mine.neighbours),
      benchDuplicateKeys: mine.duplicateKeys,
      benchKeylessNodes: mine.keylessNodes,
    },
    allPairs: {
      benchMedianMs: round(allPairs.median),
      benchP95Ms: round(allPairs.p95),
      samples: allPairs.n,
      real,
      matrixBytes: own.bytes,
      maxFinite: own.maxFinite,
      disconnectedPairs: own.disconnectedPairs,
    },
    place: {
      medianMs: round(place.median),
      p95Ms: round(place.p95),
      samples: place.n,
      msPerIteration: round(place.median / arm.iterations),
    },
    stress: {
      sources: good.sources,
      placedMeanStress: round(good.meanStress, 6),
      scrambledMeanStress: round(noise.meanStress, 6),
      ratio: good.counted === 0 || good.meanStress === 0 ? null : round(noise.meanStress / good.meanStress, 2),
      counted: good.counted,
      skipped: good.skipped,
    },
    memory: {
      // NAMED for what was computed: the largest of four samples taken BETWEEN
      // phases, over `runsPerPhase` executions of each. Not a peak over the run.
      runsPerPhase: WARMUP + arm.reps,
      afterGraphRss: afterGraph.rss,
      afterAdjacencyRss: afterAdjacency.rss,
      afterAllPairsRss: afterAllPairs.rss,
      afterPlaceRss: afterPlace.rss,
      maxSampledRss: Math.max(afterGraph.rss, afterAdjacency.rss, afterAllPairs.rss, afterPlace.rss),
      maxSampledHeapUsed: Math.max(afterGraph.heapUsed, afterAdjacency.heapUsed, afterAllPairs.heapUsed, afterPlace.heapUsed),
      // The distance matrix lives here, not in the heap: this is the column
      // `matrixBytes` is answerable to.
      maxSampledArrayBuffers: Math.max(afterGraph.arrayBuffers, afterAdjacency.arrayBuffers, afterAllPairs.arrayBuffers, afterPlace.arrayBuffers),
      maxSampledExternal: Math.max(afterGraph.external, afterAdjacency.external, afterAllPairs.external, afterPlace.external),
    },
  };
}

/** Total degree — the one O(n) read that tells two adjacencies apart when the counters cannot. */
function degreeOf(neighbours: readonly (readonly number[])[]): number {
  let sum = 0;
  for (const list of neighbours) sum += list.length;
  return sum;
}

// ── The whole analysis, once ─────────────────────────────────────────────────

/**
 * Time ONE end-to-end run of the declared analysis at the smallest arm.
 *
 * The phases above are the layout's cost; this is what a session pays on top —
 * the flowchart, the commit and the column write.
 *
 * WHY it calls the contract instead of trying input shapes until one answers:
 * the related rows arrive on run's SECOND argument (`opts.related`), so a
 * one-argument call reads no edges at all — and a layout of 1,000 UNCONNECTED
 * nodes is not the declared analysis, whatever it costs. A resolved call is
 * also not a run: a pre-run honesty gate resolves in about no time, so the
 * result is judged before the clock is quoted.
 */
async function analysisRunOf(arm: Arm): Promise<Record<string, unknown>> {
  const g = synthesizeGraph({ ...DEFAULT_SHAPE, nodes: arm.nodes }, SEED);
  const mod = layout.layoutAnalysis({ algo: 'stress', table: 'nodes', edges: 'edges', seed: SEED, iterations: arm.iterations }) as {
    run(
      input: unknown,
      opts?: { related?: Record<string, readonly Record<string, unknown>[]> },
    ): Promise<{ result: { ok: boolean; reason?: string }; snapshot?: unknown }>;
  };
  const t0 = performance.now();
  try {
    const run = await mod.run(g.nodes, { related: { edges: g.edges } });
    const ms = round(performance.now() - t0);
    if (run.result.ok !== true || run.snapshot === undefined) {
      return { measured: false, nodes: arm.nodes, refused: `the analysis refused: ${run.result.reason ?? 'no snapshot'}` };
    }
    // one cold call, labelled as one — `warmupDiscarded` at the top governs the
    // phases, not this
    return { measured: true, nodes: arm.nodes, edgeRows: g.edges.length, warmup: 0, samples: 1, ms };
  } catch (e) {
    return { measured: false, nodes: arm.nodes, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const controls = controlsNow();
  // WHY each arm is isolated: one arm that dies (an OOM at a size nobody has
  // measured before) would otherwise discard every arm already measured, and
  // nothing is written at all. A size that cannot be measured is itself a
  // result about the cap.
  const sizes = PLAN.map((arm) => {
    try {
      return armOf(arm);
    } catch (e) {
      return { nodes: arm.nodes, measured: false, failed: e instanceof Error ? e.message : String(e) };
    }
  });
  const smallest = [...PLAN].sort((a, b) => a.nodes - b.nodes)[0] as Arm;
  const analysis = await analysisRunOf({ ...smallest, reps: 1 });
  const out = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    // WHY a wall-clock stamp is allowed here: the no-Date.now law governs
    // src/ — a library value must be projected, never re-derived. A bench report
    // is dated by when it was taken, and that date is not library state.
    generatedAt: new Date().toISOString(),
    plan: PLAN,
    seed: SEED,
    stressSources: SOURCES,
    warmupDiscarded: WARMUP,
    units: {
      time: 'milliseconds (performance.now wall clock)',
      memory: 'bytes (process.memoryUsage; heapUsed EXCLUDES typed-array backing stores, which land in arrayBuffers)',
      stress: 'dimensionless weighted mean squared residual at the optimal scale, normalized by the counted pairs (0 is exact, 1 is every node on one point)',
    },
    declaredCap: layout.LAYOUT_NODE_CAP,
    controls,
    sizes,
    analysis,
  };
  process.stdout.write(JSON.stringify(out));
}

await main();
