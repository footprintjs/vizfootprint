/**
 * The dashboard subject of the prose plane: `describe` with viewId
 * 'dashboard' sets the cockpit's own words — its caption is the summary of
 * what the whole dashboard shows now — judged by the same laws as a view's,
 * with two of its own: nothing derived, no encodings in a basis.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, validateDashboardDef } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { vizAsTools } from '../agent/vizAsTools.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { ProseRecord } from '../prose/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const declared: ProseRecord = { text: 'Prices and ratings across every category.', author: { kind: 'human', by: 'the author' } };
const withDashboard = (): DashboardDef => ({ ...makeDashboardDef(), prose: [{ viewId: 'dashboard', slots: { title: { text: 'The catalogue desk', author: { kind: 'human' } }, caption: declared } }] });

describe('the dashboard subject', () => {
  it('declares like a view, rides the overview as `dashboard`, and is refused what it cannot carry', async () => {
    expect(validateDashboardDef(withDashboard())).toEqual([]);
    const derived: DashboardDef = { ...makeDashboardDef(), prose: [{ viewId: 'dashboard', slots: { howToRead: { author: { kind: 'derived' } } } }] };
    expect(validateDashboardDef(derived)).toEqual(["prose[0].howToRead: the dashboard's howToRead cannot be derived — the dashboard binds nothing; write the words"]);
    const s = buildDashboard(withDashboard()).createSession();
    const o = await s.overview();
    expect(o.dashboard.prose.map((p) => [p.slot, p.status, p.text])).toEqual([
      ['title', 'current', 'The catalogue desk'],
      ['caption', 'current', 'Prices and ratings across every category.'],
    ]);
    expect(o.dashboard.proposals).toEqual([]);
    expect(o.views.map((v) => v.viewId)).not.toContain('dashboard'); // the subject is not a view
    expect((await buildDashboard(makeDashboardDef()).createSession().overview()).dashboard).toEqual({ prose: [], proposals: [] });
  });

  it('an agent summary states filters as its basis, lands under prose:dashboard, and goes stale when the selection moves', async () => {
    const s = buildDashboard(withDashboard()).createSession();
    const summary: ProseRecord = { text: 'Formal items, 40–60.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { filters: {}, columns: ['price', 'category'] } };
    const res = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: summary, cause: userCause('summarise') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.commit?.viewId).toBe('prose:dashboard');
    expect(res.commit?.field).toBe('caption');
    expect(res.described?.status).toBe('current');
    expect((await s.overview()).dashboard.prose.find((p) => p.slot === 'caption')?.text).toBe('Formal items, 40–60.');
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const stale = (await s.overview()).dashboard.prose.find((p) => p.slot === 'caption')!;
    expect(stale.status).toBe('stale');
    expect(stale.changed).toEqual(['filters']);
    // back to the declaration
    const back = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: null, cause: userCause() });
    expect(back.ok).toBe(true);
    expect((await s.overview()).dashboard.prose.find((p) => p.slot === 'caption')?.text).toBe(declared.text);
    // why names the landing commit of the live words
    const why = s.why({ kind: 'prose', viewId: 'dashboard', slot: 'caption' });
    expect(why.ok).toBe(false); // the live words are the declaration again
    if (!why.ok) expect(why.missing).toBe('declared-in-def');
    const again = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: summary, cause: userCause() });
    const whyNow = s.why({ kind: 'prose', viewId: 'dashboard', slot: 'caption' });
    expect(whyNow.ok).toBe(true);
    if (whyNow.ok && again.ok) expect(whyNow.viz.commitId).toBe(again.commit?.id);
  });

  it('refuses a basis that states encodings, and a derived slot, with the dashboard sentences', async () => {
    const s = buildDashboard(withDashboard()).createSession();
    const bound = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: 'x', author: { kind: 'agent' }, basis: { encodings: { x: 'price' } } }, cause: userCause() });
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.rejection.detail).toContain('states encodings in its basis, but the dashboard binds nothing');
    const derived = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'howToRead', record: { author: { kind: 'derived' } }, cause: userCause() });
    expect(derived.ok).toBe(false);
    if (!derived.ok) expect(derived.rejection.detail).toContain('cannot be derived');
    // any other unknown id is still a missing view
    const ghost = await s.dispatch({ verb: 'describe', viewId: 'ghost', slot: 'title', record: declared, cause: userCause() });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.rejection.code).toBe('needs-view');
  });

  it('a person editing the agent summary is re-stamped to the live filters with NO encodings; a proposal rides dashboard.proposals', async () => {
    const s = buildDashboard(withDashboard()).createSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const edited: ProseRecord = { text: 'Formal items only.', author: { kind: 'humanEdited', by: 'sanjay' }, basis: { filters: { stale: 'yes' }, columns: ['price'] } };
    const res = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: edited, cause: userCause('fix the summary') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const basis = res.described!.record.basis!;
    expect(basis.encodings).toBeUndefined();
    expect(basis.filters).toEqual({ bar: { field: 'category', kind: 'point', value: 'Formal' } });
    expect(basis.editedFrom).toEqual({ filters: { stale: 'yes' }, columns: ['price'] });
    expect(res.described!.status).toBe('current');
    const draft: ProseRecord = { text: 'Mostly formal wear.', author: { kind: 'agent', model: 'm' }, levels: ['trend'], basis: { filters: basis.filters } };
    const proposed = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: draft, proposal: true, cause: userCause('draft') });
    expect(proposed.ok).toBe(true);
    const o = await s.overview();
    expect(o.dashboard.proposals.map((p) => [p.slot, p.status, p.record.text])).toEqual([['caption', 'open', 'Mostly formal wear.']]);
    expect(o.dashboard.prose.find((p) => p.slot === 'caption')?.text).toBe('Formal items only.');
  });

  it('overview.filters is the basis shape: a record that copies it is current after the selection it names, and a list is refused', async () => {
    const s = buildDashboard(withDashboard()).createSession();
    expect((await s.overview()).filters).toEqual({});
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const filters = (await s.overview()).filters;
    expect(filters).toEqual({ bar: { field: 'category', kind: 'point', value: 'Formal' } });
    // the premise liveClauses rests on: a LIVE clause always carries kind + field (an empty clause can only come from a basis), and a clear DELETES the key
    for (const clause of Object.values(filters)) expect(Object.keys(clause as object)).toEqual(expect.arrayContaining(['kind', 'field']));
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: null, cause: userCause('clear') });
    expect((await s.overview()).filters).toEqual({});
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const copied = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: 'Formal only.', author: { kind: 'agent' }, levels: ['statistic'], basis: { filters } }, cause: userCause() });
    expect(copied.ok && copied.described?.status).toBe('current');
    const listed = await s.dispatch({ verb: 'describe', viewId: 'dashboard', slot: 'caption', record: { text: 'x', author: { kind: 'agent' }, basis: { filters: [] as unknown as Record<string, unknown> } }, cause: userCause() });
    expect(!listed.ok && listed.rejection.detail).toContain('basis.filters must be a record keyed by view');
  });

  it('whats_here carries the dashboard words; the dispatch tool says the id is accepted for describe', async () => {
    const s = buildDashboard(withDashboard()).createSession();
    const port = vizAsTools(s);
    const here = (await port.call('viz.whats_here')) as { dashboard: { prose: { slot: string; text: string }[] } };
    expect(here.dashboard.prose.map((p) => p.slot)).toEqual(['title', 'caption']);
    const dispatch = port.tools().find((t) => t.name === 'viz.dispatch')!;
    const viewId = (dispatch.inputSchema as { properties: { viewId: { description: string } } }).properties.viewId.description;
    expect(viewId).toContain('"dashboard"');
  });
});
