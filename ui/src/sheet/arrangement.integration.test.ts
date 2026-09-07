/**
 * A SHEET'S SORT, END TO END — a real dashboard, a real session, and the two
 * things a person notices when an arrangement is only component state: a
 * reload loses it, and travelling back in time does not restore it.
 *
 * This file is the ruling written as a test. A sort LANDS (through `navigate`
 * on `layout:sheet:<viewId>` — one of the ten verbs, no new one), it is INERT
 * (no row leaves the count, because an arrangement is never a data claim), it
 * is restored at a cursor, and it survives a replay into a session that never
 * saw the walk.
 */
import { describe, it, expect } from 'vitest';
import { buildDashboard } from 'vizfootprint/def';
import type { DashboardDef } from 'vizfootprint/def';
import { createSessionView, sessionSource } from '../adapter/sessionView.js';
import { sheetSortOf } from './arrangement.js';

const DEF: DashboardDef = {
  data: { data: { rows: [
    { id: 'a', region: 'north', cases: 120 },
    { id: 'b', region: 'north', cases: 90 },
    { id: 'c', region: 'south', cases: 30 },
  ] } },
  actors: { bar: { actor: 'user', label: 'Category' } },
  defaultTable: 'data',
};

const DESC = [{ field: 'cases', dir: 'desc' as const }];

function open() {
  const session = buildDashboard(DEF).createSession();
  return { session, view: createSessionView(sessionSource(session), { as: 'user' }) };
}

const cause = { requestedBy: 'user' as const, computedBy: 'user' as const, intent: 'look at the north' };

describe('a sheet’s sort is an ACT', () => {
  it('lands ONE commit under the sheet’s own layout identity, in words a person can read', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.setSheetSort('cells', DESC);

    expect(session.log.records).toHaveLength(1);
    const commit = session.log.records[0]!;
    expect(commit.viewId).toBe('layout:sheet:cells');
    expect(commit.field).toBe('sort');
    expect(commit.cause.intent).toBe('cells: sorted by cases ↓');
    expect(commit.cause.requestedBy).toBe('user');
    // the act, in enough detail to perform it again: the order rides the commit
    expect(commit.value).toBe(JSON.stringify(DESC));
    view.dispose();
  });

  it('needs no new verb and no declared view — it rides `navigate`, which the vocabulary already had', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.setSheetSort('cells', DESC);
    // "cells" is not a declared view; a layout identity is resolved before that guard, and the
    // record wears the layout namespace's own constant meta rather than a view's
    expect(session.log.records[0]!.actorMeta).toEqual({ actor: 'system', label: 'layout' });
    expect(view.getState().gaps).toEqual([]);
    view.dispose();
  });

  it('is INERT: an order changes what you look at, never what is true', async () => {
    const { session, view } = open();
    await view.refresh();
    const before = (await session.overview()).selectedRowCount;
    await view.setSheetSort('cells', DESC);
    expect((await session.overview()).selectedRowCount).toBe(before);
    expect((await session.overview()).activeSelections).toEqual([]);
    view.dispose();
  });

  it('clearing the sort is an act too, and says so in its own words', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.setSheetSort('cells', DESC);
    await view.setSheetSort('cells', undefined);

    const commit = session.log.records.at(-1)!;
    expect(commit.value).toBe('');
    expect(commit.cause.intent).toBe('cells: sort cleared');
    expect(sheetSortOf(view.getState().layouts, 'cells')).toBeUndefined();
    view.dispose();
  });
});

describe('the sort a person left is the sort they come back to', () => {
  it('is what `sheetSortOf` hands the sheet, off the state the host already polls', async () => {
    const { view } = open();
    await view.refresh();
    await view.setSheetSort('cells', DESC);
    expect(sheetSortOf(view.getState().layouts, 'cells')).toEqual(DESC);
    // and a second sheet on the same dashboard keeps its own
    expect(sheetSortOf(view.getState().layouts, 'other')).toBeUndefined();
    view.dispose();
  });

  it('TIME TRAVEL restores it: a cursor before the sort is a cursor with no sort', async () => {
    const { session, view } = open();
    await view.refresh();
    const first = await session.dispatch({ verb: 'select', viewId: 'bar', field: 'region', value: 'north', cause });
    await view.setSheetSort('cells', DESC);
    await view.refresh();
    expect(sheetSortOf(view.getState().layouts, 'cells')).toEqual(DESC);

    expect(first.ok).toBe(true);
    session.seek(first.ok ? first.commit!.id : '');
    await view.refresh();
    expect(sheetSortOf(view.getState().layouts, 'cells')).toBeUndefined();

    session.seek(session.log.records.at(-1)!.id);
    await view.refresh();
    expect(sheetSortOf(view.getState().layouts, 'cells')).toEqual(DESC);
    view.dispose();
  });

  it('A RELOAD keeps it: the log alone rebuilds the arrangement in a session that never saw the walk', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.setSheetSort('cells', DESC);
    const wire = JSON.parse(JSON.stringify(session.log.records)) as unknown[];
    view.dispose();

    const reloaded = buildDashboard(DEF).createSession();
    const res = await reloaded.replay(wire as never);
    expect(res.ok).toBe(true);
    expect(sheetSortOf((await reloaded.overview()).layouts, 'cells')).toEqual(DESC);
  });
});
