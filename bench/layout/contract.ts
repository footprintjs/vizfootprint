/**
 * LAYOUT BENCH — THE CONTRACT. The bench is written before the layout, so this
 * file is where the bench says what the layout must expose for it to be
 * measurable at all.
 *
 * The law it follows: bench first. A number nobody can reproduce is not a
 * number, and a phase nobody can time is not a phase — so "adjacency,
 * all-pairs, iterations" is not a description of the implementation, it is a
 * REQUIREMENT on it. Four functions and one constant, named here.
 *
 * WHY the phases and not just the analysis: the cap this bench exists to
 * justify is a cap on EXACT ALL-PAIRS, and `distancesOf` REFUSES above it. The
 * phases are required SEPARATELY so the bench can hand `place` its OWN cap-free
 * all-pairs matrix (`measure.ts`) and still time 10,000 nodes, while
 * `distancesOf` is called beside it at every size so that its refusal is
 * recorded as a RESULT rather than as a crash.
 *
 * If packet 3 lands these under different names, THIS is the file that changes
 * — one line per name — and `layout-entry.ts` / `layout.test.ts` follow.
 *
 * First customers: `layout-entry.ts` (static import, bundled), `layout.test.ts`
 * (dynamic import, skipped until the module lands), and `run.mjs` — which
 * bundles this file and RELOCATES the bundle, which is why the paths below are
 * sought rather than derived from this module's own location.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── What the layout must export ──────────────────────────────────────────────

/** Undirected adjacency over the nodes table, with the endpoints it could not resolve COUNTED. */
export interface LayoutAdjacency {
  readonly n: number;
  /**
   * `keys[i]` is node `i`'s key in the nodes table's row order. When a key
   * repeats, the FIRST row owns it and later rows are isolated — an edge can
   * only ever reach the first of them.
   */
  readonly keys: readonly string[];
  readonly neighbours: readonly (readonly number[])[];
  /**
   * Honesty counters, the fold's shape: rows seen, rows used, and rows whose
   * endpoints are not two DISTINCT nodes (an unknown endpoint or a self-loop —
   * both are rows the graph could not use, and both count as dropped).
   */
  readonly total: number;
  readonly used: number;
  readonly dropped: number;
}

/** All-pairs hop distances, row-major, with the disconnected rule already applied. */
export interface LayoutDistances {
  readonly n: number;
  /** `n * n` distances. A disconnected pair carries `maxFinite + 1`. */
  readonly d: ArrayLike<number>;
  /** The longest path that really exists. 0 when nothing is connected to anything. */
  readonly maxFinite: number;
  /** Matrix cells (ordered pairs, diagonal excluded) that no path joins. */
  readonly disconnectedPairs: number;
}

/**
 * What `place` is given. `anchored[i]` NON-ZERO means node `i` already has a
 * position and must keep it — an anchor is honoured only where `x0[i]` and
 * `y0[i]` are both finite. An anchored node with no warm position is not an
 * anchor: pinning it would freeze it at a start position the layout invented.
 */
export interface PlaceOptions {
  readonly distances: LayoutDistances;
  readonly seed: number;
  readonly iterations: number;
  /** Warm start: the previous act's x/y, or NaN where the node is new. */
  readonly x0?: ArrayLike<number>;
  readonly y0?: ArrayLike<number>;
  readonly anchored?: ArrayLike<number>;
}

export interface PlacedPositions {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

/**
 * The five exports the bench needs from `src/analysis/layout.ts`.
 * `layoutAnalysis` is the builtin factory, three are its phases, and
 * `LAYOUT_NODE_CAP` is the ceiling its refusal quotes.
 */
export interface LayoutContract {
  /** Phase 1 — build the undirected graph from the nodes and edges rows. */
  adjacencyOf(
    nodes: readonly Record<string, unknown>[],
    edges: readonly Record<string, unknown>[],
    cols: { key: string; from: string; to: string },
  ): LayoutAdjacency;
  /** Phase 2 — exact all-pairs shortest paths by unweighted BFS. Refuses above the cap. */
  distancesOf(adjacency: LayoutAdjacency): LayoutDistances;
  /** Phase 3 — the seeded SGD stress iterations. */
  place(options: PlaceOptions): PlacedPositions;
  /** The node-count ceiling for exact all-pairs, the number the refusal sentence quotes. */
  readonly LAYOUT_NODE_CAP: number;
  /** The builtin factory, so the bench can also time one whole analysis run. */
  layoutAnalysis(options: Record<string, unknown>): unknown;
}

/** The export names checked at runtime, so a rename shows up as a sentence and not as `undefined is not a function`. */
export const REQUIRED_EXPORTS = ['adjacencyOf', 'distancesOf', 'place', 'LAYOUT_NODE_CAP', 'layoutAnalysis'] as const;

// ── Has it landed? ───────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The repo root — SOUGHT, never derived from this module's own location.
 *
 * WHY: `run.mjs` bundles this file with esbuild, and esbuild leaves
 * `import.meta.url` pointing at the EMITTED file. Anchoring on `HERE` would
 * therefore re-base the path onto the caller's `outDir`, and the refusal below
 * would quote a path that never existed — the one thing a refusal may not do.
 * So walk up from `HERE`, then from the working directory, for the folder that
 * holds `package.json`.
 */
function rootFrom(start: string): string | undefined {
  let at = start;
  for (let up = 0; up < 8; up++) {
    if (existsSync(path.join(at, 'package.json'))) return at;
    const parent = path.dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
  return undefined;
}

const ROOT = rootFrom(HERE) ?? rootFrom(process.cwd());

/** The file packet 3 writes. Named once, read by the harness and the acceptance alike. */
export const LAYOUT_SOURCE = ROOT === undefined ? '' : path.join(ROOT, 'src', 'analysis', 'layout.ts');

/**
 * Is the layout there yet?
 *
 * WHY a file check and not a try/catch import: the harness must decide BEFORE
 * esbuild bundles a static import of a file that may not exist, and a bundler
 * error is a worse sentence than this one.
 */
export function layoutHasLanded(): boolean {
  return LAYOUT_SOURCE !== '' && existsSync(LAYOUT_SOURCE);
}

/** Which required exports a landed module is missing. Empty means the contract holds. */
export function missingExportsOf(mod: Record<string, unknown>): string[] {
  return REQUIRED_EXPORTS.filter((name) => mod[name] === undefined);
}

/** The one sentence the harness and the acceptance both print while the layout is still to come. */
export function notLandedSentence(): string {
  if (ROOT === undefined) {
    return (
      `the layout bench cannot find the repo root: no package.json above "${HERE}" or "${process.cwd()}", ` +
      `so it cannot say whether src/analysis/layout.ts has landed — run it from inside the repo.`
    );
  }
  return (
    `the layout bench has nothing to measure: "${LAYOUT_SOURCE}" does not exist yet. ` +
    `This bench was written first, on purpose — it states what the layout must prove ` +
    `(${REQUIRED_EXPORTS.join(', ')}) before the layout exists to prove it.`
  );
}
