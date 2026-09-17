/**
 * The http carrier against a real local server: the version the server
 * vouches for, and every refusal by its name — unauthorized, unavailable,
 * disconnected, timeout, cancelled, malformed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { httpSource } from './http.js';
import { decodeRows } from './decode.js';
import { isSourceRefusal, openSource, SourceRefusal, SOURCE_REFUSALS, CAPABILITY_REFUSALS } from './index.js';
import { fileSource } from './file.js';
import { buildDashboardAsync } from '../def/index.js';
import { makeDashboardDef } from '../session/dashboard.fixture.js';
import type { SourceSnapshot, SourceUnchanged } from './types.js';
/** A first read never answers "unchanged"; the tests read the snapshot's rows and version. */
function full(s: SourceSnapshot | SourceUnchanged): SourceSnapshot {
  if ('unchanged' in s) throw new Error('unexpected unchanged');
  return s;
}


let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/cells.csv') {
      if (req.headers['if-none-match'] === 'W/"abc123"') {
        res.writeHead(304, { etag: 'W/"abc123"' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/csv', etag: 'W/"abc123"' });
      res.end('state,cases\nOhio,3\nIowa,\n');
    } else if (url === '/rows.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'last-modified': 'Tue, 02 Sep 2026 10:00:00 GMT' });
      res.end(JSON.stringify([{ a: 1 }, { a: 2 }]));
    } else if (url === '/plain.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ a: 1 }] }));
    } else if (url === '/not-json.rows') {
      res.writeHead(200);
      res.end('a,b');
    } else if (url === '/bad.rows') {
      res.writeHead(200);
      res.end(JSON.stringify({ a: 1 }));
    } else if (url === '/private') {
      res.writeHead(401);
      res.end('no');
    } else if (url === '/slow') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('a\n1');
      }, 400);
    } else if (url === '/slow-body') {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.write('a\n');
      setTimeout(() => res.end('1\n'), 400); // headers fast, body slow
    } else if (url === '/empty') {
      res.writeHead(204);
      res.end();
    } else if (url === '/empty-200') {
      res.writeHead(200);
      res.end('');
    } else if (url === '/big') {
      res.writeHead(200, { 'content-length': '999999999' });
      res.end('a\n1');
    } else if (url === '/wide') {
      res.writeHead(200);
      res.end('a,b\n' + '1,2\n'.repeat(2000));
    } else {
      res.writeHead(404);
      res.end('gone');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  base = typeof addr === 'object' && addr !== null ? `http://127.0.0.1:${String(addr.port)}` : '';
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'none';
  } catch (e) {
    return isSourceRefusal(e) ? `${e.reason}: ${e.message}` : `not a refusal: ${String(e)}`;
  }
};

describe('httpSource', () => {
  it('reads CSV and keeps the ETag as the version; a JSON list; last-modified; a hash when the server vouches for nothing', async () => {
    const http = httpSource();
    const csv = await (await http.open({ format: 'csv', via: 'http', at: `${base}/cells.csv` }, { table: 'cells' })).snapshot().then(full);
    expect(csv.rows).toEqual([{ state: 'Ohio', cases: 3 }, { state: 'Iowa', cases: null }]);
    expect(csv.version).toBe('etag:W/"abc123"'); // the validator exactly as sent — weak marker and quotes
    const list = await (await http.open({ format: 'rows', via: 'http', at: `${base}/rows.json` }, { table: 'r' })).snapshot().then(full);
    expect(list.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(list.version).toBe('last-modified:Tue, 02 Sep 2026 10:00:00 GMT');
    const h = await http.open({ format: 'json', via: 'http', at: `${base}/plain.json` }, { table: 'p' });
    expect(h.capabilities).toEqual({ live: false, pushdown: false });
    const plain = await h.snapshot().then(full);
    expect(plain.rows).toEqual([{ a: 1 }]);
    expect(plain.version).toMatch(/^hash:[0-9a-f]{8}$/);
    expect(typeof plain.retrievedAt).toBe('string');
    await h.close();
  });
  it('names every refusal: malformed locator, unauthorized, unavailable, malformed payloads', async () => {
    const http = httpSource();
    expect(await reasonOf(http.open({ format: 'csv', via: 'http', at: 'ftp://x' }, { table: 'x' }))).toBe('malformed: table "x" http source: `at` must be an http(s) URL');
    expect(await reasonOf((await http.open({ format: 'csv', via: 'http', at: `${base}/private` }, { table: 'x' })).snapshot().then(full))).toBe(`unauthorized: table "x" http source ${base}/private: unauthorized (401)`);
    expect(await reasonOf((await http.open({ format: 'csv', via: 'http', at: `${base}/missing` }, { table: 'x' })).snapshot().then(full))).toBe(`unavailable: table "x" http source ${base}/missing: unavailable (404)`);
    expect(await reasonOf((await http.open({ format: 'rows', via: 'http', at: `${base}/not-json.rows` }, { table: 'x' })).snapshot().then(full))).toContain('malformed: table "x" http source');
    expect(await reasonOf((await http.open({ format: 'rows', via: 'http', at: `${base}/bad.rows` }, { table: 'x' })).snapshot().then(full))).toContain('malformed: ');
  });
  it('names the time refusals: disconnected, timeout, cancelled', async () => {
    const http = httpSource({ timeoutMs: 100, headers: { accept: 'text/csv' } });
    expect(await reasonOf((await http.open({ format: 'csv', via: 'http', at: 'http://127.0.0.1:1/x' }, { table: 'x' })).snapshot().then(full))).toMatch(/^disconnected: table "x" http source http:\/\/127\.0\.0\.1:1\/x: disconnected — /);
    expect(await reasonOf((await http.open({ format: 'csv', via: 'http', at: `${base}/slow` }, { table: 'x' })).snapshot().then(full))).toBe(`timeout: table "x" http source ${base}/slow: timeout — no answer within 100 ms`);
    const slow = await httpSource({ timeoutMs: 5000 }).open({ format: 'csv', via: 'http', at: `${base}/slow` }, { table: 'x' });
    const controller = new AbortController();
    const pending = reasonOf(slow.snapshot({ signal: controller.signal }));
    controller.abort();
    expect(await pending).toBe(`cancelled: table "x" http source ${base}/slow: cancelled — the request was aborted`);
    expect(await reasonOf(slow.snapshot({ signal: AbortSignal.abort() }))).toBe(`cancelled: table "x" http source ${base}/slow: cancelled — the request was aborted before it started`);
  });
  it('the body phase is under the guard: a slow body times out, an abort during the body cancels, an empty 2xx is unavailable, a big body is too-large', async () => {
    const quick = httpSource({ timeoutMs: 100 });
    expect(await reasonOf((await quick.open({ format: 'csv', via: 'http', at: `${base}/slow-body` }, { table: 'x' })).snapshot().then(full))).toBe(`timeout: table "x" http source ${base}/slow-body: timeout — no answer within 100 ms`);
    const h = await httpSource({ timeoutMs: 5000 }).open({ format: 'csv', via: 'http', at: `${base}/slow-body` }, { table: 'x' });
    const controller = new AbortController();
    const pending = reasonOf(h.snapshot({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toBe(`cancelled: table "x" http source ${base}/slow-body: cancelled — the request was aborted`);
    expect(await reasonOf((await httpSource().open({ format: 'csv', via: 'http', at: `${base}/empty` }, { table: 'x' })).snapshot().then(full))).toBe(`unavailable: table "x" http source ${base}/empty: unavailable (204 with an empty body)`);
    expect(await reasonOf((await httpSource().open({ format: 'csv', via: 'http', at: `${base}/empty-200` }, { table: 'x' })).snapshot().then(full))).toBe(`unavailable: table "x" http source ${base}/empty-200: unavailable (200 with an empty body)`);
    expect(await reasonOf((await httpSource().open({ format: 'csv', via: 'http', at: `${base}/big` }, { table: 'x' })).snapshot().then(full))).toBe(`too-large: table "x" http source ${base}/big: too-large — the server declares 999999999 bytes, the cap is 67108864`);
    expect(await reasonOf((await httpSource({ maxBytes: 100 }).open({ format: 'csv', via: 'http', at: `${base}/wide` }, { table: 'x' })).snapshot().then(full))).toMatch(/^too-large: .*: too-large — \d+ UTF-16 units arrived \(the server declared no length\), the cap is 100$/);
  });
  it('no fetch in the runtime is a missing carrier, read at call time', async () => {
    const h = await httpSource().open({ format: 'csv', via: 'http', at: `${base}/cells.csv` }, { table: 'x' });
    const real = globalThis.fetch;
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
    try {
      expect(await reasonOf(h.snapshot().then(full))).toBe(`no-adapter: table "x" http source ${base}/cells.csv: no-adapter — this runtime has no fetch; pass one in httpSource({ fetch })`);
    } finally {
      globalThis.fetch = real;
    }
    expect((await h.snapshot().then(full)).rows).toHaveLength(2); // the global is read at call time, so restoring it is enough
  });
  it('the vocabulary is closed and the capabilities name their refusal; a refusal is an Error with a name, survives JSON and a foreign copy', () => {
    expect(SOURCE_REFUSALS).toEqual(['no-adapter', 'malformed', 'unavailable', 'unauthorized', 'disconnected', 'timeout', 'cancelled', 'too-large', 'no-live', 'no-pushdown']);
    expect(CAPABILITY_REFUSALS).toEqual({ live: 'no-live', pushdown: 'no-pushdown' });
    const r = new SourceRefusal('timeout', 'slow', 't', 'http');
    expect(r).toBeInstanceOf(Error);
    expect(r.name).toBe('SourceRefusal');
    expect(JSON.parse(JSON.stringify(r))).toEqual({ name: 'SourceRefusal', reason: 'timeout', message: 'slow', table: 't', via: 'http' });
    expect(isSourceRefusal(new Error('plain'))).toBe(false);
    expect(isSourceRefusal({ name: 'SourceRefusal', reason: 'timeout', message: 'from another realm' })).toBe(true); // the brand, not the class
    expect(isSourceRefusal({ name: 'SourceRefusal', reason: 'nonsense' })).toBe(false);
    expect(isSourceRefusal(null)).toBe(false);
  });
  it('the async builder turns a refusal into the def\'s own sentence, and provenance rides the overview', async () => {
    const def = { ...makeDashboardDef(), data: { data: { source: { format: 'csv' as const, via: 'http' as const, at: `${base}/private` } } } };
    await expect(buildDashboardAsync(def, { sources: [httpSource()] })).rejects.toThrow(`data["data"].source: table "data" http source ${base}/private: unauthorized (401)`);
    await expect(buildDashboardAsync(def, { sources: [httpSource()] })).rejects.toMatchObject({ reason: 'unauthorized' }); // the typed reason rides the def error
    const ok = await buildDashboardAsync({ ...makeDashboardDef(), data: { data: { source: { format: 'rows' as const, via: 'http' as const, at: `${base}/rows.json` } } } }, { sources: [httpSource()] });
    const sources = (await ok.createSession().overview()).sources;
    expect(sources['data']).toMatchObject({ format: 'rows', via: 'http', at: `${base}/rows.json`, version: 'last-modified:Tue, 02 Sep 2026 10:00:00 GMT', rows: 2 });
    expect(await reasonOf(openSource({ format: 'csv', via: 'http', at: `${base}/cells.csv` }, 't'))).toContain('no-adapter: ');
    expect(await reasonOf(openSource({ format: 'csv', via: 'file', at: '/nowhere/at/all.csv' }, 't', [fileSource]).then((h) => h.snapshot().then(full)))).toBe('unavailable: table "t" file source /nowhere/at/all.csv: unavailable — ENOENT');
  });
});

describe('conditional reads', () => {
  it('a held ETag becomes If-None-Match and a 304 is unchanged; a server that vouches for nothing is compared by hash after the read', async () => {
    const http = httpSource();
    const h = await http.open({ format: 'csv', via: 'http', at: `${base}/cells.csv` }, { table: 'cells' });
    const first = full(await h.snapshot());
    expect(await h.snapshot({ sinceVersion: first.version })).toEqual({ unchanged: true, version: 'etag:W/"abc123"' });
    expect(full(await h.snapshot({ sinceVersion: 'etag:other' })).rows).toHaveLength(2);
    const p = await http.open({ format: 'json', via: 'http', at: `${base}/plain.json` }, { table: 'p' });
    const v = full(await p.snapshot()).version;
    expect(await p.snapshot({ sinceVersion: v })).toEqual({ unchanged: true, version: v });
    expect(full(await p.snapshot({ sinceVersion: 'hash:00000000' })).rows).toEqual([{ a: 1 }]);
    const lm = await http.open({ format: 'rows', via: 'http', at: `${base}/rows.json` }, { table: 'r' });
    expect(full(await lm.snapshot({ sinceVersion: 'last-modified:Mon, 01 Sep 2026 00:00:00 GMT' })).rows).toHaveLength(2); // the server here never answers 304 to If-Modified-Since
  });
});

/**
 * GUARD 1 — THE CARRIER JUDGES WHAT THE SERVER SAID (`./README.md`, "A document
 * is never a table by accident"). A FAKE fetch rather than the local server
 * above: the whole matrix is about ONE header, and a fake answer is also the one
 * way to prove the body never moved.
 */
function served(body: string, headers: Readonly<Record<string, string>>): { readonly fetch: typeof fetch; readonly bodyRead: () => boolean } {
  let read = false;
  const answer = {
    status: 200,
    ok: true,
    headers: new Headers(headers),
    body: null, // nothing to drain: a fake answer holds its text, not a stream
    text: async (): Promise<string> => {
      read = true;
      return body;
    },
  };
  return { fetch: (async () => answer) as unknown as typeof fetch, bodyRead: () => read };
}

const AT = 'https://viz.example/data';
/** One read of a source answered by ONE fake response. */
const readServed = async (format: 'csv' | 'json' | 'rows', body: string, headers: Readonly<Record<string, string>>): Promise<string> => {
  const fake = served(body, headers);
  return reasonOf((await httpSource({ fetch: fake.fetch }).open({ format, via: 'http', at: AT }, { table: 'cells' })).snapshot().then(full));
};
/** …and the same read when it is expected to succeed. */
const rowsServed = async (format: 'csv' | 'json' | 'rows', body: string, headers: Readonly<Record<string, string>>): Promise<SourceSnapshot> => {
  const fake = served(body, headers);
  return (await httpSource({ fetch: fake.fetch }).open({ format, via: 'http', at: AT }, { table: 'cells' })).snapshot().then(full);
};

const CSV = 'state,cases\nOhio,3\n';
const PAGE = '<!doctype html>\n<html><body><h1>Cannot GET /data</h1></body></html>\n';

describe('a document is never a table by accident — guard 1, the content type the server answered', () => {
  it('a declared csv answered text/html is malformed, and says the table, the URL, the declared format and the content type', async () => {
    expect(await readServed('csv', PAGE, { 'content-type': 'text/html' })).toBe(
      `malformed: table "cells" http source ${AT}: the server answered content-type "text/html" for a source declared csv — a document is never a table by accident; point \`at\` at the data route, or find out why this one answers a page (an error page, an SPA's index.html)`,
    );
  });
  it('the ESSENCE is compared and the parameter is quoted: `; charset=utf-8` is still text/html, and so is a capitalised one', async () => {
    expect(await readServed('csv', PAGE, { 'content-type': 'text/html; charset=utf-8' })).toBe(
      `malformed: table "cells" http source ${AT}: the server answered content-type "text/html; charset=utf-8" for a source declared csv — a document is never a table by accident; point \`at\` at the data route, or find out why this one answers a page (an error page, an SPA's index.html)`,
    );
    expect(await readServed('csv', PAGE, { 'content-type': 'Text/HTML ; charset=UTF-8' })).toContain('the server answered content-type "Text/HTML ; charset=UTF-8" for a source declared csv');
    expect(await readServed('csv', PAGE, { 'content-type': 'application/xhtml+xml' })).toContain('the server answered content-type "application/xhtml+xml" for a source declared csv');
  });
  it('a declared json answered text/html is refused in the same words — naming what the server said, where its own parse failure could not', async () => {
    expect(await readServed('json', PAGE, { 'content-type': 'text/html' })).toBe(
      `malformed: table "cells" http source ${AT}: the server answered content-type "text/html" for a source declared json — a document is never a table by accident; point \`at\` at the data route, or find out why this one answers a page (an error page, an SPA's index.html)`,
    );
  });
  it('THE REGRESSION THIS PACKET EXISTS FOR: a csv route answering an HTML error page is refused before a single row exists — the body never moves', async () => {
    const fake = served(PAGE, { 'content-type': 'text/html; charset=utf-8' });
    const handle = await httpSource({ fetch: fake.fetch }).open({ format: 'csv', via: 'http', at: AT }, { table: 'cells' });
    await expect(handle.snapshot()).rejects.toMatchObject({ reason: 'malformed', table: 'cells', via: 'http' });
    expect(fake.bodyRead()).toBe(false); // refused on the headers: no text, no parse, no 2,090-row table of HTML lines
    // …and the decoder is NOT the judge: handed the same page it still parses it, exactly as before
    expect(decodeRows('csv', PAGE)).toHaveLength(1);
  });
  it('a NON-MATCH is never refused: text/csv, text/plain, application/octet-stream and no content type at all are read exactly as before', async () => {
    const csvHeaders: readonly Readonly<Record<string, string>>[] = [{ 'content-type': 'text/csv' }, { 'content-type': 'text/plain; charset=utf-8' }, { 'content-type': 'application/octet-stream' }, {}];
    for (const headers of csvHeaders) {
      const snap = await rowsServed('csv', CSV, headers);
      expect(snap.rows).toEqual([{ state: 'Ohio', cases: 3 }]);
      expect(snap.version).toMatch(/^hash:[0-9a-f]{8}$/);
    }
    const jsonHeaders: readonly Readonly<Record<string, string>>[] = [{ 'content-type': 'application/json' }, { 'content-type': 'text/plain' }, { 'content-type': 'application/octet-stream' }, {}];
    for (const headers of jsonHeaders) {
      expect((await rowsServed('json', '[{"a":1}]', headers)).rows).toEqual([{ a: 1 }]);
    }
  });
  it('a declared rows source keeps its own sentence: its arm already names an HTML body, so this guard leaves it alone', async () => {
    expect(await readServed('rows', PAGE, { 'content-type': 'text/html' })).toBe(`malformed: table "cells" http source ${AT}: format rows needs a JSON list of row objects, and the body is not JSON`);
  });
});
