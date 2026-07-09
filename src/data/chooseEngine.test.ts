import { describe, it, expect } from 'vitest';
import {
  chooseEngine,
  defaultEnginePolicy,
  PLACEHOLDER_ENGINE_THRESHOLDS,
  type EngineThresholds,
} from './chooseEngine.js';

describe('chooseEngine — default (placeholder) policy escalation', () => {
  it('small datasets resolve to memory', () => {
    expect(chooseEngine({ rowCountEstimate: 100, byteSizeEstimate: 1_000 })).toBe('memory');
  });

  it('mid-size datasets (over the memory threshold) resolve to wasm', () => {
    expect(chooseEngine({ rowCountEstimate: 1_000_000, byteSizeEstimate: 10 * 1024 * 1024 })).toBe('wasm');
  });

  it('very large datasets resolve to server', () => {
    expect(chooseEngine({ rowCountEstimate: 50_000_000, byteSizeEstimate: 2 * 1024 * 1024 * 1024 })).toBe(
      'server',
    );
  });

  it('byte size alone can push the choice up a tier even with few rows', () => {
    expect(
      chooseEngine({ rowCountEstimate: 10, byteSizeEstimate: 1024 * 1024 * 1024 }), // 1GB, "row count" lying
    ).toBe('server');
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
    expect(defaultEnginePolicy({ rowCountEstimate: 1 }, PLACEHOLDER_ENGINE_THRESHOLDS)).toBe('memory');
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

describe('PLACEHOLDER_ENGINE_THRESHOLDS — Q12 honesty', () => {
  it('is monotone (memory <= wasm on both axes) so the escalation order is well-formed', () => {
    expect(PLACEHOLDER_ENGINE_THRESHOLDS.maxMemoryRows).toBeLessThanOrEqual(
      PLACEHOLDER_ENGINE_THRESHOLDS.maxWasmRows,
    );
    expect(PLACEHOLDER_ENGINE_THRESHOLDS.maxMemoryBytes).toBeLessThanOrEqual(
      PLACEHOLDER_ENGINE_THRESHOLDS.maxWasmBytes,
    );
  });
});
