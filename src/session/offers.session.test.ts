/**
 * Layer 4 offers (step 6) and saved selections: whats_here serves every
 * reachable (view, kind), and ONE `offerId` — the position they are all good
 * at — beside them; an act may name it; a stale one is refused by naming the
 * current one; a session may require one. A note names what it annotates, and
 * a live selection names its commit.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const withDoes = (): DashboardDef => {
  const def = makeDashboardDef();
  return { ...def, actors: { ...def.actors, bar: { ...def.actors['bar']!, does: 'pick a category' } } };
};
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');

describe('offers', () => {
  it('one offer per reachable (view, kind), with the does sentence; the POSITION rides once, and only it moves when the position does', async () => {
    const s = buildDashboard(withDoes()).createSession();
    const { offers, offerId } = await s.overview();
    expect(offers.map((o) => `${o.viewId}:${o.kind}`)).toContain('bar:point');
    const views = (await s.overview()).views;
    expect(views.find((v) => v.viewId === 'bar')?.does).toBe('pick a category'); // the sentence rides once, on the view
    expect(views.find((v) => v.viewId === 'scatter')?.does).toBeUndefined();
    // an offer names its NODE and nothing else — the position is not stamped N times
    expect(Object.keys(offers[0]!).sort()).toEqual(['kind', 'viewId']);
    expect(/^o-[0-9a-f]{8}$/.test(offerId)).toBe(true);
    expect(offers.some((o) => (o.kind as string) === 'encoding')).toBe(false);
    expect((await s.overview()).offers).toEqual(offers); // the same position, the same answer
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const after = await s.overview();
    expect(after.offers).toEqual(offers); // a voice is DECLARED — the list itself never moves
    expect(after.offerId).not.toBe(offerId); // only the position did
  });
  it('an act naming the current offer lands; a stale one is refused by naming the current one; an unreachable node is refused', async () => {
    const s = buildDashboard(withDoes()).createSession();
    const first = (await s.overview()).offerId;
    const ok = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', offerId: first, cause: userCause('pick') });
    expect(ok.ok).toBe(true);
    const stale = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', offerId: first, cause: userCause('pick again') });
    expect(stale.ok).toBe(false);
    const now = (await s.overview()).offerId;
    if (!stale.ok) {
      expect(stale.rejection.code).toBe('stale-offer');
      expect(stale.rejection.detail).toBe(`offer ${first} is not current for view "bar" point — the position moved; the current offer is ${now}`);
    }
    const unreachable = await s.dispatch({ verb: 'filter', viewId: 'display', field: 'price', range: [1, 2], offerId: 'o-00000000', cause: userCause('brush a readout?') });
    expect(!unreachable.ok && unreachable.rejection.detail).toBe('offer o-00000000 names view "display" interval — view "display" has no interval voice');
    expect(s.gaps().map((g) => g.code)).toEqual(['stale-offer', 'stale-offer']);
  });
  it('a session that requires offers refuses an act that names none, and says which offer would do', async () => {
    const s = buildDashboard(withDoes()).createSession({ requireOffer: true });
    const bare = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const offer = (await s.overview()).offerId;
    expect(!bare.ok && bare.rejection.detail).toBe(`this session requires an offerId from whats_here — the current offer is ${offer}`);
    const noKind = await s.dispatch({ verb: 'filter', viewId: 'display', field: 'price', range: [1, 2], cause: userCause('brush') });
    expect(!noKind.ok && noKind.rejection.detail).toBe('this session requires an offerId from whats_here — and view "display" has no interval voice');
    const cell = await s.dispatch({ verb: 'select', viewId: 'scatter', fields: ['price', 'rating'], values: [1, 2], cause: userCause('cell') });
    expect(!cell.ok && cell.rejection.code).toBe('stale-offer');
    const match = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal'], cause: userCause('set') });
    expect(!match.ok && match.rejection.code).toBe('stale-offer');
    const named = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', offerId: offer, cause: userCause('pick') });
    expect(named.ok).toBe(true);
  });
});

describe('replays under requireOffer', () => {
  it('undo and bring-over answer the current offer themselves — a person chose the step, the offer is only the position\'s stamp', async () => {
    const s = buildDashboard(withDoes()).createSession({ requireOffer: true });
    const offer = (await s.overview()).offerId;
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', offerId: offer, cause: userCause('pick') });
    expect(pick.ok).toBe(true);
    const undone = await s.undo(id(pick));
    expect(undone.ok).toBe(true);
    expect((await s.overview()).activeSelections).toEqual([]);
    const back = await s.bringOver(id(pick));
    expect(back.ok).toBe(true);
    expect((await s.overview()).activeSelections).toMatchObject([{ viewId: 'bar', value: 'Formal' }]);
    // a filter replay stamps its interval offer the same way
    const brushOffer = (await s.overview()).offerId;
    const brush = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, 150], offerId: brushOffer, cause: userCause('brush') });
    expect(brush.ok).toBe(true);
    expect((await s.undo(id(brush))).ok).toBe(true);
    expect(s.gaps().map((g) => g.code)).toEqual([]);
  });
});

describe('a replayed step whose view lost its voice', () => {
  it('is refused in its own words, never told to call whats_here', async () => {
    const s = buildDashboard(withDoes()).createSession({ requireOffer: true });
    // a step landed under an earlier definition: a select on the readout, which this definition gives no voice
    const { record } = s.log.commit({ id: 'old-1', parent: null, viewId: 'display', actorMeta: { actor: 'user' }, kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'user', computedBy: 'user' } });
    const back = await s.bringOver(record.id);
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.gap.detail).toBe('this step selects on view "display" point, which that view has no voice for — the definition changed since the step was landed');
  });
});

describe('a note keeps its target across a bring-over', () => {
  it('bringing a note over re-notes the same commit, so a saved selection stays saved on the other branch', async () => {
    const s = buildDashboard(withDoes()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const note = await s.dispatch({ verb: 'annotate', target: id(pick), note: 'Formal wear', cause: userCause('name it') });
    s.seek(id(pick)); // back before the note — the next act branches
    const carried = await s.bringOver(id(note), { as: 'user' });
    expect(carried.ok && carried.commit).toMatchObject({ viewId: 'annotation:user', field: id(pick), value: 'Formal wear' });
    const loose = await s.dispatch({ verb: 'annotate', target: '', note: 'a loose note', cause: userCause('note') });
    const carriedLoose = await s.bringOver(id(loose), { as: 'user' });
    expect(carriedLoose.ok && carriedLoose.commit).toMatchObject({ field: '__annotation__', value: 'a loose note' });
  });
});

describe('a note names what it annotates; a live selection names its commit', () => {
  it('annotate lands the target in the field; an empty target keeps the plain note field; the live selection carries its commit id', async () => {
    const s = buildDashboard(withDoes()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const live = (await s.overview()).activeSelections[0]!;
    expect(live.commitId).toBe(id(pick));
    const note = await s.dispatch({ verb: 'annotate', target: id(pick), note: 'Formal wear', cause: userCause('name it') });
    expect(note.ok && note.commit).toMatchObject({ viewId: 'annotation:user', field: id(pick), value: 'Formal wear' });
    const plain = await s.dispatch({ verb: 'annotate', target: '', note: 'a loose note', cause: userCause('note') });
    expect(plain.ok && plain.commit).toMatchObject({ field: '__annotation__', value: 'a loose note' });
  });
});
