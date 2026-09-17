/**
 * declaredTable.def.test.ts — GUARD 2 OF "A DOCUMENT IS NEVER A TABLE BY
 * ACCIDENT": A LANDING THAT CARRIES NONE OF THE DECLARED COLUMNS IS NOT THIS
 * TABLE (`./declaredTable.ts`, wired into the two doors that land bytes —
 * `./buildDashboard.ts`'s async build door and its refresh door).
 *
 * The measured defect this packet exists for: a `csv` source pointed at a
 * protein structure file produced a 2,090-row table whose single column was
 * named after the file's 80-character `HEADER` line, with a version stamped
 * beside it and no refusal anywhere. The carrier's half of the law is
 * `../source/http.test.ts`; the decoder is deliberately NOT a judge
 * (`../source/decode.ts`), and `../source/source.test.ts` pins that it still
 * parses such a text.
 *
 * What is pinned here is the whole verdict AND its three silences — a partial
 * mismatch, a def that declares no columns, and a landing that brought none —
 * because each of those is today's law and had to stay byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync } from './index.js';
import { notTheDeclaredTable, unlandedProvider } from './declaredTable.js';
import type { Dashboard } from './buildDashboard.js';
import type { DashboardDef, DashboardRuntime, SourceAdapter } from './index.js';
import type { LandedColumns, Row, SqlConnection } from '../data/index.js';

/** The nine columns the def says this table has — the NNDSS shape the desk declared. */
const DECLARED: DashboardDef['data'][string]['columns'] = {
  state: { role: 'dimension' },
  disease: { role: 'dimension' },
  week: { role: 'dimension' },
  cases: { role: 'measure' },
  ytd: { role: 'measure' },
  population: { role: 'measure' },
  per100k: { role: 'measure' },
  report_state: { role: 'dimension' },
  updated_at: { role: 'dimension' },
};

/** …and what the protein structure file actually landed: its `HEADER` line as the one column name, 2,090 times. */
const PDB_COLUMN = 'HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7              ';
const PDB_ROWS: readonly Row[] = Array.from({ length: 2090 }, (_, i) => ({ [PDB_COLUMN]: `ATOM  ${i}` }));

/** The rows that ARE this table — two of the nine names, which is today's law and must stay it. */
const CELLS: readonly Row[] = [
  { state: 'Ohio', cases: 3 },
  { state: 'Iowa', cases: 1 },
];

/** The smallest def that can hold tables and open a session: one actor, nothing else. */
const defWith = (data: DashboardDef['data']): DashboardDef => ({ meta: { title: 'cells' }, data, actors: { grid: { actor: 'user', label: 'Grid' } } }) as DashboardDef;

/** A carrier the test moves between snapshots — the refresh door's fixture (`./landedColumns.def.test.ts`'s twin). */
function movingSource(initial: { rows: readonly Row[]; version: string }): { readonly adapter: SourceAdapter; move(next: { rows: readonly Row[]; version: string }): void } {
  let current = initial;
  return {
    adapter: {
      via: 'http',
      open: async () => ({
        capabilities: { live: false, pushdown: false as const },
        snapshot: async () => ({ rows: [...current.rows], version: current.version, retrievedAt: 'now' }),
        close: async () => {},
      }),
    },
    move: (next) => {
      current = next;
    },
  };
}

/** A def whose `cells` table declares the nine columns and reads them from a carrier. */
const sourced = (columns: DashboardDef['data'][string]['columns'], engine?: 'wasm'): DashboardDef =>
  defWith({
    cells: {
      source: { format: 'csv', via: 'http', at: 'https://viz.example/cells.csv' },
      ...(columns !== undefined ? { columns } : {}),
      ...(engine !== undefined ? { engine } : {}),
    },
    notes: { rows: [{ id: 'a' }] },
  } as DashboardDef['data']);

/** The registry, read the way the session reads it (`./landedColumns.def.test.ts`). */
const landedOf = (dash: Dashboard): LandedColumns => (dash.createSession() as unknown as { runtime: DashboardRuntime }).runtime.landedColumns;

/** One read of the table, answered or refused — a test that accepted either silently would pin nothing. */
async function readOf(dash: Dashboard): Promise<{ readonly ok: boolean; readonly reason?: string; readonly engineReason?: string; readonly rejected?: string; readonly count?: number }> {
  const res = await dash.createSession().viewQuery({ table: 'cells', columns: ['state', 'cases'] });
  return res.ok ? { ok: true, count: res.count } : { ok: false, reason: res.reason, ...(res.engineReason !== undefined ? { engineReason: res.engineReason } : {}), rejected: res.rejected };
}

/** The whole sentence, once — the note, the read and the refused refresh all quote it. */
const REFUSAL =
  `the csv source landed 2,090 rows and none of the columns this table declares — declared "state", "disease", "week", "cases", "ytd", "population", "per100k", "report_state", "updated_at", ` +
  `arrived "${PDB_COLUMN}". A document is never a table by accident, so nothing vouches for these bytes: every read of "cells" is refused in these words. ` +
  `Point the source at this table's own data, or declare the columns these bytes carry.`;

describe('the build door: bytes that are not the declared table are a note and a refused read, never a table', () => {
  it('nine columns declared and one unrelated column arrived — the note, and the read in the same words', async () => {
    const carrier = movingSource({ rows: PDB_ROWS, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(DECLARED), { sources: [carrier.adapter] });
    expect(dash.notes).toEqual([`data["cells"]: ${REFUSAL}`]);
    // nothing VOUCHES for bytes that are not the declared table: no provenance entry at all
    expect(Object.keys(dash.sources)).toEqual([]);
    // …and the def's own routing is still reported: the table was refused, not re-routed
    expect(dash.engines).toEqual({ cells: 'memory', notes: 'memory' });
    expect(await readOf(dash)).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-table', rejected: REFUSAL });
    // the registry claims nothing either — absent, never invented (`../data/landedColumns.ts`)
    expect(landedOf(dash).get('cells')).toBeUndefined();
    // and the table that DID land is untouched: a refusal is never a throw that loses it
    expect((await dash.createSession().viewQuery({ table: 'notes', columns: ['id'] })).ok).toBe(true);
  });

  it('SOME of the declared columns arrived — today\'s law, byte for byte: no note, the provenance vouched for, the rows read', async () => {
    const carrier = movingSource({ rows: CELLS, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(DECLARED), { sources: [carrier.adapter] });
    expect(dash.notes).toEqual([]);
    expect(dash.sources['cells']).toMatchObject({ format: 'csv', via: 'http', at: 'https://viz.example/cells.csv', version: 'v1', rows: 2 });
    expect(await readOf(dash)).toEqual({ ok: true, count: 2 });
    expect(landedOf(dash).get('cells')?.columns.map((c) => c.name)).toEqual(['state', 'cases']);
  });

  it('the def declares NO columns — nothing was said, so nothing is contradicted, and the registry learns whatever arrived', async () => {
    const carrier = movingSource({ rows: PDB_ROWS, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(undefined), { sources: [carrier.adapter] });
    expect(dash.notes).toEqual([]);
    expect(dash.sources['cells']).toMatchObject({ version: 'v1', rows: 2090 });
    expect(landedOf(dash).get('cells')?.columns.map((c) => c.name)).toEqual([PDB_COLUMN]);
  });

  it('the landing brought NO columns at all — a header-only CSV is this table with nothing in it, and ignorance is never refused', async () => {
    const carrier = movingSource({ rows: [], version: 'v1' });
    const dash = await buildDashboardAsync(sourced(DECLARED), { sources: [carrier.adapter] });
    expect(dash.notes).toEqual([]);
    expect(dash.sources['cells']).toMatchObject({ version: 'v1', rows: 0 });
    expect(await readOf(dash)).toEqual({ ok: true, count: 0 });
  });

  it('an INLINE source is never judged here — the def\'s own text, and both builders answer the same def the same way', async () => {
    const inline = defWith({ cells: { source: { format: 'csv', via: 'inline', at: 'atom,serial\nATOM,1\n' }, columns: DECLARED } } as DashboardDef['data']);
    const sync = buildDashboard(inline);
    const asyncDash = await buildDashboardAsync(inline);
    expect(sync.notes).toEqual([]);
    expect(asyncDash.notes).toEqual([]);
    expect(sync.sources['cells']).toMatchObject({ format: 'csv', via: 'inline', rows: 1 });
    expect(asyncDash.sources['cells']).toMatchObject({ format: 'csv', via: 'inline', rows: 1 });
  });
});

describe('a landing that genuinely FAILED keeps its own sentence — and guard 2 spends no engine to say its own', () => {
  it('a wasm source table whose backend never opens says the wasm words, and nothing else', async () => {
    const carrier = movingSource({ rows: CELLS, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(DECLARED, 'wasm'), {
      sources: [carrier.adapter],
      openSqlConnection: async (): Promise<SqlConnection> => {
        throw new Error('no worker in this environment');
      },
    });
    expect(dash.notes).toEqual(['data["cells"]: the "wasm" engine could not open a SQL connection to land "cells" in: no worker in this environment — every read of it is refused in those words']);
  });

  it('…and bytes that are not the declared table are refused BEFORE any engine receives them: the SQL connection is never opened', async () => {
    const carrier = movingSource({ rows: PDB_ROWS, version: 'v1' });
    let opens = 0;
    const dash = await buildDashboardAsync(sourced(DECLARED, 'wasm'), {
      sources: [carrier.adapter],
      openSqlConnection: async (): Promise<SqlConnection> => {
        opens += 1;
        throw new Error('never asked');
      },
    });
    expect(dash.notes).toEqual([`data["cells"]: ${REFUSAL}`]);
    expect(opens).toBe(0); // no bytes were handed to a backend, so no backend was opened
    expect(dash.engines['cells']).toBe('wasm'); // the def's routing, still reported
  });
});

describe('the refresh door: the second landing is judged too, and the rows in place never move for it', () => {
  it('a route that starts answering another table is refused, and yesterday\'s rows still answer', async () => {
    const carrier = movingSource({ rows: CELLS, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(DECLARED), { sources: [carrier.adapter] });
    carrier.move({ rows: PDB_ROWS, version: 'v2' });
    expect((await dash.refresh(['cells'])).tables['cells']).toEqual({ refused: true, reason: 'not-the-declared-table', message: `data["cells"]: ${REFUSAL}` });
    expect(dash.sources['cells']).toMatchObject({ version: 'v1', rows: 2 }); // the version held, unmoved
    expect(await readOf(dash)).toEqual({ ok: true, count: 2 });
    // …and the same route, mended, refreshes exactly as it always did
    carrier.move({ rows: [...CELLS, { state: 'Utah', cases: 9 }], version: 'v3' });
    expect((await dash.refresh(['cells'])).tables['cells']).toMatchObject({ changed: true, from: 'v1', to: 'v3', rows: 3 });
  });

  it('a table whose BUILD landing was refused is refused again in those words — never described as a table that declares no source', async () => {
    const carrier = movingSource({ rows: PDB_ROWS, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(DECLARED), { sources: [carrier.adapter] });
    expect((await dash.refresh(['cells'])).tables['cells']).toEqual({ refused: true, reason: 'not-the-declared-table', message: `data["cells"]: ${REFUSAL}` });
    // the table that declares no source at all still says its own sentence
    expect((await dash.refresh(['notes'])).tables['notes']).toEqual({ refused: true, reason: 'no-source', message: 'data["notes"] declares no source — inline rows never move' });
  });
});

describe('a refused landing is a note and a refused read — and never a THROW out of a lint door', () => {
  it('the table whose bytes were refused is the DEFAULT table: every lint door answers, and none throws', async () => {
    // The defect this pins, which predates act-filled tables: `lint()` and `lintProse()` threw
    // when the default table's provider could not list its columns, and a table whose landing
    // guard 2 refused is exactly such a provider — so a def the validator had just accepted threw
    // out of a door an author calls, losing every other table's report with it. That is the one
    // thing this build door's law forbids (`./wasmBackend.ts`, law 3): a landing that failed is a
    // SENTENCE and a REFUSED READ. The declaration is what the bindings are judged against
    // instead (`./buildDashboard.ts` · `columnsToJudge`) — the same evidence guard 2 itself used.
    const carrier = movingSource({ rows: PDB_ROWS, version: 'v1' });
    const def = {
      ...sourced(DECLARED),
      actors: { grid: { actor: 'user', label: 'Grid' } },
      encodings: [{ viewId: 'grid', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'cases' } }],
      prose: [{ viewId: 'grid', slots: { caption: { text: 'Cases by state', author: { kind: 'agent' as const, model: 'm' }, levels: ['trend' as const], basis: { columns: ['cases'] } } } }],
      defaultTable: 'cells',
    } as unknown as DashboardDef;
    const dash = await buildDashboardAsync(def, { sources: [carrier.adapter] });
    expect(dash.notes).toEqual([`data["cells"]: ${REFUSAL}`]); // the note, unchanged
    expect(await readOf(dash)).toEqual({ ok: false, reason: 'engine', engineReason: 'unknown-table', rejected: REFUSAL }); // the refused read, unchanged
    // …and the two doors answer: the binding and the basis name columns the DEF declares, so
    // there is nothing wrong to report about them
    expect(await dash.lint()).toEqual([]);
    expect(await dash.lintProse()).toEqual([]);
    // …while a basis naming a column the declaration does NOT have is still caught, from the
    // declaration alone
    const wrong = { ...def, prose: [{ viewId: 'grid', slots: { caption: { text: 'x', author: { kind: 'agent' as const, model: 'm' }, levels: ['trend' as const], basis: { columns: ['mystery'] } } } }] } as unknown as DashboardDef;
    const problems = await (await buildDashboardAsync(wrong, { sources: [movingSource({ rows: PDB_ROWS, version: 'v1' }).adapter] })).lintProse();
    expect(problems.map((p) => p.sentence)).toEqual(['"grid".caption names a column that is not on this branch: "mystery"']);
  });
});

describe('the verdict and the refusing provider, read directly', () => {
  it('a table with no source is not judged at all — the rule names the act that LANDS bytes, and inline is not one', () => {
    expect(notTheDeclaredTable('cells', { rows: CELLS, columns: DECLARED }, PDB_ROWS)).toBeUndefined();
    expect(notTheDeclaredTable('cells', { source: { format: 'csv', via: 'inline', at: 'a\n1\n' }, columns: DECLARED }, PDB_ROWS)).toBeUndefined();
    expect(notTheDeclaredTable('cells', { source: { format: 'csv', via: 'http', at: 'x' }, columns: DECLARED }, PDB_ROWS)).toBe(REFUSAL);
  });

  it('every door of the refusing provider answers the one sentence — and the one fact it has is that it holds no table', async () => {
    const provider = unlandedProvider('memory', REFUSAL);
    expect(provider.engine).toBe('memory');
    expect(provider.capabilities).toEqual({ canEvaluateSQL: false, canMaterialize: false });
    expect(await provider.tables()).toEqual([]);
    expect(await provider.columns('cells')).toEqual({ ok: false, engine: 'memory', operation: 'columns', reason: 'unknown-table', detail: REFUSAL });
    expect(await provider.evaluate('cells', null)).toMatchObject({ ok: false, operation: 'evaluate', reason: 'unknown-table', detail: REFUSAL });
    expect(await provider.materializeColumn('cells', 'per100k', [1])).toMatchObject({ ok: false, operation: 'materializeColumn', reason: 'unknown-table', detail: REFUSAL });
    // it re-lands nothing: the table never landed, so there is nothing to replace
    expect(provider.replaceRows).toBeUndefined();
    expect(provider.find).toBeUndefined();
  });
});
