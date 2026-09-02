/**
 * The Sources tab's rows: every declared table as the def states it, and the
 * data journal beside the log — served on the overview, read off the def and
 * the runtime, never inferred from the rows.
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard, buildDashboardAsync } from '../def/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef, SAMPLE_ROWS } from './dashboard.fixture.js';

const withTables = (): DashboardDef => {
  const base = makeDashboardDef();
  return {
    ...base,
    data: {
      data: { source: { format: 'rows', via: 'inline', at: SAMPLE_ROWS }, key: 'id', columns: { id: { role: 'identifier' }, price: { role: 'measure' } } },
      flags: {
        rows: [
          { id: 'a', state: 'present', n: 1 },
          { id: 'b', state: 'unknown', n: null },
        ],
        key: 'id',
        grain: { bucket: 'week', reducer: 'sum', note: 'weekly totals' },
        absence: { field: 'state', states: ['present', 'unknown'] },
        columns: { id: { role: 'identifier' } },
      },
      text: { csv: 'a,b\n1,2\n' },
    },
  };
};

describe('overview.tables', () => {
  it('lists every declared table in declaration order with what the def states — source, engine, key, grain, absence, declared columns', async () => {
    const s = buildDashboard(withTables()).createSession();
    const o = await s.overview();
    expect(o.tables).toEqual([
      { name: 'data', source: { format: 'rows', via: 'inline' }, engine: 'memory', key: 'id', declaredColumns: 2 },
      { name: 'flags', source: { inline: 'rows', rows: 2 }, engine: 'memory', key: 'id', grain: { bucket: 'week', reducer: 'sum', note: 'weekly totals' }, absence: { field: 'state', states: ['present', 'unknown'] }, declaredColumns: 1 },
      { name: 'text', source: { inline: 'csv' }, engine: 'memory', declaredColumns: 0 },
    ]);
    // provenance rides `sources` only for the table that declared a source; an inline payload is never repeated
    expect(Object.keys(o.sources)).toEqual(['data']);
    expect(o.sources['data']!.at).toBeUndefined();
    expect(o.journal).toEqual([]);
    expect(o.journalTotal).toBe(0);
    // the plain fixture: one table, inline rows, no key
    const plain = await buildDashboard(makeDashboardDef()).createSession().overview();
    expect(plain.tables).toEqual([{ name: 'data', source: { inline: 'rows', rows: SAMPLE_ROWS.length }, engine: 'memory', declaredColumns: 0 }]);
  });
});

describe('the data journal', () => {
  it('a synchronous dashboard journals every refresh it is asked for — unchanged for an inline source, refused for rows that never move', async () => {
    const dash = buildDashboard(withTables());
    const s = dash.createSession();
    const first = await dash.refresh();
    expect(first.tables['data']).toEqual({ unchanged: true, version: dash.sources['data']!.version });
    expect(first.tables['flags']).toMatchObject({ refused: true, reason: 'no-source' });
    const second = await dash.refresh(['flags']);
    expect(Object.keys(second.tables)).toEqual(['flags']);
    const journal = dash.journal();
    expect(journal.map((r) => r.asked)).toEqual([['data', 'flags', 'text'], ['flags']]);
    expect(journal[0]!.tables).toEqual(first.tables);
    expect(journal.every((r) => typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)))).toBe(true);
    // the overview serves the same journal to every session, oldest first; the copy is not the dashboard's own array
    const o = await s.overview();
    expect(o.journal).toEqual(journal);
    expect(dash.journal()).not.toBe(dash.journal());
  });

  it('an async dashboard journals the same way, and a later session sees the earlier refreshes', async () => {
    const dash = await buildDashboardAsync(withTables());
    await dash.refresh(['data']);
    const o = await dash.createSession().overview();
    expect(o.journal).toHaveLength(1);
    expect(o.journal[0]!.asked).toEqual(['data']);
    expect(o.journal[0]!.tables['data']).toEqual({ unchanged: true, version: dash.sources['data']!.version });
    expect(o.tables.map((t) => t.name)).toEqual(['data', 'flags', 'text']);
  });
});

describe('the journal is honest and immutable', () => {
  it('an unknown table name is refused as such, never described as inline rows — in both builders', async () => {
    const sync = buildDashboard(withTables());
    expect((await sync.refresh(['nope'])).tables['nope']).toEqual({ refused: true, reason: 'no-source', message: 'no table "nope" is declared — the tables are data, flags, text' });
    const async = await buildDashboardAsync(withTables());
    expect((await async.refresh(['nope', 'flags'])).tables).toMatchObject({ nope: { refused: true, message: 'no table "nope" is declared — the tables are data, flags, text' }, flags: { refused: true, message: 'data["flags"] declares no source — inline rows never move' } });
  });
  it('a record copies what it was handed and is frozen: editing the caller\'s list or the returned outcomes rewrites nothing', async () => {
    const dash = await buildDashboardAsync(withTables());
    const mine = ['data'];
    const result = await dash.refresh(mine);
    mine.push('flags');
    (result.tables as Record<string, unknown>)['data'] = 'tampered';
    const [record] = dash.journal();
    expect(record!.asked).toEqual(['data']);
    expect(record!.tables['data']).toEqual({ unchanged: true, version: dash.sources['data']!.version });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record!.tables)).toBe(true);
    expect(Object.isFrozen(record!.tables['data'])).toBe(true); // every level a held result can reach
    expect(() => {
      (record!.tables as Record<string, unknown>)['data'] = 'x';
    }).toThrow();
  });
  it('the overview carries the newest fifty records; the dashboard holds them all', async () => {
    const dash = buildDashboard(withTables());
    for (let i = 0; i < 53; i++) await dash.refresh(['text']);
    expect(dash.journal()).toHaveLength(53);
    const o = await dash.createSession().overview();
    expect(o.journal).toHaveLength(50);
    expect(o.journalTotal).toBe(53); // so a tab can say "no answer in the latest 50" rather than "never asked"
    expect(o.journal[49]).toEqual(dash.journal()[52]);
  });
});
