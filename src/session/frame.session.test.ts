/**
 * THE FRAME IS ITS LAYERS, at the session — the map decides, and the session
 * follows it for free: `clausesFor`, `why()` and `narrowedFor` are pure reads
 * of the graph, so a frame (a layered view with no view-level `initial`,
 * `LinkView.frame`) receives no clause, credits no commit and is never a
 * `narrowedFor` key. The ONE thing the session adds is the emission door: a
 * gesture landed AT a frame is refused in words naming the layers that read
 * for it (`session.ts` · `probeGuard`), under `guard-failed` — what refuses it
 * is what the view DECLARES, a definition to re-read.
 *
 * The exoplanet shape AG's demo proof found wrong: a brush on a histogram
 * layer over a minted table used to list the scatter's FRAME as a consumer
 * over `measurements` — a table that address never draws.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, layerAddress } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import type { Cause } from '../cause/index.js';
import type { Measure } from '../derive/index.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

const MEASUREMENTS = [
  { id: 'm1', planet: 'Kepler-22b', radius: 2.4, mass: 9.1 },
  { id: 'm2', planet: 'Kepler-22b', radius: 2.1, mass: 8.4 },
  { id: 'm3', planet: 'TRAPPIST-1e', radius: 0.9, mass: 0.7 },
];
const PLANETS = [
  { planet: 'Kepler-22b', mass: 9.1, radius: 2.4 },
  { planet: 'TRAPPIST-1e', mass: 0.7, radius: 0.9 },
];
const RADII: Measure = { as: 'radii', expr: { op: 'sum', args: [{ col: 'radius' }] } };
const MR_PLANETS = layerAddress('mass_radius', 'planets');
const BINS = layerAddress('radius', 'bins');

/**
 * `measurements` is the default table — the plain `sheet` reads it. The
 * scatter `mass_radius` draws ONE layer over `planets` and binds nothing of
 * its own (a frame). The histogram `radius` draws ONE layer over the MINTED
 * `radii_per_planet` (also a frame). A brush on the histogram's layer names
 * `radii`, which neither `planets` nor `measurements` has.
 */
function exoplanets(extra: Partial<DashboardDef> = {}): DashboardDef {
  return {
    meta: { title: 'exoplanets' },
    data: {
      measurements: { rows: [...MEASUREMENTS], key: 'id', columns: { id: { role: 'identifier' }, planet: { role: 'dimension' }, radius: { role: 'measure' }, mass: { role: 'measure' } } },
      planets: { rows: [...PLANETS], key: 'planet', columns: { planet: { role: 'dimension' }, mass: { role: 'measure' }, radius: { role: 'measure' } } },
    },
    actors: { mass_radius: { actor: 'user', label: 'Mass vs radius' }, sheet: { actor: 'user', label: 'Measurements' }, radius: { actor: 'user', label: 'Radius' } },
    analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [RADII] } },
    encodings: [
      { viewId: 'mass_radius', chartKind: 'point', channels: ['x', 'y'], layers: [{ layerId: 'planets', table: 'planets', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'mass', y: 'radius' } }] },
      { viewId: 'radius', chartKind: 'histogram', channels: ['x'], layers: [{ layerId: 'bins', table: 'radii_per_planet', chartKind: 'histogram', channels: ['x'], initial: { x: 'radii' } }] },
    ],
    defaultTable: 'measurements',
    ...extra,
  } as DashboardDef;
}

const FRAME_REFUSAL = `view "mass_radius" reads only through its layers — a gesture lands under one of them: ${MR_PLANETS}`;

describe('the map decides — a brush on the histogram layer reaches the scatter LAYER and the sheet, never the frame', () => {
  it('clausesFor: [] at the frame, the brush at its layer and at the sheet', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const brush = await s.dispatch({ verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], cause });
    expect(brush.ok).toBe(true);
    const reaching = { from: BINS, fromLabel: 'Radius', response: 'filter', clause: { kind: 'interval', field: 'radii', value: [1, 5] } };
    expect(s.clausesFor('mass_radius')).toEqual([]);
    expect(s.clausesFor(MR_PLANETS)).toEqual([reaching]);
    expect(s.clausesFor('sheet')).toEqual([reaching]);
    // the histogram's own frame is silent too — its layer's brush is not its own, and nothing else reaches a frame
    expect(s.clausesFor('radius')).toEqual([]);
  });

  it('narrowedFor has EXACTLY the keys of the two places that READ — the line AG\'s demo proof found wrong, pinned right', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    await s.dispatch({ verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], cause });
    const row = (await s.overview()).activeSelections[0]!;
    expect(Object.keys(row.narrowedFor!)).toEqual([MR_PLANETS, 'sheet']);
    expect(row.narrowedFor).toEqual({
      [MR_PLANETS]: { column: 'radii', reason: 'table "planets" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows', label: 'Mass vs radius' },
      sheet: { column: 'radii', reason: 'table "measurements" has no column "radii" — a sentence about a column these rows do not have is not a claim about these rows', label: 'Measurements' },
    });
  });

  it('why() over the frame credits no reaching-clause commit — the same answer as before any brush', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    await s.declareAnalysis('radiiPerPlanet', { cause });
    const before = s.why({ kind: 'chart', viewId: 'mass_radius' });
    await s.dispatch({ verb: 'filter', viewId: BINS, field: 'radii', range: [1, 5], cause });
    const after = s.why({ kind: 'chart', viewId: 'mass_radius' });
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('reaching-clause');
    // …while the layer that reads is credited, narrowed
    const layer = s.why({ kind: 'chart', viewId: MR_PLANETS });
    expect(layer.ok === false && layer.reached?.map((r) => r.kind)).toEqual(['reaching-clause']);
  });

  it('the map the session serves lists the frame with its readers, no `table`, and no edge in or out', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const g = (await s.overview()).links;
    expect(g.views.find((v) => v.viewId === 'mass_radius')).toEqual({ viewId: 'mass_radius', voice: ['point', 'interval', 'cell', 'match', 'encoding'], frame: [MR_PLANETS], channels: ['x', 'y'] });
    expect(g.edges.some((e) => e.source === 'mass_radius' || e.target === 'mass_radius' || e.source === 'radius' || e.target === 'radius')).toBe(false);
  });

  /**
   * REVIEW FIX (`offersOf`, ../session/offers.ts): a frame's own address was
   * still OFFERED for every voice kind, and every one of those offers is a gap
   * the emission door now refuses (above) — a promise the door breaks. The
   * frame's voice is not lost: its layer offers the SAME kinds under its own
   * address (`layerLinkViewOf` gives a layer its view's voice), so this is a
   * skip, never a narrowing of what an agent or a matrix can act on.
   */
  it('offers name the layer, never the frame — every offer the frame would have made is offered by its layer instead', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const offers = (await s.overview()).offers;
    expect(offers.some((o) => o.viewId === 'mass_radius')).toBe(false);
    expect(offers.some((o) => o.viewId === 'radius')).toBe(false);
    expect(offers.filter((o) => o.viewId === MR_PLANETS).map((o) => o.kind)).toEqual(['point', 'interval', 'cell', 'match']);
  });
});

describe('the emission door — a gesture at a frame is refused by name, under `guard-failed`', () => {
  it('select / filter / match at the frame: the ONE sentence, naming the layer to use; the same gesture lands at the layer', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'mass_radius', field: 'mass', value: 9.1, cause });
    expect(pick).toMatchObject({ ok: false, rejection: { code: 'guard-failed', op: 'select', detail: FRAME_REFUSAL, target: 'mass_radius' } });
    const brush = await s.dispatch({ verb: 'filter', viewId: 'mass_radius', field: 'mass', range: [1, 10], cause });
    expect(brush).toMatchObject({ ok: false, rejection: { code: 'guard-failed', op: 'filter', detail: FRAME_REFUSAL } });
    const match = await s.dispatch({ verb: 'select', viewId: 'mass_radius', field: 'planet', values: ['Kepler-22b'], cause });
    expect(match).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: FRAME_REFUSAL } });
    // nothing landed: no commit, no live clause, no key on the overview
    const o = await s.overview();
    expect(o.activeSelections).toEqual([]);
    expect(s.gaps().filter((g) => g.code === 'guard-failed' && g.detail === FRAME_REFUSAL)).toHaveLength(3);
    // the layer that reads for it takes the same gesture
    const landed = await s.dispatch({ verb: 'select', viewId: MR_PLANETS, field: 'mass', value: 9.1, cause });
    expect(landed.ok).toBe(true);
  });

  it('a cell select and a neighbourhood walk at the frame meet the same door — three probe paths, one sentence', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const cell = await s.dispatch({ verb: 'select', viewId: 'mass_radius', fields: ['planet', 'mass'], values: ['Kepler-22b', 9.1], cause });
    expect(cell).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: FRAME_REFUSAL } });
    const walk = await s.dispatch({ verb: 'select', viewId: 'mass_radius', field: 'planet', value: 'Kepler-22b', walk: { hops: 1 }, cause });
    expect(walk).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: FRAME_REFUSAL } });
  });

  it('the frame refusal comes BEFORE the capability: a mute frame is still told where a gesture lands', async () => {
    const s = buildDashboard(exoplanets({ capabilities: [{ viewId: 'mass_radius', canProbe: false }] })).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'mass_radius', field: 'mass', value: 9.1, cause });
    expect(pick).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: FRAME_REFUSAL } });
  });

  it('a layered view WITH a view-level `initial` reads at its own address — the gesture lands there exactly as before', async () => {
    const def = exoplanets();
    const own: DashboardDef = { ...def, encodings: [{ ...def.encodings![0]!, initial: { x: 'mass' } }, def.encodings![1]!] };
    const s = buildDashboard(own).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'mass_radius', field: 'mass', value: 9.1, cause });
    expect(pick.ok).toBe(true);
    expect(s.clausesFor('sheet').map((c) => c.from)).toEqual(['mass_radius']);
  });

  it('a runtime `link` edit naming the frame is refused in the def door\'s own words — the same door, rebound to the edge id', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    const into = await s.dispatch({ verb: 'link', source: 'sheet', kind: 'point', target: 'mass_radius', response: 'highlight', cause });
    expect(into).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: `link sheet:point→mass_radius.target "mass_radius" is a frame that reads only through its layers — name one: ${MR_PLANETS}` } });
    const outOf = await s.dispatch({ verb: 'link', source: 'mass_radius', kind: 'point', target: 'sheet', response: 'highlight', cause });
    expect(outOf).toMatchObject({ ok: false, rejection: { code: 'guard-failed', detail: `link mass_radius:point→sheet.source "mass_radius" is a frame that reads only through its layers — name one: ${MR_PLANETS}` } });
    // the same edge on the layer that reads lands
    expect((await s.dispatch({ verb: 'link', source: 'sheet', kind: 'point', target: MR_PLANETS, response: 'highlight', cause })).ok).toBe(true);
  });

  it('a saved picture with a condition at the frame is refused with the same sentence (the fourth caller of the one door), and the rest still lands', async () => {
    const s = buildDashboard(exoplanets()).createSession();
    // a saved condition names the frame directly — the door never let a gesture land there, but a picture is typed by hand
    expect(s.saveSelection('mixed', { conditions: [{ viewId: 'sheet', kind: 'point', field: 'planet', value: 'Kepler-22b' }, { viewId: 'mass_radius', kind: 'point', field: 'mass', value: 9.1 }] }).ok).toBe(true);
    const applied = await s.applySaved('mixed', cause);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.applied.map((c) => c.viewId)).toEqual(['sheet']);
    expect(applied.refused).toEqual([{ viewId: 'mass_radius', rejected: FRAME_REFUSAL }]);
  });
});
