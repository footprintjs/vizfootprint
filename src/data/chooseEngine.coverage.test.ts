/**
 * chooseEngine.coverage.test.ts — closes the one remaining gap in
 * chooseEngine.test.ts's `availableEngines` fallback: the FIRST loop's
 * "escalate to the nearest available tier at-or-above the picked one"
 * success case. The existing suite only ever exercises that loop finding
 * NOTHING (falling through to the second, unconditional loop); this pins the
 * case where the first loop itself finds and returns a match.
 */

import { describe, it, expect } from 'vitest';
import { chooseEngine } from './chooseEngine.js';

describe('chooseEngine — availableEngines: escalates within the "at or above picked" loop', () => {
  it('policy picks memory, memory is unavailable, but wasm (above it) IS — returns wasm from the FIRST loop, not the fallback loop', () => {
    const result = chooseEngine(
      { rowCountEstimate: 1 }, // default policy picks 'memory' for a tiny dataset
      { availableEngines: ['wasm', 'server'] },
    );
    expect(result).toBe('wasm');
  });

  it('policy picks wasm, wasm is unavailable, but server (above it) IS — returns server', () => {
    const result = chooseEngine(
      { rowCountEstimate: 1_000_000, byteSizeEstimate: 10 * 1024 * 1024 }, // picks 'wasm'
      { availableEngines: ['server'] },
    );
    expect(result).toBe('server');
  });
});
