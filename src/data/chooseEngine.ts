/**
 * chooseEngine — the D24 "auto" seam: turn dataset stats into a resolved
 * engine choice, via an INJECTABLE policy (D24 build step 4).
 *
 * Q12 [OPEN] (docs/RESEARCH_STATE.md): "auto-engine thresholds (rows/bytes
 * for memory->wasm->server) — measure with an X4-style bench, don't guess."
 * `PLACEHOLDER_ENGINE_THRESHOLDS` below is exactly that — an unmeasured
 * placeholder, not a tuned default. It exists so `chooseEngine` has SOME
 * default behavior today; the moment Q12's bench lands, only this constant
 * (or a caller-supplied `thresholds`/`policy` override) needs to change —
 * the seam itself (the `EnginePolicy` function signature) does not.
 *
 * Router, not a coordination layer (D24: "Keysets stay eliminated as
 * coordination; the VizAdapter small-data insight lives as the memory
 * ENGINE"): `chooseEngine` never touches a Selection/clause/CommitRecord —
 * it only ever returns a `ResolvedEngine` tag. The D24 invariant ("engine
 * choice never changes commit semantics") holds trivially here because this
 * function has no access to commit semantics to change.
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
 * UNMEASURED PLACEHOLDER (Q12, OPEN). Round-number guesses in the shape of
 * "a browser tab can comfortably hold this many JS objects / this much
 * DuckDB-WASM working set" — not derived from any bench. Do not cite these
 * numbers as a capacity claim; they exist only so `chooseEngine` has a
 * default to fall back on before Q12's X4-style bench lands.
 */
export const PLACEHOLDER_ENGINE_THRESHOLDS: EngineThresholds = {
  maxMemoryRows: 50_000,
  maxMemoryBytes: 25 * 1024 * 1024, // 25 MB
  maxWasmRows: 5_000_000,
  maxWasmBytes: 500 * 1024 * 1024, // 500 MB
};

export type EnginePolicy = (stats: DatasetStats, thresholds: EngineThresholds) => ResolvedEngine;

/**
 * The default policy: monotone memory -> wasm -> server escalation on
 * whichever of rows/bytes is the more restrictive signal. Injectable and
 * replaceable in full (see `ChooseEngineOptions.policy`) — this function is
 * not privileged, it is just the shipped default.
 */
export const defaultEnginePolicy: EnginePolicy = (stats, thresholds) => {
  const rows = stats.rowCountEstimate ?? 0;
  const bytes = stats.byteSizeEstimate ?? 0;
  if (rows <= thresholds.maxMemoryRows && bytes <= thresholds.maxMemoryBytes) return 'memory';
  if (rows <= thresholds.maxWasmRows && bytes <= thresholds.maxWasmBytes) return 'wasm';
  return 'server';
};

export interface ChooseEngineOptions {
  /** Defaults to `defaultEnginePolicy`. Swap in a bench-measured policy once Q12 resolves. */
  readonly policy?: EnginePolicy;
  /** Defaults to `PLACEHOLDER_ENGINE_THRESHOLDS`. */
  readonly thresholds?: EngineThresholds;
  /**
   * Restrict the choice to engines actually available in this environment
   * (e.g. `['memory']` when no Coordinator/WASM connector is configured —
   * `wasmProvider`/`serverProvider` are still typed stubs, so a caller
   * driving real data today should pass this). Falls back down the D24
   * escalation order (`memory` -> `wasm` -> `server`) to the nearest
   * available engine if the policy's pick is excluded.
   */
  readonly availableEngines?: readonly ResolvedEngine[];
}

const ESCALATION_ORDER: readonly ResolvedEngine[] = ['memory', 'wasm', 'server'];

/**
 * Resolve `'auto'` to a concrete engine. Pure function of `stats` + the
 * injected policy/thresholds — no I/O, no hidden global state (Q12's future
 * bench-measured policy can be swapped in without touching call sites).
 */
export function chooseEngine(stats: DatasetStats, options: ChooseEngineOptions = {}): ResolvedEngine {
  const policy = options.policy ?? defaultEnginePolicy;
  const thresholds = options.thresholds ?? PLACEHOLDER_ENGINE_THRESHOLDS;
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
