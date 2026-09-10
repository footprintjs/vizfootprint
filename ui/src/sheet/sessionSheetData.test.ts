/**
 * The in-process adapter adds nothing: it asks the session's view-query port
 * and hands back the answer, or the session's own refusal, in the sheet's
 * words. The schema comes from the facets and the declared keys — never from
 * the rows.
 */
import { describe, expect, it, vi } from 'vitest';
import { sessionSheetData, threwSentence, type SheetSessionLike } from './sessionSheetData.js';
import type { FindInViewResult, FindQuery, Overview, ViewQuery, ViewQueryResult } from 'vizfootprint/session';

const OVERVIEW = {
  defaultTable: 'cells',
  keys: { cells: 'id' },
  // the Sources rows: every table visible at the cursor — the declared one, and
  // one an act CUT, whose key nobody declared and the act minted
  tables: [
    { name: 'cells', source: { inline: 'rows', rows: 1 }, engine: 'memory', key: 'id', declaredColumns: 3 },
    { name: 'by_region', source: { computed: 'aggregate' }, engine: 'memory', key: 'region', declaredColumns: 2, derived: { of: 'cells', groupBy: ['region'], measures: ['total'], at: 's12' } },
  ],
  columns: {
    by_region: [
      { field: 'region', type: 'string' },
      { field: 'total', type: 'number' },
    ],
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

/** Where the next match is, as the session answers it. */
const FOUND: FindInViewResult = { ok: true, position: 12, rowId: 'a', ordinal: 2, matches: 5, version: 'v1', cursor: 'c1' };

function fakeSession(answer: ViewQueryResult = WINDOW, found: FindInViewResult = FOUND): { readonly session: SheetSessionLike; readonly asked: ViewQuery[]; readonly searched: FindQuery[] } {
  const asked: ViewQuery[] = [];
  const searched: FindQuery[] = [];
  return {
    asked,
    searched,
    session: {
      overview: () => OVERVIEW,
      viewQuery: (query: ViewQuery = {}) => {
        asked.push(query);
        return Promise.resolve(answer);
      },
      findInView: (query: FindQuery) => {
        searched.push(query);
        return Promise.resolve(found);
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

  it('a table an ACT cut is an ordinary table here: its own columns, and the key the act minted', async () => {
    // `overview.keys` is the DEF's map and has no entry for `by_region`; the
    // Sources row does, because the act minted it from the one group column.
    const { session, asked } = fakeSession();
    expect(await sessionSheetData(session, { table: 'by_region' }).columns()).toEqual([
      { name: 'region', type: 'string', key: true },
      { name: 'total', type: 'number' },
    ]);
    await sessionSheetData(session, { table: 'by_region' }).rows({ offset: 0, limit: 10 });
    expect(asked[0]).toEqual({ table: 'by_region', offset: 0, limit: 10 });
  });

  it('a table the overview lists no columns for has none — never an invented set', async () => {
    const { session } = fakeSession();
    expect(await sessionSheetData(session, { table: 'series' }).columns()).toEqual([]);
  });

  it('passes the window through verbatim, the reaching clauses among them — the export receipt names them', async () => {
    const { session, asked } = fakeSession();
    const data = sessionSheetData(session, { table: 'cells' });
    const answer = await data.rows({ offset: 0, limit: 50, viewId: 'sheet', columns: ['id', 'cases'], sort: [{ field: 'cases', dir: 'desc' }] });
    expect(asked[0]).toEqual({ table: 'cells', viewId: 'sheet', columns: ['id', 'cases'], sort: [{ field: 'cases', dir: 'desc' }], offset: 0, limit: 50 });
    expect(answer).toEqual({ ok: true, columns: ['id', 'cases'], rows: [{ id: 'a', cases: 3 }], rowIds: ['a'], positional: false, key: 'id', count: 1, start: 0, version: 'v1', cursor: 'c1', clauses: WINDOW.ok === true ? WINDOW.clauses : [] });
    // the grid draws none of this; the receipt is what reads it (`src/session/README.md`, "Export is a read that carries its address")
    expect(answer.ok && answer.clauses).toEqual([{ from: 'diseases', clause: { kind: 'point', field: 'disease', value: 'Measles' }, response: 'filter' }]);
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

  it('capabilities: sorting and finding are on by default, and an engine that cannot do either says why', () => {
    const { session } = fakeSession();
    expect(sessionSheetData(session).capabilities).toEqual({ sort: true, countKnown: true, edit: false, find: true });
    expect(sessionSheetData(session, { sort: false }).capabilities.refusal).toContain('cannot sort');
    expect(sessionSheetData(session, { sort: false, sortRefusal: 'this table is a stream' }).capabilities.refusal).toBe('this table is a stream');
    expect(sessionSheetData(session, { find: false }).capabilities.find).toBe(false);
    expect(sessionSheetData(session, { find: false }).capabilities.findRefusal).toContain('cannot find');
    expect(sessionSheetData(session, { find: false, findRefusal: 'this table is a stream' }).capabilities.findRefusal).toBe('this table is a stream');
  });

  it('a positional window names no key, and none is invented', async () => {
    const { session } = fakeSession({ ...WINDOW, ok: true, positional: true, key: undefined } as ViewQueryResult);
    const answer = await sessionSheetData(session).rows({ offset: 0, limit: 5 });
    expect(answer.ok && answer.key).toBeUndefined();
    expect(answer.ok && answer.positional).toBe(true);
  });

  it('a data layer that THROWS is a refusal with what it threw — never a grid frozen on a rejected promise', async () => {
    const boom: SheetSessionLike = { overview: () => OVERVIEW, viewQuery: () => { throw new Error('the provider is closed'); }, findInView: () => { throw new Error('the provider is closed'); } };
    expect(await sessionSheetData(boom).rows({ offset: 0, limit: 5 })).toEqual({ ok: false, reason: 'engine', rejected: 'the data layer threw: the provider is closed' });
    // the find door keeps the same promise: a throw is a sentence, never a frozen strip
    expect(await sessionSheetData(boom).find!({ text: 'a', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'engine', rejected: 'the data layer threw: the provider is closed' });
    const odd: SheetSessionLike = { overview: () => OVERVIEW, viewQuery: () => Promise.reject('gone'), findInView: () => Promise.reject('gone') }; // eslint-disable-line prefer-promise-reject-errors -- a session may reject with anything
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
    const data = sessionSheetData({ overview, viewQuery: () => WINDOW, findInView: () => FOUND });
    expect((await data.columns()).map((c) => c.name)).toEqual(['id', 'cases', 'note']);
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('the find rides through as the session\'s own ask, and the answer comes back as the port\'s', async () => {
    const { session, searched } = fakeSession();
    const data = sessionSheetData(session, { table: 'cells' });
    const found = await data.find!({ text: 'mea', from: 3, direction: 'backward', sort: [{ field: 'cases', dir: 'asc' }], viewId: 'grid', columns: ['id'] });
    expect(searched[0]).toEqual({ table: 'cells', viewId: 'grid', columns: ['id'], sort: [{ field: 'cases', dir: 'asc' }], text: 'mea', from: 3, direction: 'backward' });
    expect(found).toEqual({ ok: true, position: 12, rowId: 'a', ordinal: 2, matches: 5, version: 'v1', cursor: 'c1' });
  });

  it('a MISS carries the count and names no row — and a session refusal rides through with its own word', async () => {
    const miss = fakeSession(WINDOW, { ok: true, position: null, matches: 5, version: 'v1', cursor: 'c1' });
    expect(await sessionSheetData(miss.session).find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: true, position: null, matches: 5, version: 'v1', cursor: 'c1' });
    const refused = fakeSession(WINDOW, { ok: false, reason: 'unsupported-find', rejected: 'the server engine cannot find — filter instead' });
    expect(await sessionSheetData(refused.session).find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unsupported-find', rejected: 'the server engine cannot find — filter instead' });
  });

  it('honours the abort signal on a find too: an answer the typing has left behind is a sentence, never a jump', async () => {
    const { session } = fakeSession();
    const controller = new AbortController();
    const data = sessionSheetData(session);
    expect((await data.find!({ text: 'a', from: 0, direction: 'forward' }, { signal: controller.signal })).ok).toBe(true);
    controller.abort();
    expect(await data.find!({ text: 'a', from: 0, direction: 'forward' }, { signal: controller.signal })).toEqual({ ok: false, reason: 'engine', rejected: 'this find was left behind by a newer one' });
  });
});
