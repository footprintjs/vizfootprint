import { describe, it, expect } from 'vitest';
import {
  chooseEngine,
  defaultEnginePolicy,
  DEFAULT_ENGINE_THRESHOLDS,
  type EngineThresholds,
} from './chooseEngine.js';

/** Thresholds that DO name a ceiling on every axis — what a host with a real backend passes. */
const NAMED_CEILINGS: EngineThresholds = {
  maxMemoryRows: 300_000,
  maxMemoryBytes: 25 * 1024 * 1024,
  maxWasmRows: 5_000_000,
  maxWasmBytes: 500 * 1024 * 1024,
};

describe('chooseEngine — the shipped defaults escalate on the ONE axis a bench measured', () => {
  it('small datasets resolve to memory', () => {
    expect(chooseEngine({ rowCountEstimate: 100, byteSizeEstimate: 1_000 })).toBe('memory');
  });

  it('the measured threshold is where the answer changes: 300,000 rows is memory, one row more is wasm', () => {
    // The number itself is `bench/step0-wasm/wasm-table.md`'s: the largest size at
    // which the memory engine answered every steady-state read inside an
    // interaction budget (9.58–24.1 ms), against DuckDB's 507 ms to start.
    expect(chooseEngine({ rowCountEstimate: 300_000 })).toBe('memory');
    expect(chooseEngine({ rowCountEstimate: 300_001 })).toBe('wasm');
    expect(chooseEngine({ rowCountEstimate: 1_000_000 })).toBe('wasm');
  });

  it('very large datasets stay on WASM, because nobody measured a ceiling for it and `server` answers nothing', () => {
    // The honesty rule this file is named for: an unmeasured number must not be
    // what sends a table to a typed stub. A host that HAS a backend says so.
    expect(chooseEngine({ rowCountEstimate: 50_000_000, byteSizeEstimate: 2 * 1024 * 1024 * 1024 })).toBe('wasm');
    expect(chooseEngine({ rowCountEstimate: 50_000_000 }, { thresholds: NAMED_CEILINGS })).toBe('server');
  });

  it('byte size alone changes nothing under the defaults — and everything under thresholds that name one', () => {
    // 1 GB in ten rows: no footprint was ever sampled, so the shipped default has
    // no opinion and the measured row axis decides. Handed a byte ceiling, the
    // same policy escalates on it — so the axis is live, not dead code.
    expect(chooseEngine({ rowCountEstimate: 10, byteSizeEstimate: 1024 * 1024 * 1024 })).toBe('memory');
    expect(chooseEngine({ rowCountEstimate: 10, byteSizeEstimate: 1024 * 1024 * 1024 }, { thresholds: NAMED_CEILINGS })).toBe('server');
  });

  it('missing stats default to the smallest tier (memory)', () => {
    expect(chooseEngine({})).toBe('memory');
  });
});

describe('chooseEngine — the seam is genuinely injectable', () => {
  it('a custom policy fully overrides the default', () => {
    const alwaysServer = () => 'server' as const;
    expect(chooseEngine({ rowCountEstimate: 1 }, { policy: alwaysServer })).toBe('server');
  });

  it('custom thresholds change the escalation points without touching the policy function', () => {
    const tight: EngineThresholds = {
      maxMemoryRows: 10,
      maxMemoryBytes: 10,
      maxWasmRows: 20,
      maxWasmBytes: 20,
    };
    expect(chooseEngine({ rowCountEstimate: 15 }, { thresholds: tight })).toBe('wasm');
    expect(chooseEngine({ rowCountEstimate: 25 }, { thresholds: tight })).toBe('server');
  });

  it('defaultEnginePolicy is exported and independently callable (not privileged over a custom one)', () => {
    expect(defaultEnginePolicy({ rowCountEstimate: 1 }, DEFAULT_ENGINE_THRESHOLDS)).toBe('memory');
  });
});

describe('chooseEngine — availableEngines fallback (wasm/server are stubs today)', () => {
  it('falls back to memory when the policy would pick wasm but only memory is available', () => {
    const result = chooseEngine(
      { rowCountEstimate: 1_000_000, byteSizeEstimate: 10 * 1024 * 1024 },
      { availableEngines: ['memory'] },
    );
    expect(result).toBe('memory');
  });

  it('…and a host that CAN open a SQL connection gets the engine the bench says is faster there', () => {
    expect(chooseEngine({ rowCountEstimate: 1_000_000 }, { availableEngines: ['memory', 'wasm'] })).toBe('wasm');
  });

  it('escalates upward to the nearest available tier, never silently downgrades past what is offered', () => {
    // policy picks 'server'; only memory+wasm are available -> falls to the
    // nearest available at-or-above 'server' first (none), then anywhere available.
    const alwaysServer = () => 'server' as const;
    const result = chooseEngine(
      { rowCountEstimate: 1 },
      { policy: alwaysServer, availableEngines: ['memory', 'wasm'] },
    );
    expect(result).toBe('memory');
  });

  it('throws rather than silently choosing an engine when availableEngines is empty', () => {
    expect(() => chooseEngine({ rowCountEstimate: 1 }, { availableEngines: [] })).toThrow(RangeError);
  });

  it('does not reject the pick when it is already available', () => {
    expect(chooseEngine({ rowCountEstimate: 1 }, { availableEngines: ['memory', 'wasm', 'server'] })).toBe(
      'memory',
    );
  });
});

describe('DEFAULT_ENGINE_THRESHOLDS — what was measured, and what says it was not', () => {
  it('is monotone (memory <= wasm on both axes) so the escalation order is well-formed', () => {
    expect(DEFAULT_ENGINE_THRESHOLDS.maxMemoryRows).toBeLessThanOrEqual(DEFAULT_ENGINE_THRESHOLDS.maxWasmRows);
    expect(DEFAULT_ENGINE_THRESHOLDS.maxMemoryBytes).toBeLessThanOrEqual(DEFAULT_ENGINE_THRESHOLDS.maxWasmBytes);
  });

  it('the ONE measured number is the row threshold, and it is the size bench/step0-wasm ran', () => {
    // Pinned so the number cannot drift away from the run that produced it. If the
    // bench is re-run at other sizes, this expectation and the table move together.
    expect(DEFAULT_ENGINE_THRESHOLDS.maxMemoryRows).toBe(300_000);
  });

  it('every axis nobody measured is Infinity — a threshold saying "no threshold" out loud', () => {
    // WHY this is a test and not a comment: a finite guess here would silently veto
    // the measured row axis (the policy ANDs them), and that is exactly the failure
    // Q12 was opened about.
    expect(DEFAULT_ENGINE_THRESHOLDS.maxMemoryBytes).toBe(Number.POSITIVE_INFINITY);
    expect(DEFAULT_ENGINE_THRESHOLDS.maxWasmRows).toBe(Number.POSITIVE_INFINITY);
    expect(DEFAULT_ENGINE_THRESHOLDS.maxWasmBytes).toBe(Number.POSITIVE_INFINITY);
  });
});
