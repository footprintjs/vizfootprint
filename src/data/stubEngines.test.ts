/**
 * stubEngines.test.ts — ONE WORDING FOR THE ENGINE THIS VERSION DOES NOT RUN.
 * The refusal is minted in `stubEngines.ts` and quoted by every door; these
 * tests pin the sentence's three obligations (name the engine, say it answers
 * no query in this version, say what to do instead), and pin that the LIST is
 * the one judgement of who is a stub — `wasm` left it the day it started
 * answering over a real connection, and nothing anywhere re-typed its name.
 */
import { describe, it, expect } from 'vitest';
import { STUB_ENGINES, isStubEngine, stubEngineRefusal, stubEngineRemedy, stubEngineSentence } from './stubEngines.js';
import { wasmProvider } from './wasmProvider.js';
import { serverProvider } from './serverProvider.js';
import { isRejection, type DataProvider } from './types.js';

describe('the stub engines are named once', () => {
  it('the list is the one engine a provider reports that neither answers nor is memory', () => {
    expect(STUB_ENGINES).toEqual(['server']);
    // and it is really a provider that tags itself that way — the list is not a second opinion
    expect(serverProvider().engine).toBe(STUB_ENGINES[0]);
  });

  it('isStubEngine judges every declaration a def may carry, including none', () => {
    expect(isStubEngine('server')).toBe(true);
    expect(isStubEngine('memory')).toBe(false);
    // wasm answers now (over a `SqlConnection`), so it is no longer refused as a stub anywhere —
    // the doors that judged it read THIS list, which is why they all changed with one edit
    expect(isStubEngine('wasm')).toBe(false);
    expect(isStubEngine('auto')).toBe(false);
    expect(isStubEngine(undefined)).toBe(false);
  });
});

describe('the sentence', () => {
  it('names the engine and says plainly that it answers no query in this version', () => {
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

describe('the typed stub refuses in exactly those words', () => {
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

  it('server: columns and evaluate carry the minted refusal, for the table that was asked', async () => {
    expect(await readingDoors(serverProvider({ tables: ['cases'] }), 'cases')).toEqual([stubEngineRefusal('server', 'cases'), stubEngineRefusal('server', 'cases')]);
  });

  it('server refuses materializeColumn by its declared capability instead — a real Coordinator would refuse it too', async () => {
    const server = await serverProvider().materializeColumn('cases', 'cluster_id', []);
    expect(isRejection(server) && server.detail).toContain('does not support write-back materialization on "cases" (canMaterialize: false)');
  });

  it('the one thing a stub still answers is the list it was declared with — the sentence admits it rather than claiming the table is dark', async () => {
    expect(await serverProvider({ tables: ['cases'] }).tables()).toEqual(['cases']);
    for (const engine of STUB_ENGINES) expect(stubEngineSentence(engine)).toContain('it names its declared tables and answers nothing else');
  });

  it('a SORTED window is refused in the same words — `unsupported-sort` is the reason, and the remedy is one a caller can act on', async () => {
    const answer = await serverProvider().evaluate('cases', null, { sort: [{ field: 'week', dir: 'asc' }] });
    // the reason stays the contract's own (this engine cannot honour a sort); only the DETAIL is the minted one,
    // because "ask for this window without a sort" led to a second refusal — a remedy that does not work is not one
    expect(answer).toMatchObject({ reason: 'unsupported-sort', detail: stubEngineRefusal('server', 'cases') });
  });

  it('no door still says "D24 build step 3" — a fact about our build order is not a remedy', async () => {
    for (const detail of await readingDoors(serverProvider(), 't')) expect(detail).not.toContain('D24');
  });
});

describe('the engine that left the list says its own sentences now', () => {
  it('wasm never speaks the stub wording — what it lacks is a connection, and that is what it says', async () => {
    const refusal = await wasmProvider({ sources: ['cases'] }).evaluate('cases', null);
    expect(isRejection(refusal)).toBe(true);
    const detail = (isRejection(refusal) && (refusal as { detail?: string }).detail) || '';
    expect(detail).not.toContain('answers no query in this version');
    expect(detail).toContain('has no connection to answer "cases" with');
  });

  it('…and it answers a real read once it HAS one — which is why it is not on the list', async () => {
    const provider = wasmProvider({
      sources: ['cases'],
      connection: {
        async query(sql: string): Promise<readonly Record<string, unknown>[]> {
          return sql.startsWith('DESCRIBE') ? [{ column_name: 'week', column_type: 'BIGINT' }] : [{ n: 0n }];
        },
      },
    });
    expect(await provider.evaluate('cases', null, { mode: 'count' })).toMatchObject({ count: 0 });
  });
});
