/**
 * LAYOUT BENCH — THE RENDERER'S ACCEPTANCE.
 *
 * The law it follows: an arm the renderer has never rendered is an arm nobody
 * has checked. `run.mjs` only ever hands `tableOf` a happy-path results object,
 * so the refusal, the void, the NOT MEASURED and the missing-number arms would
 * otherwise ship unexercised. Both fixtures below are hand-written — the point
 * is that they never came out of a real run.
 *
 * First customer: `bench/layout/table.mjs`, which `run.mjs` calls last.
 */

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the renderer is plain .mjs on purpose: run.mjs imports it without a build step
import { tableOf } from './table.mjs';

const ARM = {
  nodes: 1_000,
  reps: 3,
  iterations: 30,
  graph: { edgeRows: 2_919, giantCount: 970 },
  adjacency: { medianMs: 0.4, p95Ms: 0.5, samples: 3, total: 2_919, used: 2_919, dropped: 0, agreesWithBench: true },
  allPairs: { benchMedianMs: 17.4, benchP95Ms: 18, samples: 3, real: { measured: true, medianMs: 17.7, p95Ms: 18.2, agreesWithBench: true }, matrixBytes: 2_000_000, maxFinite: 7, disconnectedPairs: 59_052 },
  place: { medianMs: 159, p95Ms: 161, samples: 3, msPerIteration: 5.3 },
  stress: { sources: 64, placedMeanStress: 0.185, scrambledMeanStress: 0.264, ratio: 1.43, counted: 59_111, skipped: 4_825 },
  memory: { runsPerPhase: 4, maxSampledRss: 74_400_000, maxSampledHeapUsed: 13_700_000, maxSampledArrayBuffers: 2_100_000, maxSampledExternal: 3_000_000 },
};

const BASE = {
  node: 'v22.16.0',
  platform: 'darwin arm64',
  generatedAt: '2026-09-07T00:00:00.000Z',
  units: { time: 'ms', memory: 'bytes', stress: 'dimensionless' },
  seed: 42,
  stressSources: 64,
  warmupDiscarded: 1,
  declaredCap: 5_000,
  controls: { clock: { askedMs: 40, readMs: 40, live: true }, metric: { graph: '12x12 grid', truthMeanStress: 0.015, scrambledMeanStress: 0.568, counted: 4_576, ratio: 37.1, live: true }, live: true, note: 'a dead instrument reports "no cost" in the same voice as a fast one.' },
  sizes: [ARM],
  analysis: { measured: true, nodes: 1_000, edgeRows: 2_919, warmup: 0, samples: 1, ms: 203.153 },
};

describe('the layout bench table', () => {
  it('renders a live run: the controls fired, and every column carries its number', () => {
    const md = tableOf(BASE) as string;
    expect(md).toContain('Both controls fired');
    expect(md).toContain('1.9 MiB'); // 2,000,000 bytes at the binary divisor, labelled honestly
    expect(md).toContain('graph diameter');
    expect(md).toContain('pairs skipped (no finite distance or position)');
    expect(md).toContain('one cold call (no warm-up)');
    expect(md).not.toContain('CONTROL FAILED');
  });

  it('renders the void: dead controls, a refusal, a crash, a missing number and an arm that never ran', () => {
    const dead = {
      ...BASE,
      controls: { ...BASE.controls, metric: { ...BASE.controls.metric, live: false }, live: false },
      sizes: [
        { ...ARM, allPairs: { ...ARM.allPairs, real: { measured: false, refused: 'this graph has 10000 nodes and the ceiling is 5000' } } },
        { ...ARM, nodes: 2_000, allPairs: { ...ARM.allPairs, real: { measured: false, crashed: "Cannot read properties of undefined (reading 'n')" } } },
        { ...ARM, nodes: 3_000, allPairs: { ...ARM.allPairs, real: { measured: true, medianMs: 1, p95Ms: 1, agreesWithBench: false, firstDisagreement: 'maxFinite 6 vs 7' } } },
        { ...ARM, nodes: 4_000, memory: { ...ARM.memory, maxSampledArrayBuffers: null }, stress: { ...ARM.stress, ratio: null } },
        { nodes: 50_000, measured: false, failed: 'Invalid array length' },
      ],
      analysis: { measured: false, nodes: 1_000, refused: 'the analysis refused: degenerate-fit' },
    };
    const md = tableOf(dead) as string;
    expect(md).toContain('CONTROL FAILED — every number below is void');
    expect(md).toContain('REFUSED');
    expect(md).toContain('CRASHED');
    expect(md).toContain('the two all-pairs matrices disagree');
    expect(md).toContain('**NOT MEASURED** — Invalid array length');
    expect(md).toContain('NOT MEASURED at 1,000 nodes: the analysis refused: degenerate-fit');
    // a missing byte reading prints as an em dash, never as 0.0 MiB
    expect(md).toContain('| — |');
    expect(md).not.toContain('0.0 MiB');
    // the arm that never ran has no row of its own in the phase table
    expect(md).not.toContain('| 50,000 |');
  });
});
