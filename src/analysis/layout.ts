/**
 * L3 — THE STRESS LAYOUT: A POSITION IS DATA.
 *
 * A layout is an ANALYSIS, not a renderer's private step. It names its
 * algorithm and its seed, reads the nodes table and the edges table beside it,
 * and writes `x` and `y` back as ordinary derived columns at the act's own slot
 * — the same path `formulaAnalysis` and `clusteringAnalysis` take. Nothing
 * about it is special downstream: the columns are filterable, they are visible
 * at the cursor, they carry the act that made them, and a replay rebuilds them
 * from the record's bytes.
 *
 * THE LAW IT FOLLOWS: a position not on the trace is a position a replay cannot
 * promise. That is the whole reason the layout runs here rather than in a mark:
 * a renderer that computed positions would produce a picture no log could
 * reproduce, and every later act — a brush over a region, a second layout that
 * warm-starts from this one — would rest on numbers nobody wrote down.
 *
 * WHAT MAKES IT REPRODUCIBLE: `makeRng` (`../fdr/rng.ts`) is the one source of
 * randomness, seeded by the record. The same seed and the same rows give
 * byte-identical positions — pinned by `layout.test.ts` and by the bench's own
 * acceptance (`bench/layout/layout.test.ts`, written before this file).
 *
 * THE ALGORITHM: seeded SGD stress majorization (Zheng, Pawar & Goodman 2019,
 * "Graph Drawing by Stochastic Gradient Descent"), over exact unweighted
 * all-pairs hop distances. Three phases, exported separately because the bench
 * measures them separately and because the cap below is a cap on ONE of them:
 *
 *   1 · {@link adjacencyOf}  nodes + edges → an undirected graph, by key
 *   2 · {@link distancesOf}  BFS from every node → the ideal distances
 *   3 · {@link place}        the seeded SGD iterations → x and y
 *
 * THE MENTAL MAP (Misue et al. 1995): a re-layout that moves everything
 * destroys the reader's map of the picture. So a node that already has a
 * finite position keeps it exactly, and only a NEW node is placed — at its
 * neighbours' centroid, or on the seeded ring when it has no placed neighbour.
 * A second layout act reads the first act's `x`/`y` through the ordinary
 * derived-column path, which is why the warm start needed no new machinery.
 *
 * First customers: `../def/builtinAnalyses.ts` (the `layout` record) and
 * `bench/layout/` (the phases, measured at 1,000 and 10,000 nodes).
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { Row } from '../data/types.js';
import { makeRng, type Rng } from '../fdr/rng.js';
import { defineAnalysis } from './defineAnalysis.js';
import type { DataRow } from './builtins.js';
import type { AnalysisModule, ColumnsOutput, RelatedRows } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// The vocabulary — data before code.
// ─────────────────────────────────────────────────────────────────────────────

/** The layout algorithms a record may name. One today; the record still says which. */
export const LAYOUT_ALGORITHMS = ['stress'] as const;
export type LayoutAlgorithm = (typeof LAYOUT_ALGORITHMS)[number];

/**
 * The node ceiling for EXACT all-pairs distances — the number the refusal
 * quotes.
 *
 * WHY there is a ceiling at all: phase 2 is `n × n` hops held as one matrix.
 * That is arithmetic, not a measurement: at this cap the matrix is
 * `5000 × 5000` 16-bit hops, 50 MB, and every doubling of `n` quadruples it.
 * What the cap costs in time is measured by `bench/layout` at 1,000 and 10,000
 * nodes, and its generated table is the only place a number for that may be
 * quoted from. This constant is the ONE line that moves if the bench says the
 * ceiling should sit elsewhere.
 */
export const LAYOUT_NODE_CAP = 5_000;

/** How many SGD passes a layout takes when the record does not say. */
export const LAYOUT_DEFAULT_ITERATIONS = 30;

/**
 * The seed a record that names none is run with.
 *
 * WHY a constant and not a clock: a seed is DATA (`Date.now()` is banned in
 * this library for exactly this reason). A record that omits the seed must
 * still replay byte-identically years later.
 */
export const LAYOUT_DEFAULT_SEED = 1;

/** Which column carries the node key, and which two carry an edge's endpoints. */
export interface GraphColumns {
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

/** The common spelling of those three columns — every default the factory takes. */
export const DEFAULT_GRAPH_COLUMNS: GraphColumns = Object.freeze({ key: 'id', from: 'source', to: 'target' });

/** An undirected graph over the nodes table, with the edge rows it could not use COUNTED. */
export interface LayoutAdjacency {
  readonly n: number;
  /** `keys[i]` is node `i`'s key, in the nodes table's own row order. */
  readonly keys: readonly string[];
  readonly neighbours: readonly (readonly number[])[];
  /** The fold's honesty shape: rows seen, rows used, rows whose endpoints are not two distinct nodes. */
  readonly total: number;
  readonly used: number;
  readonly dropped: number;
}

/** Exact all-pairs hop distances, row-major, with the disconnected rule already applied. */
export interface LayoutDistances {
  readonly n: number;
  /** `n * n` hops. A disconnected pair carries `maxFinite + 1`. */
  readonly d: Uint16Array;
  /** The longest path that really exists. 0 when nothing is connected to anything. */
  readonly maxFinite: number;
  /** Matrix cells (ordered pairs) that no path joins. Counted, never silent. */
  readonly disconnectedPairs: number;
}

/**
 * What {@link place} is given. `anchored[i]` non-zero means node `i` must keep
 * its position — which it can only do where it HAS one: an anchor is honoured
 * only where `x0[i]` and `y0[i]` are both finite, and an anchored node with no
 * warm position is refused rather than frozen at a start the layout invented.
 */
export interface PlaceOptions {
  readonly distances: LayoutDistances;
  readonly seed: number;
  readonly iterations: number;
  /** The warm start: the previous act's `x`, or `NaN` where the node is new. */
  readonly x0?: ArrayLike<number>;
  readonly y0?: ArrayLike<number>;
  readonly anchored?: ArrayLike<number>;
}

export interface PlacedPositions {
  readonly x: Float64Array;
  readonly y: Float64Array;
}

/** Thrown when a layout cannot honestly be computed. The message is the sentence. */
export class LayoutError extends Error {
  constructor(problem: string) {
    super(problem);
    this.name = 'LayoutError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — the graph, from two tables joined by key.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the undirected adjacency the layout walks.
 *
 * Every edge row is either USED or DROPPED and the counts come back with the
 * graph: an endpoint that names no node is a fact about the data, and a layout
 * that silently ignored it would be reporting a graph nobody has.
 */
export function adjacencyOf(nodes: readonly Row[], edges: readonly Row[], cols: GraphColumns): LayoutAdjacency {
  const keys: string[] = new Array(nodes.length);
  const at = new Map<string, number>();
  let i = 0;
  for (const node of nodes) {
    const key = String(node[cols.key] ?? '');
    keys[i] = key;
    // WHY first wins: two rows sharing one key are one node BY NAME, and an
    // edge can only ever reach the first of them. Said once, here.
    if (!at.has(key)) at.set(key, i);
    i += 1;
  }
  const neighbours: number[][] = Array.from({ length: nodes.length }, () => []);
  let used = 0;
  let dropped = 0;
  for (const edge of edges) {
    const a = at.get(String(edge[cols.from] ?? ''));
    const b = at.get(String(edge[cols.to] ?? ''));
    // A self-loop joins nothing and an unknown endpoint joins nothing: both are
    // rows this graph could not use, and both are counted as such.
    if (a === undefined || b === undefined || a === b) {
      dropped += 1;
      continue;
    }
    neighbours[a]!.push(b);
    neighbours[b]!.push(a);
    used += 1;
  }
  return { n: nodes.length, keys, neighbours, total: edges.length, used, dropped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — the ideal distances. The capped phase.
// ─────────────────────────────────────────────────────────────────────────────

/** The cell value a BFS has not reached yet. Above any hop count a capped graph can hold. */
const UNREACHED = 0xffff;

/** The refusal, in the house voice: it quotes the graph AND the ceiling. */
function refuseOversized(n: number): LayoutError {
  return new LayoutError(
    `a stress layout needs exact all-pairs distances, which is one ${n} × ${n} matrix: ` +
      `this graph has ${n} nodes and the ceiling is ${LAYOUT_NODE_CAP} — ` +
      `filter the nodes down, or lay the graph out in pieces`,
  );
}

/**
 * Exact all-pairs shortest paths by unweighted BFS, one row per node.
 *
 * DISCONNECTED PAIRS take `maxFinite + 1` — one hop further apart than anything
 * the graph really joins. Stress needs a finite ideal distance for every pair,
 * and this is the honest one: components end up beyond the graph's own
 * diameter without being flung to infinity.
 *
 * The cap is judged from `n` ALONE, before a single cell is allocated — an
 * implementation that allocated first would fall over instead of refusing.
 */
export function distancesOf(adjacency: LayoutAdjacency): LayoutDistances {
  const n = adjacency.n;
  if (n > LAYOUT_NODE_CAP) throw refuseOversized(n);

  const d = new Uint16Array(n * n).fill(UNREACHED);
  const queue = new Int32Array(n);
  let maxFinite = 0;
  for (let source = 0; source < n; source += 1) {
    const base = source * n;
    d[base + source] = 0;
    queue[0] = source;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const v = queue[head]!;
      head += 1;
      const step = d[base + v]! + 1;
      for (const w of adjacency.neighbours[v]!) {
        if (d[base + w] === UNREACHED) {
          d[base + w] = step;
          if (step > maxFinite) maxFinite = step;
          queue[tail] = w;
          tail += 1;
        }
      }
    }
  }

  const far = maxFinite + 1;
  let disconnectedPairs = 0;
  for (let cell = 0; cell < d.length; cell += 1) {
    if (d[cell] === UNREACHED) {
      d[cell] = far;
      disconnectedPairs += 1;
    }
  }
  return { n, d, maxFinite, disconnectedPairs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — the seeded SGD stress iterations.
// ─────────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
/** How far off its ideal spot a fresh node is jittered, as a share of the ring's radius. */
const JITTER_SHARE = 0.05;
/** The separation given to two nodes that sit on exactly the same point. */
const COINCIDENT_NUDGE = 1e-9;
/**
 * Where the learning rate FINISHES, as a share of the tightest pair's full
 * correction (the paper's damping term, its `epsilon`).
 *
 * WHY it is not 1: a schedule that ends at a full correction spends its last
 * pass satisfying each adjacent pair exactly, in order, and each one it
 * satisfies undoes a little of the one before. Ending small makes the last
 * passes settle the picture instead of stirring it. The value was CHOSEN at
 * `bench/layout`, over the grid (a graph with a real 2-D shape) and the
 * synthetic random graph (one with none) — and the table that bench generates
 * is the only place the difference it makes may be quoted from.
 */
const SETTLE_SHARE = 0.01;

/**
 * `anchored[i]` as the flag it is: absent means nothing is pinned.
 *
 * WHY it refuses an anchor with no warm position instead of honouring it: an
 * anchor is a MEMORY — the mental-map law is that a node the reader has already
 * placed does not move. A node with no finite `x0`/`y0` has no remembered
 * position, so `startFrom` would put it on the seeded ring and this flag would
 * then freeze it there forever: a coordinate the layout invented, pinned as
 * though a person had chosen it. That is the inverse of what anchoring is for,
 * so the act does not happen.
 */
function pinnedFlags(
  n: number,
  anchored: ArrayLike<number> | undefined,
  x0: ArrayLike<number> | undefined,
  y0: ArrayLike<number> | undefined,
): Uint8Array {
  const fixed = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if ((anchored?.[i] ?? 0) === 0) continue;
    if (!Number.isFinite(x0?.[i] ?? Number.NaN) || !Number.isFinite(y0?.[i] ?? Number.NaN)) {
      throw new LayoutError(
        `node ${i} is anchored but has no position to keep (x0=${String(x0?.[i])}, y0=${String(y0?.[i])}): ` +
          `an anchor holds a node where it already IS, so a new node cannot be one — leave it unanchored and it will be placed`,
      );
    }
    fixed[i] = 1;
  }
  return fixed;
}

/** The mean position of the neighbours node `i` already has a place for. */
function centroidOf(
  distances: LayoutDistances,
  x: Float64Array,
  y: Float64Array,
  warm: Uint8Array,
  i: number,
): { x: number; y: number; count: number } {
  const n = distances.n;
  const base = i * n;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let j = 0; j < n; j += 1) {
    if (distances.d[base + j] !== 1 || warm[j] !== 1) continue;
    sx += x[j]!;
    sy += y[j]!;
    count += 1;
  }
  return { x: count === 0 ? 0 : sx / count, y: count === 0 ? 0 : sy / count, count };
}

/**
 * The starting positions: the warm start where there is one, the seeded ring
 * where there is not.
 *
 * A node the previous act placed starts exactly where it was. A NEW node
 * starts at the centroid of the neighbours that already have a place, which is
 * what keeps an added node near the part of the picture it belongs to; a new
 * node with no placed neighbour goes on the ring, whose rotation and jitter
 * come from the seed and nowhere else.
 */
function startFrom(
  distances: LayoutDistances,
  rng: Rng,
  x0: ArrayLike<number> | undefined,
  y0: ArrayLike<number> | undefined,
): PlacedPositions {
  const n = distances.n;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const warm = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const px = x0?.[i] ?? Number.NaN;
    const py = y0?.[i] ?? Number.NaN;
    if (Number.isFinite(px) && Number.isFinite(py)) {
      x[i] = px;
      y[i] = py;
      warm[i] = 1;
    }
  }

  const radius = Math.max(1, distances.maxFinite) / 2;
  const rotation = rng.next() * TAU;
  const jitter = radius * JITTER_SHARE;
  for (let i = 0; i < n; i += 1) {
    if (warm[i] === 1) continue;
    // Both draws happen before the branch, so the stream does not depend on
    // which arm a node took — the seed alone decides the numbers.
    const wobbleX = (rng.next() - 0.5) * jitter;
    const wobbleY = (rng.next() - 0.5) * jitter;
    const near = centroidOf(distances, x, y, warm, i);
    const angle = rotation + (TAU * i) / n;
    const anchorX = near.count === 0 ? radius * Math.cos(angle) : near.x;
    const anchorY = near.count === 0 ? radius * Math.sin(angle) : near.y;
    x[i] = anchorX + wobbleX;
    y[i] = anchorY + wobbleY;
  }
  return { x, y };
}

/** Fisher-Yates over the node indices, from the seeded stream. */
function shuffle(order: Int32Array, rng: Rng): void {
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    const swap = order[i]!;
    order[i] = order[j]!;
    order[j] = swap;
  }
}

/**
 * The SGD stress iterations.
 *
 * Each pass visits every pair once, in an order the seeded stream shuffles, and
 * moves the two nodes towards the distance the graph says they should be at.
 * The learning rate decays exponentially from `1 / wMin` (the loosest pair's
 * step, big enough to be capped at a full correction early on) down to
 * a small fraction ({@link SETTLE_SHARE}) of `1 / wMax`, the tightest pair's
 * step — the schedule the paper gives, damping and all.
 *
 * WHY the NODE order is shuffled rather than a term list: the term list is
 * `n (n-1) / 2` entries, and the matrix is already `n × n`. Permuting the nodes
 * and walking the pairs in that order changes the order every pass at O(n)
 * extra memory, which is what lets the cap be about the matrix and nothing else.
 */
export function place(options: PlaceOptions): PlacedPositions {
  const { distances, seed, iterations } = options;
  const n = distances.n;
  const rng = makeRng(seed);
  const { x, y } = startFrom(distances, rng, options.x0, options.y0);
  const fixed = pinnedFlags(n, options.anchored, options.x0, options.y0);

  const order = new Int32Array(n);
  for (let i = 0; i < n; i += 1) order[i] = i;

  // w = d^-2, so the loosest pair is the longest distance and the tightest is
  // one hop. Both ends of the schedule are read off the matrix, never guessed.
  const longest = distances.disconnectedPairs > 0 ? distances.maxFinite + 1 : distances.maxFinite;
  const etaMax = Math.max(1, longest * longest);
  const decay = Math.log(etaMax / SETTLE_SHARE) / Math.max(1, iterations - 1);

  for (let pass = 0; pass < iterations; pass += 1) {
    shuffle(order, rng);
    const eta = etaMax * Math.exp(-decay * pass);
    for (let p = 0; p < n; p += 1) {
      const i = order[p]!;
      for (let q = p + 1; q < n; q += 1) {
        const j = order[q]!;
        if (fixed[i] === 1 && fixed[j] === 1) continue;
        const ideal = distances.d[i * n + j]!;
        const rate = Math.min((1 / (ideal * ideal)) * eta, 1);
        let dx = x[i]! - x[j]!;
        let dy = y[i]! - y[j]!;
        let apart = Math.sqrt(dx * dx + dy * dy);
        if (apart === 0) {
          // Two nodes on one point have no direction to be moved along. Push
          // them apart along a FIXED axis rather than a random one: the nudge
          // must be the same on every replay.
          dx = COINCIDENT_NUDGE;
          dy = 0;
          apart = COINCIDENT_NUDGE;
        }
        // A pinned partner takes none of the correction, so the free node takes
        // all of it; two free nodes split it.
        const share = fixed[i] === 1 || fixed[j] === 1 ? 1 : 0.5;
        const move = (rate * (apart - ideal) * share) / apart;
        if (fixed[i] === 0) {
          x[i] = x[i]! - move * dx;
          y[i] = y[i]! - move * dy;
        }
        if (fixed[j] === 0) {
          x[j] = x[j]! + move * dx;
          y[j] = y[j]! + move * dy;
        }
      }
    }
  }
  return { x, y };
}

// ─────────────────────────────────────────────────────────────────────────────
// The analysis — the three phases, as a flowchart that writes two columns.
// ─────────────────────────────────────────────────────────────────────────────

/** The node, as the chart is handed it: a key and the position it already had. */
type ChartNode = { key: string; x: number | null; y: number | null };
/** The edge, as the chart is handed it: two node keys, normalized. */
type ChartEdge = { from: string; to: string };

/** What one run of the chart works over. Plain data — it is committed, and a commit is frozen. */
type LayoutChartInput = {
  nodes: ChartNode[];
  edges: ChartEdge[];
  seed: number;
  iterations: number;
};

/** The chart's own column names for the normalized rows above. */
const CHART_COLUMNS: GraphColumns = Object.freeze({ key: 'key', from: 'from', to: 'to' });

/**
 * The two keys the chart uses beside the two columns it writes, DERIVED from
 * those column names so neither can collide with them.
 *
 * footprintjs guards an input key as readonly and throws on a colliding write,
 * and the committed keys here have to BE the column names — that is what
 * `writeColumns` reads the values back off. Deriving both from the pair of
 * names is the same trick `formula.ts` uses, for the same reason.
 */
function chartKeys(xColumn: string, yColumn: string): { arg: string; held: string } {
  return { arg: `${xColumn} ${yColumn} input`, held: `${xColumn} ${yColumn} loaded` };
}

/** A cell as a coordinate: a real number, or `null` for "this node has no position yet". */
function coordinateOf(cell: unknown): number | null {
  return typeof cell === 'number' && Number.isFinite(cell) ? cell : null;
}

/**
 * The chart: load, then compute — the two stages every analysis here has.
 *
 * The three phases run inside the second stage because they are one
 * computation: the adjacency is the distances' input and the distances are the
 * placement's, and splitting them into stages would commit two intermediate
 * matrices to say nothing a reader wants.
 */
function buildLayoutChart(xColumn: string, yColumn: string): FlowChart {
  const { arg, held } = chartKeys(xColumn, yColumn);
  return flowChart<Record<string, unknown>>(
    'load the nodes and the ties between them',
    (scope) => {
      const args = scope.$getArgs<Record<string, LayoutChartInput>>();
      scope.$setValue(held, args[arg]!);
    },
    'load',
  )
    .addFunction(
      'lay the graph out',
      (scope) => {
        const input = scope.$getValue(held) as LayoutChartInput;
        const adjacency = adjacencyOf(input.nodes, input.edges, CHART_COLUMNS);
        const distances = distancesOf(adjacency);
        const n = distances.n;
        const x0 = new Float64Array(n).fill(Number.NaN);
        const y0 = new Float64Array(n).fill(Number.NaN);
        const anchored = new Float64Array(n);
        for (let i = 0; i < n; i += 1) {
          const node = input.nodes[i]!;
          if (node.x === null || node.y === null) continue;
          // THE MENTAL MAP: a node that already has a position keeps it, and is
          // therefore both the warm start AND a pin.
          x0[i] = node.x;
          y0[i] = node.y;
          anchored[i] = 1;
        }
        const placed = place({ distances, seed: input.seed, iterations: input.iterations, x0, y0, anchored });
        // Plain arrays: `writeColumns` lands what `Array.isArray` accepts, and
        // a typed array is not that.
        scope.$setValue(xColumn, Array.from(placed.x));
        scope.$setValue(yColumn, Array.from(placed.y));
      },
      'layout',
    )
    .build();
}

/** Everything a declared layout may say. The record's fields, plus the three column names. */
export interface LayoutOptions {
  /** Which algorithm. One today — the record still names it, so the act says what it did. */
  readonly algo?: LayoutAlgorithm;
  /** The nodes table: the one read whole, and the one the columns are written onto. Default `nodes`. */
  readonly table?: string;
  /** The related table holding the ties. Default `edges`. */
  readonly edges?: string;
  /** The nodes table's key column. Default `id`. */
  readonly key?: string;
  /** The edges table's two endpoint columns. Default `source` / `target`. */
  readonly from?: string;
  readonly to?: string;
  /** The seed. Data, like everything else here. Default {@link LAYOUT_DEFAULT_SEED}. */
  readonly seed?: number;
  /** How many SGD passes. Default {@link LAYOUT_DEFAULT_ITERATIONS}. */
  readonly iterations?: number;
  /** The columns written. Default `x` / `y`. */
  readonly xColumn?: string;
  readonly yColumn?: string;
  /** Default `layout:<algo>:<table>`. */
  readonly id?: string;
}

/**
 * A stress layout as a declared analysis: `produces: 'columns'`, `reads` the
 * edges table, and lands `x` and `y` at the act's own slot.
 *
 * ```ts
 * analyses: { map: { builtin: 'layout', algo: 'stress', table: 'nodes', edges: 'edges' } }
 * ```
 *
 * The edges arrive because a DECLARED RELATION joins the two tables — the
 * permission `reads` is judged against (`../def/README.md`, law 6). Without it
 * the act does not happen and the session says which relation to declare.
 */
export function layoutAnalysis(opts: LayoutOptions = {}): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  const algo = opts.algo ?? 'stress';
  const table = opts.table ?? 'nodes';
  const edgeTable = opts.edges ?? 'edges';
  const cols: GraphColumns = {
    key: opts.key ?? DEFAULT_GRAPH_COLUMNS.key,
    from: opts.from ?? DEFAULT_GRAPH_COLUMNS.from,
    to: opts.to ?? DEFAULT_GRAPH_COLUMNS.to,
  };
  const seed = opts.seed ?? LAYOUT_DEFAULT_SEED;
  const iterations = opts.iterations ?? LAYOUT_DEFAULT_ITERATIONS;
  const xColumn = opts.xColumn ?? 'x';
  const yColumn = opts.yColumn ?? 'y';

  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id: opts.id ?? `layout:${algo}:${table}`,
    kind: 'transform',
    produces: 'columns',
    inputs: [
      // `identifier`, not `group`: this column is the node's IDENTITY — what the
      // edges join on — and a graph reader reads "group" as a clustered layout.
      { column: cols.key, role: 'identifier' },
      // The warm start reads its OWN previous output. Present only once an
      // earlier act has landed it, which is exactly when it is read.
      { column: xColumn, role: 'x' },
      { column: yColumn, role: 'y' },
    ],
    reads: [edgeTable],
    honesty: { minPoints: 2, notes: 'a graph of fewer than two nodes has no distances to fit' },
    // R14 pre-run gate: one node has nothing to be laid out against.
    precheck: (rows) =>
      rows.length < 2 ? { ok: false, reason: 'degenerate-fit', n: rows.length, fitDegenerate: true } : undefined,
    build: () => buildLayoutChart(xColumn, yColumn),
    toRunInput: (rows, related: RelatedRows) => {
      const nodes: ChartNode[] = rows.map((row) => ({
        key: String(row[cols.key] ?? ''),
        x: coordinateOf(row[xColumn]),
        y: coordinateOf(row[yColumn]),
      }));
      // WHY `?? []`: the key is here — `run` refuses an invocation that brought
      // no rows for a table this def declared (that is what `reads` is), and an
      // edges table read as empty arrives as an empty array anyway — so an
      // edgeless graph is one case, not two, and the counters are where it shows.
      const ties = related[edgeTable] ?? [];
      const edges: ChartEdge[] = ties.map((tie) => ({
        from: String(tie[cols.from] ?? ''),
        to: String(tie[cols.to] ?? ''),
      }));
      return { [chartKeys(xColumn, yColumn).arg]: { nodes, edges, seed, iterations } satisfies LayoutChartInput };
    },
    readOutput: () => ({
      ok: true,
      output: { as: 'columns', table, columns: { [xColumn]: { type: 'float' }, [yColumn]: { type: 'float' } } },
    }),
  });
}
