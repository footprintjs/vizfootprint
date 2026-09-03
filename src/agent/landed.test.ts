/**
 * `whatLanded` — the ONE reader of "what id did this act land".
 *
 * The first block is the four shapes, read off REAL tool results so the reader
 * cannot drift from the projection that mints them. The second is the reason
 * this lives in the library at all: a consumer that wrote the walk by hand
 * wrote it twice and the two copies disagreed about a refusal.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { vizAsTools } from './vizAsTools.js';
import { whatLanded } from './landed.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';

const port = () => vizAsTools(buildDashboard(makeDashboardDef()).createSession({ as: 'agent' }), { as: 'agent' });

describe('whatLanded — the four shapes one question wears', () => {
  it('a dispatch: the COMMIT record it landed', async () => {
    const p = port();
    const res = await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'explore' });
    expect(whatLanded(res)).toEqual({ commit: (res['commit'] as { id: string }).id });
  });

  it('an analysis: the commit ONE LEVEL DOWN, under `analysis`', async () => {
    const p = port();
    const res = await p.call('viz.declare_analysis', { analysisId: 'correlation', intent: 'explore' });
    const inner = (res['analysis'] as { commit?: { id: string } }).commit;
    expect(inner?.id).toEqual(expect.any(String));
    expect(whatLanded(res)).toEqual({ commit: inner?.id });
  });

  it('a bookmark: the STORE record, because bookmarking lands no commit at all', async () => {
    const p = port();
    await p.call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', intent: 'explore' }); // a bookmark names the moment the cursor stands on
    const res = await p.call('viz.bookmark', { label: 'the premium end', intent: 'explore' });
    expect(res['commit']).toBeUndefined();
    expect(whatLanded(res)).toEqual({ bookmark: (res['bookmark'] as { id: string }).id });
  });

  it('a chart proposal: the moment by ID alone — the record would echo the spec back', async () => {
    const p = port();
    const res = await p.call('viz.propose_chart', { id: 'c1', spec: { mark: 'point', encoding: { x: { field: 'price' }, y: { field: 'rating' } } }, rationale: 'price tracks rating' });
    expect(res['ok']).toBe(true);
    expect(res['commit']).toBeUndefined();
    expect(whatLanded(res)).toEqual({ commit: res['commitId'] });
  });
});

describe('whatLanded — an act that left nothing leaves nothing', () => {
  it('a REFUSAL is never mined for an id (the half the second copy had dropped)', async () => {
    const p = port();
    const res = await p.call('viz.dispatch', { verb: 'select', viewId: 'nope', field: 'category', value: 'Formal', intent: 'explore' });
    expect(res['ok']).toBe(false);
    expect(whatLanded(res)).toBeUndefined();
    // and belt-and-braces: even a refusal that somehow carried a commit is not an act that landed one
    expect(whatLanded({ ok: false, commit: { id: 's1' } })).toBeUndefined();
  });

  it('a read answers nothing, and neither does an absent step', async () => {
    const p = port();
    expect(whatLanded(await p.call('viz.whats_here'))).toBeUndefined();
    expect(whatLanded(undefined)).toBeUndefined();
  });

  it('a shape that names no id — a navigate, or a mark whose id is not a string — answers nothing rather than guessing', () => {
    expect(whatLanded({ ok: true, verb: 'navigate', navigatedTo: 'bar' })).toBeUndefined();
    expect(whatLanded({ ok: true, commit: { id: 7 }, commitId: 7, analysis: { commit: { id: 7 } }, bookmark: { id: 7 } })).toBeUndefined();
    expect(whatLanded({ ok: true, commit: undefined, analysis: undefined, bookmark: undefined })).toBeUndefined();
  });
});
