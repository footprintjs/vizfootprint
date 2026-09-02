import { describe, it, expect } from 'vitest';
import { buildDashboard, validateDashboardDef } from './index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

/** Layer 4 on the def: declared links validate with the def, materialize into the runtime, and reach the overview. */
describe('links on the dashboard def', () => {
  it('a capability may now declare match; a bad link is refused with the def', () => {
    const base = makeDashboardDef();
    expect(validateDashboardDef({ ...base, capabilities: [...(base.capabilities ?? []), { viewId: 'bar', canProbe: true, encodings: ['point', 'match'] }] })).toEqual([]);
    expect(validateDashboardDef({ ...base, links: [{ source: 'bar', kind: 'point', target: 'nowhere', response: 'filter' }] })).toEqual(['links[0].target "nowhere" is not a declared view']);
    expect(validateDashboardDef({ ...base, linkDefault: 'maybe' })).toEqual(['linkDefault, if present, must be one of crossfilter|none']);
    expect(() => buildDashboard({ ...base, links: [{ source: 'bar', kind: 'point', target: 'bar', response: 'filter' }] })).toThrow(/cannot link to itself/);
  });

  it('the runtime carries the materialized graph and the overview serves it: defaults written out, a declared edge in place', async () => {
    const base = makeDashboardDef();
    const declared = { source: 'bar', kind: 'point' as const, target: 'scatter', response: 'highlight' as const };
    const session = buildDashboard({ ...base, links: [declared] }).createSession();
    const ov = await session.overview();
    expect(ov.links.default).toBe('crossfilter');
    const probeable = ov.views.filter((v) => v.canProbe).map((v) => v.viewId);
    for (const v of ov.links.views) expect(probeable.includes(v.viewId) ? v.voice.length > 0 : v.voice.length === 0).toBe(true);
    const edge = ov.links.edges.find((e) => e.id === 'bar:point→scatter')!;
    expect(edge).toMatchObject({ ...declared, origin: 'declared' });
    expect(ov.links.edges.filter((e) => e.origin === 'default').every((e) => e.response === 'filter' && e.source !== e.target)).toBe(true);
    // a view with no links declared reads the same graph, all default
    const plain = await buildDashboard(base).createSession().overview();
    expect(plain.links.edges.every((e) => e.origin === 'default')).toBe(true);
    expect(plain.links.edges.length).toBe(ov.links.edges.length);
  });
});
