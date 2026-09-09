/**
 * CUT A TABLE, END TO END — a real dashboard, a real session, the view's own
 * door on top of it, the sheet port over the table it cut, and the same door
 * over a polled endpoint.
 *
 * Two properties are what this file is for. The door judges NOTHING: the
 * aggregate record is data, so it crosses the wire unchanged and the library
 * judges it on whichever side the session is. And the door owns ONE thing — the
 * measure TREE, minted from what a picker handed back, so no screen has to know
 * the grammar and there is only one place that shape is written down.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, sessionSource, pollingSource, aggregateIntent } from './sessionView.js';
import { sessionSheetData } from '../sheet/sessionSheetData.js';
import { buildDashboard } from 'vizfootprint/def';
import type { DashboardDef } from 'vizfootprint/def';

const DEF: DashboardDef = {
  data: { data: { rows: [
    { id: 'a', region: 'north', cases: 120, people: 60 },
    { id: 'b', region: 'north', cases: 90, people: 30 },
    { id: 'c', region: 'south', cases: 30, people: 15 },
  ] } },
  actors: { grid: { actor: 'user', label: 'The grid' } },
  defaultTable: 'data',
};

function open() {
  const session = buildDashboard(DEF).createSession();
  return { session, view: createSessionView(sessionSource(session), { as: 'user' }) };
}

const BY_REGION = { groupBy: ['region'], measures: [{ as: 'total', op: 'sum', of: 'cases' }] };

describe('SessionView.addAggregate — over a live session', () => {
  it('lands the table as an ACT, mints the measure tree, and says what it did in words', async () => {
    const { session, view } = open();
    await view.refresh();
    expect(await view.addAggregate('by_region', BY_REGION)).toEqual({ ok: true });

    const commit = session.log.records.at(-1)!;
    expect(commit.viewId).toBe('analysis:by_region');
    expect(commit.cause.intent).toBe('cut by_region: total = sum of cases by region');
    expect(commit.cause.requestedBy).toBe('user');
    // the act, in enough detail to perform it again — the TREE rides on the
    // commit, because it is data and a replay recomputes the rows from it
    expect(commit.value).toEqual({
      id: 'by_region',
      table: 'data',
      def: {
        builtin: 'aggregate',
        name: 'by_region',
        ops: 1,
        groupBy: ['region'],
        measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }],
        id: 'by_region', // the analysis is registered under the TABLE's name — what a person looks for in `why`
      },
    });
    view.dispose();
  });

  it('the table it cut is a table: it has its own Sources row, its own key, and its own sheet', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.addAggregate('by_region', BY_REGION);
    await view.refresh();

    const row = view.getState().tables!.find((t) => t.name === 'by_region')!;
    expect(row.source).toEqual({ computed: 'aggregate' });
    expect(row.derived).toEqual({ of: 'data', groupBy: ['region'], measures: ['total'], at: session.log.records.at(-1)!.id });
    // the key was MINTED from the one group column — nobody declared it
    expect(row.key).toBe('region');

    const sheet = sessionSheetData(session, { table: 'by_region' });
    expect(await sheet.columns()).toEqual([
      { name: 'region', type: 'string', key: true },
      { name: 'total', type: 'number' },
    ]);
    const window = await sheet.rows({ offset: 0, limit: 10 });
    expect(window.ok && window.rows).toEqual([
      { region: 'north', total: 210 },
      { region: 'south', total: 30 },
    ]);
    view.dispose();
  });

  it('a group of NOTHING is one row for the whole table, and the words say so', async () => {
    const { session, view } = open();
    await view.refresh();
    expect(await view.addAggregate('everything', { groupBy: [], measures: [{ as: 'rows', op: 'count', of: 'id' }] })).toEqual({ ok: true });
    expect(session.log.records.at(-1)!.cause.intent).toBe('cut everything: rows = count of id over the whole table');
    const window = await sessionSheetData(session, { table: 'everything' }).rows({ offset: 0, limit: 10 });
    expect(window.ok && window.rows).toEqual([{ rows: 3 }]);
    view.dispose();
  });

  it('trims what was typed, so a stray space is not part of a name', async () => {
    const { session, view } = open();
    await view.refresh();
    expect(await view.addAggregate('  by_region  ', { groupBy: ['  region  '], measures: [{ as: '  total  ', op: 'sum', of: '  cases  ' }] })).toEqual({ ok: true });
    expect(session.log.records.at(-1)!.viewId).toBe('analysis:by_region');
    expect(session.log.records.at(-1)!.value).toMatchObject({ def: { groupBy: ['region'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }] } });
    view.dispose();
  });

  it('answers with the LIBRARY’s own sentence when it refused, and lands nothing', async () => {
    const { session, view } = open();
    await view.refresh();
    const unknown = await view.addAggregate('by_place', { groupBy: ['place'], measures: [{ as: 'total', op: 'sum', of: 'cases' }] });
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.sentence).toContain('place');
    const notAFold = await view.addAggregate('by_region', { groupBy: ['region'], measures: [{ as: 'total', op: 'lookup', of: 'cases' }] });
    expect(notAFold.ok).toBe(false);
    expect(!notAFold.ok && notAFold.sentence).toContain('lookup');
    expect(session.log.records).toHaveLength(0);
    view.dispose();
  });

  it('reads the table it was told to', async () => {
    const session = buildDashboard({
      ...DEF,
      data: { ...DEF.data, other: { rows: [{ id: 'a', region: 'east', cases: 1000 }, { id: 'b', region: 'east', cases: 2000 }] } },
    }).createSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    expect(await view.addAggregate('by_east', BY_REGION, { table: 'other' })).toEqual({ ok: true });
    const window = await sessionSheetData(session, { table: 'by_east' }).rows({ offset: 0, limit: 10 });
    expect(window.ok && window.rows).toEqual([{ region: 'east', total: 3000 }]);
    view.dispose();
  });

  it('a table cut here replays into a session that declares nothing', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.addAggregate('by_region', BY_REGION);

    const fresh = buildDashboard(DEF).createSession();
    expect(await fresh.replay(JSON.stringify(session.log.records))).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    const window = await sessionSheetData(fresh, { table: 'by_region' }).rows({ offset: 0, limit: 10 });
    expect(window.ok && window.rows).toEqual([
      { region: 'north', total: 210 },
      { region: 'south', total: 30 },
    ]);
    view.dispose();
  });
});

describe('the act’s words', () => {
  it('name every measure and the group, and say the empty group out loud', () => {
    expect(aggregateIntent('by_region', { groupBy: ['region', 'year'], measures: [{ as: 'total', op: 'sum', of: 'cases' }, { as: 'places', op: 'countDistinct', of: 'region' }] })).toBe(
      'cut by_region: total = sum of cases, places = countDistinct of region by region, year',
    );
    expect(aggregateIntent('everything', { groupBy: [], measures: [{ as: 'rows', op: 'count', of: 'id' }] })).toBe('cut everything: rows = count of id over the whole table');
  });
});

describe('SessionView.addAggregate — over a polled endpoint', () => {
  it('posts the aggregate RECORD on the ordinary dispatch door — data, so it crosses the wire', async () => {
    const posted: unknown[] = [];
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => ({ records: [] }) } as unknown as Response;
      posted.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ ok: true, verb: 'analyze' }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(await view.addAggregate('by_region', BY_REGION, { table: 'cells' })).toEqual({ ok: true });
    expect(posted[0]).toEqual({
      verb: 'analyze',
      analysisId: 'by_region',
      def: { builtin: 'aggregate', name: 'by_region', ops: 1, groupBy: ['region'], measures: [{ as: 'total', expr: { op: 'sum', args: [{ col: 'cases' }] } }], table: 'cells' },
      table: 'cells',
      intent: 'cut by_region: total = sum of cases by region',
    });
    view.dispose();
  });

  it('shows the far side’s refusal verbatim', async () => {
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => ({ records: [] }) } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ ok: false, rejection: { code: 'guard-failed', detail: 'a table is already called "by_region" — that name is the definition’s' } }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(await view.addAggregate('by_region', BY_REGION)).toEqual({ ok: false, sentence: 'a table is already called "by_region" — that name is the definition’s' });
    view.dispose();
  });
});
