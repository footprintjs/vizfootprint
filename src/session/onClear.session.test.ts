/**
 * Layer 4 `onClear` at the session: a clear remembers what it cleared, a new
 * selection forgets it, seek and undo restore it from the log — and the `link`
 * verb carries `onClear` and `fold`, refusing a crossing edge without a fold in
 * the def door's own sentence.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });
const id = (r: { ok: boolean; commit?: { id: string } }): string => (r.ok && r.commit ? r.commit.id : '');
const def = (): DashboardDef => ({ ...makeDashboardDef(), grains: [{ viewId: 'bar', keys: ['category'] }, { viewId: 'scatter', keys: [] }] });

describe('the cleared ledger', () => {
  it('a clear remembers the last clause and the clearing commit; a new selection forgets it; nothing to clear notes nothing', async () => {
    const s = buildDashboard(def()).createSession();
    expect((await s.overview()).clearedSelections).toEqual([]);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const cleared = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear') });
    expect(cleared.ok).toBe(true);
    const o = await s.overview();
    expect(o.activeSelections).toEqual([]);
    expect(o.clearedSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'point', value: 'Formal', clearedBy: id(cleared) }]);
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Party', cause: userCause('pick again') });
    expect((await s.overview()).clearedSelections).toEqual([]);
    // clearing a view that holds nothing notes nothing
    const t = buildDashboard(def()).createSession();
    await t.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: undefined, cause: userCause('clear nothing') });
    expect((await t.overview()).clearedSelections).toEqual([]);
  });
  it('seek and undo rebuild the ledger from the log — the clear is a fact of the branch, and a match keeps its polarity', async () => {
    const s = buildDashboard(def()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', 'Party'], exclude: true, cause: userCause('exclude two') });
    const clear = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: null, cause: userCause('clear') });
    expect((await s.overview()).clearedSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'match', value: { values: ['Formal', 'Party'], exclude: true }, clearedBy: id(clear) }]);
    s.seek(id(pick));
    expect((await s.overview()).clearedSelections).toEqual([]);
    expect((await s.overview()).activeSelections).toHaveLength(1);
    s.seek(id(clear));
    expect((await s.overview()).clearedSelections).toHaveLength(1);
  });
});

describe('an undo is not a clear', () => {
  it('undoing a selection takes it back without entering the cleared ledger — no edge keeps what a person reverted', async () => {
    const s = buildDashboard(def()).createSession();
    const pick = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: userCause('pick') });
    const undone = await s.undo(id(pick));
    expect(undone.ok).toBe(true);
    expect((await s.overview()).activeSelections).toEqual([]);
    expect((await s.overview()).clearedSelections).toEqual([]);
    // and the ledger rebuilt from the log agrees with the live one
    s.seek(id(pick));
    s.seek(s.log.records[s.log.records.length - 1]!.id); // back to the tip: the ledger is rebuilt from the branch path
    expect((await s.overview()).clearedSelections).toEqual([]);
  });
});

describe('the link verb carries onClear and fold', () => {
  it('an edited edge keeps its policy and its fold; a crossing edge without a fold is refused as a gap with the def door\'s sentence', async () => {
    const s = buildDashboard(def()).createSession();
    const refused = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', cause: userCause('light the scatter') });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.rejection.detail).toContain('link bar:point→scatter: view "bar" emits over category and view "scatter" shows rows — an edge that crosses grains must state its fold');
    const ok = await s.dispatch({ verb: 'link', source: 'bar', kind: 'point', target: 'scatter', response: 'highlight', onClear: 'leave', fold: 'every row of the lit category', cause: userCause('light the scatter') });
    expect(ok.ok).toBe(true);
    const edge = (await s.overview()).links.edges.find((e) => e.source === 'bar' && e.target === 'scatter' && e.kind === 'point');
    expect(edge).toMatchObject({ response: 'highlight', onClear: 'leave', fold: 'every row of the lit category', origin: 'edited' });
  });
});
