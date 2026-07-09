/**
 * stubProviders.test.ts — pins the R14 contract for the wasm/server typed
 * stubs (D24 build step 3): honest `capabilities`, and every data-touching
 * call returns a typed rejection — never a thrown exception, never a
 * silently empty success.
 */
import { describe, it, expect } from 'vitest';
import { wasmProvider } from './wasmProvider.js';
import { serverProvider } from './serverProvider.js';
import { isRejection } from './types.js';

describe('wasmProvider — typed stub', () => {
  it('declares the engine tag and forward-looking capabilities', () => {
    const p = wasmProvider();
    expect(p.engine).toBe('wasm');
    expect(p.capabilities).toEqual({ canEvaluateSQL: true, canMaterialize: true });
  });

  it('tables() resolves to empty rather than rejecting when nothing was declared (no lie either way)', async () => {
    const p = wasmProvider();
    expect(await p.tables()).toEqual([]);
  });

  it('tables() reflects DECLARED sources (an honest partial capability) even without a live connection', async () => {
    const p = wasmProvider({
      sources: { events: { kind: 'csv', fileName: 'events.csv' }, brushes: { kind: 'objects', data: [] } },
    });
    expect(await p.tables()).toEqual(['events', 'brushes']);
  });

  it('columns/evaluate/materializeColumn all reject with reason "not-implemented"', async () => {
    const p = wasmProvider();
    const columns = await p.columns('t');
    const evald = await p.evaluate('t', null);
    const materialized = await p.materializeColumn('t', 'c', []);
    for (const result of [columns, evald, materialized]) {
      expect(isRejection(result)).toBe(true);
      if (!isRejection(result)) throw new Error('unreachable');
      expect(result.engine).toBe('wasm');
      expect(result.reason).toBe('not-implemented');
    }
  });

  it('constructing a provider never throws (no eager WASM/network side effect)', () => {
    expect(() => wasmProvider({ sources: { t: { kind: 'csv', fileName: 'x.csv' } } })).not.toThrow();
  });
});

describe('serverProvider — typed stub', () => {
  it('declares the engine tag and forward-looking capabilities (canMaterialize is honestly false)', () => {
    const p = serverProvider();
    expect(p.engine).toBe('server');
    expect(p.capabilities).toEqual({ canEvaluateSQL: true, canMaterialize: false });
  });

  it('tables() honors a declared table list without needing a live connection', async () => {
    const p = serverProvider({ tables: ['events', 'sessions'] });
    expect(await p.tables()).toEqual(['events', 'sessions']);
  });

  it('columns/evaluate reject with reason "no-backend-connection"', async () => {
    const p = serverProvider();
    const columns = await p.columns('t');
    const evald = await p.evaluate('t', null);
    for (const result of [columns, evald]) {
      expect(isRejection(result)).toBe(true);
      if (!isRejection(result)) throw new Error('unreachable');
      expect(result.engine).toBe('server');
      expect(result.reason).toBe('no-backend-connection');
    }
  });

  it('materializeColumn rejects "not-implemented", consistent with canMaterialize:false', async () => {
    const p = serverProvider();
    const result = await p.materializeColumn('t', 'c', []);
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) throw new Error('unreachable');
    expect(result.reason).toBe('not-implemented');
  });
});
