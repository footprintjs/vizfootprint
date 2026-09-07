/**
 * The def door for `layers` — a view over more than one table. Every refusal
 * sentence, the two-layer fixture (nodes with a key + edges) building, each
 * layer's bindings judged against ITS table at the door and at `lint()`, the
 * frozen resolved layers on `ViewDecl`, and the pin that a view with no layers
 * is byte-identical to a view built before layers existed.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, validateDashboardDef, layerAddress } from './index.js';
import type { DashboardDef } from './index.js';
import { layerSurfaceOf, layerSurfacesOf } from './layers.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import { edgesLayer, makeNetworkDef, nodesLayer } from './network.fixture.js';

const at = (layers: unknown, extra: Partial<DashboardDef> = {}): string[] => validateDashboardDef({ ...makeNetworkDef(undefined, extra), encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers }] } as unknown);

describe('layers — the def door', () => {
  it('accepts the two-layer fixture and builds it', () => {
    expect(validateDashboardDef(makeNetworkDef())).toEqual([]);
    const dashboard = buildDashboard(makeNetworkDef());
    // the resolved layers are the declared list, frozen at build (the def is deep-frozen); `ViewDecl.layers` is that same list — `lint()` below walks it
    const layers = dashboard.def.encodings![0]!.layers!;
    expect(layers).toEqual([nodesLayer, edgesLayer]);
    expect(Object.isFrozen(layers)).toBe(true);
    expect(Object.isFrozen(layers[0])).toBe(true);
    expect(Object.isFrozen(layers[0]!.initial)).toBe(true);
    expect(dashboard.createSession()).toBeDefined();
  });

  it('refuses each malformed shape with its sentence', () => {
    expect(at('nodes')).toEqual(['encodings[0].layers, if present, must be an array of { layerId, table, chartKind, channels }']);
    expect(at(['nodes'])).toEqual(['encodings[0].layers[0] must be an object { layerId, table, chartKind, channels, initial?, label? }']);
    expect(at([{ ...nodesLayer, opacity: 0.5 }])).toEqual(['encodings[0].layers[0]: unknown key "opacity"']);
    expect(at([{ ...nodesLayer, layerId: '' }])).toEqual(['encodings[0].layers[0].layerId must be a non-empty string']);
    expect(at([{ ...nodesLayer, layerId: 7 }])).toEqual(['encodings[0].layers[0].layerId must be a non-empty string']);
    expect(at([{ ...nodesLayer, layerId: 'a~b' }])).toEqual(['encodings[0].layers[0].layerId "a~b" may not contain "~" — it is the layer marker']);
    expect(at([nodesLayer, { ...edgesLayer, layerId: 'nodes' }])).toEqual(['encodings[0].layers[1].layerId "nodes" repeats within view "net"']);
    expect(at([{ ...nodesLayer, table: '' }])).toEqual(['encodings[0].layers[0].table must be a non-empty string — a layer exists to name its table']);
    expect(at([{ ...nodesLayer, table: 'ghost' }])).toEqual(['encodings[0].layers[0].table "ghost" is not a declared data table — the tables are nodes, edges']);
    expect(at([{ ...nodesLayer, chartKind: '' }])).toEqual(['encodings[0].layers[0].chartKind must be a non-empty string']);
    expect(at([{ ...nodesLayer, channels: [] }])).toEqual(['encodings[0].layers[0].channels must be a non-empty array of non-empty strings']);
    expect(at([{ ...nodesLayer, channels: 'x' }])).toEqual(['encodings[0].layers[0].channels must be a non-empty array of non-empty strings']);
    expect(at([{ ...nodesLayer, channels: ['x', ''] }])).toEqual(['encodings[0].layers[0].channels must be a non-empty array of non-empty strings']);
    expect(at([{ ...nodesLayer, initial: 'size' }])).toEqual(['encodings[0].layers[0].initial, if present, must be an object mapping channel -> field (strings)']);
    expect(at([{ ...nodesLayer, initial: { size: 3 } }])).toEqual(['encodings[0].layers[0].initial, if present, must be an object mapping channel -> field (strings)']);
    expect(at([{ ...nodesLayer, label: 3 }])).toEqual(['encodings[0].layers[0].label, if present, must be a string']);
    // a layer with no initial and no label is whole
    expect(at([{ layerId: 'n', table: 'nodes', chartKind: 'point', channels: ['x'] }])).toEqual([]);
  });

  it('a table refused on its own line is not refused again through a layer', () => {
    const problems = validateDashboardDef({ ...makeNetworkDef(), data: {} } as unknown);
    expect(problems).toContain('data must declare at least one table');
    expect(problems.some((p) => p.includes('layers[0].table'))).toBe(false);
    const malformed = validateDashboardDef({ ...makeNetworkDef(), data: 'nodes' } as unknown);
    expect(malformed.some((p) => p.includes('layers[0].table'))).toBe(false);
    // a declared-but-malformed table: refused on its own line; the layer on it is not judged at the build door
    const def = makeNetworkDef();
    const brokenTable = validateDashboardDef({ ...def, data: { ...def.data, edges: 1 } } as unknown);
    expect(brokenTable).toEqual(['data["edges"] must be an object { rows | csv, engine? }']);
    // a view whose id is not a string is refused on its own line; its layers are still judged, and the repeat sentence spells the id it was given
    const numericView = validateDashboardDef({ ...def, encodings: [{ viewId: 7, chartKind: 'network', channels: ['x'], layers: [nodesLayer, nodesLayer] }] } as unknown);
    expect(numericView).toEqual(['encodings[0].viewId must be a non-empty string', 'encodings[0].layers[1].layerId "nodes" repeats within view "7"']);
  });

  it('a view id and a table name may not wear the marker', () => {
    const view = validateDashboardDef({ ...makeDashboardDef(), actors: { ...makeDashboardDef().actors, 'net~nodes': { actor: 'user' } } } as unknown);
    expect(view).toEqual(['actors["net~nodes"]: a view id "net~nodes" may not contain "~" — it is the layer marker']);
    const table = validateDashboardDef({ ...makeDashboardDef(), data: { ...makeDashboardDef().data, 'a~b': { rows: [] } } } as unknown);
    expect(table).toEqual(['data["a~b"]: a table name "a~b" may not contain "~" — it is the layer marker']);
    // a malformed table wearing the marker is refused for both, in that order
    const both = validateDashboardDef({ ...makeDashboardDef(), data: { ...makeDashboardDef().data, 'a~b': 1 } } as unknown);
    expect(both).toEqual(['data["a~b"]: a table name "a~b" may not contain "~" — it is the layer marker', 'data["a~b"] must be an object { rows | csv, engine? }']);
  });

  it("each layer's initial bindings are judged against ITS table, never the default table", () => {
    // the door knows a column by what the def DECLARES about it — `id` is the nodes table's identifier,
    // so on the nodes layer it cannot be a magnitude…
    expect(at([{ ...nodesLayer, initial: { size: 'id' } }, edgesLayer])).toEqual(['encodings[0].layers[0].initial.size: "id" is identifier — it cannot be the size of a point']);
    // …while on the edges layer the same field is a column the def says nothing about (columns are the
    // provider's: `lint()` refuses it below) — the verdict comes from the LAYER's table, not the default one
    expect(at([nodesLayer, { ...edgesLayer, initial: { size: 'id' } }])).toEqual([]);
    // the def's business rules reach a layer too, in the layer's own sentence slot
    const ruled = at([nodesLayer, edgesLayer], { encodingRules: { rules: [{ rule: 'never-on', column: 'weight', channels: ['size'] }] } });
    expect(ruled).toEqual(['encodings[0].layers[1].initial.size: "weight" never binds to size']);
    // and a view-level binding is still judged against the default table exactly as before
    const viewLevel = validateDashboardDef({ ...makeNetworkDef(), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y', 'size'], initial: { size: 'id' }, layers: [edgesLayer] }] } as unknown);
    expect(viewLevel).toEqual(['encodings[0].initial.size: "id" is identifier — it cannot be the size of a point']);
  });

  it('a dashboard-scope rule reads the whole page — every view and every layer, across the frame boundary', () => {
    // `size` on the nodes layer and `weight` on the edges layer are two bindings on ONE page: a never-together
    // pair may not hide in the boundary between two layers of the same frame (each side reports on its own binding)
    const pair = { encodingRules: { rules: [{ rule: 'never-together', columns: ['size', 'weight'] }] } } as Partial<DashboardDef>;
    expect(at([nodesLayer, edgesLayer], pair)).toEqual([
      'encodings[0].layers[0].initial.size: "size" and "weight" never share the page',
      'encodings[0].layers[1].initial.size: "weight" and "size" never share the page',
    ]);
    // …nor in the boundary between a view's OWN binding and one of its layers'
    const viewAndLayer = validateDashboardDef({ ...makeNetworkDef(undefined, pair), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y', 'size'], initial: { size: 'size' }, layers: [edgesLayer] }] } as unknown);
    expect(viewAndLayer).toEqual([
      'encodings[0].initial.size: "size" and "weight" never share the page',
      'encodings[0].layers[0].initial.size: "weight" and "size" never share the page',
    ]);
    // a `view`-scope rule still means THIS surface alone — a sibling layer is not "here"
    expect(at([nodesLayer, edgesLayer], { encodingRules: { rules: [{ rule: 'never-together', columns: ['size', 'weight'], scope: 'view' }] } } as Partial<DashboardDef>)).toEqual([]);
    // the page cuts both ways: an `only-with` companion bound on a SIBLING layer is on the page…
    const onlyWith = { encodingRules: { rules: [{ rule: 'only-with', column: 'weight', companion: 'group', scope: 'dashboard' }] } } as Partial<DashboardDef>;
    expect(at([nodesLayer, edgesLayer], onlyWith)).toEqual([]);
    // …and refused only where it is nowhere on it
    expect(at([{ ...nodesLayer, initial: { size: 'size' } }, edgesLayer], onlyWith)).toEqual([
      'encodings[0].layers[1].initial.size: "weight" is only meaningful while "group" is on the page — bind "group" first',
    ]);
  });

  it('lint() judges each layer against the columns its own table lists, under the layer address', async () => {
    expect(await buildDashboard(makeNetworkDef()).lint()).toEqual([]);
    const problems = await buildDashboard(makeNetworkDef([{ ...nodesLayer, initial: { size: 'weight' } }, edgesLayer])).lint();
    expect(problems).toHaveLength(1);
    expect(problems[0]!.viewId).toBe(layerAddress('net', 'nodes'));
    expect(problems[0]!.channel).toBe('size');
    expect(problems[0]!.field).toBe('weight');
  });

  it('lint() refuses a layer whose table cannot list its columns, in the same sentence as the default table', async () => {
    // a stub engine on the EDGES table only: the default table lists its columns, the layer's cannot
    const def = makeNetworkDef();
    const stubbed: DashboardDef = { ...def, data: { ...def.data, edges: { ...def.data.edges!, engine: 'wasm' } } };
    await expect(buildDashboard(stubbed, { availableEngines: ['memory', 'wasm'] }).lint()).rejects.toThrow(/^lint: the "edges" provider cannot list its columns — /);
  });

  it('the surfaces the build door judges — one per well-formed layer on a declared table, under its address', () => {
    const data = makeNetworkDef().data as unknown as Record<string, unknown>;
    expect(layerSurfacesOf([{ viewId: 'net', layers: [nodesLayer, { ...edgesLayer, table: 'ghost' }, 'junk', { ...edgesLayer, initial: 4 }] }], data)).toEqual([
      { index: 0, at: 0, table: 'nodes', surface: { viewId: 'net~nodes', chartKind: 'point', channels: ['x', 'y', 'size', 'color'], initial: { size: 'size', color: 'group' } } },
    ]);
    expect(layerSurfacesOf([{ viewId: 'net' }, 'junk', { viewId: '', layers: [nodesLayer] }], data)).toEqual([]);
    // every way a layer can fall short of well-formed is skipped, never judged
    const short = [
      { ...nodesLayer, layerId: '' },
      { ...nodesLayer, table: '' },
      { ...nodesLayer, chartKind: '' },
      { ...nodesLayer, channels: 'x' },
      { ...nodesLayer, channels: [] },
      { ...nodesLayer, channels: [1] },
      { ...nodesLayer, initial: 'x' },
      { ...nodesLayer, initial: { size: 1 } },
    ];
    expect(layerSurfacesOf([{ viewId: 'net', layers: short }], data)).toEqual([]);
    const { layerId: _id, table: _t, ...rest } = edgesLayer;
    expect(layerSurfaceOf('net', { layerId: 'e', table: 'edges', chartKind: rest.chartKind, channels: rest.channels })).toEqual({ viewId: 'net~e', chartKind: 'line', channels: ['x', 'y', 'size'] });
  });

  it('a view with no layers is byte-identical to a view built before layers existed', async () => {
    const before = buildDashboard(makeDashboardDef());
    expect(JSON.stringify(before.def)).not.toContain('layers');
    // the overview (a projection of every ViewDecl) shows no trace of the key; the door says nothing new
    expect(JSON.stringify(await before.createSession().overview())).not.toContain('layers');
    expect(await before.lint()).toEqual([]);
    expect(validateDashboardDef(makeDashboardDef())).toEqual([]);
  });
});
