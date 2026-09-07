/**
 * stubEngine.def.test.ts — A DASHBOARD MAY NOT BUILD GREEN AND THEN ANSWER
 * NOTHING. A table declaring `wasm` or `server` routes to a typed stub that
 * refuses every read, so the BUILD says so, in the very words the read will
 * use, and both builders say it.
 *
 * The design this pins (and why it is not a validator refusal): `wasm` and
 * `server` are legal declarations of a real seam, and the same def RUNS when a
 * host answers that table through `options.providers` — which the validator
 * never sees. So the def door still accepts it, which is also what keeps the
 * session's `needs-backend-data` gap reachable by the ten-odd tests that
 * deliberately declare a stub engine to exercise it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDashboard, buildDashboardAsync } from './index.js';
import { memoryProvider, stubEngineRefusal, stubEngineSentence } from '../data/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../session/dashboard.fixture.js';
import type { DashboardDef } from './index.js';

const noteFor = (engine: 'wasm' | 'server'): string => `data["data"]: ${stubEngineRefusal(engine, 'data')}`;

describe('a declared stub engine is said out loud at the door', () => {
  it('the build note names the engine, says it answers no query in this version, and points at what to do instead', () => {
    const notes = buildDashboard(makeDashboardDef({ engine: 'wasm' })).notes;
    expect(notes).toContain(noteFor('wasm'));
    const note = notes.find((n) => n.includes('"wasm"'))!;
    expect(note).toContain('answers no query in this version');
    expect(note).toContain('Declare engine "memory" to run "data" in this process');
    expect(note).toContain('pass { providers: { "data": yourProvider } } to the builder you already call');
    // and it never names ONE builder: this def would build async just as well, and that door refuses nothing here
    expect(note).not.toContain('buildDashboard(def');
  });

  it('the server engine gets the same note, differing only in the engine it names', () => {
    expect(buildDashboard(makeDashboardDef({ engine: 'server' }), { availableEngines: ['memory', 'wasm', 'server'] }).notes).toContain(noteFor('server'));
  });

  it('listing the engine as available buys nothing — the environment does not build what this version has not built', () => {
    const listed = buildDashboard(makeDashboardDef({ engine: 'wasm' }), { availableEngines: ['memory', 'wasm'] }).notes;
    const unlisted = buildDashboard(makeDashboardDef({ engine: 'wasm' })).notes;
    expect(listed).toEqual(unlisted);
  });

  it('the async builder says it too — one resolver, so neither door can drift from the other', async () => {
    const dash = await buildDashboardAsync(makeDashboardDef({ engine: 'wasm' }));
    expect(dash.notes).toContain(noteFor('wasm'));
  });

  it('the note is what the READ will say, word for word — the author hears it early, not differently', async () => {
    const dash = buildDashboard(makeDashboardDef({ engine: 'wasm' }));
    await expect(dash.lint()).rejects.toThrow(stubEngineRefusal('wasm', 'data'));
    expect(dash.notes.some((n) => n.endsWith(stubEngineRefusal('wasm', 'data')))).toBe(true);
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
    const dash = buildDashboard(makeDashboardDef({ engine: 'wasm' }));
    expect(dash.engines).toEqual({ data: 'wasm' });
    // and the read-time refusal reaches the doors an author calls, carrying the same sentence
    const keyed: DashboardDef = { ...makeDashboardDef({ engine: 'wasm' }), data: { data: { rows: [], engine: 'wasm', key: 'id' } } };
    expect((await buildDashboard(keyed).lintData())[0]).toContain(stubEngineSentence('wasm'));
    await expect(buildDashboard(makeDashboardDef({ engine: 'wasm' })).lintProse()).rejects.toThrow(stubEngineSentence('wasm'));
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
