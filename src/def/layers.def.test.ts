/**
 * The def door for `layers` — a view over more than one table. Every refusal
 * sentence, the two-layer fixture (nodes with a key + edges) building, each
 * layer's bindings judged against ITS table at the door and at `lint()`, the
 * frozen resolved layers on `ViewDecl`, and the pin that a view with no layers
 * is byte-identical to a view built before layers existed.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, validateDashboardDef, layerAddress } from './index.js';
import type { DashboardDef, LayerDecl } from './index.js';
import type { Cause } from '../cause/index.js';
import { layerSurfaceOf, layerSurfacesOf } from './layers.js';
// law 9's own sentence for a bar that would take the SECOND scale — one owner, quoted by the frame's twin too
import { firstScaleTakenRefusal } from '../encoding/index.js';
// law 12's own: which marks draw a zero guide and where, the words for one that does not, the logarithm's
// own words for a zero it has none of, and the channels that ARE an axis
import { POSITIONAL_CHANNELS, drawsZeroGuide, noZeroOnALogAxis, zeroGuideKindRefusal } from '../encoding/index.js';
import { mintedTables } from './builtinAnalyses.js';
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
    expect(at([{ ...nodesLayer, table: 'ghost' }])).toEqual(['encodings[0].layers[0].table "ghost" is not a declared data table, and no declared analysis mints it — the tables are nodes, edges; no act mints one']);
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

  it('a layer whose table cannot list its columns is judged against the DECLARATION — and said in a sentence when there is none', async () => {
    // a stub engine on the EDGES table only: the default table lists its columns, the layer's cannot.
    // It cannot list them because the connection never opens — the wasm engine itself answers fine
    // where a DuckDB can be opened, which is not what this law is about.
    const def = makeNetworkDef();
    const stubbed: DashboardDef = { ...def, data: { ...def.data, edges: { ...def.data.edges!, engine: 'wasm' } } };
    const cannotOpen = { availableEngines: ['memory' as const, 'wasm' as const], openSqlConnection: () => Promise.reject(new Error('no database in this test')) };
    // THE DECLARATION IS THE EVIDENCE (`../def/buildDashboard.ts` · `columnsToJudge`): `edges`
    // declares its three columns, and the edge layer binds one of them, so there is nothing wrong
    // — where this door used to THROW, losing the whole report over a table that had said what it is.
    expect(await buildDashboard(stubbed, cannotOpen).lint()).toEqual([]);
    // …and a binding the declaration does NOT name is refused by name, exactly as it is on a table
    // whose rows are there: same rule, same row (this is the question an act-filled table's layer
    // asks too, `../def/actFilled.def.test.ts`)
    const ghost: DashboardDef = { ...stubbed, encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: [nodesLayer, { ...edgesLayer, initial: { size: 'ghost' } }] }] };
    expect((await buildDashboard(ghost, cannotOpen).lint()).map((p) => [p.rule, p.viewId, p.channel, p.field, p.severity])).toEqual([
      ['column', layerAddress('net', 'edges'), 'size', 'ghost', 'refused'],
    ]);
    // …and when the table declares NOTHING, nothing was judged and the row says so — one per
    // binding, carrying the engine's own reason, never a throw
    const bare: DashboardDef = { ...stubbed, data: { ...stubbed.data, edges: { rows: [], engine: 'wasm' } } };
    const unjudged = await buildDashboard(bare, cannotOpen).lint();
    expect(unjudged.map((p) => [p.rule, p.viewId, p.channel, p.field, p.severity])).toEqual([['table', layerAddress('net', 'edges'), 'size', 'weight', 'refused']]);
    expect(unjudged[0]!.sentence).toMatch(/^the "edges" provider cannot list its columns and the def declares none, so nothing was judged against it — /);
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

/**
 * THE LAYERLESS VIEW — one plain chart, NO `layers` key, carrying a frame. The
 * def's `defaultTable` ('nodes') is where its columns are declared, so a column
 * fact laid over that table is what the axis laws read here.
 */
const plain = (frame: unknown, view: Record<string, unknown> = {}, extra: Partial<DashboardDef> = {}): string[] =>
  validateDashboardDef({ ...makeNetworkDef(undefined, extra), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y'], frame, ...view }] } as unknown);

describe('the frame — per channel, how its scale is resolved across the layers', () => {
  it('the fixture accepts a frame, and a frame is optional', () => {
    expect(framed(undefined)).toEqual([]);
    expect(framed({ size: { mode: 'shared', domain: 'union', basis: 'rows', guide: 'per-layer', zero: true } })).toEqual([]);
    expect(framed({ color: { mode: 'independent', guide: 'per-layer' } })).toEqual([]);
    // a channel with NO entry is shared/union/table/merged — the Wickham default, and it refuses nothing on this fixture
    expect(framed({})).toEqual([]);
  });

  it('LAW 7: a MALFORMED plain view still folds a binder — refused on its own line, and never refused a second time through the frame', () => {
    // THE LAW: the frame's binder for a layerless view is built from what the view SAYS, and a view that
    // said it badly was already refused for saying it badly. So the frame adds nothing: a missing chartKind
    // leaves the binder's kind empty (no mark, so no mark-shaped refusal), and a `channels` that is not an
    // array leaves it naming NO channel — and a sentence that would end mid-air ("the view binds ") is not
    // said at all, exactly as it is not said for a layered view whose every layer was malformed.
    expect(plain({ x: { transform: 'log' } }, { chartKind: '' })).toEqual(['encodings[0].chartKind must be a non-empty string']);
    expect(plain({ x: { transform: 'log' } }, { channels: 'x' })).toEqual(['encodings[0].channels must be a non-empty array of non-empty strings']);
  });

  it('LAW 7: a frame is legal on ANY view — `mode` is the one key that needs layers, and it is refused by name', () => {
    // THE LAW: a transform is not a resolution, and the frame owns both. `mode` — shared versus independent —
    // is meaningless with one layer; `transform` and `zero` describe the AXIS and are legal on a plain chart.
    expect(plain({ y: { mode: 'shared' } })).toEqual(['encodings[0].frame.y.mode: view "net" has no layers, so there is nothing to resolve — drop "mode" and keep the axis keys']);
    expect(plain({ y: { mode: 'independent' } })).toEqual(['encodings[0].frame.y.mode: view "net" has no layers, so there is nothing to resolve — drop "mode" and keep the axis keys']);
    // an EMPTY layer list is a view with no layers, and reads the same
    expect(framed({ y: { mode: 'shared' } }, [])).toEqual(['encodings[0].frame.y.mode: view "net" has no layers, so there is nothing to resolve — drop "mode" and keep the axis keys']);
    // …and the axis keys pass on that same plain view
    expect(plain({ y: { transform: 'log' } })).toEqual([]);
    expect(plain({ y: { transform: 'linear', zero: true, domain: 'union', basis: 'rows', guide: 'merged' } })).toEqual([]);
    expect(plain(undefined)).toEqual([]);
    // a layer list that is entirely malformed was refused layer by layer; the frame does not pile on — and it
    // does not become layerless either, because the author DID declare layers
    expect(framed({ y: { mode: 'shared' } }, ['junk'])).toEqual([
      'encodings[0].layers[0] must be an object { layerId, table, chartKind, channels, initial?, label? }',
    ]);
  });

  it('LAW 7: the layerless shape says what a layerless entry is, and its unknown keys are refused on the axis', () => {
    expect(plain('log')).toEqual(['encodings[0].frame, if present, must be an object mapping channel -> { transform?: "linear" | "log" }']);
    expect(plain({ y: 'log' })).toEqual(['encodings[0].frame.y must be an object { transform?: "linear" | "log", domain?, basis?, guide?, zero?, zeroGuide?, bounds? }']);
    expect(plain({ y: { logged: true } })).toEqual(['encodings[0].frame.y: unknown key "logged" on an axis']);
    // no mode is needed at all — an entry with only axis keys is complete
    expect(plain({ y: {} })).toEqual([]);
    // the channel is still named against what the VIEW binds, not what layers bind
    expect(plain({ z: { transform: 'log' } })).toEqual(['encodings[0].frame.z: unknown channel — the view binds x, y']);
  });

  it('LAW 7: the shape — a mode from the two words, and only the keys that mode has', () => {
    expect(framed('shared')).toEqual(['encodings[0].frame, if present, must be an object mapping channel -> { mode: "shared" | "independent" }']);
    expect(framed({ y: 'shared' })).toEqual(['encodings[0].frame.y must be an object { mode: "shared" | "independent", domain?, basis?, guide?, zero?, transform?, zeroGuide?, bounds? }']);
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

  it('LAW 9: a histogram and a boxplot may not take an independent magnitude channel — extent IS the quantity', () => {
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
    // …and a BAR keeps the identical refusal on a magnitude channel that is NOT the frame's y: left and
    // right are y edges, so an independent `x` or `size` of a bar's own is no edge of anything
    expect(framed({ x: { mode: 'independent' } }, [barLayer, edgesLayer])).toEqual([
      'encodings[0].frame.x: layer "counts" is a bar — a bar cannot take an independent x, its extent is read against one baseline',
    ]);
    expect(framed({ size: { mode: 'independent' } }, [{ ...barLayer, channels: ['x', 'y', 'size'] }])).toEqual([
      'encodings[0].frame.size: layer "counts" is a bar — a bar cannot take an independent size, its extent is read against one baseline',
    ]);
  });

  it('LAW 9: a BAR MAY TAKE THE FIRST SCALE — the LEFT edge, in declaration order — and a SECOND scale of its own is refused in the sentence the frame says too', () => {
    // THE LAW: bars of a count on the left with a line of a rate on the right is the classic two-scale
    // figure, and it is honest in that ONE arrangement — the left axis is where an extent is read from a
    // baseline. Both shapes that declare it: an independent y, and a shared y drawn per-layer.
    expect(framed({ y: { mode: 'independent' } }, [barLayer, edgesLayer])).toEqual([]);
    expect(framed({ y: { mode: 'shared', guide: 'per-layer' } }, [barLayer, edgesLayer])).toEqual([]);
    // the bar SECOND: the line already holds the first scale, so this bar would be read off the RIGHT edge
    expect(framed({ y: { mode: 'independent' } }, [edgesLayer, barLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a bar with a y of its own, but layer "edges" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y',
    ]);
    expect(framed({ y: { mode: 'shared', guide: 'per-layer' } }, [edgesLayer, barLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a bar with a y of its own, but layer "edges" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y',
    ]);
    // TWO BARS is two baselines: the second is refused for the same reason, naming the one that holds the scale
    expect(framed({ y: { mode: 'independent' } }, [barLayer, { ...barLayer, layerId: 'top' }])).toEqual([
      'encodings[0].frame.y: layer "top" is a bar with a y of its own, but layer "counts" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y',
    ]);
    // ONE OWNER for that sentence, shared with the frame that has to draw the figure — the door says it
    // with its address in front, the renderer's twin says it as it stands (`twoScalesRefusal`, law 2)
    expect(firstScaleTakenRefusal('layer "counts"', 'bar', 'layer "edges"')).toBe(
      'layer "counts" is a bar with a y of its own, but layer "edges" already takes the first scale — a bar reads its extent from the LEFT baseline, so declare it first, or give the line the independent y',
    );
    // the promotion is the BAR's alone: a histogram and a boxplot summarise a distribution on an axis of
    // their own and neither draws one on a frame's edge, so first or not they keep law 9's own words
    expect(framed({ y: { mode: 'independent' } }, [{ ...barLayer, chartKind: 'boxplot' }, edgesLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a boxplot — a boxplot cannot take an independent y, its extent is read against one baseline',
    ]);
    // a MERGED y is one scale for the stack, and a bar on it was never in question
    expect(framed({ y: { mode: 'shared' } }, [edgesLayer, barLayer])).toEqual([]);
  });

  it('LAW 9: the SAME reason under `shared` — a per-layer guide beside a second layer is a second axis too, and the door refuses it as it would independent (packet W review, finding 1: this closes the gap `twoScalesRefusal` used to catch alone, at render, in `contract/renderers.tsx`)', () => {
    expect(framed({ y: { mode: 'shared', guide: 'per-layer' } }, [{ ...barLayer, chartKind: 'histogram' }, edgesLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a histogram — a histogram cannot take a per-layer y on a frame of more than one layer either, its extent is read against one baseline',
    ]);
    expect(framed({ y: { mode: 'shared', guide: 'per-layer' } }, [{ ...barLayer, chartKind: 'boxplot' }, edgesLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a boxplot — a boxplot cannot take a per-layer y on a frame of more than one layer either, its extent is read against one baseline',
    ]);
    // a line or a point still takes it — the second axis a per-layer guide draws is exactly what law 1's two sides are for
    expect(framed({ y: { mode: 'shared', guide: 'per-layer' } }, [nodesLayer, edgesLayer])).toEqual([]);
    // a LONE bar under a per-layer guide has no second layer to stand beside — `VizFrame` draws its own ordinary
    // axes for a single layer regardless of guide, so the door refuses nothing here (law 7's `plain` pins the
    // layerless equivalent above)
    expect(framed({ y: { mode: 'shared', guide: 'per-layer' } }, [barLayer])).toEqual([]);
    // the MERGED guide (the default) is the whole point of `shared` — untouched
    expect(framed({ y: { mode: 'shared', guide: 'merged' } }, [barLayer, edgesLayer])).toEqual([]);
    expect(framed({ y: { mode: 'shared' } }, [barLayer, edgesLayer])).toEqual([]);
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
    // …and the zero law stands over the bar that MAY take the first scale: its own left axis is anchored at
    // zero even where the line's on the right is not, so `zero: false` beside it is still refused
    expect(framed({ y: { mode: 'shared', guide: 'per-layer', zero: false } }, [barLayer, edgesLayer])).toEqual([
      'encodings[0].frame.y.zero is false but layer "counts" is a bar — its y is read from zero',
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

describe('LAW 11 — the logarithmic axis: the frame owns whether an axis is linear or logarithmic', () => {
  it('the transform is one of two words, on a layer and on a plain view alike', () => {
    expect(framed({ size: { mode: 'shared', transform: 'log' } })).toEqual([]);
    expect(framed({ size: { mode: 'shared', transform: 'linear' } })).toEqual([]);
    // an INDEPENDENT channel keeps it too: each layer's own scale is still an axis
    expect(framed({ color: { mode: 'independent', transform: 'log' } })).toEqual([]);
    expect(framed({ size: { mode: 'shared', transform: 'logarithmic' } })).toEqual(['encodings[0].frame.size.transform, if present, must be "linear" or "log"']);
    expect(framed({ color: { mode: 'independent', transform: 'ln' } })).toEqual(['encodings[0].frame.color.transform, if present, must be "linear" or "log"']);
    expect(plain({ y: { transform: 'log10' } })).toEqual(['encodings[0].frame.y.transform, if present, must be "linear" or "log"']);
  });

  it('a logarithmic axis has no zero — the pair is refused, so the FOLD never sees it', () => {
    expect(framed({ size: { mode: 'shared', transform: 'log', zero: true } })).toEqual(['encodings[0].frame.size: a logarithmic axis has no zero — drop "zero", or draw this channel linearly']);
    expect(plain({ y: { transform: 'log', zero: true } })).toEqual(['encodings[0].frame.y: a logarithmic axis has no zero — drop "zero", or draw this channel linearly']);
    // `zero: false` is not a claim that a zero exists — it is the default a log axis already keeps
    expect(framed({ size: { mode: 'shared', transform: 'log', zero: false } })).toEqual([]);
  });

  it('a logarithm needs a NUMBER — judged where the def declares the column, never on ignorance', () => {
    // the same two point layers that share x, with x declared a date on one of them
    expect(framed({ x: { mode: 'shared', transform: 'log' } }, sharesX, facts({ size: { type: 'date' } }, { weight: { type: 'date' } }))).toEqual([
      'encodings[0].frame.x: transform "log" needs a number — layer "a" binds x to "size", a date',
      'encodings[0].frame.x: transform "log" needs a number — layer "b" binds x to "weight", a date',
    ]);
    // a number passes, and a column the def says nothing about is not held to the law (the `unit` precedent)
    expect(framed({ x: { mode: 'shared', transform: 'log' } }, sharesX, facts({ size: { type: 'number' } }, { weight: { type: 'number' } }))).toEqual([]);
    expect(framed({ x: { mode: 'shared', transform: 'log' } }, sharesX)).toEqual([]);
    // the layerless view reads its column off the DEFAULT table, and names itself
    expect(plain({ x: { transform: 'log' } }, { initial: { x: 'size' } }, facts({ size: { type: 'date', role: 'measure' } }, {}))).toEqual([
      'encodings[0].frame.x: transform "log" needs a number — view "net" binds x to "size", a date',
    ]);
  });

  it('a MAGNITUDE channel of a bar or a box is refused — its extent IS the quantity; a POSITION channel of those marks is not', () => {
    const bar = 'encodings[0].frame.y: layer "counts" is a bar — its y extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic';
    expect(framed({ y: { mode: 'shared', transform: 'log' } }, [barLayer])).toEqual([bar]);
    expect(framed({ y: { mode: 'shared', transform: 'log' } }, [{ ...barLayer, chartKind: 'boxplot' }])).toEqual([
      'encodings[0].frame.y: layer "counts" is a boxplot — its y extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic',
    ]);
    // the same view with no layers at all — one law, and it names the view
    expect(plain({ y: { transform: 'log' } }, { chartKind: 'bar' })).toEqual([
      'encodings[0].frame.y: view "net" is a bar — its y extent IS the quantity, and on a logarithmic axis a bar four times as long is not four times the value; a POSITION channel of a bar, histogram or boxplot may still be logarithmic',
    ]);
    // A HISTOGRAM'S BOUND CHANNEL IS ITS BIN AXIS — a position, so log-spaced bins are legitimate. This is
    // `zeroAnchorsChannel` answering, the same predicate the zero law and the fold read (one owner, no drift).
    expect(framed({ y: { mode: 'shared', transform: 'log' } }, [{ ...barLayer, chartKind: 'histogram' }])).toEqual([]);
    expect(plain({ y: { transform: 'log' } }, { chartKind: 'histogram' })).toEqual([]);
    // …and a point layer's y is a position wherever it sits
    expect(framed({ y: { mode: 'shared', transform: 'log' } }, [nodesLayer, edgesLayer])).toEqual([]);
    // a NON-magnitude channel of a bar is a colour ramp, not a length
    expect(framed({ color: { mode: 'shared', transform: 'log' } }, [{ ...barLayer, channels: ['x', 'y', 'color'] }])).toEqual([]);
  });

  it('the transform rides on the view’s encoding, frozen at build, on a view with NO layers', () => {
    const frame = { y: { transform: 'log' } } as const;
    const dashboard = buildDashboard({ ...makeNetworkDef(), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y'], frame }] });
    expect(dashboard.def.encodings![0]!.frame).toEqual(frame);
    expect(Object.isFrozen(dashboard.def.encodings![0]!.frame!['y'])).toBe(true);
  });
});

describe('layers — a layer may draw a table an ACT mints', () => {
  /**
   * The aggregate that lands `sizes_per_group`: one row per group, one
   * measure. Nothing here is new — an aggregate already declares the table it
   * lands (`name`), the columns it lands (`groupBy`, then the measures' `as`)
   * and, with one group column, its key. Law 2 reads what is already there.
   */
  const BY_GROUP = { builtin: 'aggregate', table: 'nodes', name: 'sizes_per_group', ops: 1, groupBy: ['group'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'size' }] } }] };
  const acts = { analyses: { sizesPerGroup: BY_GROUP } } as unknown as Partial<DashboardDef>;
  const bars: LayerDecl = { layerId: 'bars', table: 'sizes_per_group', chartKind: 'bar', channels: ['x', 'y'], initial: { x: 'group', y: 'total' } };

  it('the ONE owner answers name → { analysisId, columns, key } off the declaration', () => {
    const minted = mintedTables({ analyses: { sizesPerGroup: BY_GROUP } });
    expect([...minted.keys()]).toEqual(['sizes_per_group']);
    // the columns are the act's own order: the group columns, then the measures as they land — and each
    // carries its TYPE. Nothing declares `nodes` here, so the group column is honestly `unknown`; `sum`
    // yields a number whatever it totals, so the measure is a number even with no parent in sight.
    expect(minted.get('sizes_per_group')).toEqual({ analysisId: 'sizesPerGroup', columns: [{ name: 'group', type: 'unknown' }, { name: 'total', type: 'number' }], key: 'group' });
    // two group columns are a compound nobody declared a key for; a whole-table aggregate has neither
    expect(mintedTables({ analyses: { a: { ...BY_GROUP, groupBy: ['group', 'size'] } } })!.get('sizes_per_group')).toEqual({ analysisId: 'a', columns: [{ name: 'group', type: 'unknown' }, { name: 'size', type: 'unknown' }, { name: 'total', type: 'number' }] });
    expect(mintedTables({ analyses: { a: { ...BY_GROUP, groupBy: [] } } })!.get('sizes_per_group')).toEqual({ analysisId: 'a', columns: [{ name: 'total', type: 'number' }] });
    // a record that states a name and nothing usable beside it mints a table with no columns — every part is read for what it says
    expect(mintedTables({ analyses: { a: { builtin: 'aggregate', name: 'bare' } } }).get('bare')).toEqual({ analysisId: 'a', columns: [] });
    expect(mintedTables({ analyses: { a: { ...BY_GROUP, measures: ['total'] } } }).get('sizes_per_group')).toEqual({ analysisId: 'a', columns: [{ name: 'group', type: 'unknown' }], key: 'group' });
    // two acts claiming one name: the first declaration answers — a second owner is the ACT door's question, not a reader's
    expect(mintedTables({ analyses: { first: BY_GROUP, second: BY_GROUP } }).get('sizes_per_group')!.analysisId).toBe('first');
    // total over what it is handed: no def, no analyses, an analysis that is CODE, a non-aggregate builtin and a nameless record mint nothing
    expect(mintedTables(undefined).size).toBe(0);
    expect(mintedTables({}).size).toBe(0);
    expect(mintedTables({ analyses: { m: { run: () => ({ ok: true }) } } }).size).toBe(0);
    expect(mintedTables({ analyses: { g: { builtin: 'groupBy', by: 'group', measure: 'size' } } }).size).toBe(0);
    expect(mintedTables({ analyses: { a: { builtin: 'aggregate' } } }).size).toBe(0);
  });

  it('a layer drawing the minted table validates, builds, and keeps its voice', async () => {
    expect(at([nodesLayer, bars], acts)).toEqual([]);
    const def = { ...makeNetworkDef([nodesLayer, bars], acts) };
    const dashboard = buildDashboard(def);
    expect(dashboard.def.encodings![0]!.layers![1]!.table).toBe('sizes_per_group');
    // `lint()` judges a layer against its table's REAL columns; a table no act has landed has no provider
    // to ask, so the minted layer is skipped there — it refuses nothing and, above all, does not throw
    expect(await dashboard.lint()).toEqual([]);
    // the view keeps its VOICE: it need not declare itself mute because one of its layers draws a minted
    // table — whether that table is HERE is the probe door's question, asked per cursor (../session/)
    const overview = await dashboard.createSession().overview();
    expect(overview.views.find((v) => v.viewId === 'net')?.canProbe).toBe(true);
    // the layer carries the act's column list, typed, which is what the field law is judged against.
    // The fixture's `nodes` declares ROLES and no types, so its group column stays `unknown` — a column
    // the parent never typed is one nobody can type, and that is the answer rather than a guess.
    expect(layerSurfacesOf(def.encodings!, def.data, mintedTables(def))[1]!.minted).toEqual({ analysisId: 'sizesPerGroup', columns: [{ name: 'group', type: 'unknown' }, { name: 'total', type: 'number' }], key: 'group' });
  });

  it("the field law is judged against the act's columns — the whole list, and nothing the act does not land", () => {
    // a measure's `as` and a group column are both columns of the minted table
    expect(at([{ ...bars, initial: { x: 'group', y: 'total' } }], acts)).toEqual([]);
    // a name the act does not land is refused in the field law's own sentence, under the layer's slot
    expect(at([{ ...bars, initial: { x: 'group', y: 'ghost' } }], acts)).toEqual(['encodings[0].layers[0].initial.y: "ghost" is not a column of the table']);
    // …including a column of the PARENT the act does not carry over: a minted table holds what it lands and nothing else
    expect(at([{ ...bars, initial: { x: 'id', y: 'total' } }], acts)).toEqual(['encodings[0].layers[0].initial.x: "id" is not a column of the table']);
  });

  it('a table neither declared nor minted is refused in a sentence naming BOTH sets', () => {
    expect(at([{ ...bars, table: 'ghost' }], acts)).toEqual([
      'encodings[0].layers[0].table "ghost" is not a declared data table, and no declared analysis mints it — the tables are nodes, edges; the acts mint sizes_per_group',
    ]);
  });

  it("a minted name that COLLIDES with a declared table never shadows it — the declared table's real columns still judge the layer", () => {
    // an act that claims the real `nodes` name, landing only `group` (no `id`, no `size`) — the session's
    // landing door already refuses to ever let such an act LAND over a declared name (aggregateTable.test.ts);
    // this pins that the DEF door does not let the collision borrow the ACT's column list either
    const shadow = { analyses: { shadowsNodes: { ...BY_GROUP, name: 'nodes' } } } as unknown as Partial<DashboardDef>;
    // `size` and `id` are real columns of the declared `nodes` table, not of the act's `group`/`total` —
    // a bug that let `minted` win this name would refuse them here with "is not a column of the table"
    expect(at([nodesLayer], shadow)).toEqual([]);
    const def = makeNetworkDef([nodesLayer], shadow);
    // `layerSurfacesOf` must carry NO `minted` for a layer on a table that is ALSO declared — the declared
    // table is the real one at every cursor, so its layer is judged (and lints) with the real columns
    expect(layerSurfacesOf(def.encodings!, def.data, mintedTables(def))[0]!.minted).toBeUndefined();
  });

  it('defaultTable stays DECLARED-only — a minted-only name is refused in the same, unwidened sentence', () => {
    // `defaultTable` is the dashboard's ground, resolved before any act can have landed (../validate.ts) —
    // law 2 widened for a LAYER, deliberately not for this; the sentence a def author sees is unchanged
    expect(validateDashboardDef({ ...makeNetworkDef([nodesLayer, bars], acts), defaultTable: 'sizes_per_group' })).toEqual(['defaultTable "sizes_per_group" is not a declared data table']);
  });
});

/**
 * LAW 12 — ZERO IS A PLACE ON THE AXIS, AND A CHART MAY BE TOLD TO DRAW IT.
 *
 * Every refusal the DOOR can say, which is every one that needs no numbers: a
 * channel that is not an axis, a mark that draws no guide on that channel, a
 * logarithm asked for a zero it has none of, and the shape of the key itself.
 * The one refusal that is NOT here is the domain excluding zero — no domain is
 * typed by hand, so the door is ignorant of it and the CHART says it instead
 * (`vizfootprint-ui/primitives/zeroGuide.ts`, pinned in `charts/zeroGuide.test.tsx`).
 */
describe('LAW 12 — zero is a place on the axis, and a chart may be TOLD to draw it', () => {
  it('accepts a guide on x, on y and on BOTH — one declaration answered twice, on a layered view and on a plain one', () => {
    expect(framed({ x: { mode: 'shared', zeroGuide: true } }, sharesX)).toEqual([]);
    expect(framed({ y: { mode: 'shared', zeroGuide: true } }, sharesX)).toEqual([]);
    expect(framed({ x: { mode: 'shared', zeroGuide: true }, y: { mode: 'shared', zeroGuide: true } }, sharesX)).toEqual([]);
    // THE FIGURE THAT ASKED: a plain scatter of φ against ψ, both angles signed, both guides declared
    expect(plain({ x: { zeroGuide: true }, y: { zeroGuide: true } })).toEqual([]);
    // `false` is as legal as `true` — a def may say out loud that it wants none (and it is what absent means)
    expect(plain({ y: { zeroGuide: false } })).toEqual([]);
    // an INDEPENDENT channel's per-layer scale is an axis too, so the key rides there as `transform` does
    expect(framed({ y: { mode: 'independent', zeroGuide: true } }, sharesX)).toEqual([]);
  });

  it('the key is a BOOLEAN on every arm — a truthy string would draw furniture nobody asked for in those words', () => {
    expect(plain({ y: { zeroGuide: 'true' } })).toEqual(['encodings[0].frame.y.zeroGuide, if present, must be a boolean']);
    expect(framed({ y: { mode: 'shared', zeroGuide: 1 } }, sharesX)).toEqual(['encodings[0].frame.y.zeroGuide, if present, must be a boolean']);
    expect(framed({ y: { mode: 'independent', zeroGuide: 'yes' } }, sharesX)).toEqual(['encodings[0].frame.y.zeroGuide, if present, must be a boolean']);
  });

  it('a channel that is NOT POSITIONAL has no axis for a line to cross — and a magnitude is not an axis either', () => {
    expect(plain({ color: { zeroGuide: true } }, { channels: ['x', 'y', 'color'] })).toEqual([
      'encodings[0].frame.color: a zero guide is a line drawn across a plot, and "color" is not a positional channel — declare it on x or y',
    ]);
    // `size` carries a MAGNITUDE and still draws no axis: it is read off the mark, so there is no edge to cross
    expect(plain({ size: { zeroGuide: true } }, { channels: ['x', 'y', 'size'] })).toEqual([
      'encodings[0].frame.size: a zero guide is a line drawn across a plot, and "size" is not a positional channel — declare it on x or y',
    ]);
    // ONE mistake, ONE sentence: a channel that is no axis is never ALSO told which marks draw guides
    expect(POSITIONAL_CHANNELS.has('x') && POSITIONAL_CHANNELS.has('y')).toBe(true);
    expect([...POSITIONAL_CHANNELS]).toEqual(['x', 'y']);
  });

  it('a MARK that draws no zero guide on that channel is refused BY NAME — never accepted and ignored', () => {
    // the three whose extent is read from a baseline that IS zero: a second line over it says nothing new
    expect(framed({ y: { mode: 'shared', zeroGuide: true } }, [barLayer])).toEqual([
      'encodings[0].frame.y: layer "counts" is a bar, and a bar draws no zero guide on y — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"',
    ]);
    expect(framed({ y: { mode: 'shared', zeroGuide: true } }, [{ ...barLayer, chartKind: 'histogram' }])).toEqual([
      'encodings[0].frame.y: layer "counts" is a histogram, and a histogram draws no zero guide on y — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"',
    ]);
    expect(framed({ y: { mode: 'shared', zeroGuide: true } }, [{ ...barLayer, chartKind: 'boxplot' }])).toEqual([
      'encodings[0].frame.y: layer "counts" is a boxplot, and a boxplot draws no zero guide on y — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"',
    ]);
    // …and the answer is per PAIR, not per mark: a LINE draws one on y and none on x, because its x is a run
    // of dates or a band of categories and neither has a zero a sign is read from
    expect(plain({ x: { zeroGuide: true } }, { chartKind: 'line' })).toEqual([
      'encodings[0].frame.x: view "net" is a line, and a line draws no zero guide on x — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"',
    ]);
    expect(plain({ y: { zeroGuide: true } }, { chartKind: 'line' })).toEqual([]);
    // every layer that binds the channel is named, so a stack gets one sentence per layer to fix
    expect(framed({ y: { mode: 'shared', zeroGuide: true } }, [barLayer, { ...barLayer, layerId: 'top', chartKind: 'boxplot' }])).toHaveLength(2);
    // a layer that does NOT bind the channel is not asked about: a guide folded for somebody else's column
    // is no axis of its own (the `layerDomain` law, read the other way round)
    expect(framed({ y: { mode: 'shared', zeroGuide: true } }, [{ ...barLayer, channels: ['x'] }, ...sharesX])).toEqual([]);
  });

  it('ONE OWNER for the predicate and for the words — the frame that has to draw it refuses in the same sentence', () => {
    expect(zeroGuideKindRefusal('layer "counts"', 'bar', 'y')).toBe(
      'layer "counts" is a bar, and a bar draws no zero guide on y — a point draws one on x and y, a line on y; declare it there, or drop "zeroGuide"',
    );
    // a point under both its names (VL calls a scatter a point) on either axis; a line on y alone
    expect([drawsZeroGuide('point', 'x'), drawsZeroGuide('point', 'y'), drawsZeroGuide('scatter', 'x'), drawsZeroGuide('scatter', 'y')]).toEqual([true, true, true, true]);
    expect([drawsZeroGuide('line', 'y'), drawsZeroGuide('line', 'x')]).toEqual([true, false]);
    for (const kind of ['bar', 'histogram', 'boxplot', 'heatmap', 'map', 'network', 'table', '__proto__']) {
      expect(drawsZeroGuide(kind, 'y'), kind).toBe(false);
    }
  });

  it('a LOGARITHMIC axis has no zero at all — and that is the answer, in the logarithm’s own words rather than a new sentence', () => {
    expect(plain({ y: { transform: 'log', zeroGuide: true } })).toEqual([
      'encodings[0].frame.y: a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly',
    ]);
    // the SIBLING key keeps its own sentence, byte for byte: `zero` extends a domain, `zeroGuide` draws a line
    expect(plain({ y: { transform: 'log', zero: true } })).toEqual([
      'encodings[0].frame.y: a logarithmic axis has no zero — drop "zero", or draw this channel linearly',
    ]);
    // both asked = one sentence each, because a reader drops one key at a time
    expect(plain({ y: { transform: 'log', zero: true, zeroGuide: true } })).toEqual([
      'encodings[0].frame.y: a logarithmic axis has no zero — drop "zero", or draw this channel linearly',
      'encodings[0].frame.y: a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly',
    ]);
    // one owner of the clause, quoted by the CHART too (which says it of a log axis it was handed)
    expect(noZeroOnALogAxis('zeroGuide')).toBe('a logarithmic axis has no zero — drop "zeroGuide", or draw this channel linearly');
    // `zeroGuide: false` beside a logarithm asks for nothing, so it is refused nothing
    expect(plain({ y: { transform: 'log', zeroGuide: false } })).toEqual([]);
  });

  it('an unknown channel is still the unknown-channel refusal, and a misspelt key is still refused by name', () => {
    expect(plain({ z: { zeroGuide: true } })).toEqual(['encodings[0].frame.z: unknown channel — the view binds x, y']);
    expect(plain({ y: { zeroLine: true } })).toEqual(['encodings[0].frame.y: unknown key "zeroLine" on an axis']);
    expect(framed({ y: { mode: 'shared', zeroLine: true } }, sharesX)).toEqual(['encodings[0].frame.y: unknown key "zeroLine" on a shared channel']);
    expect(framed({ y: { mode: 'independent', zeroLine: true } }, sharesX)).toEqual(['encodings[0].frame.y: unknown key "zeroLine" on an independent channel']);
  });

  it('a def declaring no zero guide is byte-identical to one written before the key existed, and a declared one rides frozen onto the view', () => {
    expect(JSON.stringify(buildDashboard(makeNetworkDef([...sharesX])).def)).not.toContain('zeroGuide');
    const frame = { x: { mode: 'shared', zeroGuide: true }, y: { mode: 'shared', zeroGuide: true } } as const;
    const dashboard = buildDashboard({ ...makeNetworkDef(), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y'], layers: [...sharesX], frame }] });
    expect(dashboard.def.encodings![0]!.frame).toEqual(frame);
    expect(Object.isFrozen(dashboard.def.encodings![0]!.frame)).toBe(true);
  });
});

/**
 * LAW 14 — WHAT THE QUANTITY CAN BE. The one numeric pair a frame carries, and
 * every refusal the door can say about it: the shape (a pair of finite numbers,
 * low first), the column (bounds are numbers, so the axis has to be one), the
 * curve (a logarithm cannot be read from a non-positive bound), and the mode
 * (an independent channel has no ONE axis for one claim).
 *
 * The one refusal that is NOT here is a value outside the declared pair — which
 * cells those are is DATA, so the CHART counts them and says so
 * (`outsideNotes`, pinned in `vizfootprint-ui`), exactly as the logarithm's
 * excluded cells are counted and never refused.
 */
describe('LAW 14 — what the quantity can be: a numeric extent CAN be declared', () => {
  it('accepts a declared extent on x, on y and on BOTH — on a plain view and on a layered one', () => {
    // THE FIGURE THAT ASKED: a torsion angle is −180…180 by definition, whatever residues are in the table
    expect(plain({ x: { bounds: [-180, 180] } })).toEqual([]);
    expect(plain({ y: { bounds: [-180, 180] } })).toEqual([]);
    expect(plain({ x: { bounds: [-180, 180] }, y: { bounds: [-180, 180] } })).toEqual([]);
    // the other quantities that have one by definition
    for (const pair of [[0, 100], [0, 1], [-1, 1], [-0.5, 0.5]]) expect(plain({ y: { bounds: pair } })).toEqual([]);
    expect(framed({ size: { mode: 'shared', bounds: [0, 100] } })).toEqual([]);
    // and it sits beside the axis's other declared facts without arguing with any of them
    expect(plain({ y: { bounds: [1, 1000], transform: 'log', zeroGuide: false, basis: 'rows', domain: 'union', guide: 'merged' } })).toEqual([]);
  });

  it('the SHAPE is a pair of finite numbers with the low one first — a reversed pair is a typo and a flat one is not an extent', () => {
    const shape = 'encodings[0].frame.y.bounds, if present, must be a pair of finite numbers with the low one first — what the QUANTITY can be, e.g. [-180, 180] for a torsion angle';
    for (const bad of [[180, -180], [0, 0], [1], [1, 2, 3], [], [0, Infinity], [NaN, 1], ['0', '100'], [null, 1], 180, '[-180, 180]', {}, { lo: 0, hi: 1 }, true]) {
      expect(plain({ y: { bounds: bad } }), JSON.stringify(bad) ?? 'undefined').toEqual([shape]);
    }
    // the layered arms say the same thing at their own address
    expect(framed({ size: { mode: 'shared', bounds: [9, 1] } })).toEqual([
      'encodings[0].frame.size.bounds, if present, must be a pair of finite numbers with the low one first — what the QUANTITY can be, e.g. [-180, 180] for a torsion angle',
    ]);
    // ONE mistake, ONE sentence: a malformed pair is never ALSO judged through the laws that read it
    expect(framed({ x: { mode: 'shared', bounds: [9, 1], transform: 'log' } }, sharesX, facts({ size: { type: 'date' } }, {}))).toHaveLength(2); // the shape, and the logarithm's own column law
  });

  it('BOUNDS ARE NUMBERS, so the axis has to be one — judged where the def declares the column, never on ignorance', () => {
    // both columns declared a DATE, so law 10's shared-column check has nothing to disagree about: one law per test
    expect(framed({ x: { mode: 'shared', bounds: [0, 100] } }, sharesX, facts({ size: { type: 'date' } }, { weight: { type: 'date' } }))).toEqual([
      'encodings[0].frame.x.bounds needs a number — layer "a" binds x to "size", a date',
      'encodings[0].frame.x.bounds needs a number — layer "b" binds x to "weight", a date',
    ]);
    // a number passes; a column the def says nothing about is not held to the law (the `unit` precedent)
    expect(framed({ x: { mode: 'shared', bounds: [0, 100] } }, sharesX, facts({ size: { type: 'number' } }, { weight: { type: 'number' } }))).toEqual([]);
    expect(framed({ x: { mode: 'shared', bounds: [0, 100] } }, sharesX)).toEqual([]);
    // the layerless view reads its column off the DEFAULT table, and names itself
    expect(plain({ x: { bounds: [0, 100] } }, { initial: { x: 'size' } }, facts({ size: { type: 'date', role: 'measure' } }, {}))).toEqual([
      'encodings[0].frame.x.bounds needs a number — view "net" binds x to "size", a date',
    ]);
  });

  it('A LOGARITHM CANNOT BE READ FROM A NON-POSITIVE BOUND — refused here, because the chart would LIFT it instead', () => {
    expect(plain({ y: { bounds: [0, 100], transform: 'log' } })).toEqual([
      'encodings[0].frame.y.bounds: a logarithmic axis cannot be read from 0, so [0, 100] is not an extent it can draw — declare bounds a logarithm can take, or drop transform "log"',
    ]);
    expect(plain({ y: { bounds: [-180, 180], transform: 'log' } })).toEqual([
      'encodings[0].frame.y.bounds: a logarithmic axis cannot be read from -180, so [-180, 180] is not an extent it can draw — declare bounds a logarithm can take, or drop transform "log"',
    ]);
    // only the LOW bound can be the offender, because the shape already put the low one first
    expect(plain({ y: { bounds: [0.001, 1000], transform: 'log' } })).toEqual([]);
    // …and a linear axis takes a zero or a negative bound happily: that is most of what bounds are for
    expect(plain({ y: { bounds: [0, 100], transform: 'linear' } })).toEqual([]);
    expect(plain({ y: { bounds: [-180, 180] } })).toEqual([]);
  });

  it('an INDEPENDENT channel is refused BY NAME — each layer keeps its own scale, so there is no one axis for one claim', () => {
    expect(framed({ color: { mode: 'independent', bounds: [0, 1] } })).toEqual(['encodings[0].frame.color: unknown key "bounds" on an independent channel']);
    // and a misspelling is still a misspelling, on every arm
    expect(plain({ y: { bound: [0, 1] } })).toEqual(['encodings[0].frame.y: unknown key "bound" on an axis']);
    expect(framed({ size: { mode: 'shared', range: [0, 1] } })).toEqual(['encodings[0].frame.size: unknown key "range" on a shared channel']);
  });

  it('the declared pair rides on the view’s encoding, frozen at build — on a view with NO layers', () => {
    const frame = { x: { bounds: [-180, 180] }, y: { bounds: [-180, 180] } } as const;
    const dashboard = buildDashboard({ ...makeNetworkDef(), encodings: [{ viewId: 'net', chartKind: 'point', channels: ['x', 'y'], frame }] });
    expect(dashboard.def.encodings![0]!.frame).toEqual(frame);
    expect(Object.isFrozen(dashboard.def.encodings![0]!.frame!['x'])).toBe(true);
  });
});

/**
 * BYTE IDENTITY for law 12 — a def that declares no zero guide is the def it
 * was before the key existed, everywhere a reader meets it: the overview, the
 * commit, `why()`. And a def that DOES declare one adds exactly that one
 * declaration and moves nothing else: the guide is a fact about the AXIS, not
 * an act, so no commit and no `why()` row changes because of it.
 */
describe('a def declaring no zero guide is byte-identical to one written before law 12', () => {
  const USER: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'pick Formal' };

  /** The shared fixture, optionally with a frame on its POINT view — plus one act, so there is a commit and a `why()` to compare. */
  async function run(frame?: unknown): Promise<{ overview: unknown; record: unknown; why: unknown; view: unknown }> {
    const base = makeDashboardDef();
    const def = frame === undefined ? base : { ...base, encodings: base.encodings!.map((e) => (e.viewId === 'scatter' ? { ...e, frame } : e)) };
    const dashboard = buildDashboard(def as never);
    const session = dashboard.createSession();
    await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: USER });
    const overview = await session.overview();
    return { overview, record: session.log.records[0]!, why: session.why({ kind: 'chart', viewId: 'scatter' }), view: dashboard.def.encodings!.find((e) => e.viewId === 'scatter') };
  }

  it('no trace of the key anywhere a reader meets the run', async () => {
    const plain = await run();
    for (const [what, value] of Object.entries(plain)) expect(JSON.stringify(value), what).not.toContain('zeroGuide');
  });

  it('…and NONE of the four axis facts leaves a trace where none was declared — law 14 rides the same rail', async () => {
    const plain = await run();
    for (const key of ['zeroGuide', 'bounds']) {
      for (const [what, value] of Object.entries(plain)) expect(JSON.stringify(value), `${key} in ${what}`).not.toContain(key);
    }
    // `transform` is checked against the VIEW alone: the word is already in the overview for a different
    // reason (an analysis whose KIND is a transform), and a substring test cannot tell the two apart
    expect(JSON.stringify(plain.view)).not.toContain('transform');
  });

  it('declaring a numeric extent adds exactly that declaration — an axis is not an act, so no commit and no why() moves', async () => {
    const plain = await run();
    const bounded = await run({ x: { bounds: [-180, 180] }, y: { bounds: [-180, 180] } });
    expect(JSON.stringify(bounded.record)).toBe(JSON.stringify(plain.record));
    expect(JSON.stringify(bounded.why)).toBe(JSON.stringify(plain.why));
    const { frame, ...restOfView } = bounded.view as Record<string, unknown>;
    expect(frame).toEqual({ x: { bounds: [-180, 180] }, y: { bounds: [-180, 180] } });
    expect(JSON.stringify(restOfView)).toBe(JSON.stringify(plain.view));
  });

  it('declaring one adds exactly that declaration — the commit and why() do not move, because a guide is not an act', async () => {
    const plain = await run();
    const guided = await run({ x: { zeroGuide: true }, y: { zeroGuide: true } });
    expect(JSON.stringify(guided.record)).toBe(JSON.stringify(plain.record));
    expect(JSON.stringify(guided.why)).toBe(JSON.stringify(plain.why));
    // the VIEW carries it, and nothing else about that view changed
    const { frame, ...restOfView } = guided.view as Record<string, unknown>;
    expect(frame).toEqual({ x: { zeroGuide: true }, y: { zeroGuide: true } });
    expect(JSON.stringify(restOfView)).toBe(JSON.stringify(plain.view));
  });
});
