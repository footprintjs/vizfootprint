/**
 * THE FRAME IS ITS LAYERS — a layered view's own address is a node of the link
 * graph that reads rows only when the view binds something at its own level
 * (a non-empty view-level `initial`). Otherwise the map lists it as a FRAME
 * (`LinkView.frame`: the layer addresses that read for it), the default rule
 * mints no edge into or out of it, and a declared edge naming it is refused at
 * the def door with those addresses as the remedy (../def/README.md "Layers",
 * law 6a). ONE owner of the question: `../def/layers.ts` · `readsOwnTable`.
 *
 * Found on the real exoplanet desk: a scatter whose one layer reads `planets`
 * and whose own surface binds nothing was a node over the DEFAULT table — a
 * table that address never draws — so the crossfilter minted edges into it,
 * the read narrowed them, and the chip said the chart read a table it never
 * read. The map now agrees with the layering ruling ("the frame is NOT a layer").
 */
import { describe, expect, it } from 'vitest';
import { materializeLinks } from './materialize.js';
import { validateLinks } from './validate.js';
import type { LinkView } from './types.js';
import { buildDashboard, layerAddress, validateDashboardDef } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { layerLinkViewOf, ownRowsOf, readsOwnTable } from '../def/layers.js';

const VOICE: LinkView['voice'] = ['point', 'interval', 'cell', 'match', 'encoding'];
const PLANETS_LAYER = { layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'mass', y: 'radius' } };
const MR_PLANETS = layerAddress('mass_radius', 'planets');

/**
 * The exoplanet shape: `measurements` is the default table (the sheet reads
 * it); the scatter `mass_radius` draws ONE layer over `planets` and binds
 * nothing at its own level. `own` lays a view-level `initial` over the scatter
 * — the one thing that makes its own address read the default table.
 */
function exoplanets(extra: Partial<DashboardDef> = {}, own?: Readonly<Record<string, string>>): DashboardDef {
  return {
    meta: { title: 'exoplanets' },
    data: {
      measurements: { rows: [{ id: 'm1', planet: 'Kepler-22b', radii: 2.4 }], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radii: { role: 'measure' } } },
      planets: { rows: [{ planet: 'Kepler-22b', mass: 9.1, radius: 2.4 }], key: 'planet', columns: { planet: { role: 'dimension' }, mass: { role: 'measure' }, radius: { role: 'measure' } } },
    },
    actors: { mass_radius: { actor: 'user', label: 'Mass vs radius' }, sheet: { actor: 'user', label: 'Measurements' } },
    encodings: [{ viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], ...(own !== undefined ? { initial: own } : {}), layers: [PLANETS_LAYER] }],
    defaultTable: 'measurements',
    ...extra,
  } as DashboardDef;
}

describe('readsOwnTable — the ONE owner of "does this view read rows at its own address"', () => {
  it('a view with no layers reads its own (the default) table — absent or EMPTY list alike', () => {
    expect(readsOwnTable({})).toBe(true);
    expect(readsOwnTable({ layers: [] })).toBe(true);
    expect(readsOwnTable({ layers: [], initial: {} })).toBe(true);
  });

  it('a layered view with a non-empty view-level `initial` binds something of its own, so it reads there too', () => {
    expect(readsOwnTable({ layers: [PLANETS_LAYER], initial: { x: 'planet' } })).toBe(true);
  });

  it('a layered view with no view-level `initial` (or an empty one) reads nothing at its own address — the frame is its layers', () => {
    expect(readsOwnTable({ layers: [PLANETS_LAYER] })).toBe(false);
    expect(readsOwnTable({ layers: [PLANETS_LAYER], initial: {} })).toBe(false);
  });

  it('ownRowsOf writes `table` OR `frame`, never both — and an unstated default table leaves a reading node unstated, as before', () => {
    expect(ownRowsOf('mass_radius', { layers: [PLANETS_LAYER] }, 'measurements')).toEqual({ frame: [MR_PLANETS] });
    expect(ownRowsOf('mass_radius', { layers: [PLANETS_LAYER], initial: { x: 'planet' } }, 'measurements')).toEqual({ table: 'measurements' });
    expect(ownRowsOf('plain', {}, 'measurements')).toEqual({ table: 'measurements' });
    expect(ownRowsOf('plain', {}, undefined)).toEqual({});
    // a malformed layer was refused on its own line and is nobody's reader; a frame with no default table is still a frame
    expect(ownRowsOf('mass_radius', { layers: [{ layerId: 'bad' }, PLANETS_LAYER] }, undefined)).toEqual({ frame: [MR_PLANETS] });
  });
});

describe('materializeLinks — a frame-only node gets no default edge in or out', () => {
  const FRAME: LinkView = { viewId: 'mass_radius', voice: VOICE, frame: [MR_PLANETS], channels: ['x', 'y'] };
  const LAYER = layerLinkViewOf('mass_radius', PLANETS_LAYER, VOICE);
  const SHEET: LinkView = { viewId: 'sheet', voice: ['point', 'interval'], table: 'measurements' };

  it('nothing reaches the frame and nothing leaves it; its layer and the sheet take the rule as before', () => {
    const g = materializeLinks([FRAME, LAYER, SHEET]);
    const ids = g.edges.map((e) => e.id);
    expect(ids.some((id) => id.startsWith('mass_radius:') || id.endsWith('→mass_radius'))).toBe(false);
    expect(ids).toEqual(['mass_radius~planets:point→sheet', 'mass_radius~planets:interval→sheet', 'mass_radius~planets:cell→sheet', 'mass_radius~planets:match→sheet', 'sheet:point→mass_radius~planets', 'sheet:interval→mass_radius~planets']);
    // a frame is NOT a refused edge — it is not a node that reads — so nothing is DECLINED for it
    expect(g.declined).toBeUndefined();
  });

  it('a layered view WITH a view-level `initial` is a node over the default table exactly as before — byte-identical graph', () => {
    const OWN: LinkView = { viewId: 'mass_radius', voice: VOICE, table: 'measurements', channels: ['x', 'y'] };
    const withOwn = materializeLinks([OWN, LAYER, SHEET]);
    const before = materializeLinks([{ viewId: 'mass_radius', voice: VOICE, table: 'measurements', channels: ['x', 'y'] }, LAYER, SHEET]);
    expect(JSON.stringify(withOwn)).toBe(JSON.stringify(before));
    expect(withOwn.edges.some((e) => e.source === 'mass_radius' && e.target === 'sheet')).toBe(true);
    expect(withOwn.edges.some((e) => e.source === 'sheet' && e.target === 'mass_radius')).toBe(true);
  });

  it('a declared edge INTO a frame and one OUT of it are refused by the frame\'s name, with the layers to use — never "not a declared view"', () => {
    const judge = (link: unknown): string[] => {
      const problems: string[] = [];
      validateLinks([link], undefined, [FRAME, LAYER, SHEET], problems);
      return problems;
    };
    expect(judge({ source: 'sheet', kind: 'point', target: 'mass_radius', response: 'filter' })).toEqual(['links[0].target "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets']);
    expect(judge({ source: 'mass_radius', kind: 'point', target: 'sheet', response: 'filter' })).toEqual(['links[0].source "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets']);
    // the layer that reads for it is named, and the edge stands
    expect(judge({ source: 'sheet', kind: 'point', target: MR_PLANETS, response: 'filter' })).toEqual([]);
    // the existing sentences are untouched: an undeclared end is still "not a declared view", an unnamed one still "must be a declared view id"
    expect(judge({ source: 'sheet', kind: 'point', target: 'ghost', response: 'filter' })).toEqual(['links[0].target "ghost" is not a declared view']);
    expect(judge({ source: '', kind: 'point', target: 'sheet', response: 'filter' })).toEqual(['links[0].source must be a declared view id']);
  });
});

describe('the def door and the build — the exoplanet shape', () => {
  it('the built map lists the scatter as a FRAME (its layer beside it), no edge touches it, and the sheet ↔ layer edges stand', async () => {
    const g = (await buildDashboard(exoplanets()).createSession().overview()).links;
    expect(g.views.map((v) => v.viewId)).toEqual(['mass_radius', 'sheet', MR_PLANETS]);
    const frame = g.views.find((v) => v.viewId === 'mass_radius')!;
    expect(frame.frame).toEqual([MR_PLANETS]);
    expect(frame).not.toHaveProperty('table');
    expect(g.views.find((v) => v.viewId === 'sheet')).toEqual({ viewId: 'sheet', voice: ['point', 'interval', 'cell', 'match'], table: 'measurements' });
    expect(g.views.find((v) => v.viewId === MR_PLANETS)!.table).toBe('planets');
    expect(g.edges.some((e) => e.source === 'mass_radius' || e.target === 'mass_radius')).toBe(false);
    expect(g.edges.map((e) => e.id)).toEqual(['sheet:point→mass_radius~planets', 'sheet:interval→mass_radius~planets', 'sheet:cell→mass_radius~planets', 'sheet:match→mass_radius~planets', 'mass_radius~planets:point→sheet', 'mass_radius~planets:interval→sheet', 'mass_radius~planets:cell→sheet', 'mass_radius~planets:match→sheet']);
    expect(g.declined).toBeUndefined();
  });

  it('a view-level `initial` makes the scatter read the default table at its own address — `table`, no `frame`, edges as before', async () => {
    const g = (await buildDashboard(exoplanets({}, { x: 'radii' })).createSession().overview()).links;
    const own = g.views.find((v) => v.viewId === 'mass_radius')!;
    expect(own.table).toBe('measurements');
    expect(own).not.toHaveProperty('frame');
    expect(g.edges.some((e) => e.source === 'sheet' && e.target === 'mass_radius')).toBe(true);
    expect(g.edges.some((e) => e.source === 'mass_radius' && e.target === 'sheet')).toBe(true);
  });

  it('the def door refuses a declared edge into or out of the frame in the ONE sentence, and accepts the same edge on the layer', () => {
    expect(validateDashboardDef(exoplanets({ links: [{ source: 'sheet', kind: 'point', target: 'mass_radius', response: 'highlight' }] }))).toEqual(['links[0].target "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets']);
    expect(validateDashboardDef(exoplanets({ links: [{ source: 'mass_radius', kind: 'point', target: 'sheet', response: 'highlight' }] }))).toEqual(['links[0].source "mass_radius" is a frame that reads only through its layers — name one: mass_radius~planets']);
    expect(validateDashboardDef(exoplanets({ links: [{ source: 'sheet', kind: 'point', target: MR_PLANETS, response: 'highlight' }] }))).toEqual([]);
    // …and with a view-level `initial` the scatter reads at its own address, so the same edge is legal there
    expect(validateDashboardDef(exoplanets({ links: [{ source: 'sheet', kind: 'point', target: 'mass_radius', response: 'highlight' }] }, { x: 'radii' }))).toEqual([]);
  });

  it('the door and the build write the SAME node for the same view — the twins share one owner', async () => {
    // the door's `links.views` is not served, so it is proved through what each door SAYS about one address: the raw door
    // refuses an edge into it as a frame naming exactly the layers the built map lists under `frame`
    const def = exoplanets({ links: [{ source: 'sheet', kind: 'point', target: 'mass_radius', response: 'highlight' }] });
    const [refusal] = validateDashboardDef(def);
    const built = (await buildDashboard(exoplanets()).createSession().overview()).links.views.find((v) => v.viewId === 'mass_radius')!;
    expect(refusal!.endsWith(`name one: ${built.frame!.join(', ')}`)).toBe(true);
  });
});
