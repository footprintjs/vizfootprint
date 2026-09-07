/**
 * LAYOUT BENCH ACCEPTANCE — WRITTEN FIRST, before `src/analysis/layout.ts`
 * exists. (`bench/x4/x4.test.ts` set this precedent for the browser bench.)
 *
 * The law it follows: no cost, latency or quality number reaches a README or a
 * commit message until a checked-in bench produced it. This file is the other
 * half of that law — it says what the bench must PROVE, so the numbers cannot
 * be quietly weakened later to whatever the implementation happens to do.
 *
 * TWO PARTS, and the split is the point:
 *
 *   PART A — THE INSTRUMENTS. Runs today, always, and must be green today.
 *   These are the positive controls: a clock that can read a deliberate 40 ms
 *   block, a generator that repeats byte-for-byte on a seed, a BFS that finds
 *   the giant component the generator promised, and a stress metric that scores
 *   a KNOWN-GOOD grid embedding far better than a scrambled one. If any of
 *   these fails, every number in `layout-results.json` is void — a dead
 *   instrument reports "no difference" and "no cost" in exactly the same voice
 *   as a fast, correct implementation.
 *
 *   PART B — THE LAYOUT. Skipped while `src/analysis/layout.ts` is absent, and
 *   it ARMS ITSELF the moment that file lands: the probe reads the real path
 *   through `contract.ts`, so it cannot rot into a permanent skip. Part B is
 *   the acceptance packet 3 has to satisfy.
 *
 * Nothing here writes to `src/`, and nothing here needs the harness: the whole
 * file runs in-process on small graphs in well under a second. The big sizes
 * (1,000 and 10,000 nodes) live in `run.mjs`, which is a report, not a gate.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_SHAPE, gridGraph, nodeKeyAt, synthesizeGraph } from './gen.js';
import { adjacencyOf, allPairsOf, bfsFrom, giantComponentOf, scrambleOf, spin, stats, stressOf, timeOnce } from './measure.js';
import { layoutHasLanded, missingExportsOf, notLandedSentence, REQUIRED_EXPORTS, type LayoutContract } from './contract.js';

// The probe. Resolved once, at load, so `skipIf` can read it.
const LANDED = layoutHasLanded();
const layout = LANDED ? ((await import('../../src/analysis/layout.js')) as unknown as LayoutContract) : null;

// ─────────────────────────────────────────────────────────────────────────────
// PART A — the instruments. Positive controls. These must pass TODAY.
// ─────────────────────────────────────────────────────────────────────────────

describe('layout bench · part A · the instruments are alive', () => {
  it('positive control: the clock reads a deliberate 40ms block as ~40ms', () => {
    // WHY: a phase that prints 0.00 ms is either instantaneous or unmeasured,
    // and those are indistinguishable in a table. This is what tells them apart.
    const { ms } = timeOnce(() => spin(40));
    expect(ms).toBeGreaterThanOrEqual(20);
    expect(ms).toBeLessThan(2_000);
    // and the clock is not a constant: no work reads back as far less
    const idle = timeOnce(() => 0);
    expect(idle.ms).toBeLessThan(ms);
  });

  it('the generator repeats on a seed, and moves on a different one', () => {
    const shape = { ...DEFAULT_SHAPE, nodes: 400 };
    const a = synthesizeGraph(shape, 42);
    const b = synthesizeGraph(shape, 42);
    const c = synthesizeGraph(shape, 43);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges));
    expect(JSON.stringify(a.edges)).not.toBe(JSON.stringify(c.edges));
    // the shape it reports is the shape it built
    expect(a.meta.nodeCount).toBe(400);
    expect(a.edges.length).toBe(a.meta.edgeCount);
  });

  it('positive control: BFS finds the giant component the generator promised', () => {
    // WHY: the timing of all-pairs is meaningless on a graph of isolated nodes —
    // every BFS would return instantly. This proves there is a real component
    // to walk, using the bench's OWN BFS (so the BFS is proven live too).
    const g = synthesizeGraph({ ...DEFAULT_SHAPE, nodes: 600 }, 42);
    const adj = adjacencyOf(g.nodes, g.edges);
    const giant = giantComponentOf(adj);
    expect(giant.share).toBeGreaterThanOrEqual(0.95);
    // and the fringe really is disconnected: some node is unreachable from node 0
    const d0 = bfsFrom(adj, 0);
    expect([...d0].some((d) => d < 0)).toBe(true);
  });

  it('adjacency counts the endpoints it could not resolve — never silently', () => {
    const g = synthesizeGraph({ ...DEFAULT_SHAPE, nodes: 100 }, 42);
    const edges = [...g.edges, { source: nodeKeyAt(0), target: 'nowhere', weight: 1 }, { source: 'nowhere', target: 'also-nowhere', weight: 1 }];
    const adj = adjacencyOf(g.nodes, edges);
    expect(adj.dropped).toBe(2);
    expect(adj.used).toBe(g.edges.length);
  });

  it('POSITIVE CONTROL: stress scores a known-good grid far better than a scramble', () => {
    // THE control that voids the quality numbers. On a k-by-k grid the BFS
    // distance IS the Manhattan distance, so the grid coordinates are a good
    // embedding — known WITHOUT any layout code. A metric that cannot see the
    // difference between that and uniform noise is dead.
    const g = gridGraph(12);
    const adj = adjacencyOf(g.nodes, g.edges);
    const truth = stressOf({ x: g.truth.x, y: g.truth.y }, adj, { sources: 32, seed: 7 });
    const noise = stressOf(scrambleOf(adj.n, 99), adj, { sources: 32, seed: 7 });

    expect(truth.counted).toBeGreaterThan(0);
    expect(truth.skipped).toBe(0); // the grid is connected: nothing to skip
    expect(truth.total).toBe(truth.counted + truth.skipped);
    expect(noise.meanStress).toBeGreaterThan(truth.meanStress * 3);

    // the worst layout of all — every node on one point — is worse still
    const collapsed = stressOf({ x: new Float64Array(adj.n), y: new Float64Array(adj.n) }, adj, { sources: 32, seed: 7 });
    expect(collapsed.meanStress).toBeGreaterThan(noise.meanStress);
  });

  it('stress is scale-invariant, so a layout is not judged by its units', () => {
    // WHY: without the optimal-scale step, "draw it in a smaller box" would beat
    // "get the shape right", and the control above would prove nothing.
    const g = gridGraph(10);
    const adj = adjacencyOf(g.nodes, g.edges);
    const one = stressOf({ x: g.truth.x, y: g.truth.y }, adj, { sources: 16, seed: 3 });
    const big = stressOf({ x: g.truth.x.map((v) => v * 100), y: g.truth.y.map((v) => v * 100) }, adj, { sources: 16, seed: 3 });
    expect(big.meanStress).toBeCloseTo(one.meanStress, 9);
    expect(big.scale).toBeCloseTo(one.scale / 100, 9);
  });

  it('stress skips the pairs it cannot measure, and says how many', () => {
    const g = synthesizeGraph({ ...DEFAULT_SHAPE, nodes: 300 }, 42);
    const adj = adjacencyOf(g.nodes, g.edges);
    const reading = stressOf(scrambleOf(adj.n, 5), adj, { sources: 24, seed: 11 });
    expect(reading.skipped).toBeGreaterThan(0); // the fringe is unreachable
    expect(reading.total).toBe(reading.counted + reading.skipped);
    expect(reading.sources).toBe(24);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — the layout. Skipped until `src/analysis/layout.ts` lands; arms itself
// the moment it does. This is the acceptance packet 3 must satisfy.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!LANDED)('layout bench · part B · the layout acceptance', () => {
  // Not `layout!` everywhere: one narrow at the top, in the house's voice.
  const must = (): LayoutContract => {
    /* v8 ignore next -- unreachable: the suite is skipped when the module is absent */
    if (!layout) throw new Error(notLandedSentence());
    return layout;
  };

  it('exposes the seam the bench measures', () => {
    const missing = missingExportsOf(must() as unknown as Record<string, unknown>);
    expect(missing, `src/analysis/layout.ts must export ${REQUIRED_EXPORTS.join(', ')}`).toEqual([]);
    expect(typeof must().LAYOUT_NODE_CAP).toBe('number');
    expect(must().LAYOUT_NODE_CAP).toBeGreaterThanOrEqual(1_000);
  });

  it('the same seed and the same rows give byte-identical positions', () => {
    // THE determinism pin. Positions are DATA that ride the trace; a replay that
    // re-runs this act must rebuild the same numbers from the same bytes.
    const g = gridGraph(12);
    const adj = must().adjacencyOf(g.nodes, g.edges, { key: 'id', from: 'source', to: 'target' });
    const dist = must().distancesOf(adj);
    const a = must().place({ distances: dist, seed: 1234, iterations: 30 });
    const b = must().place({ distances: dist, seed: 1234, iterations: 30 });
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
    // and a different seed is a different layout, so the seed is really used
    const c = must().place({ distances: dist, seed: 4321, iterations: 30 });
    expect([...c.x]).not.toEqual([...a.x]);
  });

  it('beats the scrambled baseline on the bench’s own metric', () => {
    // Measured with `measure.ts`, which shares no code with the layout — so this
    // is two implementations agreeing, not one function called twice.
    const g = gridGraph(12);
    const adj = must().adjacencyOf(g.nodes, g.edges, { key: 'id', from: 'source', to: 'target' });
    const placed = must().place({ distances: must().distancesOf(adj), seed: 1234, iterations: 30 });
    const own = adjacencyOf(g.nodes, g.edges);
    const good = stressOf(placed, own, { sources: 32, seed: 7 });
    const noise = stressOf(scrambleOf(own.n, 99), own, { sources: 32, seed: 7 });
    expect(good.meanStress).toBeLessThan(noise.meanStress / 3);
    // eslint-disable-next-line no-console
    console.log(`MEASURED: 12x12 grid meanStress placed=${good.meanStress.toFixed(4)} scrambled=${noise.meanStress.toFixed(4)} ratio=${(noise.meanStress / good.meanStress).toFixed(1)}x`);
  });

  it('refuses above the cap, in a sentence that quotes the cap', () => {
    // The refusal must come from `n` alone, BEFORE anything n-by-n is allocated:
    // an implementation that allocated first would fall over instead of refusing.
    const cap = must().LAYOUT_NODE_CAP;
    const oversized = { n: cap + 1, keys: [], neighbours: [], total: 0, used: 0, dropped: 0 };
    let said = '';
    try {
      must().distancesOf(oversized);
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    expect(said, 'distancesOf must refuse a graph above the cap').not.toBe('');
    expect(said).toContain(String(cap));
    expect(said).toContain(String(cap + 1));
  });

  it('a node that already has a position keeps it — the mental map holds', () => {
    // Misue 1995: a re-layout that moves everything destroys the reader's map.
    const g = gridGraph(10);
    const adj = must().adjacencyOf(g.nodes, g.edges, { key: 'id', from: 'source', to: 'target' });
    const dist = must().distancesOf(adj);
    const x0 = new Float64Array(adj.n).fill(Number.NaN);
    const y0 = new Float64Array(adj.n).fill(Number.NaN);
    const anchored = new Float64Array(adj.n);
    x0[0] = 11.5;
    y0[0] = -4.25;
    anchored[0] = 1;
    const placed = must().place({ distances: dist, seed: 1234, iterations: 30, x0, y0, anchored });
    expect(placed.x[0]).toBe(11.5);
    expect(placed.y[0]).toBe(-4.25);
    // every other node still got a real number
    for (let i = 1; i < adj.n; i++) {
      expect(Number.isFinite(placed.x[i] as number)).toBe(true);
      expect(Number.isFinite(placed.y[i] as number)).toBe(true);
    }
  });

  it('counts the edge rows whose endpoint is not a node', () => {
    const g = gridGraph(6);
    const edges = [...g.edges, { source: nodeKeyAt(0), target: 'nowhere', weight: 1 }];
    const adj = must().adjacencyOf(g.nodes, edges, { key: 'id', from: 'source', to: 'target' });
    expect(adj.total).toBe(edges.length);
    expect(adj.used).toBe(g.edges.length);
    expect(adj.dropped).toBe(1);
  });

  it('applies the disconnected rule: d = maxFinite + 1', () => {
    const g = synthesizeGraph({ ...DEFAULT_SHAPE, nodes: 200 }, 42);
    const adj = must().adjacencyOf(g.nodes, g.edges, { key: 'id', from: 'source', to: 'target' });
    const dist = must().distancesOf(adj);
    expect(dist.n).toBe(200);
    expect(dist.maxFinite).toBeGreaterThan(1);
    expect(dist.disconnectedPairs).toBeGreaterThan(0);
    let biggest = 0;
    for (let i = 0; i < dist.n * dist.n; i++) biggest = Math.max(biggest, dist.d[i] as number);
    expect(biggest).toBe(dist.maxFinite + 1);
  });
});

// While part B sleeps, say so out loud once — a silent skip is how a bench-first
// acceptance turns into a bench nobody ever armed.
describe.skipIf(LANDED)('layout bench · part B is waiting', () => {
  it('says what is missing', () => {
    // eslint-disable-next-line no-console
    console.log(`PENDING: ${notLandedSentence()}`);
    expect(layoutHasLanded()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART C — the instruments' refusals. Each of these is a way an instrument can
// report "no cost" for something it never measured, which is the one failure
// that voids a table quietly.
// ─────────────────────────────────────────────────────────────────────────────

describe('layout bench · part C · what the instruments refuse to say', () => {
  it('stats refuses an empty sample rather than minting a median of 0', () => {
    let said = '';
    try {
      stats([]);
    } catch (e) {
      said = e instanceof Error ? e.message : String(e);
    }
    expect(said).toContain('0 samples');
    expect(stats([2, 1, 3]).median).toBe(2);
  });

  it('a stress reading that counted nothing is NaN, not the score of a perfect layout', () => {
    const g = gridGraph(4);
    const adj = adjacencyOf(g.nodes, g.edges);
    const nan = new Float64Array(adj.n).fill(Number.NaN);
    const dead = stressOf({ x: nan, y: nan }, adj, { sources: 8, seed: 7 });
    expect(dead.counted).toBe(0);
    expect(Number.isNaN(dead.meanStress)).toBe(true);
    expect(Number.isNaN(dead.stress)).toBe(true);
    // and a layout on one point still scores 1 — the worst REAL reading
    const flat = stressOf({ x: new Float64Array(adj.n), y: new Float64Array(adj.n) }, adj, { sources: 8, seed: 7 });
    expect(flat.meanStress).toBeCloseTo(1, 12);
  });

  it('an edgeless graph is not a unit-distance clique', () => {
    // maxFinite is 0 there, and `0 + 1` would say every isolated pair is ADJACENT.
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const d = allPairsOf(adjacencyOf(rows, []));
    expect(d.maxFinite).toBe(0);
    expect(d.disconnectedPairs).toBe(6);
    expect([...d.d]).toEqual([0, 2, 2, 2, 0, 2, 2, 2, 0]);
  });

  it('adjacency counts what it collapsed: duplicate keys, keyless rows and self-loops', () => {
    const rows = [{ id: 'a' }, { id: 'a' }, { label: 'no key' }, { id: 'b' }];
    const adj = adjacencyOf(rows, [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'a' }, // a self-loop joins nothing
      { target: 'b' }, // an absent endpoint joins nothing — not even the keyless row
    ]);
    expect(adj.duplicateKeys).toBe(1);
    expect(adj.keylessNodes).toBe(1);
    expect(adj.used).toBe(1);
    expect(adj.dropped).toBe(2);
    // first wins: the edge reached row 0, and row 1 stayed isolated
    expect(adj.neighbours[0]).toEqual([3]);
    expect(adj.neighbours[1]).toEqual([]);
  });

  it('the generator never emits an edge to a node it did not create', () => {
    for (const nodes of [0, 1, 2, 3]) {
      const g = synthesizeGraph({ ...DEFAULT_SHAPE, nodes }, 42);
      const keys = new Set(g.nodes.map((r) => r['id']));
      expect(g.nodes.length).toBe(nodes);
      expect(g.meta.fringeCount).toBeGreaterThanOrEqual(0);
      expect(g.meta.giantCount).toBeLessThanOrEqual(nodes);
      for (const e of g.edges) {
        expect(keys.has(e['source'])).toBe(true);
        expect(keys.has(e['target'])).toBe(true);
      }
    }
  });
});
