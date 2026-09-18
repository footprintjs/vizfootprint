/**
 * WHY A VIEW IS OUTSIDE THE SELECTION GRAMMAR — the declaration, the door that
 * judges it, and the fact the session now SAYS instead of leaving a host to
 * rebuild it.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * A consumer desk had a pane whose rows are not in the data space at all — a
 * 3D viewer over a structure file — declared `{ canProbe: false }` with no
 * `encodings`. When every pane around it narrowed and it did not, the only
 * sentence it could say was the crossfilter's: *"the selection elsewhere cannot
 * be judged here"*, which is what a pane says when a clause SET OUT and could
 * not be judged, and reads exactly like a fault. The truth is the opposite: no
 * clause can ever be ABOUT that view. The host rebuilt that distinction from
 * two booleans and wrote its own words for it, because the library knew the
 * fact and did not say it — omit-never-deny at its plainest.
 *
 * So the session serves `ViewInfo.silent`: the TYPED reason always, the def's
 * OWN words when it wrote any.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard, validateDashboardDef } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';

const ROWS = [{ id: 'a', price: 20 }, { id: 'b', price: 40 }];

/** A two-view def: one that draws and can be brushed, one declared outside the grammar. */
function def(over: Record<string, unknown> = {}): DashboardDef {
  return {
    meta: { title: 'silence' },
    data: { data: { rows: ROWS } },
    actors: { scatter: { actor: 'user' }, viewer: { actor: 'user' } },
    defaultTable: 'data',
    capabilities: [
      { viewId: 'scatter', canProbe: true },
      { viewId: 'viewer', canProbe: false, ...over },
    ],
  } as DashboardDef;
}

const viewsOf = async (d: DashboardDef) => (await buildDashboard(d).createSession({ as: 'user' }).overview()).views;

describe('the DECLARATION: `silentBecause` belongs beside `canProbe: false`, and must be words', () => {
  it('a def that declares the reason validates, and one that leaves it out still does', () => {
    expect(validateDashboardDef(def({ silentBecause: 'the camera is the viewer’s own — there is nothing here a clause could name' }))).toEqual([]);
    expect(validateDashboardDef(def())).toEqual([]);
  });

  it('a BLANK reason is refused by name — an empty explanation would reach a reader’s screen as one', () => {
    expect(validateDashboardDef(def({ silentBecause: '   ' }))).toEqual(['capabilities[1].silentBecause, if present, must be a non-empty string']);
    expect(validateDashboardDef(def({ silentBecause: 7 }))).toEqual(['capabilities[1].silentBecause, if present, must be a non-empty string']);
  });

  it('a reason declared on a view that CAN probe is a contradiction, and the door says so at the key that fixes it', () => {
    const contradiction = def({ canProbe: true, silentBecause: 'nothing can be asked here' });
    expect(validateDashboardDef(contradiction)).toEqual([
      'capabilities[1].silentBecause explains being outside the selection grammar — it belongs beside canProbe: false, and this view declares canProbe: true',
    ]);
  });
});

describe('the SESSION says it, so no host has to derive it from two symptoms', () => {
  it('a view declared outside the grammar carries the typed reason AND the def’s own words, verbatim', async () => {
    const words = 'the camera is the viewer’s own — there is nothing here a clause could name';
    const views = await viewsOf(def({ silentBecause: words }));
    const viewer = views.find((v) => v.viewId === 'viewer')!;
    expect(viewer.silent).toEqual({ reason: 'declared', words });
    // …and it is the SAME fact the two booleans carried, never a second answer
    expect(viewer.canProbe).toBe(false);
    expect(viewer.selectionKinds).toEqual([]);
  });

  it('the TYPED reason crosses even when the def wrote no words — the distinction is the library’s, the sentence is not', async () => {
    const viewer = (await viewsOf(def())).find((v) => v.viewId === 'viewer')!;
    expect(viewer.silent).toEqual({ reason: 'declared' });
    expect(viewer.silent!.words).toBeUndefined();
  });

  it('a view with ANY voice has no silence at all — an absence is absent, never a guess', async () => {
    const views = await viewsOf(def());
    expect(views.find((v) => v.viewId === 'scatter')!.silent).toBeUndefined();
    // and a view that declares no capability whatsoever is ASSUMED to have a voice, so it is not silent either
    const undeclared = buildDashboard({
      meta: { title: 'silence' },
      data: { data: { rows: ROWS } },
      actors: { plain: { actor: 'user' } },
      defaultTable: 'data',
    } as DashboardDef).createSession({ as: 'user' });
    expect((await undeclared.overview()).views[0]!.silent).toBeUndefined();
  });

  it('a MOUNTED adapter answers for itself: its own capability decides, words and all', async () => {
    const session = buildDashboard(def()).createSession({ as: 'user' });
    session.mountView('viewer', {
      capabilities: { canProbe: false, silentBecause: 'this adapter draws a camera, not marks' },
      applyClause: () => {},
    });
    const viewer = (await session.overview()).views.find((v) => v.viewId === 'viewer')!;
    expect(viewer.silent).toEqual({ reason: 'declared', words: 'this adapter draws a camera, not marks' });
  });
});
