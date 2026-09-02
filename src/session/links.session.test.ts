/**
 * Layer 4 — the `link` verb: one edge edited as a commit. Validated like a
 * declared edge, folded last-wins per edge id, overriding the base graph in
 * place; null un-declares; undo and bring-over re-land it like every act.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const fresh = () => buildDashboard(makeDashboardDef()).createSession();

describe('link — edit one edge, as a commit', () => {
  it('lands one commit under link:<edgeId>, overrides the base edge IN PLACE with origin edited, and reports the edge as it now stands', async () => {
    const s = fresh();
    const before = await s.overview();
    const base = before.links.edges.find((e) => e.id === 'bar:point→scatter')!;
    expect(base).toMatchObject({ response: 'filter', origin: 'default' });
    const at = before.links.edges.indexOf(base);
    const res = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause: userCause('the bar lights the scatter'), correlationId: 'turn-9' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.verb).toBe('link');
    expect(res.commit?.correlationId).toBe('turn-9'); // the cross-tier join key rides a link like any act
    expect(res.commit).toMatchObject({ viewId: 'link:bar:point→scatter', field: 'response', value: { source: 'bar', kind: 'point', target: 'scatter', response: 'highlight' } });
    expect(res.linked).toMatchObject({ id: 'bar:point→scatter', response: 'highlight', origin: 'edited' });
    const after = await s.overview();
    expect(after.links.edges[at]).toMatchObject({ response: 'highlight', origin: 'edited' });
    expect(after.links.edges).toHaveLength(before.links.edges.length);
    expect(s.log.records).toHaveLength(1);
  });

  it('a bad edge is refused with the declared-edge sentence, and nothing lands', async () => {
    const s = fresh();
    const selfLink = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'bar', response: 'filter', cause: userCause() });
    expect(selfLink.ok).toBe(false);
    expect(JSON.stringify(selfLink)).toMatch(/guard-failed/);
    expect(JSON.stringify(selfLink)).toMatch(/cannot link to itself/);
    const ghost = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'ghost', response: 'filter', cause: userCause() });
    expect(JSON.stringify(ghost)).toMatch(/is not a declared view/); // JSON escapes the quotes around the name
    expect(s.log.records).toHaveLength(0);
  });

  it('null un-declares the edit — the base edge shows through again — and a mapping rides the edge', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'mirror', mapping: [{ from: 'category', to: 'kind' }], cause: userCause() });
    let edge = (await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')!;
    expect(edge).toMatchObject({ response: 'mirror', origin: 'edited', mapping: [{ from: 'category', to: 'kind' }] });
    const back = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null, cause: userCause('back to the rule') });
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.commit?.value).toBeNull();
      expect(back.linked).toMatchObject({ response: 'filter', origin: 'default' });
    }
    edge = (await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')!;
    expect(edge).toMatchObject({ response: 'filter', origin: 'default' });
    expect(s.log.records).toHaveLength(2); // the un-declare is a real commit
  });

  it('time travel rebuilds the edit from the log; undo restores the prior edit or un-declares; the edit reads back in whats_here-shaped overview', async () => {
    const s = fresh();
    const first = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause: userCause() });
    const firstId = first.ok ? first.commit!.id : '';
    const second = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'none', cause: userCause() });
    const secondId = second.ok ? second.commit!.id : '';
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.response).toBe('none');
    s.seek(firstId);
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.response).toBe('highlight');
    s.seek(secondId);
    const undoSecond = await s.undo(secondId);
    expect(undoSecond.ok).toBe(true);
    if (!undoSecond.ok) return;
    expect(undoSecond.recipe).toEqual({ apply: 'link', link: { source: 'bar', kind: 'point', target: 'scatter', response: 'highlight' } });
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.response).toBe('highlight');
    const undoFirst = await s.undo(firstId);
    expect(undoFirst.ok).toBe(true);
    if (!undoFirst.ok) return;
    expect(undoFirst.recipe).toEqual({ apply: 'clear-link', link: { source: 'bar', kind: 'point', target: 'scatter', response: 'highlight' } });
    expect(undoFirst.commit?.value).toBeNull();
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')).toMatchObject({ response: 'filter', origin: 'default' });
  });

  it('bring-over re-lands an edit (or an un-declare) on another path', async () => {
    const s = fresh();
    const base = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause() });
    const baseId = base.ok ? base.commit!.id : '';
    const edit = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause: userCause() });
    const editId = edit.ok ? edit.commit!.id : '';
    const undeclare = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null, cause: userCause() });
    const undeclareId = undeclare.ok ? undeclare.commit!.id : '';
    s.seek(baseId); // fork here
    const over = await s.bringOver(editId);
    expect(over.ok).toBe(true);
    if (over.ok) expect(over.recipe).toEqual({ apply: 'link', link: { source: 'bar', kind: 'point', target: 'scatter', response: 'highlight' } });
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.response).toBe('highlight');
    const overNull = await s.bringOver(undeclareId);
    expect(overNull.ok).toBe(true);
    if (overNull.ok) expect(overNull.recipe).toEqual({ apply: 'clear-link', link: { source: 'bar', kind: 'point', target: 'scatter', response: 'none' } });
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.response).toBe('filter');
  });
});

describe('link — the edges of the un-declare', () => {
  it('undoing an un-declare that had nothing prior lands another un-declare (the rule stays); seeking over an un-declare replays it; onClear rides the edge', async () => {
    const s = fresh();
    const undeclare = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null, cause: userCause('nothing to undo yet') });
    const undeclareId = undeclare.ok ? undeclare.commit!.id : '';
    const res = await s.undo(undeclareId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recipe).toEqual({ apply: 'clear-link', link: { source: 'bar', kind: 'point', target: 'scatter', response: 'none' } });
    const edit = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', onClear: 'leave', cause: userCause() });
    expect(edit.ok && edit.linked).toMatchObject({ response: 'highlight', onClear: 'leave', origin: 'edited' });
    const editId = edit.ok ? edit.commit!.id : '';
    const back = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null, cause: userCause() });
    const backId = back.ok ? back.commit!.id : '';
    s.seek(editId);
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.origin).toBe('edited');
    s.seek(backId); // the replay walks over the un-declare: the edit is gone again
    expect((await s.overview()).links.edges.find((e) => e.id === 'bar:point→scatter')?.origin).toBe('default');
  });

  it('under linkDefault none, an un-declared edge is a SILENCE: the result carries no edge at all', async () => {
    const base = makeDashboardDef();
    const s = buildDashboard({ ...base, linkDefault: 'none' }).createSession();
    const edit = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'filter', cause: userCause() });
    expect(edit.ok && edit.linked).toMatchObject({ response: 'filter', origin: 'edited' });
    expect((await s.overview()).links.edges).toHaveLength(1);
    const back = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: null, cause: userCause() });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.linked).toBeUndefined();
    expect((await s.overview()).links.edges).toHaveLength(0);
  });
});
