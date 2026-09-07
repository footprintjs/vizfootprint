/**
 * LAYOUT BENCH — THE INSTRUMENTS. Everything that MEASURES lives here, and
 * none of it shares RUNTIME code with `src/` — the single `import type` below
 * is erased at compile time, so no behaviour crosses.
 *
 * The law it follows: an instrument that shares code with the thing it measures
 * cannot catch that thing being wrong. So the bench keeps its own adjacency,
 * its own BFS and its own stress metric. When `src/analysis/layout.ts` lands
 * and the numbers agree, they agree because two independent implementations
 * agree — not because one function was called twice.
 *
 * That independence is also what makes the POSITIVE CONTROLS possible: on a
 * grid graph the good embedding is known without any layout code, so
 * `stressOf(grid coordinates)` must land far under `stressOf(scrambled)`. If it
 * does not, the metric is dead and every quality number in this bench is void.
 *
 * UNITS, stated once: time is milliseconds of wall clock from
 * `performance.now()`; memory is bytes from `process.memoryUsage()`; stress is
 * dimensionless (a weighted mean squared residual at the optimal scale).
 *
 * First customers: `layout-entry.ts` and `layout.test.ts`.
 */

import type { Row } from '../../src/data/types.js';
import { mulberry32 } from './gen.js';

// ── 1 · the clock ────────────────────────────────────────────────────────────

/** One timed call. `ms` is wall clock; `value` is whatever the phase returned. */
export interface Timed<T> {
  readonly ms: number;
  readonly value: T;
}

/** Time one call on the clock every phase in this bench uses. */
export function timeOnce<T>(fn: () => T): Timed<T> {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

/**
 * Burn about `ms` of wall clock on purpose.
 *
 * WHY: this is the clock's positive control. A phase that reports 0.00 ms is
 * either instantaneous or unmeasured, and those look identical in a table. A
 * deliberate 40 ms block that reads back as 40 ms proves the clock is live, so
 * a 0.00 ms phase can be read as "instantaneous" and believed.
 */
export function spin(ms: number): number {
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < ms) n++;
  return n;
}

/**
 * Median / p95 / min of a sample. p95 is nearest-rank, as in `bench/step0/gen.ts`.
 *
 * WHY it refuses an empty sample rather than scoring one: `at()` would fall
 * through to 0, and a phase that reports 0.00 ms is either instantaneous or
 * unmeasured — the exact confusion `spin` exists to prevent. A refused act does
 * not happen, so no median is minted for a sample nobody took.
 */
export function stats(samples: readonly number[]): { median: number; p95: number; min: number; n: number } {
  if (samples.length === 0) {
    throw new Error('stats was handed 0 samples: a median of 0 and "instantaneous" are the same number in a table, so this is refused rather than scored');
  }
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0;
  return { median: at(0.5), p95: at(0.95), min: s[0] ?? 0, n: s.length };
}

/**
 * Bytes in use right now. Reported per phase so a size that cannot fit says so
 * in bytes.
 *
 * WHY `external` and `arrayBuffers` and not just `heapUsed`: the distance
 * matrix is a `Uint16Array`, and V8 accounts a typed array's backing store
 * OUTSIDE the old generation — so `heapUsed` is structurally blind to the one
 * allocation the cap exists to bound. `arrayBuffers` is the column `matrixBytes`
 * must be read against.
 */
export function memoryNow(): { rss: number; heapUsed: number; external: number; arrayBuffers: number } {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers };
}

// ── 2 · the graph, as the instrument sees it ─────────────────────────────────

/** Which columns carry the join. The bench's default matches `gen.ts`. */
export interface GraphColumns {
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

export const DEFAULT_COLUMNS: GraphColumns = Object.freeze({ key: 'id', from: 'source', to: 'target' });

export interface BenchAdjacency {
  readonly n: number;
  readonly keys: readonly string[];
  readonly neighbours: readonly (readonly number[])[];
  /** Edge rows whose two endpoints were both found in the nodes table. */
  readonly used: number;
  /**
   * Edge rows this graph could not use — an endpoint that is not a node, or a
   * self-loop, which joins nothing. Counted, never silent. Same rule as
   * `src/analysis/layout.ts`, worded the same way there.
   */
  readonly dropped: number;
  /** Node rows whose key repeated one already seen. The FIRST row keeps the key. */
  readonly duplicateKeys: number;
  /** Node rows carrying no key at all. They join nothing, and no edge can reach them. */
  readonly keylessNodes: number;
}

/**
 * The key a row joins by, or `undefined` when it has none.
 *
 * WHY absence is not the empty string: coercing a missing value to `''` puts a
 * keyless node in the index under `''`, where an edge with a missing endpoint
 * — also `''` — matches it. That is an edge between two absences, reported as
 * real. An absence joins nothing.
 */
function keyOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

/** The bench's own undirected adjacency, built from the two tables by key. */
export function adjacencyOf(nodes: readonly Row[], edges: readonly Row[], cols: GraphColumns = DEFAULT_COLUMNS): BenchAdjacency {
  const keys: string[] = new Array(nodes.length);
  const index = new Map<string, number>();
  let duplicateKeys = 0;
  let keylessNodes = 0;
  for (let i = 0; i < nodes.length; i++) {
    const k = keyOf(nodes[i]?.[cols.key]);
    keys[i] = k ?? '';
    if (k === undefined) {
      keylessNodes++;
      continue;
    }
    // WHY first wins, exactly as `src/analysis/layout.ts`: two rows sharing one
    // key are one node BY NAME, and an edge can only ever reach the first of
    // them. The instrument may differ in IMPLEMENTATION, never in DEFINITION —
    // a definitional split would let `agreesWithBench` pass on two different
    // graphs. The collapse is counted rather than assumed.
    if (index.has(k)) {
      duplicateKeys++;
      continue;
    }
    index.set(k, i);
  }
  const neighbours: number[][] = Array.from({ length: nodes.length }, () => []);
  let used = 0;
  let dropped = 0;
  for (const e of edges) {
    const from = keyOf(e[cols.from]);
    const to = keyOf(e[cols.to]);
    const a = from === undefined ? undefined : index.get(from);
    const b = to === undefined ? undefined : index.get(to);
    if (a === undefined || b === undefined || a === b) {
      dropped++;
      continue;
    }
    neighbours[a]?.push(b);
    neighbours[b]?.push(a);
    used++;
  }
  return { n: nodes.length, keys, neighbours, used, dropped, duplicateKeys, keylessNodes };
}

/**
 * Hop distances from one source. `-1` means unreachable.
 *
 * Int32Array rather than a plain array: at 10,000 nodes the entry runs this
 * 10,000 times, and the allocation is the phase's cost, not an accident of it.
 */
export function bfsFrom(adj: BenchAdjacency, source: number): Int32Array {
  const d = new Int32Array(adj.n).fill(-1);
  d[source] = 0;
  const queue = new Int32Array(adj.n);
  queue[0] = source;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const v = queue[head++] as number;
    const dv = (d[v] as number) + 1;
    for (const w of adj.neighbours[v] ?? []) {
      if ((d[w] as number) < 0) {
        d[w] = dv;
        queue[tail++] = w;
      }
    }
  }
  return d;
}

/**
 * How many nodes the biggest component holds — the generator's promise, checked.
 *
 * WHY it walks in place instead of calling `bfsFrom` per component: `bfsFrom`
 * allocates two full-size arrays and would then need a full n-scan to mark the
 * component, so C components cost O(n · C) time and allocation. One `seen` byte
 * array and one reused queue answer the same question in O(n + m) — on 10,000
 * isolated nodes that is the difference between 800 MB of transient instrument
 * and none.
 */
export function giantComponentOf(adj: BenchAdjacency): { size: number; share: number } {
  const seen = new Uint8Array(adj.n);
  const queue = new Int32Array(adj.n);
  let best = 0;
  for (let s = 0; s < adj.n; s++) {
    if (seen[s] === 1) continue;
    seen[s] = 1;
    queue[0] = s;
    let head = 0;
    let tail = 1;
    let size = 0;
    while (head < tail) {
      const v = queue[head++] as number;
      size++;
      for (const w of adj.neighbours[v] ?? []) {
        if (seen[w] === 0) {
          seen[w] = 1;
          queue[tail++] = w;
        }
      }
    }
    if (size > best) best = size;
  }
  return { size: best, share: adj.n === 0 ? 0 : best / adj.n };
}

// ── 3 · the quality metric ───────────────────────────────────────────────────

/** A layout, as the metric reads one. Float64Array or plain array — both work. */
export interface Positions {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

/**
 * Stress, folded over a seeded SAMPLE of sources.
 *
 * Shape follows the fold's honesty shape: `total` pairs looked at, `counted`
 * pairs that carried a finite graph distance, `skipped` pairs that did not
 * (disconnected, or a node with no finite position). A disconnected pair is
 * SKIPPED here rather than substituted, because the metric's job is to say what
 * it could measure — the substitution rule (d = maxFinite + 1) belongs to the
 * layout, and an instrument that copies it would stop being independent.
 *
 * `stress` is taken at the optimal uniform scale, so a layout drawn in a
 * different unit is not punished for it: alpha = sum(w d r) / sum(w r^2) with
 * r the Euclidean distance and w = d^-2. Without that, "smaller box wins" and
 * the control below would prove nothing.
 *
 * `meanStress` is `stress / sum(w d^2)`, and because w = d^-2 that denominator
 * IS `counted` — so it is the scale-normalized stress of the SGD literature,
 * bounded in [0, 1] with 1 being every node on one point. It is the figure to
 * compare across graphs; `stress` is the raw sum and scales with `counted`.
 * A reading that counted NOTHING reports both as `NaN`, never as 0: 0 is the
 * score of a flawless embedding, and an unmeasured layout must not wear it.
 */
export interface StressReading {
  readonly stress: number;
  readonly meanStress: number;
  readonly scale: number;
  readonly total: number;
  readonly counted: number;
  readonly skipped: number;
  readonly sources: number;
}

export function stressOf(pos: Positions, adj: BenchAdjacency, opts: { sources?: number; seed?: number } = {}): StressReading {
  const wantSources = Math.min(opts.sources ?? 64, adj.n);
  const rnd = mulberry32(opts.seed ?? 7);
  // a seeded sample WITHOUT replacement, so one popular source cannot dominate
  const pool = Array.from({ length: adj.n }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i] as number;
    pool[i] = pool[j] as number;
    pool[j] = t;
  }
  const sources = pool.slice(0, wantSources);

  let total = 0;
  let counted = 0;
  let skipped = 0;
  let numer = 0; // sum w d r
  let denom = 0; // sum w r^2
  for (const s of sources) {
    const dist = bfsFrom(adj, s);
    const xs = pos.x[s];
    const ys = pos.y[s];
    for (let j = 0; j < adj.n; j++) {
      if (j === s) continue;
      total++;
      const d = dist[j] as number;
      const xj = pos.x[j];
      const yj = pos.y[j];
      if (d <= 0 || !Number.isFinite(xs as number) || !Number.isFinite(ys as number) || !Number.isFinite(xj as number) || !Number.isFinite(yj as number)) {
        skipped++;
        continue;
      }
      const dx = (xs as number) - (xj as number);
      const dy = (ys as number) - (yj as number);
      const r = Math.sqrt(dx * dx + dy * dy);
      const w = 1 / (d * d);
      numer += w * d * r;
      denom += w * r * r;
      counted++;
    }
  }
  // WHY guard denom: a layout that put every node on one point has r = 0
  // everywhere, so there is no scale that helps it. Scale 1 keeps the stress
  // finite and maximally bad, which is the honest reading of that layout.
  const scale = denom > 0 ? numer / denom : 1;
  // WHY no per-pair storage: at the optimal scale the residual sum expands to
  // scale^2 * denom - 2 * scale * numer + sum(w d^2), and because w = d^-2 the
  // last term is exactly `counted` — so the whole fold is the three scalars
  // this loop already carries. The `max(0, …)` catches the one caveat: on a
  // near-exact embedding this subtracts two nearly equal numbers and can round
  // to a tiny negative. The collapsed case (denom 0) lands on `counted`, i.e.
  // meanStress 1, exactly as the explicit loop did.
  const measured = counted > 0;
  const stress = denom > 0 ? Math.max(0, counted - (numer * numer) / denom) : counted;
  return {
    stress: measured ? stress : Number.NaN,
    meanStress: measured ? stress / counted : Number.NaN,
    scale,
    total,
    counted,
    skipped,
    sources: sources.length,
  };
}

/**
 * A seeded random layout in the unit square — the NEGATIVE baseline.
 *
 * Any layout worth its iterations must beat this on stress. The bench states
 * the ratio, so "the layout works" is a measured number rather than a claim.
 */
export function scrambleOf(n: number, seed = 99): { x: Float64Array; y: Float64Array } {
  const rnd = mulberry32(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = rnd();
    y[i] = rnd();
  }
  return { x, y };
}

// ── 4 · the bench's own all-pairs ────────────────────────────────────────────

/**
 * Every-source BFS into one `n * n` Uint16Array, with the disconnected rule
 * applied: an unreachable pair carries `maxFinite + 1`.
 *
 * WHY the bench owns this too, and why it has NO cap: the whole point of the
 * exercise is to decide what the layout's cap should be, and a bench that
 * inherited the layout's cap could never measure the size that justifies it.
 * This function is also what lets `place` be timed at 10,000 nodes on a day
 * when `distancesOf` refuses there.
 *
 * WHY this one DOES copy the layout's disconnected rule while section 3 refuses
 * to: this array is the layout's INPUT, not the bench's verdict. An oracle that
 * handed `place` a different rule would be timing a different algorithm.
 * Section 3's refusal governs the metric, which JUDGES, and stands unchanged.
 *
 * Uint16Array: hop distances on these graphs are small two-digit numbers, and
 * 2 bytes per pair is what makes the memory column honest — `n * n * 2` bytes,
 * stated, not estimated.
 */
export interface BenchDistances {
  readonly n: number;
  readonly d: Uint16Array;
  readonly maxFinite: number;
  readonly disconnectedPairs: number;
  /** `n * n * 2` — the reason a cap exists at all. */
  readonly bytes: number;
}

export function allPairsOf(adj: BenchAdjacency): BenchDistances {
  const n = adj.n;
  const d = new Uint16Array(n * n);
  const queue = new Int32Array(n);
  let maxFinite = 0;
  let disconnectedPairs = 0;
  // pass 1 — hops, with "unreachable" held as 0xffff until the rule can be applied
  for (let s = 0; s < n; s++) {
    const base = s * n;
    d.fill(0xffff, base, base + n);
    d[base + s] = 0;
    queue[0] = s;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const v = queue[head++] as number;
      const dv = (d[base + v] as number) + 1;
      for (const w of adj.neighbours[v] ?? []) {
        if (d[base + w] === 0xffff) {
          d[base + w] = dv;
          if (dv > maxFinite) maxFinite = dv;
          queue[tail++] = w;
        }
      }
    }
  }
  // pass 2 — the disconnected rule, once the true maximum is known.
  // WHY `max(maxFinite, 1)`: on a graph with no edges at all `maxFinite` stays
  // 0, and `0 + 1` would declare every isolated pair ADJACENT — distance 1
  // means one hop, and nothing here is one hop from anything.
  const substitute = Math.max(maxFinite, 1) + 1;
  for (let i = 0; i < d.length; i++) {
    if (d[i] === 0xffff) {
      d[i] = substitute;
      disconnectedPairs++;
    }
  }
  return { n, d, maxFinite, disconnectedPairs, bytes: n * n * 2 };
}
