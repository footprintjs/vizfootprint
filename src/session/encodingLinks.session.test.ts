/**
 * Encoding links in the session: a target FOLLOWS a source's channel binding
 * through an edge — read through, never landed; judged by the target's own
 * rules; owned by the edge; carried by undo, seek and the link verb.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { vizAsTools } from '../agent/vizAsTools.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
/** scatter (x price, y rating, color) → bar (x category, color): the fixture's two surfaces, with a declared follow. */
const withFollow = (extra: Partial<DashboardDef> = {}): DashboardDef => ({
  ...makeDashboardDef(),
  links: [{ source: 'scatter', kind: 'encoding', target: 'bar', response: 'follow' }],
  ...extra,
});

describe('a follow, read through', () => {
  it('lands ONE commit on the source; the target shows the followed binding without a commit of its own, and names the edge', async () => {
    const s = buildDashboard(withFollow()).createSession();
    const before = s.log.records.length;
    const res = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause('color by category') });
    expect(res.ok).toBe(true);
    expect(s.log.records.length).toBe(before + 1);
    expect(s.viewEncodings('bar')).toEqual({ x: 'category' }); // the target's OWN fold is untouched
    const o = await s.overview();
    const bar = o.views.find((v) => v.viewId === 'bar')!;
    expect(bar.effective).toEqual({
      bindings: { x: 'category', color: 'category' },
      followed: { color: { edge: 'scatter:encoding→bar', from: 'scatter', sourceChannel: 'color' } },
      // the default pairs also carry x→x, and the scatter's x (price) is not a bar's x — refused by the bar's own rule, own binding kept
      refused: { x: { edge: 'scatter:encoding→bar', field: 'price', sentence: '"price" is continuous; the x channel of a bar needs a discrete column' } },
    });
    expect(o.effectiveEncodings['bar']).toEqual({ x: 'category', color: 'category' });
    expect(o.encodings['bar']).toEqual({ x: 'category' });
    // a view with no surface has no effective block; a view that follows nothing shows its own
    expect(o.views.find((v) => v.viewId === 'cluster')!.effective).toBeUndefined();
    expect(o.views.find((v) => v.viewId === 'scatter')!.effective).toEqual({ bindings: { x: 'price', y: 'rating', color: 'category' }, followed: {}, refused: {} });
  });
  it("the target's own rules judge the follow: a refused channel keeps its own binding and the sentence rides the wire — never a gap", async () => {
    const s = buildDashboard(withFollow()).createSession();
    const gapsBefore = (await s.overview()).gaps;
    // the edge also pairs x→x: scatter's x is `price` (continuous) and a bar's x must be discrete
    const bar = (await s.overview()).views.find((v) => v.viewId === 'bar')!;
    expect(bar.effective!.bindings).toEqual({ x: 'category' });
    expect(bar.effective!.refused).toEqual({ x: { edge: 'scatter:encoding→bar', field: 'price', sentence: '"price" is continuous; the x channel of a bar needs a discrete column' } });
    expect((await s.overview()).gaps).toBe(gapsBefore);
  });
  it('the edge owns a followed channel: the target\'s own rebind there is refused with the sentence that names the edge; a refused follow leaves the channel free', async () => {
    const s = buildDashboard(withFollow()).createSession();
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    const own = await s.dispatch({ verb: 'reencode', viewId: 'bar', channel: 'color', field: 'id', cause: userCause() });
    expect(!own.ok && own.rejection.detail).toBe('view "bar"\'s color follows "scatter" (edge scatter:encoding→bar) — change the edge, or set it to none');
    const set = await s.dispatch({ verb: 'reencode', viewId: 'bar', bindings: { color: 'id' }, cause: userCause() });
    expect(set.ok).toBe(false);
    // x is only ever a refused follow on the bar, so the bar may still rebind it
    const free = await s.dispatch({ verb: 'reencode', viewId: 'bar', channel: 'x', field: 'id', cause: userCause() });
    expect(free.ok).toBe(true);
    // and the picker's verdicts say the same for the followed channel
    const bar = (await s.overview()).views.find((v) => v.viewId === 'bar')!;
    expect(bar.fits!['color']!.every((f) => !f.ok && f.because === 'view "bar"\'s color follows "scatter" (edge scatter:encoding→bar) — change the edge, or set it to none')).toBe(true);
  });
  it('undo of the source act un-follows; a link commit to none un-follows; seek before it re-follows; back to the rule un-declares', async () => {
    const s = buildDashboard(withFollow()).createSession();
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'id', cause: userCause() });
    const act = await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    const actId = act.ok ? act.commit!.id : '';
    const effective = async () => (await s.overview()).effectiveEncodings['bar'];
    expect(await effective()).toEqual({ x: 'category', color: 'category' });
    const undo = await s.undo(actId);
    expect(undo.ok).toBe(true);
    expect(await effective()).toEqual({ x: 'category', color: 'id' }); // the prior source binding, followed again
    s.seek(actId);
    expect(await effective()).toEqual({ x: 'category', color: 'category' });
    const off = await s.dispatch({ verb: 'link', source: 'scatter', kind: 'encoding', target: 'bar', response: 'none', cause: userCause('stop following') });
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.linked).toMatchObject({ response: 'none', origin: 'edited', channels: [{ from: 'x', to: 'x' }, { from: 'color', to: 'color' }] });
    expect(await effective()).toEqual({ x: 'category' });
    s.seek(actId);
    expect(await effective()).toEqual({ x: 'category', color: 'category' });
    // a narrower pair set, stated on the edit
    const narrow = await s.dispatch({ verb: 'link', source: 'scatter', kind: 'encoding', target: 'bar', response: 'follow', channels: [{ from: 'color', to: 'color' }], cause: userCause() });
    expect(narrow.ok).toBe(true);
    const bar = (await s.overview()).views.find((v) => v.viewId === 'bar')!;
    expect(bar.effective!.refused).toEqual({}); // x no longer paired, so nothing to refuse
  });
  it('the link verb refuses a bad encoding edge with the def door\'s sentences', async () => {
    const s = buildDashboard(withFollow()).createSession();
    const bad = await s.dispatch({ verb: 'link', source: 'cluster', kind: 'encoding', target: 'bar', response: 'follow', cause: userCause() });
    expect(!bad.ok && bad.rejection.detail).toContain('view "cluster" declares no encoding surface — it has no binding to follow');
    const pair = await s.dispatch({ verb: 'link', source: 'scatter', kind: 'encoding', target: 'bar', response: 'follow', channels: [{ from: 'y', to: 'size' }], cause: userCause() });
    expect(!pair.ok && pair.rejection.detail).toContain('view "bar" has no "size" channel');
  });
  it('one hop: two views that follow each other each show the other\'s OWN binding, never a followed one', async () => {
    const def: DashboardDef = {
      ...makeDashboardDef(),
      links: [
        { source: 'scatter', kind: 'encoding', target: 'bar', response: 'follow', channels: [{ from: 'color', to: 'color' }] },
        { source: 'bar', kind: 'encoding', target: 'scatter', response: 'follow', channels: [{ from: 'color', to: 'color' }] },
      ],
    };
    const s = buildDashboard(def).createSession();
    await s.dispatch({ verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category', cause: userCause() });
    const o = await s.overview();
    // bar follows scatter's own color; scatter follows bar's OWN color — which bar never bound, so scatter keeps its own
    expect(o.effectiveEncodings['bar']!['color']).toBe('category');
    expect(o.views.find((v) => v.viewId === 'scatter')!.effective!.followed).toEqual({});
    expect(o.effectiveEncodings['scatter']).toEqual({ x: 'price', y: 'rating', color: 'category' });
  });
});

describe('a follow is never coerced', () => {
  it('under the coerce policy the ACT would coerce, but the same misfit as a FOLLOW is refused with the sentence', async () => {
    const { discreteCoercer } = await import('../def/index.js');
    const s = buildDashboard(withFollow({ encodingRules: { onInvalid: 'discrete' } }), { encoding: { coercers: [discreteCoercer] } }).createSession();
    const bar = (await s.overview()).views.find((v) => v.viewId === 'bar')!;
    expect(bar.effective!.refused['x']).toEqual({ edge: 'scatter:encoding→bar', field: 'price', sentence: '"price" is continuous; the x channel of a bar needs a discrete column' });
    const act = await s.dispatch({ verb: 'reencode', viewId: 'bar', channel: 'x', field: 'price', cause: userCause() });
    expect(act.ok && act.coerced!.length).toBe(1);
  });
});

describe('dashboard-scoped rules read what is on screen', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ k: `k${i % 3}`, v: i, w: i * 2, z: i * 3, q: i * 5 }));
  const def: DashboardDef = {
    data: { data: { rows } },
    actors: { a: { actor: 'user' }, b: { actor: 'user' }, c: { actor: 'user' } },
    encodings: [
      { viewId: 'a', chartKind: 'scatter', channels: ['x', 'y', 'color'], initial: { x: 'v', y: 'w' } },
      { viewId: 'b', chartKind: 'bar', channels: ['x', 'color'], initial: { x: 'k' } },
      { viewId: 'c', chartKind: 'bar', channels: ['x', 'color'], initial: { x: 'k' } },
    ],
    links: [{ source: 'a', kind: 'encoding', target: 'b', response: 'follow', channels: [{ from: 'color', to: 'color' }] }],
    encodingRules: { rules: [{ rule: 'never-together', columns: ['q', 'z'] }] },
  };
  it('a column reaching a view only by following still counts for a page-wide pair on a third view', async () => {
    const s = buildDashboard(def).createSession();
    expect((await s.dispatch({ verb: 'reencode', viewId: 'a', channel: 'color', field: 'z', cause: userCause() })).ok).toBe(true);
    expect((await s.overview()).effectiveEncodings['b']).toEqual({ x: 'k', color: 'z' });
    const res = await s.dispatch({ verb: 'reencode', viewId: 'c', channel: 'color', field: 'q', cause: userCause() });
    expect(!res.ok && res.rejection.detail).toBe('"q" and "z" never share the page');
    // and the verdicts for c agree, then change when the edge is switched off
    expect((await s.overview()).views.find((v) => v.viewId === 'c')!.fits!['color']!.find((f) => f.field === 'q')!.ok).toBe(false);
    await s.dispatch({ verb: 'link', source: 'a', kind: 'encoding', target: 'b', response: 'none', cause: userCause() });
    // z is still on a itself, page-wide — so q stays refused; unbind it there and the pair is free
    expect((await s.dispatch({ verb: 'reencode', viewId: 'a', channel: 'color', field: 'k', cause: userCause() })).ok).toBe(true);
    expect((await s.overview()).views.find((v) => v.viewId === 'c')!.fits!['color']!.find((f) => f.field === 'q')!.ok).toBe(true);
  });
});

describe('the agent', () => {
  it('reads effective bindings and the edge in whats_here, and can declare a follow through dispatch', async () => {
    const s = buildDashboard(makeDashboardDef()).createSession();
    const port = vizAsTools(s);
    const made = await port.call('viz.dispatch', { verb: 'link', source: 'scatter', kind: 'encoding', target: 'bar', response: 'follow', channels: [{ from: 'color', to: 'color' }], intent: 'the bar follows the scatter\'s hue' });
    expect(made.ok).toBe(true);
    await port.call('viz.dispatch', { verb: 'reencode', viewId: 'scatter', channel: 'color', field: 'category' });
    const here = (await port.call('viz.whats_here')) as { effectiveEncodings: Record<string, Record<string, string>>; views: { viewId: string; effective?: { followed: Record<string, { edge: string }> } }[] };
    expect(here.effectiveEncodings['bar']).toEqual({ x: 'category', color: 'category' });
    const barHere = here.views.find((v) => v.viewId === 'bar')!.effective as { bindings?: unknown; followed: Record<string, { edge: string }>; refused: unknown };
    expect(barHere.followed['color']!.edge).toBe('scatter:encoding→bar');
    expect(barHere.bindings).toBeUndefined(); // the bindings already ride as effectiveEncodings — the agent gets the map once
    const badResponse = await port.call('viz.dispatch', { verb: 'link', source: 'scatter', kind: 'encoding', target: 'bar', response: 'filter' });
    expect(!badResponse.ok && String(badResponse.detail)).toContain('follow | none');
    const badPairs = await port.call('viz.dispatch', { verb: 'link', source: 'scatter', kind: 'encoding', target: 'bar', response: 'follow', channels: ['x'] });
    expect(!badPairs.ok && String(badPairs.detail)).toContain('{ from, to }');
  });
});
