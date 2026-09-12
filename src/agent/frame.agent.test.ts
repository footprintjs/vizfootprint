/**
 * `whats_here.links` carries `LinkView.frame` as the map states it — THE FRAME
 * IS ITS LAYERS (../def/README.md "Layers", law 6a). Nothing in `src/agent`
 * projects a link view field by field (`links` is served whole, the base graph
 * with this branch's `link` edits laid over its EDGES — `surfaceParts.ts`), so
 * there is nothing to add here: this file is the PROOF that the key rides,
 * that a gesture the agent lands at a frame is refused by name through the
 * tool port, and that a dashboard with no frame never gains the key.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, vizAsTools } from './index.js';
import { layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { VizToolResult, VizToolsPort } from './index.js';

const answer = (r: VizToolResult): Record<string, unknown> => r as Record<string, unknown>;
const portOf = (def: DashboardDef): VizToolsPort => vizAsTools(buildDashboard(def).createSession({ as: 'agent' }), { as: 'agent' });
const here = async (p: VizToolsPort, args?: Record<string, unknown>): Promise<Record<string, unknown>> => answer(await p.call('viz.whats_here', args));

const MR_PLANETS = layerAddress('mass_radius', 'planets');
/** `../session/frame.session.test.ts`'s shape, minus the histogram: a scatter with one layer over `planets` and no own binding, a sheet over the default table. */
const EXOPLANETS: DashboardDef = {
  meta: { title: 'exoplanets' },
  data: {
    measurements: { rows: [{ id: 'm1', planet: 'Kepler-22b', radius: 2.4 }], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' } } },
    planets: { rows: [{ planet: 'Kepler-22b', mass: 9.1, radius: 2.4 }], key: 'planet', columns: { planet: { role: 'dimension' }, mass: { role: 'measure' }, radius: { role: 'measure' } } },
  },
  actors: { mass_radius: { actor: 'user', label: 'Mass vs radius' }, sheet: { actor: 'user', label: 'Measurements' } },
  encodings: [{ viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'mass', y: 'radius' } }] }],
  defaultTable: 'measurements',
} as DashboardDef;

type Graph = { views: { viewId: string; table?: string; frame?: string[] }[]; edges: { source: string; target: string }[] };

describe('`whats_here.links` — the frame rides the served map, whole', () => {
  it('the frame is LISTED with its readers beside it, carries no table, and no edge touches it', async () => {
    const links = (await here(portOf(EXOPLANETS)))['links'] as Graph;
    const frame = links.views.find((v) => v.viewId === 'mass_radius')!;
    expect(frame.frame).toEqual([MR_PLANETS]);
    expect('table' in frame).toBe(false);
    expect(links.views.find((v) => v.viewId === MR_PLANETS)!.table).toBe('planets');
    expect(links.edges.some((e) => e.source === 'mass_radius' || e.target === 'mass_radius')).toBe(false);
  });

  it('the narrowed (`of`) serving hands the same `links` part back, key included', async () => {
    const p = portOf(EXOPLANETS);
    const full = JSON.stringify((await here(p))['links']);
    expect(JSON.stringify((await here(p, { of: ['links'] }))['links'])).toBe(full);
    expect(full).toContain('"frame":["mass_radius~planets"]');
  });

  it('a gesture the agent lands AT the frame is refused through the port by name, and the layer it names takes it', async () => {
    const p = portOf(EXOPLANETS);
    const refused = answer(await p.call('viz.dispatch', { verb: 'select', viewId: 'mass_radius', field: 'mass', value: 9.1, intent: 'a pick at the frame' }));
    // pin the verbatim sentence through the port's OWN gap shape, not a JSON.stringify + toContain
    expect(refused).toMatchObject({ ok: false, gap: { code: 'guard-failed', op: 'select', detail: `view "mass_radius" reads only through its layers — a gesture lands under one of them: ${MR_PLANETS}`, target: 'mass_radius' } });
    const landed = answer(await p.call('viz.dispatch', { verb: 'select', viewId: MR_PLANETS, field: 'mass', value: 9.1, intent: 'a pick at the layer' }));
    expect(landed['ok']).toBe(true);
  });

  it('the existing fixture (no layers anywhere) never gains the key — byte-identical to the answer before it existed', async () => {
    const a = await here(portOf(makeDashboardDef()));
    expect(JSON.stringify(a['links'])).not.toContain('"frame"');
  });
});
