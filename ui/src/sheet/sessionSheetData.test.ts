/**
 * The in-process adapter adds nothing: it asks the session's view-query port
 * and hands back the answer, or the session's own refusal, in the sheet's
 * words. The schema comes from the facets and the declared keys — never from
 * the rows.
 */
import { describe, expect, it, vi } from 'vitest';
import { sessionSheetData, threwSentence, type SheetSessionLike } from './sessionSheetData.js';
import type { Overview, ViewQuery, ViewQueryResult } from 'vizfootprint/session';

const OVERVIEW = {
  defaultTable: 'cells',
  keys: { cells: 'id' },
  columns: {
    cells: [
      { field: 'id', type: 'string', role: 'identifier' },
      { field: 'cases', type: 'number', role: 'measure' },
      { field: 'note', type: 'unknown' },
    ],
  },
} as unknown as Overview;

const WINDOW: ViewQueryResult = {
  ok: true,
  columns: ['id', 'cases'],
  rows: [{ id: 'a', cases: 3 }],
  rowIds: ['a'],
  positional: false,
  key: 'id',
  count: 1,
  start: 0,
  version: 'v1',
  cursor: 'c1',
  clauses: [{ from: 'diseases', clause: { kind: 'point', field: 'disease', value: 'Measles' }, response: 'filter' }],
};

function fakeSession(answer: ViewQueryResult = WINDOW): { readonly session: SheetSessionLike; readonly asked: ViewQuery[] } {
  const asked: ViewQuery[] = [];
  return {
    asked,
    session: {
      overview: () => OVERVIEW,
      viewQuery: (query: ViewQuery = {}) => {
        asked.push(query);
        return Promise.resolve(answer);
      },
    },
  };
}

describe('sessionSheetData', () => {
  it('reads the schema off the facets: name, type, the declared role, and which column is the key', async () => {
    const { session } = fakeSession();
    expect(await sessionSheetData(session).columns()).toEqual([
      { name: 'id', type: 'string', role: 'identifier', key: true },
      { name: 'cases', type: 'number', role: 'measure' },
      { name: 'note', type: 'unknown' },
    ]);
  });

  it('a table the overview lists no columns for has none — never an invented set', async () => {
    const { session } = fakeSession();
    expect(await sessionSheetData(session, { table: 'series' }).columns()).toEqual([]);
  });

  it('passes the window through verbatim and keeps the session\'s clauses with the session', async () => {
    const { session, asked } = fakeSession();
    const data = sessionSheetData(session, { table: 'cells' });
    const answer = await data.rows({ offset: 0, limit: 50, viewId: 'sheet', columns: ['id', 'cases'], sort: [{ field: 'cases', dir: 'desc' }] });
    expect(asked[0]).toEqual({ table: 'cells', viewId: 'sheet', columns: ['id', 'cases'], sort: [{ field: 'cases', dir: 'desc' }], offset: 0, limit: 50 });
    expect(answer).toEqual({ ok: true, columns: ['id', 'cases'], rows: [{ id: 'a', cases: 3 }], rowIds: ['a'], positional: false, key: 'id', count: 1, start: 0, version: 'v1', cursor: 'c1' });
    expect(answer).not.toHaveProperty('clauses');
  });

  it('asks for nothing it was not given — no table, no view, no columns, no sort', async () => {
    const { session, asked } = fakeSession();
    await sessionSheetData(session).rows({ offset: 20, limit: 10 });
    expect(asked[0]).toEqual({ offset: 20, limit: 10 });
  });

  it('a refused window comes back as the code and the sentence, never an empty grid', async () => {
    const { session } = fakeSession({ ok: false, reason: 'unsupported-sort', rejected: 'the wasm engine cannot sort. Ask for this window without a sort' });
    expect(await sessionSheetData(session).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unsupported-sort', rejected: 'the wasm engine cannot sort. Ask for this window without a sort' });
  });

  it('capabilities: sorting is on by default, and an engine that cannot sort says why', () => {
    const { session } = fakeSession();
    expect(sessionSheetData(session).capabilities).toEqual({ sort: true, countKnown: true, edit: false });
    expect(sessionSheetData(session, { sort: false }).capabilities.refusal).toContain('cannot sort');
    expect(sessionSheetData(session, { sort: false, sortRefusal: 'this table is a stream' }).capabilities.refusal).toBe('this table is a stream');
  });

  it('a positional window names no key, and none is invented', async () => {
    const { session } = fakeSession({ ...WINDOW, ok: true, positional: true, key: undefined } as ViewQueryResult);
    const answer = await sessionSheetData(session).rows({ offset: 0, limit: 5 });
    expect(answer.ok && answer.key).toBeUndefined();
    expect(answer.ok && answer.positional).toBe(true);
  });

  it('a data layer that THROWS is a refusal with what it threw — never a grid frozen on a rejected promise', async () => {
    const boom: SheetSessionLike = { overview: () => OVERVIEW, viewQuery: () => { throw new Error('the provider is closed'); } };
    expect(await sessionSheetData(boom).rows({ offset: 0, limit: 5 })).toEqual({ ok: false, reason: 'engine', rejected: 'the data layer threw: the provider is closed' });
    const odd: SheetSessionLike = { overview: () => OVERVIEW, viewQuery: () => Promise.reject('gone') }; // eslint-disable-line prefer-promise-reject-errors -- a session may reject with anything
    expect(await sessionSheetData(odd).rows({ offset: 0, limit: 5 })).toEqual({ ok: false, reason: 'engine', rejected: 'the data layer threw: gone' });
    expect(threwSentence(new Error('x'))).toBe('the data layer threw: x');
  });

  it('honours the abort signal: a window the scroll has left behind answers a sentence, never rows', async () => {
    const { session } = fakeSession();
    const controller = new AbortController();
    const data = sessionSheetData(session);
    const live = await data.rows({ offset: 0, limit: 5 }, { signal: controller.signal });
    expect(live.ok).toBe(true);
    controller.abort();
    expect(await data.rows({ offset: 0, limit: 5 }, { signal: controller.signal })).toEqual({ ok: false, reason: 'engine', rejected: 'this window was left behind by a newer one' });
    expect((await data.rows({ offset: 0, limit: 5 })).ok).toBe(true); // no signal, no drop
  });

  it('awaits an overview a session answers as a promise', async () => {
    const overview = vi.fn(() => Promise.resolve(OVERVIEW));
    const data = sessionSheetData({ overview, viewQuery: () => WINDOW });
    expect((await data.columns()).map((c) => c.name)).toEqual(['id', 'cases', 'note']);
    expect(overview).toHaveBeenCalledTimes(1);
  });
});
