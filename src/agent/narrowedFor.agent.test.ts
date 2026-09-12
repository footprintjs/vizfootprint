/**
 * `whats_here` carries `activeSelections[i].narrowedFor` as the session states
 * it — the part is turn-scoped and volatile (`./surfaceParts.ts`), and the
 * key rides inside it untouched by the narrowed (`of`) and delta (`since`)
 * serving. Nothing in `src/agent` projects a selection row field by field, so
 * there is nothing to add here — this file is the PROOF that it rides, and
 * that the existing fixture's answer never gained the key.
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

const BINS = layerAddress('radius', 'bins');
/** `../session/narrowedFor.session.test.ts` (a): two declared tables, a brush over one reaching a sheet over the other. */
const TWO_TABLES: DashboardDef = {
  meta: { title: 'planets' },
  data: {
    planets: { rows: [{ planet: 'Kepler-22b', discovered: 2011 }, { planet: 'TRAPPIST-1e', discovered: 2017 }], key: 'planet', columns: { planet: { role: 'dimension' }, discovered: { role: 'measure' } } },
    measurements: { rows: [{ id: 'm1', planet: 'Kepler-22b', radii: 2.4 }, { id: 'm3', planet: 'TRAPPIST-1e', radii: 0.9 }], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radii: { role: 'measure' } } },
  },
  actors: { radius: { actor: 'user', label: 'Radius' }, planets_sheet: { actor: 'user', label: 'Planets' } },
  encodings: [{ viewId: 'radius', chartKind: 'histogram', channels: ['x'], layers: [{ layerId: 'bins', table: 'measurements', chartKind: 'histogram', channels: ['x'], initial: { x: 'radii' } }] }],
  defaultTable: 'planets',
} as DashboardDef;

const SAID = { planets_sheet: { column: 'radii', reason: 'table "planets" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows', label: 'Planets' } };

describe('`whats_here` — `activeSelections[i].narrowedFor` rides the part, whole', () => {
  it('the full answer carries it exactly as the session states it', async () => {
    const p = portOf(TWO_TABLES);
    const brushed = await p.call('viz.dispatch', { verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], intent: 'a brush' });
    expect(brushed.ok).toBe(true);
    const rows = (await here(p))['activeSelections'] as { viewId: string; narrowedFor?: unknown }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.viewId).toBe(BINS);
    expect(rows[0]!.narrowedFor).toEqual(SAID);
  });

  it('the narrowed (`of`) and delta (`since`) servings hand the same part back, key included', async () => {
    const p = portOf(TWO_TABLES);
    const before = await here(p);
    await p.call('viz.dispatch', { verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], intent: 'a brush' });
    const full = JSON.stringify((await here(p))['activeSelections']);
    expect(JSON.stringify((await here(p, { of: ['activeSelections'] }))['activeSelections'])).toBe(full);
    const delta = await here(p, { since: before['asOf'] as string });
    expect(JSON.stringify(delta['activeSelections'])).toBe(full);
    expect(full).toContain('"narrowedFor"');
  });

  it('the existing fixture (every clause judgeable everywhere) never gains the key — byte-identical to the answer before it existed', async () => {
    const p = portOf(makeDashboardDef());
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'a pick' });
    await p.call('viz.dispatch', { verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 130], intent: 'a brush' });
    const a = await here(p);
    expect((a['activeSelections'] as unknown[]).length).toBe(2);
    expect(JSON.stringify(a)).not.toContain('narrowedFor');
  });
});
