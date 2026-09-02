/**
 * The prose plane end to end: declared words at build, the `describe` verb at
 * dispatch (refused with the same sentences), staleness derived at read, the
 * fold across undo and seek, and the agent's door.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, validateDashboardDef } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { vizAsTools } from '../agent/vizAsTools.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';
import type { ProseRecord } from '../prose/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const title: ProseRecord = { text: 'Price against rating', author: { kind: 'human', by: 'sanjay' } };
const caption: ProseRecord = { text: 'Higher prices rate higher.', author: { kind: 'agent', model: 'm' }, levels: ['trend'], basis: { encodings: { x: 'price', y: 'rating' }, filters: {}, columns: ['price', 'rating'] } };
const withProse = (): DashboardDef => ({ ...makeDashboardDef(), prose: [{ viewId: 'scatter', slots: { title, caption, howToRead: { author: { kind: 'derived' } } } }] });

describe('the def door and the lint door', () => {
  it('declared words build and show on the overview with their status; a bad declaration throws with the sentence', async () => {
    const s = buildDashboard(withProse()).createSession();
    const scatter = (await s.overview()).views.find((v) => v.viewId === 'scatter')!;
    expect(scatter.prose.map((p) => [p.slot, p.status, p.text])).toEqual([
      ['title', 'current', 'Price against rating'],
      ['caption', 'current', 'Higher prices rate higher.'],
      ['howToRead', 'derived', 'a point with price on x, rating on y'],
    ]);
    expect((await s.overview()).views.find((v) => v.viewId === 'bar')!.prose).toEqual([]);
    const bad: DashboardDef = { ...makeDashboardDef(), prose: [{ viewId: 'scatter', slots: { caption: { text: 'because', author: { kind: 'agent' } } } }, { viewId: 'ghost', slots: {} }, { viewId: 'cluster', slots: { howToRead: { author: { kind: 'derived' } } } }] };
    expect(validateDashboardDef(bad)).toEqual([
      'prose[0].caption: "scatter".caption was written by an agent and states no basis — without one, a model\'s words are indistinguishable from stated fact',
      'prose[1].viewId "ghost" is not a declared view',
      'prose[2].howToRead: "cluster".howToRead is derived, but "cluster" declares no encoding surface — there is nothing to derive from',
    ]);
    expect(() => buildDashboard(bad)).toThrow(/states no basis/);
  });
  it('lintProse judges a basis against the real columns; a stub engine cannot lint', async () => {
    const def: DashboardDef = { ...makeDashboardDef(), prose: [{ viewId: 'scatter', slots: { caption: { ...caption, basis: { columns: ['price', 'mystery'] } } } }] };
    expect(validateDashboardDef(def)).toEqual([]); // the def alone cannot know the columns
    expect((await buildDashboard(def).lintProse()).map((p) => p.sentence)).toEqual(['"scatter".caption names a column that is not on this branch: "mystery"']);
    const derivedElsewhere: DashboardDef = { ...makeDashboardDef(), prose: [{ viewId: 'cluster', slots: { howToRead: { author: { kind: 'derived' } } } }] };
    expect(() => buildDashboard(derivedElsewhere)).toThrow(/nothing to derive from/);
    expect(await buildDashboard(withProse()).lintProse()).toEqual([]);
    const stub: DashboardDef = { ...withProse(), data: { data: { rows: [], engine: 'wasm' } } };
    await expect(buildDashboard(stub, { availableEngines: ['memory', 'wasm'] }).lintProse()).rejects.toThrow(/cannot list its columns/);
  });
});

describe('describe — the dispatch door', () => {
  it('lands one commit per slot, refuses with the sentence, and goes back to the def\'s words with null', async () => {
    const s = buildDashboard(withProse()).createSession();
    const before = s.log.records.length;
    const res = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'Rating by price', author: { kind: 'human' } }, cause: userCause('retitle'), correlationId: 't1' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.commit).toMatchObject({ viewId: 'prose:scatter', field: 'title', correlationId: 't1' });
      expect(res.described).toMatchObject({ slot: 'title', status: 'current', text: 'Rating by price' });
    }
    expect(s.log.records.length).toBe(before + 1);
    const no = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'x', author: { kind: 'agent' }, levels: ['causal'] }, cause: userCause() });
    expect(!no.ok && no.rejection.detail).toBe(
      '"scatter".caption was written by an agent and states no basis — without one, a model\'s words are indistinguishable from stated fact; "scatter".caption claims a cause, which the data cannot carry — an agent may state construction, statistics, and trends, never why',
    );
    const col = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { ...caption, basis: { columns: ['ghost'] } }, cause: userCause() });
    expect(!col.ok && col.rejection.detail).toBe('"scatter".caption names a column that is not on this branch: "ghost"');
    const ghost = await s.dispatch({ verb: 'describe', viewId: 'ghost', slot: 'title', record: title, cause: userCause() });
    expect(!ghost.ok && ghost.rejection.code).toBe('needs-view');
    const derived = await s.dispatch({ verb: 'describe', viewId: 'cluster', slot: 'howToRead', record: { author: { kind: 'derived' } }, cause: userCause() });
    expect(!derived.ok && derived.rejection.detail).toContain('nothing to derive from');
    const slot = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'poem' as 'title', record: title, cause: userCause() });
    expect(!slot.ok && slot.rejection.detail).toContain('is not a prose slot');
    // null = the def's own words again; on a view the def gave no words, null clears the slot
    const back = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: null, cause: userCause() });
    expect(back.ok && back.described).toMatchObject({ text: 'Price against rating' });
    await s.dispatch({ verb: 'describe', viewId: 'bar', slot: 'title', record: title, cause: userCause() });
    const cleared = await s.dispatch({ verb: 'describe', viewId: 'bar', slot: 'title', record: null, cause: userCause() });
    expect(cleared.ok && cleared.described).toBeNull();
    expect((await s.overview()).views.find((v) => v.viewId === 'bar')!.prose).toEqual([]);
  });
  it('undo restores the prior words (or the def\'s), seek shows what was said then, bring-over re-lands the same words', async () => {
    const s = buildDashboard(withProse()).createSession();
    const a = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'A', author: { kind: 'human' } }, cause: userCause() });
    const b = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'title', record: { text: 'B', author: { kind: 'human' } }, cause: userCause() });
    const aId = a.ok ? a.commit!.id : '';
    const bId = b.ok ? b.commit!.id : '';
    const titleNow = async () => (await s.overview()).views.find((v) => v.viewId === 'scatter')!.prose.find((p) => p.slot === 'title')!.text;
    expect(await titleNow()).toBe('B');
    const undoB = await s.undo(bId);
    expect(undoB.ok && undoB.recipe).toEqual({ apply: 'prose', viewId: 'scatter', slot: 'title', record: { text: 'A', author: { kind: 'human' } } });
    expect(await titleNow()).toBe('A');
    const undoA = await s.undo(aId);
    expect(undoA.ok && undoA.recipe).toEqual({ apply: 'prose', viewId: 'scatter', slot: 'title', record: null });
    expect(await titleNow()).toBe('Price against rating');
    // replaying the null commit on a full fold rebuild puts the def's words back too
    const nullId = undoA.ok ? undoA.commit!.id : '';
    s.seek(bId);
    expect(await titleNow()).toBe('B');
    s.seek(nullId);
    expect(await titleNow()).toBe('Price against rating');
    // bring-over onto another path (a sibling of B under A)
    s.seek(aId);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(await titleNow()).toBe('A');
    const over = await s.bringOver(bId);
    expect(over.ok && over.recipe).toEqual({ apply: 'prose', viewId: 'scatter', slot: 'title', record: { text: 'B', author: { kind: 'human' } } });
    expect(await titleNow()).toBe('B');
  });
});

describe('staleness, derived at read', () => {
  it('a caption goes stale when its basis no longer matches the screen, and says what moved; a derived slot never does', async () => {
    const s = buildDashboard(withProse()).createSession();
    const statusOf = async (slot: string) => (await s.overview()).views.find((v) => v.viewId === 'scatter')!.prose.find((p) => p.slot === slot)!;
    expect((await statusOf('caption')).status).toBe('current');
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    expect(await statusOf('caption')).toMatchObject({ status: 'stale', changed: ['filters'] });
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    expect((await statusOf('caption')).changed).toEqual(['encodings', 'filters']);
    expect(await statusOf('howToRead')).toMatchObject({ status: 'derived', text: 'a point with price on x, rating on y, category on color' });
    // the words are shown, never hidden or rewritten
    expect((await statusOf('caption')).text).toBe('Higher prices rate higher.');
  });
});

describe('the agent', () => {
  it('describes with itself as author, is refused without a basis, reads views[].prose', async () => {
    const s = buildDashboard(withProse()).createSession();
    const port = vizAsTools(s);
    const ok = await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'Prices span 50 to 130.', author: { kind: 'agent', model: 'm' }, levels: ['statistic'], basis: { columns: ['price'] } }, intent: 'caption' });
    expect(ok.ok).toBe(true);
    const no = await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'x', author: { kind: 'agent' } } });
    expect(no.ok).toBe(false);
    const bad = await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter', slot: 'caption', record: 'words' });
    expect(!bad.ok && String(bad.detail)).toContain('must be an object');
    const missing = await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter' });
    expect(missing.ok).toBe(false);
    const here = (await port.call('viz.whats_here')) as { views: { viewId: string; prose: { slot: string; status: string }[] }[] };
    expect(here.views.find((v) => v.viewId === 'scatter')!.prose.map((p) => p.slot)).toEqual(['title', 'caption', 'howToRead']);
    const back = await port.call('viz.dispatch', { verb: 'describe', viewId: 'scatter', slot: 'caption' });
    expect(back.ok).toBe(true);
  });
});

describe('the remaining doors', () => {
  it('a view with no encoding surface carries words too; a def with prose and no analyses validates; a stub engine refuses describe honestly', async () => {
    const { analyses: _dropped, encodings: _surfaces, ...noAnalyses } = makeDashboardDef();
    const def: DashboardDef = { ...noAnalyses, prose: [{ viewId: 'cluster', slots: { title: { text: 'Clusters', author: { kind: 'human' } } } }] };
    expect(validateDashboardDef(def)).toEqual([]);
    const s = buildDashboard(def).createSession();
    expect((await s.overview()).views.find((v) => v.viewId === 'cluster')!.prose.map((p) => p.text)).toEqual(['Clusters']);
    const stub = buildDashboard({ ...def, data: { data: { rows: [], engine: 'wasm' } } }, { availableEngines: ['memory', 'wasm'] }).createSession();
    const res = await stub.dispatch({ verb: 'describe', viewId: 'cluster', slot: 'title', record: null, cause: userCause() });
    expect(!res.ok && res.rejection.code).toBe('needs-backend-data');
  });
});

describe('refs at the dispatch door', () => {
  it('a caption may point at a commit the log holds or a beat that was named; anything else is refused with the sentence', async () => {
    const s = buildDashboard(withProse()).createSession();
    const sel = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const selId = sel.ok ? sel.commit!.id : '';
    await s.dispatch({ verb: 'checkpoint', label: 'formal only', cause: userCause() });
    const ok = await s.dispatch({
      verb: 'describe',
      viewId: 'scatter',
      slot: 'caption',
      record: { text: 'Formal items rate higher.', author: { kind: 'human' }, refs: [{ span: [0, 12], commit: selId }, { span: [13, 25], beat: 'formal only' }] },
      cause: userCause(),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.described!.refs).toHaveLength(2);
    const bad = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'x', author: { kind: 'human' }, refs: [{ span: [0, 1], commit: 'nope' }] }, cause: userCause() });
    expect(!bad.ok && bad.rejection.detail).toBe('"scatter".caption.refs[0] points at a commit the log does not hold: "nope"');
    const noBeat = await s.dispatch({ verb: 'describe', viewId: 'scatter', slot: 'caption', record: { text: 'x', author: { kind: 'human' }, refs: [{ span: [0, 1], beat: 'never' }] }, cause: userCause() });
    expect(!noBeat.ok && noBeat.rejection.detail).toBe('"scatter".caption.refs[0] points at a beat that was never named: "never"');
  });
});
