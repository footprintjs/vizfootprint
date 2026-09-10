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

describe('lintFrames — the frame’s own advice, on a row of its own kind', () => {
  it('a view stacking more than four layers earns a NOTE under its own name; a two-layer view earns none, and no view is refused', () => {
    expect(buildDashboard(makeNetworkDef()).lintFrames()).toEqual([]); // the two-layer fixture reads fine
    const many = Array.from({ length: 5 }, (_, i) => ({ ...nodesLayer, layerId: `l${String(i)}` }));
    const def = { ...makeNetworkDef(), encodings: [{ viewId: 'net', chartKind: 'network' as const, channels: ['x', 'y'], layers: many }] };
    // a lint is never a refusal: the def still builds, and the note names the view and what to move
    expect(validateDashboardDef(def)).toEqual([]);
    expect(buildDashboard(def).lintFrames()).toEqual([
      { viewId: 'net', sentence: '5 layers on one frame — past 4 a reader cannot tell the marks apart; consider a frame of its own for "l4"' },
    ]);
  });

  it('a dashboard whose views declare no layers has no frames to lint', () => {
    expect(buildDashboard(makeDashboardDef()).lintFrames()).toEqual([]);
  });
});

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
    // …and it cannot list them because the connection never opens: the wasm engine itself
    // answers fine where a DuckDB can be opened, which is not what this law is about
    const cannotOpen = { availableEngines: ['memory' as const, 'wasm' as const], openSqlConnection: () => Promise.reject(new Error('no database in this test')) };
    await expect(buildDashboard(stubbed, cannotOpen).lint()).rejects.toThrow(/^lint: the "edges" provider cannot list its columns — /);
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

/** A def whose one view carries `layers` AND a `frame` — the two halves the frame's laws judge together. */
const framed = (frame: unknown, layers: readonly unknown[] = [nodesLayer, edgesLayer], extra: Partial<DashboardDef> = {}): string[] =>
  validateDashboardDef({ ...makeNetworkDef(undefined, extra), encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers, frame }] } as unknown);

/**
 * The two-table def with the COLUMN facts a frame law reads laid over it — a
 * type, a role, a scale, a unit. One column at a time: the named columns are
 * REPLACED whole (so a role can be dropped) and the rest of each table's
 * declarations stand, which is what keeps the nodes table's declared key real.
 */
const facts = (nodes: Record<string, unknown>, edges: Record<string, unknown>): Partial<DashboardDef> => {
  const def = makeNetworkDef();
  return {
    data: {
      nodes: { ...def.data.nodes!, columns: { ...def.data.nodes!.columns, ...nodes } },
      edges: { ...def.data.edges!, columns: { ...def.data.edges!.columns, ...edges } },
    },
  } as Partial<DashboardDef>;
};

/**
 * Two POINT layers sharing x, one per table. WHY `point` and WHY x: its x
 * accepts a number AND a date, so the columns below can disagree about the
 * frame's law without ALSO tripping the channel requirement — one law per test.
 */
const onX = (layerId: string, table: string, field: string) => ({ layerId, table, chartKind: 'point', channels: ['x', 'y'], initial: { x: field } });
const sharesX = [onX('a', 'nodes', 'size'), onX('b', 'edges', 'weight')];

/** A bar layer over the nodes table with no bindings — the shape the zero-anchored laws are about, with nothing else to judge. */
const barLayer = { layerId: 'counts', table: 'nodes', chartKind: 'bar', channels: ['x', 'y'] };

describe('the frame — per channel, how its scale is resolved across the layers', () => {
  it('the fixture accepts a frame, and a frame is optional', () => {
    expect(framed(undefined)).toEqual([]);
    expect(framed({ size: { mode: 'shared', domain: 'union', basis: 'rows', guide: 'per-layer', zero: true } })).toEqual([]);
    expect(framed({ color: { mode: 'independent', guide: 'per-layer' } })).toEqual([]);
    // a channel with NO entry is shared/union/table/merged — the Wickham default, and it refuses nothing on this fixture
    expect(framed({})).toEqual([]);
  });

  it('LAW 7: a frame declares resolution for LAYERS — a plain view has none', () => {
    expect(framed({ y: { mode: 'shared' } }, [])).toEqual(['encodings[0].frame declares resolution for layers; view "net" has none']);
    // no `layers` key at all — the same sentence, and the frame's other laws are not restated beside it
    expect(validateDashboardDef({ ...makeNetworkDef(undefined), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y'], frame: { y: { mode: 'independent' } } }] } as unknown)).toEqual([
      'encodings[0].frame declares resolution for layers; view "net" has none',
    ]);
    // a layer list that is entirely malformed was refused layer by layer; the frame does not pile on
    expect(framed({ y: { mode: 'shared' } }, ['junk'])).toEqual([
      'encodings[0].layers[0] must be an object { layerId, table, chartKind, channels, initial?, label? }',
      'encodings[0].frame declares resolution for layers; view "net" has none',
    ]);
  });

  it('LAW 7: the shape — a mode from the two words, and only the keys that mode has', () => {
    expect(framed('shared')).toEqual(['encodings[0].frame, if present, must be an object mapping channel -> { mode: "shared" | "independent" }']);
    expect(framed({ y: 'shared' })).toEqual(['encodings[0].frame.y must be an object { mode: "shared" | "independent", domain?, basis?, guide?, zero? }']);
    expect(framed({ y: {} })).toEqual(['encodings[0].frame.y.mode must be "shared" or "independent"']);
    expect(framed({ y: { mode: 'fixed' } })).toEqual(['encodings[0].frame.y.mode must be "shared" or "independent"']);
    expect(framed({ y: { mode: 'shared', zeroed: true } })).toEqual(['encodings[0].frame.y: unknown key "zeroed" on a shared channel']);
    // an independent channel has no domain, no basis and no zero policy: there is nothing folded to apply them to
    expect(framed({ color: { mode: 'independent', basis: 'rows', zero: true } })).toEqual([
      'encodings[0].frame.color: unknown key "basis" on an independent channel',
      'encodings[0].frame.color: unknown key "zero" on an independent channel',
    ]);
    expect(framed({ color: { mode: 'independent', guide: 'merged' } })).toEqual([
      'encodings[0].frame.color.guide must be "per-layer" on an independent channel — there is no merged guide for scales that disagree',
    ]);
    expect(framed({ y: { mode: 'shared', domain: [0, 10] } })).toEqual(['encodings[0].frame.y.domain, if present, must be "union" — a frame declares a fold, never numbers']);
    expect(framed({ y: { mode: 'shared', basis: 'whole' } })).toEqual(['encodings[0].frame.y.basis, if present, must be "table" or "rows"']);
    expect(framed({ y: { mode: 'shared', guide: 'once' } })).toEqual(['encodings[0].frame.y.guide, if present, must be "merged" or "per-layer"']);
    expect(framed({ y: { mode: 'shared', zero: 'yes' } })).toEqual(['encodings[0].frame.y.zero, if present, must be a boolean']);
  });

  it('LAW 8: a resolution for a channel no layer can bind resolves nothing — and the refusal names the channels there are', () => {
    expect(framed({ z: { mode: 'shared' } })).toEqual(['encodings[0].frame.z: unknown channel — the layers bind x, y, size, color']);
    // the channels are the layers' own surfaces, in declaration order, first-seen wins
    expect(framed({ z: { mode: 'shared' } }, [edgesLayer, nodesLayer])).toEqual(['encodings[0].frame.z: unknown channel — the layers bind x, y, size, color']);
  });

  it('LAW 9: a bar, a histogram and a boxplot may not take an independent magnitude channel — extent IS the quantity', () => {
    expect(framed({ y: { mode: 'independent' } }, [barLayer, edgesLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a bar — a bar cannot take an independent y, its extent is read against one baseline',
    ]);
    expect(framed({ y: { mode: 'independent' } }, [{ ...barLayer, chartKind: 'histogram' }])).toEqual([
      'encodings[0].frame.y: layer "counts" is a histogram — a histogram cannot take an independent y, its extent is read against one baseline',
    ]);
    expect(framed({ y: { mode: 'independent' } }, [{ ...barLayer, chartKind: 'boxplot' }])).toEqual([
      'encodings[0].frame.y: layer "counts" is a boxplot — a boxplot cannot take an independent y, its extent is read against one baseline',
    ]);
    // a line or a point encodes POSITION — an independent y is a legitimate second axis for it
    expect(framed({ y: { mode: 'independent' } }, [nodesLayer, edgesLayer])).toEqual([]);
    // …and the law is about the MAGNITUDE channel: a bar's colour may resolve independently
    expect(framed({ color: { mode: 'independent' } }, [{ ...barLayer, channels: ['x', 'y', 'color'] }])).toEqual([]);
  });

  it('LAW 9: a shared quantitative channel keeps ONE zero policy, and a bar-like layer may not be told to drop it', () => {
    expect(framed({ y: { mode: 'shared', zero: false } }, [barLayer, edgesLayer])).toEqual([
      'encodings[0].frame.y.zero is false but layer "counts" is a bar — its y is read from zero',
    ]);
    // stating what the marks already imply is no refusal, and neither is leaving it to them
    expect(framed({ y: { mode: 'shared', zero: true } }, [barLayer])).toEqual([]);
    expect(framed({ y: { mode: 'shared' } }, [barLayer])).toEqual([]);
    // a line stack may honestly zoom
    expect(framed({ y: { mode: 'shared', zero: false } }, [nodesLayer, edgesLayer])).toEqual([]);
    // …and so may a HISTOGRAM's bound channel: it is the axis its bins sit on, and its count axis is
    // counted from the rows, never bound — the refusal and the FOLD ask one predicate (`zeroAnchorsChannel`)
    expect(framed({ y: { mode: 'shared', zero: false } }, [{ ...barLayer, chartKind: 'histogram' }])).toEqual([]);
    // a boxplot's extent IS on the channel it binds, so it keeps the refusal a bar gets
    expect(framed({ y: { mode: 'shared', zero: false } }, [{ ...barLayer, chartKind: 'boxplot' }])).toEqual([
      'encodings[0].frame.y.zero is false but layer "counts" is a boxplot — its y is read from zero',
    ]);
  });

  it('LAW 10: a shared channel means one scale, so the columns the layers bind must agree — type, role, scale kind and unit', () => {
    const mismatched = (nodes: Record<string, unknown>, edges: Record<string, unknown>): string[] => framed({ x: { mode: 'shared' } }, sharesX, facts(nodes, edges));
    expect(mismatched({ size: { type: 'number' } }, { weight: { type: 'date' } })).toEqual([
      'encodings[0].frame.x: layer "b" shares x with layer "a" but x is a number on "a" and a date on "b"',
    ]);
    expect(mismatched({ size: { role: 'measure' } }, { weight: { role: 'dimension' } })).toEqual([
      'encodings[0].frame.x: layer "b" shares x with layer "a" but x is a measure on "a" and a dimension on "b"',
    ]);
    expect(mismatched({ size: { scale: 'continuous' } }, { weight: { scale: 'discrete' } })).toEqual([
      'encodings[0].frame.x: layer "b" shares x with layer "a" but x is continuous on "a" and discrete on "b"',
    ]);
    expect(mismatched({ size: { unit: 'cases' } }, { weight: { unit: 'mg/dL' } })).toEqual([
      'encodings[0].frame.x: layer "b" shares x with layer "a" but x is in "cases" on "a" and in "mg/dL" on "b"',
    ]);
    // two facts disagreeing is two sentences, because a reader fixes them one at a time
    expect(mismatched({ size: { type: 'number', unit: 'cases' } }, { weight: { type: 'date', unit: 'mg/dL' } })).toEqual([
      'encodings[0].frame.x: layer "b" shares x with layer "a" but x is a number on "a" and a date on "b"',
      'encodings[0].frame.x: layer "b" shares x with layer "a" but x is in "cases" on "a" and in "mg/dL" on "b"',
    ]);
    // the same unit shares; and a unit mismatch is refused only when BOTH columns declare one — the door refuses on evidence, never on ignorance
    expect(mismatched({ size: { unit: 'cases' } }, { weight: { unit: 'cases' } })).toEqual([]);
    expect(mismatched({ size: { unit: 'cases' } }, { weight: {} })).toEqual([]);
    expect(mismatched({}, {})).toEqual([]);
  });

  it('LAW 10: an INDEPENDENT channel asks nobody to agree — that is what it is for', () => {
    const disagreeing = facts({ size: { type: 'number', unit: 'cases' } }, { weight: { type: 'date', unit: 'mg/dL' } });
    expect(framed({ x: { mode: 'independent' } }, sharesX, disagreeing)).toEqual([]);
    // …and the DEFAULT is shared, so the same two columns refuse under an EMPTY frame — `frame: {}` is a
    // declared frame, and every channel it does not name is shared/union/table/merged
    expect(framed({}, sharesX, disagreeing)).toHaveLength(2);
    // the BOUNDARY, stated: a layered view that declares NO frame is judged exactly as it was before the
    // frame existed (1.2 defs keep validating, and a 1.4 host draws each layer on its own extent). Declaring
    // the frame — `{}` is enough — is how a def asks to be held to law 10.
    expect(framed(undefined, sharesX, disagreeing)).toEqual([]);
  });

  it('LAW 10: one layer cannot disagree with anybody, and a channel a layer only ACCEPTS carries no column to compare', () => {
    const disagreeing = facts({ size: { type: 'number' } }, { weight: { type: 'date' } });
    expect(framed({ x: { mode: 'shared' } }, [sharesX[0]], disagreeing)).toEqual([]);
    // y is on both layers' surfaces and bound by neither: nothing to compare, and no sentence invented
    // (x still refuses under the shared DEFAULT — which is the point: the laws run per channel, on what each one actually binds)
    expect(framed({ y: { mode: 'shared' } }, sharesX, disagreeing).filter((p) => p.includes('frame.y'))).toEqual([]);
  });

  it('a frame law invents no sentence where the DEF says nothing about the columns', () => {
    // a `data` that is not a map of tables was refused on its own line; the frame reads no column facts off it
    const noTables = validateDashboardDef({ ...makeNetworkDef(), data: 'nodes', encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: sharesX, frame: { x: { mode: 'shared' } } }] } as unknown);
    expect(noTables.filter((p) => p.includes('frame'))).toEqual([]);
    // a table that is not an object, and a `columns` that is not one either: the same silence, never a guess
    const def = makeNetworkDef();
    for (const broken of [{ ...def.data, edges: 1 }, { ...def.data, edges: { ...def.data.edges!, columns: 'weight' } }, { ...def.data, edges: { ...def.data.edges!, columns: { weight: 'measure' } } }]) {
      const problems = validateDashboardDef({ ...def, data: broken, encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: sharesX, frame: { x: { mode: 'shared' } } }] } as unknown);
      expect(problems.filter((p) => p.includes('frame'))).toEqual([]);
    }
  });

  it('a malformed resolution is refused once — its own laws are not read off a shape nobody could parse', () => {
    // x disagrees on type across the two layers, but its resolution never said which mode it was in
    const problems = framed({ x: { mode: 'fixed' } }, sharesX, facts({ size: { type: 'number' } }, { weight: { type: 'date' } }));
    expect(problems).toEqual(['encodings[0].frame.x.mode must be "shared" or "independent"']);
  });

  it('a view with no frame is byte-identical to a view built before the frame existed', () => {
    expect(JSON.stringify(buildDashboard(makeNetworkDef()).def)).not.toContain('frame');
    expect(validateDashboardDef(makeNetworkDef())).toEqual([]);
  });

  it('the frame rides on the view’s encoding, so it is frozen at build and reaches the session with it', () => {
    const frame = { size: { mode: 'shared', basis: 'rows' } } as const;
    const dashboard = buildDashboard({ ...makeNetworkDef(), encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: [nodesLayer, edgesLayer], frame }] });
    expect(dashboard.def.encodings![0]!.frame).toEqual(frame);
    expect(Object.isFrozen(dashboard.def.encodings![0]!.frame)).toBe(true);
    expect(Object.isFrozen(dashboard.def.encodings![0]!.frame!['size'])).toBe(true);
  });
});
