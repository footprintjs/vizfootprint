/**
 * SET-1 — the MATCH form of `select`: one field, MANY values (the plural of a
 * point), optional `exclude` (everything BUT them), `values: null` to clear.
 * Same verb, same fold key, so branching / undo / time-travel carry it by
 * construction — verified here with targeted probes: what lands, what the
 * overview projects, what the crossfilter keeps, how the guard reads a
 * declared capability, and what undo re-lands.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';
import type { Cause } from '../cause/index.js';

const userCause = (intent?: string): Cause => ({ requestedBy: 'user', computedBy: 'user', ...(intent ? { intent } : {}) });

/** The first two distinct categories in the fixture — chosen from the data, not by name. */
const categories = [...new Set(SAMPLE_ROWS.map((r) => String(r['category'])))];
const [A, B] = [categories[0]!, categories[1]!];
const countOf = (pred: (c: string) => boolean): number => SAMPLE_ROWS.filter((r) => pred(String(r['category']))).length;

function freshSession(def: DashboardDef = makeDashboardDef()) {
  return buildDashboard(def).createSession();
}

describe('SET-1 — select with values (a match)', () => {
  it('lands ONE commit of kind match, projects the IN-list as one value, and the crossfilter keeps exactly those rows', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A, B], cause: userCause('two categories') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.verb).toBe('select');
    expect(res.commit?.kind).toBe('match');
    expect(res.commit?.value).toEqual({ values: [A, B] });
    expect(s.log.records).toHaveLength(1);
    const ov = await s.overview();
    expect(ov.activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'match', value: { values: [A, B] } }]);
    expect((await s.selectedRows()).length).toBe(countOf((c) => c === A || c === B));
  });

  it('exclude: true keeps everything BUT the listed values — and says so on the wire', async () => {
    const s = freshSession();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A], exclude: true, cause: userCause() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.commit?.value).toEqual({ values: [A], exclude: true });
    expect((await s.overview()).activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'match', value: { values: [A], exclude: true } }]);
    expect((await s.selectedRows()).length).toBe(countOf((c) => c !== A));
  });

  it('values: null clears — a real commit of kind match, and the view has no active selection', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A, B], cause: userCause() });
    const cleared = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: null, cause: userCause('clear') });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.commit).toMatchObject({ kind: 'match', value: null });
    expect((await s.overview()).activeSelections).toEqual([]);
    expect((await s.selectedRows()).length).toBe(SAMPLE_ROWS.length);
  });

  it('a set is a point\'s plural: a view declaring only point accepts a match; one declaring only interval refuses it as guard-failed', async () => {
    const base = makeDashboardDef();
    const def: DashboardDef = {
      ...base,
      capabilities: [...(base.capabilities ?? []), { viewId: 'bar', canProbe: true, encodings: ['point'] }, { viewId: 'scatter', canProbe: true, encodings: ['interval'] }],
    };
    const s = freshSession(def);
    const onBar = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A], cause: userCause() });
    expect(onBar.ok).toBe(true);
    const onScatter = await s.dispatch({ verb: 'select', viewId: 'scatter', field: 'category', values: [A], cause: userCause() });
    expect(onScatter.ok).toBe(false);
    expect(JSON.stringify(onScatter)).toMatch(/guard-failed/);
    expect(JSON.stringify(onScatter)).toMatch(/does not encode a match selection/);
    // what an agent is told matches what the guard accepts: the implied kind is REPORTED
    expect((await s.overview()).views.find((v) => v.viewId === 'bar')?.selectionKinds).toEqual(['point', 'match']);
    expect((await s.overview()).views.find((v) => v.viewId === 'scatter')?.selectionKinds).toEqual(['interval']);
  });

  it('time travel rebuilds a match from the log — seek back to it and the same rows are kept', async () => {
    const s = freshSession();
    const m = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A], exclude: true, cause: userCause() });
    const mId = m.ok ? m.commit!.id : '';
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: null, cause: userCause() });
    expect((await s.overview()).activeSelections).toEqual([]);
    s.seek(mId);
    expect((await s.overview()).activeSelections).toEqual([{ viewId: 'bar', field: 'category', kind: 'match', value: { values: [A], exclude: true } }]);
    expect((await s.selectedRows()).length).toBe(countOf((c) => c !== A));
  });

  it('undo re-lands KIND-FAITHFULLY: a match with nothing prior → a cleared MATCH; a match over a prior match → the prior match, polarity and all', async () => {
    const s = freshSession();
    const first = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A], exclude: true, cause: userCause() });
    const firstId = first.ok ? first.commit!.id : '';
    const second = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A, B], cause: userCause() });
    const secondId = second.ok ? second.commit!.id : '';

    const undoSecond = await s.undo(secondId);
    expect(undoSecond.ok).toBe(true);
    if (!undoSecond.ok) return;
    expect(undoSecond.recipe).toEqual({ apply: 'selection', viewId: 'bar', kind: 'match', field: 'category', value: { values: [A], exclude: true } });
    expect(undoSecond.commit).toMatchObject({ kind: 'match', value: { values: [A], exclude: true } });

    const undoFirst = await s.undo(firstId);
    expect(undoFirst.ok).toBe(true);
    if (!undoFirst.ok) return;
    expect(undoFirst.recipe).toEqual({ apply: 'clear-selection', viewId: 'bar', field: 'category', kind: 'match' });
    expect(undoFirst.commit).toMatchObject({ kind: 'match', value: null });
    expect((await s.overview()).activeSelections).toEqual([]);
  });

  it('undo of an interval with nothing prior lands a cleared INTERVAL (filter null) — the kind-faithful clear for a brush', async () => {
    const s = freshSession();
    const brushed = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [60, 80], cause: userCause() });
    const id = brushed.ok ? brushed.commit!.id : '';
    const res = await s.undo(id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe).toEqual({ apply: 'clear-selection', viewId: 'scatter', field: 'price', kind: 'interval' });
    expect(res.commit).toMatchObject({ kind: 'interval', value: null });
    expect((await s.overview()).activeSelections).toEqual([]);
  });

  it('undo over a prior KEEP-match re-lands it without a polarity flag (the wire stays byte-identical to what landed)', async () => {
    const s = freshSession();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [A], cause: userCause() });
    const second = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: [B], cause: userCause() });
    const res = await s.undo(second.ok ? second.commit!.id : '');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe).toEqual({ apply: 'selection', viewId: 'bar', kind: 'match', field: 'category', value: { values: [A] } });
    expect(res.commit?.value).toEqual({ values: [A] });
  });

  it('a values that is not an array (or an explicit undefined) is refused as a typed gap at the boundary — never a raw TypeError', async () => {
    const s = freshSession();
    const bad = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: 'Formal' as unknown as readonly unknown[], cause: userCause() });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toMatch(/guard-failed/);
    expect(JSON.stringify(bad)).toMatch(/must be an array of values/);
    const spread = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: undefined as unknown as readonly unknown[], cause: userCause() });
    expect(spread.ok).toBe(false);
    expect(s.log.records).toHaveLength(0);
  });
});
