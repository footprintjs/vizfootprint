/**
 * LAYOUT BENCH — THE SEEDED SYNTHETIC GRAPH. The bench owns its data.
 *
 * The law it follows: a bench number is only quotable if the input that
 * produced it can be produced again. So every row here comes out of one
 * `mulberry32` stream seeded by the caller — the same seed gives byte-identical
 * nodes and edges, on any machine, forever. `bench/step0/gen.ts` set the
 * precedent: the bench carries its own copy of the PRNG rather than importing
 * `src/fdr/rng.ts`, so a change in the library cannot silently move the bench's
 * data out from under a published number.
 *
 * First customers: `layout-entry.ts` (the measurements), `layout.test.ts`
 * (the acceptance), and `measure.ts` (which takes `mulberry32` for the stress
 * sampler and the scramble baseline). Nothing in `src/` may import this file.
 *
 * SHAPE — the demo's node-link shape, generically keyed:
 *   nodes: { id, label, group }              key column = `id`
 *   edges: { source, target, weight }        source -> nodes.id, target -> nodes.id
 * which is the pair of tables a declared relation joins, and therefore the pair
 * the layout analysis will read (packet 3, STEP A).
 *
 * The graph is deliberately NOT one clean blob: a spanning tree guarantees a
 * giant component (so all-pairs distances are mostly finite and the SGD has
 * real work), chords thicken it to the requested average degree, and a fringe
 * of small components and isolates exercises the disconnected rule
 * (d = maxFiniteDistance + 1). A layout that only ever sees a connected graph
 * has not been measured on the graphs people actually hand it.
 */

import type { Row } from '../../src/data/types.js';

// ── The PRNG ─────────────────────────────────────────────────────────────────

/** mulberry32 — the same public-domain generator `bench/step0/gen.ts` carries. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [0, n). */
function below(rnd: () => number, n: number): number {
  return Math.floor(rnd() * n);
}

// ── The shape ────────────────────────────────────────────────────────────────

export interface GraphShape {
  /** How many nodes the nodes table has. */
  readonly nodes: number;
  /** Target mean degree over the giant component. 6 is a sparse real network. */
  readonly avgDegree: number;
  /** Share of nodes in the giant component. The rest is fringe. */
  readonly giantShare: number;
  /** How many distinct `group` values the nodes carry — a categorical column a mark would colour by. */
  readonly groups: number;
}

/** The default shape both measured sizes use, so 1k and 10k differ ONLY in node count. */
export const DEFAULT_SHAPE: GraphShape = Object.freeze({
  nodes: 1_000,
  avgDegree: 6,
  giantShare: 0.97,
  groups: 8,
});

export interface GraphMeta {
  readonly seed: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly giantCount: number;
  readonly fringeCount: number;
  /**
   * Achieved mean degree over ALL nodes (2E/V), fringe included. This reads
   * BELOW `shape.avgDegree`, which targets the GIANT only — at giantShare 0.97
   * a target of 6 over the giant reports ~5.84 over the whole table. The two
   * are the same name over two denominators, and only this one is measured.
   */
  readonly avgDegree: number;
}

export interface SyntheticGraph {
  readonly nodes: Row[];
  readonly edges: Row[];
  /** Facts about what was generated — reported beside every measurement, never re-derived. */
  readonly meta: GraphMeta;
}

// ── The generator ────────────────────────────────────────────────────────────

/** `id` for node index `i` — zero-padded so the table sorts the way it was built. */
export function nodeKeyAt(i: number): string {
  return `n${String(i).padStart(6, '0')}`;
}

/**
 * Build `shape.nodes` nodes and the edges between them, from one seeded stream.
 *
 * WHY a spanning tree first: an Erdos-Renyi graph at mean degree 6 is connected
 * only with high probability, and "with high probability" is not a bench input.
 * A random spanning tree over the giant makes connectivity a FACT of the
 * generator, so the measured all-pairs matrix has a known finite core at every
 * seed and the stress numbers across seeds are comparable.
 */
export function synthesizeGraph(shape: GraphShape = DEFAULT_SHAPE, seed = 42): SyntheticGraph {
  const rnd = mulberry32(seed);
  const n = shape.nodes;
  // WHY the outer `min`: the `max(2, …)` floor keeps a tiny graph from having a
  // one-node giant, but with no ceiling it can exceed `n` — and the spanning
  // tree then attaches a node index the nodes table does not contain, emitting
  // an edge to a row that does not exist and a NEGATIVE fringe count. For every
  // n >= 2 the `min` is a no-op, so no measured number moves.
  const giant = Math.min(n, Math.max(2, Math.floor(n * shape.giantShare)));

  const nodes: Row[] = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = { id: nodeKeyAt(i), label: `Node ${i}`, group: `g${below(rnd, shape.groups)}` };
  }

  // A set of undirected pairs, so a chord that repeats a tree edge is not a
  // second edge row: a duplicated edge would inflate the edge count the bench
  // reports without changing the graph.
  const seen = new Set<number>();
  const edges: Row[] = [];
  const addEdge = (a: number, b: number): void => {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const k = lo * n + hi;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({
      source: nodeKeyAt(lo),
      target: nodeKeyAt(hi),
      // a weight column the layout IGNORES (BFS is unweighted) but a mark could
      // use — it is here so the edges table is not narrower than a real one
      weight: Math.round(rnd() * 1000) / 100,
    });
  };

  // 1 — the spanning tree: each new node attaches to one already-placed node.
  for (let i = 1; i < giant; i++) addEdge(i, below(rnd, i));

  // 2 — chords up to the target mean degree. mean degree = 2E/V.
  const wantEdges = Math.round((giant * shape.avgDegree) / 2);
  let guard = 0;
  while (edges.length < wantEdges && guard < wantEdges * 20) {
    guard++;
    addEdge(below(rnd, giant), below(rnd, giant));
  }

  // 3 — the fringe: pairs and isolates outside the giant. Roughly two thirds of
  // the fringe pairs up, the rest stays alone; both are disconnected from the
  // giant, which is what the d = maxFinite + 1 rule is for.
  for (let i = giant; i + 1 < n; i += 2) {
    if (rnd() < 0.67) addEdge(i, i + 1);
  }

  return {
    nodes,
    edges,
    meta: {
      seed,
      nodeCount: n,
      edgeCount: edges.length,
      giantCount: giant,
      fringeCount: n - giant,
      avgDegree: n === 0 ? 0 : (2 * edges.length) / n,
    },
  };
}

/**
 * A k-by-k GRID graph — the one graph whose good 2-D layout is KNOWN.
 *
 * WHY it exists: every timing number here is measured on `synthesizeGraph`, but
 * a timing number is worthless if the quality instrument is dead. On a grid,
 * BFS distance is the Manhattan distance and the grid coordinates ARE a good
 * embedding, so `stressOf(grid coordinates)` must come out far below
 * `stressOf(anything scrambled)`. That inequality is the bench's positive
 * control (`measure.ts`), and it is checkable without any layout code at all —
 * which is the point.
 */
export interface GridGraph extends SyntheticGraph {
  /** The grid coordinates: the known-good embedding the control compares against. */
  readonly truth: { readonly x: readonly number[]; readonly y: readonly number[] };
}

export function gridGraph(k: number): GridGraph {
  const n = k * k;
  const nodes: Row[] = new Array(n);
  const x: number[] = new Array(n);
  const y: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const col = i % k;
    const row = (i - col) / k;
    nodes[i] = { id: nodeKeyAt(i), label: `${row},${col}`, group: 'grid' };
    x[i] = col;
    y[i] = row;
  }
  const edges: Row[] = [];
  for (let row = 0; row < k; row++) {
    for (let col = 0; col < k; col++) {
      const i = row * k + col;
      if (col + 1 < k) edges.push({ source: nodeKeyAt(i), target: nodeKeyAt(i + 1), weight: 1 });
      if (row + 1 < k) edges.push({ source: nodeKeyAt(i), target: nodeKeyAt(i + k), weight: 1 });
    }
  }
  return {
    nodes,
    edges,
    truth: { x, y },
    // WHY seed 0: the grid draws no randomness at all — 0 marks "no stream
    // consumed", it is not a reproducible input. Only `synthesizeGraph`'s seed
    // reproduces a graph; passing 0 here to `synthesizeGraph` reproduces nothing.
    meta: { seed: 0, nodeCount: n, edgeCount: edges.length, giantCount: n, fringeCount: 0, avgDegree: n === 0 ? 0 : (2 * edges.length) / n },
  };
}
