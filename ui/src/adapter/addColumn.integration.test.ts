/**
 * ADD A COLUMN, END TO END — a real dashboard, a real session, the view's own
 * door on top of it, and the same door over a polled endpoint.
 *
 * One property is what this file is for: the door judges NOTHING. The formula
 * record is data, so it crosses the wire unchanged, the library judges it on
 * whichever side the session is, and the sentence the person reads is the
 * library's own — not one written in the adapter, which would be a second set
 * of rules that could disagree with the first.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSessionView, sessionSource, pollingSource } from './sessionView.js';
import { buildDashboard } from 'vizfootprint/def';
import type { DashboardDef } from 'vizfootprint/def';

const DEF: DashboardDef = {
  data: { data: { rows: [
    { id: 'a', region: 'north', cases: 120, people: 60 },
    { id: 'b', region: 'north', cases: 90, people: 0 },
    { id: 'c', region: 'south', cases: 30, people: 15 },
  ] } },
  actors: { grid: { actor: 'user', label: 'The grid' } },
  defaultTable: 'data',
};

function open() {
  const session = buildDashboard(DEF).createSession();
  return { session, view: createSessionView(sessionSource(session), { as: 'user' }) };
}

describe('SessionView.addColumn — over a live session', () => {
  it('lands the column as an ACT, with the words a person would read in the log', async () => {
    const { session, view } = open();
    await view.refresh();
    expect(await view.addColumn('rate', 'cases / people')).toEqual({ ok: true });

    const commit = session.log.records.at(-1)!;
    expect(commit.viewId).toBe('analysis:rate');
    expect(commit.cause.intent).toBe('add column rate = cases / people');
    expect(commit.cause.requestedBy).toBe('user');
    // the act, in enough detail to perform it again — including the formula
    // itself, which is data and so rides on the commit
    expect(commit.value).toEqual({
      id: 'rate',
      table: 'data',
      def: { builtin: 'formula', expression: 'cases / people', name: 'rate', id: 'rate' },
    });

    const rows = await session.viewQuery({ columns: ['id', 'rate'], limit: 10 });
    expect(rows.ok && rows.rows.map((r) => r['rate'])).toEqual([2, null, 2]);
    view.dispose();
  });

  it('trims what was typed, so a stray space is not part of the name', async () => {
    const { session, view } = open();
    await view.refresh();
    expect(await view.addColumn('  rate  ', '  cases / people  ')).toEqual({ ok: true });
    expect(session.log.records.at(-1)!.viewId).toBe('analysis:rate');
    view.dispose();
  });

  it('answers with the LIBRARY’s sentence when it refused, and lands nothing', async () => {
    const { session, view } = open();
    await view.refresh();
    expect(await view.addColumn('rate', 'cases / region')).toEqual({
      ok: false,
      sentence: 'the formula "cases / region" reads "region", which table "data" holds as string — a formula reads numbers',
    });
    expect(await view.addColumn('rate', 'cases %')).toEqual({
      ok: false,
      sentence: 'analysis "rate" could not be declared: invalid builtin analysis: builtin analysis.expression is not a formula: the formula has no rule for "%" at position 7',
    });
    expect(session.log.records).toHaveLength(0);
    view.dispose();
  });

  it('a column added here replays into a session that declares nothing', async () => {
    const { session, view } = open();
    await view.refresh();
    await view.addColumn('rate', 'cases / people');

    const fresh = buildDashboard(DEF).createSession();
    const replayed = await fresh.replay(JSON.stringify(session.log.records));
    expect(replayed).toMatchObject({ ok: true, landed: 1, reran: 1, filed: 0 });
    const rows = await fresh.viewQuery({ columns: ['id', 'rate'], limit: 10 });
    expect(rows.ok && rows.rows.map((r) => r['rate'])).toEqual([2, null, 2]);
    view.dispose();
  });

  it('reads the table it was told to, and writes into it', async () => {
    const session = buildDashboard({
      ...DEF,
      data: { ...DEF.data, other: { rows: [{ id: 'a', cases: 1000, people: 10 }, { id: 'b', cases: 2000, people: 10 }, { id: 'c', cases: 3000, people: 10 }] } },
    }).createSession();
    const view = createSessionView(sessionSource(session), { as: 'user' });
    await view.refresh();
    expect(await view.addColumn('rate', 'cases / people', { table: 'other' })).toEqual({ ok: true });
    const rows = await session.viewQuery({ table: 'other', columns: ['id', 'rate'], limit: 10 });
    expect(rows.ok && rows.rows.map((r) => r['rate'])).toEqual([100, 200, 300]);
    view.dispose();
  });
});

describe('SessionView.addColumn — over a polled endpoint', () => {
  it('posts the formula RECORD on the ordinary dispatch door — data, so it crosses the wire', async () => {
    const posted: unknown[] = [];
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => ({ records: [] }) } as unknown as Response;
      posted.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ ok: true, verb: 'analyze' }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(await view.addColumn('rate', 'cases / 1000', { table: 'cells' })).toEqual({ ok: true });
    expect(posted[0]).toEqual({
      verb: 'analyze',
      analysisId: 'rate',
      def: { builtin: 'formula', expression: 'cases / 1000', name: 'rate', table: 'cells' },
      table: 'cells',
      intent: 'add column rate = cases / 1000',
    });
    view.dispose();
  });

  it('shows the far side’s refusal verbatim', async () => {
    const impl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== 'POST') return { ok: true, json: async () => ({ records: [] }) } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ ok: false, rejection: { code: 'guard-failed', detail: 'the formula "a / b" reads "b", which table "cells" does not have — the numbers it may read are a' } }) } as unknown as Response;
    });
    const view = createSessionView(pollingSource({ fetchImpl: impl as unknown as typeof fetch }));
    await view.refresh();
    expect(await view.addColumn('r', 'a / b')).toEqual({
      ok: false,
      sentence: 'the formula "a / b" reads "b", which table "cells" does not have — the numbers it may read are a',
    });
    view.dispose();
  });
});
