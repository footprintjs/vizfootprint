/**
 * The polled adapter: one GET per window, the session's own JSON answered
 * verbatim — and a door that cannot be reached is a refusal with a sentence,
 * never a fabricated window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpSheetData, isViewQueryResult, windowQuery, type FetchLike } from './httpSheetData.js';
import type { SheetColumn } from './types.js';

const FACETS: readonly SheetColumn[] = [
  { name: 'id', type: 'string', role: 'identifier', key: true },
  { name: 'cases', type: 'number' },
];

const BODY = { ok: true, columns: ['id', 'cases'], rows: [{ id: 'a', cases: 3 }], rowIds: ['a'], positional: false, key: 'id', count: 90_300, start: 0, version: 'v1', cursor: 'c1', clauses: [] };

/** A door that answers `body`, remembering every URL it was asked for. */
function fakeDoor(body: unknown, init: { ok?: boolean; status?: number } = {}): { readonly call: FetchLike; readonly urls: string[]; readonly inits: unknown[] } {
  const urls: string[] = [];
  const inits: unknown[] = [];
  return {
    urls,
    inits,
    call: (url, opts) => {
      urls.push(url);
      inits.push(opts);
      return Promise.resolve({ ok: init.ok ?? true, status: init.status ?? 200, json: () => Promise.resolve(body) });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('windowQuery', () => {
  it('carries exactly what the door parses: columns and sort as JSON, offset and limit as integers', () => {
    expect(windowQuery({ offset: 0, limit: 200 })).toBe('offset=0&limit=200');
    expect(windowQuery({ offset: 100, limit: 50, viewId: 'sheet', columns: ['id', 'cases'], sort: [{ field: 'cases', dir: 'desc' }] }, 'cells')).toBe(
      `table=cells&viewId=sheet&columns=${encodeURIComponent('["id","cases"]')}&sort=${encodeURIComponent('[{"field":"cases","dir":"desc"}]')}&offset=100&limit=50`,
    );
  });

  it('a column whose name holds a comma survives the wire — which a joined list could never promise', () => {
    expect(windowQuery({ offset: 0, limit: 10, columns: ['a,b', 'c'] })).toContain(encodeURIComponent('["a,b","c"]'));
  });
});

describe('httpSheetData', () => {
  it('asks the door for one window and answers the sheet\'s own shape (the wire\'s clauses stay on the wire)', async () => {
    const door = fakeDoor(BODY);
    const data = httpSheetData({ endpoint: '/api/window', table: 'cells', columns: FACETS, fetch: door.call });
    const answer = await data.rows({ offset: 0, limit: 30, viewId: 'sheet' });
    expect(door.urls[0]).toBe('/api/window?table=cells&viewId=sheet&offset=0&limit=30');
    expect(answer).toEqual({ ok: true, columns: ['id', 'cases'], rows: [{ id: 'a', cases: 3 }], rowIds: ['a'], positional: false, key: 'id', count: 90_300, start: 0, version: 'v1', cursor: 'c1' });
    expect(await data.columns()).toEqual(FACETS);
    expect(data.capabilities).toEqual({ sort: true, countKnown: true, edit: false });
  });

  it('passes the abort signal through, and asks with no init when there is none', async () => {
    const door = fakeDoor(BODY);
    const data = httpSheetData({ endpoint: '/api/window', fetch: door.call });
    const controller = new AbortController();
    await data.rows({ offset: 0, limit: 10 }, { signal: controller.signal });
    await data.rows({ offset: 0, limit: 10 });
    await data.rows({ offset: 0, limit: 10 }, {});
    expect(door.inits[0]).toEqual({ signal: controller.signal });
    expect(door.inits[1]).toEqual({});
    expect(door.inits[2]).toEqual({});
  });

  it('a host that hands no schema has none — the sheet is told nothing it was not given', async () => {
    expect(await httpSheetData({ endpoint: '/api/window', fetch: fakeDoor(BODY).call }).columns()).toEqual([]);
  });

  it('a positional table\'s window names no key, and none is invented on this side', async () => {
    const door = fakeDoor({ ...BODY, positional: true, key: undefined });
    const answer = await httpSheetData({ endpoint: '/api/window', fetch: door.call }).rows({ offset: 0, limit: 10 });
    expect(answer.ok && answer.key).toBeUndefined();
    expect(answer.ok && answer.positional).toBe(true);
  });

  it('the session\'s own refusal comes through with its code and its sentence', async () => {
    const door = fakeDoor({ ok: false, reason: 'unknown-view', rejected: 'no declared view "sheet"' });
    expect(await httpSheetData({ endpoint: '/api/window', fetch: door.call }).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unknown-view', rejected: 'no declared view "sheet"' });
  });

  it('a door that answers with a status is refused in ITS OWN words when it sent any, else in the status\'s', async () => {
    const said = fakeDoor({ error: 'limit=0 asks for no rows — ask for at least one' }, { ok: false, status: 400 });
    expect(await httpSheetData({ endpoint: '/api/window', fetch: said.call }).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unreachable', rejected: 'limit=0 asks for no rows — ask for at least one' });
    const mute = fakeDoor({}, { ok: false, status: 503 });
    expect(await httpSheetData({ endpoint: '/api/window', fetch: mute.call }).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the window door answered 503 — no rows were read' });
    const empty = fakeDoor({ error: '' }, { ok: false, status: 500 });
    expect((await httpSheetData({ endpoint: '/api/window', fetch: empty.call }).rows({ offset: 0, limit: 10 })).ok).toBe(false);
    const notJson: FetchLike = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) });
    expect(await httpSheetData({ endpoint: '/api/window', fetch: notJson }).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the window door answered 502 — no rows were read' });
  });

  it('a 200 that is not a window is refused, never rendered', async () => {
    const cases: unknown[] = [null, 'a window, honest', {}, { ok: 'yes' }, { ok: true, columns: ['a'] }, { ok: true, columns: [], rows: [], rowIds: [], count: '90300', start: 0 }, { ok: false, reason: 'engine' }];
    for (const body of cases) {
      const answer = await httpSheetData({ endpoint: '/api/window', fetch: fakeDoor(body).call }).rows({ offset: 0, limit: 10 });
      expect(answer).toEqual({ ok: false, reason: 'unreachable', rejected: 'the window door answered 200 with something that is not a window — no rows were read' });
    }
    expect(isViewQueryResult(BODY)).toBe(true);
    expect(isViewQueryResult({ ok: false, reason: 'unknown-view', rejected: 'no such view' })).toBe(true);
  });

  it('a door that cannot be reached at all is refused with what went wrong, whatever was thrown', async () => {
    const boom: FetchLike = () => Promise.reject(new Error('network down'));
    expect(await httpSheetData({ endpoint: '/api/window', fetch: boom }).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the window door could not be reached: network down' });
    const odd: FetchLike = () => Promise.reject('the tab went away'); // eslint-disable-line prefer-promise-reject-errors -- a wire may reject with anything
    expect(await httpSheetData({ endpoint: '/api/window', fetch: odd }).rows({ offset: 0, limit: 10 })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the window door could not be reached: the tab went away' });
  });

  it('with no fetch given it uses the page\'s own', async () => {
    const stub = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BODY) }));
    vi.stubGlobal('fetch', stub);
    const answer = await httpSheetData({ endpoint: '/api/window' }).rows({ offset: 0, limit: 10 });
    expect(answer.ok).toBe(true);
    expect(stub).toHaveBeenCalledWith('/api/window?offset=0&limit=10', {});
  });

  it('a door whose engine cannot sort says so instead of showing a toggle', () => {
    expect(httpSheetData({ endpoint: '/x', sort: false }).capabilities.refusal).toContain('cannot sort');
    expect(httpSheetData({ endpoint: '/x', sort: false, sortRefusal: 'the door serves one order' }).capabilities.refusal).toBe('the door serves one order');
  });
});
