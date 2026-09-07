/**
 * THE HOST'S OWN ENGINE IS A PUBLIC DOOR — so what it answers reaches every
 * reader that reads a provider.
 *
 * `options.providers` accepts anything that answers the port, which makes two
 * things reachable that the three engines this package builds never produce:
 * a rejection carrying NO `detail` (`detail` is optional on
 * `DataProviderRejection`, and `reject()` omits it when none is passed), and a
 * value missing a member of the port that is not one of the four methods.
 * These tests hold the lint doors' `?? cols.reason` fallback and the build
 * door's judging of `capabilities` — plus the two host options the def cannot
 * carry: an EMPTY `availableEngines`, and a refresh asked for a name nobody
 * declared or asked for twice.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, buildDashboardAsync } from './index.js';
import { reject, type DataProvider, type ResolvedEngine } from '../data/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from '../session/dashboard.fixture.js';
import type { DashboardDef } from './index.js';

/** A host engine that refuses every read in the fewest words there are: a reason, and no detail. */
const bareRefuser = (engine: ResolvedEngine = 'memory'): DataProvider => ({
  engine,
  capabilities: { canEvaluateSQL: false, canMaterialize: false },
  tables: async () => [],
  columns: async () => reject(engine, 'columns', 'unknown-table'),
  evaluate: async () => reject(engine, 'evaluate', 'unknown-table'),
  materializeColumn: async () => reject(engine, 'materializeColumn', 'unknown-table'),
});

const CELLS = [{ disease: 'A', cases: 3 }, { disease: 'B', cases: 5 }];
const NODES = [{ disease: 'A', x: 0, y: 0 }, { disease: 'B', x: 1, y: 1 }];
const EDGES = [{ source: 'A', target: 'B' }];

/** Three tables: the default one answers, and the other two are reached only through a relation and a layer. */
const layeredDef = (): DashboardDef => ({
  data: {
    cells: { rows: CELLS, columns: { disease: { role: 'dimension' }, cases: { role: 'measure' } } },
    nodes: { rows: NODES, key: 'disease', columns: { disease: { role: 'identifier' }, x: { role: 'measure' }, y: { role: 'measure' } } },
    edges: { rows: EDGES, columns: { source: { role: 'dimension' }, target: { role: 'dimension' } } },
  },
  actors: { net: { actor: 'user' } },
  encodings: [
    {
      viewId: 'net',
      chartKind: 'network',
      channels: ['x', 'y'],
      layers: [{ layerId: 'nodes', table: 'nodes', chartKind: 'network', channels: ['x', 'y', 'key'], initial: { x: 'x', y: 'y', key: 'disease' } }],
    },
  ],
  relations: [{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'disease' } }],
  defaultTable: 'cells',
});

describe('a rejection with no `detail` still says something at every lint door', () => {
  const keyed = (): DashboardDef => ({ ...makeDashboardDef(), data: { data: { rows: SAMPLE_ROWS, key: 'id' } } });

  it('lint() and lintProse() fall back to the REASON — never "undefined" where a sentence belongs', async () => {
    const dash = buildDashboard(makeDashboardDef(), { providers: { data: bareRefuser() } });
    await expect(dash.lint()).rejects.toThrow('lint: the "data" provider cannot list its columns — unknown-table');
    await expect(dash.lintProse()).rejects.toThrow('lintProse: the "data" provider cannot list its columns — unknown-table');
  });

  it('lintData() says it for a key it cannot judge, and for a relation\'s source column', async () => {
    const keyProblem = await buildDashboard(keyed(), { providers: { data: bareRefuser() } }).lintData();
    expect(keyProblem).toEqual(['data["data"].key "id": the engine cannot list this table\'s columns — unknown-table']);
    const both = await buildDashboard(layeredDef(), { providers: { nodes: bareRefuser(), edges: bareRefuser() } }).lintData();
    expect(both).toEqual([
      'data["nodes"].key "disease": the engine cannot list this table\'s columns — unknown-table',
      'relations[0].from.column "source": the engine cannot list this table\'s columns — unknown-table',
    ]);
  });

  it('a LAYER\'s table is reached after the default table answered, and says it too', async () => {
    const dash = buildDashboard(layeredDef(), { providers: { nodes: bareRefuser() } });
    await expect(dash.lint()).rejects.toThrow('lint: the "nodes" provider cannot list its columns — unknown-table');
  });
});

describe('the build door judges the whole port, not four of its six members', () => {
  it('a provider that declares no capabilities is refused in a sentence — the session reads them before a sorted window', () => {
    const { capabilities: _dropped, ...noCaps } = bareRefuser();
    expect(() => buildDashboard(makeDashboardDef(), { providers: { data: noCaps as unknown as DataProvider } })).toThrow(
      /providers\["data"\] declares no capabilities — a DataProvider says what it can do \(canEvaluateSQL, canMaterialize, canSort\), and the session reads it before every sorted window/,
    );
    const nulled = { ...bareRefuser(), capabilities: null };
    expect(() => buildDashboard(makeDashboardDef(), { providers: { data: nulled as unknown as DataProvider } })).toThrow(/declares no capabilities/);
  });

  it('naming NO engine is refused at the door, not as a RangeError from a module the caller never called', async () => {
    const said = /availableEngines is \[\] — name at least one engine \(memory, wasm, server\), or omit it to mean memory/;
    expect(() => buildDashboard(makeDashboardDef({ engine: 'auto' }), { availableEngines: [] })).toThrow(said);
    // …on a def with no `auto` table too: the option is judged, never the table that happens to read it
    expect(() => buildDashboard(makeDashboardDef(), { availableEngines: [] })).toThrow(said);
    await expect(buildDashboardAsync(makeDashboardDef({ engine: 'auto' }), { availableEngines: [] })).rejects.toThrow(said);
  });
});

describe('refresh answers the tables that were ASKED for — once each, and only the declared ones', () => {
  const inlineDef = (): DashboardDef => ({ ...makeDashboardDef(), data: { data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS } } } });

  it('a name every object carries is not a declared table — at either door', async () => {
    const sync = await buildDashboard(makeDashboardDef()).refresh(['toString']);
    expect(sync.tables['toString']).toEqual({ refused: true, reason: 'no-source', message: 'no table "toString" is declared — the tables are data' });
    const async_ = await (await buildDashboardAsync(inlineDef())).refresh(['constructor']);
    expect(async_.tables['constructor']).toMatchObject({ refused: true, reason: 'no-source', message: 'no table "constructor" is declared — the tables are data' });
  });

  it('a name asked for twice is answered once — the journal says what was asked, deduped', async () => {
    const sync = buildDashboard(makeDashboardDef());
    await sync.refresh(['data', 'data']);
    expect(sync.journal().at(-1)!.asked).toEqual(['data']);
    const dash = await buildDashboardAsync(inlineDef());
    await dash.refresh(['data', 'data']);
    expect(dash.journal().at(-1)!.asked).toEqual(['data']);
  });
});
