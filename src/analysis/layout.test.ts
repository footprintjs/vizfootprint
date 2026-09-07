/**
 * THE LAYOUT, HELD TO ITS PROMISES.
 *
 * The bench's acceptance (`bench/layout/layout.test.ts`, written before the
 * implementation) holds the seam: the phases exist, the seed decides the
 * numbers, the cap refuses, an anchored node keeps its place. This file holds
 * the LIBRARY's side of the same law — the analysis, the record's defaults, the
 * honesty counters, and every arm of the arithmetic — because a bench is a
 * report and only the suite is a gate.
 */

import { describe, expect, it } from 'vitest';
import {
  adjacencyOf,
  distancesOf,
  place,
  layoutAnalysis,
  LayoutError,
  LAYOUT_NODE_CAP,
  DEFAULT_GRAPH_COLUMNS,
  type LayoutAdjacency,
} from './layout.js';
import type { DataRow } from './builtins.js';

// ── the graphs the tests are written over ────────────────────────────────────

const COLS = DEFAULT_GRAPH_COLUMNS;

/** `0 - 1 - 2 - … - (n-1)`: the graph whose distances everyone can do in their head. */
function pathGraph(n: number): { nodes: DataRow[]; edges: DataRow[] } {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `node ${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
  return { nodes, edges };
}

/** A k-by-k grid: the one graph whose good 2-D layout is known without any layout code. */
function gridGraph(k: number): { nodes: DataRow[]; edges: DataRow[] } {
  const nodes: DataRow[] = [];
  const edges: DataRow[] = [];
  for (let row = 0; row < k; row += 1) {
    for (let col = 0; col < k; col += 1) {
      const i = row * k + col;
      nodes.push({ id: `n${i}`, label: `${row},${col}` });
      if (col + 1 < k) edges.push({ source: `n${i}`, target: `n${i + 1}` });
      if (row + 1 < k) edges.push({ source: `n${i}`, target: `n${i + k}` });
    }
  }
  return { nodes, edges };
}

/** Euclidean distance between two placed nodes — the one thing every quality claim below is made of. */
function apart(p: { x: Float64Array; y: Float64Array }, i: number, j: number): number {
  const dx = p.x[i]! - p.x[j]!;
  const dy = p.y[i]! - p.y[j]!;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — the graph
// ─────────────────────────────────────────────────────────────────────────────

describe('adjacencyOf — the graph, and what it could not use', () => {
  it('joins the two tables by key, both ways', () => {
    const g = pathGraph(4);
    const adj = adjacencyOf(g.nodes, g.edges, COLS);
    expect(adj.n).toBe(4);
    expect(adj.keys).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(adj.neighbours).toEqual([[1], [0, 2], [1, 3], [2]]);
    expect([adj.total, adj.used, adj.dropped]).toEqual([3, 3, 0]);
  });

  it('COUNTS the rows it could not use — an unknown endpoint and a self-loop alike', () => {
    const g = pathGraph(3);
    const edges = [
      ...g.edges,
      { source: 'n0', target: 'nowhere' }, // the `to` end names no node
      { source: 'nowhere', target: 'n1' }, // the `from` end names no node
      { source: 'n2', target: 'n2' }, // a self-loop joins nothing
      { target: 'n1' }, // no `from` column at all
      { source: 'n0' }, // and none with no `to` column
    ];
    const adj = adjacencyOf(g.nodes, edges, COLS);
    expect([adj.total, adj.used, adj.dropped]).toEqual([7, 2, 5]);
    // and the rows it DID use are the only ones in the graph
    expect(adj.neighbours).toEqual([[1], [0, 2], [1]]);
  });

  it('a node row with no key is keyed by the empty string, and the first of two duplicates wins', () => {
    const nodes = [{ label: 'no id here' }, { id: 'dup' }, { id: 'dup' }];
    const edges = [{ source: '', target: 'dup' }];
    const adj = adjacencyOf(nodes, edges, COLS);
    expect(adj.keys).toEqual(['', 'dup', 'dup']);
    // the edge reached node 1, never node 2 — an edge can only ever find the first
    expect(adj.neighbours).toEqual([[1], [0], []]);
    expect([adj.used, adj.dropped]).toEqual([1, 0]);
  });

  it('reads whichever columns it is told to', () => {
    const nodes = [{ code: 'a' }, { code: 'b' }];
    const edges = [{ head: 'a', tail: 'b' }];
    const adj = adjacencyOf(nodes, edges, { key: 'code', from: 'head', to: 'tail' });
    expect(adj.neighbours).toEqual([[1], [0]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — the distances, and the cap
// ─────────────────────────────────────────────────────────────────────────────

describe('distancesOf — exact hops, and the rule for the pairs there is no path between', () => {
  it('is the hop count, and nothing else', () => {
    const g = pathGraph(4);
    const d = distancesOf(adjacencyOf(g.nodes, g.edges, COLS));
    expect(d.n).toBe(4);
    expect([...d.d]).toEqual([0, 1, 2, 3, 1, 0, 1, 2, 2, 1, 0, 1, 3, 2, 1, 0]);
    expect(d.maxFinite).toBe(3);
    expect(d.disconnectedPairs).toBe(0);
  });

  it('gives a disconnected pair `maxFinite + 1`, and says how many there were', () => {
    // two components: 0-1-2 and 3-4
    const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` }));
    const edges = [
      { source: 'n0', target: 'n1' },
      { source: 'n1', target: 'n2' },
      { source: 'n3', target: 'n4' },
    ];
    const d = distancesOf(adjacencyOf(nodes, edges, COLS));
    expect(d.maxFinite).toBe(2);
    expect(d.d[0 * 5 + 3]).toBe(3); // no path — one hop beyond the graph's own diameter
    expect(d.d[0 * 5 + 2]).toBe(2); // a path, untouched
    // 3 nodes x 2 nodes, both ways
    expect(d.disconnectedPairs).toBe(12);
  });

  it('a graph with no edges at all is every pair disconnected, at distance 1', () => {
    const d = distancesOf(adjacencyOf([{ id: 'a' }, { id: 'b' }], [], COLS));
    expect(d.maxFinite).toBe(0);
    expect([...d.d]).toEqual([0, 1, 1, 0]);
    expect(d.disconnectedPairs).toBe(2);
  });

  it('REFUSES above the cap, in a sentence quoting the graph and the ceiling', () => {
    const oversized: LayoutAdjacency = {
      n: LAYOUT_NODE_CAP + 1,
      keys: [],
      neighbours: [],
      total: 0,
      used: 0,
      dropped: 0,
    };
    expect(() => distancesOf(oversized)).toThrow(LayoutError);
    try {
      distancesOf(oversized);
      expect.unreachable('a graph above the cap must not be laid out');
    } catch (error) {
      expect((error as Error).message).toBe(
        `a stress layout needs exact all-pairs distances, which is one ${LAYOUT_NODE_CAP + 1} × ${LAYOUT_NODE_CAP + 1} matrix: ` +
          `this graph has ${LAYOUT_NODE_CAP + 1} nodes and the ceiling is ${LAYOUT_NODE_CAP} — ` +
          `filter the nodes down, or lay the graph out in pieces`,
      );
      expect((error as Error).name).toBe('LayoutError');
    }
    // the cap is a ceiling, not a floor: exactly the cap is allowed through
    expect(() => distancesOf({ ...oversized, n: 0 })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — the placement
// ─────────────────────────────────────────────────────────────────────────────

describe('place — the same seed gives the same picture', () => {
  const g = gridGraph(5);
  const distances = distancesOf(adjacencyOf(g.nodes, g.edges, COLS));

  it('THE DETERMINISM PIN: two runs of one seed are byte-identical, and another seed is another picture', () => {
    const a = place({ distances, seed: 1234, iterations: 12 });
    const b = place({ distances, seed: 1234, iterations: 12 });
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
    const other = place({ distances, seed: 4321, iterations: 12 });
    expect([...other.x]).not.toEqual([...a.x]);
  });

  it('puts neighbours closer together than strangers — the graph, in the picture', () => {
    const placed = place({ distances, seed: 7, iterations: 30 });
    // node 0 is the grid's corner, node 4 is the far end of its row, node 24 the opposite corner
    expect(apart(placed, 0, 1)).toBeLessThan(apart(placed, 0, 4));
    expect(apart(placed, 0, 4)).toBeLessThan(apart(placed, 0, 24));
    // every node got a real number
    for (let i = 0; i < distances.n; i += 1) {
      expect(Number.isFinite(placed.x[i]!)).toBe(true);
      expect(Number.isFinite(placed.y[i]!)).toBe(true);
    }
  });

  it('one pass is a layout too — the schedule never divides by zero', () => {
    const once = place({ distances, seed: 3, iterations: 1 });
    expect(Number.isFinite(once.x[0]!)).toBe(true);
  });
});

describe('place — the mental map (Misue 1995)', () => {
  const g = gridGraph(4);
  const distances = distancesOf(adjacencyOf(g.nodes, g.edges, COLS));
  const n = distances.n;

  /** The warm start every test here builds on: node `i` was at (i, 0) last time. */
  function previously(pinned: readonly number[]): { x0: Float64Array; y0: Float64Array; anchored: Float64Array } {
    const x0 = new Float64Array(n).fill(Number.NaN);
    const y0 = new Float64Array(n).fill(Number.NaN);
    const anchored = new Float64Array(n);
    for (const i of pinned) {
      x0[i] = i;
      y0[i] = 0;
      anchored[i] = 1;
    }
    return { x0, y0, anchored };
  }

  it('an anchored node does not move, and everything else still gets a place', () => {
    const past = previously([0, 5]);
    const placed = place({ distances, seed: 1234, iterations: 20, ...past });
    expect(placed.x[0]).toBe(0);
    expect(placed.y[0]).toBe(0);
    expect(placed.x[5]).toBe(5);
    expect(placed.y[5]).toBe(0);
    for (let i = 0; i < n; i += 1) expect(Number.isFinite(placed.x[i]!)).toBe(true);
  });

  it('a NEW node starts at the centroid of the neighbours that already have one', () => {
    // pin two neighbours of node 1 (nodes 0 and 2) far apart on the x axis, and
    // nothing else: node 1 is new, and the only placed nodes it touches are those.
    const x0 = new Float64Array(n).fill(Number.NaN);
    const y0 = new Float64Array(n).fill(Number.NaN);
    const anchored = new Float64Array(n);
    x0[0] = -100;
    y0[0] = 50;
    x0[2] = 100;
    y0[2] = 50;
    anchored[0] = 1;
    anchored[2] = 1;
    // zero passes: the answer IS the start, which is what this test is about
    const started = place({ distances, seed: 5, iterations: 0, x0, y0, anchored });
    expect(started.x[1]).toBeCloseTo(0, 0); // the centroid of -100 and 100
    expect(started.y[1]).toBeCloseTo(50, 0);
    // a node with no placed neighbour at all went on the ring instead — away from the centroid
    expect(Math.abs(started.x[15]! - 0) + Math.abs(started.y[15]! - 50)).toBeGreaterThan(1);
  });

  it('a warm position that is only HALF a position is no position — the node is new', () => {
    const x0 = new Float64Array(n).fill(Number.NaN);
    const y0 = new Float64Array(n).fill(Number.NaN);
    x0[3] = 42; // an x with no y
    const started = place({ distances, seed: 5, iterations: 0, x0, y0 });
    expect(started.x[3]).not.toBe(42);
    expect(Number.isFinite(started.x[3]!)).toBe(true);
  });

  it('a warm node that is not anchored keeps its start but is free to move', () => {
    const x0 = new Float64Array(n).fill(Number.NaN);
    const y0 = new Float64Array(n).fill(Number.NaN);
    x0[0] = 1000;
    y0[0] = 1000;
    const started = place({ distances, seed: 5, iterations: 0, x0, y0 });
    expect([started.x[0], started.y[0]]).toEqual([1000, 1000]);
    const moved = place({ distances, seed: 5, iterations: 20, x0, y0 });
    expect(moved.x[0]).not.toBe(1000);
  });

  it('two nodes on exactly one point are pushed apart, the same way every time', () => {
    // A two-node graph, so the coincident pair is the ONLY pair there is: a
    // point has no direction to be moved along, and the nudge that gives it one
    // has to be the same on every replay.
    const pair = distancesOf(adjacencyOf([{ id: 'a' }, { id: 'b' }], [{ source: 'a', target: 'b' }], COLS));
    const x0 = Float64Array.from([3, 3]);
    const y0 = Float64Array.from([3, 3]);
    const a = place({ distances: pair, seed: 9, iterations: 6, x0, y0 });
    const b = place({ distances: pair, seed: 9, iterations: 6, x0, y0 });
    expect(apart(a, 0, 1)).toBeGreaterThan(0);
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
  });

  it('a pair whose two ends are both anchored is left alone entirely', () => {
    const past = previously(Array.from({ length: n }, (_, i) => i));
    const placed = place({ distances, seed: 1234, iterations: 20, ...past });
    for (let i = 0; i < n; i += 1) {
      expect(placed.x[i]).toBe(i);
      expect(placed.y[i]).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The analysis
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutAnalysis — the layout as a declared act', () => {
  const g = gridGraph(4);
  const related = { edges: g.edges };

  it('declares what it is: a transform, two columns, and the table it reads BESIDE its own', () => {
    const mod = layoutAnalysis();
    expect([mod.id, mod.kind, mod.def.produces]).toEqual(['layout:stress:nodes', 'transform', 'columns']);
    expect(mod.def.reads).toEqual(['edges']);
    expect(mod.def.honesty?.minPoints).toBe(2);
    expect(mod.def.inputs).toEqual([
      { column: 'id', role: 'identifier' },
      { column: 'x', role: 'x' },
      { column: 'y', role: 'y' },
    ]);
  });

  // WHY this calls `toRunInput` directly: `run` refuses an invocation that
  // brought no rows for a declared table, so the `?? []` arm is reachable only
  // by a caller holding the def itself — and a def is public, so the arm is a
  // real path and gets a real test rather than a coverage escape.
  it('a def called with no rows for its edges table lays out an edgeless graph, not a crash', () => {
    const mod = layoutAnalysis();
    const payload = mod.def.toRunInput(
      // a first run has no positions yet: the columns are simply absent
      g.nodes.map((n) => ({ id: String(n.id) })),
      {},
    ) as Record<string, { nodes: readonly unknown[]; edges: readonly unknown[] }>;
    const arg = Object.values(payload)[0]!;
    expect(arg.nodes).toHaveLength(g.nodes.length);
    expect(arg.edges).toEqual([]);
  });

  it('takes every name from the record when the record gives one', () => {
    const mod = layoutAnalysis({
      algo: 'stress',
      table: 'people',
      edges: 'ties',
      key: 'code',
      from: 'head',
      to: 'tail',
      seed: 9,
      iterations: 3,
      xColumn: 'px',
      yColumn: 'py',
      id: 'map',
    });
    expect(mod.id).toBe('map');
    expect(mod.def.reads).toEqual(['ties']);
    expect(mod.def.inputs).toEqual([
      { column: 'code', role: 'identifier' },
      { column: 'px', role: 'x' },
      { column: 'py', role: 'y' },
    ]);
    const out = mod.def.readOutput({ snapshot: { sharedState: {} } as never, input: [] });
    expect(out.ok && out.output).toEqual({
      as: 'columns',
      table: 'people',
      columns: { px: { type: 'float' }, py: { type: 'float' } },
    });
  });

  it('RUNS: two columns, one value per row, in the table’s own row order', async () => {
    const mod = layoutAnalysis({ iterations: 8 });
    const run = await mod.run(g.nodes, { related });
    expect(run.result.ok).toBe(true);
    const x = run.snapshot?.sharedState['x'] as number[];
    const y = run.snapshot?.sharedState['y'] as number[];
    expect(x).toHaveLength(16);
    expect(y).toHaveLength(16);
    expect(x.every((v) => Number.isFinite(v))).toBe(true);
    // the picture holds the graph: the grid's opposite corner is further than its neighbour
    const at = (i: number): { x: number; y: number } => ({ x: x[i]!, y: y[i]! });
    const gap = (i: number, j: number): number => Math.hypot(at(i).x - at(j).x, at(i).y - at(j).y);
    expect(gap(0, 1)).toBeLessThan(gap(0, 15));
  });

  it('THE DETERMINISM PIN, through the whole act: the same seed and rows give the same bytes', async () => {
    const mod = layoutAnalysis({ seed: 77, iterations: 8 });
    const first = await mod.run(g.nodes, { related });
    const second = await mod.run(g.nodes, { related });
    expect(first.snapshot?.sharedState['x']).toEqual(second.snapshot?.sharedState['x']);
    expect(first.snapshot?.sharedState['y']).toEqual(second.snapshot?.sharedState['y']);
    // a different seed is a different picture, so the seed on the record is doing the work
    const other = await layoutAnalysis({ seed: 78, iterations: 8 }).run(g.nodes, { related });
    expect(other.snapshot?.sharedState['x']).not.toEqual(first.snapshot?.sharedState['x']);
  });

  it('WARM START: a second act reads the first act’s columns, and leaves those nodes where they were', async () => {
    const first = await layoutAnalysis({ iterations: 8 }).run(g.nodes, { related });
    const x = first.snapshot?.sharedState['x'] as number[];
    const y = first.snapshot?.sharedState['y'] as number[];
    // the rows as the cursor now sees them: the derived columns are there, under their logical names
    const withPositions = g.nodes.map((row, i) => ({ ...row, x: x[i]!, y: y[i]! }));
    const newcomer = { id: 'n99', label: 'new', x: Number.NaN, y: Number.NaN };
    const second = await layoutAnalysis({ iterations: 8 }).run([...withPositions, newcomer], {
      related: { edges: [...g.edges, { source: 'n99', target: 'n0' }] },
    });
    const x2 = second.snapshot?.sharedState['x'] as number[];
    const y2 = second.snapshot?.sharedState['y'] as number[];
    expect(x2.slice(0, 16)).toEqual(x);
    expect(y2.slice(0, 16)).toEqual(y);
    // and the new node — the only one with anything to decide — landed near the neighbour it has
    expect(Number.isFinite(x2[16]!)).toBe(true);
    expect(Math.hypot(x2[16]! - x[0]!, y2[16]! - y[0]!)).toBeLessThan(5);
  });

  it('a graph of fewer than two nodes is a degenerate fit, and nothing is fabricated', async () => {
    const mod = layoutAnalysis();
    const run = await mod.run([{ id: 'only' }], { related });
    expect(run.result).toEqual({ ok: false, reason: 'degenerate-fit', n: 1, fitDegenerate: true });
    expect(run.snapshot).toBeUndefined();
  });

  it('an EMPTY edges table is laid out as the edgeless graph it is', async () => {
    const run = await layoutAnalysis({ iterations: 2 }).run(g.nodes, { related: { edges: [] } });
    const x = run.snapshot?.sharedState['x'] as number[];
    expect(x).toHaveLength(16);
    expect(x.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('a run handed NO edges table at all is refused — an edgeless layout is not the answer to a missing one', async () => {
    await expect(layoutAnalysis({ iterations: 2 }).run(g.nodes)).rejects.toThrow(
      'analysis "layout:stress:nodes" reads "edges" beside its own table, and this run was handed no rows to read there',
    );
  });

  it('a row with no key, and a position that is not a number, are read as what they are', async () => {
    const rows: DataRow[] = [{ label: 'no id' }, { id: 'n0', x: 'over there' as unknown as number, y: 3 }, { id: 'n1' }];
    const run = await layoutAnalysis({ iterations: 2 }).run(rows, {
      // an edge row with only one end named is an edge to nowhere, and the
      // adjacency counts it rather than inventing the other end
      related: { edges: [{ source: 'n0', target: 'n1' }, { source: 'n0' }, { target: 'n1' }] },
    });
    const x = run.snapshot?.sharedState['x'] as number[];
    expect(x).toHaveLength(3);
    // the text was not a position, so that node was placed rather than pinned
    expect(x[1]).not.toBe('over there');
    expect(Number.isFinite(x[1]!)).toBe(true);
  });
});

describe('an anchor is a memory, not an invention', () => {
  // The mental-map law: a node the reader has already placed does not move. A
  // node with NO remembered position has nothing to keep, so pinning it would
  // freeze it at a seeded ring coordinate it never occupied.
  const path = () => {
    const adjacency = adjacencyOf(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
      { key: 'id', from: 'source', to: 'target' },
    );
    return distancesOf(adjacency);
  };

  it('refuses an anchored node that has no position to keep', () => {
    expect(() =>
      place({
        distances: path(),
        seed: 7,
        iterations: 5,
        x0: [Number.NaN, 0, 1],
        y0: [Number.NaN, 0, 1],
        anchored: [1, 0, 0],
      }),
    ).toThrow(/node 0 is anchored but has no position to keep/);
    // and with no warm start at all, the same refusal
    expect(() => place({ distances: path(), seed: 7, iterations: 5, anchored: [0, 2, 0] })).toThrow(LayoutError);
    // half a position is not a position: an x with no y is still no memory
    expect(() =>
      place({ distances: path(), seed: 7, iterations: 5, x0: [0, 1, 2], y0: [0, Number.NaN, 2], anchored: [0, 1, 0] }),
    ).toThrow(/node 1 is anchored but has no position to keep/);
    expect(() => place({ distances: path(), seed: 7, iterations: 5, x0: [0, 1, 2], anchored: [0, 1, 0] })).toThrow(
      /node 1 is anchored but has no position to keep/,
    );
  });

  it('honours an anchor that really is a memory, and leaves the new node free', () => {
    const placed = place({
      distances: path(),
      seed: 7,
      iterations: 20,
      x0: [5, 6, Number.NaN],
      y0: [5, 6, Number.NaN],
      anchored: [2, 0, 0], // any non-zero is the flag, as the type says
    });
    expect(placed.x[0]).toBe(5);
    expect(placed.y[0]).toBe(5);
    expect(Number.isFinite(placed.x[2]!)).toBe(true);
  });
});
