/**
 * landedColumns.def.test.ts — THE BUILD WRITES WHAT THE ENGINE LANDED, ONCE PER
 * LANDING (`./buildDashboard.ts` · `learnLanded`, and the refresh door).
 *
 * What is pinned here is WHO writes the registry (`../data/landedColumns.ts`)
 * and WHEN: each door once per table at build, the refresh door once per
 * re-land — and what does NOT write it: a provider that refuses or throws, an
 * `unchanged` refresh, a refused re-land, and the sync door's LAZY wasm table
 * (nothing landed, so nothing is claimed — and asking would have opened the
 * connection the door says it does not open). The registry's own law is
 * `../data/landedColumns.test.ts`; who READS it is
 * `../session/landedColumns.session.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync } from './index.js';
import type { Dashboard } from './buildDashboard.js';
import type { DashboardDef, DashboardRuntime, SourceAdapter } from './index.js';
import { memoryProvider, reject, type ColumnInfo, type DataProvider, type LandedColumns } from '../data/index.js';
import { fakeSqlBackend } from '../data/sqlConnection.coverage.helpers.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

const CASES: readonly Record<string, unknown>[] = [
  { week: 1, disease: 'Lyme' },
  { week: 2, disease: 'Lyme' },
  { week: 3, disease: 'Zika' },
];

/** The smallest def that can hold tables and open a session: one actor, nothing else. */
function defWith(data: DashboardDef['data']): DashboardDef {
  return { meta: { title: 'cases' }, data, actors: { grid: { actor: 'user', label: 'Grid' } } } as DashboardDef;
}

/** The registry, read the way the session reads it — through the runtime the build handed the session (the precedent: `../session/reach.session.test.ts`). */
const landedOf = (dash: Dashboard): LandedColumns => (dash.createSession() as unknown as { runtime: DashboardRuntime }).runtime.landedColumns;

/** The sync door SCHEDULES its learning (it cannot await) — one turn of the microtask queue is what it needs. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A host engine over real rows that COUNTS how often it was asked to describe its table. */
function countingProvider(rows: readonly Record<string, unknown>[]): { readonly provider: DataProvider; readonly asked: () => number } {
  const inner = memoryProvider(rows, { tableName: 'cases' });
  let asked = 0;
  return {
    provider: {
      ...inner,
      columns: async (table) => {
        asked += 1;
        return inner.columns(table);
      },
    },
    asked: () => asked,
  };
}

/** A carrier whose rows and version the test moves between snapshots — the refresh door's twin fixture (`./wasmEngine.def.test.ts`). */
function movingSource(initial: { rows: readonly Record<string, unknown>[]; version: string }): { readonly adapter: SourceAdapter; move(next: { rows: readonly Record<string, unknown>[]; version: string }): void } {
  let current = initial;
  return {
    adapter: {
      via: 'http',
      open: async () => ({ capabilities: { live: false, pushdown: false as const }, snapshot: async () => ({ rows: [...current.rows], version: current.version, retrievedAt: 'now' }), close: async () => {} }),
    },
    move: (next) => {
      current = next;
    },
  };
}

const sourced = (): DashboardDef => defWith({ cases: { source: { format: 'rows', via: 'http', at: 'https://example.test/cases' }, key: 'week' } } as DashboardDef['data']);

describe('the sync door: one entry per table it landed, learned on the next turn', () => {
  it('a bare `rows` table (no `columns` declared) is learned exactly as a declared one — the registry records landings, not promises', async () => {
    const dash = buildDashboard(defWith({ cases: { rows: CASES }, notes: { rows: [{ id: 'a', body: 'first' }], columns: { id: { role: 'identifier' }, body: { role: 'dimension' } } } }));
    await settled();
    const landed = landedOf(dash);
    expect(landed.get('cases')).toEqual({ columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }] });
    expect(landed.get('notes')).toEqual({ columns: [{ name: 'id', type: 'string' }, { name: 'body', type: 'string' }] });
    // inline rows never move, so nothing versions them — the key is ABSENT, never a placeholder
    expect('version' in landed.get('cases')!).toBe(false);
  });

  it('a host provider is asked ONCE at build — and a second session on the same dashboard reads the same landing, not a second call', async () => {
    const host = countingProvider(CASES);
    const dash = buildDashboard(defWith({ cases: { rows: [] } }), { providers: { cases: host.provider } });
    await settled();
    expect(host.asked()).toBe(1);
    expect(landedOf(dash).get('cases')?.columns.map((c) => c.name)).toEqual(['week', 'disease']);
    expect(landedOf(dash).get('cases')?.columns.map((c) => c.name)).toEqual(['week', 'disease']);
    expect(host.asked()).toBe(1); // reading the registry is not asking the engine
  });

  it('a provider that REFUSES to describe its table writes nothing — absent, never invented — and the build does not throw', async () => {
    const refuser: DataProvider = {
      engine: 'memory',
      capabilities: { canEvaluateSQL: false, canMaterialize: false },
      tables: async () => [],
      columns: async () => reject('memory', 'columns', 'unknown-table'),
      evaluate: async () => reject('memory', 'evaluate', 'unknown-table'),
      materializeColumn: async () => reject('memory', 'materializeColumn', 'unknown-table'),
    };
    const dash = buildDashboard(makeDashboardDef(), { providers: { data: refuser } });
    await settled();
    expect(landedOf(dash).get('data')).toBeUndefined();
  });

  it('a provider that THROWS on `columns()` writes nothing either — the throw is heard at the first read, never as an unhandled rejection at build', async () => {
    const thrower: DataProvider = {
      engine: 'memory',
      capabilities: { canEvaluateSQL: false, canMaterialize: false },
      tables: async () => [],
      columns: async () => {
        throw new Error('describe is broken');
      },
      evaluate: async () => reject('memory', 'evaluate', 'unknown-table'),
      materializeColumn: async () => reject('memory', 'materializeColumn', 'unknown-table'),
    };
    const dash = buildDashboard(makeDashboardDef(), { providers: { data: thrower } });
    await settled();
    expect(landedOf(dash).get('data')).toBeUndefined();
    // …and the async door swallows the same throw for the same reason: the build returns, the read reports
    const viaAsync = await buildDashboardAsync(makeDashboardDef(), { providers: { data: thrower } });
    expect(landedOf(viaAsync).get('data')).toBeUndefined();
    // "the read reports it" means exactly that: a provider that throws is a genuinely broken provider (the port
    // contracts a REJECTION, never a throw, for an ordinary refusal — `reject()` above), so the FIRST live read
    // against it throws again, in the engine's own words — never silently swallowed a second time, and never a
    // graceful `ReadRefusal` standing in for a bug this registry cannot fix
    await expect(dash.createSession().overview()).rejects.toThrow('describe is broken');
  });

  it('a LAZY wasm table is not asked: nothing landed, the entry is absent, and the connection is still unopened', async () => {
    const backend = fakeSqlBackend();
    let opens = 0;
    const dash = buildDashboard(defWith({ cases: { rows: CASES, engine: 'wasm' }, notes: { rows: [{ id: 'a', body: 'first' }] } }), {
      openSqlConnection: async () => {
        opens += 1;
        return backend;
      },
    });
    await settled();
    const landed = landedOf(dash);
    expect(landed.get('cases')).toBeUndefined(); // the first read pays for the landing; this build did not make that read
    expect(landed.get('notes')?.columns.map((c) => c.name)).toEqual(['id', 'body']); // the memory table beside it landed at the door
    expect(opens).toBe(0);
    expect(backend.landed).toEqual([]);
  });

  it('…but a lazy landing is STILL a landing (AK review target 1): once a read pays for it, this door learns it too — `WasmBackend.whenLanded`, never a fallback in the session that re-creates a second knowledge', async () => {
    const backend = fakeSqlBackend();
    const dash = buildDashboard(defWith({ cases: { rows: CASES, engine: 'wasm' }, notes: { rows: [{ id: 'a', body: 'first' }] } }), { openSqlConnection: async () => backend });
    await settled();
    const landed = landedOf(dash);
    expect(landed.get('cases')).toBeUndefined(); // still nothing — nobody has read `cases` yet
    await dash.createSession().overview(); // the first read: pays for the lazy landing (`../session/session.ts` · `effectiveColumnsOf`)
    expect(landed.get('cases')).toEqual({ columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }] });
    expect('version' in landed.get('cases')!).toBe(false); // inline rows never move — no version, even though the wasm engine did the landing
  });
});

describe('the async door: learned after every table landed, beside the version the carrier vouched for', () => {
  it('a sourced table carries its version; an inline one carries the inline version the build minted', async () => {
    const carrier = movingSource({ rows: CASES, version: 'v1' });
    const dash = await buildDashboardAsync(defWith({ ...sourced().data, notes: { rows: [{ id: 'a', body: 'first' }] } } as DashboardDef['data']), { sources: [carrier.adapter] });
    const landed = landedOf(dash);
    expect(landed.get('cases')).toEqual({ version: 'v1', columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }] });
    expect(landed.get('cases')?.version).toBe(dash.sources['cases']?.version); // the same fact as the provenance beside it
    expect(landed.get('notes')).toEqual({ columns: [{ name: 'id', type: 'string' }, { name: 'body', type: 'string' }] });
  });

  it('memory and wasm land the SAME columns into the registry for one def — the engine never changes what a judge knows', async () => {
    // the D24 invariant one level up (`../data/engineInvariant.test.ts`): the same rows, the two engines that run —
    // no opener passed, so the wasm table lands in the DuckDB bundle node ships, the shipped default
    const asMemory = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'memory' } }));
    const asWasm = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'wasm' } }));
    try {
      expect(asWasm.notes).toEqual([]); // it landed — a failed landing would have written nothing, and this test would pin nothing
      expect(landedOf(asWasm).get('cases')).toEqual(landedOf(asMemory).get('cases'));
      expect(landedOf(asMemory).get('cases')?.columns).toEqual([{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }]);
    } finally {
      await asWasm.close();
    }
  });

  it('a wasm table whose landing FAILED writes nothing — the note says why, the read refuses, the judge stays def-only', async () => {
    const dash = await buildDashboardAsync(defWith({ cases: { rows: CASES, engine: 'wasm' } }), {
      openSqlConnection: async () => {
        throw new Error('no worker in this environment');
      },
    });
    expect(dash.notes[0]).toContain('could not open a SQL connection');
    expect(landedOf(dash).get('cases')).toBeUndefined();
  });
});

describe('the refresh door: a re-land rewrites the entry whole; anything that moved nothing leaves it', () => {
  it('a CHANGED refresh writes the new version and the schema the engine answered with the delta — a column added is now known, one dropped is gone', async () => {
    const carrier = movingSource({ rows: CASES, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(), { sources: [carrier.adapter] });
    const landed = landedOf(dash);
    expect(landed.get('cases')).toEqual({ version: 'v1', columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }] });
    const before = landed.get('cases');

    carrier.move({ rows: [{ week: 1, disease: 'Lyme', severity: 'mild' }, { week: 2, disease: 'Zika', severity: 'severe' }], version: 'v2' });
    expect((await dash.refresh(['cases'])).tables['cases']).toMatchObject({ changed: true, from: 'v1', to: 'v2' });
    expect(landed.get('cases')).toEqual({ version: 'v2', columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }, { name: 'severity', type: 'string' }] });
    expect(dash.sources['cases']?.version).toBe('v2');
    // the OLD record a reader may still hold is untouched — frozen, and replaced rather than edited
    expect(before).toEqual({ version: 'v1', columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }] });

    carrier.move({ rows: [{ week: 1 }], version: 'v3' }); // `disease` and `severity` are gone in v3
    expect((await dash.refresh(['cases'])).tables['cases']).toMatchObject({ changed: true, to: 'v3' });
    expect(landed.get('cases')).toEqual({ version: 'v3', columns: [{ name: 'week', type: 'number' }] });
  });

  it('an UNCHANGED refresh leaves the entry exactly as it was — the same object', async () => {
    const carrier = movingSource({ rows: CASES, version: 'v1' });
    const dash = await buildDashboardAsync(sourced(), { sources: [carrier.adapter] });
    const before = landedOf(dash).get('cases');
    expect((await dash.refresh(['cases'])).tables['cases']).toEqual({ unchanged: true, version: 'v1' });
    expect(landedOf(dash).get('cases')).toBe(before);
  });

  it('a re-land the ENGINE refused leaves the entry: nothing moved, so nothing was learned', async () => {
    const carrier = movingSource({ rows: CASES, version: 'v1' });
    // the wasm engine over a fake backend that is not a SQL engine: it lands, but cannot answer the reland delta,
    // so the re-land is refused in the engine's words (`./wasmEngine.def.test.ts`, "a backend that refuses the act")
    const backend = fakeSqlBackend();
    const def = defWith({ cases: { source: { format: 'rows', via: 'http', at: 'https://example.test/cases' }, engine: 'wasm', key: 'week' } } as DashboardDef['data']);
    const dash = await buildDashboardAsync(def, { sources: [carrier.adapter], openSqlConnection: async () => backend });
    const before = landedOf(dash).get('cases');
    carrier.move({ rows: [{ week: 1, disease: 'Lyme', severity: 'mild' }], version: 'v2' });
    const answer = (await dash.refresh(['cases'])).tables['cases'];
    expect(answer).toMatchObject({ refused: true, reason: 'not-reloadable' });
    expect(landedOf(dash).get('cases')).toBe(before); // whatever the fake could describe at build is what is still held — nothing was rewritten
    expect(dash.sources['cases']?.version).toBe('v1');
  });

  it('a sync dashboard (inline rows never move) journals `unchanged` and the entry it learned at the door stays', async () => {
    const dash = buildDashboard(defWith({ cases: { rows: CASES } }));
    await settled();
    const before = landedOf(dash).get('cases');
    expect(before).toBeDefined();
    await dash.refresh(['cases']);
    expect(landedOf(dash).get('cases')).toBe(before);
  });
});

describe('what a reader holds', () => {
  it('is frozen, and never the engine’s own objects: the provider’s next `columns()` answer is a fresh list either way', async () => {
    const dash = buildDashboard(defWith({ cases: { rows: CASES } }));
    await settled();
    const entry = landedOf(dash).get('cases')!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.columns)).toBe(true);
    expect(() => (entry.columns as ColumnInfo[]).push({ name: 'forged', type: 'string' })).toThrow(TypeError);
  });
});
