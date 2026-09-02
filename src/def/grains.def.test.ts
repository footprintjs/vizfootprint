/**
 * The def door for `grains` and the fold law over declared links: a crossing
 * edge without a fold is refused at build; the runtime's link views carry each
 * view's grain, and the default rule's crossing edges say `crossfilter`.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, validateDashboardDef } from './index.js';
import type { DashboardDef } from './index.js';
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
    expect(at([{ viewId: 'bar', keys: ['category'] }, { viewId: 'bar', keys: [] }])).toEqual(['grains[1] repeats the grain of "bar" — one grain per view']);
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

describe('a view\'s does sentence', () => {
  it('must be a sentence when present', () => {
    const def = makeDashboardDef();
    expect(validateDashboardDef({ ...def, actors: { ...def.actors, bar: { actor: 'user', does: '   ' } } })).toEqual(['actors["bar"].does, if present, must be a sentence: what acting on the view does']);
    expect(validateDashboardDef({ ...def, actors: { ...def.actors, bar: { actor: 'user', does: 'pick a category' } } })).toEqual([]);
  });
});
