/**
 * ─────────────────────────────────────────────────────────────────────────────
 * chooseEngine — THE ROUTER, AND THE ONE THRESHOLD A BENCH ACTUALLY MEASURED.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Q12 (docs/RESEARCH_STATE.md) asked: "auto-engine thresholds (rows/bytes for
 * memory->wasm->server) — measure with an X4-style bench, don't guess."
 *
 * The ROW axis is now measured. `bench/step0-wasm` puts both engines on one
 * clock, in one process, on the same rows — node v22.16.0, darwin arm64,
 * 2026-09-10 (`bench/step0-wasm/wasm-table.md`, median of 3–7 reps):
 *
 *   rows        memory: load / COUNT / window / sorted / FIRST sorted   DuckDB-WASM: load / COUNT / window / sorted
 *   90,300        6.45 /  4.13 /  3.01 /  6.92 /  33.0 ms                 345 / 1.73 / 2.95 /  3.70 ms
 *   300,000      21.7  /  9.58 /  9.80 / 24.1  / 125   ms                 507 / 2.94 / 4.42 /  6.20 ms
 *   1,000,000    72.7  / 32.3  / 32.2  / 97.5  / 517   ms                 935 / 7.08 / 8.62 / 14.8  ms
 *
 * WHAT IT SAYS, and therefore what {@link DEFAULT_ENGINE_THRESHOLDS} is:
 *
 *   - DuckDB is faster at EVERY size on every read (0.15×–0.55× at and above
 *     300,000 rows), and it costs 345–935 ms ONCE to open and land the table.
 *     Choosing it is buying reads with a startup, and how many reads a session
 *     makes is the thing this function cannot know.
 *   - At 90,300 and 300,000 rows the memory engine answers every steady-state
 *     read in 3–24 ms — inside an interaction budget — so its ~500 ms cheaper
 *     start is the better trade for a dashboard that opens, filters and closes.
 *   - At 1,000,000 it is not: a sorted window is 97.5 ms and the FIRST sorted
 *     ask 517 ms, against DuckDB's 14.8 ms. That is the cliff.
 *   - So `maxMemoryRows` is 300,000: the largest size the bench actually
 *     measured the memory engine winning at. It is not interpolated — the bench
 *     ran a third size precisely so this number would be a measurement.
 *
 * WHAT IS STILL UNMEASURED, and says so rather than routing on a guess: no
 * memory FOOTPRINT was sampled, and the bench never found DuckDB's ceiling (it
 * landed 1,000,000 rows without complaint). Both byte thresholds and the wasm
 * row ceiling are therefore `Infinity` — see {@link DEFAULT_ENGINE_THRESHOLDS}.
 *
 * Router, not a coordination layer (D24: "Keysets stay eliminated as
 * coordination; the VizAdapter small-data insight lives as the memory ENGINE"):
 * `chooseEngine` never touches a Selection/clause/CommitRecord — it only ever
 * returns a `ResolvedEngine` tag. The D24 invariant ("engine choice never
 * changes commit semantics") holds trivially here because this function has no
 * access to commit semantics to change — and `engineInvariant.test.ts` proves
 * the invariant itself against a real DuckDB.
 *
 * First customer: `resolveEngine` (../def/buildDashboard.ts), which is what
 * `engine: 'auto'` on a def means.
 */

import type { ResolvedEngine } from './types.js';

export interface DatasetStats {
  /** Estimated row count (exact if known; an upper-bound estimate is fine). */
  readonly rowCountEstimate?: number;
  /** Estimated in-memory or on-disk byte size. */
  readonly byteSizeEstimate?: number;
  readonly columnCount?: number;
}

export interface EngineThresholds {
  /** Rows above which `memory` is no longer preferred. */
  readonly maxMemoryRows: number;
  /** Bytes above which `memory` is no longer preferred. */
  readonly maxMemoryBytes: number;
  /** Rows above which `wasm` defers to `server`. */
  readonly maxWasmRows: number;
  /** Bytes above which `wasm` defers to `server`. */
  readonly maxWasmBytes: number;
}

/**
 * The shipped defaults: ONE number a bench measured, three it did not — and the
 * three that were not measured are `Infinity`, which is how a threshold says
 * "no threshold" out loud.
 *
 * `maxMemoryRows: 300_000` — MEASURED (`bench/step0-wasm/wasm-table.md`, the
 * table in this file's header). The largest size at which the memory engine
 * answered every steady-state read inside an interaction budget; one size up,
 * its sorted window is 97.5 ms and its first sorted ask 517 ms.
 *
 * `maxMemoryBytes: Infinity` — UNMEASURED. The bench sampled no footprint, so
 * there is no measured byte at which the memory engine stops being right. WHY
 * that means Infinity and not a round number: the policy ANDs the two axes, so
 * an invented byte cap would silently VETO the one number that WAS measured (a
 * 300,000-row table is comfortably past any plausible 25 MB guess). A host that
 * knows its own byte budget passes `thresholds`.
 *
 * `maxWasmRows` / `maxWasmBytes: Infinity` — UNMEASURED, and deliberately never
 * escalating: the bench never found DuckDB-WASM's ceiling, and `serverProvider`
 * is still a typed stub that answers nothing. A number nobody measured must not
 * be what sends a table to an engine that cannot answer it. A host with a real
 * backend passes its own `thresholds` (or declares `engine: 'server'`).
 */
export const DEFAULT_ENGINE_THRESHOLDS: EngineThresholds = {
  maxMemoryRows: 300_000,
  maxMemoryBytes: Number.POSITIVE_INFINITY,
  maxWasmRows: Number.POSITIVE_INFINITY,
  maxWasmBytes: Number.POSITIVE_INFINITY,
};

export type EnginePolicy = (stats: DatasetStats, thresholds: EngineThresholds) => ResolvedEngine;

/**
 * The default policy: monotone memory -> wasm -> server escalation on whichever
 * of rows/bytes is the more restrictive signal. Injectable and replaceable in
 * full (see `ChooseEngineOptions.policy`) — this function is not privileged, it
 * is just the shipped default, and it honours whatever thresholds it is handed
 * (which is why the byte axis is proven live by a test that passes its own).
 */
export const defaultEnginePolicy: EnginePolicy = (stats, thresholds) => {
  const rows = stats.rowCountEstimate ?? 0;
  const bytes = stats.byteSizeEstimate ?? 0;
  if (rows <= thresholds.maxMemoryRows && bytes <= thresholds.maxMemoryBytes) return 'memory';
  if (rows <= thresholds.maxWasmRows && bytes <= thresholds.maxWasmBytes) return 'wasm';
  return 'server';
};

export interface ChooseEngineOptions {
  /** Defaults to `defaultEnginePolicy`. */
  readonly policy?: EnginePolicy;
  /** Defaults to {@link DEFAULT_ENGINE_THRESHOLDS}. */
  readonly thresholds?: EngineThresholds;
  /**
   * Restrict the choice to engines actually available in this environment
   * (e.g. `['memory']` when no SQL connection can be opened — `serverProvider`
   * is still a typed stub, so a caller driving real data today should pass
   * this). Falls back down the D24 escalation order (`memory` -> `wasm` ->
   * `server`) to the nearest available engine if the policy's pick is excluded.
   */
  readonly availableEngines?: readonly ResolvedEngine[];
}

const ESCALATION_ORDER: readonly ResolvedEngine[] = ['memory', 'wasm', 'server'];

/**
 * Resolve `'auto'` to a concrete engine. Pure function of `stats` + the
 * injected policy/thresholds — no I/O, no hidden global state.
 */
export function chooseEngine(stats: DatasetStats, options: ChooseEngineOptions = {}): ResolvedEngine {
  const policy = options.policy ?? defaultEnginePolicy;
  const thresholds = options.thresholds ?? DEFAULT_ENGINE_THRESHOLDS;
  const picked = policy(stats, thresholds);

  const available = options.availableEngines;
  if (!available || available.includes(picked)) return picked;

  // Fall back to the nearest available engine at-or-above the picked tier,
  // then anywhere available at all — never silently return an engine the
  // caller said is unavailable.
  const pickedIdx = ESCALATION_ORDER.indexOf(picked);
  for (let i = pickedIdx; i < ESCALATION_ORDER.length; i++) {
    const candidate = ESCALATION_ORDER[i]!;
    if (available.includes(candidate)) return candidate;
  }
  for (const candidate of ESCALATION_ORDER) {
    if (available.includes(candidate)) return candidate;
  }
  throw new RangeError('chooseEngine: availableEngines is empty — at least one engine must be available');
}
