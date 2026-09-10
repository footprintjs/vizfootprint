/**
 * wasmEngine.def.test.ts — A DEF THAT DECLARES `engine: 'wasm'` GETS AN ENGINE
 * WITH ITS BYTES IN IT: THE ASYNC DOOR LANDS THEM BEFORE IT RETURNS, THE SYNC
 * DOOR LANDS THEM ON THE FIRST READ AND SAYS SO.
 *
 * What is judged here is not SQL — `wasmProvider.test.ts` owns the statements —
 * but the WIRING: which bytes reached a connection, how many connections were
 * opened, and what a def hears when a landing fails. So every test asks the
 * question through the doors a person calls (`buildDashboard`,
 * `buildDashboardAsync`, `session.viewQuery`) against a fake backend that
 * answers only what was actually landed in it (`../data/sqlConnection.coverage.helpers.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDashboard, buildDashboardAsync, validateDashboardDef, DashboardDefError } from './index.js';
import { fakeSqlBackend, fakeSqlConnection, catalogRefusal } from '../data/sqlConnection.coverage.helpers.js';
import { noConnectionRefusal, wasmBackend, wasmRowBytes, type WasmBackend } from './wasmBackend.js';
import type { DashboardDef } from './index.js';
import type { SqlConnection } from '../data/index.js';

// ── The data: two tables, one of them on the SQL engine. ─────────────────

const CASES: readonly Record<string, unknown>[] = [
  { week: 1, disease: 'Lyme' },
  { week: 2, disease: 'Lyme' },
  { week: 3, disease: 'Zika' },
];

const NOTES: readonly Record<string, unknown>[] = [{ id: 'a', body: 'first' }];

/** The smallest def that can hold a table and open a session: no analysis, no encoding, one actor. */
function defWith(data: DashboardDef['data']): DashboardDef {
  return { meta: { title: 'cases' }, data, actors: { grid: { actor: 'user', label: 'Grid' } } } as DashboardDef;
}

const oneWasmTable = (): DashboardDef => defWith({ cases: { rows: CASES, engine: 'wasm' }, notes: { rows: NOTES } });

/** An opener over a connection, and a count of how many times it was asked to open. */
function opener(connection: SqlConnection): { readonly open: () => Promise<SqlConnection>; readonly opens: () => number } {
  let opens = 0;
  return {
    open: async () => {
      opens += 1;
      return connection;
    },
    opens: () => opens,
  };
}

/** The rows of one window, or the refusal quoted — a test that accepted a refusal silently would pin nothing. */
async function windowOf(dash: Awaited<ReturnType<typeof buildDashboardAsync>>, table: string, sort?: readonly { field: string; dir: 'asc' | 'desc' }[]): Promise<{ rows: readonly Record<string, unknown>[]; count: number }> {
  const res = await dash.createSession().viewQuery({ table, columns: table === 'cases' ? ['week', 'disease'] : ['id', 'body'], ...(sort ? { sort } : {}) });
  if (!res.ok) throw new Error(`window on "${table}" was refused: ${res.rejected}`);
  return { rows: res.rows, count: res.count };
}

/** …and the refusal itself, for the paths where the refusal IS the answer. */
async function refusedWindow(dash: Awaited<ReturnType<typeof buildDashboardAsync>>, table: string): Promise<{ reason: string; engineReason?: string; rejected: string }> {
  const res = await dash.createSession().viewQuery({ table, columns: ['week', 'disease'] });
  if (res.ok) throw new Error(`window on "${table}" was answered, not refused`);
  return { reason: res.reason, ...(res.engineReason !== undefined ? { engineReason: res.engineReason } : {}), rejected: res.rejected };
}

describe('…and with NO opener at all, it lands them in a real DuckDB', () => {
  it('a def that names the engine and nothing else answers a window out of DuckDB itself', async () => {
    // The one test in this file with no fake in it. WHY it belongs here: every
    // other test passes `openSqlConnection`, so nothing would notice if the
    // DEFAULT opener stopped working — and the default is what a def author who
    // writes `engine: 'wasm'` and nothing else actually gets. In node that is the
    // bundle DuckDB-WASM ships for node (`../data/duckdbConnection.ts`); in a
    // browser it is the worker; the def never learns which.
    const dash = await buildDashboardAsync(oneWasmTable());
    expect(dash.notes).toEqual([]); // nothing failed to land, so there is nothing to say
    const window = await windowOf(dash, 'cases', [{ field: 'week', dir: 'desc' }]);
    expect(window.count).toBe(CASES.length);
    // The VALUES are the def's own, with no reading-through: the database is
    // opened with `castBigIntToDouble` (`../data/duckdbConnection.ts`), so the
    // `week` a def declared as a number comes back as one — a `15n` here would
    // be a value `JSON.stringify` throws on and every fold reads as absent.
    expect(window.rows).toEqual([
      { week: 3, disease: 'Zika' },
      { week: 2, disease: 'Lyme' },
      { week: 1, disease: 'Lyme' },
    ]);
    await dash.close();
  });

  it('close() releases the database this build opened — and a read after it says so in the engine s own words', async () => {
    const dash = await buildDashboardAsync(oneWasmTable());
    expect((await windowOf(dash, 'cases')).count).toBe(CASES.length);
    await dash.close();
    await dash.close(); // twice is a no-op: an owner that has already let go has nothing left to release
    const refused = await refusedWindow(dash, 'cases');
    expect(refused.rejected).toContain('cases');
  });
});

describe('the async door lands every wasm table before it returns the dashboard', () => {
  it('the def’s own rows reach the backend, and the memory table beside them never touches it', async () => {
    const backend = fakeSqlBackend();
    const dash = await buildDashboardAsync(oneWasmTable(), { openSqlConnection: async () => backend });
    expect(dash.engines).toEqual({ cases: 'wasm', notes: 'memory' });
    expect(backend.landed).toEqual([{ table: 'cases', data: { kind: 'rows', rows: CASES } }]);
    // nothing to say: the engine ran, and the bytes are in it
    expect(dash.notes).toEqual([]);
  });

  it('the landed table answers rows, count and a sorted window — out of the backend, not out of JS', async () => {
    const backend = fakeSqlBackend();
    const dash = await buildDashboardAsync(oneWasmTable(), { openSqlConnection: async () => backend });
    const plain = await windowOf(dash, 'cases');
    expect(plain.count).toBe(3);
    expect(plain.rows).toEqual(CASES);
    const sorted = await windowOf(dash, 'cases', [{ field: 'week', dir: 'desc' }]);
    expect(sorted.rows.map((r) => r['week'])).toEqual([3, 2, 1]);
    // the sort was the BACKEND's: the statement carried it
    expect(backend.asked.some((sql) => sql.includes('ORDER BY "week" DESC'))).toBe(true);
    // …and the memory table is answered in this process, by the engine it declared
    expect((await windowOf(dash, 'notes')).rows).toEqual(NOTES);
  });

  it('CSV text is handed over as TEXT — the engine that runs the query is the one that reads the bytes', async () => {
    const backend = fakeSqlBackend();
    const csv = 'week,disease\n1,Lyme\n2,Zika';
    const dash = await buildDashboardAsync(defWith({ cases: { csv, engine: 'wasm' } }), { openSqlConnection: async () => backend });
    expect(backend.landed).toEqual([{ table: 'cases', data: { kind: 'csv', text: csv } }]);
    expect((await windowOf(dash, 'cases')).count).toBe(2);
  });

  it('two wasm tables share ONE connection — two databases could not see each other’s tables', async () => {
    const backend = fakeSqlBackend();
    const asked = opener(backend);
    const dash = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'wasm' }, notes: { rows: NOTES, engine: 'wasm' } }), { openSqlConnection: asked.open });
    expect(asked.opens()).toBe(1);
    expect(backend.landed.map((l) => l.table)).toEqual(['cases', 'notes']);
    expect((await windowOf(dash, 'notes')).rows).toEqual(NOTES);
  });

  it('a def with no wasm table opens nothing at all — choosing an engine nobody declared is not an act', async () => {
    const asked = opener(fakeSqlBackend());
    const dash = await buildDashboardAsync(defWith({ notes: { rows: NOTES } }), { openSqlConnection: asked.open });
    expect(asked.opens()).toBe(0);
    expect(dash.engines).toEqual({ notes: 'memory' });
  });
});

describe('the sync door cannot await a load — so it says which read will pay for it', () => {
  it('the note names the laziness, the build opens nothing, and the first read lands the bytes', async () => {
    const backend = fakeSqlBackend();
    const asked = opener(backend);
    const dash = buildDashboard(oneWasmTable(), { openSqlConnection: asked.open });
    expect(dash.engines).toEqual({ cases: 'wasm', notes: 'memory' });
    expect(dash.notes).toEqual(['data["cases"]: the "wasm" engine holds this table lazily — a sync build cannot await a load, so the SQL connection opens and its bytes land on the first read; build with buildDashboardAsync to have them landed before the dashboard is returned']);
    // NOTHING has happened yet: no connection, no bytes
    expect(asked.opens()).toBe(0);
    expect(backend.landed).toEqual([]);
    // …and now the first read pays for both, and gets a real answer
    expect((await windowOf(dash, 'cases')).count).toBe(3);
    expect(asked.opens()).toBe(1);
    expect(backend.landed.map((l) => l.table)).toEqual(['cases']);
  });

  it('the async door mints no such note — it has already done the thing the note is about', async () => {
    const notes = (await buildDashboardAsync(oneWasmTable(), { openSqlConnection: async () => fakeSqlBackend() })).notes;
    expect(notes.every((n) => !n.includes('holds this table lazily'))).toBe(true);
  });

  it('…and with the DEFAULT opener the same laziness holds against a real DuckDB: the note first, the database on the read', async () => {
    // The sync door's twin of the async live test at the top of this file. No
    // opener is passed, so the connection is DuckDB-WASM itself — and the door
    // still returns without one, carrying the note that says which read will pay.
    const dash = buildDashboard(oneWasmTable());
    expect(dash.notes).toEqual(['data["cases"]: the "wasm" engine holds this table lazily — a sync build cannot await a load, so the SQL connection opens and its bytes land on the first read; build with buildDashboardAsync to have them landed before the dashboard is returned']);
    const window = await windowOf(dash, 'cases');
    expect(window.count).toBe(CASES.length);
    expect(window.rows.map((row) => row['disease'])).toEqual(['Lyme', 'Lyme', 'Zika']);
  });
});

describe('a landing that fails is a build note AND a refused read — never a throw past the door', () => {
  it('the opener throws: one cause, filed against every table that was waiting for it, and heard again on the read', async () => {
    const def = defWith({ cases: { rows: CASES, engine: 'wasm' }, notes: { rows: NOTES, engine: 'wasm' } });
    const dash = await buildDashboardAsync(def, {
      openSqlConnection: async () => {
        throw new Error('no worker in this environment');
      },
    });
    expect(dash.notes).toEqual([
      'data["cases"]: the "wasm" engine could not open a SQL connection to land "cases" in: no worker in this environment — every read of it is refused in those words',
      'data["notes"]: the "wasm" engine could not open a SQL connection to land "notes" in: no worker in this environment — every read of it is refused in those words',
    ]);
    const refusal = await refusedWindow(dash, 'cases');
    expect(refusal.engineReason).toBe('no-backend-connection');
    expect(refusal.rejected).toContain('no worker in this environment');
  });

  it('a thrown non-Error is quoted as it is — the cause is repeated, never parsed', async () => {
    const dash = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'wasm' } }), {
      openSqlConnection: async () => {
        // a host's own opener may throw anything at all; what this pins is that the note quotes it either way
        throw 'the tab was closed';
      },
    });
    expect(dash.notes).toEqual(['data["cases"]: the "wasm" engine could not open a SQL connection to land "cases" in: the tab was closed — every read of it is refused in those words']);
  });

  it('a connection that reads but cannot LAND is said out loud — and a table the host loaded itself still answers', async () => {
    const dash = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'wasm' } }), { openSqlConnection: async () => fakeSqlConnection() });
    expect(dash.notes).toEqual(['data["cases"]: the SQL connection this build opened cannot land "cases": it answers queries only (no load) — load that table into your backend yourself before the first read, or pass an opener that can (openSqlConnection: duckdbConnection())']);
    // the note is about the LANDING, not about the reading: this connection answers, so the window does
    expect((await windowOf(dash, 'cases')).count).toBe(2);
  });

  it('the backend refuses the load: the cause is quoted, and the read is refused by the backend that never received it', async () => {
    const backend = fakeSqlBackend({ refuseLoad: (table) => (table === 'cases' ? 'Out of Memory Error' : undefined) });
    const dash = await buildDashboardAsync(oneWasmTable(), { openSqlConnection: async () => backend });
    expect(dash.notes).toEqual(['data["cases"]: the "wasm" engine could not land "cases" in its SQL backend: Out of Memory Error — every read of it is refused by a backend that never received it']);
    const refusal = await refusedWindow(dash, 'cases');
    expect(refusal.engineReason).toBe('no-backend-connection');
    expect(refusal.rejected).toContain(catalogRefusal('cases'));
    // the table that did land is untouched by its neighbour's failure
    expect((await windowOf(dash, 'notes')).rows).toEqual(NOTES);
  });
});

describe('a source table and the wasm engine — the ruling', () => {
  const source = { format: 'rows', via: 'inline', at: CASES } as const;
  const sourced = (engine?: string): DashboardDef => defWith({ cases: { source, ...(engine !== undefined ? { engine } : {}) } } as DashboardDef['data']);

  it('the def door allows the two engines that can RECEIVE bytes, and refuses the two that cannot', () => {
    expect(validateDashboardDef(sourced())).toEqual([]);
    expect(validateDashboardDef(sourced('memory'))).toEqual([]);
    expect(validateDashboardDef(sourced('wasm'))).toEqual([]);
    const ruling = (engine: string): string =>
      `data["cases"] sets engine "${engine}" with a source; a source's rows are loaded into the engine that reads them, so a source table declares "memory" (materialised in this process) or "wasm" (landed in the SQL backend by buildDashboardAsync) — or no engine at all`;
    expect(validateDashboardDef(sourced('server'))).toContain(ruling('server'));
    expect(validateDashboardDef(sourced('auto'))).toContain(ruling('auto'));
  });

  it('the sync door refuses it in a sentence that names the door to call — landing bytes is an await', () => {
    expect(() => buildDashboard(sourced('wasm'))).toThrow(DashboardDefError);
    expect(() => buildDashboard(sourced('wasm'))).toThrow('data["cases"] declares a source with engine "wasm" — a source\'s rows are landed in the SQL backend by an await; build it with buildDashboardAsync');
    // …and a source it cannot even FETCH keeps its own sentence, which names the same door
    expect(() => buildDashboard(defWith({ cases: { source: { format: 'csv', via: 'http', at: 'https://example.test/c.csv' }, engine: 'wasm' } } as DashboardDef['data']))).toThrow('declares a source via http');
    // an inline source on the memory engine is this door's own business, and it builds
    expect(buildDashboard(sourced('memory')).engines).toEqual({ cases: 'memory' });
  });

  it('the async door lands the carrier’s rows and keeps the provenance the carrier vouched for', async () => {
    const backend = fakeSqlBackend();
    const dash = await buildDashboardAsync(sourced('wasm'), { openSqlConnection: async () => backend });
    expect(dash.engines).toEqual({ cases: 'wasm' });
    expect(backend.landed).toEqual([{ table: 'cases', data: { kind: 'rows', rows: CASES } }]);
    expect(dash.sources['cases']?.rows).toBe(3);
    expect((await windowOf(dash, 'cases')).count).toBe(3);
  });

  it('refresh refuses it rather than swapping the table onto the memory engine behind the reader’s back', async () => {
    const dash = await buildDashboardAsync(sourced('wasm'), { openSqlConnection: async () => fakeSqlBackend() });
    const answer = (await dash.refresh(['cases'])).tables['cases'];
    expect(answer).toEqual({
      refused: true,
      reason: 'not-reloadable',
      message: 'data["cases"] runs on the "wasm" engine — its rows were landed in a SQL backend at build, and this builder does not re-land them; close() this dashboard and build again to read the source afresh',
    });
    // the engine it reports is still the engine it runs on — the refusal is what keeps that true
    expect(dash.engines).toEqual({ cases: 'wasm' });
  });
});

describe('whoever opened it closes it — the one law an owner can be read from', () => {
  it('a connection the HOST opened stays the host s: close() leaves it open', async () => {
    const backend = fakeSqlBackend();
    const dash = await buildDashboardAsync(oneWasmTable(), { openSqlConnection: async () => backend });
    await dash.close();
    expect(backend.closed()).toBe(false);
    // …and it still answers, which is the point: the host may be reading it through five other things
    expect((await windowOf(dash, 'cases')).count).toBe(3);
  });

  it('a def with no wasm table has nothing to close, and closing it opens nothing', async () => {
    const asked = opener(fakeSqlBackend());
    const dash = buildDashboard(defWith({ notes: { rows: NOTES } }), { openSqlConnection: asked.open });
    await dash.close();
    expect(asked.opens()).toBe(0);
  });

  it('…nor does closing a lazy wasm table nobody ever read — a release is not an open', async () => {
    const asked = opener(fakeSqlBackend());
    const dash = buildDashboard(oneWasmTable(), { openSqlConnection: asked.open });
    await dash.close();
    expect(asked.opens()).toBe(0);
  });
});

describe('the OWNER s release path, arm by arm — the seam that makes it provable without a real database', () => {
  /** One table remembered, so the backend has something to open FOR. */
  const withOneTable = (backend: WasmBackend): WasmBackend => {
    backend.provider('cases', wasmRowBytes(CASES as readonly Record<string, unknown>[]));
    return backend;
  };

  it('closes the connection it opened, ONCE — a second close has nothing left to release', async () => {
    const own = fakeSqlBackend();
    const backend = withOneTable(wasmBackend(undefined, async () => own));
    await backend.settle();
    await backend.close();
    expect(own.closed()).toBe(true);
    await backend.close(); // no second close reaches the connection, and no throw
  });

  it('a connection with nothing to release is closed by doing nothing — `close` is optional on the port', async () => {
    const readOnly: SqlConnection = { query: async () => [] }; // no close(): a handle from a pool, a fake
    const backend = withOneTable(wasmBackend(undefined, async () => readOnly));
    await backend.settle();
    await expect(backend.close()).resolves.toBeUndefined();
  });

  it('an open that FAILED leaves nothing to release, and close() does not raise it a second time', async () => {
    const backend = withOneTable(
      wasmBackend(undefined, async () => {
        throw new Error('no worker here');
      }),
    );
    // the failure is reported where it belongs: as this table's landing note
    expect(await backend.settle()).toEqual([{ table: 'cases', failed: noConnectionRefusal('cases', 'no worker here') }]);
    await expect(backend.close()).resolves.toBeUndefined();
  });

  it('…and a HOST s connection is untouched however it was opened', async () => {
    const theirs = fakeSqlBackend();
    const backend = withOneTable(wasmBackend(async () => theirs));
    await backend.settle();
    await backend.close();
    expect(theirs.closed()).toBe(false);
  });
});

describe('`auto` follows the measured threshold — and says which side of it this table fell on', () => {
  it('three rows: memory, no connection opened, and the note quotes the count it routed on', async () => {
    const asked = opener(fakeSqlBackend());
    const dash = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'auto' } }), { availableEngines: ['memory', 'wasm'], openSqlConnection: asked.open });
    expect(dash.engines).toEqual({ cases: 'memory' });
    expect(dash.notes).toEqual(['data["cases"]: engine "auto" resolved to memory (3 rows, against the measured row threshold in chooseEngine — declare an engine to choose otherwise)']);
    expect(asked.opens()).toBe(0);
    // and it is NOT said with the words of an engine that answers nothing
    expect(dash.notes[0]).not.toContain('answers no query');
    expect(dash.notes[0]).not.toContain('has no connection');
  });

  it('past the threshold it resolves to WASM and lands the bytes — the whole point of measuring it', async () => {
    // 300,001 CSV data lines: one row past `DEFAULT_ENGINE_THRESHOLDS.maxMemoryRows`,
    // which `bench/step0-wasm` measured. The rows never become objects here — `statsOf`
    // counts lines and DuckDB reads the text itself — so this test costs a string.
    const csv = `id\n${'1\n'.repeat(300_001)}`;
    const backend = fakeSqlBackend();
    const dash = await buildDashboardAsync(defWith({ cases: { csv, engine: 'auto' } }), { availableEngines: ['memory', 'wasm'], openSqlConnection: async () => backend });
    expect(dash.engines).toEqual({ cases: 'wasm' });
    expect(dash.notes).toEqual(['data["cases"]: engine "auto" resolved to wasm (300,001 rows, against the measured row threshold in chooseEngine — declare an engine to choose otherwise)']);
    // …and the bytes really landed, in the connection this build opened
    expect(backend.landed.map((l) => l.table)).toEqual(['cases']);
  });

  it('…but never past what the environment offers: with only memory available, the same table stays in JS', async () => {
    const csv = `id\n${'1\n'.repeat(300_001)}`;
    const dash = await buildDashboardAsync(defWith({ cases: { csv, engine: 'auto' } }), { availableEngines: ['memory'] });
    expect(dash.engines).toEqual({ cases: 'memory' });
    expect(dash.notes[0]).toContain('resolved to memory (300,001 rows');
    // …and it says so: the note used to read as if the MEASUREMENT had chosen
    // memory, when what chose it was `availableEngines` defaulting to ['memory'].
    expect(dash.notes[0]).toContain(
      '; the measured threshold said wasm, which this build was not told is available — pass availableEngines: ["memory","wasm"] to allow it',
    );
  });

  it('…and when the pick and the measurement AGREE, the note says nothing extra', async () => {
    const dash = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'auto' } }), { availableEngines: ['memory'] });
    expect(dash.notes[0]).not.toContain('the measured threshold said');
  });
});

describe('the READMEs carry the ruling', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (file: string): string => readFileSync(path.join(here, '..', '..', file), 'utf8');

  it('the def README states the source-table ruling with an example, and PACKAGING names the optional peer', () => {
    const def = read('src/def/README.md');
    expect(def).toContain('A source table and the wasm engine');
    expect(def).toContain('buildDashboardAsync');
    expect(def).toContain('openSqlConnection');
    const packaging = read('PACKAGING.md');
    expect(packaging).toContain('@duckdb/duckdb-wasm');
    expect(packaging).toContain('duckdbConnection.ts');
  });

  it('…and the READMEs carry the two laws this packet decided: who closes the connection, and the projection/sort rule', () => {
    expect(read('src/def/README.md')).toContain('Whoever opened it closes it');
    const data = read('src/data/README.md');
    expect(data).toContain('One law for the projection and the sort');
    expect(data).toContain('to return');
  });

  it('the peer range admits upstream s own prerelease line, and PACKAGING says why nobody may simplify it', () => {
    // semver's prerelease rule: `>=1.29.0` alone rejects `1.33.1-dev45.0`, which
    // is the version this tree resolves and the one mosaic pins exactly.
    const pkg = JSON.parse(read('package.json')) as { peerDependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.peerDependencies['@duckdb/duckdb-wasm']).toBe('>=1.29.0 || >=1.33.1-dev');
    // …and the gate's own requirement is declared, not inherited through mosaic
    expect(pkg.devDependencies['@duckdb/duckdb-wasm']).toBe('1.33.1-dev45.0');
    expect(read('PACKAGING.md')).toContain('Why the range has a second clause');
  });
});
