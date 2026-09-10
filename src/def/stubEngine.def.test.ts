/**
 * stubEngine.def.test.ts — A DASHBOARD MAY NOT BUILD GREEN AND THEN ANSWER
 * NOTHING. A table declaring `server` routes to a typed stub that refuses every
 * read — so the BUILD says so, in the very words the read will use, and both
 * builders say it.
 *
 * The design this pins (and why it is not a validator refusal): `server` is a
 * legal declaration of a real seam, and the same def RUNS when a host answers
 * that table through `options.providers` — which the validator never sees. So
 * the def door still accepts it, which is also what keeps the session's
 * `needs-backend-data` gap reachable by the ten-odd tests that deliberately
 * declare an engine with nothing behind it to exercise it.
 *
 * `wasm` is here only for CONTRAST: it is not a stub any more (it lands a def's
 * bytes in a SQL connection and answers real SQL — `./wasmEngine.def.test.ts`
 * owns that), so the note it owes is about WHEN its bytes land, never about an
 * engine that answers nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDashboard, buildDashboardAsync } from './index.js';
import { memoryProvider, stubEngineRefusal, stubEngineSentence } from '../data/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../session/dashboard.fixture.js';
import type { DashboardDef } from './index.js';

const noteFor = (engine: 'server'): string => `data["data"]: ${stubEngineRefusal(engine, 'data')}`;
/** …and the note the engine that RUNS owes the SYNC door: not "nothing can answer this", but "the first read pays for the load". */
const lazyNote = 'data["data"]: the "wasm" engine holds this table lazily — a sync build cannot await a load, so the SQL connection opens and its bytes land on the first read; build with buildDashboardAsync to have them landed before the dashboard is returned';
/**
 * An opener that refuses, and the words it refuses in.
 *
 * WHY these two tests pass one instead of letting the default opener fail: the
 * shipped default now opens a REAL database in either host it finds — a browser's
 * Worker or node's own bundle (`../data/duckdbConnection.ts`) — so leaving it to
 * the environment would land the table here and file no note at all. What this
 * door owes is the sentence a failed open BECOMES, and that is what is asked for.
 */
const NO_DATABASE = 'no database in this room';
const refusingOpener = (): Promise<never> => Promise.reject(new Error(NO_DATABASE));

describe('a declared stub engine is said out loud at the door', () => {
  it('the build note names the engine, says it answers no query in this version, and points at what to do instead', () => {
    const notes = buildDashboard(makeDashboardDef({ engine: 'server' })).notes;
    expect(notes).toContain(noteFor('server'));
    const note = notes.find((n) => n.includes('"server"'))!;
    expect(note).toContain('answers no query in this version');
    expect(note).toContain('Declare engine "memory" to run "data" in this process');
    expect(note).toContain('pass { providers: { "data": yourProvider } } to the builder you already call');
    // and it never names ONE builder: this def would build async just as well, and that door refuses nothing here
    expect(note).not.toContain('buildDashboard(def');
  });

  it('the wasm engine owes a note too — a different fact: this engine ANSWERS, so its note is about when its bytes land', () => {
    const notes = buildDashboard(makeDashboardDef({ engine: 'wasm' }), { availableEngines: ['memory', 'wasm'] }).notes;
    expect(notes).toEqual([lazyNote]);
    // it is NOT the stub sentence: this engine answers, and the table it answers is on its way in
    expect(notes[0]).not.toContain('answers no query in this version');
    expect(notes[0]).toContain('build with buildDashboardAsync');
  });

  it('listing the engine as available buys nothing — the environment does not build what this version has not built', () => {
    const listed = buildDashboard(makeDashboardDef({ engine: 'wasm' }), { availableEngines: ['memory', 'wasm'] }).notes;
    const unlisted = buildDashboard(makeDashboardDef({ engine: 'wasm' })).notes;
    expect(listed).toEqual(unlisted);
  });

  it('the async builder says the STUB’s note too — one resolver, so neither door can drift from the other', async () => {
    expect((await buildDashboardAsync(makeDashboardDef({ engine: 'server' }))).notes).toContain(noteFor('server'));
  });

  it('…and never the lazy note, because that door already landed what the note is about (here: tried to)', async () => {
    const notes = (await buildDashboardAsync(makeDashboardDef({ engine: 'wasm' }), { openSqlConnection: refusingOpener })).notes;
    expect(notes).toEqual([`data["data"]: the "wasm" engine could not open a SQL connection to land "data" in: ${NO_DATABASE} — every read of it is refused in those words`]);
    expect(notes[0]).not.toContain('holds this table lazily');
  });

  it('the note is what the READ will say, word for word — the author hears it early, not differently', async () => {
    const stub = buildDashboard(makeDashboardDef({ engine: 'server' }));
    await expect(stub.lint()).rejects.toThrow(stubEngineRefusal('server', 'data'));
    expect(stub.notes.some((n) => n.endsWith(stubEngineRefusal('server', 'data')))).toBe(true);
    // …and for the engine that RUNS, the same law applies to the failure and not to
    // the laziness: the sync note says which read will pay, and that read then says
    // what went wrong when it tried — the cause, quoted by both.
    const wasm = buildDashboard(makeDashboardDef({ engine: 'wasm' }), { openSqlConnection: refusingOpener });
    await expect(wasm.lint()).rejects.toThrow(NO_DATABASE);
    const async = await buildDashboardAsync(makeDashboardDef({ engine: 'wasm' }), { openSqlConnection: refusingOpener });
    expect(async.notes[0]).toContain(NO_DATABASE);
  });

  it('a table the memory engine runs owes no such note, and neither does one the host answered itself', () => {
    expect(buildDashboard(makeDashboardDef()).notes).toEqual([]);
    // a host provider is built INSTEAD of the def's routing, so the note it owes is the host note — never the stub's
    const host = { ...memoryProvider(SAMPLE_ROWS, { tableName: 'data' }), engine: 'wasm' as const };
    const notes = buildDashboard(makeDashboardDef({ engine: 'wasm' }), { providers: { data: host } }).notes;
    expect(notes).toEqual(['data["data"]: the host supplied its own "wasm" provider — the declared engine "wasm" was not built']);
  });

  it('`auto` keeps its own note and gains no second one — it resolves to memory, so it never routes to a stub', () => {
    const notes = buildDashboard(makeDashboardDef({ engine: 'auto' }), { availableEngines: ['memory', 'wasm', 'server'] }).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('engine "auto" resolved to memory');
    expect(notes[0]).not.toContain('answers no query in this version');
  });
});

describe('the def door still accepts it — the refusal is about this VERSION, not this def', () => {
  it('the dashboard builds, reports the engine it routed to, and refuses only when the table is read', async () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'server' }));
    expect(dash.engines).toEqual({ data: 'server' });
    // and the read-time refusal reaches the doors an author calls, carrying the same sentence
    const keyed: DashboardDef = { ...makeDashboardDef({ engine: 'server' }), data: { data: { rows: [], engine: 'server', key: 'id' } } };
    expect((await buildDashboard(keyed).lintData())[0]).toContain(stubEngineSentence('server'));
    await expect(buildDashboard(makeDashboardDef({ engine: 'server' })).lintProse()).rejects.toThrow(stubEngineSentence('server'));
  });

  it('a host that brings the engine makes the same def answer — which is why the validator may not refuse it', async () => {
    const host = { ...memoryProvider(SAMPLE_ROWS, { tableName: 'data' }), engine: 'wasm' as const };
    const dash = buildDashboard(makeDashboardDef({ engine: 'wasm' }), { providers: { data: host } });
    expect(await dash.lint()).toEqual([]);
  });
});

describe('the READMEs carry the law', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const readme = (folder: string): string => readFileSync(path.join(here, '..', folder, 'README.md'), 'utf8');

  it('both governed folders spell the refusal a reader will meet', () => {
    for (const folder of ['def', 'data']) {
      const text = readme(folder);
      expect(text, folder).toContain('answers no query in this version');
      expect(text, folder).toContain('providers');
    }
  });
});
