/**
 * The polled adapter: one GET per window, the session's own JSON answered
 * verbatim — and a door that cannot be reached is a refusal with a sentence,
 * never a fabricated window.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpSheetData, findQueryBody, isFindInViewResult, isViewQueryResult, windowQuery, NO_FIND_DOOR, type FetchLike } from './httpSheetData.js';
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
  it.each([
    ['/api/window', '/api/window?offset=20&limit=10'],
    ['api/window', 'api/window?offset=20&limit=10'],
    ['/api/window?capture=sample&kind=slow', '/api/window?capture=sample&kind=slow&offset=20&limit=10'],
    ['/api/window?', '/api/window?offset=20&limit=10'],
    ['/api/window#records', '/api/window?offset=20&limit=10#records'],
    ['/api/window?#records', '/api/window?offset=20&limit=10#records'],
    ['/api/window?capture=sample#records?detail=1', '/api/window?capture=sample&offset=20&limit=10#records?detail=1'],
    ['https://example.test/api/window?capture=sample#records', 'https://example.test/api/window?capture=sample&offset=20&limit=10#records'],
  ])('composes a window query with endpoint %s', async (endpoint, expected) => {
    const door = fakeDoor(BODY);
    await httpSheetData({ endpoint, fetch: door.call }).rows({ offset: 20, limit: 10 });
    expect(door.urls[0]).toBe(expected);
  });

  it('overrides supplied window keys once while retaining unrelated filters and optional endpoint defaults', async () => {
    const door = fakeDoor(BODY);
    const endpoint = '/api/window?capture=a%26b&kind=slow&tag=one&tag=two&offset=99&offset=100&limit=1&viewId=old&columns=old&sort=old&table=default#rows';
    const window = { offset: 20, limit: 10, viewId: 'sheet', columns: ['id', 'a,b'], sort: [{ field: 'a,b', dir: 'desc' as const }] };
    await httpSheetData({ endpoint, fetch: door.call }).rows(window);
    const url = new URL(door.urls[0]!, 'https://example.test');
    expect(url.hash).toBe('#rows');
    expect(url.searchParams.get('capture')).toBe('a&b');
    expect(url.searchParams.get('kind')).toBe('slow');
    expect(url.searchParams.getAll('tag')).toEqual(['one', 'two']);
    expect(url.searchParams.get('table')).toBe('default');
    expect(url.searchParams.getAll('offset')).toEqual(['20']);
    expect(url.searchParams.getAll('limit')).toEqual(['10']);
    expect(url.searchParams.getAll('viewId')).toEqual(['sheet']);
    expect(url.searchParams.getAll('columns')).toEqual([JSON.stringify(window.columns)]);
    expect(url.searchParams.getAll('sort')).toEqual([JSON.stringify(window.sort)]);
    await httpSheetData({ endpoint, table: 'override', fetch: door.call }).rows({ offset: 0, limit: 1 });
    expect(new URL(door.urls[1]!, 'https://example.test').searchParams.getAll('table')).toEqual(['override']);
  });

  it('asks the door for one window and answers the sheet\'s own shape, the wire\'s clauses among them', async () => {
    const door = fakeDoor(BODY);
    const data = httpSheetData({ endpoint: '/api/window', table: 'cells', columns: FACETS, fetch: door.call });
    const answer = await data.rows({ offset: 0, limit: 30, viewId: 'sheet' });
    expect(door.urls[0]).toBe('/api/window?table=cells&viewId=sheet&offset=0&limit=30');
    expect(answer).toEqual({ ok: true, columns: ['id', 'cases'], rows: [{ id: 'a', cases: 3 }], rowIds: ['a'], positional: false, key: 'id', count: 90_300, start: 0, version: 'v1', cursor: 'c1', clauses: [] });
    expect(await data.columns()).toEqual(FACETS);
    // no find door was given, so the capability is false and the sentence says why
    expect(data.capabilities).toEqual({ sort: true, countKnown: true, edit: false, find: false, findRefusal: NO_FIND_DOOR });
  });

  it('a door that SENDS clauses hands them to the export receipt; one that sends none says nothing rather than "none"', async () => {
    const clauses = [{ from: 'diseases', clause: { kind: 'point', field: 'disease', value: 'Measles' }, response: 'filter' }];
    const said = fakeDoor({ ...BODY, clauses });
    const answer = await httpSheetData({ endpoint: '/api/window', fetch: said.call }).rows({ offset: 0, limit: 10 });
    expect(answer.ok && answer.clauses).toEqual(clauses);
    // an absent `clauses` is a door that did not tell us — not a door claiming there were no filters
    const mute = fakeDoor({ ...BODY, clauses: undefined });
    expect(await httpSheetData({ endpoint: '/api/window', fetch: mute.call }).rows({ offset: 0, limit: 10 })).not.toHaveProperty('clauses');
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

// ── the find door: a POST, and a read all the same ───────────────────────

const FOUND = { ok: true, position: 12, rowId: 'a', ordinal: 2, matches: 5, version: 'v1', cursor: 'c1' };

describe('findQueryBody', () => {
  it('carries exactly what the library\'s own find door parses, and nothing it does not', () => {
    expect(findQueryBody({ text: 'mea', from: 3, direction: 'backward' })).toEqual({ text: 'mea', from: 3, direction: 'backward' });
    expect(findQueryBody({ text: 'mea', from: 0, direction: 'forward', viewId: 'sheet', columns: ['id'], sort: [{ field: 'cases', dir: 'desc' }] }, 'cells')).toEqual({
      table: 'cells',
      viewId: 'sheet',
      columns: ['id'],
      sort: [{ field: 'cases', dir: 'desc' }],
      text: 'mea',
      from: 0,
      direction: 'forward',
    });
  });
});

describe('isFindInViewResult', () => {
  it('a miss is as valid an answer as a hit, and anything that is not an answer is not one', () => {
    expect(isFindInViewResult(FOUND)).toBe(true);
    expect(isFindInViewResult({ ok: true, position: null, matches: 0, version: null, cursor: null })).toBe(true);
    expect(isFindInViewResult({ ok: false, reason: 'unsupported-find', rejected: 'no' })).toBe(true);
    expect(isFindInViewResult({ ok: false, reason: 'unsupported-find' })).toBe(false);
    expect(isFindInViewResult({ ok: true, matches: 3 })).toBe(false); // no position at all
    expect(isFindInViewResult({ ok: true, position: 1 })).toBe(false); // no count
    expect(isFindInViewResult({ position: 1, matches: 3 })).toBe(false); // no verdict
    expect(isFindInViewResult(null)).toBe(false);
    expect(isFindInViewResult('a match')).toBe(false);
  });
});

describe('httpSheetData — the find door', () => {
  it('POSTs the ask as JSON and answers the sheet\'s own shape', async () => {
    const door = fakeDoor(FOUND);
    const data = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', table: 'cells', columns: FACETS, fetch: door.call });
    expect(data.capabilities.find).toBe(true);
    expect(data.capabilities.findRefusal).toBeUndefined();
    const answer = await data.find!({ text: 'mea', from: 3, direction: 'forward', viewId: 'sheet' });
    expect(door.urls[0]).toBe('/api/find'); // a POST: the typing is in the BODY, not in a URL a proxy logs
    expect(door.inits[0]).toEqual({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: 'cells', viewId: 'sheet', text: 'mea', from: 3, direction: 'forward' }) });
    expect(answer).toEqual({ ok: true, position: 12, rowId: 'a', ordinal: 2, matches: 5, version: 'v1', cursor: 'c1' });
  });

  it('a MISS names no row, and the abort signal rides along', async () => {
    const door = fakeDoor({ ok: true, position: null, matches: 5, version: null, cursor: null });
    const controller = new AbortController();
    const data = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: door.call });
    expect(await data.find!({ text: 'x', from: 0, direction: 'forward' }, { signal: controller.signal })).toEqual({ ok: true, position: null, matches: 5, version: null, cursor: null });
    expect((door.inits[0] as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it('a door with NO find door refuses in words — and the strip is told before it offers an input', async () => {
    const door = fakeDoor(FOUND);
    const data = httpSheetData({ endpoint: '/api/window', fetch: door.call });
    expect(data.capabilities).toMatchObject({ find: false, findRefusal: NO_FIND_DOOR });
    expect(await data.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unsupported-find', rejected: NO_FIND_DOOR });
    expect(door.urls).toEqual([]); // nothing was asked of anything
    // …and a host may say it in its own words
    const own = httpSheetData({ endpoint: '/api/window', findRefusal: 'search is not enabled on this deployment', fetch: door.call });
    expect(own.capabilities.findRefusal).toBe('search is not enabled on this deployment');
    expect(await own.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unsupported-find', rejected: 'search is not enabled on this deployment' });
  });

  it('a refusing door, a door that answers something else, and a door that cannot be reached are three sentences — never a jump', async () => {
    const status = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: fakeDoor({}, { ok: false, status: 503 }).call });
    expect(await status.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the find door answered 503 — nothing was looked for' });
    const said = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: fakeDoor({ error: 'the index is rebuilding' }, { ok: false, status: 500 }).call });
    expect(await said.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the index is rebuilding' });
    const nonsense = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: fakeDoor({ rows: [] }).call });
    expect(await nonsense.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the find door answered 200 with something that is not a find answer — nothing was looked for' });
    // a body that is not JSON at all is no sentence either, and it is not a crash
    const notJson = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('unexpected token')) }) });
    expect(await notJson.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the find door answered 200 with something that is not a find answer — nothing was looked for' });
    const refused = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: fakeDoor({ ok: false, reason: 'version-moved', rejected: 'the table was refreshed' }).call });
    expect(await refused.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'version-moved', rejected: 'the table was refreshed' });
    const gone = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: () => Promise.reject(new Error('offline')) });
    expect(await gone.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the find door could not be reached: offline' });
    // a door may reject with something that is not an Error at all, and it still says what it was
    const odd = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find', fetch: () => Promise.reject('a string') }); // eslint-disable-line prefer-promise-reject-errors -- a fetch may reject with anything
    expect(await odd.find!({ text: 'x', from: 0, direction: 'forward' })).toEqual({ ok: false, reason: 'unreachable', rejected: 'the find door could not be reached: a string' });
  });

  it('the page\'s own fetch is the default for the find door too', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', (url: string, init: unknown) => {
      calls.push([url, init]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(FOUND) });
    });
    const data = httpSheetData({ endpoint: '/api/window', findEndpoint: '/api/find' });
    expect((await data.find!({ text: 'x', from: 0, direction: 'forward' })).ok).toBe(true);
    expect((calls[0] as [string, unknown])[0]).toBe('/api/find');
  });
});
