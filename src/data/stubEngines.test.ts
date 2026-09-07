/**
 * stubEngines.test.ts — ONE WORDING FOR THE TWO ENGINES THIS VERSION DOES NOT
 * RUN. The refusal is minted in `stubEngines.ts` and quoted by every door;
 * these tests pin the sentence's three obligations (name the engine, say it
 * answers no query in this version, say what to do instead) and pin that both
 * typed stubs quote it VERBATIM rather than each writing its own words.
 */
import { describe, it, expect } from 'vitest';
import { STUB_ENGINES, isStubEngine, stubEngineRefusal, stubEngineRemedy, stubEngineSentence } from './stubEngines.js';
import { wasmProvider } from './wasmProvider.js';
import { serverProvider } from './serverProvider.js';
import { isRejection, type DataProvider } from './types.js';

describe('the stub engines are named once', () => {
  it('the list is the two engines a provider reports that are not memory', () => {
    expect(STUB_ENGINES).toEqual(['wasm', 'server']);
    // and each one is really a provider that tags itself that way — the list is not a second opinion
    expect(STUB_ENGINES.map((e) => (e === 'wasm' ? wasmProvider() : serverProvider()).engine)).toEqual(['wasm', 'server']);
  });

  it('isStubEngine judges every declaration a def may carry, including none', () => {
    expect(isStubEngine('wasm')).toBe(true);
    expect(isStubEngine('server')).toBe(true);
    expect(isStubEngine('memory')).toBe(false);
    expect(isStubEngine('auto')).toBe(false);
    expect(isStubEngine(undefined)).toBe(false);
  });
});

describe('the sentence', () => {
  it('names the engine and says plainly that it answers no query in this version', () => {
    expect(stubEngineSentence('wasm')).toBe('the "wasm" engine answers no query in this version — it is a typed stub: it names its declared tables and answers nothing else');
    expect(stubEngineSentence('server')).toBe('the "server" engine answers no query in this version — it is a typed stub: it names its declared tables and answers nothing else');
  });

  it('the remedy quotes the table and points at the two ways out', () => {
    const remedy = stubEngineRemedy('cases');
    expect(remedy).toContain('Declare engine "memory" to run "cases" in this process');
    expect(remedy).toContain('pass { providers: { "cases": yourProvider } } to the builder you already call');
    // the door is a fact about the whole def, never about this table: naming one builder sent an async-built def to a door that refuses it
    expect(remedy).not.toContain('buildDashboard(def');
  });

  it('the whole refusal is the sentence, then the remedy — never one without the other', () => {
    expect(stubEngineRefusal('server', 'cases')).toBe(`${stubEngineSentence('server')}. ${stubEngineRemedy('cases')}`);
  });
});

describe('both typed stubs refuse in exactly those words', () => {
  const readingDoors = async (provider: DataProvider, table: string): Promise<readonly string[]> => {
    const columns = await provider.columns(table);
    const evaluated = await provider.evaluate(table, null);
    const details: string[] = [];
    for (const answer of [columns, evaluated]) {
      if (!isRejection(answer)) throw new Error('a stub engine answered a read');
      details.push(answer.detail ?? '(no detail)');
    }
    return details;
  };

  it('wasm: columns and evaluate carry the minted refusal, for the table that was asked', async () => {
    expect(await readingDoors(wasmProvider(), 'cases')).toEqual([stubEngineRefusal('wasm', 'cases'), stubEngineRefusal('wasm', 'cases')]);
  });

  it('server: the same words, differing only in the engine named', async () => {
    expect(await readingDoors(serverProvider({ tables: ['cases'] }), 'cases')).toEqual([stubEngineRefusal('server', 'cases'), stubEngineRefusal('server', 'cases')]);
  });

  it('wasm materializeColumn refuses in the same words; server refuses by its declared capability instead', async () => {
    const wasm = await wasmProvider().materializeColumn('cases', 'cluster_id', []);
    expect(isRejection(wasm) && wasm.detail).toBe(stubEngineRefusal('wasm', 'cases'));
    // a real Coordinator behind the server provider would refuse this too, so it says the capability, not the missing wiring
    const server = await serverProvider().materializeColumn('cases', 'cluster_id', []);
    expect(isRejection(server) && server.detail).toContain('does not support write-back materialization on "cases" (canMaterialize: false)');
  });

  it('the one thing a stub still answers is the list it was declared with — the sentence admits it rather than claiming the table is dark', async () => {
    expect(await wasmProvider({ sources: { cases: { kind: 'objects', data: [] } } }).tables()).toEqual(['cases']);
    expect(await serverProvider({ tables: ['cases'] }).tables()).toEqual(['cases']);
    for (const engine of STUB_ENGINES) expect(stubEngineSentence(engine)).toContain('it names its declared tables and answers nothing else');
  });

  it('a SORTED window is refused in the same words — `unsupported-sort` is the reason, and the remedy is one a caller can act on', async () => {
    for (const stub of [wasmProvider(), serverProvider()]) {
      const answer = await stub.evaluate('cases', null, { sort: [{ field: 'week', dir: 'asc' }] });
      // the reason stays the contract's own (this engine cannot honour a sort); only the DETAIL is the minted one,
      // because "ask for this window without a sort" led to a second refusal — a remedy that does not work is not one
      expect(answer).toMatchObject({ reason: 'unsupported-sort', detail: stubEngineRefusal(stub.engine as 'wasm' | 'server', 'cases') });
    }
  });

  it('no door still says "D24 build step 3" — a fact about our build order is not a remedy', async () => {
    const details = [...(await readingDoors(wasmProvider(), 't')), ...(await readingDoors(serverProvider(), 't'))];
    for (const detail of details) expect(detail).not.toContain('D24');
  });
});
