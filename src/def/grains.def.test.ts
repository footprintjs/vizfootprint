/**
 * The def door for `grains` and the fold law over declared links: a crossing
 * edge without a fold is refused at build; the runtime's link views carry the
 * grain declared at each ADDRESS, and the default rule's crossing edges say
 * `crossfilter`.
 *
 * A GRAIN IS DECLARED WHERE THE MARKS ARE (./README.md, law 6c): the second
 * describe below is that law's door — a layer address is accepted, a FRAME is
 * refused with the addresses that draw, and a view that binds at its own level
 * keeps its view-level grain exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, layerAddress, validateDashboardDef } from './index.js';
import type { DashboardDef } from './index.js';
import { edgesLayer, makeNetworkDef, nodesLayer } from './network.fixture.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

const withGrains = (extra: Partial<DashboardDef> = {}): DashboardDef => ({
  ...makeDashboardDef(),
  grains: [
    { viewId: 'bar', keys: ['category'] },
    { viewId: 'scatter', keys: [] },
  ],
  ...extra,
});

describe('grains — the def door', () => {
  it('accepts well-formed grains and refuses each malformed shape with its sentence', () => {
    expect(validateDashboardDef(withGrains())).toEqual([]);
    const at = (grains: unknown): string[] => validateDashboardDef({ ...makeDashboardDef(), grains } as unknown);
    expect(at('bar')).toEqual(['grains, if present, must be an array of { viewId, keys }']);
    expect(at(['bar'])).toEqual(['grains[0] must be an object { viewId, keys }']);
    expect(at([{ viewId: '', keys: [] }])).toEqual(['grains[0].viewId must be a non-empty string']);
    expect(at([{ viewId: 'ghost', keys: [] }])).toEqual(['grains[0].viewId "ghost" is not a declared view']);
    expect(at([{ viewId: 'bar', keys: ['category'] }, { viewId: 'bar', keys: [] }])).toEqual(['grains[1] repeats the grain of "bar" — one grain per address']);
    expect(at([{ viewId: 'bar', keys: 'category', extra: 1 }])).toEqual(['grains[0].extra is not a grain key', 'grains[0].keys must be an array of column names ([] = one mark per row)']);
    expect(at([{ viewId: 'bar', keys: ['category', 'category'] }])).toEqual(['grains[0].keys repeats a column']);
    expect(at([{ viewId: 'bar', keys: [''] }])).toEqual(['grains[0].keys must be an array of column names ([] = one mark per row)']);
  });
  it('a declared link that crosses grains must state its fold — the same sentence at the def door and at build', () => {
    const crossing = withGrains({ links: [{ source: 'bar', kind: 'point', target: 'scatter', response: 'filter' }] });
    expect(validateDashboardDef(crossing)).toEqual(['links[0]: view "bar" emits over category and view "scatter" shows rows — an edge that crosses grains must state its fold']);
    expect(() => buildDashboard(crossing)).toThrow(/must state its fold/);
    const folded = withGrains({ links: [{ source: 'bar', kind: 'point', target: 'scatter', response: 'filter', fold: 'every row of the picked category' }] });
    expect(validateDashboardDef(folded)).toEqual([]);
    const graph = buildDashboard(folded).createSession().log; // builds
    expect(graph).toBeDefined();
  });
  it('the runtime carries each view\'s grain on the link views; the default rule\'s crossing edges say crossfilter', async () => {
    const dash = buildDashboard(withGrains());
    const links = (await dash.createSession().overview()).links;
    expect(links.views.find((v) => v.viewId === 'bar')?.grain).toEqual(['category']);
    expect(links.views.find((v) => v.viewId === 'scatter')?.grain).toEqual([]);
    expect(links.views.find((v) => v.viewId === 'cluster')?.grain).toBeUndefined();
    expect(links.edges.find((e) => e.source === 'bar' && e.target === 'scatter')?.fold).toBe('crossfilter');
    expect(links.edges.find((e) => e.source === 'scatter' && e.target === 'bar')?.fold).toBeUndefined();
  });
});

/**
 * The network fixture is a FRAME: `net` declares two layers (`nodes`, then
 * `edges`) and binds nothing at its own level, so its own address draws no
 * marks. `list` is a second view with no encoding, reading the default table
 * (`nodes`) — somewhere for a default edge to come from.
 */
const NODES_AT = layerAddress('net', 'nodes');
const EDGES_AT = layerAddress('net', 'edges');
const withLayerGrains = (grains: unknown, extra: Partial<DashboardDef> = {}): DashboardDef =>
  makeNetworkDef(undefined, { actors: { net: { actor: 'user', label: 'Disease network' }, list: { actor: 'user' } }, grains, ...extra } as Partial<DashboardDef>);

describe('a grain is declared where the marks are', () => {
  it('accepts a grain at a declared LAYER address — one per address, and an undeclared layer is not a declared view', () => {
    const at = (grains: unknown): string[] => validateDashboardDef(withLayerGrains(grains));
    expect(at([{ viewId: NODES_AT, keys: ['id'] }, { viewId: EDGES_AT, keys: ['source', 'target'] }])).toEqual([]);
    expect(at([{ viewId: NODES_AT, keys: ['id'] }, { viewId: NODES_AT, keys: [] }])).toEqual([`grains[1] repeats the grain of "${NODES_AT}" — one grain per address`]);
    expect(at([{ viewId: layerAddress('net', 'ghost'), keys: [] }])).toEqual(['grains[0].viewId "net~ghost" is not a declared view']);
    // an address whose VIEW nobody declared is nobody's place either: its layers are nobody's nodes of the link graph
    // (`layerLinkViewsOf` skips them), so the door says it about the whole address rather than half-declaring one
    expect(validateDashboardDef(withLayerGrains([{ viewId: layerAddress('ghost', 'nodes'), keys: [] }], {
      encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers: [nodesLayer, edgesLayer] }, { viewId: 'ghost', chartKind: 'bar', channels: ['x'], layers: [nodesLayer] }],
    }))).toEqual(['grains[0].viewId "ghost~nodes" is not a declared view']);
  });

  it('refuses a grain on a FRAME, naming the layer addresses that draw in declaration order', () => {
    expect(validateDashboardDef(withLayerGrains([{ viewId: 'net', keys: ['id'] }]))).toEqual([
      `grains[0].viewId "net" is a frame that draws no marks of its own — declare the grain where the marks are: ${NODES_AT}, ${EDGES_AT}`,
    ]);
    // …and the refusal is the door's, so the build raises it too
    expect(() => buildDashboard(withLayerGrains([{ viewId: 'net', keys: ['id'] }]))).toThrow(/draws no marks of its own/);
  });

  it('a view that binds at its own level DRAWS, so it keeps its view-level grain — and its layers may declare their own beside it', () => {
    const binds = withLayerGrains([{ viewId: 'net', keys: ['group'] }, { viewId: NODES_AT, keys: ['id'] }], {
      encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y', 'size'], initial: { size: 'size' }, layers: [nodesLayer, edgesLayer] }],
    });
    expect(validateDashboardDef(binds)).toEqual([]);
  });

  it('the map carries the layer\'s grain and the frame carries none — and a default edge that crosses into a layer says crossfilter', async () => {
    const def = withLayerGrains([{ viewId: 'list', keys: ['group'] }, { viewId: NODES_AT, keys: ['id'] }]);
    expect(validateDashboardDef(def)).toEqual([]);
    const links = (await buildDashboard(def).createSession().overview()).links;
    expect(links.views.find((v) => v.viewId === NODES_AT)?.grain).toEqual(['id']);
    expect(links.views.find((v) => v.viewId === 'net')).not.toHaveProperty('grain'); // a frame declares none — the door refused it
    expect(links.views.find((v) => v.viewId === EDGES_AT)).not.toHaveProperty('grain'); // nothing declared there: absent, never `[]`
    expect(links.edges.find((e) => e.id === `list:point→${NODES_AT}`)?.fold).toBe('crossfilter');
    expect(links.edges.find((e) => e.id === `${NODES_AT}:point→list`)?.fold).toBe('crossfilter');
  });

  it('a DECLARED edge across grains must state its fold at a layer address too — the layer as target and as source', () => {
    const declare = (link: unknown): string[] => validateDashboardDef(withLayerGrains([{ viewId: 'list', keys: ['group'] }, { viewId: NODES_AT, keys: ['id'] }], { links: [link] } as Partial<DashboardDef>));
    expect(declare({ source: 'list', kind: 'point', target: NODES_AT, response: 'highlight' })).toEqual([`links[0]: view "list" emits over group and view "${NODES_AT}" shows id — an edge that crosses grains must state its fold`]);
    expect(declare({ source: NODES_AT, kind: 'point', target: 'list', response: 'filter' })).toEqual([`links[0]: view "${NODES_AT}" emits over id and view "list" shows group — an edge that crosses grains must state its fold`]);
    expect(declare({ source: NODES_AT, kind: 'point', target: 'list', response: 'filter', fold: 'every row of the picked disease' })).toEqual([]);
    // the same two nodes over the SAME grain cross nothing, so the fold stays optional
    expect(validateDashboardDef(withLayerGrains([{ viewId: 'list', keys: ['id'] }, { viewId: NODES_AT, keys: ['id'] }], { links: [{ source: NODES_AT, kind: 'point', target: 'list', response: 'filter' }] } as Partial<DashboardDef>))).toEqual([]);
  });
});

describe('a view\'s does sentence', () => {
  it('must be a sentence when present', () => {
    const def = makeDashboardDef();
    expect(validateDashboardDef({ ...def, actors: { ...def.actors, bar: { actor: 'user', does: '   ' } } })).toEqual(['actors["bar"].does, if present, must be a sentence: what acting on the view does']);
    expect(validateDashboardDef({ ...def, actors: { ...def.actors, bar: { actor: 'user', does: 'pick a category' } } })).toEqual([]);
  });
});
