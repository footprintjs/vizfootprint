/**
 * stubProviders.test.ts — pins the R14 contract at the edge of the data port:
 * honest `capabilities`, and every data-touching call answers a typed
 * rejection — never a thrown exception, never a silently empty success.
 *
 * `server` is the typed stub this version still ships. `wasm` is here only for
 * the ONE law it shares with it — a provider is inert to construct and refuses
 * in a typed shape — because it now answers real queries over a
 * `SqlConnection`, and its own laws are pinned in `wasmProvider.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { wasmProvider } from './wasmProvider.js';
import { serverProvider } from './serverProvider.js';
import { isRejection } from './types.js';

describe('wasmProvider — an engine that answers, judged by the same edge contract', () => {
  it('declares what it does, including the door it keeps shut', () => {
    const p = wasmProvider();
    expect(p.engine).toBe('wasm');
    expect(p.capabilities).toEqual({ canEvaluateSQL: true, canSort: true, canFind: true, canMaterialize: false });
  });

  it('tables() resolves to empty rather than rejecting when nothing was declared (no lie either way)', async () => {
    expect(await wasmProvider().tables()).toEqual([]);
  });

  it('tables() reflects DECLARED sources — a fact about the declaration, answered with no connection open', async () => {
    const p = wasmProvider({ sources: ['events', 'brushes'] });
    expect(await p.tables()).toEqual(['events', 'brushes']);
  });

  it('a read with no connection behind it is a typed rejection, never a throw', async () => {
    const p = wasmProvider({ sources: ['t'] });
    for (const result of [await p.columns('t'), await p.evaluate('t', null)]) {
      expect(isRejection(result)).toBe(true);
      if (!isRejection(result)) throw new Error('unreachable');
      expect(result.engine).toBe('wasm');
      expect(result.reason).toBe('no-backend-connection');
    }
  });

  it('constructing a provider never throws (no eager WASM/network side effect)', () => {
    expect(() => wasmProvider({ sources: ['t'] })).not.toThrow();
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

  it('columns/evaluate reject with reason "not-implemented" — the code the union names this engine under', async () => {
    const p = serverProvider();
    const columns = await p.columns('t');
    const evald = await p.evaluate('t', null);
    for (const result of [columns, evald]) {
      expect(isRejection(result)).toBe(true);
      if (!isRejection(result)) throw new Error('unreachable');
      expect(result.engine).toBe('server');
      expect(result.reason).toBe('not-implemented');
    }
  });

  it('a caller who DID supply a coordinator hears the same code — the refusal never claims a handle was missing', async () => {
    // `no-backend-connection` means "a handle was required and not supplied"; this stub ignores
    // `coordinator` entirely, so filing that code would state something it never checked
    const p = serverProvider({ coordinator: { query: () => undefined }, tables: ['cases'] });
    const columns = await p.columns('cases');
    expect(isRejection(columns) && columns.reason).toBe('not-implemented');
  });

  it('the declared table list is COPIED at construction — a caller\'s later push is not this provider\'s answer', async () => {
    const asked = ['events'];
    const p = serverProvider({ tables: asked });
    asked.push('ghost');
    expect(await p.tables()).toEqual(['events']);
  });

  it('materializeColumn rejects "not-implemented", consistent with canMaterialize:false', async () => {
    const p = serverProvider();
    const result = await p.materializeColumn('t', 'c', []);
    expect(isRejection(result)).toBe(true);
    if (!isRejection(result)) throw new Error('unreachable');
    expect(result.reason).toBe('not-implemented');
  });
});
